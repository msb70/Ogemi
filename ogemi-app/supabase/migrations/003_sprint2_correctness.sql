-- ============================================================
-- MIGRACIÓN 003 — Sprint 2: Correctness de negocio
-- Fecha: 2026-06-09
-- ============================================================

-- 1. UNIQUE constraint en facturas para prevenir duplicados en importación
--    El app hace deduplicación por Set en JS, pero sin constraint a nivel DB
--    dos imports paralelos pueden insertar la misma factura.
--    NOTA: Si ya existen duplicados en la tabla, este ALTER fallará.
--    Ejecutar primero: SELECT numero_factura, tipo_documento, COUNT(*) FROM facturas GROUP BY 1,2 HAVING COUNT(*) > 1;
ALTER TABLE facturas
  ADD CONSTRAINT uq_factura_numero_tipo UNIQUE (numero_factura, tipo_documento);

-- 2. Corregir vista cartera_vencida — agregar tramo 91-120 días
--    Bug: facturas vencidas 91-120 días caían en '+120' (reportes incorrectos)
CREATE OR REPLACE VIEW cartera_vencida WITH (security_invoker = true) AS
SELECT
  f.id,
  f.numero_factura,
  f.fecha,
  f.fecha_pago,
  c.nombre AS cliente,
  f.monto,
  f.itbms,
  f.total,
  CURRENT_DATE - f.fecha_pago AS dias_vencida,
  CASE
    WHEN CURRENT_DATE <= f.fecha_pago THEN 'corriente'
    WHEN CURRENT_DATE - f.fecha_pago BETWEEN 1 AND 30 THEN '1-30'
    WHEN CURRENT_DATE - f.fecha_pago BETWEEN 31 AND 60 THEN '31-60'
    WHEN CURRENT_DATE - f.fecha_pago BETWEEN 61 AND 90 THEN '61-90'
    WHEN CURRENT_DATE - f.fecha_pago BETWEEN 91 AND 120 THEN '91-120'
    ELSE '+120'
  END AS tramo
FROM facturas f
JOIN clientes c ON c.id = f.cliente_id
WHERE f.estado = 'pendiente'
  AND f.total > 0;

-- 3. Corregir vista compras_vencidas — mismo bug de tramo
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
