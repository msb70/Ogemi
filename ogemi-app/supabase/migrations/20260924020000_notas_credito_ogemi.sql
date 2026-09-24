-- 2026-09-24 · Aplicada en prod (tnuzaaetfbbnxtbedlhs) vía MCP como "notas_credito_ogemi".
-- NC de Impresora Ogemi en la misma tabla notas_credito, separadas por columna empresa.
-- Se aplican como pago de ventas_ogemi (pago con nota_credito_id, sin movimiento de banco).
-- Probado con rollback: aplica, no mueve banco, no se aplica dos veces, no cruza empresas,
-- borrar el pago libera la NC.

alter table public.notas_credito
  add column if not exists empresa text not null default 'impresos',
  add column if not exists venta_ogemi_aplicada_id uuid references public.ventas_ogemi(id);
alter table public.notas_credito drop constraint if exists notas_credito_empresa_check;
alter table public.notas_credito add constraint notas_credito_empresa_check check (empresa in ('impresos','ogemi'));
alter table public.notas_credito drop constraint if exists notas_credito_aplicacion_empresa_check;
alter table public.notas_credito add constraint notas_credito_aplicacion_empresa_check check (
  (empresa = 'impresos' and venta_ogemi_aplicada_id is null) or (empresa = 'ogemi' and factura_aplicada_id is null));
create index if not exists notas_credito_empresa_idx on public.notas_credito(empresa, estado);

drop policy if exists ver_notas_credito on public.notas_credito;
create policy ver_notas_credito on public.notas_credito for select using (
  app_private.has_module_permission('notas_credito','ver') or app_private.has_module_permission('facturas','ver')
  or app_private.has_module_permission('reportes','ver') or app_private.has_module_permission('dashboard','ver')
  or app_private.has_module_permission('ventas_ogemi','ver'));

-- Parches sobre funciones existentes (pg_get_functiondef + replace)
do $$
declare d text;
begin
  d := pg_get_functiondef('public.procesar_pago()'::regprocedure);
  d := replace(d, E'IF NEW.anticipo_id IS NULL AND NEW.lote_id IS NULL THEN\n      INSERT INTO public.banco_movimientos (cuenta_id, venta_ogemi_id',
                  E'IF NEW.anticipo_id IS NULL AND NEW.lote_id IS NULL AND NEW.nota_credito_id IS NULL THEN\n      INSERT INTO public.banco_movimientos (cuenta_id, venta_ogemi_id');
  if position(E'NEW.nota_credito_id IS NULL THEN\n      INSERT INTO public.banco_movimientos (cuenta_id, venta_ogemi_id' in d) = 0 then
    raise exception 'parche procesar_pago no aplicado';
  end if;
  execute d;

  d := pg_get_functiondef('public._reversar_pago_core(uuid,text,date)'::regprocedure);
  d := replace(d, E'IF v_pago.anticipo_id IS NULL THEN\n      INSERT INTO public.banco_movimientos (cuenta_id, venta_ogemi_id',
                  E'IF v_pago.anticipo_id IS NULL AND v_pago.nota_credito_id IS NULL THEN\n      INSERT INTO public.banco_movimientos (cuenta_id, venta_ogemi_id');
  d := replace(d, $x$UPDATE public.notas_credito SET estado='disponible', factura_aplicada_id=NULL, pago_id=NULL$x$,
                  $x$UPDATE public.notas_credito SET estado='disponible', factura_aplicada_id=NULL, venta_ogemi_aplicada_id=NULL, pago_id=NULL$x$);
  if position('venta_ogemi_aplicada_id=NULL' in d) = 0 or position(E'v_pago.nota_credito_id IS NULL THEN\n      INSERT INTO public.banco_movimientos (cuenta_id, venta_ogemi_id' in d) = 0 then
    raise exception 'parche _reversar_pago_core no aplicado';
  end if;
  execute d;

  d := pg_get_functiondef('public.eliminar_pago(uuid,text)'::regprocedure);
  d := replace(d, $x$update public.notas_credito set estado = 'disponible', factura_aplicada_id = null, pago_id = null$x$,
                  $x$update public.notas_credito set estado = 'disponible', factura_aplicada_id = null, venta_ogemi_aplicada_id = null, pago_id = null$x$);
  if position('venta_ogemi_aplicada_id = null' in d) = 0 then raise exception 'parche eliminar_pago no aplicado'; end if;
  execute d;

  d := pg_get_functiondef('public.auto_aplicar_ncs_disponibles()'::regprocedure);
  d := replace(d, $x$WHERE estado = 'disponible' AND documento_afectado IS NOT NULL$x$,
                  $x$WHERE estado = 'disponible' AND documento_afectado IS NOT NULL AND empresa = 'impresos'$x$);
  if position($x$AND empresa = 'impresos'$x$ in d) = 0 then raise exception 'parche auto_aplicar no aplicado'; end if;
  execute d;

  d := pg_get_functiondef('public.aplicar_nota_credito(uuid,uuid,date,uuid)'::regprocedure);
  d := replace(d, $x$IF COALESCE(v_nc.total,0) <= 0 THEN RAISE EXCEPTION 'La nota de crédito no tiene monto.'; END IF;$x$,
                  $x$IF COALESCE(v_nc.total,0) <= 0 THEN RAISE EXCEPTION 'La nota de crédito no tiene monto.'; END IF;
  IF v_nc.empresa <> 'impresos' THEN RAISE EXCEPTION 'La nota de crédito % es de Impresora Ogemi y no puede aplicarse a facturas de Impresos Comerciales.', v_nc.numero; END IF;$x$);
  if position($x$v_nc.empresa <> 'impresos'$x$ in d) = 0 then raise exception 'parche aplicar_nota_credito no aplicado'; end if;
  execute d;
