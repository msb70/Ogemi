-- ============================================================
-- MIGRACION: Modulo de presupuestos
-- ============================================================

CREATE TABLE IF NOT EXISTS presupuestos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_presupuesto INTEGER NOT NULL,
  fecha DATE NOT NULL,
  cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  tipo_documento TEXT NOT NULL DEFAULT 'PRESUPUESTO',
  documento_afectado INTEGER,
  monto NUMERIC(12,2) NOT NULL DEFAULT 0,
  itbms NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  fecha_pago DATE,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'pagada')),
  fecha_cobro DATE,
  banco_cuenta_id UUID REFERENCES banco_cuentas(id) ON DELETE SET NULL,
  notas TEXT,
  monto_pagado NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_presupuestos_cliente ON presupuestos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_presupuestos_estado ON presupuestos(estado);
CREATE INDEX IF NOT EXISTS idx_presupuestos_fecha ON presupuestos(fecha);
CREATE INDEX IF NOT EXISTS idx_presupuestos_fecha_pago ON presupuestos(fecha_pago);

ALTER TABLE banco_movimientos
  ADD COLUMN IF NOT EXISTS presupuesto_id UUID REFERENCES presupuestos(id) ON DELETE SET NULL;

CREATE OR REPLACE TRIGGER trg_presupuestos_updated_at
  BEFORE UPDATE ON presupuestos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION calcular_fecha_pago_presupuesto()
RETURNS TRIGGER AS $$
DECLARE
  v_dias INTEGER;
BEGIN
  SELECT dias_credito INTO v_dias FROM clientes WHERE id = NEW.cliente_id;
  NEW.fecha_pago = NEW.fecha + (COALESCE(v_dias, 30) || ' days')::INTERVAL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_calcular_fecha_pago_presupuesto
  BEFORE INSERT OR UPDATE OF fecha, cliente_id ON presupuestos
  FOR EACH ROW EXECUTE FUNCTION calcular_fecha_pago_presupuesto();

CREATE OR REPLACE FUNCTION registrar_cobro_presupuesto_en_banco()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.estado = 'pagada' AND OLD.estado = 'pendiente' AND NEW.banco_cuenta_id IS NOT NULL THEN
    INSERT INTO banco_movimientos (cuenta_id, presupuesto_id, tipo, concepto, monto, fecha)
    VALUES (
      NEW.banco_cuenta_id,
      NEW.id,
      'ingreso',
      'Cobro presupuesto #' || NEW.numero_presupuesto,
      NEW.total,
      COALESCE(NEW.fecha_cobro, CURRENT_DATE)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_registrar_cobro_presupuesto
  AFTER UPDATE ON presupuestos
  FOR EACH ROW EXECUTE FUNCTION registrar_cobro_presupuesto_en_banco();

DROP VIEW IF EXISTS cartera_presupuestos;
CREATE VIEW cartera_presupuestos WITH (security_invoker = true) AS
SELECT
  p.id,
  p.numero_presupuesto,
  p.fecha,
  p.fecha_pago,
  c.nombre AS cliente,
  p.monto,
  p.itbms,
  p.total,
  COALESCE(p.monto_pagado, 0) AS monto_pagado,
  (p.total - COALESCE(p.monto_pagado, 0)) AS saldo_pendiente,
  CURRENT_DATE - p.fecha_pago AS dias_vencida,
  CASE
    WHEN CURRENT_DATE <= p.fecha_pago THEN 'corriente'
    WHEN CURRENT_DATE - p.fecha_pago BETWEEN 1 AND 30 THEN '1-30'
    WHEN CURRENT_DATE - p.fecha_pago BETWEEN 31 AND 60 THEN '31-60'
    WHEN CURRENT_DATE - p.fecha_pago BETWEEN 61 AND 90 THEN '61-90'
    ELSE '+120'
  END AS tramo
FROM presupuestos p
JOIN clientes c ON c.id = p.cliente_id
WHERE p.estado = 'pendiente'
  AND p.total > 0;

ALTER TABLE presupuestos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can manage presupuestos" ON presupuestos;
DROP POLICY IF EXISTS "ver_presupuestos" ON presupuestos;
DROP POLICY IF EXISTS "editar_presupuestos" ON presupuestos;
DROP POLICY IF EXISTS "update_presupuestos" ON presupuestos;
DROP POLICY IF EXISTS "delete_presupuestos" ON presupuestos;

CREATE POLICY "ver_presupuestos" ON presupuestos FOR SELECT
  TO authenticated USING (get_user_role() IS NOT NULL);

CREATE POLICY "editar_presupuestos" ON presupuestos FOR INSERT
  TO authenticated WITH CHECK (can_edit());

CREATE POLICY "update_presupuestos" ON presupuestos FOR UPDATE
  TO authenticated USING (can_edit());

CREATE POLICY "delete_presupuestos" ON presupuestos FOR DELETE
  TO authenticated USING (can_delete());
