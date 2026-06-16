-- Resumen agregado de facturas para la cabecera de la pantalla de Facturas.
-- SECURITY INVOKER: respeta RLS (el usuario debe tener permiso facturas/ver).

CREATE OR REPLACE FUNCTION public.facturas_resumen()
RETURNS TABLE (
  num_facturas bigint,
  num_pagadas bigint,
  num_pendientes bigint,
  monto_total numeric,
  monto_pagado numeric,
  monto_pendiente numeric,
  num_notas_credito bigint,
  total_notas_credito numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    count(*) FILTER (WHERE tipo_documento NOT ILIKE '%CREDITO%'),
    count(*) FILTER (WHERE tipo_documento NOT ILIKE '%CREDITO%' AND estado = 'pagada'),
    count(*) FILTER (WHERE tipo_documento NOT ILIKE '%CREDITO%' AND estado = 'pendiente'),
    COALESCE(sum(total) FILTER (WHERE tipo_documento NOT ILIKE '%CREDITO%'), 0),
    COALESCE(sum(COALESCE(monto_pagado, 0)) FILTER (WHERE tipo_documento NOT ILIKE '%CREDITO%'), 0),
    COALESCE(sum(total - COALESCE(monto_pagado, 0)) FILTER (WHERE tipo_documento NOT ILIKE '%CREDITO%'), 0),
    count(*) FILTER (WHERE tipo_documento ILIKE '%CREDITO%'),
    COALESCE(sum(total) FILTER (WHERE tipo_documento ILIKE '%CREDITO%'), 0)
  FROM public.facturas;
$$;

REVOKE ALL ON FUNCTION public.facturas_resumen() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.facturas_resumen() TO authenticated;

NOTIFY pgrst, 'reload schema';
