-- Allow administrators to manage users, roles and module permissions.

DROP POLICY IF EXISTS "roles_manage_admin" ON public.roles;
CREATE POLICY "roles_manage_admin" ON public.roles
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE p.id = auth.uid() AND p.rol_id = 'admin' AND p.activo = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE p.id = auth.uid() AND p.rol_id = 'admin' AND p.activo = true
    )
  );

DROP POLICY IF EXISTS "rol_permisos_manage_admin" ON public.rol_permisos;
CREATE POLICY "rol_permisos_manage_admin" ON public.rol_permisos
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE p.id = auth.uid() AND p.rol_id = 'admin' AND p.activo = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE p.id = auth.uid() AND p.rol_id = 'admin' AND p.activo = true
    )
  );

DROP POLICY IF EXISTS "profiles_insert_admin" ON public.user_profiles;
CREATE POLICY "profiles_insert_admin" ON public.user_profiles
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE p.id = auth.uid() AND p.rol_id = 'admin' AND p.activo = true
    )
  );
