-- Notas de crédito con aplicación parcial (Impresos y Ogemi)
-- Una NC puede aplicarse en varias veces (a una o varias facturas/ventas) hasta agotar su total.
-- notas_credito.monto_aplicado = suma de pagos NO reversados con nota_credito_id; saldo = total − aplicado.
-- estado: disponible (sin uso) | parcial (con saldo) | aplicada (agotada).

alter table public.notas_credito drop constraint if exists notas_credito_estado_check;
alter table public.notas_credito add constraint notas_credito_estado_check
  check (estado = any (array['disponible','parcial','aplicada']));
alter table public.notas_credito add column if not exists monto_aplicado numeric not null default 0;
alter table public.notas_credito add column if not exists saldo numeric
  generated always as (round(coalesce(monto,0) + coalesce(itbms,0) - coalesce(monto_aplicado,0), 2)) stored;

comment on column public.notas_credito.monto_aplicado is 'Suma de pagos no reversados hechos con esta NC (lo mantiene _sync_nota_credito).';
comment on column public.notas_credito.saldo is 'Saldo por usar de la NC = total − monto_aplicado.';
comment on column public.notas_credito.pago_id is 'Última aplicación (pago) de la NC; ver pagos.nota_credito_id para todas.';

create or replace function public.monto_aplicado_nota_credito(p_nota_id uuid)
returns numeric language sql stable set search_path to 'public','pg_temp' as $$
  select coalesce(sum(p.monto),0) from public.pagos p
   where p.nota_credito_id = p_nota_id
     and not exists (select 1 from public.pago_reversos r where r.pago_id = p.id)
$$;

-- Recalcula aplicado/estado/última aplicación de una NC a partir de sus pagos
create or replace function public._sync_nota_credito(p_nota_id uuid)
returns void language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_total numeric; v_apl numeric; v_last public.pagos%rowtype;
begin
  if p_nota_id is null then return; end if;
  select total into v_total from public.notas_credito where id = p_nota_id;
  if not found then return; end if;
  v_apl := public.monto_aplicado_nota_credito(p_nota_id);
  select p.* into v_last from public.pagos p
   where p.nota_credito_id = p_nota_id
     and not exists (select 1 from public.pago_reversos r where r.pago_id = p.id)
   order by p.fecha desc, p.created_at desc limit 1;
  update public.notas_credito set
    monto_aplicado = round(v_apl, 2),
    estado = case when v_apl <= 0.005 then 'disponible'
                  when coalesce(v_total,0) - v_apl <= 0.01 then 'aplicada'
                  else 'parcial' end,
    factura_aplicada_id = v_last.factura_id,
    venta_ogemi_aplicada_id = v_last.venta_ogemi_id,
    pago_id = v_last.id
  where id = p_nota_id;
end $$;
revoke all on function public._sync_nota_credito(uuid) from public, anon, authenticated;

-- Guardas: no bajar el total por debajo de lo aplicado, no cambiar cliente/empresa con aplicaciones,
-- no borrar una NC con aplicaciones vivas (liberarlas antes con liberar_nota_credito).
create or replace function public.trg_notas_credito_guard()
returns trigger language plpgsql set search_path to 'public','pg_temp' as $$
begin
  if tg_op = 'DELETE' then
    if coalesce(old.monto_aplicado,0) > 0.005 then
      raise exception 'La nota de crédito % tiene % aplicado. Libera sus aplicaciones antes de borrarla.',
        coalesce(old.numero,''), old.monto_aplicado;
    end if;
    return old;
  end if;
  if coalesce(new.monto_aplicado,0) > 0.005 then
    if round(coalesce(new.monto,0) + coalesce(new.itbms,0), 2) < new.monto_aplicado - 0.01 then
      raise exception 'El total de la nota de crédito no puede ser menor a lo ya aplicado (%).', new.monto_aplicado;
    end if;
    if new.cliente_id <> old.cliente_id or new.empresa <> old.empresa then
      raise exception 'No se puede cambiar el cliente ni la empresa de una nota de crédito ya aplicada. Libera sus aplicaciones primero.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_notas_credito_guard on public.notas_credito;
create trigger trg_notas_credito_guard before update or delete on public.notas_credito
  for each row execute function public.trg_notas_credito_guard();

-- Las referencias de "última aplicación" no deben impedir borrar pagos/documentos
alter table public.notas_credito drop constraint if exists notas_credito_pago_id_fkey,
  add constraint notas_credito_pago_id_fkey foreign key (pago_id) references public.pagos(id) on delete set null;
