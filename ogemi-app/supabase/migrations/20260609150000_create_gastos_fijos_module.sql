-- Fixed expenses module: catalog + monthly 15/30 cut amounts.

CREATE TABLE IF NOT EXISTS public.gastos_fijos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL UNIQUE,
  categoria text,
  activo boolean NOT NULL DEFAULT true,
  orden integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.gastos_fijos_montos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gasto_fijo_id uuid NOT NULL REFERENCES public.gastos_fijos(id) ON DELETE CASCADE,
  periodo date NOT NULL,
  dia_corte integer NOT NULL CHECK (dia_corte IN (15, 30)),
  monto numeric(12,2) NOT NULL DEFAULT 0,
  notas text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gasto_fijo_id, periodo, dia_corte)
);

CREATE INDEX IF NOT EXISTS idx_gastos_fijos_activo ON public.gastos_fijos(activo);
CREATE INDEX IF NOT EXISTS idx_gastos_fijos_montos_periodo ON public.gastos_fijos_montos(periodo);

CREATE OR REPLACE FUNCTION public.set_gastos_fijos_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gastos_fijos_updated_at ON public.gastos_fijos;
CREATE TRIGGER trg_gastos_fijos_updated_at
  BEFORE UPDATE ON public.gastos_fijos
  FOR EACH ROW EXECUTE FUNCTION public.set_gastos_fijos_updated_at();

DROP TRIGGER IF EXISTS trg_gastos_fijos_montos_updated_at ON public.gastos_fijos_montos;
CREATE TRIGGER trg_gastos_fijos_montos_updated_at
  BEFORE UPDATE ON public.gastos_fijos_montos
  FOR EACH ROW EXECUTE FUNCTION public.set_gastos_fijos_updated_at();

ALTER TABLE public.gastos_fijos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gastos_fijos_montos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gastos_fijos_select_auth" ON public.gastos_fijos;
CREATE POLICY "gastos_fijos_select_auth" ON public.gastos_fijos
  FOR SELECT TO authenticated USING (get_user_role() IS NOT NULL OR app_private.is_current_user_admin());

DROP POLICY IF EXISTS "gastos_fijos_insert_edit" ON public.gastos_fijos;
CREATE POLICY "gastos_fijos_insert_edit" ON public.gastos_fijos
  FOR INSERT TO authenticated WITH CHECK (can_edit() OR app_private.is_current_user_admin());

DROP POLICY IF EXISTS "gastos_fijos_update_edit" ON public.gastos_fijos;
CREATE POLICY "gastos_fijos_update_edit" ON public.gastos_fijos
  FOR UPDATE TO authenticated USING (can_edit() OR app_private.is_current_user_admin())
  WITH CHECK (can_edit() OR app_private.is_current_user_admin());

DROP POLICY IF EXISTS "gastos_fijos_delete_admin" ON public.gastos_fijos;
CREATE POLICY "gastos_fijos_delete_admin" ON public.gastos_fijos
  FOR DELETE TO authenticated USING (can_delete() OR app_private.is_current_user_admin());

DROP POLICY IF EXISTS "gastos_fijos_montos_select_auth" ON public.gastos_fijos_montos;
CREATE POLICY "gastos_fijos_montos_select_auth" ON public.gastos_fijos_montos
  FOR SELECT TO authenticated USING (get_user_role() IS NOT NULL OR app_private.is_current_user_admin());

DROP POLICY IF EXISTS "gastos_fijos_montos_insert_edit" ON public.gastos_fijos_montos;
CREATE POLICY "gastos_fijos_montos_insert_edit" ON public.gastos_fijos_montos
  FOR INSERT TO authenticated WITH CHECK (can_edit() OR app_private.is_current_user_admin());

DROP POLICY IF EXISTS "gastos_fijos_montos_update_edit" ON public.gastos_fijos_montos;
CREATE POLICY "gastos_fijos_montos_update_edit" ON public.gastos_fijos_montos
  FOR UPDATE TO authenticated USING (can_edit() OR app_private.is_current_user_admin())
  WITH CHECK (can_edit() OR app_private.is_current_user_admin());

DROP POLICY IF EXISTS "gastos_fijos_montos_delete_admin" ON public.gastos_fijos_montos;
CREATE POLICY "gastos_fijos_montos_delete_admin" ON public.gastos_fijos_montos
  FOR DELETE TO authenticated USING (can_delete() OR app_private.is_current_user_admin());

INSERT INTO public.rol_permisos (rol_id, modulo, puede_ver, puede_agregar, puede_editar, puede_borrar)
VALUES
  ('admin', 'gastos_fijos', true, true, true, true),
  ('contador', 'gastos_fijos', true, true, true, false),
  ('visor', 'gastos_fijos', true, false, false, false)
ON CONFLICT (rol_id, modulo) DO UPDATE SET
  puede_ver = EXCLUDED.puede_ver,
  puede_agregar = EXCLUDED.puede_agregar,
  puede_editar = EXCLUDED.puede_editar,
  puede_borrar = EXCLUDED.puede_borrar;
