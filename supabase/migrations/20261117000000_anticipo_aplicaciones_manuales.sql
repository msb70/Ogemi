-- Aplicación manual de anticipos (sin documento): consume saldo del anticipo con una descripción.
-- No toca banco (el dinero ya entró con el depósito del anticipo).

create table if not exists public.anticipo_aplicaciones_manuales (
  id uuid primary key default gen_random_uuid(),
  anticipo_id uuid not null references public.anticipos(id) on delete restrict,
  fecha date not null default current_date,
  monto numeric(14,2) not null check (monto > 0),
  descripcion text not null check (length(trim(descripcion)) > 0),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists idx_anticipo_apl_manuales_anticipo on public.anticipo_aplicaciones_manuales(anticipo_id);

alter table public.anticipo_aplicaciones_manuales enable row level security;
-- Lectura: quien puede ver el anticipo (la RLS de anticipos aplica dentro del exists)
drop policy if exists ver_anticipo_apl_manuales on public.anticipo_aplicaciones_manuales;
create policy ver_anticipo_apl_manuales on public.anticipo_aplicaciones_manuales
  for select to authenticated
  using (exists (select 1 from public.anticipos a where a.id = anticipo_id));
-- Escritura solo vía RPC SECURITY DEFINER (sin políticas de insert/update/delete)
revoke all on public.anticipo_aplicaciones_manuales from anon;
grant select on public.anticipo_aplicaciones_manuales to authenticated;

-- Total aplicado = pagos vigentes + aplicaciones manuales
create or replace function public.monto_aplicado_anticipo(p_anticipo_id uuid)
 returns numeric language sql stable set search_path to 'public', 'pg_temp'
as $function$
  select (select coalesce(sum(p.monto), 0) - coalesce(sum(r.monto), 0)
            from public.pagos p
            left join public.pago_reversos r on r.pago_id = p.id
           where p.anticipo_id = p_anticipo_id)
       + (select coalesce(sum(m.monto), 0)
            from public.anticipo_aplicaciones_manuales m
           where m.anticipo_id = p_anticipo_id);
$function$;

create or replace view public.anticipos_saldos with (security_invoker = true) as
 select a.id, a.cliente_id, a.cuenta_id, a.fecha, a.monto, a.numero_deposito, a.notas, a.estado,
    a.created_at, a.updated_at,
    coalesce(ap.aplicado, 0::numeric) + coalesce(mm.manual, 0::numeric) as aplicado,
    case when a.estado = 'anulado'::text then 0::numeric
         else a.monto - coalesce(ap.aplicado, 0::numeric) - coalesce(mm.manual, 0::numeric) end as saldo,
    a.empresa, a.numero_recibo
   from public.anticipos a
   left join (select p.anticipo_id, sum(p.monto) - coalesce(sum(r.monto), 0::numeric) as aplicado
                from public.pagos p
                left join public.pago_reversos r on r.pago_id = p.id
               where p.anticipo_id is not null
               group by p.anticipo_id) ap on ap.anticipo_id = a.id
   left join (select m.anticipo_id, sum(m.monto) as manual
                from public.anticipo_aplicaciones_manuales m
               group by m.anticipo_id) mm on mm.anticipo_id = a.id;

-- Estado del anticipo al insertar/borrar aplicaciones manuales
create or replace function public.sync_anticipo_estado_manual()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_ant uuid := coalesce(new.anticipo_id, old.anticipo_id); v_monto numeric; v_aplicado numeric; v_nuevo text;
begin
  select a.monto into v_monto from public.anticipos a where a.id = v_ant;
  v_aplicado := public.monto_aplicado_anticipo(v_ant);
  v_nuevo := case when v_aplicado >= v_monto then 'aplicado' else 'activo' end;
  update public.anticipos set estado = v_nuevo
   where id = v_ant and estado <> 'anulado' and estado is distinct from v_nuevo;
  return coalesce(new, old);
end $function$;

drop trigger if exists trg_sync_anticipo_estado_manual on public.anticipo_aplicaciones_manuales;
create trigger trg_sync_anticipo_estado_manual
  after insert or delete on public.anticipo_aplicaciones_manuales
  for each row execute function public.sync_anticipo_estado_manual();

-- Bitácora: nuevas acciones
alter table public.pagos_auditoria drop constraint pagos_auditoria_accion_check;
alter table public.pagos_auditoria add constraint pagos_auditoria_accion_check
  check (accion = any (array['editar','borrar','anticipo_cliente','borrar_documento','anticipo_deposito','anticipo_anular',
                             'anticipo_aplicar_manual','anticipo_borrar_aplicacion_manual']));

-- RPC: aplicar manualmente
create or replace function public.aplicar_anticipo_manual(p_anticipo_id uuid, p_monto numeric, p_fecha date, p_descripcion text)
 returns uuid language plpgsql security definer set search_path to 'public', 'app_private', 'pg_temp'
as $function$
declare v_a public.anticipos%rowtype; v_mod text; v_saldo numeric; v_desc text; v_id uuid; v_cli text;
begin
  select * into v_a from public.anticipos where id = p_anticipo_id for update;
  if not found then raise exception 'El anticipo no existe.'; end if;
  v_mod := case when v_a.empresa = 'ogemi' then 'ventas_ogemi' else 'facturas' end;
  if not app_private.has_module_permission(v_mod, 'editar') then
    raise exception 'No tienes permiso para aplicar anticipos.';
  end if;
  if v_a.estado = 'anulado' then raise exception 'El anticipo está anulado.'; end if;
  v_desc := nullif(trim(coalesce(p_descripcion, '')), '');
  if v_desc is null then raise exception 'Escribe la descripción de la aplicación.'; end if;
  if p_monto is null or p_monto <= 0 then raise exception 'El monto debe ser mayor que cero.'; end if;
  v_saldo := v_a.monto - public.monto_aplicado_anticipo(p_anticipo_id);
  if round(p_monto, 2) > round(v_saldo, 2) then
    raise exception 'El monto (%) supera el saldo disponible del anticipo (%).',
      to_char(p_monto,'FM999G999G990D00'), to_char(v_saldo,'FM999G999G990D00');
  end if;
  if p_fecha is null then raise exception 'Indica la fecha.'; end if;
  if p_fecha < v_a.fecha then
    raise exception 'La fecha (%) no puede ser anterior a la del depósito (%).', to_char(p_fecha,'DD/MM/YYYY'), to_char(v_a.fecha,'DD/MM/YYYY');
  end if;
  if p_fecha > current_date + 1 then raise exception 'La fecha no puede ser futura.'; end if;

  insert into public.anticipo_aplicaciones_manuales (anticipo_id, fecha, monto, descripcion)
  values (p_anticipo_id, p_fecha, round(p_monto, 2), v_desc) returning id into v_id;

  select nombre into v_cli from public.clientes where id = v_a.cliente_id;
  insert into public.pagos_auditoria (pago_id, accion, documento_tipo, documento_id, antes, despues, motivo)
  values (null, 'anticipo_aplicar_manual', 'anticipos', p_anticipo_id,
          jsonb_build_object('_tercero', v_cli, 'saldo', v_saldo, 'numero_recibo', v_a.numero_recibo),
          jsonb_build_object('aplicacion_id', v_id, 'monto', round(p_monto, 2), 'fecha', p_fecha, 'descripcion', v_desc),
          v_desc);
  return v_id;
end $function$;

-- RPC: borrar una aplicación manual (devuelve el saldo al anticipo)
create or replace function public.eliminar_aplicacion_manual_anticipo(p_id uuid, p_motivo text default null)
 returns void language plpgsql security definer set search_path to 'public', 'app_private', 'pg_temp'
as $function$
declare v_m public.anticipo_aplicaciones_manuales%rowtype; v_a public.anticipos%rowtype; v_mod text; v_cli text;
begin
  select * into v_m from public.anticipo_aplicaciones_manuales where id = p_id;
  if not found then raise exception 'La aplicación no existe.'; end if;
  select * into v_a from public.anticipos where id = v_m.anticipo_id for update;
  v_mod := case when v_a.empresa = 'ogemi' then 'ventas_ogemi' else 'facturas' end;
  if not app_private.has_module_permission(v_mod, 'editar') then
    raise exception 'No tienes permiso para modificar anticipos.';
  end if;
  if v_a.estado = 'anulado' then raise exception 'El anticipo está anulado.'; end if;

  delete from public.anticipo_aplicaciones_manuales where id = p_id;

  select nombre into v_cli from public.clientes where id = v_a.cliente_id;
  insert into public.pagos_auditoria (pago_id, accion, documento_tipo, documento_id, antes, despues, motivo)
  values (null, 'anticipo_borrar_aplicacion_manual', 'anticipos', v_a.id,
          jsonb_build_object('_tercero', v_cli, 'aplicacion_id', v_m.id, 'monto', v_m.monto, 'fecha', v_m.fecha, 'descripcion', v_m.descripcion),
          null, nullif(trim(coalesce(p_motivo,'')),''));
end $function$;

revoke all on function public.aplicar_anticipo_manual(uuid, numeric, date, text) from public, anon;
revoke all on function public.eliminar_aplicacion_manual_anticipo(uuid, text) from public, anon;
grant execute on function public.aplicar_anticipo_manual(uuid, numeric, date, text) to authenticated;
grant execute on function public.eliminar_aplicacion_manual_anticipo(uuid, text) to authenticated;

-- Las aplicaciones manuales también bloquean la anulación
create or replace function public._anticipo_aplicaciones_txt(p_anticipo_id uuid)
 returns text language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(string_agg(txt, '; ' order by f, c), '') from (
    select case when p.factura_id is not null then 'Factura ' || coalesce(f.numero_factura::text,'?')
                when p.presupuesto_id is not null then 'Presupuesto ' || coalesce(pr.numero_presupuesto::text,'?')
                when p.venta_ogemi_id is not null then 'Venta Ogemi ' || coalesce(v.numero::text,'?')
                else 'Documento' end
           || ' por ' || to_char(p.monto,'FM999,999,990.00')
           || ' del ' || to_char(p.fecha,'DD/MM/YYYY')
           || coalesce(' (REC-' || lpad(p.numero_recibo::text,5,'0') || ')','') as txt,
           p.fecha as f, p.created_at as c
      from public.pagos p
      left join public.facturas f on f.id = p.factura_id
      left join public.presupuestos pr on pr.id = p.presupuesto_id
      left join public.ventas_ogemi v on v.id = p.venta_ogemi_id
     where p.anticipo_id = p_anticipo_id
       and not exists (select 1 from public.pago_reversos r where r.pago_id = p.id)
    union all
    select 'Aplicación manual "' || m.descripcion || '" por ' || to_char(m.monto,'FM999,999,990.00')
           || ' del ' || to_char(m.fecha,'DD/MM/YYYY'), m.fecha, m.created_at
      from public.anticipo_aplicaciones_manuales m
     where m.anticipo_id = p_anticipo_id
  ) t;
$function$;

notify pgrst, 'reload schema';
