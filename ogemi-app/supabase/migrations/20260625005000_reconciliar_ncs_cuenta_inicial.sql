-- Reconciliación única de las NC históricas del libro de venta (2026-06-25).
-- Crea la NC en notas_credito, la aplica a su factura afectada y sustituye la porción
-- correspondiente del pago placeholder "Cuenta Inicial" (lo elimina si la NC lo cubre
-- por completo, o lo reduce si es parcial). El total pagado de la factura no cambia.
-- Respeta periodos cerrados: omite las NC cuyo pago Cuenta Inicial cae en mes cerrado.
-- Idempotente (solo procesa NC importadas con factura_aplicada_id NULL).
-- Ejecutada en prod vía: SELECT public.reconciliar_ncs_cuenta_inicial();
--   Resultado 2026-06-25: 18 reconciliadas, 6 omitidas por periodo cerrado (cierre hasta 2026-03-31).
CREATE OR REPLACE FUNCTION public.reconciliar_ncs_cuenta_inicial()
 RETURNS TABLE(nc_num int, factura_num int, accion text, credito numeric)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
  c_inicial uuid := '23f21709-570b-487c-86d4-66ba21540a60';
  r record; v_f public.facturas%ROWTYPE; v_p public.pagos%ROWTYPE; v_credito numeric; v_nc_id uuid; v_pago uuid; v_lim date;
BEGIN
  PERFORM set_config('app.allow_pago_mutation','on', true);
  v_lim := public.fecha_cierre_bloqueo(c_inicial);
  FOR r IN
    SELECT * FROM public.facturas
    WHERE tipo_documento ILIKE '%credito%' AND factura_aplicada_id IS NULL
      AND documento_afectado IS NOT NULL AND total < 0
    ORDER BY fecha, numero_factura
    FOR UPDATE
  LOOP
    SELECT * INTO v_f FROM public.facturas
      WHERE numero_factura=r.documento_afectado AND cliente_id=r.cliente_id AND tipo_documento NOT ILIKE '%credito%'
      ORDER BY fecha LIMIT 1;
    IF NOT FOUND THEN
      nc_num:=r.numero_factura; factura_num:=r.documento_afectado; accion:='sin factura afectada'; credito:=abs(r.total); RETURN NEXT; CONTINUE;
    END IF;

    v_credito := abs(r.total);
    SELECT p.* INTO v_p FROM public.pagos p
      LEFT JOIN public.pago_reversos pr ON pr.pago_id=p.id
      WHERE p.factura_id=v_f.id AND p.cuenta_id=c_inicial AND pr.id IS NULL
      ORDER BY p.monto DESC LIMIT 1;
    IF NOT FOUND THEN
      nc_num:=r.numero_factura; factura_num:=v_f.numero_factura; accion:='sin pago Cuenta Inicial - omitida'; credito:=v_credito; RETURN NEXT; CONTINUE;
    END IF;

    IF v_lim IS NOT NULL AND v_p.fecha <= v_lim THEN
      nc_num:=r.numero_factura; factura_num:=v_f.numero_factura; accion:='periodo cerrado - omitida'; credito:=v_credito; RETURN NEXT; CONTINUE;
    END IF;

    IF v_p.monto <= v_credito + 0.001 THEN
      DELETE FROM public.banco_movimientos WHERE pago_id=v_p.id;
      DELETE FROM public.pagos WHERE id=v_p.id;
    ELSE
      UPDATE public.banco_movimientos SET monto = monto - v_credito WHERE pago_id=v_p.id;
      UPDATE public.pagos SET monto = v_p.monto - v_credito WHERE id=v_p.id;
    END IF;

    INSERT INTO public.notas_credito (numero, cliente_id, fecha, monto, itbms)
      VALUES ('NC '||r.numero_factura, v_f.cliente_id, r.fecha, abs(r.monto), abs(r.itbms))
      RETURNING id INTO v_nc_id;
    INSERT INTO public.pagos (factura_id, cuenta_id, monto, fecha, referencia, nota_credito_id)
      VALUES (v_f.id, NULL, v_credito, r.fecha, 'NC '||r.numero_factura, v_nc_id)
      RETURNING id INTO v_pago;
    UPDATE public.notas_credito SET estado='aplicada', factura_aplicada_id=v_f.id, pago_id=v_pago WHERE id=v_nc_id;
    UPDATE public.facturas SET factura_aplicada_id=v_f.id WHERE id=r.id;

    nc_num:=r.numero_factura; factura_num:=v_f.numero_factura; accion:='reconciliada'; credito:=v_credito; RETURN NEXT;
  END LOOP;
END $$;
