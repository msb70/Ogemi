-- Fix recursive RLS policies on user_profiles.
-- Admin checks must not query user_profiles directly from user_profiles policies.

CREATE SCHEMA IF NOT EXISTS app_private;

CREATE OR REPLACE FUNCTION app_private.is_current_user_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles p
    WHERE p.id = auth.uid()
      AND p.rol_id = 'admin'
      AND p.activo = true
  );
$$;

REVOKE ALL ON FUNCTION app_private.is_current_user_admin() FROM PUBLIC;
GRANT USAGE ON SCHEMA app_private TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.is_current_user_admin() TO authenticated;

DROP POLICY IF EXISTS "profiles_select_admin" ON public.user_profiles;
CREATE POLICY "profiles_select_admin" ON public.user_profiles
  FOR SELECT USING (app_private.is_current_user_admin());

DROP POLICY IF EXISTS "profiles_update_admin" ON public.user_profiles;
CREATE POLICY "profiles_update_admin" ON public.user_profiles
  FOR UPDATE USING (app_private.is_current_user_admin())
  WITH CHECK (app_private.is_current_user_admin());

DROP POLICY IF EXISTS "profiles_insert_admin" ON public.user_profiles;
CREATE POLICY "profiles_insert_admin" ON public.user_profiles
  FOR INSERT WITH CHECK (app_private.is_current_user_admin());

DROP POLICY IF EXISTS "roles_manage_admin" ON public.roles;
CREATE POLICY "roles_manage_admin" ON public.roles
  FOR ALL USING (app_private.is_current_user_admin())
  WITH CHECK (app_private.is_current_user_admin());

DROP POLICY IF EXISTS "rol_permisos_manage_admin" ON public.rol_permisos;
CREATE POLICY "rol_permisos_manage_admin" ON public.rol_permisos
  FOR ALL USING (app_private.is_current_user_admin())
  WITH CHECK (app_private.is_current_user_admin());
