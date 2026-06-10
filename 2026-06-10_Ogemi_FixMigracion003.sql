-- ============================================================
-- OGEMI — Corrección si la verificación falló (migración 003 ausente)
-- EJECUTAR SOLO DESPUÉS de revisar el resultado de la verificación con Claude.
-- Idempotente: se puede ejecutar dos veces sin daño.
-- ============================================================

-- PASO 0 (solo si 'facturas_duplicadas' > 0): revisar duplicados antes,
-- porque el constraint del paso 1 fallará si existen.
-- SELECT numero_factura, tipo_documento, count(*), array_agg(id)
-- FROM facturas GROUP BY 1,2 HAVING count(*) > 1;

-- PASO 1: constraint anti-duplicados
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.facturas'::regclass
      AND conname = 'uq_factura_numero_tipo'
  ) THEN
    ALTER TABLE public.facturas
      ADD CONSTRAINT uq_factura_numero_tipo UNIQUE (numero_factura, tipo_documento);
  END IF;
END $$;

-- PASO 2: vista cartera_vencida con tramo 91-120 (versión post-002, conserva monto_pagado)
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
FROM facturas f
JOIN clientes c ON c.id = f.cliente_id
WHERE f.estado = 'pendiente'
  AND f.total > 0;

-- PASO 3: vista compras_vencidas con tramo 91-120
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
FROM compras c
JOIN proveedores p ON p.id = c.proveedor_id
WHERE c.estado = 'pendiente'
  AND c.total > 0;

-- PASO 4: registrar en el historial de migraciones para que el CLI no quede desincronizado
INSERT INTO supabase_migrations.schema_migrations (version, name)
SELECT '20260610120000', 'sprint2_correctness_applied_manually'
WHERE NOT EXISTS (
  SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260610120000'
);
