-- ============================================================
-- MIGRACION: Campo orden_trabajo en presupuestos
-- Formato AA-NNN (anio 2 digitos - consecutivo 3 digitos), editable, no unico
-- ============================================================

ALTER TABLE presupuestos ADD COLUMN IF NOT EXISTS orden_trabajo TEXT;

CREATE INDEX IF NOT EXISTS idx_presupuestos_orden_trabajo ON presupuestos(orden_trabajo);

COMMENT ON COLUMN presupuestos.orden_trabajo IS 'Orden de trabajo formato AA-NNN (anio 2 digitos - consecutivo 3 digitos), editable, no unico';
