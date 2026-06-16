-- Resumen de facturas con los mismos filtros que la lista:
-- estado, búsqueda (#factura o nombre de cliente) y rango de fechas.
DROP FUNCTION IF EXISTS public.facturas_resumen();

CREATE OR REPLACE FUNCTION public.facturas_resumen(
  p_estado text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_desde date DEFAULT NULL,
  p_hasta date DEFAULT NULL
)
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
    count(*) FILTER (WHERE f.tipo_documento NOT ILIKE '%CREDITO%'),
    count(*) FILTER (WHERE f.tipo_documento NOT ILIKE '%CREDITO%' AND f.estado = 'pagada'),
    count(*) FILTER (WHERE f.tipo_documento NOT ILIKE '%CREDITO%' AND f.estado = 'pendiente'),
    COALESCE(sum(f.total) FILTER (WHERE f.tipo_documento NOT ILIKE '%CREDITO%'), 0),
    COALESCE(sum(COALESCE(f.monto_pagado, 0)) FILTER (WHERE f.tipo_documento NOT ILIKE '%CREDITO%'), 0),
    COALESCE(sum(f.total - COALESCE(f.monto_pagado, 0)) FILTER (WHERE f.tipo_documento NOT ILIKE '%CREDITO%'), 0),
    count(*) FILTER (WHERE f.tipo_documento ILIKE '%CREDITO%'),
    COALESCE(sum(f.total) FILTER (WHERE f.tipo_documento ILIKE '%CREDITO%'), 0)
  FROM public.facturas f
  LEFT JOIN public.clientes c ON c.id = f.cliente_id
  WHERE (p_desde IS NULL OR f.fecha >= p_desde)
    AND (p_hasta IS NULL OR f.fecha <= p_hasta)
    AND (p_estado IS NULL OR p_estado = 'todos' OR f.estado = p_estado)
    AND (
      p_search IS NULL OR btrim(p_search) = ''
      OR (p_search ~ '^\d+$' AND f.numero_factura = p_search::int)
      OR (p_search !~ '^\d+$' AND c.nombre ILIKE '%' || btrim(p_search) || '%')
    );
$$;

REVOKE ALL ON FUNCTION public.facturas_resumen(text, text, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.facturas_resumen(text, text, date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
