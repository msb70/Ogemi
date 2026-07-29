-- =============================================================================
-- 2026-07-29 — Tres mejoras:
--   1) NC de compras aplicables como pago/abono de una compra del mismo
--      proveedor (uso único, sin banco): pagos.credito_compra_id +
--      compras.compra_aplicada_id + RPC aplicar_nc_compra.
--   2) Importación del libro: las NC con documento afectado se auto-aplican a
--      su factura (notas_credito.documento_afectado + RPC
--      auto_aplicar_ncs_disponibles, idempotente).
--   3) Cobros por lote: nuevas líneas de pago con anticipos del cliente
--      (registrar_cobro_lote gana p_anticipos; cobro_lotes.monto_anticipo).
-- =============================================================================

-- ── 1a. Columnas nuevas ──────────────────────────────────────────────────────
alter table public.compras
  add column if not exists compra_aplicada_id uuid references public.compras(id) on delete set null;

alter table public.pagos
  add column if not exists credito_compra_id uuid references public.compras(id) on delete set null;

create index if not exists idx_pagos_credito_compra
  on public.pagos(credito_compra_id) where credito_compra_id is not null;

alter table public.notas_credito
  add column if not exists documento_afectado integer;

-- Backfill: las NC importadas guardaban el doc afectado solo en el texto de notas
update public.notas_credito
   set documento_afectado = (substring(notas from 'Doc afectado #(\d+)'))::integer
 where documento_afectado is null
   and notas ~ 'Doc afectado #\d+';

alter table public.cobro_lotes
  add column if not exists monto_anticipo numeric not null default 0;

-- ── 1b. procesar_pago: el pago con crédito de compra NO genera banco ─────────
CREATE OR REPLACE FUNCTION public.procesar_pago()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_monto_pagado numeric; v_concepto text; v_prov text;
  v_total numeric; v_ret numeric; v_comp boolean;
BEGIN
  IF NEW.factura_id IS NOT NULL THEN
    SELECT numero_factura::text INTO v_concepto FROM public.facturas WHERE id = NEW.factura_id;
    IF NEW.anticipo_id IS NULL AND NEW.nota_credito_id IS NULL AND NEW.credito_factura_id IS NULL AND NEW.lote_id IS NULL THEN
      INSERT INTO public.banco_movimientos (cuenta_id, factura_id, pago_id, tipo, concepto, monto, fecha, referencia)
      VALUES (NEW.cuenta_id, NEW.factura_id, NEW.id, 'ingreso',
        'Cobro factura #' || COALESCE(v_concepto,'') || COALESCE(' - ' || NEW.referencia,''), NEW.monto, NEW.fecha, NEW.referencia);
    END IF;
    SELECT total, round(COALESCE(retencion_pct,0)/100.0 * COALESCE(itbms,0), 2), retencion_comprobante_entregado
      INTO v_total, v_ret, v_comp FROM public.facturas WHERE id = NEW.factura_id;
    v_monto_pagado := public.monto_pagado_factura(NEW.factura_id);
    UPDATE public.facturas SET monto_pagado = v_monto_pagado,
      estado = public.calc_estado_factura(v_total, v_monto_pagado, v_ret, v_comp),
      fecha_cobro = CASE WHEN v_monto_pagado >= (v_total - v_ret) THEN NEW.fecha ELSE NULL END,
      banco_cuenta_id = CASE WHEN v_monto_pagado >= (v_total - v_ret) THEN NEW.cuenta_id ELSE NULL END
    WHERE id = NEW.factura_id;

  ELSIF NEW.compra_id IS NOT NULL THEN
    SELECT c.concepto, pr.nombre INTO v_concepto, v_prov
      FROM public.compras c
      LEFT JOIN public.proveedores pr ON pr.id = c.proveedor_id
     WHERE c.id = NEW.compra_id;
    IF NEW.anticipo_id IS NULL AND NEW.lote_id IS NULL AND NEW.credito_compra_id IS NULL THEN
      INSERT INTO public.banco_movimientos (cuenta_id, compra_id, pago_id, tipo, concepto, monto, fecha, referencia)
      VALUES (NEW.cuenta_id, NEW.compra_id, NEW.id, 'egreso',
        'Pago compra ' || COALESCE(v_prov,'') || ': ' || COALESCE(v_concepto,'sin concepto') || COALESCE(' - ' || NEW.referencia,''), NEW.monto, NEW.fecha, NEW.referencia);
    END IF;
    v_monto_pagado := public.monto_pagado_compra(NEW.compra_id);
    UPDATE public.compras SET monto_pagado = v_monto_pagado,
      estado = CASE WHEN v_monto_pagado >= total THEN 'pagada' ELSE 'pendiente' END,
      fecha_pago = CASE WHEN v_monto_pagado >= total THEN NEW.fecha ELSE NULL END,
      banco_cuenta_id = CASE WHEN v_monto_pagado >= total THEN NEW.cuenta_id ELSE NULL END
    WHERE id = NEW.compra_id;

  ELSIF NEW.presupuesto_id IS NOT NULL THEN
    SELECT numero_presupuesto::text INTO v_concepto FROM public.presupuestos WHERE id = NEW.presupuesto_id;
    IF NEW.anticipo_id IS NULL AND NEW.lote_id IS NULL THEN
      INSERT INTO public.banco_movimientos (cuenta_id, presupuesto_id, pago_id, tipo, concepto, monto, fecha, referencia)
      VALUES (NEW.cuenta_id, NEW.presupuesto_id, NEW.id, 'ingreso',
        'Cobro presupuesto #' || COALESCE(v_concepto,'') || COALESCE(' - ' || NEW.referencia,''), NEW.monto, NEW.fecha, NEW.referencia);
    END IF;
    v_monto_pagado := public.monto_pagado_presupuesto(NEW.presupuesto_id);
    UPDATE public.presupuestos SET monto_pagado = v_monto_pagado,
      estado = CASE WHEN v_monto_pagado >= total THEN 'pagada' ELSE 'pendiente' END,
      fecha_cobro = CASE WHEN v_monto_pagado >= total THEN NEW.fecha ELSE NULL END,
      banco_cuenta_id = CASE WHEN v_monto_pagado >= total THEN NEW.cuenta_id ELSE NULL END
    WHERE id = NEW.presupuesto_id;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── 1c. _reversar_pago_core: reverso de crédito de compra sin banco + restaura NC
