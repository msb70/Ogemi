-- Estado 'aplicado' automático para anticipos.
-- Cuando la suma de pagos aplicados cubre el monto del anticipo (saldo 0),
-- el estado pasa a 'aplicado'. Si un pago se reversa/elimina y vuelve a
-- quedar saldo, regresa a 'activo'. Los 'anulado' nunca se tocan.
CREATE OR REPLACE FUNCTION public.sync_anticipo_estado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[] := ARRAY[]::uuid[];
  v_id uuid;
  v_monto numeric;
  v_aplicado numeric;
  v_nuevo text;
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.anticipo_id IS NOT NULL THEN
    v_ids := array_append(v_ids, NEW.anticipo_id);
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.anticipo_id IS NOT NULL
     AND (TG_OP = 'DELETE' OR OLD.anticipo_id IS DISTINCT FROM NEW.anticipo_id) THEN
    v_ids := array_append(v_ids, OLD.anticipo_id);
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT a.monto, COALESCE(SUM(p.monto), 0)
      INTO v_monto, v_aplicado
      FROM public.anticipos a
      LEFT JOIN public.pagos p ON p.anticipo_id = a.id
     WHERE a.id = v_id
     GROUP BY a.monto;

    v_nuevo := CASE WHEN v_aplicado >= v_monto THEN 'aplicado' ELSE 'activo' END;

    UPDATE public.anticipos
       SET estado = v_nuevo
     WHERE id = v_id
       AND estado <> 'anulado'
       AND estado IS DISTINCT FROM v_nuevo;
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_anticipo_estado ON public.pagos;
CREATE TRIGGER trg_sync_anticipo_estado
AFTER INSERT OR UPDATE OR DELETE ON public.pagos
FOR EACH ROW EXECUTE FUNCTION public.sync_anticipo_estado();

-- Backfill: anticipos activos ya aplicados en su totalidad → 'aplicado'
UPDATE public.anticipos a
   SET estado = 'aplicado'
 WHERE a.estado = 'activo'
   AND a.monto <= COALESCE(
     (SELECT SUM(p.monto) FROM public.pagos p WHERE p.anticipo_id = a.id), 0);
