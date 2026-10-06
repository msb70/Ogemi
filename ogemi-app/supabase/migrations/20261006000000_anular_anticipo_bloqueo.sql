-- 2026-10-06: anular anticipo bloqueado si tiene aplicaciones vigentes (no reversadas).
-- RPC anular_anticipo (permiso editar facturas|ventas_ogemi, bitácora accion anticipo_anular) + candado en trigger procesar_anticipo.
-- Anular anticipo: bloqueado si tiene aplicaciones vigentes (no reversadas).
alter table public.pagos_auditoria drop constraint pagos_auditoria_accion_check;
alter table public.pagos_auditoria add constraint pagos_auditoria_accion_check
  check (accion = any (array['editar','borrar','anticipo_cliente','borrar_documento','anticipo_deposito','anticipo_anular']));

-- Lista legible de aplicaciones vigentes de un anticipo ('' si no hay)
create or replace function public._anticipo_aplicaciones_txt(p_anticipo_id uuid)
returns text language sql stable security definer set search_path to 'public','pg_temp' as $$
  select coalesce(string_agg(
           case when p.factura_id is not null then 'Factura ' || coalesce(f.numero_factura::text,'?')
                when p.presupuesto_id is not null then 'Presupuesto ' || coalesce(pr.numero_presupuesto::text,'?')
                when p.venta_ogemi_id is not null then 'Venta Ogemi ' || coalesce(v.numero::text,'?')
                else 'Documento' end
           || ' por ' || to_char(p.monto,'FM999,999,990.00')
           || ' del ' || to_char(p.fecha,'DD/MM/YYYY')
           || coalesce(' (REC-' || lpad(p.numero_recibo::text,5,'0') || ')',''),
           '; ' order by p.fecha, p.created_at), '')
    from public.pagos p
    left join public.facturas f on f.id = p.factura_id
    left join public.presupuestos pr on pr.id = p.presupuesto_id
    left join public.ventas_ogemi v on v.id = p.venta_ogemi_id
   where p.anticipo_id = p_anticipo_id
     and not exists (select 1 from public.pago_reversos r where r.pago_id = p.id);
$$;
revoke all on function public._anticipo_aplicaciones_txt(uuid) from public, anon;

-- Candado a nivel de trigger: ninguna vía puede anular con aplicaciones vigentes
create or replace function public.procesar_anticipo()
 returns trigger language plpgsql set search_path to 'public','pg_temp' as $function$
DECLARE v_nombre text; v_pre text; v_apl text;
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
    INSERT INTO public.banco_movimientos (cuenta_id, anticipo_id, tipo, concepto, monto, fecha, referencia)
    VALUES (NEW.cuenta_id, NEW.id, 'egreso',
      'Anulación anticipo' || CASE WHEN NEW.empresa = 'ogemi' THEN ' Ogemi' ELSE '' END
        || COALESCE(' - ' || NEW.numero_deposito,''), NEW.monto, CURRENT_DATE, NEW.numero_deposito);
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$function$;

-- RPC usada por la UI
create or replace function public.anular_anticipo(p_anticipo_id uuid, p_motivo text default null)
returns void language plpgsql security definer
set search_path to 'public','app_private','pg_temp' as $$
declare v_a public.anticipos%rowtype; v_mod text; v_cli text; v_apl text;
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

  update public.anticipos set estado = 'anulado' where id = p_anticipo_id;

  select nombre into v_cli from public.clientes where id = v_a.cliente_id;
  insert into public.pagos_auditoria (pago_id, accion, documento_tipo, documento_id, antes, despues, motivo)
  values (null, 'anticipo_anular', 'anticipos', p_anticipo_id,
          jsonb_build_object('estado', v_a.estado, 'cliente_id', v_a.cliente_id, 'cliente', v_cli,
                             'monto', v_a.monto, 'fecha', v_a.fecha, 'numero_recibo', v_a.numero_recibo,
                             'cuenta_id', v_a.cuenta_id),
          jsonb_build_object('estado', 'anulado', 'egreso_fecha', current_date, 'cliente', v_cli),
          nullif(trim(coalesce(p_motivo,'')),''));
end $$;
revoke all on function public.anular_anticipo(uuid, text) from public, anon;
grant execute on function public.anular_anticipo(uuid, text) to authenticated;

notify pgrst, 'reload schema';
