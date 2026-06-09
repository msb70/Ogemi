-- Align table RLS with the roles/rol_permisos permission model used by the app.

CREATE SCHEMA IF NOT EXISTS app_private;

CREATE OR REPLACE FUNCTION app_private.has_module_permission(
  p_modulo text,
  p_accion text DEFAULT 'ver'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles p
    LEFT JOIN public.rol_permisos rp
      ON rp.rol_id = p.rol_id
     AND rp.modulo = p_modulo
    WHERE p.id = auth.uid()
      AND p.activo = true
      AND (
        p.rol_id = 'admin'
        OR CASE p_accion
          WHEN 'ver' THEN COALESCE(rp.puede_ver, false)
          WHEN 'agregar' THEN COALESCE(rp.puede_agregar, false)
          WHEN 'editar' THEN COALESCE(rp.puede_editar, false)
          WHEN 'borrar' THEN COALESCE(rp.puede_borrar, false)
          ELSE false
        END
      )
  );
$$;

REVOKE ALL ON FUNCTION app_private.has_module_permission(text, text) FROM PUBLIC;
GRANT USAGE ON SCHEMA app_private TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.has_module_permission(text, text) TO authenticated;

-- clientes
DROP POLICY IF EXISTS "ver_clientes" ON public.clientes;
DROP POLICY IF EXISTS "editar_clientes" ON public.clientes;
DROP POLICY IF EXISTS "update_clientes" ON public.clientes;
DROP POLICY IF EXISTS "delete_clientes" ON public.clientes;

CREATE POLICY "ver_clientes" ON public.clientes FOR SELECT TO authenticated
  USING (
    app_private.has_module_permission('clientes', 'ver')
    OR app_private.has_module_permission('facturas', 'ver')
    OR app_private.has_module_permission('presupuestos', 'ver')
    OR app_private.has_module_permission('importar', 'ver')
    OR app_private.has_module_permission('reportes', 'ver')
    OR app_private.has_module_permission('dashboard', 'ver')
  );
CREATE POLICY "editar_clientes" ON public.clientes FOR INSERT TO authenticated
  WITH CHECK (
    app_private.has_module_permission('clientes', 'agregar')
    OR app_private.has_module_permission('importar', 'agregar')
  );
CREATE POLICY "update_clientes" ON public.clientes FOR UPDATE TO authenticated
  USING (app_private.has_module_permission('clientes', 'editar'))
  WITH CHECK (app_private.has_module_permission('clientes', 'editar'));
CREATE POLICY "delete_clientes" ON public.clientes FOR DELETE TO authenticated
  USING (app_private.has_module_permission('clientes', 'borrar'));

-- facturas
DROP POLICY IF EXISTS "ver_facturas" ON public.facturas;
DROP POLICY IF EXISTS "editar_facturas" ON public.facturas;
DROP POLICY IF EXISTS "update_facturas" ON public.facturas;
DROP POLICY IF EXISTS "delete_facturas" ON public.facturas;

CREATE POLICY "ver_facturas" ON public.facturas FOR SELECT TO authenticated
  USING (
    app_private.has_module_permission('facturas', 'ver')
    OR app_private.has_module_permission('gastos_fijos', 'ver')
    OR app_private.has_module_permission('reportes', 'ver')
    OR app_private.has_module_permission('dashboard', 'ver')
  );
CREATE POLICY "editar_facturas" ON public.facturas FOR INSERT TO authenticated
  WITH CHECK (
    app_private.has_module_permission('facturas', 'agregar')
    OR app_private.has_module_permission('gastos_fijos', 'agregar')
    OR app_private.has_module_permission('importar', 'agregar')
  );
CREATE POLICY "update_facturas" ON public.facturas FOR UPDATE TO authenticated
  USING (
    app_private.has_module_permission('facturas', 'editar')
    OR app_private.has_module_permission('gastos_fijos', 'editar')
  )
  WITH CHECK (
    app_private.has_module_permission('facturas', 'editar')
    OR app_private.has_module_permission('gastos_fijos', 'editar')
  );
