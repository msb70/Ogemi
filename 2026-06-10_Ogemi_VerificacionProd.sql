-- ============================================================
-- OGEMI — Verificación de estado de PRODUCCIÓN (tnuzaaetfbbnxtbedlhs)
-- Ejecutar en: Supabase Dashboard → SQL Editor (solo lectura, no modifica nada)
-- Pegar el resultado completo de vuelta a Claude.
-- ============================================================

-- 1. ¿Existe el constraint anti-duplicados de facturas? (debe devolver 1 fila)
SELECT 'constraint_uq_factura' AS chequeo,
       count(*)::text AS resultado
FROM pg_constraint
WHERE conrelid = 'public.facturas'::regclass
  AND conname = 'uq_factura_numero_tipo'

UNION ALL

-- 2. ¿Hay facturas duplicadas hoy? (debe ser 0)
SELECT 'facturas_duplicadas',
       count(*)::text
FROM (
  SELECT numero_factura, tipo_documento
  FROM facturas
  GROUP BY 1, 2
  HAVING count(*) > 1
) d

UNION ALL

-- 3. ¿La vista cartera_vencida tiene el tramo 91-120? (debe ser 'SI')
SELECT 'vista_tiene_tramo_91_120',
       CASE WHEN pg_get_viewdef('public.cartera_vencida'::regclass) LIKE '%91-120%'
            THEN 'SI' ELSE 'NO' END

UNION ALL

-- 4. ¿La vista compras_vencidas tiene el tramo 91-120?
SELECT 'compras_vencidas_91_120',
       CASE WHEN pg_get_viewdef('public.compras_vencidas'::regclass) LIKE '%91-120%'
            THEN 'SI' ELSE 'NO' END

UNION ALL

-- 5. Volumen de datos (para comparar contra el proyecto viejo arill...)
SELECT 'total_facturas', count(*)::text FROM facturas
UNION ALL
SELECT 'total_clientes', count(*)::text FROM clientes
UNION ALL
SELECT 'total_movimientos_banco', count(*)::text FROM banco_movimientos
UNION ALL
SELECT 'total_pagos', count(*)::text FROM pagos
UNION ALL
SELECT 'ultima_factura_creada', coalesce(max(created_at)::text, 'sin datos') FROM facturas
UNION ALL
SELECT 'factura_mas_reciente_fecha', coalesce(max(fecha)::text, 'sin datos') FROM facturas;

-- 6. Historial de migraciones registradas por el CLI
SELECT version, name
FROM supabase_migrations.schema_migrations
ORDER BY version;
