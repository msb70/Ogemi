-- ============================================================================
-- Lotes de cobro/pago para PRESUPUESTOS (ingreso) y COMPRAS (egreso)
-- Mismo patrón que el módulo de cobro múltiple de facturas:
-- N pagos individuales (completos o abonos) → UN solo movimiento de banco.
-- ============================================================================

-- 1) Generalizar cobro_lotes: tipo de lote y proveedor (para compras)
alter table public.cobro_lotes
  add column if not exists tipo text not null default 'factura',
  add column if not exists proveedor_id uuid references public.proveedores(id);

alter table public.cobro_lotes alter column cliente_id drop not null;

do $$ begin
  alter table public.cobro_lotes
    add constraint cobro_lotes_tipo_check check (tipo in ('factura','presupuesto','compra'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.cobro_lotes
    add constraint cobro_lotes_origen_check check (
      (tipo in ('factura','presupuesto') and cliente_id is not null)
      or (tipo = 'compra' and proveedor_id is not null)
    );
exception when duplicate_object then null; end $$;

-- Permisos de lectura: incluir compras y presupuestos
drop policy if exists ver_cobro_lotes on public.cobro_lotes;
create policy ver_cobro_lotes on public.cobro_lotes
  for select to authenticated
  using (app_private.has_module_permission('facturas'::text, 'ver'::text)
      or app_private.has_module_permission('presupuestos'::text, 'ver'::text)
      or app_private.has_module_permission('compras'::text, 'ver'::text)
      or app_private.has_module_permission('banco'::text, 'ver'::text)
      or app_private.has_module_permission('reportes'::text, 'ver'::text));

-- 2) procesar_pago: saltar el movimiento individual de banco también en las
--    ramas de compras y presupuestos cuando el pago pertenece a un lote.
create or replace function public.procesar_pago()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_monto_pagado numeric; v_concepto text;
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
    SELECT concepto INTO v_concepto FROM public.compras WHERE id = NEW.compra_id;
    IF NEW.anticipo_id IS NULL AND NEW.lote_id IS NULL THEN
      INSERT INTO public.banco_movimientos (cuenta_id, compra_id, pago_id, tipo, concepto, monto, fecha, referencia)
      VALUES (NEW.cuenta_id, NEW.compra_id, NEW.id, 'egreso',
        'Pago compra: ' || COALESCE(v_concepto,'sin concepto') || COALESCE(' - ' || NEW.referencia,''), NEW.monto, NEW.fecha, NEW.referencia);
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

-- 3) RPC: cobrar un lote de presupuestos (ingreso consolidado)
--    p_pagos: [{"presupuesto_id": uuid, "monto": numeric}, ...]
create or replace function public.registrar_cobro_lote_presupuestos(
  p_cliente_id uuid,
  p_fecha date,
  p_cuenta_id uuid,
  p_referencia text,
  p_pagos jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'app_private', 'pg_temp'
as $function$
DECLARE
  v_item jsonb; v_p public.presupuestos%ROWTYPE;
  v_total numeric := 0; v_lote public.cobro_lotes%ROWTYPE;
  v_saldo numeric; v_monto numeric;
  v_num int := 0; v_pagados int := 0; v_abonados int := 0;
  v_lim date; v_cliente text; v_ref text;
BEGIN
  IF NOT app_private.has_module_permission('presupuestos','editar') THEN
    RAISE EXCEPTION 'No tienes permiso para registrar cobros de presupuestos.';
  END IF;

  SELECT nombre INTO v_cliente FROM public.clientes WHERE id = p_cliente_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'El cliente no existe.'; END IF;
  IF p_cuenta_id IS NULL THEN RAISE EXCEPTION 'Selecciona la cuenta bancaria del depósito.'; END IF;

  v_ref := nullif(trim(coalesce(p_referencia,'')),'');

  SELECT COALESCE(sum((x->>'monto')::numeric),0) INTO v_total
  FROM jsonb_array_elements(COALESCE(p_pagos,'[]'::jsonb)) x
  WHERE COALESCE((x->>'monto')::numeric,0) > 0;
  IF v_total <= 0 THEN RAISE EXCEPTION 'No hay nada que cobrar: selecciona al menos un presupuesto con monto.'; END IF;

  v_lim := public.fecha_cierre_bloqueo(p_cuenta_id);
  IF v_lim IS NOT NULL AND COALESCE(p_fecha,CURRENT_DATE) <= v_lim THEN
    RAISE EXCEPTION 'No se puede cobrar con fecha %: el periodo está cerrado (cierre hasta %).',
      COALESCE(p_fecha,CURRENT_DATE), v_lim USING errcode='P0001';
  END IF;

  INSERT INTO public.cobro_lotes (tipo, cliente_id, cuenta_id, fecha, referencia)
  VALUES ('presupuesto', p_cliente_id, p_cuenta_id, COALESCE(p_fecha,CURRENT_DATE), v_ref)
  RETURNING * INTO v_lote;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_pagos,'[]'::jsonb)) LOOP
    v_monto := (v_item->>'monto')::numeric;
    IF v_monto IS NULL OR v_monto <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_p FROM public.presupuestos WHERE id = (v_item->>'presupuesto_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Uno de los presupuestos seleccionados no existe.'; END IF;
    IF v_p.cliente_id <> p_cliente_id THEN
      RAISE EXCEPTION 'El presupuesto #% es de otro cliente.', v_p.numero_presupuesto;
    END IF;
    IF COALESCE(v_p.total,0) <= 0 THEN
      RAISE EXCEPTION 'El presupuesto #% no es cobrable.', v_p.numero_presupuesto;
    END IF;

    v_saldo := v_p.total - public.monto_pagado_presupuesto(v_p.id);
    IF v_monto > v_saldo + 0.01 THEN
      RAISE EXCEPTION 'El monto % del presupuesto #% excede su saldo (%).',
        v_monto, v_p.numero_presupuesto, round(v_saldo,2);
    END IF;

    INSERT INTO public.pagos (presupuesto_id, cuenta_id, monto, fecha, referencia, lote_id)
    VALUES (v_p.id, p_cuenta_id, v_monto, COALESCE(p_fecha,CURRENT_DATE), v_ref, v_lote.id);

    v_num := v_num + 1;
    IF v_monto >= v_saldo - 0.01 THEN v_pagados := v_pagados + 1; ELSE v_abonados := v_abonados + 1; END IF;
  END LOOP;

  INSERT INTO public.banco_movimientos (cuenta_id, tipo, concepto, monto, fecha, referencia, lote_id)
  VALUES (p_cuenta_id, 'ingreso',
    'Cobro múltiple presupuestos ' || COALESCE(v_cliente,'') || ' (' || v_num || ')'
      || COALESCE(' - ' || v_ref, ''),
    v_total, COALESCE(p_fecha,CURRENT_DATE), v_ref, v_lote.id);

  UPDATE public.cobro_lotes SET monto_efectivo = v_total, num_facturas = v_num WHERE id = v_lote.id;

  RETURN jsonb_build_object(
    'lote_id', v_lote.id, 'total_efectivo', v_total,
    'presupuestos', v_num, 'pagados_completos', v_pagados, 'abonados', v_abonados
  );
END;
$function$;

grant execute on function public.registrar_cobro_lote_presupuestos(uuid,date,uuid,text,jsonb) to authenticated;

-- 4) RPC: pagar un lote de compras (EGRESO consolidado)
--    p_pagos: [{"compra_id": uuid, "monto": numeric}, ...]
create or replace function public.registrar_pago_lote_compras(
  p_proveedor_id uuid,
  p_fecha date,
  p_cuenta_id uuid,
  p_referencia text,
  p_pagos jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'app_private', 'pg_temp'
as $function$
DECLARE
  v_item jsonb; v_c public.compras%ROWTYPE;
  v_total numeric := 0; v_lote public.cobro_lotes%ROWTYPE;
  v_saldo numeric; v_monto numeric;
  v_num int := 0; v_pagadas int := 0; v_abonadas int := 0;
  v_lim date; v_prov text; v_ref text;
BEGIN
  IF NOT app_private.has_module_permission('compras','editar') THEN
    RAISE EXCEPTION 'No tienes permiso para registrar pagos de compras.';
  END IF;

  SELECT nombre INTO v_prov FROM public.proveedores WHERE id = p_proveedor_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'El proveedor no existe.'; END IF;
  IF p_cuenta_id IS NULL THEN RAISE EXCEPTION 'Selecciona la cuenta bancaria del pago.'; END IF;

  v_ref := nullif(trim(coalesce(p_referencia,'')),'');

  SELECT COALESCE(sum((x->>'monto')::numeric),0) INTO v_total
  FROM jsonb_array_elements(COALESCE(p_pagos,'[]'::jsonb)) x
  WHERE COALESCE((x->>'monto')::numeric,0) > 0;
  IF v_total <= 0 THEN RAISE EXCEPTION 'No hay nada que pagar: selecciona al menos una compra con monto.'; END IF;

  v_lim := public.fecha_cierre_bloqueo(p_cuenta_id);
  IF v_lim IS NOT NULL AND COALESCE(p_fecha,CURRENT_DATE) <= v_lim THEN
    RAISE EXCEPTION 'No se puede pagar con fecha %: el periodo está cerrado (cierre hasta %).',
      COALESCE(p_fecha,CURRENT_DATE), v_lim USING errcode='P0001';
  END IF;

  INSERT INTO public.cobro_lotes (tipo, proveedor_id, cuenta_id, fecha, referencia)
  VALUES ('compra', p_proveedor_id, p_cuenta_id, COALESCE(p_fecha,CURRENT_DATE), v_ref)
  RETURNING * INTO v_lote;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_pagos,'[]'::jsonb)) LOOP
    v_monto := (v_item->>'monto')::numeric;
    IF v_monto IS NULL OR v_monto <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_c FROM public.compras WHERE id = (v_item->>'compra_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Una de las compras seleccionadas no existe.'; END IF;
    IF v_c.proveedor_id <> p_proveedor_id THEN
      RAISE EXCEPTION 'La compra "%" es de otro proveedor.', COALESCE(v_c.concepto, v_c.id::text);
    END IF;
    IF COALESCE(v_c.total,0) <= 0 THEN
      RAISE EXCEPTION 'La compra "%" no es pagable.', COALESCE(v_c.concepto, v_c.id::text);
    END IF;

    v_saldo := v_c.total - public.monto_pagado_compra(v_c.id);
    IF v_monto > v_saldo + 0.01 THEN
      RAISE EXCEPTION 'El monto % de la compra "%" excede su saldo (%).',
        v_monto, COALESCE(v_c.concepto, v_c.id::text), round(v_saldo,2);
    END IF;

    INSERT INTO public.pagos (compra_id, cuenta_id, monto, fecha, referencia, lote_id)
    VALUES (v_c.id, p_cuenta_id, v_monto, COALESCE(p_fecha,CURRENT_DATE), v_ref, v_lote.id);

    v_num := v_num + 1;
    IF v_monto >= v_saldo - 0.01 THEN v_pagadas := v_pagadas + 1; ELSE v_abonadas := v_abonadas + 1; END IF;
  END LOOP;

  INSERT INTO public.banco_movimientos (cuenta_id, tipo, concepto, monto, fecha, referencia, lote_id)
  VALUES (p_cuenta_id, 'egreso',
    'Pago múltiple ' || COALESCE(v_prov,'') || ' (' || v_num || ' compra' || CASE WHEN v_num=1 THEN '' ELSE 's' END || ')'
      || COALESCE(' - ' || v_ref, ''),
    v_total, COALESCE(p_fecha,CURRENT_DATE), v_ref, v_lote.id);

  UPDATE public.cobro_lotes SET monto_efectivo = v_total, num_facturas = v_num WHERE id = v_lote.id;

  RETURN jsonb_build_object(
    'lote_id', v_lote.id, 'total_efectivo', v_total,
    'compras', v_num, 'pagadas_completas', v_pagadas, 'abonadas', v_abonadas
  );
END;
$function$;

grant execute on function public.registrar_pago_lote_compras(uuid,date,uuid,text,jsonb) to authenticated;

-- 5) Guardas: presupuestos/compras con pagos de lote no se pueden borrar
--    (el movimiento consolidado no se puede descomponer). El camino es reversar.
create or replace function public.eliminar_presupuesto(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'app_private', 'pg_temp'
as $function$
DECLARE v_bloqueados int;
BEGIN
  IF NOT app_private.has_module_permission('presupuestos', 'borrar') THEN
    RAISE EXCEPTION 'No tienes permiso para borrar presupuestos.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.pagos WHERE presupuesto_id = p_id AND lote_id IS NOT NULL) THEN
    RAISE EXCEPTION 'El presupuesto tiene cobros de un lote (cobro múltiple) y no se puede borrar: el ingreso consolidado del lote quedaría descuadrado. Reversa sus cobros en su lugar.' USING errcode='P0001';
  END IF;

  SELECT count(*) INTO v_bloqueados
  FROM public.banco_movimientos b
  WHERE b.presupuesto_id = p_id
    AND public.fecha_cierre_bloqueo(b.cuenta_id) IS NOT NULL
    AND b.fecha <= public.fecha_cierre_bloqueo(b.cuenta_id);
  IF v_bloqueados > 0 THEN
    RAISE EXCEPTION 'No se puede borrar: el presupuesto tiene movimientos en un periodo cerrado.' USING errcode = 'P0001';
  END IF;

  PERFORM set_config('app.allow_pago_mutation', 'on', true);

  UPDATE public.pago_reversos SET banco_movimiento_id = NULL
  WHERE presupuesto_id = p_id
     OR pago_id IN (SELECT id FROM public.pagos WHERE presupuesto_id = p_id);

  DELETE FROM public.banco_movimientos WHERE presupuesto_id = p_id;
  DELETE FROM public.pago_reversos
  WHERE presupuesto_id = p_id
     OR pago_id IN (SELECT id FROM public.pagos WHERE presupuesto_id = p_id);
  DELETE FROM public.pagos WHERE presupuesto_id = p_id;
  DELETE FROM public.presupuestos WHERE id = p_id;
END;
$function$;

create or replace function public.eliminar_compra(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'app_private', 'pg_temp'
as $function$
DECLARE v_bloq int;
BEGIN
  IF NOT public._es_admin() THEN RAISE EXCEPTION 'Solo un administrador puede borrar compras.'; END IF;
  IF EXISTS (SELECT 1 FROM public.pagos WHERE compra_id = p_id AND lote_id IS NOT NULL) THEN
    RAISE EXCEPTION 'La compra tiene pagos de un lote (pago múltiple) y no se puede borrar: el egreso consolidado del lote quedaría descuadrado. Reversa sus pagos en su lugar.' USING errcode='P0001';
  END IF;
  SELECT count(*) INTO v_bloq FROM public.banco_movimientos b
  WHERE b.compra_id = p_id AND public.fecha_cierre_bloqueo(b.cuenta_id) IS NOT NULL
    AND b.fecha <= public.fecha_cierre_bloqueo(b.cuenta_id);
  IF v_bloq > 0 THEN RAISE EXCEPTION 'No se puede borrar: la compra tiene movimientos en un periodo cerrado.' USING errcode='P0001'; END IF;
  PERFORM set_config('app.allow_pago_mutation','on', true);
  UPDATE public.pago_reversos SET banco_movimiento_id = NULL
  WHERE compra_id = p_id OR pago_id IN (SELECT id FROM public.pagos WHERE compra_id = p_id);
  DELETE FROM public.banco_movimientos WHERE compra_id = p_id;
  DELETE FROM public.pago_reversos WHERE compra_id = p_id OR pago_id IN (SELECT id FROM public.pagos WHERE compra_id = p_id);
  DELETE FROM public.pagos WHERE compra_id = p_id;
  DELETE FROM public.compras WHERE id = p_id;
END; $function$;
