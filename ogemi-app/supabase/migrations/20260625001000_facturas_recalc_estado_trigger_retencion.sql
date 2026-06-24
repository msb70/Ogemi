-- Fix: el trigger de recálculo de estado solo disparaba con cambios en monto/itbms/total,
-- por lo que marcar el comprobante de retención no pasaba la factura de 'falta_retencion' a 'pagada'.
-- Se amplía la lista de columnas que disparan el recálculo.
DROP TRIGGER IF EXISTS trg_factura_recalc_estado ON public.facturas;
CREATE TRIGGER trg_factura_recalc_estado
  BEFORE UPDATE OF monto, itbms, total, monto_pagado, retencion_pct, retencion_comprobante_entregado
  ON public.facturas
  FOR EACH ROW EXECUTE FUNCTION public.factura_recalc_estado();
