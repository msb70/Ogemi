-- Auto-aplica las NC importadas (facturas tipo CRÉDITO) como pago de la factura
-- afectada (documento_afectado = numero_factura, mismo cliente). Idempotente:
-- salta las ya aplicadas y las que exceden el saldo (quedan para aplicación manual).
-- Se llama al final de cada importación del libro de ventas.
CREATE OR REPLACE FUNCTION public.auto_aplicar_ncs_importadas()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE r record; v_f public.facturas%ROWTYPE; v_ret numeric; v_saldo numeric; v_credito numeric; v_count int := 0; v_pago uuid;
BEGIN
  FOR r IN
    SELECT * FROM public.facturas
    WHERE tipo_documento ILIKE '%credito%'
      AND factura_aplicada_id IS NULL
      AND documento_afectado IS NOT NULL
      AND total < 0
    ORDER BY fecha, numero_factura
    FOR UPDATE
  LOOP
    SELECT * INTO v_f FROM public.facturas
      WHERE numero_factura = r.documento_afectado
        AND cliente_id = r.cliente_id
        AND tipo_documento NOT ILIKE '%credito%'
      ORDER BY fecha LIMIT 1;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_credito := abs(r.total);
    IF v_credito <= 0 THEN CONTINUE; END IF;

    v_ret := round(COALESCE(v_f.retencion_pct,0)/100.0*COALESCE(v_f.itbms,0),2);
    v_saldo := (v_f.total - v_ret) - public.monto_pagado_factura(v_f.id);
    IF v_credito > v_saldo + 0.001 THEN CONTINUE; END IF;

    INSERT INTO public.pagos (factura_id, cuenta_id, monto, fecha, referencia, credito_factura_id)
    VALUES (v_f.id, NULL, v_credito, COALESCE(r.fecha, CURRENT_DATE), 'NC #'||r.numero_factura||' (auto)', r.id)
    RETURNING id INTO v_pago;

    UPDATE public.facturas SET factura_aplicada_id = v_f.id WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;

REVOKE EXECUTE ON FUNCTION public.auto_aplicar_ncs_importadas() FROM anon;
GRANT EXECUTE ON FUNCTION public.auto_aplicar_ncs_importadas() TO authenticated;