end $$;

create or replace function public.aplicar_nota_credito_ogemi(p_nota_id uuid, p_venta_id uuid, p_fecha date default current_date)
returns uuid language plpgsql security definer set search_path = public, app_private, pg_temp as $$
declare v_nc public.notas_credito%rowtype; v_v public.ventas_ogemi%rowtype; v_saldo numeric; v_pago_id uuid;
begin
  if not app_private.has_module_permission('ventas_ogemi','editar') then
    raise exception 'No tienes permiso para aplicar notas de crédito a ventas Ogemi.';
  end if;
  select * into v_nc from public.notas_credito where id = p_nota_id for update;
  if not found then raise exception 'La nota de crédito no existe.'; end if;
  if v_nc.empresa <> 'ogemi' then raise exception 'La nota de crédito % es de Impresos Comerciales.', v_nc.numero; end if;
  if v_nc.estado <> 'disponible' then raise exception 'La nota de crédito ya fue aplicada.'; end if;
  if coalesce(v_nc.total,0) <= 0 then raise exception 'La nota de crédito no tiene monto.'; end if;

  select * into v_v from public.ventas_ogemi where id = p_venta_id for update;
  if not found then raise exception 'La venta no existe.'; end if;
  if v_v.cliente_id <> v_nc.cliente_id then raise exception 'La nota de crédito es de otro cliente.'; end if;
  v_saldo := (v_v.total - coalesce(v_v.retencion_monto,0)) - public.monto_pagado_venta_ogemi(p_venta_id);
  if v_nc.total > v_saldo + 0.001 then
    raise exception 'La nota de crédito (%) excede el saldo de la venta (%).', v_nc.total, round(v_saldo,2);
  end if;

  insert into public.pagos (venta_ogemi_id, cuenta_id, monto, fecha, referencia, nota_credito_id)
  values (p_venta_id, null, v_nc.total, coalesce(p_fecha,current_date), 'NC '||coalesce(v_nc.numero,''), p_nota_id)
  returning id into v_pago_id;

  update public.notas_credito set estado = 'aplicada', venta_ogemi_aplicada_id = p_venta_id, pago_id = v_pago_id where id = p_nota_id;
  return v_pago_id;
end $$;
revoke execute on function public.aplicar_nota_credito_ogemi(uuid,uuid,date) from public, anon;
grant execute on function public.aplicar_nota_credito_ogemi(uuid,uuid,date) to authenticated, service_role;

notify pgrst, 'reload schema';
