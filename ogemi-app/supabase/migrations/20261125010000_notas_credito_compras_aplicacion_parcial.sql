-- Notas de crédito de PROVEEDORES con aplicación parcial (Impresos y Ogemi)
-- La NC sigue en compras (total negativo). Lo aplicado se guarda como monto_pagado NEGATIVO,
-- así total − monto_pagado = −saldo por usar y los cálculos de CxP existentes siguen cuadrando.
-- estado: 'pendiente' mientras tenga saldo, 'pagada' al agotarse. compra_aplicada_id = última compra destino.

create or replace function public.monto_aplicado_nc_compra(p_nc_id uuid)
returns numeric language sql stable set search_path to 'public','pg_temp' as $$
  select coalesce(sum(p.monto),0) from public.pagos p
   where p.credito_compra_id = p_nc_id
     and not exists (select 1 from public.pago_reversos r where r.pago_id = p.id)
$$;

create or replace function public._sync_nc_compra(p_nc_id uuid)
returns void language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_total numeric; v_apl numeric; v_last public.pagos%rowtype;
begin
  if p_nc_id is null then return; end if;
  select total into v_total from public.compras where id = p_nc_id and total < 0;
  if not found then return; end if;
  v_apl := public.monto_aplicado_nc_compra(p_nc_id);
  if v_apl <= 0.005 then
    update public.compras set monto_pagado = 0, compra_aplicada_id = null, estado = 'pendiente',
      fecha_pago = null, banco_cuenta_id = null
    where id = p_nc_id;
    return;
  end if;
  select p.* into v_last from public.pagos p
   where p.credito_compra_id = p_nc_id
     and not exists (select 1 from public.pago_reversos r where r.pago_id = p.id)
   order by p.fecha desc, p.created_at desc limit 1;
  update public.compras set
    monto_pagado = -round(v_apl, 2),
    compra_aplicada_id = v_last.compra_id,
    estado = case when abs(v_total) - v_apl <= 0.01 then 'pagada' else 'pendiente' end,
    fecha_pago = case when abs(v_total) - v_apl <= 0.01 then v_last.fecha else null end,
    banco_cuenta_id = null
  where id = p_nc_id;
end $$;
revoke all on function public._sync_nc_compra(uuid) from public, anon, authenticated;

-- Guarda: una NC de proveedor con descuentos aplicados no cambia de monto, proveedor ni empresa
create or replace function public.trg_compras_nc_guard()
returns trigger language plpgsql set search_path to 'public','pg_temp' as $$
begin
  if old.total < 0 and coalesce(old.monto_pagado,0) < -0.005
     and (new.total is distinct from old.total or new.monto is distinct from old.monto
          or new.itbms is distinct from old.itbms
          or new.proveedor_id is distinct from old.proveedor_id or new.empresa is distinct from old.empresa) then
    raise exception 'La nota de crédito tiene % aplicado. Borra primero esos descuentos para poder modificarla.', abs(old.monto_pagado);
  end if;
  return new;
end $$;
drop trigger if exists trg_compras_nc_guard on public.compras;
create trigger trg_compras_nc_guard before update on public.compras
  for each row execute function public.trg_compras_nc_guard();

-- Los triggers de pagos / reversos también recalculan NC de proveedores
create or replace function public.trg_pagos_sync_nc()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $$
begin
  if tg_op in ('INSERT','UPDATE') then
    if new.nota_credito_id is not null then perform public._sync_nota_credito(new.nota_credito_id); end if;
    if new.credito_compra_id is not null then perform public._sync_nc_compra(new.credito_compra_id); end if;
  end if;
  if tg_op in ('DELETE','UPDATE') then
    if old.nota_credito_id is not null and (tg_op = 'DELETE' or old.nota_credito_id is distinct from new.nota_credito_id) then
      perform public._sync_nota_credito(old.nota_credito_id);
    end if;
    if old.credito_compra_id is not null and (tg_op = 'DELETE' or old.credito_compra_id is distinct from new.credito_compra_id) then
      perform public._sync_nc_compra(old.credito_compra_id);
    end if;
  end if;
  return null;
end $$;

create or replace function public.trg_pago_reversos_sync_nc()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_nc uuid; v_ncc uuid;
begin
  select nota_credito_id, credito_compra_id into v_nc, v_ncc from public.pagos
   where id = case when tg_op = 'DELETE' then old.pago_id else new.pago_id end;
  if v_nc is not null then perform public._sync_nota_credito(v_nc); end if;
  if v_ncc is not null then perform public._sync_nc_compra(v_ncc); end if;
  return null;
end $$;

-- aplicar_nc_compra con monto parcial
drop function if exists public.aplicar_nc_compra(uuid, uuid, date);
create or replace function public.aplicar_nc_compra(
  p_nc_id uuid, p_compra_id uuid, p_fecha date default current_date, p_monto numeric default null)
