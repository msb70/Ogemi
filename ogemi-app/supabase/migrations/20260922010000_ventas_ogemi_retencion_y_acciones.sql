-- Aplicada en prod (tnuz) el 2026-09-22 vía MCP como migración `ventas_ogemi_retencion_y_acciones`.
-- Ventas Ogemi con las mismas acciones que Facturas (Impresos): retención de ITBMS, estado
-- falta_retencion, cobro al neto, edición/borrado con cobros (borrado con cobros solo admin).
alter table public.ventas_ogemi
  add column retencion_pct numeric not null default 0 check (retencion_pct >= 0 and retencion_pct <= 100),
  add column retencion_monto numeric generated always as (round(coalesce(retencion_pct,0) / 100.0 * coalesce(itbms,0), 2)) stored,
  add column retencion_comprobante_entregado boolean not null default false,
  add column retencion_comprobante_fecha date;

alter table public.ventas_ogemi drop constraint ventas_ogemi_estado_check;
alter table public.ventas_ogemi add constraint ventas_ogemi_estado_check
  check (estado = any (array['pendiente','pagada','falta_retencion']));

create or replace function public.ventas_ogemi_calc()
 returns trigger language plpgsql set search_path to 'public', 'pg_temp'
as $function$
begin
  new.itbms := round(coalesce(new.monto,0) * coalesce(new.itbms_pct,0) / 100.0, 2);
  new.total := round(coalesce(new.monto,0) + new.itbms, 2);
  if new.dias_credito is null then
    select coalesce(dias_credito, 30) into new.dias_credito from public.clientes where id = new.cliente_id;
  end if;
  if tg_op = 'INSERT' and coalesce(new.retencion_pct,0) = 0 then
    select coalesce(retencion_pct,0) into new.retencion_pct from public.clientes where id = new.cliente_id;
    new.retencion_pct := coalesce(new.retencion_pct, 0);
  end if;
  new.fecha_pago := new.fecha + coalesce(new.dias_credito, 30);
  new.updated_at := now();
  return new;
end $function$;

create or replace function public.ventas_ogemi_estado()
 returns trigger language plpgsql set search_path to 'public', 'pg_temp'
as $function$
declare v_ret numeric; v_f date; v_c uuid;
begin
  if new.cliente_id is distinct from old.cliente_id and coalesce(old.monto_pagado,0) > 0 then
    raise exception 'La venta #% ya tiene cobros: no se puede cambiar el cliente. Borra primero los cobros.', old.numero;
  end if;
  if coalesce(new.monto_pagado,0) > coalesce(new.total,0) + 0.005 then
    raise exception 'El total de la venta #% (%) no puede quedar por debajo de lo ya cobrado (%).',
      old.numero, to_char(new.total,'FM999G999G990D00'), to_char(new.monto_pagado,'FM999G999G990D00');
  end if;
  v_ret := round(coalesce(new.retencion_pct,0) / 100.0 * coalesce(new.itbms,0), 2);
  new.estado := public.calc_estado_factura(new.total, new.monto_pagado, v_ret, new.retencion_comprobante_entregado);
  if not coalesce(new.retencion_comprobante_entregado,false) then new.retencion_comprobante_fecha := null; end if;
  if new.estado = 'pendiente' then
    new.fecha_cobro := null; new.banco_cuenta_id := null;
  elsif new.fecha_cobro is null then
    select p.fecha, p.cuenta_id into v_f, v_c from public.pagos p
     where p.venta_ogemi_id = new.id and not exists (select 1 from public.pago_reversos r where r.pago_id = p.id)
     order by p.fecha desc, p.created_at desc limit 1;
    new.fecha_cobro := v_f; new.banco_cuenta_id := v_c;
  end if;
  return new;
end $function$;

create trigger trg_ventas_ogemi_zestado
  before update of cliente_id, fecha, monto, itbms_pct, total, monto_pagado, retencion_pct, retencion_comprobante_entregado, retencion_comprobante_fecha
  on public.ventas_ogemi for each row execute function public.ventas_ogemi_estado();

