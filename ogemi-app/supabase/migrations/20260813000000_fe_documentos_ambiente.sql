-- Registra en que ambiente (pruebas/produccion) se timbro cada documento electronico.
-- Los documentos timbrados en PRUEBAS ya no se integran a cobros (facturas/notas_credito),
-- por lo que no aparecen en ningun reporte del sistema. El badge PRUEBA en la UI usa esta columna.

ALTER TABLE public.fe_documentos
  ADD COLUMN IF NOT EXISTS ambiente text;

ALTER TABLE public.fe_documentos DROP CONSTRAINT IF EXISTS fe_documentos_ambiente_check;
ALTER TABLE public.fe_documentos
  ADD CONSTRAINT fe_documentos_ambiente_check CHECK (ambiente IS NULL OR ambiente IN ('pruebas', 'produccion'));

-- Backfill: todo lo aceptado hasta la fecha salio por el ambiente de PRUEBAS
-- (las credenciales de produccion nunca han estado activas como ambiente).
UPDATE public.fe_documentos SET ambiente = 'pruebas' WHERE estado = 'aceptado' AND ambiente IS NULL;
