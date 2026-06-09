-- ============================================================
-- Sprint 5.1 — Auth, Roles y Permisos por Módulo
-- Aplicar desde: Supabase Dashboard > SQL Editor
-- ============================================================

-- 1. Tabla de roles
CREATE TABLE IF NOT EXISTS public.roles (
  id          text PRIMARY KEY,
  nombre      text NOT NULL,
  descripcion text,
  es_sistema  boolean DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

-- 2. Permisos por rol y módulo
CREATE TABLE IF NOT EXISTS public.rol_permisos (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  rol_id       text NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  modulo       text NOT NULL,
  puede_ver    boolean DEFAULT false,
  puede_agregar boolean DEFAULT false,
  puede_editar boolean DEFAULT false,
  puede_borrar boolean DEFAULT false,
  UNIQUE(rol_id, modulo)
);

-- 3. Perfiles de usuario (extiende auth.users)
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      text NOT NULL,
  nombre     text,
  avatar_url text,
  rol_id     text NOT NULL REFERENCES public.roles(id) DEFAULT 'visor',
  activo     boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 4. Seed: roles base
INSERT INTO public.roles (id, nombre, descripcion) VALUES
  ('admin',    'Administrador', 'Acceso total al sistema'),
  ('contador', 'Contador',      'Gestión contable sin eliminar registros'),
  ('visor',    'Solo lectura',  'Visualización sin modificaciones')
ON CONFLICT (id) DO NOTHING;

-- 5. Permisos admin: todo en todos los módulos
INSERT INTO public.rol_permisos (rol_id, modulo, puede_ver, puede_agregar, puede_editar, puede_borrar)
SELECT 'admin', m, true, true, true, true
FROM unnest(ARRAY[
  'dashboard','facturas','presupuestos','compras',
  'clientes','proveedores','banco','reportes','importar','usuarios'
]) AS m
ON CONFLICT (rol_id, modulo) DO NOTHING;

-- 6. Permisos contador: ver/agregar/editar en operaciones, sin borrar, sin módulo usuarios
INSERT INTO public.rol_permisos (rol_id, modulo, puede_ver, puede_agregar, puede_editar, puede_borrar)
SELECT 'contador', m, true, true, true, false
FROM unnest(ARRAY[
  'dashboard','facturas','presupuestos','compras',
  'clientes','proveedores','banco','reportes','importar'
]) AS m
ON CONFLICT (rol_id, modulo) DO NOTHING;

INSERT INTO public.rol_permisos (rol_id, modulo, puede_ver, puede_agregar, puede_editar, puede_borrar)
VALUES ('contador', 'usuarios', false, false, false, false)
ON CONFLICT (rol_id, modulo) DO NOTHING;

-- 7. Permisos visor: solo ver, sin importar ni usuarios
INSERT INTO public.rol_permisos (rol_id, modulo, puede_ver, puede_agregar, puede_editar, puede_borrar)
SELECT 'visor', m, true, false, false, false
FROM unnest(ARRAY[
  'dashboard','facturas','presupuestos','compras',
  'clientes','proveedores','banco','reportes'
]) AS m
ON CONFLICT (rol_id, modulo) DO NOTHING;

INSERT INTO public.rol_permisos (rol_id, modulo, puede_ver, puede_agregar, puede_editar, puede_borrar)
VALUES
  ('visor', 'importar', false, false, false, false),
  ('visor', 'usuarios', false, false, false, false)
ON CONFLICT (rol_id, modulo) DO NOTHING;

-- 8. Trigger: al crear usuario en auth, crear perfil automáticamente
--    El primer usuario recibe rol admin; el resto, visor
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  user_count int;
  assigned_role text;
BEGIN
  SELECT COUNT(*) INTO user_count FROM public.user_profiles;

  IF user_count = 0 THEN
    assigned_role := 'admin';
  ELSE
    assigned_role := 'visor';
  END IF;

  INSERT INTO public.user_profiles (id, email, nombre, avatar_url, rol_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url',
    assigned_role
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 9. RLS
ALTER TABLE public.roles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rol_permisos  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- roles: cualquier usuario autenticado puede leer
CREATE POLICY "roles_select_auth" ON public.roles
  FOR SELECT USING (auth.role() = 'authenticated');

-- rol_permisos: cualquier usuario autenticado puede leer
CREATE POLICY "rol_permisos_select_auth" ON public.rol_permisos
  FOR SELECT USING (auth.role() = 'authenticated');

-- user_profiles: cada usuario lee su propio perfil
CREATE POLICY "profiles_select_own" ON public.user_profiles
  FOR SELECT USING (auth.uid() = id);

-- user_profiles: admins leen todos los perfiles
CREATE POLICY "profiles_select_admin" ON public.user_profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE p.id = auth.uid() AND p.rol_id = 'admin'
    )
  );

-- user_profiles: admins actualizan (cambiar rol, activar/desactivar)
CREATE POLICY "profiles_update_admin" ON public.user_profiles
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE p.id = auth.uid() AND p.rol_id = 'admin'
    )
  );

-- user_profiles: el trigger puede insertar (SECURITY DEFINER ya bypasea RLS,
--   pero la policy es necesaria si se inserta desde cliente)
CREATE POLICY "profiles_insert_trigger" ON public.user_profiles
  FOR INSERT WITH CHECK (true);