CREATE OR REPLACE FUNCTION public._reversar_pago_core(p_pago_id uuid, p_motivo text, p_fecha date)
 RETURNS pago_reversos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app_private', 'pg_temp'
AS $function$
DECLARE v_pago public.pagos%ROWTYPE; v_rev public.pago_reversos%ROWTYPE; v_mov uuid; v_pagado numeric; v_lim date; v_prov text;
BEGIN
  IF p_motivo IS NULL OR length(trim(p_motivo)) < 3 THEN
    RAISE EXCEPTION 'Debe indicar un motivo de reverso.';
  END IF;
  SELECT * INTO v_pago FROM public.pagos WHERE id = p_pago_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'El pago no existe.'; END IF;
  IF EXISTS (SELECT 1 FROM public.pago_reversos WHERE pago_id = p_pago_id) THEN
    RAISE EXCEPTION 'El pago ya fue reversado.';
  END IF;

  v_lim := public.fecha_cierre_bloqueo(v_pago.cuenta_id);
  IF v_lim IS NOT NULL AND v_pago.fecha <= v_lim THEN
    RAISE EXCEPTION 'No se puede reversar/editar: el cobro del % pertenece a un periodo cerrado (cierre hasta %).',
      v_pago.fecha, v_lim USING errcode = 'P0001';
  END IF;

  IF v_pago.factura_id IS NOT NULL THEN
    INSERT INTO public.pago_reversos (pago_id, factura_id, cuenta_id, monto, fecha, motivo, created_by)
    VALUES (v_pago.id, v_pago.factura_id, v_pago.cuenta_id, v_pago.monto, COALESCE(p_fecha,CURRENT_DATE), trim(p_motivo), auth.uid())
    RETURNING * INTO v_rev;
    IF v_pago.anticipo_id IS NULL AND v_pago.nota_credito_id IS NULL AND v_pago.credito_factura_id IS NULL THEN
      INSERT INTO public.banco_movimientos (cuenta_id, factura_id, pago_reverso_id, tipo, concepto, monto, fecha, referencia)
      VALUES (v_pago.cuenta_id, v_pago.factura_id, v_rev.id, 'egreso', 'Reverso cobro factura - '||trim(p_motivo), v_pago.monto, COALESCE(p_fecha,CURRENT_DATE), v_pago.referencia)
      RETURNING id INTO v_mov;
    END IF;
    v_pagado := public.monto_pagado_factura(v_pago.factura_id);
    UPDATE public.facturas SET monto_pagado = v_pagado,
      estado = CASE WHEN v_pagado >= total THEN 'pagada' ELSE 'pendiente' END,
      fecha_cobro = CASE WHEN v_pagado >= total THEN fecha_cobro ELSE NULL END,
      banco_cuenta_id = CASE WHEN v_pagado >= total THEN banco_cuenta_id ELSE NULL END
    WHERE id = v_pago.factura_id;

  ELSIF v_pago.compra_id IS NOT NULL THEN
    SELECT pr.nombre INTO v_prov
      FROM public.compras c
      LEFT JOIN public.proveedores pr ON pr.id = c.proveedor_id
     WHERE c.id = v_pago.compra_id;
    INSERT INTO public.pago_reversos (pago_id, compra_id, cuenta_id, monto, fecha, motivo, created_by)
    VALUES (v_pago.id, v_pago.compra_id, v_pago.cuenta_id, v_pago.monto, COALESCE(p_fecha,CURRENT_DATE), trim(p_motivo), auth.uid())
    RETURNING * INTO v_rev;
    IF v_pago.anticipo_id IS NULL AND v_pago.credito_compra_id IS NULL THEN
      INSERT INTO public.banco_movimientos (cuenta_id, compra_id, pago_reverso_id, tipo, concepto, monto, fecha, referencia)
      VALUES (v_pago.cuenta_id, v_pago.compra_id, v_rev.id, 'ingreso',
        'Reverso pago compra' || COALESCE(' '||v_prov,'') || ' - ' || trim(p_motivo),
        v_pago.monto, COALESCE(p_fecha,CURRENT_DATE), v_pago.referencia)
      RETURNING id INTO v_mov;
    END IF;
    v_pagado := public.monto_pagado_compra(v_pago.compra_id);
    UPDATE public.compras SET monto_pagado = v_pagado,
      estado = CASE WHEN v_pagado >= total THEN 'pagada' ELSE 'pendiente' END,
      fecha_pago = CASE WHEN v_pagado >= total THEN fecha_pago ELSE NULL END,
      banco_cuenta_id = CASE WHEN v_pagado >= total THEN banco_cuenta_id ELSE NULL END
    WHERE id = v_pago.compra_id;

  ELSIF v_pago.presupuesto_id IS NOT NULL THEN
    INSERT INTO public.pago_reversos (pago_id, presupuesto_id, cuenta_id, monto, fecha, motivo, created_by)
    VALUES (v_pago.id, v_pago.presupuesto_id, v_pago.cuenta_id, v_pago.monto, COALESCE(p_fecha,CURRENT_DATE), trim(p_motivo), auth.uid())
    RETURNING * INTO v_rev;
    IF v_pago.anticipo_id IS NULL THEN
      INSERT INTO public.banco_movimientos (cuenta_id, presupuesto_id, pago_reverso_id, tipo, concepto, monto, fecha, referencia)
      VALUES (v_pago.cuenta_id, v_pago.presupuesto_id, v_rev.id, 'egreso', 'Reverso cobro presupuesto - '||trim(p_motivo), v_pago.monto, COALESCE(p_fecha,CURRENT_DATE), v_pago.referencia)
      RETURNING id INTO v_mov;
    END IF;
    v_pagado := public.monto_pagado_presupuesto(v_pago.presupuesto_id);
    UPDATE public.presupuestos SET monto_pagado = v_pagado,
      estado = CASE WHEN v_pagado >= total THEN 'pagada' ELSE 'pendiente' END,
      fecha_cobro = CASE WHEN v_pagado >= total THEN fecha_cobro ELSE NULL END,
      banco_cuenta_id = CASE WHEN v_pagado >= total THEN banco_cuenta_id ELSE NULL END
    WHERE id = v_pago.presupuesto_id;
  END IF;

  -- Restaurar el crédito consumido para que vuelva a estar disponible
  IF v_pago.nota_credito_id IS NOT NULL THEN
    UPDATE public.notas_credito SET estado='disponible', factura_aplicada_id=NULL, pago_id=NULL WHERE id=v_pago.nota_credito_id;
  END IF;
  IF v_pago.credito_factura_id IS NOT NULL THEN
    UPDATE public.facturas SET factura_aplicada_id=NULL WHERE id=v_pago.credito_factura_id;
  END IF;
  IF v_pago.credito_compra_id IS NOT NULL THEN
    UPDATE public.compras
       SET compra_aplicada_id = NULL, estado = 'pendiente', fecha_pago = NULL, banco_cuenta_id = NULL
     WHERE id = v_pago.credito_compra_id;
  END IF;

  IF v_mov IS NOT NULL THEN
    UPDATE public.pago_reversos SET banco_movimiento_id = v_mov WHERE id = v_rev.id RETURNING * INTO v_rev;
  END IF;
  RETURN v_rev;