-- Umbrales al neto (total − retención) en las ramas de ventas Ogemi de las funciones existentes
do $$
declare v text; pos int; head text; tail text; nt text; f text;
begin
  foreach f in array array['public.procesar_pago()', 'public._recalc_documento(uuid,uuid,uuid,uuid)', 'public._reversar_pago_core(uuid,text,date)'] loop
    v := pg_get_functiondef(f::regprocedure);
    pos := strpos(lower(v), 'update public.ventas_ogemi set');
    if pos = 0 then raise exception 'No se encontró la rama ventas_ogemi en %', f; end if;
    head := left(v, pos - 1); tail := substr(v, pos);
    nt := replace(tail, '>= total', '>= (total - coalesce(retencion_monto,0))');
    if nt = tail then raise exception 'Sin reemplazos en %', f; end if;
    execute head || nt;
  end loop;
  v := pg_get_functiondef('public.registrar_cobro_lote_ventas_ogemi(uuid,date,uuid,text,jsonb,jsonb)'::regprocedure);
  nt := replace(v, 'v_v.total - public.monto_pagado_venta_ogemi(v_v.id)',
                   'v_v.total - coalesce(v_v.retencion_monto,0) - public.monto_pagado_venta_ogemi(v_v.id)');
  if nt = v then raise exception 'Sin reemplazos en registrar_cobro_lote_ventas_ogemi'; end if;
  execute nt;
  v := pg_get_functiondef('public.editar_pago(uuid,numeric,date,uuid,text,text)'::regprocedure);
  nt := replace(v, 'select total into v_total from public.ventas_ogemi where id = v_old.venta_ogemi_id;',
                   'select total, coalesce(retencion_monto,0) into v_total, v_ret from public.ventas_ogemi where id = v_old.venta_ogemi_id;');
  if nt = v then raise exception 'Sin reemplazos en editar_pago'; end if;
  execute nt;
end $$;

create or replace view public.cartera_ventas_ogemi as
 select v.id, v.numero, v.fecha, v.fecha_pago, c.nombre as cliente, v.monto, v.itbms, v.total,
    coalesce(v.monto_pagado, 0::numeric) as monto_pagado,
    (v.total - coalesce(v.retencion_monto,0) - coalesce(v.monto_pagado, 0::numeric)) as saldo_pendiente,
    (current_date - v.fecha_pago) as dias_vencida,
    case
      when current_date <= v.fecha_pago then 'corriente'::text
      when (current_date - v.fecha_pago) between 1 and 30 then '1-30'::text
      when (current_date - v.fecha_pago) between 31 and 60 then '31-60'::text
      when (current_date - v.fecha_pago) between 61 and 90 then '61-90'::text
      when (current_date - v.fecha_pago) between 91 and 120 then '91-120'::text
      else '+120'::text
    end as tramo,
    coalesce(v.retencion_monto,0) as retencion_monto
   from public.ventas_ogemi v join public.clientes c on c.id = v.cliente_id
  where v.estado = 'pendiente' and v.total > 0
    and (v.total - coalesce(v.retencion_monto,0) - coalesce(v.monto_pagado, 0)) > 0;

create or replace function public.eliminar_venta_ogemi(p_id uuid)
 returns void language plpgsql security definer
 set search_path to 'public', 'app_private', 'pg_temp'
as $function$
declare v_bloq int; v_con_cobros boolean;
begin
  if not exists (select 1 from public.ventas_ogemi where id = p_id) then raise exception 'La venta no existe.'; end if;
  v_con_cobros := exists (select 1 from public.pagos where venta_ogemi_id = p_id);
  if v_con_cobros then
    if not public._es_admin() then
      raise exception 'La venta tiene cobros: solo un administrador puede borrarla (se borran también sus cobros y movimientos de banco).' using errcode='P0001';
    end if;
  elsif not app_private.has_module_permission('ventas_ogemi','borrar') then
    raise exception 'No tienes permiso para borrar ventas Ogemi.';
  end if;
  if exists (select 1 from public.pagos where venta_ogemi_id = p_id and lote_id is not null and anticipo_id is null) then
    raise exception 'La venta tiene cobros de un lote (cobro múltiple): el ingreso consolidado quedaría descuadrado. Borra primero esos cobros (botón Borrar en el cobro).' using errcode='P0001';
  end if;
  select count(*) into v_bloq from public.banco_movimientos b
   where b.venta_ogemi_id = p_id and public.fecha_cierre_bloqueo(b.cuenta_id) is not null
     and b.fecha <= public.fecha_cierre_bloqueo(b.cuenta_id);
  if v_bloq > 0 then raise exception 'No se puede borrar: la venta tiene movimientos en un periodo cerrado.' using errcode='P0001'; end if;
  perform public._auditar_borrado_documento('ventas_ogemi', p_id);
  perform set_config('app.allow_pago_mutation','on', true);
  update public.pago_reversos set banco_movimiento_id = null
   where venta_ogemi_id = p_id or pago_id in (select id from public.pagos where venta_ogemi_id = p_id);
  delete from public.banco_movimientos where venta_ogemi_id = p_id;
  delete from public.pago_reversos where venta_ogemi_id = p_id or pago_id in (select id from public.pagos where venta_ogemi_id = p_id);
  delete from public.pagos where venta_ogemi_id = p_id;
  delete from public.ventas_ogemi where id = p_id;
end $function$;
