-- Aplicada en prod (tnuz) el 2026-09-22 vía MCP como migración `editar_deposito_anticipo`.
-- Permite modificar el depósito de banco de un anticipo (monto, fecha, cuenta, n° depósito, notas)
-- actualizando también su ingreso en banco_movimientos. Auditado en pagos_auditoria.
alter table public.pagos_auditoria drop constraint pagos_auditoria_accion_check;
alter table public.pagos_auditoria add constraint pagos_auditoria_accion_check
  check (accion = any (array['editar','borrar','anticipo_cliente','borrar_documento','anticipo_deposito']));

create or replace function public.editar_deposito_anticipo(
  p_anticipo_id uuid, p_monto numeric, p_fecha date, p_cuenta_id uuid,
  p_numero_deposito text, p_notas text default null, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path to 'public', 'app_private', 'pg_temp'
as $function$
declare
  v_a public.anticipos%rowtype;
  v_mod text; v_aplicado numeric; v_cli text; v_ref text; v_nuevo_estado text; v_mov int;
begin
  select * into v_a from public.anticipos where id = p_anticipo_id for update;
  if not found then raise exception 'El anticipo no existe.'; end if;
  v_mod := case when v_a.empresa = 'ogemi' then 'ventas_ogemi' else 'facturas' end;
  if not app_private.has_module_permission(v_mod, 'editar') then
    raise exception 'No tienes permiso para editar anticipos.';
  end if;
  if v_a.estado = 'anulado' then raise exception 'El anticipo está anulado; no se puede modificar.'; end if;
  if p_monto is null or p_monto <= 0 then raise exception 'El monto debe ser mayor que cero.'; end if;
  if p_fecha is null then raise exception 'Indique la fecha del depósito.'; end if;
  if p_cuenta_id is null or not exists (select 1 from public.banco_cuentas where id = p_cuenta_id) then
    raise exception 'Seleccione una cuenta de banco válida.';
  end if;

  v_ref := nullif(trim(coalesce(p_numero_deposito,'')),'');

  -- Cierres de banco: los valores viejos y los nuevos deben estar en periodo abierto
  perform public._check_periodo_abierto(v_a.cuenta_id, v_a.fecha, 'modificar el depósito del anticipo');
  perform public._check_periodo_abierto(p_cuenta_id, p_fecha, 'modificar el depósito del anticipo');

  v_aplicado := public.monto_aplicado_anticipo(p_anticipo_id);
  if round(p_monto, 2) < round(v_aplicado, 2) then
    raise exception 'El monto (%) no puede ser menor que lo ya aplicado a documentos (%). Borre primero esas aplicaciones.',
      to_char(p_monto,'FM999G999G990D00'), to_char(v_aplicado,'FM999G999G990D00');
  end if;

  select nombre into v_cli from public.clientes where id = v_a.cliente_id;
  v_nuevo_estado := case when v_aplicado >= p_monto then 'aplicado' else 'activo' end;

  update public.anticipos
     set monto = p_monto, fecha = p_fecha, cuenta_id = p_cuenta_id,
         numero_deposito = v_ref, notas = nullif(trim(coalesce(p_notas,'')),''),
         estado = v_nuevo_estado
   where id = p_anticipo_id;

  update public.banco_movimientos
     set monto = p_monto, fecha = p_fecha, cuenta_id = p_cuenta_id, referencia = v_ref,
         concepto = (case when v_a.empresa = 'ogemi' then 'Anticipo Ogemi ' else 'Anticipo ' end)
                    || coalesce(v_cli,'') || coalesce(' - ' || v_ref,'')
   where anticipo_id = p_anticipo_id and pago_id is null and pago_reverso_id is null and tipo = 'ingreso';
  get diagnostics v_mov = row_count;
  if v_mov <> 1 then
    raise exception 'No se encontró un único movimiento de banco para este anticipo (encontrados: %).', v_mov;
  end if;

  insert into public.pagos_auditoria (pago_id, accion, documento_tipo, documento_id, antes, despues, motivo)
  values (null, 'anticipo_deposito', 'anticipos', p_anticipo_id,
    jsonb_build_object('_tercero', v_cli, 'monto', v_a.monto, 'fecha', v_a.fecha, 'cuenta_id', v_a.cuenta_id,
                       'numero_deposito', v_a.numero_deposito, 'notas', v_a.notas, 'numero_recibo', v_a.numero_recibo),
    jsonb_build_object('monto', p_monto, 'fecha', p_fecha, 'cuenta_id', p_cuenta_id,
                       'numero_deposito', v_ref, 'notas', nullif(trim(coalesce(p_notas,'')),'')),
    nullif(trim(coalesce(p_motivo,'')),''));
end $function$;

revoke execute on function public.editar_deposito_anticipo(uuid,numeric,date,uuid,text,text,text) from public, anon;
grant execute on function public.editar_deposito_anticipo(uuid,numeric,date,uuid,text,text,text) to authenticated;
