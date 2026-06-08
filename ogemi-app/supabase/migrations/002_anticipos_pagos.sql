-- ============================================================
-- MIGRACIÓN 002: Anticipos, Pagos Parciales y Mejoras
-- ============================================================

-- ============================================================
-- 1. TABLA: anticipos
--    Depósitos anticipados de clientes antes de emitir factura
-- ============================================================
CREATE TABLE IF NOT EXISTS anticipos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  cuenta_id UUID NOT NULL REFERENCES banco_cuentas(id) ON DELETE RESTRICT,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  monto NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  numero_deposito TEXT,
  notas TEXT,
  estado TEXT DEFAULT 'activo' CHECK (estado IN ('activo', 'aplicado', 'anulado')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anticipos_cliente ON anticipos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_anticipos_fecha ON anticipos(fecha);
CREATE INDEX IF NOT EXISTS idx_anticipos_estado ON anticipos(estado);

CREATE OR REPLACE TRIGGER trg_anticipos_updated_at
  BEFORE UPDATE ON anticipos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 2. TABLA: pagos
--    Permite abonos parciales en facturas y compras
--    con soporte de múltiples cuentas por pago
-- ============================================================
CREATE TABLE IF NOT EXISTS pagos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  factura_id UUID REFERENCES facturas(id) ON DELETE CASCADE,
  compra_id UUID REFERENCES compras(id) ON DELETE CASCADE,
  cuenta_id UUID NOT NULL REFERENCES banco_cuentas(id) ON DELETE RESTRICT,
  monto NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  referencia TEXT,
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT pago_origen CHECK (
    (factura_id IS NOT NULL AND compra_id IS NULL) OR
    (factura_id IS NULL AND compra_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_pagos_factura ON pagos(factura_id);
CREATE INDEX IF NOT EXISTS idx_pagos_compra ON pagos(compra_id);
CREATE INDEX IF NOT EXISTS idx_pagos_fecha ON pagos(fecha);

-- ============================================================
-- 3. CAMPO: monto_pagado en facturas y compras
-- ============================================================
ALTER TABLE facturas
  ADD COLUMN IF NOT EXISTS monto_pagado NUMERIC(12,2) DEFAULT 0;

ALTER TABLE compras
  ADD COLUMN IF NOT EXISTS monto_pagado NUMERIC(12,2) DEFAULT 0;

-- Sincronizar monto_pagado con facturas ya marcadas como pagadas
UPDATE facturas SET monto_pagado = total WHERE estado = 'pagada' AND monto_pagado = 0;
UPDATE compras SET monto_pagado = total WHERE estado = 'pagada' AND monto_pagado = 0;

-- ============================================================
-- 4. TRIGGER: Al insertar un pago, crear movimiento bancario
--    y actualizar monto_pagado + estado de la factura/compra
-- ============================================================

-- Eliminar el trigger antiguo que crea movimientos al marcar como pagada
-- (ahora los movimientos se crean al registrar pagos)
DROP TRIGGER IF EXISTS trg_registrar_cobro ON facturas;
DROP TRIGGER IF EXISTS trg_registrar_pago_compra ON compras;

-- Nuevo trigger: cuando se inserta un pago de factura
CREATE OR REPLACE FUNCTION procesar_pago()
RETURNS TRIGGER AS $$
DECLARE
  v_total_factura NUMERIC;
  v_total_compra NUMERIC;
  v_monto_pagado NUMERIC;
  v_concepto TEXT;
BEGIN
  IF NEW.factura_id IS NOT NULL THEN
    -- Crear movimiento bancario (ingreso)
    SELECT total INTO v_total_factura FROM facturas WHERE id = NEW.factura_id;
    SELECT numero_factura INTO v_concepto FROM facturas WHERE id = NEW.factura_id;

    INSERT INTO banco_movimientos (cuenta_id, factura_id, tipo, concepto, monto, fecha, referencia)
    VALUES (
      NEW.cuenta_id,
      NEW.factura_id,
      'ingreso',
      'Cobro factura #' || v_concepto || COALESCE(' - ' || NEW.referencia, ''),
      NEW.monto,
      NEW.fecha,
      NEW.referencia
    );

    -- Recalcular monto_pagado
    SELECT COALESCE(SUM(monto), 0) INTO v_monto_pagado
    FROM pagos WHERE factura_id = NEW.factura_id;

    -- Actualizar factura
    UPDATE facturas SET
      monto_pagado = v_monto_pagado,
      estado = CASE WHEN v_monto_pagado >= total THEN 'pagada' ELSE 'pendiente' END,
      fecha_cobro = CASE WHEN v_monto_pagado >= total THEN NEW.fecha ELSE fecha_cobro END,
      banco_cuenta_id = CASE WHEN v_monto_pagado >= total THEN NEW.cuenta_id ELSE banco_cuenta_id END
    WHERE id = NEW.factura_id;

  ELSIF NEW.compra_id IS NOT NULL THEN
    -- Crear movimiento bancario (egreso)
    SELECT total INTO v_total_compra FROM compras WHERE id = NEW.compra_id;
    SELECT concepto INTO v_concepto FROM compras WHERE id = NEW.compra_id;

    INSERT INTO banco_movimientos (cuenta_id, compra_id, tipo, concepto, monto, fecha, referencia)
    VALUES (
      NEW.cuenta_id,
      NEW.compra_id,
      'egreso',
      'Pago compra: ' || COALESCE(v_concepto, 'sin concepto') || COALESCE(' - ' || NEW.referencia, ''),
      NEW.monto,
      NEW.fecha,
      NEW.referencia
    );

    -- Recalcular monto_pagado
    SELECT COALESCE(SUM(monto), 0) INTO v_monto_pagado
    FROM pagos WHERE compra_id = NEW.compra_id;

    -- Actualizar compra
    UPDATE compras SET
      monto_pagado = v_monto_pagado,
      estado = CASE WHEN v_monto_pagado >= total THEN 'pagada' ELSE 'pendiente' END,
      fecha_pago = CASE WHEN v_monto_pagado >= total THEN NEW.fecha ELSE fecha_pago END,
      banco_cuenta_id = CASE WHEN v_monto_pagado >= total THEN NEW.cuenta_id ELSE banco_cuenta_id END
    WHERE id = NEW.compra_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_procesar_pago
  AFTER INSERT ON pagos
  FOR EACH ROW EXECUTE FUNCTION procesar_pago();

-- ============================================================
-- 5. AGREGAR compra_id a banco_movimientos (si no existe)
-- ============================================================
ALTER TABLE banco_movimientos
  ADD COLUMN IF NOT EXISTS compra_id UUID REFERENCES compras(id) ON DELETE SET NULL;

-- ============================================================
-- 6. RLS para nuevas tablas
-- ============================================================
ALTER TABLE anticipos ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ver_anticipos" ON anticipos FOR SELECT
  TO authenticated USING (get_user_role() IS NOT NULL);

CREATE POLICY "editar_anticipos" ON anticipos FOR INSERT
  TO authenticated WITH CHECK (can_edit());

CREATE POLICY "update_anticipos" ON anticipos FOR UPDATE
  TO authenticated USING (can_edit());

CREATE POLICY "delete_anticipos" ON anticipos FOR DELETE
  TO authenticated USING (can_delete());

CREATE POLICY "ver_pagos" ON pagos FOR SELECT
  TO authenticated USING (get_user_role() IS NOT NULL);

CREATE POLICY "editar_pagos" ON pagos FOR INSERT
  TO authenticated WITH CHECK (can_edit());

CREATE POLICY "delete_pagos" ON pagos FOR DELETE
  TO authenticated USING (can_delete());

-- ============================================================
-- 7. ACTUALIZAR vista cartera_vencida para considerar abonos
-- ============================================================
DROP VIEW IF EXISTS cartera_vencida;
CREATE VIEW cartera_vencida WITH (security_invoker = true) AS
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
    ELSE '+120'
  END AS tramo
FROM facturas f
JOIN clientes c ON c.id = f.cliente_id
WHERE f.estado = 'pendiente'
  AND f.total > 0;
