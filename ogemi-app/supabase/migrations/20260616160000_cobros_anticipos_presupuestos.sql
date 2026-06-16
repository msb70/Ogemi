-- ============================================================
-- Cobros con anticipo + cobro de presupuestos vía tabla pagos
-- ============================================================

-- 1. Nuevas columnas en pagos
ALTER TABLE public.pagos
  ADD COLUMN IF NOT EXISTS presupuesto_id uuid REFERENCES public.presupuestos(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS anticipo_id uuid REFERENCES public.anticipos(id) ON DELETE RESTRICT;

ALTER TABLE public.pagos DROP CONSTRAINT IF EXISTS pago_origen;
ALTER TABLE public.pagos ADD CONSTRAINT pago_origen CHECK (
  (factura_id IS NOT NULL)::int + (compra_id IS NOT NULL)::int + (presupuesto_id IS NOT NULL)::int = 1
);

-- 2. Columnas de trazabilidad en banco_movimientos
ALTER TABLE public.banco_movimientos
  ADD COLUMN IF NOT EXISTS presupuesto_id uuid REFERENCES public.presupuestos(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS anticipo_id uuid REFERENCES public.anticipos(id) ON DELETE RESTRICT;

-- 3. RLS de inserción de pagos: permitir presupuesto
DROP POLICY IF EXISTS editar_pagos ON public.pagos;
CREATE POLICY editar_pagos ON public.pagos FOR INSERT WITH CHECK (
  ((factura_id IS NOT NULL) AND app_private.has_module_permission('facturas','editar'))
  OR ((compra_id IS NOT NULL) AND app_private.has_module_permission('compras','editar'))
  OR ((presupuesto_id IS NOT NULL) AND app_private.has_module_permission('presupuestos','editar'))
);

-- 4. Helper: monto pagado de un presupuesto (descuenta reversos)
CREATE OR REPLACE FUNCTION public.monto_pagado_presupuesto(p_presupuesto_id uuid)
RETURNS numeric LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE(SUM(p.monto),0) - COALESCE(SUM(r.monto),0)
  FROM public.pagos p
  LEFT JOIN public.pago_reversos r ON r.pago_id = p.id
  WHERE p.presupuesto_id = p_presupuesto_id;
$$;

-- 5. procesar_pago: + presupuesto, y omite banco cuando el pago viene de un anticipo
CREATE OR REPLACE FUNCTION public.procesar_pago()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_monto_pagado numeric; v_concepto text;
BEGIN
  IF NEW.factura_id IS NOT NULL THEN
    SELECT numero_factura::text INTO v_concepto FROM public.facturas WHERE id = NEW.factura_id;
    IF NEW.anticipo_id IS NULL THEN
      INSERT INTO public.banco_movimientos (cuenta_id, factura_id, pago_id, tipo, concepto, monto, fecha, referencia)
      VALUES (NEW.cuenta_id, NEW.factura_id, NEW.id, 'ingreso',
        'Cobro factura #' || COALESCE(v_concepto,'') || COALESCE(' - ' || NEW.referencia,''), NEW.monto, NEW.fecha, NEW.referencia);
    END IF;
    v_monto_pagado := public.monto_pagado_factura(NEW.factura_id);
    UPDATE public.facturas SET monto_pagado = v_monto_pagado,
      estado = CASE WHEN v_monto_pagado >= total THEN 'pagada' ELSE 'pendiente' END,
      fecha_cobro = CASE WHEN v_monto_pagado >= total THEN NEW.fecha ELSE NULL END,
      banco_cuenta_id = CASE WHEN v_monto_pagado >= total THEN NEW.cuenta_id ELSE NULL END
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
$$;

-- 6. Anticipo: registra ingreso en banco al crear; egreso al anular
CREATE OR REPLACE FUNCTION public.procesar_anticipo()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_nombre text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT nombre INTO v_nombre FROM public.clientes WHERE id = NEW.cliente_id;
    INSERT INTO public.banco_movimientos (cuenta_id, anticipo_id, tipo, concepto, monto, fecha, referencia)
    VALUES (NEW.cuenta_id, NEW.id, 'ingreso',
      'Anticipo ' || COALESCE(v_nombre,'') || COALESCE(' - ' || NEW.numero_deposito,''), NEW.monto, NEW.fecha, NEW.numero_deposito);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' AND NEW.estado = 'anulado' AND OLD.estado <> 'anulado' THEN
    INSERT INTO public.banco_movimientos (cuenta_id, anticipo_id, tipo, concepto, monto, fecha, referencia)
    VALUES (NEW.cuenta_id, NEW.id, 'egreso',
      'Anulación anticipo' || COALESCE(' - ' || NEW.numero_deposito,''), NEW.monto, CURRENT_DATE, NEW.numero_deposito);
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_procesar_anticipo_ins ON public.anticipos;
CREATE TRIGGER trg_procesar_anticipo_ins AFTER INSERT ON public.anticipos
  FOR EACH ROW EXECUTE FUNCTION public.procesar_anticipo();
DROP TRIGGER IF EXISTS trg_procesar_anticipo_upd ON public.anticipos;
CREATE TRIGGER trg_procesar_anticipo_upd AFTER UPDATE ON public.anticipos
  FOR EACH ROW EXECUTE FUNCTION public.procesar_anticipo();

-- 7. Registrar en banco el ingreso de anticipos existentes que aún no se contabilizaron
INSERT INTO public.banco_movimientos (cuenta_id, anticipo_id, tipo, concepto, monto, fecha, referencia)
SELECT a.cuenta_id, a.id, 'ingreso',
  'Anticipo ' || COALESCE(c.nombre,'') || COALESCE(' - ' || a.numero_deposito,''), a.monto, a.fecha, a.numero_deposito
FROM public.anticipos a
LEFT JOIN public.clientes c ON c.id = a.cliente_id
WHERE a.estado = 'activo'
  AND NOT EXISTS (SELECT 1 FROM public.banco_movimientos b WHERE b.anticipo_id = a.id);

-- 8. Vista de saldos de anticipos
CREATE OR REPLACE VIEW public.anticipos_saldos WITH (security_invoker = true) AS
SELECT a.*,
  COALESCE(ap.aplicado, 0) AS aplicado,
  a.monto - COALESCE(ap.aplicado, 0) AS saldo
FROM public.anticipos a
LEFT JOIN (
  SELECT anticipo_id, SUM(monto) AS aplicado
  FROM public.pagos WHERE anticipo_id IS NOT NULL GROUP BY anticipo_id
) ap ON ap.anticipo_id = a.id;

GRANT SELECT ON public.anticipos_saldos TO authenticated;

NOTIFY pgrst, 'reload schema';
