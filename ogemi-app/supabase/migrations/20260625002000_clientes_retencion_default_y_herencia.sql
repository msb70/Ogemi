-- Retención por cliente (default 0 para clientes nuevos) y herencia a la factura al crearla.
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS retencion_pct numeric(5,2) NOT NULL DEFAULT 0
    CHECK (retencion_pct >= 0 AND retencion_pct <= 100);

-- Al insertar una factura sin retención (pct = 0, el default), hereda la del cliente.
-- Si se especifica un % > 0 explícito, se respeta. Ediciones posteriores (UPDATE) no se tocan.
CREATE OR REPLACE FUNCTION public.factura_set_retencion_from_cliente()
RETURNS trigger LANGUAGE plpgsql SET search_path = 'public' AS $$
BEGIN
  IF COALESCE(NEW.retencion_pct, 0) = 0 AND NEW.cliente_id IS NOT NULL THEN
    SELECT COALESCE(retencion_pct, 0) INTO NEW.retencion_pct
    FROM public.clientes WHERE id = NEW.cliente_id;
    NEW.retencion_pct := COALESCE(NEW.retencion_pct, 0);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_factura_retencion_from_cliente ON public.facturas;
CREATE TRIGGER trg_factura_retencion_from_cliente
  BEFORE INSERT ON public.facturas
  FOR EACH ROW EXECUTE FUNCTION public.factura_set_retencion_from_cliente();
