-- Retención de ITBMS en facturas
-- (aplicada a prod vía MCP el 2026-06-24; este archivo deja el registro en el repo)
--
-- retencion_pct: % manual por factura (default 0 = sin retención)
-- retencion_monto: generado = round(pct% * itbms, 2)
-- comprobante: checkmark + fecha de entrega del comprobante por el cliente
-- monto a cobrar (efectivo) = total - retencion_monto
-- estado 'falta_retencion': se cobró todo lo cobrable pero falta el comprobante

ALTER TABLE public.facturas
  ADD COLUMN IF NOT EXISTS retencion_pct numeric(5,2) NOT NULL DEFAULT 0
    CHECK (retencion_pct >= 0 AND retencion_pct <= 100),
  ADD COLUMN IF NOT EXISTS retencion_comprobante_entregado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retencion_comprobante_fecha date;

ALTER TABLE public.facturas
  ADD COLUMN IF NOT EXISTS retencion_monto numeric(12,2)
    GENERATED ALWAYS AS (round(COALESCE(retencion_pct,0)/100.0 * COALESCE(itbms,0), 2)) STORED;

ALTER TABLE public.facturas DROP CONSTRAINT IF EXISTS facturas_estado_check;
ALTER TABLE public.facturas ADD CONSTRAINT facturas_estado_check
  CHECK (estado IN ('pendiente','pagada','falta_retencion'));

-- Función central de cálculo de estado (única fuente de verdad)
CREATE OR REPLACE FUNCTION public.calc_estado_factura(
  p_total numeric, p_monto_pagado numeric, p_retencion_monto numeric, p_comprobante boolean
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN COALESCE(p_total,0) <= 0 THEN 'pendiente'
    WHEN COALESCE(p_monto_pagado,0) >= (p_total - COALESCE(p_retencion_monto,0)) THEN
      CASE WHEN COALESCE(p_retencion_monto,0) > 0 AND NOT COALESCE(p_comprobante,false)
           THEN 'falta_retencion' ELSE 'pagada' END
    ELSE 'pendiente'
  END
$$;

-- Recalcular estado en CADA update de la factura (incluye marcar el comprobante)
CREATE OR REPLACE FUNCTION public.factura_recalc_estado()
RETURNS trigger LANGUAGE plpgsql SET search_path = 'public' AS $$
DECLARE v_ret numeric;
BEGIN
  v_ret := round(COALESCE(NEW.retencion_pct,0)/100.0 * COALESCE(NEW.itbms,0), 2);
  NEW.estado := public.calc_estado_factura(NEW.total, NEW.monto_pagado, v_ret, NEW.retencion_comprobante_entregado);
  IF NEW.estado = 'pagada' AND NEW.fecha_cobro IS NULL THEN
    NEW.fecha_cobro := CURRENT_DATE;
  END IF;
  RETURN NEW;
END $$;

-- procesar_pago: la rama de facturas usa el umbral cobrable = total - retención
CREATE OR REPLACE FUNCTION public.procesar_pago()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_monto_pagado numeric; v_concepto text;
  v_total numeric; v_ret numeric; v_comp boolean;
BEGIN
  IF NEW.factura_id IS NOT NULL THEN
    SELECT numero_factura::text INTO v_concepto FROM public.facturas WHERE id = NEW.factura_id;
    IF NEW.anticipo_id IS NULL THEN
      INSERT INTO public.banco_movimientos (cuenta_id, factura_id, pago_id, tipo, concepto, monto, fecha, referencia)
      VALUES (NEW.cuenta_id, NEW.factura_id, NEW.id, 'ingreso',
        'Cobro factura #' || COALESCE(v_concepto,'') || COALESCE(' - ' || NEW.referencia,''), NEW.monto, NEW.fecha, NEW.referencia);
    END IF;
    SELECT total, round(COALESCE(retencion_pct,0)/100.0 * COALESCE(itbms,0), 2), retencion_comprobante_entregado
      INTO v_total, v_ret, v_comp FROM public.facturas WHERE id = NEW.factura_id;
    v_monto_pagado := public.monto_pagado_factura(NEW.factura_id);
    UPDATE public.facturas SET monto_pagado = v_monto_pagado,
      estado = public.calc_estado_factura(v_total, v_monto_pagado, v_ret, v_comp),
      fecha_cobro = CASE WHEN v_monto_pagado >= (v_total - v_ret) THEN NEW.fecha ELSE NULL END,
      banco_cuenta_id = CASE WHEN v_monto_pagado >= (v_total - v_ret) THEN NEW.cuenta_id ELSE NULL END
    WHERE id = NEW.factura_id;

  ELSIF NEW.compra_id IS NOT NULL THEN
    SELECT concepto INTO v_concepto FROM public.compras WHERE id = NEW.compra_id;
    IF NEW.anticipo_id IS NULL THEN
      INSERT INTO public.banco_movimientos (cuenta_id, compra_id, pago_id, tipo, concepto, monto, fecha, referencia)
      VALUES (NEW.cuenta_id, NEW.compra_id, NEW.id, 'egreso',
        'Pago compra: ' || COALESCE(v_concepto,'sin concepto') || COALESCE(' - ' || NEW.referencia,''), NEW.monto, NEW.fecha, NEW.referencia);
    END IF;
    v_monto_pagado := public.monto_pagado_compra(NEW.compra_id);
    UPDATE public.compras SET monto_pagado = v_monto_pagado,
      estado = CASE WHEN v_monto_pagado >= total THEN 'pagada' ELSE 'pendiente' END,
      fecha_pago = CASE WHEN v_monto_pagado >= total THEN NEW.fecha ELSE NULL END,
      banco_cuenta_id = CASE WHEN v_monto_pagado >= total THEN NEW.cuenta_id ELSE NULL END
    WHERE id = NEW.compra_id;

  ELSIF NEW.presupuesto_id IS NOT NULL THEN
    SELECT numero_presupuesto::text INTO v_concepto FROM public.presupuestos WHERE id = NEW.presupuesto_id;
    IF NEW.anticipo_id IS NULL THEN
      INSERT INTO public.banco_movimientos (cuenta_id, presupuesto_id, pago_id, tipo, concepto, monto, fecha, referencia)
      VALUES (NEW.cuenta_id, NEW.presupuesto_id, NEW.id, 'ingreso',
        'Cobro presupuesto #' || COALESCE(v_concepto,'') || COALESCE(' - ' || NEW.referencia,''), NEW.monto, NEW.fecha, NEW.referencia);
    END IF;
    v_monto_pagado := public.monto_pagado_presupuesto(NEW.presupuesto_id);
    UPDATE public.presupuestos SET monto_pagado = v_monto_pagado,
      estado = CASE WHEN v_monto_pagado >= total THEN 'pagada' ELSE 'pendiente' END,
      fecha_cobro = CASE WHEN v_monto_pagado >= total THEN NEW.fecha ELSE NULL END,
      banco_cuenta_id = CASE WHEN v_monto_pagado >= total THEN NEW.cuenta_id ELSE NULL END
    WHERE id = NEW.presupuesto_id;
  END IF;
  RETURN NEW;
END;
$function$;
