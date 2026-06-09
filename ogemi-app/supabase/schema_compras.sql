-- ============================================================
-- OGEMI - MÓDULO DE COMPRAS Y PROVEEDORES
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- ============================================================
-- TABLA: proveedores
-- ============================================================
CREATE TABLE IF NOT EXISTS proveedores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre TEXT NOT NULL UNIQUE,
  dias_credito INTEGER DEFAULT 30 CHECK (dias_credito >= 0),
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLA: compras
-- ============================================================
CREATE TABLE IF NOT EXISTS compras (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fecha DATE NOT NULL,
  vencimiento DATE,
  proveedor_id UUID NOT NULL REFERENCES proveedores(id) ON DELETE RESTRICT,
  concepto TEXT,
  referencia TEXT,
  monto NUMERIC(12,2) DEFAULT 0 CHECK (monto >= 0),
  itbms NUMERIC(12,2) DEFAULT 0 CHECK (itbms >= 0),
  total NUMERIC(12,2) DEFAULT 0,
  estado TEXT DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'pagada')),
  banco_cuenta_id UUID REFERENCES banco_cuentas(id) ON DELETE SET NULL,
  fecha_pago DATE,
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compras_proveedor ON compras(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_compras_estado ON compras(estado);
CREATE INDEX IF NOT EXISTS idx_compras_fecha ON compras(fecha);
CREATE INDEX IF NOT EXISTS idx_compras_vencimiento ON compras(vencimiento);

-- ============================================================
-- AGREGAR compra_id a banco_movimientos (para trazabilidad)
-- ============================================================
ALTER TABLE banco_movimientos
  ADD COLUMN IF NOT EXISTS compra_id UUID REFERENCES compras(id) ON DELETE SET NULL;

-- ============================================================
-- TRIGGER: updated_at en proveedores y compras
-- ============================================================
CREATE OR REPLACE TRIGGER trg_proveedores_updated_at
  BEFORE UPDATE ON proveedores
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_compras_updated_at
  BEFORE UPDATE ON compras
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- TRIGGER: Calcular vencimiento y total al insertar/actualizar compra
-- ============================================================
CREATE OR REPLACE FUNCTION calcular_vencimiento_compra()
RETURNS TRIGGER AS $$
DECLARE
  v_dias INTEGER;
BEGIN
  -- Calcular vencimiento
  SELECT dias_credito INTO v_dias FROM proveedores WHERE id = NEW.proveedor_id;
  NEW.vencimiento = NEW.fecha + (COALESCE(v_dias, 30) || ' days')::INTERVAL;
  -- Calcular total
  NEW.total = COALESCE(NEW.monto, 0) + COALESCE(NEW.itbms, 0);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_calcular_vencimiento_compra
  BEFORE INSERT OR UPDATE OF fecha, proveedor_id, monto, itbms ON compras
  FOR EACH ROW EXECUTE FUNCTION calcular_vencimiento_compra();

-- ============================================================
-- TRIGGER: Al pagar compra, registrar egreso en banco
-- ============================================================
CREATE OR REPLACE FUNCTION registrar_pago_compra()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.estado = 'pagada' AND OLD.estado = 'pendiente' AND NEW.banco_cuenta_id IS NOT NULL THEN
    INSERT INTO banco_movimientos (cuenta_id, compra_id, tipo, concepto, monto, fecha)
    VALUES (
      NEW.banco_cuenta_id,
      NEW.id,
      'egreso',
      'Pago compra: ' || COALESCE(NEW.concepto, 'Proveedor'),
      NEW.total,
      COALESCE(NEW.fecha_pago, CURRENT_DATE)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_registrar_pago_compra
  AFTER UPDATE ON compras
  FOR EACH ROW EXECUTE FUNCTION registrar_pago_compra();

-- ============================================================
-- VISTA: compras_vencidas (cuentas por pagar vencidas)
-- ============================================================
CREATE OR REPLACE VIEW compras_vencidas WITH (security_invoker = true) AS
SELECT
  c.id,
  c.fecha,
  c.vencimiento,
  p.nombre AS proveedor,
  c.concepto,
  c.monto,
  c.itbms,
  c.total,
  CURRENT_DATE - c.vencimiento AS dias_vencida,
  CASE
    WHEN CURRENT_DATE <= c.vencimiento THEN 'corriente'
    WHEN CURRENT_DATE - c.vencimiento BETWEEN 1 AND 30 THEN '1-30'
    WHEN CURRENT_DATE - c.vencimiento BETWEEN 31 AND 60 THEN '31-60'
    WHEN CURRENT_DATE - c.vencimiento BETWEEN 61 AND 90 THEN '61-90'
    WHEN CURRENT_DATE - c.vencimiento BETWEEN 91 AND 120 THEN '91-120'
    ELSE '+120'
  END AS tramo
FROM compras c
JOIN proveedores p ON p.id = c.proveedor_id
WHERE c.estado = 'pendiente'
  AND c.total > 0;

-- ============================================================
-- RLS: proveedores
-- ============================================================
ALTER TABLE proveedores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ver_proveedores" ON proveedores FOR SELECT
  TO authenticated USING (get_user_role() IS NOT NULL);

CREATE POLICY "editar_proveedores" ON proveedores FOR INSERT
  TO authenticated WITH CHECK (can_edit());

CREATE POLICY "update_proveedores" ON proveedores FOR UPDATE
  TO authenticated USING (can_edit());

CREATE POLICY "delete_proveedores" ON proveedores FOR DELETE
  TO authenticated USING (can_delete());

-- ============================================================
-- RLS: compras
-- ============================================================
ALTER TABLE compras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ver_compras" ON compras FOR SELECT
  TO authenticated USING (get_user_role() IS NOT NULL);

CREATE POLICY "editar_compras" ON compras FOR INSERT
  TO authenticated WITH CHECK (can_edit());

CREATE POLICY "update_compras" ON compras FOR UPDATE
  TO authenticated USING (can_edit());

CREATE POLICY "delete_compras" ON compras FOR DELETE
  TO authenticated USING (can_delete());
