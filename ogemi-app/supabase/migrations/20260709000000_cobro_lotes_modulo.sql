-- ============================================================================
-- Módulo de cobro múltiple (lotes de cobro)
-- Un lote = un cobro a UN cliente sobre VARIAS facturas seleccionadas.
-- Cada factura recibe su pago individual (completo o abono), pero el banco
-- registra UN SOLO movimiento de ingreso por el total en efectivo del lote.
-- Las notas de crédito disponibles del cliente también pueden aplicarse
-- dentro del lote (no tocan banco, como siempre).
-- ============================================================================

-- 1) Tabla de lotes de cobro
create table if not exists public.cobro_lotes (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid not null references public.clientes(id),
  cuenta_id       uuid references public.banco_cuentas(id),
  fecha           date not null default current_date,
  referencia      text,
  monto_efectivo  numeric not null default 0,
  monto_credito   numeric not null default 0,
  num_facturas    int not null default 0,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now()
);

alter table public.cobro_lotes enable row level security;

drop policy if exists ver_cobro_lotes on public.cobro_lotes;
create policy ver_cobro_lotes on public.cobro_lotes
  for select to authenticated
  using (app_private.has_module_permission('facturas'::text, 'ver'::text)
      or app_private.has_module_permission('banco'::text, 'ver'::text)
      or app_private.has_module_permission('reportes'::text, 'ver'::text));

-- 2) Vínculo lote → pagos y lote → movimiento consolidado de banco
alter table public.pagos             add column if not exists lote_id uuid references public.cobro_lotes(id);
alter table public.banco_movimientos add column if not exists lote_id uuid references public.cobro_lotes(id);
create index if not exists idx_pagos_lote on public.pagos(lote_id) where lote_id is not null;
create index if not exists idx_banco_mov_lote on public.banco_movimientos(lote_id) where lote_id is not null;

-- 3) procesar_pago: NO generar movimiento individual de banco cuando el pago
--    pertenece a un lote (el lote inserta un único movimiento consolidado).
--    (Solo cambia la rama de facturas: los lotes son de cobro de facturas.)
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
    IF NEW.anticipo_id IS NULL THEN
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
    IF NEW.anticipo_id IS NULL THEN
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

-- 4) aplicar_nota_credito: parámetro opcional p_lote_id para vincular el pago
--    de la NC al lote. Se elimina la firma vieja para evitar sobrecarga ambigua.
drop function if exists public.aplicar_nota_credito(uuid, uuid, date);