END;
$function$;

-- ── 1d. RPC aplicar_nc_compra: NC de compra como pago (uso único, sin banco) ─
CREATE OR REPLACE FUNCTION public.aplicar_nc_compra(p_nc_id uuid, p_compra_id uuid, p_fecha date DEFAULT CURRENT_DATE)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app_private', 'pg_temp'
AS $function$
DECLARE
  v_nc public.compras%ROWTYPE; v_c public.compras%ROWTYPE;
  v_monto numeric; v_saldo numeric; v_pago_id uuid; v_ref text;
BEGIN
  IF NOT app_private.has_module_permission('compras','editar') THEN
    RAISE EXCEPTION 'No tienes permiso para aplicar notas de crédito de compras.';
  END IF;

  SELECT * INTO v_nc FROM public.compras WHERE id = p_nc_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La nota de crédito no existe.'; END IF;
  IF COALESCE(v_nc.total,0) >= 0 OR upper(COALESCE(v_nc.tipo_documento,'')) NOT LIKE '%CREDITO%' THEN
    RAISE EXCEPTION 'El documento seleccionado no es una nota de crédito.';
  END IF;
  IF v_nc.compra_aplicada_id IS NOT NULL THEN
    RAISE EXCEPTION 'La nota de crédito ya fue aplicada.';
  END IF;
  v_monto := abs(v_nc.total);
  IF v_monto <= 0 THEN RAISE EXCEPTION 'La nota de crédito no tiene monto.'; END IF;

  SELECT * INTO v_c FROM public.compras WHERE id = p_compra_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La compra no existe.'; END IF;
  IF v_c.proveedor_id <> v_nc.proveedor_id THEN
    RAISE EXCEPTION 'La nota de crédito es de otro proveedor.';
  END IF;
  IF COALESCE(v_c.total,0) <= 0 THEN
    RAISE EXCEPTION 'El documento destino no es una compra pagable.';
  END IF;

  v_saldo := v_c.total - public.monto_pagado_compra(p_compra_id);
  IF v_monto > v_saldo + 0.001 THEN
    RAISE EXCEPTION 'La nota de crédito (%) excede el saldo de la compra (%).', v_monto, round(v_saldo,2);
  END IF;

  v_ref := trim('NC ' || COALESCE(v_nc.referencia, COALESCE(v_nc.documento_afectado, '')));

  INSERT INTO public.pagos (compra_id, cuenta_id, monto, fecha, referencia, credito_compra_id)
  VALUES (p_compra_id, NULL, v_monto, COALESCE(p_fecha,CURRENT_DATE), v_ref, p_nc_id)
  RETURNING id INTO v_pago_id;

  UPDATE public.compras
     SET compra_aplicada_id = p_compra_id,
         estado = 'pagada',
         fecha_pago = COALESCE(p_fecha,CURRENT_DATE)
   WHERE id = p_nc_id;

  RETURN v_pago_id;