CREATE POLICY "delete_facturas" ON public.facturas FOR DELETE TO authenticated
  USING (app_private.has_module_permission('facturas', 'borrar'));

-- banco
DROP POLICY IF EXISTS "ver_banco_cuentas" ON public.banco_cuentas;
DROP POLICY IF EXISTS "editar_banco_cuentas" ON public.banco_cuentas;
DROP POLICY IF EXISTS "ver_banco_movimientos" ON public.banco_movimientos;
DROP POLICY IF EXISTS "editar_banco_movimientos" ON public.banco_movimientos;
DROP POLICY IF EXISTS "delete_banco_movimientos" ON public.banco_movimientos;
DROP POLICY IF EXISTS "ver_cierre_mes" ON public.cierre_mes;
DROP POLICY IF EXISTS "editar_cierre_mes" ON public.cierre_mes;

CREATE POLICY "ver_banco_cuentas" ON public.banco_cuentas FOR SELECT TO authenticated
  USING (
    app_private.has_module_permission('banco', 'ver')
    OR app_private.has_module_permission('facturas', 'ver')
    OR app_private.has_module_permission('presupuestos', 'ver')
    OR app_private.has_module_permission('compras', 'ver')
    OR app_private.has_module_permission('gastos_fijos', 'ver')
    OR app_private.has_module_permission('reportes', 'ver')
    OR app_private.has_module_permission('dashboard', 'ver')
  );
CREATE POLICY "editar_banco_cuentas" ON public.banco_cuentas FOR ALL TO authenticated
  USING (app_private.has_module_permission('banco', 'editar'))
  WITH CHECK (app_private.has_module_permission('banco', 'editar'));

CREATE POLICY "ver_banco_movimientos" ON public.banco_movimientos FOR SELECT TO authenticated
  USING (
    app_private.has_module_permission('banco', 'ver')
    OR app_private.has_module_permission('reportes', 'ver')
    OR app_private.has_module_permission('dashboard', 'ver')
  );
CREATE POLICY "editar_banco_movimientos" ON public.banco_movimientos FOR INSERT TO authenticated
  WITH CHECK (
    app_private.has_module_permission('banco', 'agregar')
    OR (factura_id IS NOT NULL AND app_private.has_module_permission('facturas', 'editar'))
    OR (compra_id IS NOT NULL AND app_private.has_module_permission('compras', 'editar'))
    OR (presupuesto_id IS NOT NULL AND app_private.has_module_permission('presupuestos', 'editar'))
  );
CREATE POLICY "delete_banco_movimientos" ON public.banco_movimientos FOR DELETE TO authenticated
  USING (app_private.has_module_permission('banco', 'borrar'));

CREATE POLICY "ver_cierre_mes" ON public.cierre_mes FOR SELECT TO authenticated
  USING (
    app_private.has_module_permission('banco', 'ver')
    OR app_private.has_module_permission('reportes', 'ver')
  );
CREATE POLICY "editar_cierre_mes" ON public.cierre_mes FOR ALL TO authenticated
  USING (app_private.has_module_permission('banco', 'editar'))
  WITH CHECK (app_private.has_module_permission('banco', 'editar'));

-- anticipos y pagos
DROP POLICY IF EXISTS "ver_anticipos" ON public.anticipos;
DROP POLICY IF EXISTS "editar_anticipos" ON public.anticipos;
DROP POLICY IF EXISTS "update_anticipos" ON public.anticipos;
DROP POLICY IF EXISTS "delete_anticipos" ON public.anticipos;
DROP POLICY IF EXISTS "ver_pagos" ON public.pagos;
DROP POLICY IF EXISTS "editar_pagos" ON public.pagos;
DROP POLICY IF EXISTS "delete_pagos" ON public.pagos;

CREATE POLICY "ver_anticipos" ON public.anticipos FOR SELECT TO authenticated
  USING (
    app_private.has_module_permission('facturas', 'ver')
    OR app_private.has_module_permission('reportes', 'ver')
  );