alter table public.notas_credito drop constraint if exists notas_credito_factura_aplicada_id_fkey,
  add constraint notas_credito_factura_aplicada_id_fkey foreign key (factura_aplicada_id) references public.facturas(id) on delete set null;
alter table public.notas_credito drop constraint if exists notas_credito_venta_ogemi_aplicada_id_fkey,
  add constraint notas_credito_venta_ogemi_aplicada_id_fkey foreign key (venta_ogemi_aplicada_id) references public.ventas_ogemi(id) on delete set null;

-- Cualquier alta/baja/cambio de un pago con NC (o de su reverso) recalcula la NC.
-- Cubre también borrados en cascada (eliminar_factura, eliminar_venta_ogemi, etc.).
create or replace function public.trg_pagos_sync_nc()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $$
begin
  if tg_op in ('INSERT','UPDATE') and new.nota_credito_id is not null then
    perform public._sync_nota_credito(new.nota_credito_id);
  end if;
  if tg_op in ('DELETE','UPDATE') and old.nota_credito_id is not null
     and (tg_op = 'DELETE' or old.nota_credito_id is distinct from new.nota_credito_id) then
    perform public._sync_nota_credito(old.nota_credito_id);
  end if;
  return null;
end $$;
drop trigger if exists trg_pagos_sync_nc on public.pagos;
create trigger trg_pagos_sync_nc after insert or update or delete on public.pagos
  for each row execute function public.trg_pagos_sync_nc();

create or replace function public.trg_pago_reversos_sync_nc()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_nc uuid;
begin
  select nota_credito_id into v_nc from public.pagos
   where id = case when tg_op = 'DELETE' then old.pago_id else new.pago_id end;
  if v_nc is not null then perform public._sync_nota_credito(v_nc); end if;
  return null;
end $$;
drop trigger if exists trg_pago_reversos_sync_nc on public.pago_reversos;
create trigger trg_pago_reversos_sync_nc after insert or delete on public.pago_reversos
  for each row execute function public.trg_pago_reversos_sync_nc();

-- Backfill
do $$ declare r record; begin
  for r in select id from public.notas_credito loop perform public._sync_nota_credito(r.id); end loop;
end $$;

-- aplicar_nota_credito (Impresos → facturas) con monto parcial
drop function if exists public.aplicar_nota_credito(uuid, uuid, date, uuid);
create or replace function public.aplicar_nota_credito(
  p_nota_id uuid, p_factura_id uuid, p_fecha date default current_date,
  p_lote_id uuid default null, p_monto numeric default null)
returns uuid language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_nc public.notas_credito%rowtype; v_f public.facturas%rowtype;
  v_saldo numeric; v_ret numeric; v_disp numeric; v_monto numeric; v_pago_id uuid;
begin
  select * into v_nc from public.notas_credito where id = p_nota_id for update;
  if not found then raise exception 'La nota de crédito no existe.'; end if;
  if v_nc.empresa <> 'impresos' then raise exception 'La nota de crédito % es de Impresora Ogemi y no puede aplicarse a facturas de Impresos Comerciales.', v_nc.numero; end if;
  v_disp := coalesce(v_nc.total,0) - public.monto_aplicado_nota_credito(p_nota_id);
  if v_disp <= 0.005 then raise exception 'La nota de crédito % ya no tiene saldo por usar.', coalesce(v_nc.numero,''); end if;

  select * into v_f from public.facturas where id = p_factura_id for update;
  if not found then raise exception 'La factura no existe.'; end if;
  if v_f.cliente_id <> v_nc.cliente_id then raise exception 'La nota de crédito es de otro cliente.'; end if;

  v_ret := round(coalesce(v_f.retencion_pct,0)/100.0*coalesce(v_f.itbms,0),2);
  v_saldo := (v_f.total - v_ret) - public.monto_pagado_factura(p_factura_id);
  if v_saldo <= 0.005 then raise exception 'La factura #% no tiene saldo pendiente.', v_f.numero_factura; end if;

  if p_monto is null then
    if v_nc.estado = 'disponible' and v_disp > v_saldo + 0.001 then
      -- Compatibilidad: sin monto explícito, una NC sin uso que no cabe completa no se aplica en automático
      raise exception 'La nota de crédito (%) excede el saldo de la factura (%). Indica el monto a descontar.', round(v_disp,2), round(v_saldo,2);
    end if;
    v_monto := round(least(v_disp, v_saldo), 2);
  else
    v_monto := round(p_monto, 2);
  end if;
  if v_monto <= 0 then raise exception 'El monto a descontar de la nota de crédito debe ser mayor a 0.'; end if;
  if v_monto > v_disp + 0.005 then
    raise exception 'El monto (%) excede el saldo disponible de la NC % (%).', v_monto, coalesce(v_nc.numero,''), round(v_disp,2);
  end if;
  if v_monto > v_saldo + 0.005 then
    raise exception 'El monto (%) excede el saldo de la factura #% (%).', v_monto, v_f.numero_factura, round(v_saldo,2);
  end if;

  insert into public.pagos (factura_id, cuenta_id, monto, fecha, referencia, nota_credito_id, lote_id)
  values (p_factura_id, null, v_monto, coalesce(p_fecha,current_date), 'NC '||coalesce(v_nc.numero,''), p_nota_id, p_lote_id)
  returning id into v_pago_id;

  perform public._sync_nota_credito(p_nota_id);
  return v_pago_id;