END;
$function$;

-- ── 1e. eliminar_compra: proteger NC aplicadas y liberar NC al borrar destino ─
CREATE OR REPLACE FUNCTION public.eliminar_compra(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app_private', 'pg_temp'
AS $function$
DECLARE v_bloq int;
BEGIN
  IF NOT public._es_admin() THEN RAISE EXCEPTION 'Solo un administrador puede borrar compras.'; END IF;
  IF EXISTS (SELECT 1 FROM public.pagos WHERE compra_id = p_id AND lote_id IS NOT NULL) THEN
    RAISE EXCEPTION 'La compra tiene pagos de un lote (pago múltiple) y no se puede borrar: el egreso consolidado del lote quedaría descuadrado. Reversa sus pagos en su lugar.' USING errcode='P0001';
  END IF;
  -- Una NC aplicada no se borra: primero hay que reversar el pago que generó
  IF EXISTS (
    SELECT 1 FROM public.pagos p
    WHERE p.credito_compra_id = p_id
      AND NOT EXISTS (SELECT 1 FROM public.pago_reversos r WHERE r.pago_id = p.id)
  ) THEN
    RAISE EXCEPTION 'Esta nota de crédito está aplicada a una compra. Reversa ese pago antes de borrarla.' USING errcode='P0001';
  END IF;
  SELECT count(*) INTO v_bloq FROM public.banco_movimientos b
  WHERE b.compra_id = p_id AND public.fecha_cierre_bloqueo(b.cuenta_id) IS NOT NULL
    AND b.fecha <= public.fecha_cierre_bloqueo(b.cuenta_id);
  IF v_bloq > 0 THEN RAISE EXCEPTION 'No se puede borrar: la compra tiene movimientos en un periodo cerrado.' USING errcode='P0001'; END IF;
  PERFORM set_config('app.allow_pago_mutation','on', true);
  -- Si a esta compra se le aplicaron NC, liberarlas (vuelven a quedar disponibles)
  UPDATE public.compras
     SET compra_aplicada_id = NULL, estado = 'pendiente', fecha_pago = NULL, banco_cuenta_id = NULL
   WHERE compra_aplicada_id = p_id;
  UPDATE public.pago_reversos SET banco_movimiento_id = NULL
  WHERE compra_id = p_id OR pago_id IN (SELECT id FROM public.pagos WHERE compra_id = p_id);
  DELETE FROM public.banco_movimientos WHERE compra_id = p_id;
  DELETE FROM public.pago_reversos WHERE compra_id = p_id OR pago_id IN (SELECT id FROM public.pagos WHERE compra_id = p_id);
  DELETE FROM public.pagos WHERE compra_id = p_id;
  DELETE FROM public.compras WHERE id = p_id;
END; $function$;

-- ── 2. RPC auto_aplicar_ncs_disponibles: aplica NC de ventas a su factura ────
CREATE OR REPLACE FUNCTION public.auto_aplicar_ncs_disponibles()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app_private', 'pg_temp'
AS $function$
DECLARE
  v_nc record; v_f public.facturas%ROWTYPE;
  v_saldo numeric; v_aplicadas int := 0; v_omitidas int := 0;
BEGIN
  IF NOT app_private.has_module_permission('facturas','editar') THEN
    RAISE EXCEPTION 'No tienes permiso para aplicar notas de crédito.';
  END IF;

  FOR v_nc IN
    SELECT * FROM public.notas_credito
    WHERE estado = 'disponible' AND documento_afectado IS NOT NULL
    ORDER BY fecha, created_at
  LOOP
    SELECT f.* INTO v_f FROM public.facturas f
     WHERE f.numero_factura = v_nc.documento_afectado
       AND f.cliente_id = v_nc.cliente_id
       AND COALESCE(f.total,0) > 0
     ORDER BY f.fecha
     LIMIT 1;
    IF NOT FOUND THEN v_omitidas := v_omitidas + 1; CONTINUE; END IF;

    v_saldo := (v_f.total - round(COALESCE(v_f.retencion_pct,0)/100.0*COALESCE(v_f.itbms,0),2))
               - public.monto_pagado_factura(v_f.id);
    IF COALESCE(v_nc.total,0) <= 0 OR v_nc.total > v_saldo + 0.001 THEN
      v_omitidas := v_omitidas + 1; CONTINUE;
    END IF;

    PERFORM public.aplicar_nota_credito(v_nc.id, v_f.id, v_nc.fecha);
    v_aplicadas := v_aplicadas + 1;
  END LOOP;

  RETURN jsonb_build_object('aplicadas', v_aplicadas, 'omitidas', v_omitidas);
END;
$function$;

-- ── 3. registrar_cobro_lote con anticipos ────────────────────────────────────
-- Se DROPea la firma anterior para no dejar una sobrecarga ambigua.
DROP FUNCTION IF EXISTS public.registrar_cobro_lote(uuid, date, uuid, text, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.registrar_cobro_lote(
  p_cliente_id uuid, p_fecha date, p_cuenta_id uuid, p_referencia text,
  p_pagos jsonb, p_ncs jsonb DEFAULT '[]'::jsonb, p_anticipos jsonb DEFAULT '[]'::jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app_private', 'pg_temp'
AS $function$
DECLARE
  v_item jsonb; v_f public.facturas%ROWTYPE; v_ant public.anticipos%ROWTYPE;
  v_total_efectivo numeric := 0; v_total_credito numeric := 0; v_total_anticipo numeric := 0;
  v_lote public.cobro_lotes%ROWTYPE;
  v_saldo numeric; v_monto numeric; v_nc_total numeric; v_ant_saldo numeric;
  v_num int := 0; v_pagadas int := 0; v_abonadas int := 0;
  v_lim date; v_cliente text; v_ref text;
  v_fids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF NOT app_private.has_module_permission('facturas','editar') THEN
    RAISE EXCEPTION 'No tienes permiso para registrar cobros.';
  END IF;

  SELECT nombre INTO v_cliente FROM public.clientes WHERE id = p_cliente_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'El cliente no existe.'; END IF;

  v_ref := nullif(trim(coalesce(p_referencia,'')),'');

  SELECT COALESCE(sum((x->>'monto')::numeric),0) INTO v_total_efectivo
  FROM jsonb_array_elements(COALESCE(p_pagos,'[]'::jsonb)) x
  WHERE COALESCE((x->>'monto')::numeric,0) > 0;

  IF v_total_efectivo <= 0
     AND jsonb_array_length(COALESCE(p_ncs,'[]'::jsonb)) = 0
     AND jsonb_array_length(COALESCE(p_anticipos,'[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'No hay nada que cobrar: selecciona al menos una factura con monto, una nota de crédito o un anticipo.';
  END IF;

  IF v_total_efectivo > 0 THEN
    IF p_cuenta_id IS NULL THEN RAISE EXCEPTION 'Selecciona la cuenta bancaria del depósito.'; END IF;
    v_lim := public.fecha_cierre_bloqueo(p_cuenta_id);
    IF v_lim IS NOT NULL AND COALESCE(p_fecha,CURRENT_DATE) <= v_lim THEN
      RAISE EXCEPTION 'No se puede cobrar con fecha %: el periodo está cerrado (cierre hasta %).',
        COALESCE(p_fecha,CURRENT_DATE), v_lim USING errcode='P0001';
    END IF;
  END IF;

  INSERT INTO public.cobro_lotes (cliente_id, cuenta_id, fecha, referencia)
  VALUES (p_cliente_id,
          CASE WHEN v_total_efectivo > 0 THEN p_cuenta_id ELSE NULL END,
          COALESCE(p_fecha,CURRENT_DATE), v_ref)
  RETURNING * INTO v_lote;

  -- 1) Notas de crédito (monto completo, sin banco)
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_ncs,'[]'::jsonb)) LOOP
    SELECT total INTO v_nc_total FROM public.notas_credito WHERE id = (v_item->>'nota_credito_id')::uuid;
    PERFORM public.aplicar_nota_credito(
      (v_item->>'nota_credito_id')::uuid,
      (v_item->>'factura_id')::uuid,
      COALESCE(p_fecha,CURRENT_DATE),
      v_lote.id
    );
    v_total_credito := v_total_credito + COALESCE(v_nc_total,0);
    v_fids := array_append(v_fids, (v_item->>'factura_id')::uuid);
  END LOOP;

  -- 2) Anticipos del cliente (monto parcial permitido, sin banco)
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_anticipos,'[]'::jsonb)) LOOP
    v_monto := (v_item->>'monto')::numeric;
    IF v_monto IS NULL OR v_monto <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_ant FROM public.anticipos WHERE id = (v_item->>'anticipo_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Uno de los anticipos seleccionados no existe.'; END IF;
    IF v_ant.cliente_id <> p_cliente_id THEN
      RAISE EXCEPTION 'El anticipo REC-% es de otro cliente.', v_ant.numero_recibo;
    END IF;
    IF v_ant.estado <> 'activo' THEN
      RAISE EXCEPTION 'El anticipo REC-% no está activo.', v_ant.numero_recibo;
    END IF;
    SELECT v_ant.monto - COALESCE(sum(p.monto),0) INTO v_ant_saldo
      FROM public.pagos p WHERE p.anticipo_id = v_ant.id;
    IF v_monto > v_ant_saldo + 0.01 THEN
      RAISE EXCEPTION 'El monto % del anticipo REC-% excede su saldo (%).',
        v_monto, v_ant.numero_recibo, round(v_ant_saldo,2);
    END IF;

    SELECT * INTO v_f FROM public.facturas WHERE id = (v_item->>'factura_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Una de las facturas seleccionadas no existe.'; END IF;
    IF v_f.cliente_id <> p_cliente_id THEN
      RAISE EXCEPTION 'La factura #% es de otro cliente.', v_f.numero_factura;
    END IF;
    IF COALESCE(v_f.total,0) <= 0 THEN
      RAISE EXCEPTION 'La factura #% no es cobrable.', v_f.numero_factura;
    END IF;
    v_saldo := (v_f.total - COALESCE(v_f.retencion_monto,0)) - public.monto_pagado_factura(v_f.id);
    IF v_monto > v_saldo + 0.01 THEN
      RAISE EXCEPTION 'El anticipo aplicado (%) a la factura #% excede su saldo (%).',
        v_monto, v_f.numero_factura, round(v_saldo,2);
    END IF;

    INSERT INTO public.pagos (factura_id, cuenta_id, monto, fecha, referencia, anticipo_id, lote_id)
    VALUES (v_f.id, v_ant.cuenta_id, v_monto, COALESCE(p_fecha,CURRENT_DATE),
            'Aplicación de anticipo REC-' || lpad(v_ant.numero_recibo::text, 5, '0'),
            v_ant.id, v_lote.id);

    v_total_anticipo := v_total_anticipo + v_monto;
    v_fids := array_append(v_fids, v_f.id);
  END LOOP;

  -- 3) Pagos en efectivo (un solo movimiento de banco consolidado)
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_pagos,'[]'::jsonb)) LOOP
    v_monto := (v_item->>'monto')::numeric;
    IF v_monto IS NULL OR v_monto <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_f FROM public.facturas WHERE id = (v_item->>'factura_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Una de las facturas seleccionadas no existe.'; END IF;
    IF v_f.cliente_id <> p_cliente_id THEN
      RAISE EXCEPTION 'La factura #% es de otro cliente.', v_f.numero_factura;
    END IF;
    IF COALESCE(v_f.total,0) <= 0 THEN
      RAISE EXCEPTION 'La factura #% no es cobrable.', v_f.numero_factura;
    END IF;

    v_saldo := (v_f.total - COALESCE(v_f.retencion_monto,0)) - public.monto_pagado_factura(v_f.id);
    IF v_monto > v_saldo + 0.01 THEN
      RAISE EXCEPTION 'El monto % de la factura #% excede su saldo (%).',
        v_monto, v_f.numero_factura, round(v_saldo,2);
    END IF;

    INSERT INTO public.pagos (factura_id, cuenta_id, monto, fecha, referencia, lote_id)
    VALUES (v_f.id, p_cuenta_id, v_monto, COALESCE(p_fecha,CURRENT_DATE), v_ref, v_lote.id);

    v_num := v_num + 1;
    v_fids := array_append(v_fids, v_f.id);
  END LOOP;

  IF v_total_efectivo > 0 THEN
    INSERT INTO public.banco_movimientos (cuenta_id, tipo, concepto, monto, fecha, referencia, lote_id)
    VALUES (p_cuenta_id, 'ingreso',
      'Cobro múltiple ' || COALESCE(v_cliente,'') || ' (' || v_num || ' factura' || CASE WHEN v_num=1 THEN '' ELSE 's' END || ')'
        || COALESCE(' - ' || v_ref, ''),
      v_total_efectivo, COALESCE(p_fecha,CURRENT_DATE), v_ref, v_lote.id);
  END IF;

  -- Resumen pagadas/abonadas sobre las facturas tocadas (sin duplicar)
  SELECT COALESCE(count(*) FILTER (WHERE f.estado = 'pagada'),0),
         COALESCE(count(*) FILTER (WHERE f.estado <> 'pagada'),0)
    INTO v_pagadas, v_abonadas
    FROM (SELECT DISTINCT unnest(v_fids) AS id) t
    JOIN public.facturas f ON f.id = t.id;

  UPDATE public.cobro_lotes
     SET monto_efectivo = v_total_efectivo, monto_credito = v_total_credito,
         monto_anticipo = v_total_anticipo, num_facturas = v_num
   WHERE id = v_lote.id;

  RETURN jsonb_build_object(
    'lote_id', v_lote.id,
    'total_efectivo', v_total_efectivo,
    'total_credito', v_total_credito,
    'total_anticipo', v_total_anticipo,
    'facturas_efectivo', v_num,
    'pagadas_completas', v_pagadas,
    'abonadas', v_abonadas,
    'ncs_aplicadas', jsonb_array_length(COALESCE(p_ncs,'[]'::jsonb))
  );
END;
$function$;
