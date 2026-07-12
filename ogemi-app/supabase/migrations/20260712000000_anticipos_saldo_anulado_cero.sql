-- Anticipos anulados no deben aportar saldo disponible.
-- La vista devolvía saldo = monto - aplicado sin considerar el estado,
-- por lo que un anticipo anulado sin aplicaciones aparecía con saldo completo
-- y se sumaba como disponible en KPIs/exportaciones.
CREATE OR REPLACE VIEW public.anticipos_saldos WITH (security_invoker = true) AS
SELECT
  a.id,
  a.cliente_id,
  a.cuenta_id,
  a.fecha,
  a.monto,
  a.numero_deposito,
  a.notas,
  a.estado,
  a.created_at,
  a.updated_at,
  COALESCE(ap.aplicado, 0::numeric) AS aplicado,
  CASE
    WHEN a.estado = 'anulado' THEN 0::numeric
    ELSE a.monto - COALESCE(ap.aplicado, 0::numeric)
  END AS saldo
FROM anticipos a
LEFT JOIN (
  SELECT pagos.anticipo_id, sum(pagos.monto) AS aplicado
  FROM pagos
  WHERE pagos.anticipo_id IS NOT NULL
  GROUP BY pagos.anticipo_id
) ap ON ap.anticipo_id = a.id;

GRANT SELECT ON public.anticipos_saldos TO authenticated;