end $$;

-- aplicar_nota_credito_ogemi (Ogemi → ventas_ogemi) con monto parcial
drop function if exists public.aplicar_nota_credito_ogemi(uuid, uuid, date);
create or replace function public.aplicar_nota_credito_ogemi(
  p_nota_id uuid, p_venta_id uuid, p_fecha date default current_date, p_monto numeric default null)
returns uuid language plpgsql security definer set search_path to 'public','app_private','pg_temp' as $$
declare v_nc public.notas_credito%rowtype; v_v public.ventas_ogemi%rowtype;
  v_saldo numeric; v_disp numeric; v_monto numeric; v_pago_id uuid;
begin
  if not app_private.has_module_permission('ventas_ogemi','editar') then
    raise exception 'No tienes permiso para aplicar notas de crédito a ventas Ogemi.';
  end if;
  select * into v_nc from public.notas_credito where id = p_nota_id for update;
  if not found then raise exception 'La nota de crédito no existe.'; end if;
  if v_nc.empresa <> 'ogemi' then raise exception 'La nota de crédito % es de Impresos Comerciales.', v_nc.numero; end if;
  v_disp := coalesce(v_nc.total,0) - public.monto_aplicado_nota_credito(p_nota_id);
  if v_disp <= 0.005 then raise exception 'La nota de crédito % ya no tiene saldo por usar.', coalesce(v_nc.numero,''); end if;

  select * into v_v from public.ventas_ogemi where id = p_venta_id for update;
  if not found then raise exception 'La venta no existe.'; end if;
  if v_v.cliente_id <> v_nc.cliente_id then raise exception 'La nota de crédito es de otro cliente.'; end if;
  v_saldo := (v_v.total - coalesce(v_v.retencion_monto,0)) - public.monto_pagado_venta_ogemi(p_venta_id);
  if v_saldo <= 0.005 then raise exception 'La venta no tiene saldo pendiente.'; end if;

  if p_monto is null then
    if v_nc.estado = 'disponible' and v_disp > v_saldo + 0.001 then
      raise exception 'La nota de crédito (%) excede el saldo de la venta (%). Indica el monto a descontar.', round(v_disp,2), round(v_saldo,2);
    end if;
    v_monto := round(least(v_disp, v_saldo), 2);
  else
    v_monto := round(p_monto, 2);
  end if;
  if v_monto <= 0 then raise exception 'El monto a descontar de la nota de crédito debe ser mayor a 0.'; end if;
  if v_monto > v_disp + 0.005 then
    raise exception 'El monto (%) excede el saldo disponible de la NC % (%).', v_monto, coalesce(v_nc.numero,''), round(v_disp,2);
  end if;
  if v_monto > v_saldo + 0.005 then
    raise exception 'El monto (%) excede el saldo de la venta (%).', v_monto, round(v_saldo,2);
  end if;

  insert into public.pagos (venta_ogemi_id, cuenta_id, monto, fecha, referencia, nota_credito_id)
  values (p_venta_id, null, v_monto, coalesce(p_fecha,current_date), 'NC '||coalesce(v_nc.numero,''), p_nota_id)
  returning id into v_pago_id;

  perform public._sync_nota_credito(p_nota_id);
  return v_pago_id;
end $$;

-- Liberar todas las aplicaciones de una NC (para borrarla o cambiarle cliente). Usa eliminar_pago (permisos + bitácora).
create or replace function public.liberar_nota_credito(p_nota_id uuid, p_motivo text default null)
returns int language plpgsql security definer set search_path to 'public','app_private','pg_temp' as $$
declare r record; n int := 0;
begin
  if not app_private.has_module_permission('notas_credito','editar') then
    raise exception 'No tienes permiso para modificar notas de crédito.';
  end if;
  for r in select id from public.pagos where nota_credito_id = p_nota_id order by fecha loop
    perform public.eliminar_pago(r.id, coalesce(nullif(trim(coalesce(p_motivo,'')),''), 'Liberación de nota de crédito'));
    n := n + 1;
  end loop;
  perform public._sync_nota_credito(p_nota_id);
  return n;
