-- Sync the known administrator account with the active auth/permissions schema.

INSERT INTO public.roles (id, nombre, descripcion)
VALUES ('admin', 'Administrador', 'Acceso total al sistema')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.rol_permisos (rol_id, modulo, puede_ver, puede_agregar, puede_editar, puede_borrar)
SELECT 'admin', modulo, true, true, true, true
FROM unnest(ARRAY[
  'dashboard',
  'facturas',
  'presupuestos',
  'compras',
  'clientes',
  'proveedores',
  'banco',
  'reportes',
  'importar',
  'usuarios'
]) AS modulo
ON CONFLICT (rol_id, modulo) DO UPDATE SET
  puede_ver = true,
  puede_agregar = true,
  puede_editar = true,
  puede_borrar = true;

DO $$
DECLARE
  admin_email text := 'miguel.spina.busek@gmail.com';
BEGIN
  INSERT INTO public.user_profiles (id, email, nombre, avatar_url, rol_id, activo)
  SELECT
    u.id,
    u.email,
    COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)),
    u.raw_user_meta_data->>'avatar_url',
    'admin',
    true
  FROM auth.users u
  WHERE lower(u.email) = lower(admin_email)
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    nombre = COALESCE(public.user_profiles.nombre, EXCLUDED.nombre),
    avatar_url = COALESCE(public.user_profiles.avatar_url, EXCLUDED.avatar_url),
    rol_id = 'admin',
    activo = true,
    updated_at = now();

  IF to_regclass('public.user_roles') IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role, puede_ver, puede_editar, puede_borrar)
    SELECT u.id, 'admin', true, true, true
    FROM auth.users u
    WHERE lower(u.email) = lower(admin_email)
    ON CONFLICT (user_id) DO UPDATE SET
      role = 'admin',
      puede_ver = true,
      puede_editar = true,
      puede_borrar = true;
  END IF;
END $$;