CREATE POLICY "editar_anticipos" ON public.anticipos FOR INSERT TO authenticated
  WITH CHECK (app_private.has_module_permission('facturas', 'agregar'));
CREATE POLICY "update_anticipos" ON public.anticipos FOR UPDATE TO authenticated
  USING (app_private.has_module_permission('facturas', 'editar'))
  WITH CHECK (app_private.has_module_permission('facturas', 'editar'));
CREATE POLICY "delete_anticipos" ON public.anticipos FOR DELETE TO authenticated
  USING (app_private.has_module_permission('facturas', 'borrar'));

CREATE POLICY "ver_pagos" ON public.pagos FOR SELECT TO authenticated
  USING (
    app_private.has_module_permission('facturas', 'ver')
    OR app_private.has_module_permission('compras', 'ver')
    OR app_private.has_module_permission('reportes', 'ver')
  );
CREATE POLICY "editar_pagos" ON public.pagos FOR INSERT TO authenticated
  WITH CHECK (
    (factura_id IS NOT NULL AND app_private.has_module_permission('facturas', 'editar'))
    OR (compra_id IS NOT NULL AND app_private.has_module_permission('compras', 'editar'))
  );
CREATE POLICY "delete_pagos" ON public.pagos FOR DELETE TO authenticated
  USING (
    (factura_id IS NOT NULL AND app_private.has_module_permission('facturas', 'borrar'))
    OR (compra_id IS NOT NULL AND app_private.has_module_permission('compras', 'borrar'))
  );

-- proveedores
DROP POLICY IF EXISTS "ver_proveedores" ON public.proveedores;
DROP POLICY IF EXISTS "editar_proveedores" ON public.proveedores;
DROP POLICY IF EXISTS "update_proveedores" ON public.proveedores;
DROP POLICY IF EXISTS "delete_proveedores" ON public.proveedores;

CREATE POLICY "ver_proveedores" ON public.proveedores FOR SELECT TO authenticated
  USING (
    app_private.has_module_permission('proveedores', 'ver')
    OR app_private.has_module_permission('compras', 'ver')
    OR app_private.has_module_permission('reportes', 'ver')
    OR app_private.has_module_permission('dashboard', 'ver')
  );
CREATE POLICY "editar_proveedores" ON public.proveedores FOR INSERT TO authenticated
  WITH CHECK (app_private.has_module_permission('proveedores', 'agregar'));
CREATE POLICY "update_proveedores" ON public.proveedores FOR UPDATE TO authenticated
  USING (app_private.has_module_permission('proveedores', 'editar'))
  WITH CHECK (app_private.has_module_permission('proveedores', 'editar'));
CREATE POLICY "delete_proveedores" ON public.proveedores FOR DELETE TO authenticated
  USING (app_private.has_module_permission('proveedores', 'borrar'));

-- compras
DROP POLICY IF EXISTS "ver_compras" ON public.compras;
DROP POLICY IF EXISTS "editar_compras" ON public.compras;
DROP POLICY IF EXISTS "update_compras" ON public.compras;
DROP POLICY IF EXISTS "delete_compras" ON public.compras;

CREATE POLICY "ver_compras" ON public.compras FOR SELECT TO authenticated
  USING (
    app_private.has_module_permission('compras', 'ver')
    OR app_private.has_module_permission('reportes', 'ver')
    OR app_private.has_module_permission('dashboard', 'ver')
  );
CREATE POLICY "editar_compras" ON public.compras FOR INSERT TO authenticated
  WITH CHECK (app_private.has_module_permission('compras', 'agregar'));
CREATE POLICY "update_compras" ON public.compras FOR UPDATE TO authenticated
  USING (app_private.has_module_permission('compras', 'editar'))
  WITH CHECK (app_private.has_module_permission('compras', 'editar'));
CREATE POLICY "delete_compras" ON public.compras FOR DELETE TO authenticated
  USING (app_private.has_module_permission('compras', 'borrar'));