end $$;

-- Parches en funciones existentes (texto exacto; se valida que el reemplazo ocurra)
do $$
declare d text; d2 text;
begin
  -- 1) registrar_cobro_lote: NC con monto parcial (campo "monto" en p_ncs, opcional)
  d := pg_get_functiondef('public.registrar_cobro_lote(uuid,date,uuid,text,jsonb,jsonb,jsonb)'::regprocedure);
  d2 := replace(d,
$o$    SELECT total INTO v_nc_total FROM public.notas_credito WHERE id = (v_item->>'nota_credito_id')::uuid;
    PERFORM public.aplicar_nota_credito(
      (v_item->>'nota_credito_id')::uuid,
      (v_item->>'factura_id')::uuid,
      COALESCE(p_fecha,CURRENT_DATE),
      v_lote.id
    );$o$,
$n$    v_nc_pago := public.aplicar_nota_credito(
      (v_item->>'nota_credito_id')::uuid,
      (v_item->>'factura_id')::uuid,
      COALESCE(p_fecha,CURRENT_DATE),
      v_lote.id,
      nullif(v_item->>'monto','')::numeric
    );
    SELECT monto INTO v_nc_total FROM public.pagos WHERE id = v_nc_pago;$n$);
  if d2 = d then raise exception 'Parche registrar_cobro_lote no aplicó'; end if;
  d := d2;
  d2 := replace(d, $o$v_fids uuid[] := ARRAY[]::uuid[];$o$, $n$v_fids uuid[] := ARRAY[]::uuid[]; v_nc_pago uuid;$n$);
  if d2 = d then raise exception 'Parche registrar_cobro_lote (declare) no aplicó'; end if;
  execute d2;

  -- 2) _reversar_pago_core: recalcular la NC en vez de dejarla "disponible" completa
  d := pg_get_functiondef('public._reversar_pago_core(uuid,text,date)'::regprocedure);
  d2 := replace(d,
    $o$UPDATE public.notas_credito SET estado='disponible', factura_aplicada_id=NULL, venta_ogemi_aplicada_id=NULL, pago_id=NULL WHERE id=v_pago.nota_credito_id;$o$,
    $n$PERFORM public._sync_nota_credito(v_pago.nota_credito_id);$n$);
  if d2 = d then raise exception 'Parche _reversar_pago_core no aplicó'; end if;
  execute d2;

  -- 3) eliminar_pago: recalcular la NC después de borrar el pago
  d := pg_get_functiondef('public.eliminar_pago(uuid,text)'::regprocedure);
  d2 := replace(d,
    $o$update public.notas_credito set estado = 'disponible', factura_aplicada_id = null, venta_ogemi_aplicada_id = null, pago_id = null where id = v_old.nota_credito_id;$o$,
    $n$null; -- la NC se recalcula tras borrar el pago$n$);
  if d2 = d then raise exception 'Parche eliminar_pago (1) no aplicó'; end if;
  d := d2;
  d2 := replace(d,
    $o$  delete from public.pagos where id = p_pago_id;
$o$,
    $n$  delete from public.pagos where id = p_pago_id;
  perform public._sync_nota_credito(v_old.nota_credito_id);
$n$);
  if d2 = d then raise exception 'Parche eliminar_pago (2) no aplicó'; end if;
  execute d2;
end $$;

revoke execute on function public.aplicar_nota_credito(uuid,uuid,date,uuid,numeric) from public, anon;
revoke execute on function public.aplicar_nota_credito_ogemi(uuid,uuid,date,numeric) from public, anon;
revoke execute on function public.liberar_nota_credito(uuid,text) from public, anon;
revoke execute on function public.monto_aplicado_nota_credito(uuid) from public, anon;
revoke execute on function public.trg_pagos_sync_nc() from public, anon, authenticated;
revoke execute on function public.trg_pago_reversos_sync_nc() from public, anon, authenticated;
grant execute on function public.monto_aplicado_nota_credito(uuid) to authenticated;
grant execute on function public.aplicar_nota_credito(uuid,uuid,date,uuid,numeric) to authenticated;
grant execute on function public.aplicar_nota_credito_ogemi(uuid,uuid,date,numeric) to authenticated;
grant execute on function public.liberar_nota_credito(uuid,text) to authenticated;

notify pgrst, 'reload schema';
