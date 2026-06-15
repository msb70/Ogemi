-- ============================================================
-- Harden accounting views and payment reversals
-- Safe migration: additive table/functions plus view replacement.
--
-- Rollback outline:
--   1. DROP FUNCTION IF EXISTS public.reversar_pago(uuid, text, date);
--   2. DROP TRIGGER IF EXISTS trg_prevent_pagos_mutation ON public.pagos;
--   3. DROP FUNCTION IF EXISTS public.prevent_pagos_mutation();
--   4. DROP TABLE IF EXISTS public.pago_reversos;
--   5. Recreate previous cartera_vencida/compras_vencidas view definitions
--      from the migration immediately before this one.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pago_reversos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pago_id uuid NOT NULL UNIQUE REFERENCES public.pagos(id) ON DELETE RESTRICT,
  factura_id uuid REFERENCES public.facturas(id) ON DELETE RESTRICT,
  compra_id uuid REFERENCES public.compras(id) ON DELETE RESTRICT,
  cuenta_id uuid NOT NULL REFERENCES public.banco_cuentas(id) ON DELETE RESTRICT,
  monto numeric(12,2) NOT NULL CHECK (monto > 0),
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  motivo text NOT NULL,
  banco_movimiento_id uuid,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz DEFAULT now(),
  CONSTRAINT pago_reverso_origen CHECK (
    (factura_id IS NOT NULL AND compra_id IS NULL) OR
    (factura_id IS NULL AND compra_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_pago_reversos_factura ON public.pago_reversos(factura_id);
CREATE INDEX IF NOT EXISTS idx_pago_reversos_compra ON public.pago_reversos(compra_id);
CREATE INDEX IF NOT EXISTS idx_pago_reversos_fecha ON public.pago_reversos(fecha);

ALTER TABLE public.banco_movimientos
  ADD COLUMN IF NOT EXISTS pago_id uuid REFERENCES public.pagos(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS pago_reverso_id uuid REFERENCES public.pago_reversos(id) ON DELETE SET NULL;

ALTER TABLE public.pago_reversos
  ADD CONSTRAINT fk_pago_reversos_banco_movimiento
  FOREIGN KEY (banco_movimiento_id)
  REFERENCES public.banco_movimientos(id)
  ON DELETE SET NULL;

ALTER TABLE public.pago_reversos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ver_pago_reversos" ON public.pago_reversos;
CREATE POLICY "ver_pago_reversos" ON public.pago_reversos FOR SELECT TO authenticated
  USING (
    app_private.has_module_permission('facturas', 'ver')
    OR app_private.has_module_permission('compras', 'ver')
    OR app_private.has_module_permission('banco', 'ver')
    OR app_private.has_module_permission('reportes', 'ver')
  );

DROP POLICY IF EXISTS "delete_pagos" ON public.pagos;
DROP POLICY IF EXISTS "update_pagos" ON public.pagos;

CREATE OR REPLACE FUNCTION public.prevent_pagos_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Los pagos son inmutables. Use public.reversar_pago() para reversar contablemente.';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_pagos_mutation ON public.pagos;
CREATE TRIGGER trg_prevent_pagos_mutation
  BEFORE UPDATE OR DELETE ON public.pagos
  FOR EACH ROW EXECUTE FUNCTION public.prevent_pagos_mutation();

CREATE OR REPLACE FUNCTION public.monto_pagado_factura(p_factura_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM(p.monto), 0) - COALESCE(SUM(r.monto), 0)
  FROM public.pagos p
  LEFT JOIN public.pago_reversos r ON r.pago_id = p.id
  WHERE p.factura_id = p_factura_id;
$$;

CREATE OR REPLACE FUNCTION public.monto_pagado_compra(p_compra_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM(p.monto), 0) - COALESCE(SUM(r.monto), 0)
  FROM public.pagos p
  LEFT JOIN public.pago_reversos r ON r.pago_id = p.id
  WHERE p.compra_id = p_compra_id;
$$;

CREATE OR REPLACE FUNCTION public.procesar_pago()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_monto_pagado numeric;
  v_concepto text;
BEGIN
  IF NEW.factura_id IS NOT NULL THEN
    SELECT numero_factura::text INTO v_concepto
    FROM public.facturas
    WHERE id = NEW.factura_id;

    INSERT INTO public.banco_movimientos (cuenta_id, factura_id, pago_id, tipo, concepto, monto, fecha, referencia)
    VALUES (
      NEW.cuenta_id,
      NEW.factura_id,
      NEW.id,
      'ingreso',
      'Cobro factura #' || COALESCE(v_concepto, '') || COALESCE(' - ' || NEW.referencia, ''),
      NEW.monto,
      NEW.fecha,
      NEW.referencia
    );

    v_monto_pagado := public.monto_pagado_factura(NEW.factura_id);

    UPDATE public.facturas
    SET
      monto_pagado = v_monto_pagado,
      estado = CASE WHEN v_monto_pagado >= total THEN 'pagada' ELSE 'pendiente' END,
      fecha_cobro = CASE WHEN v_monto_pagado >= total THEN NEW.fecha ELSE NULL END,
      banco_cuenta_id = CASE WHEN v_monto_pagado >= total THEN NEW.cuenta_id ELSE NULL END
    WHERE id = NEW.factura_id;

  ELSIF NEW.compra_id IS NOT NULL THEN
    SELECT concepto INTO v_concepto
    FROM public.compras
    WHERE id = NEW.compra_id;

    INSERT INTO public.banco_movimientos (cuenta_id, compra_id, pago_id, tipo, concepto, monto, fecha, referencia)
    VALUES (
      NEW.cuenta_id,
      NEW.compra_id,
      NEW.id,
      'egreso',
      'Pago compra: ' || COALESCE(v_concepto, 'sin concepto') || COALESCE(' - ' || NEW.referencia, ''),
      NEW.monto,
      NEW.fecha,
      NEW.referencia
    );

    v_monto_pagado := public.monto_pagado_compra(NEW.compra_id);

    UPDATE public.compras
    SET
      monto_pagado = v_monto_pagado,
      estado = CASE WHEN v_monto_pagado >= total THEN 'pagada' ELSE 'pendiente' END,
      fecha_pago = CASE WHEN v_monto_pagado >= total THEN NEW.fecha ELSE NULL END,
      banco_cuenta_id = CASE WHEN v_monto_pagado >= total THEN NEW.cuenta_id ELSE NULL END
    WHERE id = NEW.compra_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.reversar_pago(
  p_pago_id uuid,
  p_motivo text,
  p_fecha date DEFAULT CURRENT_DATE
)
RETURNS public.pago_reversos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private, pg_temp
AS $$
DECLARE
  v_pago public.pagos%ROWTYPE;
  v_reverso public.pago_reversos%ROWTYPE;
  v_movimiento_id uuid;
  v_monto_pagado numeric;
BEGIN
  IF p_motivo IS NULL OR length(trim(p_motivo)) < 3 THEN
    RAISE EXCEPTION 'Debe indicar un motivo de reverso.';
  END IF;

  SELECT * INTO v_pago
  FROM public.pagos
  WHERE id = p_pago_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pago no existe.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.pago_reversos WHERE pago_id = p_pago_id) THEN
    RAISE EXCEPTION 'El pago ya fue reversado.';
  END IF;

  IF v_pago.factura_id IS NOT NULL THEN
    IF NOT app_private.has_module_permission('facturas', 'borrar') THEN
      RAISE EXCEPTION 'No tienes permiso para reversar pagos de facturas.';
    END IF;
  ELSE
    IF NOT app_private.has_module_permission('compras', 'borrar') THEN
      RAISE EXCEPTION 'No tienes permiso para reversar pagos de compras.';
    END IF;
  END IF;

  INSERT INTO public.pago_reversos (
    pago_id, factura_id, compra_id, cuenta_id, monto, fecha, motivo, created_by
  )
  VALUES (
    v_pago.id, v_pago.factura_id, v_pago.compra_id, v_pago.cuenta_id,
    v_pago.monto, COALESCE(p_fecha, CURRENT_DATE), trim(p_motivo), auth.uid()
  )
  RETURNING * INTO v_reverso;

  IF v_pago.factura_id IS NOT NULL THEN
    INSERT INTO public.banco_movimientos (
      cuenta_id, factura_id, pago_reverso_id, tipo, concepto, monto, fecha, referencia
    )
    VALUES (
      v_pago.cuenta_id,
      v_pago.factura_id,
      v_reverso.id,
      'egreso',
      'Reverso cobro factura - ' || trim(p_motivo),
      v_pago.monto,
      COALESCE(p_fecha, CURRENT_DATE),
      v_pago.referencia
    )
    RETURNING id INTO v_movimiento_id;

    v_monto_pagado := public.monto_pagado_factura(v_pago.factura_id);

    UPDATE public.facturas
    SET
      monto_pagado = v_monto_pagado,
      estado = CASE WHEN v_monto_pagado >= total THEN 'pagada' ELSE 'pendiente' END,
      fecha_cobro = CASE WHEN v_monto_pagado >= total THEN fecha_cobro ELSE NULL END,
      banco_cuenta_id = CASE WHEN v_monto_pagado >= total THEN banco_cuenta_id ELSE NULL END
    WHERE id = v_pago.factura_id;

  ELSE
    INSERT INTO public.banco_movimientos (
      cuenta_id, compra_id, pago_reverso_id, tipo, concepto, monto, fecha, referencia
    )
    VALUES (
      v_pago.cuenta_id,
      v_pago.compra_id,
      v_reverso.id,
      'ingreso',
      'Reverso pago compra - ' || trim(p_motivo),
      v_pago.monto,
      COALESCE(p_fecha, CURRENT_DATE),
      v_pago.referencia
    )
    RETURNING id INTO v_movimiento_id;

    v_monto_pagado := public.monto_pagado_compra(v_pago.compra_id);

    UPDATE public.compras
    SET
      monto_pagado = v_monto_pagado,
      estado = CASE WHEN v_monto_pagado >= total THEN 'pagada' ELSE 'pendiente' END,
      fecha_pago = CASE WHEN v_monto_pagado >= total THEN fecha_pago ELSE NULL END,
      banco_cuenta_id = CASE WHEN v_monto_pagado >= total THEN banco_cuenta_id ELSE NULL END
    WHERE id = v_pago.compra_id;
  END IF;

  UPDATE public.pago_reversos
  SET banco_movimiento_id = v_movimiento_id
  WHERE id = v_reverso.id
  RETURNING * INTO v_reverso;

  RETURN v_reverso;
END;
$$;

REVOKE ALL ON FUNCTION public.reversar_pago(uuid, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reversar_pago(uuid, text, date) TO authenticated;

CREATE OR REPLACE VIEW public.cartera_vencida WITH (security_invoker = true) AS
SELECT
  f.id,
  f.numero_factura,
  f.fecha,
  f.fecha_pago,
  c.nombre AS cliente,
  f.monto,
  f.itbms,
  f.total,
  COALESCE(f.monto_pagado, 0) AS monto_pagado,
  (f.total - COALESCE(f.monto_pagado, 0)) AS saldo_pendiente,
  CURRENT_DATE - f.fecha_pago AS dias_vencida,
  CASE
    WHEN CURRENT_DATE <= f.fecha_pago THEN 'corriente'
    WHEN CURRENT_DATE - f.fecha_pago BETWEEN 1 AND 30 THEN '1-30'
    WHEN CURRENT_DATE - f.fecha_pago BETWEEN 31 AND 60 THEN '31-60'
    WHEN CURRENT_DATE - f.fecha_pago BETWEEN 61 AND 90 THEN '61-90'
    WHEN CURRENT_DATE - f.fecha_pago BETWEEN 91 AND 120 THEN '91-120'
    ELSE '+120'
  END AS tramo
FROM public.facturas f
JOIN public.clientes c ON c.id = f.cliente_id
WHERE f.estado = 'pendiente'
  AND f.total > 0
  AND (f.total - COALESCE(f.monto_pagado, 0)) > 0;

CREATE OR REPLACE VIEW public.compras_vencidas WITH (security_invoker = true) AS
SELECT
  c.id,
  c.fecha,
  c.vencimiento,
  p.nombre AS proveedor,
  c.concepto,
  c.monto,
  c.itbms,
  c.total,
  COALESCE(c.monto_pagado, 0) AS monto_pagado,
  (c.total - COALESCE(c.monto_pagado, 0)) AS saldo_pendiente,
  CURRENT_DATE - c.vencimiento AS dias_vencida,
  CASE
    WHEN CURRENT_DATE <= c.vencimiento THEN 'corriente'
    WHEN CURRENT_DATE - c.vencimiento BETWEEN 1 AND 30 THEN '1-30'
    WHEN CURRENT_DATE - c.vencimiento BETWEEN 31 AND 60 THEN '31-60'
    WHEN CURRENT_DATE - c.vencimiento BETWEEN 61 AND 90 THEN '61-90'
    WHEN CURRENT_DATE - c.vencimiento BETWEEN 91 AND 120 THEN '91-120'
    ELSE '+120'
  END AS tramo
FROM public.compras c
JOIN public.proveedores p ON p.id = c.proveedor_id
WHERE c.estado = 'pendiente'
  AND c.total > 0
  AND (c.total - COALESCE(c.monto_pagado, 0)) > 0;

NOTIFY pgrst, 'reload schema';
