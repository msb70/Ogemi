-- Gastos fijos: pasar de cortes 15/30 a 4 semanas + fechas editables por semana

-- 1. Montos: limpiar datos del modelo viejo (15/30) y migrar columna a semana 1..4
DELETE FROM public.gastos_fijos_montos;
ALTER TABLE public.gastos_fijos_montos DROP CONSTRAINT IF EXISTS gastos_fijos_montos_dia_corte_check;
ALTER TABLE public.gastos_fijos_montos RENAME COLUMN dia_corte TO semana;
ALTER TABLE public.gastos_fijos_montos
  ADD CONSTRAINT gastos_fijos_montos_semana_check CHECK (semana BETWEEN 1 AND 4);

-- 2. Fechas editables por semana de cada periodo
CREATE TABLE IF NOT EXISTS public.gastos_fijos_semanas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo date NOT NULL,
  semana smallint NOT NULL CHECK (semana BETWEEN 1 AND 4),
  fecha date NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (periodo, semana)
);

DROP TRIGGER IF EXISTS trg_gastos_fijos_semanas_updated_at ON public.gastos_fijos_semanas;
CREATE TRIGGER trg_gastos_fijos_semanas_updated_at
  BEFORE UPDATE ON public.gastos_fijos_semanas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.gastos_fijos_semanas ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gastos_fijos_semanas TO authenticated;

DROP POLICY IF EXISTS gastos_fijos_semanas_select_auth ON public.gastos_fijos_semanas;
CREATE POLICY gastos_fijos_semanas_select_auth ON public.gastos_fijos_semanas
  FOR SELECT USING (app_private.has_module_permission('gastos_fijos','ver'));

DROP POLICY IF EXISTS gastos_fijos_semanas_insert_edit ON public.gastos_fijos_semanas;
CREATE POLICY gastos_fijos_semanas_insert_edit ON public.gastos_fijos_semanas
  FOR INSERT WITH CHECK (app_private.has_module_permission('gastos_fijos','agregar'));

DROP POLICY IF EXISTS gastos_fijos_semanas_update_edit ON public.gastos_fijos_semanas;
CREATE POLICY gastos_fijos_semanas_update_edit ON public.gastos_fijos_semanas
  FOR UPDATE USING (app_private.has_module_permission('gastos_fijos','editar'))
  WITH CHECK (app_private.has_module_permission('gastos_fijos','editar'));

DROP POLICY IF EXISTS gastos_fijos_semanas_delete_admin ON public.gastos_fijos_semanas;
CREATE POLICY gastos_fijos_semanas_delete_admin ON public.gastos_fijos_semanas
  FOR DELETE USING (app_private.has_module_permission('gastos_fijos','borrar'));

NOTIFY pgrst, 'reload schema';