-- presupuestos
DROP POLICY IF EXISTS "ver_presupuestos" ON public.presupuestos;
DROP POLICY IF EXISTS "editar_presupuestos" ON public.presupuestos;
DROP POLICY IF EXISTS "update_presupuestos" ON public.presupuestos;
DROP POLICY IF EXISTS "delete_presupuestos" ON public.presupuestos;

CREATE POLICY "ver_presupuestos" ON public.presupuestos FOR SELECT TO authenticated
  USING (
    app_private.has_module_permission('presupuestos', 'ver')
    OR app_private.has_module_permission('reportes', 'ver')
  );
CREATE POLICY "editar_presupuestos" ON public.presupuestos FOR INSERT TO authenticated
  WITH CHECK (app_private.has_module_permission('presupuestos', 'agregar'));
CREATE POLICY "update_presupuestos" ON public.presupuestos FOR UPDATE TO authenticated
  USING (app_private.has_module_permission('presupuestos', 'editar'))
  WITH CHECK (app_private.has_module_permission('presupuestos', 'editar'));
CREATE POLICY "delete_presupuestos" ON public.presupuestos FOR DELETE TO authenticated
  USING (app_private.has_module_permission('presupuestos', 'borrar'));

-- gastos fijos
DROP POLICY IF EXISTS "gastos_fijos_select_auth" ON public.gastos_fijos;
DROP POLICY IF EXISTS "gastos_fijos_insert_edit" ON public.gastos_fijos;
DROP POLICY IF EXISTS "gastos_fijos_update_edit" ON public.gastos_fijos;
DROP POLICY IF EXISTS "gastos_fijos_delete_admin" ON public.gastos_fijos;
DROP POLICY IF EXISTS "gastos_fijos_montos_select_auth" ON public.gastos_fijos_montos;
DROP POLICY IF EXISTS "gastos_fijos_montos_insert_edit" ON public.gastos_fijos_montos;
DROP POLICY IF EXISTS "gastos_fijos_montos_update_edit" ON public.gastos_fijos_montos;
DROP POLICY IF EXISTS "gastos_fijos_montos_delete_admin" ON public.gastos_fijos_montos;

CREATE POLICY "gastos_fijos_select_auth" ON public.gastos_fijos FOR SELECT TO authenticated
  USING (app_private.has_module_permission('gastos_fijos', 'ver'));
CREATE POLICY "gastos_fijos_insert_edit" ON public.gastos_fijos FOR INSERT TO authenticated
  WITH CHECK (app_private.has_module_permission('gastos_fijos', 'agregar'));
CREATE POLICY "gastos_fijos_update_edit" ON public.gastos_fijos FOR UPDATE TO authenticated
  USING (app_private.has_module_permission('gastos_fijos', 'editar'))
  WITH CHECK (app_private.has_module_permission('gastos_fijos', 'editar'));
CREATE POLICY "gastos_fijos_delete_admin" ON public.gastos_fijos FOR DELETE TO authenticated
  USING (app_private.has_module_permission('gastos_fijos', 'borrar'));

CREATE POLICY "gastos_fijos_montos_select_auth" ON public.gastos_fijos_montos FOR SELECT TO authenticated
  USING (app_private.has_module_permission('gastos_fijos', 'ver'));
CREATE POLICY "gastos_fijos_montos_insert_edit" ON public.gastos_fijos_montos FOR INSERT TO authenticated
  WITH CHECK (app_private.has_module_permission('gastos_fijos', 'agregar'));
CREATE POLICY "gastos_fijos_montos_update_edit" ON public.gastos_fijos_montos FOR UPDATE TO authenticated
  USING (app_private.has_module_permission('gastos_fijos', 'editar'))
  WITH CHECK (app_private.has_module_permission('gastos_fijos', 'editar'));
CREATE POLICY "gastos_fijos_montos_delete_admin" ON public.gastos_fijos_montos FOR DELETE TO authenticated
  USING (app_private.has_module_permission('gastos_fijos', 'borrar'));

NOTIFY pgrst, 'reload schema';