create or replace function public.aplicar_nota_credito(
  p_nota_id uuid, p_factura_id uuid, p_fecha date default current_date, p_lote_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
DECLARE v_nc public.notas_credito%ROWTYPE; v_f public.facturas%ROWTYPE; v_saldo numeric; v_ret numeric; v_pago_id uuid;
BEGIN
  SELECT * INTO v_nc FROM public.notas_credito WHERE id=p_nota_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La nota de crédito no existe.'; END IF;
  IF v_nc.estado <> 'disponible' THEN RAISE EXCEPTION 'La nota de crédito ya fue aplicada.'; END IF;
  IF COALESCE(v_nc.total,0) <= 0 THEN RAISE EXCEPTION 'La nota de crédito no tiene monto.'; END IF;

  SELECT * INTO v_f FROM public.facturas WHERE id=p_factura_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'La factura no existe.'; END IF;
  IF v_f.cliente_id <> v_nc.cliente_id THEN RAISE EXCEPTION 'La nota de crédito es de otro cliente.'; END IF;

  v_ret := round(COALESCE(v_f.retencion_pct,0)/100.0*COALESCE(v_f.itbms,0),2);
  v_saldo := (v_f.total - v_ret) - public.monto_pagado_factura(p_factura_id);
  IF v_nc.total > v_saldo + 0.001 THEN
    RAISE EXCEPTION 'La nota de crédito (%) excede el saldo de la factura (%).', v_nc.total, round(v_saldo,2);
  END IF;

  INSERT INTO public.pagos (factura_id, cuenta_id, monto, fecha, referencia, nota_credito_id, lote_id)
  VALUES (p_factura_id, NULL, v_nc.total, COALESCE(p_fecha,CURRENT_DATE), 'NC '||COALESCE(v_nc.numero,''), p_nota_id, p_lote_id)
  RETURNING id INTO v_pago_id;

  UPDATE public.notas_credito SET estado='aplicada', factura_aplicada_id=p_factura_id, pago_id=v_pago_id WHERE id=p_nota_id;
  RETURN v_pago_id;
END;
$function$;

-- 5) RPC principal: registrar un lote de cobro
--    p_pagos: [{"factura_id": uuid, "monto": numeric}, ...]  (efectivo por factura)
--    p_ncs:   [{"nota_credito_id": uuid, "factura_id": uuid}, ...] (NC → factura)
create or replace function public.registrar_cobro_lote(
  p_cliente_id uuid,
  p_fecha date,
  p_cuenta_id uuid,
  p_referencia text,
  p_pagos jsonb,
  p_ncs jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'app_private', 'pg_temp'
as $function$
DECLARE
  v_item jsonb; v_f public.facturas%ROWTYPE;
  v_total_efectivo numeric := 0; v_total_credito numeric := 0;
  v_lote public.cobro_lotes%ROWTYPE;
  v_saldo numeric; v_monto numeric; v_nc_total numeric;
  v_num int := 0; v_pagadas int := 0; v_abonadas int := 0;
  v_lim date; v_cliente text; v_ref text;
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

  IF v_total_efectivo <= 0 AND jsonb_array_length(COALESCE(p_ncs,'[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'No hay nada que cobrar: selecciona al menos una factura con monto o una nota de crédito.';
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

  -- 1) Notas de crédito primero (validan cliente, saldo y uso único)
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_ncs,'[]'::jsonb)) LOOP
    SELECT total INTO v_nc_total FROM public.notas_credito WHERE id = (v_item->>'nota_credito_id')::uuid;
    PERFORM public.aplicar_nota_credito(
      (v_item->>'nota_credito_id')::uuid,
      (v_item->>'factura_id')::uuid,
      COALESCE(p_fecha,CURRENT_DATE),
      v_lote.id
    );
    v_total_credito := v_total_credito + COALESCE(v_nc_total,0);
  END LOOP;

  -- 2) Pagos en efectivo por factura (completo o abono), validando saldo
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
    IF v_monto >= v_saldo - 0.01 THEN v_pagadas := v_pagadas + 1; ELSE v_abonadas := v_abonadas + 1; END IF;
  END LOOP;

  -- 3) UN solo movimiento de banco por el total en efectivo del lote
  IF v_total_efectivo > 0 THEN
    INSERT INTO public.banco_movimientos (cuenta_id, tipo, concepto, monto, fecha, referencia, lote_id)
    VALUES (p_cuenta_id, 'ingreso',
      'Cobro múltiple ' || COALESCE(v_cliente,'') || ' (' || v_num || ' factura' || CASE WHEN v_num=1 THEN '' ELSE 's' END || ')'
        || COALESCE(' - ' || v_ref, ''),
      v_total_efectivo, COALESCE(p_fecha,CURRENT_DATE), v_ref, v_lote.id);
  END IF;

  UPDATE public.cobro_lotes
     SET monto_efectivo = v_total_efectivo, monto_credito = v_total_credito, num_facturas = v_num
   WHERE id = v_lote.id;

  RETURN jsonb_build_object(
    'lote_id', v_lote.id,
    'total_efectivo', v_total_efectivo,
    'total_credito', v_total_credito,
    'facturas_efectivo', v_num,
    'pagadas_completas', v_pagadas,
    'abonadas', v_abonadas,
    'ncs_aplicadas', jsonb_array_length(COALESCE(p_ncs,'[]'::jsonb))
  );
END;
$function$;

grant execute on function public.registrar_cobro_lote(uuid,date,uuid,text,jsonb,jsonb) to authenticated;

-- 6) Guarda en eliminar_factura: una factura con cobros de lote no se puede
--    borrar (el ingreso consolidado del lote no se puede descomponer).
--    El camino correcto es reversar sus pagos (genera contra-movimiento parcial).
create or replace function public.eliminar_factura(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'app_private', 'pg_temp'
as $function$
DECLARE v_bloq int;
BEGIN
  IF NOT public._es_admin() THEN RAISE EXCEPTION 'Solo un administrador puede borrar facturas.'; END IF;
  IF EXISTS (SELECT 1 FROM public.pagos WHERE factura_id = p_id AND lote_id IS NOT NULL) THEN
    RAISE EXCEPTION 'La factura tiene cobros de un lote (cobro múltiple) y no se puede borrar: el ingreso consolidado del lote quedaría descuadrado. Reversa sus cobros en su lugar.' USING errcode='P0001';
  END IF;
  SELECT count(*) INTO v_bloq FROM public.banco_movimientos b
  WHERE b.factura_id = p_id AND public.fecha_cierre_bloqueo(b.cuenta_id) IS NOT NULL
    AND b.fecha <= public.fecha_cierre_bloqueo(b.cuenta_id);
  IF v_bloq > 0 THEN RAISE EXCEPTION 'No se puede borrar: la factura tiene movimientos en un periodo cerrado.' USING errcode='P0001'; END IF;
  PERFORM set_config('app.allow_pago_mutation','on', true);
  UPDATE public.pago_reversos SET banco_movimiento_id = NULL
  WHERE factura_id = p_id OR pago_id IN (SELECT id FROM public.pagos WHERE factura_id = p_id);
  DELETE FROM public.banco_movimientos WHERE factura_id = p_id;
  DELETE FROM public.pago_reversos WHERE factura_id = p_id OR pago_id IN (SELECT id FROM public.pagos WHERE factura_id = p_id);
  DELETE FROM public.pagos WHERE factura_id = p_id;
  DELETE FROM public.facturas WHERE id = p_id;
END; $function$;
