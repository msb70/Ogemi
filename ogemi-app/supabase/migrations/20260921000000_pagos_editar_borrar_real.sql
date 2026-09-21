-- Edición y borrado REAL de cobros/pagos (facturas, compras, presupuestos, ventas Ogemi).
-- Antes: editar = reverso + pago nuevo; "borrar" = reverso (contra-movimiento en banco).
-- Ahora: editar actualiza el pago y su movimiento de banco; borrar elimina ambos.
-- Única condición: que nada de lo tocado caiga en un periodo de banco cerrado.
-- La auditoría se conserva en pagos_auditoria (antes/después, usuario, motivo).

create table if not exists public.pagos_auditoria (
  id uuid primary key default gen_random_uuid(),
  pago_id uuid not null,
  accion text not null check (accion in ('editar','borrar')),
  documento_tipo text not null,
  documento_id uuid,
  antes jsonb not null,
  despues jsonb,
  motivo text,
  usuario_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists pagos_auditoria_pago_idx on public.pagos_auditoria (pago_id);
create index if not exists pagos_auditoria_doc_idx on public.pagos_auditoria (documento_id);
alter table public.pagos_auditoria enable row level security;
drop policy if exists pagos_auditoria_select_admin on public.pagos_auditoria;
create policy pagos_auditoria_select_admin on public.pagos_auditoria
  for select to authenticated using (public._es_admin());
-- Sin policies de escritura: solo escriben las funciones SECURITY DEFINER.

-- ── Helpers ───────────────────────────────────────────────────────────────────
create or replace function public._pago_modulo(p public.pagos) returns text
language sql immutable set search_path to '' as $$
  select case when p.factura_id is not null then 'facturas'
              when p.compra_id is not null then 'compras'
              when p.venta_ogemi_id is not null then 'ventas_ogemi'
              else 'presupuestos' end
$$;

create or replace function public._pago_es_banco(p public.pagos) returns boolean
language sql immutable set search_path to '' as $$
  select p.anticipo_id is null and p.nota_credito_id is null
     and p.credito_factura_id is null and p.credito_compra_id is null
$$;

create or replace function public._check_periodo_abierto(p_cuenta_id uuid, p_fecha date, p_que text) returns void
language plpgsql stable set search_path to 'public','pg_temp' as $$
declare v_lim date;
begin
  if p_cuenta_id is null then return; end if;
  v_lim := public.fecha_cierre_bloqueo(p_cuenta_id);
  if v_lim is not null and p_fecha <= v_lim then
    raise exception 'No se puede %: la fecha % pertenece a un cierre de banco ya hecho (cierre hasta %).',
      p_que, to_char(p_fecha,'DD/MM/YYYY'), to_char(v_lim,'DD/MM/YYYY') using errcode = 'P0001';
  end if;
end $$;

-- Concepto del movimiento de banco, igual que procesar_pago
create or replace function public._pago_concepto(p public.pagos) returns text
language plpgsql stable set search_path to 'public','pg_temp' as $$
declare v_c text; v_n text;
begin
  if p.factura_id is not null then
    select numero_factura::text into v_c from public.facturas where id = p.factura_id;
    return 'Cobro factura #' || coalesce(v_c,'') || coalesce(' - ' || p.referencia,'');
  elsif p.compra_id is not null then
    select c.concepto, pr.nombre into v_c, v_n from public.compras c
      left join public.proveedores pr on pr.id = c.proveedor_id where c.id = p.compra_id;
    return 'Pago compra ' || coalesce(v_n,'') || ': ' || coalesce(v_c,'sin concepto') || coalesce(' - ' || p.referencia,'');
  elsif p.presupuesto_id is not null then
    select numero_presupuesto::text into v_c from public.presupuestos where id = p.presupuesto_id;
    return 'Cobro presupuesto #' || coalesce(v_c,'') || coalesce(' - ' || p.referencia,'');
  else
    select v.numero::text, cl.nombre into v_c, v_n from public.ventas_ogemi v
      left join public.clientes cl on cl.id = v.cliente_id where v.id = p.venta_ogemi_id;
    return 'Cobro venta Ogemi #' || coalesce(v_c,'') || coalesce(' ' || v_n,'') || coalesce(' - ' || p.referencia,'');
  end if;
end $$;

-- Recalcula monto_pagado / estado / fecha y cuenta de cobro del documento
create or replace function public._recalc_documento(p_factura uuid, p_compra uuid, p_presupuesto uuid, p_venta uuid) returns void
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_pag numeric; v_total numeric; v_ret numeric; v_comp boolean; v_f date; v_c uuid;
begin
  if p_factura is not null then
    select total, round(coalesce(retencion_pct,0)/100.0 * coalesce(itbms,0), 2), retencion_comprobante_entregado
      into v_total, v_ret, v_comp from public.facturas where id = p_factura;
    v_pag := public.monto_pagado_factura(p_factura);
    select p.fecha, p.cuenta_id into v_f, v_c from public.pagos p
      where p.factura_id = p_factura and not exists (select 1 from public.pago_reversos r where r.pago_id = p.id)
      order by p.fecha desc, p.created_at desc limit 1;
    update public.facturas set monto_pagado = v_pag,
      estado = public.calc_estado_factura(v_total, v_pag, v_ret, v_comp),
      fecha_cobro = case when v_total > 0 and v_pag >= (v_total - v_ret) then v_f else null end,
      banco_cuenta_id = case when v_total > 0 and v_pag >= (v_total - v_ret) then v_c else null end
    where id = p_factura;
  elsif p_compra is not null then
    v_pag := public.monto_pagado_compra(p_compra);
    select p.fecha, p.cuenta_id into v_f, v_c from public.pagos p
      where p.compra_id = p_compra and not exists (select 1 from public.pago_reversos r where r.pago_id = p.id)
      order by p.fecha desc, p.created_at desc limit 1;
    update public.compras set monto_pagado = v_pag,
      estado = case when v_pag >= total then 'pagada' else 'pendiente' end,
      fecha_pago = case when v_pag >= total then v_f else null end,
      banco_cuenta_id = case when v_pag >= total then v_c else null end
    where id = p_compra;
  elsif p_presupuesto is not null then
    v_pag := public.monto_pagado_presupuesto(p_presupuesto);
    select p.fecha, p.cuenta_id into v_f, v_c from public.pagos p
      where p.presupuesto_id = p_presupuesto and not exists (select 1 from public.pago_reversos r where r.pago_id = p.id)
      order by p.fecha desc, p.created_at desc limit 1;
    update public.presupuestos set monto_pagado = v_pag,
      estado = case when v_pag >= total then 'pagada' else 'pendiente' end,
      fecha_cobro = case when v_pag >= total then v_f else null end,
      banco_cuenta_id = case when v_pag >= total then v_c else null end
    where id = p_presupuesto;
  elsif p_venta is not null then
    v_pag := public.monto_pagado_venta_ogemi(p_venta);
    select p.fecha, p.cuenta_id into v_f, v_c from public.pagos p
      where p.venta_ogemi_id = p_venta and not exists (select 1 from public.pago_reversos r where r.pago_id = p.id)
      order by p.fecha desc, p.created_at desc limit 1;
    update public.ventas_ogemi set monto_pagado = v_pag,
      estado = case when v_pag >= total then 'pagada' else 'pendiente' end,
      fecha_cobro = case when v_pag >= total then v_f else null end,
      banco_cuenta_id = case when v_pag >= total then v_c else null end
    where id = p_venta;
  end if;
end $$;

-- ── Editar (en sitio) ─────────────────────────────────────────────────────────
create or replace function public.editar_pago(
  p_pago_id uuid, p_monto numeric, p_fecha date, p_cuenta_id uuid,
  p_referencia text default null, p_motivo text default null
) returns uuid
language plpgsql security definer set search_path to 'public','app_private','pg_temp' as $$
declare
  v_old public.pagos%rowtype; v_new public.pagos%rowtype; v_mod text;
  v_total numeric; v_ret numeric := 0; v_pagado numeric; v_delta numeric;
  v_mov public.banco_movimientos%rowtype; v_lote_cambia boolean; r record;
  v_ref text := nullif(trim(coalesce(p_referencia,'')), '');
begin
  select * into v_old from public.pagos where id = p_pago_id for update;
  if not found then raise exception 'El cobro/pago no existe.'; end if;
  v_mod := public._pago_modulo(v_old);
  if not app_private.has_module_permission(v_mod, 'editar') then
    raise exception 'No tienes permiso para editar este cobro/pago.';
  end if;
  if p_monto is null or p_monto <= 0 then raise exception 'El monto debe ser mayor a 0.'; end if;
  if p_fecha is null then raise exception 'Debe indicar la fecha.'; end if;
  if p_cuenta_id is null then raise exception 'Debe indicar la cuenta de banco.'; end if;
  if not public._pago_es_banco(v_old) then
    raise exception 'Este cobro viene de un anticipo o nota de crédito: no se edita; bórrelo y vuelva a aplicarlo.';
  end if;
  if exists (select 1 from public.pago_reversos where pago_id = p_pago_id) then
    raise exception 'Este cobro/pago ya fue reversado: no se puede editar (sí se puede borrar).';
  end if;
  if not exists (select 1 from public.banco_cuentas where id = p_cuenta_id) then
    raise exception 'La cuenta de banco no existe.';
  end if;

  -- Única condición: nada en periodo cerrado (valores actuales y nuevos)
  perform public._check_periodo_abierto(v_old.cuenta_id, v_old.fecha, 'editar');
  perform public._check_periodo_abierto(p_cuenta_id, p_fecha, 'mover el cobro/pago a esa fecha');

  -- No sobrepagar el documento
  v_delta := round(p_monto, 2) - v_old.monto;
  if v_delta > 0 then
    if v_old.factura_id is not null then
      select total, round(coalesce(retencion_pct,0)/100.0 * coalesce(itbms,0), 2) into v_total, v_ret from public.facturas where id = v_old.factura_id;
      v_pagado := public.monto_pagado_factura(v_old.factura_id);
    elsif v_old.compra_id is not null then
      select total into v_total from public.compras where id = v_old.compra_id;
      v_pagado := public.monto_pagado_compra(v_old.compra_id);
    elsif v_old.presupuesto_id is not null then
      select total into v_total from public.presupuestos where id = v_old.presupuesto_id;
      v_pagado := public.monto_pagado_presupuesto(v_old.presupuesto_id);
    else
      select total into v_total from public.ventas_ogemi where id = v_old.venta_ogemi_id;
      v_pagado := public.monto_pagado_venta_ogemi(v_old.venta_ogemi_id);
    end if;
    if v_pagado + v_delta > (v_total - v_ret) + 0.005 then
      raise exception 'El monto excede el saldo del documento (máximo %).', to_char(v_old.monto + (v_total - v_ret) - v_pagado, 'FM999G999G990D00');
    end if;
  end if;

  perform set_config('app.allow_pago_mutation', 'on', true);

  if v_old.lote_id is null then
    update public.pagos set monto = round(p_monto,2), fecha = p_fecha, cuenta_id = p_cuenta_id, referencia = v_ref
      where id = p_pago_id returning * into v_new;
    update public.banco_movimientos
       set cuenta_id = p_cuenta_id, monto = v_new.monto, fecha = p_fecha, referencia = v_ref,
           concepto = public._pago_concepto(v_new)
     where pago_id = p_pago_id and pago_reverso_id is null;
    if not found then
      raise exception 'No se encontró el movimiento de banco de este cobro/pago; no se aplicó ningún cambio.';
    end if;
  else
    -- Cobro/pago múltiple: UN solo movimiento de banco consolidado para todo el lote.
    select * into v_mov from public.banco_movimientos
      where lote_id = v_old.lote_id and pago_id is null and pago_reverso_id is null and reverso_de_id is null
      for update;
    if not found then raise exception 'No se encontró el movimiento consolidado del lote; no se aplicó ningún cambio.'; end if;
    v_lote_cambia := (p_fecha is distinct from v_old.fecha) or (p_cuenta_id is distinct from v_old.cuenta_id)
                  or (v_ref is distinct from v_old.referencia);
    perform public._check_periodo_abierto(v_mov.cuenta_id, v_mov.fecha, 'editar');

    update public.pagos set monto = round(p_monto,2) where id = p_pago_id;
    if v_lote_cambia then
      -- fecha / cuenta / referencia son del depósito completo: se aplican a todo el lote
      update public.pagos set fecha = p_fecha, cuenta_id = p_cuenta_id, referencia = v_ref
        where lote_id = v_old.lote_id and public._pago_es_banco(pagos.*)
          and not exists (select 1 from public.pago_reversos prv where prv.pago_id = pagos.id);
      update public.cobro_lotes set fecha = p_fecha, cuenta_id = p_cuenta_id, referencia = v_ref where id = v_old.lote_id;
    end if;
    update public.cobro_lotes set monto_efectivo = monto_efectivo + v_delta where id = v_old.lote_id;
    update public.banco_movimientos
       set monto = monto + v_delta,
           cuenta_id = case when v_lote_cambia then p_cuenta_id else cuenta_id end,
           fecha = case when v_lote_cambia then p_fecha else fecha end,
           referencia = case when v_lote_cambia then v_ref else referencia end
     where id = v_mov.id;
    select * into v_new from public.pagos where id = p_pago_id;
    if v_lote_cambia then
      for r in select distinct factura_id, compra_id, presupuesto_id, venta_ogemi_id from public.pagos
                where lote_id = v_old.lote_id and id <> p_pago_id loop
        perform public._recalc_documento(r.factura_id, r.compra_id, r.presupuesto_id, r.venta_ogemi_id);
      end loop;
    end if;
  end if;

  perform public._recalc_documento(v_old.factura_id, v_old.compra_id, v_old.presupuesto_id, v_old.venta_ogemi_id);

  insert into public.pagos_auditoria (pago_id, accion, documento_tipo, documento_id, antes, despues, motivo)
  values (p_pago_id, 'editar', v_mod,
          coalesce(v_old.factura_id, v_old.compra_id, v_old.presupuesto_id, v_old.venta_ogemi_id),
          to_jsonb(v_old), to_jsonb(v_new), nullif(trim(coalesce(p_motivo,'')),''));
  return p_pago_id;
end $$;

-- ── Borrar (real) ─────────────────────────────────────────────────────────────
create or replace function public.eliminar_pago(p_pago_id uuid, p_motivo text default null) returns void
language plpgsql security definer set search_path to 'public','app_private','pg_temp' as $$
declare
  v_old public.pagos%rowtype; v_mod text; v_rev public.pago_reversos%rowtype;
  v_mov public.banco_movimientos%rowtype; v_restantes int;
begin
  select * into v_old from public.pagos where id = p_pago_id for update;
  if not found then raise exception 'El cobro/pago no existe.'; end if;
  v_mod := public._pago_modulo(v_old);
  if not app_private.has_module_permission(v_mod, 'borrar') then
    raise exception 'No tienes permiso para borrar este cobro/pago.';
  end if;

  perform public._check_periodo_abierto(v_old.cuenta_id, v_old.fecha, 'borrar');
  perform set_config('app.allow_pago_mutation', 'on', true);

  -- Si estaba reversado: se elimina también el reverso y su contra-movimiento
  select * into v_rev from public.pago_reversos where pago_id = p_pago_id;
  if found then
    perform public._check_periodo_abierto(v_rev.cuenta_id, v_rev.fecha, 'borrar (el reverso)');
    update public.pago_reversos set banco_movimiento_id = null where id = v_rev.id;
    delete from public.banco_movimientos where pago_reverso_id = v_rev.id;
    delete from public.pago_reversos where id = v_rev.id;
  end if;

  if public._pago_es_banco(v_old) then
    if v_old.lote_id is null then
      delete from public.banco_movimientos where pago_id = p_pago_id;
    else
      select * into v_mov from public.banco_movimientos
        where lote_id = v_old.lote_id and pago_id is null and pago_reverso_id is null and reverso_de_id is null
        for update;
      if found then
        perform public._check_periodo_abierto(v_mov.cuenta_id, v_mov.fecha, 'borrar');
        -- si el pago ya estaba reversado, su parte sigue dentro del consolidado: se descuenta igual
        if v_mov.monto - v_old.monto <= 0.005 then
          delete from public.banco_movimientos where id = v_mov.id;
        else
          update public.banco_movimientos set monto = monto - v_old.monto where id = v_mov.id;
        end if;
      end if;
    end if;
  end if;

  -- Liberar créditos aplicados (igual que el reverso)
  if v_old.nota_credito_id is not null then
    update public.notas_credito set estado = 'disponible', factura_aplicada_id = null, pago_id = null where id = v_old.nota_credito_id;
  end if;
  update public.notas_credito set pago_id = null where pago_id = p_pago_id;
  if v_old.credito_factura_id is not null then
    update public.facturas set factura_aplicada_id = null where id = v_old.credito_factura_id;
  end if;
  if v_old.credito_compra_id is not null then
    update public.compras set compra_aplicada_id = null, estado = 'pendiente', fecha_pago = null, banco_cuenta_id = null
     where id = v_old.credito_compra_id;
  end if;

  delete from public.pagos where id = p_pago_id;  -- el trigger sync_anticipo_estado libera el anticipo

  if v_old.lote_id is not null then
    select count(*) into v_restantes from public.pagos where lote_id = v_old.lote_id;
    if v_restantes = 0 then
      delete from public.banco_movimientos where lote_id = v_old.lote_id and pago_id is null and pago_reverso_id is null;
      delete from public.cobro_lotes where id = v_old.lote_id;
    else
      update public.cobro_lotes l set
        monto_efectivo = greatest(0, monto_efectivo - case when public._pago_es_banco(v_old) then v_old.monto else 0 end),
        monto_credito  = greatest(0, monto_credito  - case when v_old.nota_credito_id is not null or v_old.credito_factura_id is not null or v_old.credito_compra_id is not null then v_old.monto else 0 end),
        monto_anticipo = greatest(0, monto_anticipo - case when v_old.anticipo_id is not null then v_old.monto else 0 end),
        num_facturas = (select count(distinct coalesce(factura_id, compra_id, presupuesto_id, venta_ogemi_id)) from public.pagos where lote_id = l.id)
      where l.id = v_old.lote_id;
    end if;
  end if;

  perform public._recalc_documento(v_old.factura_id, v_old.compra_id, v_old.presupuesto_id, v_old.venta_ogemi_id);

  insert into public.pagos_auditoria (pago_id, accion, documento_tipo, documento_id, antes, despues, motivo)
  values (p_pago_id, 'borrar', v_mod,
          coalesce(v_old.factura_id, v_old.compra_id, v_old.presupuesto_id, v_old.venta_ogemi_id),
          to_jsonb(v_old) || case when v_rev.id is not null then jsonb_build_object('_reverso', to_jsonb(v_rev)) else '{}'::jsonb end,
          null, nullif(trim(coalesce(p_motivo,'')),''));
end $$;

-- ── Las RPC existentes de edición pasan a editar en sitio (misma firma: el frontend viejo sigue funcionando) ──
create or replace function public.editar_cobro_factura(p_pago_id uuid, p_monto numeric, p_fecha date, p_cuenta_id uuid, p_referencia text default null, p_motivo text default 'Edición de cobro')
returns uuid language sql security definer set search_path to 'public','pg_temp' as $$
  select public.editar_pago(p_pago_id, p_monto, p_fecha, p_cuenta_id, p_referencia, p_motivo) $$;
create or replace function public.editar_cobro_compra(p_pago_id uuid, p_monto numeric, p_fecha date, p_cuenta_id uuid, p_referencia text default null, p_motivo text default 'Edición de pago')
returns uuid language sql security definer set search_path to 'public','pg_temp' as $$
  select public.editar_pago(p_pago_id, p_monto, p_fecha, p_cuenta_id, p_referencia, p_motivo) $$;
create or replace function public.editar_cobro_presupuesto(p_pago_id uuid, p_monto numeric, p_fecha date, p_cuenta_id uuid, p_referencia text default null, p_motivo text default 'Edición de cobro')
returns uuid language sql security definer set search_path to 'public','pg_temp' as $$
  select public.editar_pago(p_pago_id, p_monto, p_fecha, p_cuenta_id, p_referencia, p_motivo) $$;
create or replace function public.editar_cobro_venta_ogemi(p_pago_id uuid, p_monto numeric, p_fecha date, p_cuenta_id uuid, p_referencia text default null, p_motivo text default 'Edición de cobro')
returns uuid language sql security definer set search_path to 'public','pg_temp' as $$
  select public.editar_pago(p_pago_id, p_monto, p_fecha, p_cuenta_id, p_referencia, p_motivo) $$;

revoke execute on function public.editar_pago(uuid,numeric,date,uuid,text,text) from public, anon;
revoke execute on function public.eliminar_pago(uuid,text) from public, anon;
grant execute on function public.editar_pago(uuid,numeric,date,uuid,text,text) to authenticated;
grant execute on function public.eliminar_pago(uuid,text) to authenticated;
revoke execute on function public._recalc_documento(uuid,uuid,uuid,uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
