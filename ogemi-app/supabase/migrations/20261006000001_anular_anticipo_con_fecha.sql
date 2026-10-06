-- 2026-10-06: anular anticipo con fecha elegida para el egreso.
-- Nueva sobrecarga anular_anticipo(uuid, text, date); la de 2 args sigue (egreso con fecha de hoy).
-- Valida: no antes del depósito, no futura, no en periodo de banco cerrado (_check_periodo_abierto).
-- La fecha llega al trigger procesar_anticipo por el GUC local app.anular_anticipo_fecha.
create or replace function public.procesar_anticipo()
 returns trigger language plpgsql set search_path to 'public','pg_temp' as $function$
DECLARE v_nombre text; v_pre text; v_apl text; v_fecha date;
BEGIN
  v_pre := CASE WHEN NEW.empresa = 'ogemi' THEN 'Anticipo Ogemi ' ELSE 'Anticipo ' END;
  IF TG_OP = 'INSERT' THEN
    SELECT nombre INTO v_nombre FROM public.clientes WHERE id = NEW.cliente_id;
    INSERT INTO public.banco_movimientos (cuenta_id, anticipo_id, tipo, concepto, monto, fecha, referencia)
    VALUES (NEW.cuenta_id, NEW.id, 'ingreso',
      v_pre || COALESCE(v_nombre,'') || COALESCE(' - ' || NEW.numero_deposito,''), NEW.monto, NEW.fecha, NEW.numero_deposito);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' AND NEW.estado = 'anulado' AND OLD.estado <> 'anulado' THEN
    v_apl := public._anticipo_aplicaciones_txt(NEW.id);
    IF v_apl <> '' THEN
      RAISE EXCEPTION 'No se puede anular: el anticipo está aplicado a documentos. Primero reversa (botón Borrar en el cobro del documento) estas aplicaciones: %', v_apl
        USING ERRCODE = 'P0001';
    END IF;
    v_fecha := COALESCE(NULLIF(current_setting('app.anular_anticipo_fecha', true), '')::date, CURRENT_DATE);
    INSERT INTO public.banco_movimientos (cuenta_id, anticipo_id, tipo, concepto, monto, fecha, referencia)
    VALUES (NEW.cuenta_id, NEW.id, 'egreso',
      'Anulación anticipo' || CASE WHEN NEW.empresa = 'ogemi' THEN ' Ogemi' ELSE '' END
        || COALESCE(' - ' || NEW.numero_deposito,''), NEW.monto, v_fecha, NEW.numero_deposito);
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$function$;


create or replace function public.anular_anticipo(p_anticipo_id uuid, p_motivo text, p_fecha date)
returns void language plpgsql security definer
set search_path to 'public','app_private','pg_temp' as $$
declare v_a public.anticipos%rowtype; v_mod text; v_cli text; v_apl text; v_fecha date;
begin
  select * into v_a from public.anticipos where id = p_anticipo_id for update;
  if not found then raise exception 'El anticipo no existe.'; end if;
  v_mod := case when v_a.empresa = 'ogemi' then 'ventas_ogemi' else 'facturas' end;
  if not app_private.has_module_permission(v_mod, 'editar') then
    raise exception 'No tienes permiso para anular anticipos.';
  end if;
  if v_a.estado = 'anulado' then raise exception 'El anticipo ya está anulado.'; end if;
  v_apl := public._anticipo_aplicaciones_txt(p_anticipo_id);
  if v_apl <> '' then
    raise exception 'No se puede anular: el anticipo está aplicado a documentos. Primero reversa (botón Borrar en el cobro del documento) estas aplicaciones: %', v_apl;
  end if;

  v_fecha := coalesce(p_fecha, current_date);
  if v_fecha < v_a.fecha then
    raise exception 'La fecha de anulación (%) no puede ser anterior a la fecha del depósito (%).',
      to_char(v_fecha,'DD/MM/YYYY'), to_char(v_a.fecha,'DD/MM/YYYY');
  end if;
  if v_fecha > current_date + 1 then  -- +1: margen por zona horaria (Panamá vs UTC)
    raise exception 'La fecha de anulación (%) no puede ser futura.', to_char(v_fecha,'DD/MM/YYYY');
  end if;
  perform public._check_periodo_abierto(v_a.cuenta_id, v_fecha, 'anular el anticipo con esa fecha');

  perform set_config('app.anular_anticipo_fecha', v_fecha::text, true);
  update public.anticipos set estado = 'anulado' where id = p_anticipo_id;
  perform set_config('app.anular_anticipo_fecha', '', true);

  select nombre into v_cli from public.clientes where id = v_a.cliente_id;
  insert into public.pagos_auditoria (pago_id, accion, documento_tipo, documento_id, antes, despues, motivo)
  values (null, 'anticipo_anular', 'anticipos', p_anticipo_id,
          jsonb_build_object('estado', v_a.estado, 'cliente_id', v_a.cliente_id, 'cliente', v_cli,
                             'monto', v_a.monto, 'fecha', v_a.fecha, 'numero_recibo', v_a.numero_recibo,
                             'cuenta_id', v_a.cuenta_id),
          jsonb_build_object('estado', 'anulado', 'egreso_fecha', v_fecha, 'cliente', v_cli),
          nullif(trim(coalesce(p_motivo,'')),''));
end $$;
revoke all on function public.anular_anticipo(uuid, text, date) from public, anon;
grant execute on function public.anular_anticipo(uuid, text, date) to authenticated;

notify pgrst, 'reload schema';