returns uuid language plpgsql security definer set search_path to 'public','app_private','pg_temp' as $$
declare v_nc public.compras%rowtype; v_c public.compras%rowtype;
  v_disp numeric; v_saldo numeric; v_monto numeric; v_pago_id uuid; v_ref text;
begin
  if not app_private.has_module_permission('compras','editar') then
    raise exception 'No tienes permiso para aplicar notas de crédito de compras.';
  end if;
  select * into v_nc from public.compras where id = p_nc_id for update;
  if not found then raise exception 'La nota de crédito no existe.'; end if;
  if coalesce(v_nc.total,0) >= 0 or upper(coalesce(v_nc.tipo_documento,'')) not like '%CREDITO%' then
    raise exception 'El documento seleccionado no es una nota de crédito.';
  end if;
  v_disp := abs(v_nc.total) - public.monto_aplicado_nc_compra(p_nc_id);
  if v_disp <= 0.005 then raise exception 'La nota de crédito ya no tiene saldo por usar.'; end if;

  select * into v_c from public.compras where id = p_compra_id for update;
  if not found then raise exception 'La compra no existe.'; end if;
  if v_c.proveedor_id <> v_nc.proveedor_id then raise exception 'La nota de crédito es de otro proveedor.'; end if;
  if v_c.empresa is distinct from v_nc.empresa then raise exception 'La nota de crédito es de otra empresa.'; end if;
  if coalesce(v_c.total,0) <= 0 then raise exception 'El documento destino no es una compra pagable.'; end if;
  v_saldo := v_c.total - public.monto_pagado_compra(p_compra_id);
  if v_saldo <= 0.005 then raise exception 'La compra no tiene saldo pendiente.'; end if;

  if p_monto is null then
    if public.monto_aplicado_nc_compra(p_nc_id) <= 0.005 and v_disp > v_saldo + 0.001 then
      raise exception 'La nota de crédito (%) excede el saldo de la compra (%). Indica el monto a descontar.', round(v_disp,2), round(v_saldo,2);
    end if;
    v_monto := round(least(v_disp, v_saldo), 2);
  else
    v_monto := round(p_monto, 2);
  end if;
  if v_monto <= 0 then raise exception 'El monto a descontar de la nota de crédito debe ser mayor a 0.'; end if;
  if v_monto > v_disp + 0.005 then
    raise exception 'El monto (%) excede el saldo disponible de la nota de crédito (%).', v_monto, round(v_disp,2);
  end if;
  if v_monto > v_saldo + 0.005 then
    raise exception 'El monto (%) excede el saldo de la compra (%).', v_monto, round(v_saldo,2);
  end if;

  v_ref := trim('NC ' || coalesce(v_nc.referencia, coalesce(v_nc.documento_afectado, '')));
  insert into public.pagos (compra_id, cuenta_id, monto, fecha, referencia, credito_compra_id)
  values (p_compra_id, null, v_monto, coalesce(p_fecha,current_date), v_ref, p_nc_id)
  returning id into v_pago_id;
  perform public._sync_nc_compra(p_nc_id);
  return v_pago_id;
end $$;

-- Reverso / borrado de un pago con NC de proveedor: recalcular en vez de dejarla libre completa
do $$
declare d text; d2 text;
begin
  d := pg_get_functiondef('public._reversar_pago_core(uuid,text,date)'::regprocedure);
  d2 := replace(d,
$o$    UPDATE public.compras
       SET compra_aplicada_id = NULL, estado = 'pendiente', fecha_pago = NULL, banco_cuenta_id = NULL
     WHERE id = v_pago.credito_compra_id;$o$,
$n$    PERFORM public._sync_nc_compra(v_pago.credito_compra_id);$n$);
  if d2 = d then raise exception 'Parche _reversar_pago_core (compras) no aplicó'; end if;
  execute d2;

  d := pg_get_functiondef('public.eliminar_pago(uuid,text)'::regprocedure);
  d2 := replace(d,
$o$    update public.compras set compra_aplicada_id = null, estado = 'pendiente', fecha_pago = null, banco_cuenta_id = null
     where id = v_old.credito_compra_id;$o$,
$n$    null; -- la NC de proveedor se recalcula al borrar el pago (trg_pagos_sync_nc)$n$);
  if d2 = d then raise exception 'Parche eliminar_pago (compras) no aplicó'; end if;
  execute d2;
end $$;

-- Backfill: solo NC de proveedor que tienen (o tuvieron) aplicaciones; no se toca el estado manual del resto
do $$ declare r record; begin
  for r in select distinct credito_compra_id id from public.pagos where credito_compra_id is not null loop
    perform public._sync_nc_compra(r.id);
  end loop;
end $$;

revoke execute on function public.aplicar_nc_compra(uuid,uuid,date,numeric) from public, anon;
revoke execute on function public.monto_aplicado_nc_compra(uuid) from public, anon;
grant execute on function public.aplicar_nc_compra(uuid,uuid,date,numeric) to authenticated;
grant execute on function public.monto_aplicado_nc_compra(uuid) to authenticated;

notify pgrst, 'reload schema';
