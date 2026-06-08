-- ============================================================
-- OGEMI - SQL UNICO PARA PROYECTO SUPABASE VACIO
-- Proyecto destino esperado: tnuzaaetfbbnxtbedlhs / ogemipty@gmail.com
-- Ejecutar completo en Supabase SQL Editor.
-- ============================================================

BEGIN;


-- ============================================================
-- ARCHIVO: supabase/schema.sql
-- ============================================================
-- ============================================================
-- OGEMI - IMPRESOS COMERCIALES SA
-- Schema Supabase / PostgreSQL
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABLA: user_roles
-- ============================================================
CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'operador', 'lectura')),
  puede_ver BOOLEAN DEFAULT TRUE,
  puede_editar BOOLEAN DEFAULT FALSE,
  puede_borrar BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- ============================================================
-- TABLA: clientes
-- ============================================================
CREATE TABLE IF NOT EXISTS clientes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre TEXT NOT NULL UNIQUE,
  dias_credito INTEGER DEFAULT 30 CHECK (dias_credito >= 0),
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLA: facturas
-- ============================================================
CREATE TABLE IF NOT EXISTS facturas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  numero_factura INTEGER NOT NULL,
  fecha DATE NOT NULL,
  cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  tipo_documento TEXT NOT NULL,
  documento_afectado INTEGER,
  monto NUMERIC(12,2) DEFAULT 0,
  itbms NUMERIC(12,2) DEFAULT 0,
  total NUMERIC(12,2) DEFAULT 0,
  fecha_pago DATE,
  estado TEXT DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'pagada')),
  fecha_cobro DATE,
  banco_cuenta_id UUID,
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_facturas_cliente ON facturas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_facturas_estado ON facturas(estado);
CREATE INDEX IF NOT EXISTS idx_facturas_fecha ON facturas(fecha);
CREATE INDEX IF NOT EXISTS idx_facturas_fecha_pago ON facturas(fecha_pago);

-- ============================================================
-- TABLA: banco_cuentas
-- ============================================================
CREATE TABLE IF NOT EXISTS banco_cuentas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre TEXT NOT NULL,
  banco TEXT NOT NULL,
  numero_cuenta TEXT,
  saldo_inicial NUMERIC(12,2) DEFAULT 0,
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- FK de facturas a banco_cuentas (después de crear la tabla)
ALTER TABLE facturas
  ADD CONSTRAINT fk_facturas_banco_cuenta
  FOREIGN KEY (banco_cuenta_id) REFERENCES banco_cuentas(id) ON DELETE SET NULL;

-- ============================================================
-- TABLA: banco_movimientos
-- ============================================================
CREATE TABLE IF NOT EXISTS banco_movimientos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cuenta_id UUID NOT NULL REFERENCES banco_cuentas(id) ON DELETE RESTRICT,
  factura_id UUID REFERENCES facturas(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('ingreso', 'egreso')),
  concepto TEXT NOT NULL,
  monto NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  fecha DATE NOT NULL,
  referencia TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_movimientos_cuenta ON banco_movimientos(cuenta_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_fecha ON banco_movimientos(fecha);

-- ============================================================
-- TABLA: cierre_mes
-- ============================================================
CREATE TABLE IF NOT EXISTS cierre_mes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cuenta_id UUID NOT NULL REFERENCES banco_cuentas(id) ON DELETE RESTRICT,
  periodo TEXT NOT NULL, -- formato: YYYY-MM
  saldo_sistema NUMERIC(12,2) DEFAULT 0,
  saldo_banco NUMERIC(12,2) DEFAULT 0,
  diferencia NUMERIC(12,2) GENERATED ALWAYS AS (saldo_banco - saldo_sistema) STORED,
  cerrado BOOLEAN DEFAULT FALSE,
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(cuenta_id, periodo)
);

-- ============================================================
-- TRIGGERS: updated_at automático
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_clientes_updated_at
  BEFORE UPDATE ON clientes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_facturas_updated_at
  BEFORE UPDATE ON facturas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_banco_cuentas_updated_at
  BEFORE UPDATE ON banco_cuentas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_banco_movimientos_updated_at
  BEFORE UPDATE ON banco_movimientos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- TRIGGER: Calcular fecha_pago al insertar/actualizar factura
-- ============================================================
CREATE OR REPLACE FUNCTION calcular_fecha_pago()
RETURNS TRIGGER AS $$
DECLARE
  v_dias INTEGER;
BEGIN
  SELECT dias_credito INTO v_dias FROM clientes WHERE id = NEW.cliente_id;
  NEW.fecha_pago = NEW.fecha + (COALESCE(v_dias, 30) || ' days')::INTERVAL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_calcular_fecha_pago
  BEFORE INSERT OR UPDATE OF fecha, cliente_id ON facturas
  FOR EACH ROW EXECUTE FUNCTION calcular_fecha_pago();

-- ============================================================
-- TRIGGER: Al marcar factura como pagada, crear movimiento en banco
-- ============================================================
CREATE OR REPLACE FUNCTION registrar_cobro_en_banco()
RETURNS TRIGGER AS $$
BEGIN
  -- Solo actuar cuando cambia de pendiente a pagada y tiene cuenta bancaria
  IF NEW.estado = 'pagada' AND OLD.estado = 'pendiente' AND NEW.banco_cuenta_id IS NOT NULL THEN
    INSERT INTO banco_movimientos (cuenta_id, factura_id, tipo, concepto, monto, fecha)
    VALUES (
      NEW.banco_cuenta_id,
      NEW.id,
      'ingreso',
      'Cobro factura #' || NEW.numero_factura,
      NEW.total,
      COALESCE(NEW.fecha_cobro, CURRENT_DATE)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_registrar_cobro
  AFTER UPDATE ON facturas
  FOR EACH ROW EXECUTE FUNCTION registrar_cobro_en_banco();

-- ============================================================
-- FUNCIÓN: Calcular saldo de cuenta bancaria
-- ============================================================
CREATE OR REPLACE FUNCTION saldo_cuenta(p_cuenta_id UUID, p_hasta DATE DEFAULT CURRENT_DATE)
RETURNS NUMERIC AS $$
DECLARE
  v_saldo_inicial NUMERIC;
  v_ingresos NUMERIC;
  v_egresos NUMERIC;
BEGIN
  SELECT COALESCE(saldo_inicial, 0) INTO v_saldo_inicial
  FROM banco_cuentas WHERE id = p_cuenta_id;

  SELECT COALESCE(SUM(monto), 0) INTO v_ingresos
  FROM banco_movimientos
  WHERE cuenta_id = p_cuenta_id AND tipo = 'ingreso' AND fecha <= p_hasta;

  SELECT COALESCE(SUM(monto), 0) INTO v_egresos
  FROM banco_movimientos
  WHERE cuenta_id = p_cuenta_id AND tipo = 'egreso' AND fecha <= p_hasta;

  RETURN v_saldo_inicial + v_ingresos - v_egresos;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- VISTA: cartera_vencida (antigüedad de saldos)
-- ============================================================
CREATE OR REPLACE VIEW cartera_vencida WITH (security_invoker = true) AS
SELECT
  f.id,
  f.numero_factura,
  f.fecha,
  f.fecha_pago,
  c.nombre AS cliente,
  f.monto,
  f.itbms,
  f.total,
  CURRENT_DATE - f.fecha_pago AS dias_vencida,
  CASE
    WHEN CURRENT_DATE <= f.fecha_pago THEN 'corriente'
    WHEN CURRENT_DATE - f.fecha_pago BETWEEN 1 AND 30 THEN '1-30'
    WHEN CURRENT_DATE - f.fecha_pago BETWEEN 31 AND 60 THEN '31-60'
    WHEN CURRENT_DATE - f.fecha_pago BETWEEN 61 AND 90 THEN '61-90'
    ELSE '+120'
  END AS tramo
FROM facturas f
JOIN clientes c ON c.id = f.cliente_id
WHERE f.estado = 'pendiente'
  AND f.total > 0;

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE facturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE banco_cuentas ENABLE ROW LEVEL SECURITY;
ALTER TABLE banco_movimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE cierre_mes ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Helper: obtener rol del usuario actual
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM user_roles WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION can_edit()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(puede_editar, FALSE) FROM user_roles WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION can_delete()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(puede_borrar, FALSE) FROM user_roles WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER;

-- Policies: ver (todos los autenticados con rol)
CREATE POLICY "ver_clientes" ON clientes FOR SELECT
  TO authenticated USING (get_user_role() IS NOT NULL);

CREATE POLICY "editar_clientes" ON clientes FOR INSERT
  TO authenticated WITH CHECK (can_edit());

CREATE POLICY "update_clientes" ON clientes FOR UPDATE
  TO authenticated USING (can_edit());

CREATE POLICY "delete_clientes" ON clientes FOR DELETE
  TO authenticated USING (can_delete());

-- Policies facturas
CREATE POLICY "ver_facturas" ON facturas FOR SELECT
  TO authenticated USING (get_user_role() IS NOT NULL);

CREATE POLICY "editar_facturas" ON facturas FOR INSERT
  TO authenticated WITH CHECK (can_edit());

CREATE POLICY "update_facturas" ON facturas FOR UPDATE
  TO authenticated USING (can_edit());

CREATE POLICY "delete_facturas" ON facturas FOR DELETE
  TO authenticated USING (can_delete());

-- Policies banco
CREATE POLICY "ver_banco_cuentas" ON banco_cuentas FOR SELECT
  TO authenticated USING (get_user_role() IS NOT NULL);

CREATE POLICY "editar_banco_cuentas" ON banco_cuentas FOR ALL
  TO authenticated USING (can_edit()) WITH CHECK (can_edit());

CREATE POLICY "ver_banco_movimientos" ON banco_movimientos FOR SELECT
  TO authenticated USING (get_user_role() IS NOT NULL);

CREATE POLICY "editar_banco_movimientos" ON banco_movimientos FOR INSERT
  TO authenticated WITH CHECK (can_edit());

CREATE POLICY "delete_banco_movimientos" ON banco_movimientos FOR DELETE
  TO authenticated USING (can_delete());

CREATE POLICY "ver_cierre_mes" ON cierre_mes FOR SELECT
  TO authenticated USING (get_user_role() IS NOT NULL);

CREATE POLICY "editar_cierre_mes" ON cierre_mes FOR ALL
  TO authenticated USING (can_edit()) WITH CHECK (can_edit());

-- user_roles: solo admin puede ver/editar todos
CREATE POLICY "ver_roles" ON user_roles FOR SELECT
  TO authenticated USING (get_user_role() = 'admin' OR user_id = auth.uid());

CREATE POLICY "editar_roles" ON user_roles FOR ALL
  TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');

-- ============================================================
-- DATOS INICIALES: primer admin (se asigna después de crear usuario)
-- ============================================================
-- Ejecutar manualmente después de crear el primer usuario:
-- INSERT INTO user_roles (user_id, role, puede_ver, puede_editar, puede_borrar)
-- VALUES ('<UUID-DEL-PRIMER-USUARIO>', 'admin', true, true, true);

-- ============================================================
-- ARCHIVO: supabase/schema_compras.sql
-- ============================================================
-- ============================================================
-- OGEMI - MÓDULO DE COMPRAS Y PROVEEDORES
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- ============================================================
-- TABLA: proveedores
-- ============================================================
CREATE TABLE IF NOT EXISTS proveedores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre TEXT NOT NULL UNIQUE,
  dias_credito INTEGER DEFAULT 30 CHECK (dias_credito >= 0),
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLA: compras
-- ============================================================
CREATE TABLE IF NOT EXISTS compras (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fecha DATE NOT NULL,
  vencimiento DATE,
  proveedor_id UUID NOT NULL REFERENCES proveedores(id) ON DELETE RESTRICT,
  concepto TEXT,
  referencia TEXT,
  monto NUMERIC(12,2) DEFAULT 0 CHECK (monto >= 0),
  itbms NUMERIC(12,2) DEFAULT 0 CHECK (itbms >= 0),
  total NUMERIC(12,2) DEFAULT 0,
  estado TEXT DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'pagada')),
  banco_cuenta_id UUID REFERENCES banco_cuentas(id) ON DELETE SET NULL,
  fecha_pago DATE,
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compras_proveedor ON compras(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_compras_estado ON compras(estado);
CREATE INDEX IF NOT EXISTS idx_compras_fecha ON compras(fecha);
CREATE INDEX IF NOT EXISTS idx_compras_vencimiento ON compras(vencimiento);

-- ============================================================
-- AGREGAR compra_id a banco_movimientos (para trazabilidad)
-- ============================================================
ALTER TABLE banco_movimientos
  ADD COLUMN IF NOT EXISTS compra_id UUID REFERENCES compras(id) ON DELETE SET NULL;

-- ============================================================
-- TRIGGER: updated_at en proveedores y compras
-- ============================================================
CREATE OR REPLACE TRIGGER trg_proveedores_updated_at
  BEFORE UPDATE ON proveedores
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_compras_updated_at
  BEFORE UPDATE ON compras
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- TRIGGER: Calcular vencimiento y total al insertar/actualizar compra
-- ============================================================
CREATE OR REPLACE FUNCTION calcular_vencimiento_compra()
RETURNS TRIGGER AS $$
DECLARE
  v_dias INTEGER;
BEGIN
  -- Calcular vencimiento
  SELECT dias_credito INTO v_dias FROM proveedores WHERE id = NEW.proveedor_id;
  NEW.vencimiento = NEW.fecha + (COALESCE(v_dias, 30) || ' days')::INTERVAL;
  -- Calcular total
  NEW.total = COALESCE(NEW.monto, 0) + COALESCE(NEW.itbms, 0);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_calcular_vencimiento_compra
  BEFORE INSERT OR UPDATE OF fecha, proveedor_id, monto, itbms ON compras
  FOR EACH ROW EXECUTE FUNCTION calcular_vencimiento_compra();

-- ============================================================
-- TRIGGER: Al pagar compra, registrar egreso en banco
-- ============================================================
CREATE OR REPLACE FUNCTION registrar_pago_compra()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.estado = 'pagada' AND OLD.estado = 'pendiente' AND NEW.banco_cuenta_id IS NOT NULL THEN
    INSERT INTO banco_movimientos (cuenta_id, compra_id, tipo, concepto, monto, fecha)
    VALUES (
      NEW.banco_cuenta_id,
      NEW.id,
      'egreso',
      'Pago compra: ' || COALESCE(NEW.concepto, 'Proveedor'),
      NEW.total,
      COALESCE(NEW.fecha_pago, CURRENT_DATE)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_registrar_pago_compra
  AFTER UPDATE ON compras
  FOR EACH ROW EXECUTE FUNCTION registrar_pago_compra();

-- ============================================================
-- VISTA: compras_vencidas (cuentas por pagar vencidas)
-- ============================================================
CREATE OR REPLACE VIEW compras_vencidas WITH (security_invoker = true) AS
SELECT
  c.id,
  c.fecha,
  c.vencimiento,
  p.nombre AS proveedor,
  c.concepto,
  c.monto,
  c.itbms,
  c.total,
  CURRENT_DATE - c.vencimiento AS dias_vencida,
  CASE
    WHEN CURRENT_DATE <= c.vencimiento THEN 'corriente'
    WHEN CURRENT_DATE - c.vencimiento BETWEEN 1 AND 30 THEN '1-30'
    WHEN CURRENT_DATE - c.vencimiento BETWEEN 31 AND 60 THEN '31-60'
    WHEN CURRENT_DATE - c.vencimiento BETWEEN 61 AND 90 THEN '61-90'
    ELSE '+120'
  END AS tramo
FROM compras c
JOIN proveedores p ON p.id = c.proveedor_id
WHERE c.estado = 'pendiente'
  AND c.total > 0;

-- ============================================================
-- RLS: proveedores
-- ============================================================
ALTER TABLE proveedores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ver_proveedores" ON proveedores FOR SELECT
  TO authenticated USING (get_user_role() IS NOT NULL);

CREATE POLICY "editar_proveedores" ON proveedores FOR INSERT
  TO authenticated WITH CHECK (can_edit());

CREATE POLICY "update_proveedores" ON proveedores FOR UPDATE
  TO authenticated USING (can_edit());

CREATE POLICY "delete_proveedores" ON proveedores FOR DELETE
  TO authenticated USING (can_delete());

-- ============================================================
-- RLS: compras
-- ============================================================
ALTER TABLE compras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ver_compras" ON compras FOR SELECT
  TO authenticated USING (get_user_role() IS NOT NULL);

CREATE POLICY "editar_compras" ON compras FOR INSERT
  TO authenticated WITH CHECK (can_edit());

CREATE POLICY "update_compras" ON compras FOR UPDATE
  TO authenticated USING (can_edit());

CREATE POLICY "delete_compras" ON compras FOR DELETE
  TO authenticated USING (can_delete());

-- ============================================================
-- ARCHIVO: supabase/migrations/20260602151942_create_presupuestos_module.sql
-- ============================================================
-- ============================================================
-- MIGRACION: Modulo de presupuestos
-- ============================================================

CREATE TABLE IF NOT EXISTS presupuestos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_presupuesto INTEGER NOT NULL,
  fecha DATE NOT NULL,
  cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  tipo_documento TEXT NOT NULL DEFAULT 'PRESUPUESTO',
  documento_afectado INTEGER,
  monto NUMERIC(12,2) NOT NULL DEFAULT 0,
  itbms NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  fecha_pago DATE,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'pagada')),
  fecha_cobro DATE,
  banco_cuenta_id UUID REFERENCES banco_cuentas(id) ON DELETE SET NULL,
  notas TEXT,
  monto_pagado NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_presupuestos_cliente ON presupuestos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_presupuestos_estado ON presupuestos(estado);
CREATE INDEX IF NOT EXISTS idx_presupuestos_fecha ON presupuestos(fecha);
CREATE INDEX IF NOT EXISTS idx_presupuestos_fecha_pago ON presupuestos(fecha_pago);

ALTER TABLE banco_movimientos
  ADD COLUMN IF NOT EXISTS presupuesto_id UUID REFERENCES presupuestos(id) ON DELETE SET NULL;

CREATE OR REPLACE TRIGGER trg_presupuestos_updated_at
  BEFORE UPDATE ON presupuestos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION calcular_fecha_pago_presupuesto()
RETURNS TRIGGER AS $$
DECLARE
  v_dias INTEGER;
BEGIN
  SELECT dias_credito INTO v_dias FROM clientes WHERE id = NEW.cliente_id;
  NEW.fecha_pago = NEW.fecha + (COALESCE(v_dias, 30) || ' days')::INTERVAL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_calcular_fecha_pago_presupuesto
  BEFORE INSERT OR UPDATE OF fecha, cliente_id ON presupuestos
  FOR EACH ROW EXECUTE FUNCTION calcular_fecha_pago_presupuesto();

CREATE OR REPLACE FUNCTION registrar_cobro_presupuesto_en_banco()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.estado = 'pagada' AND OLD.estado = 'pendiente' AND NEW.banco_cuenta_id IS NOT NULL THEN
    INSERT INTO banco_movimientos (cuenta_id, presupuesto_id, tipo, concepto, monto, fecha)
    VALUES (
      NEW.banco_cuenta_id,
      NEW.id,
      'ingreso',
      'Cobro presupuesto #' || NEW.numero_presupuesto,
      NEW.total,
      COALESCE(NEW.fecha_cobro, CURRENT_DATE)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_registrar_cobro_presupuesto
  AFTER UPDATE ON presupuestos
  FOR EACH ROW EXECUTE FUNCTION registrar_cobro_presupuesto_en_banco();

DROP VIEW IF EXISTS cartera_presupuestos;
CREATE VIEW cartera_presupuestos WITH (security_invoker = true) AS
SELECT
  p.id,
  p.numero_presupuesto,
  p.fecha,
  p.fecha_pago,
  c.nombre AS cliente,
  p.monto,
  p.itbms,
  p.total,
  COALESCE(p.monto_pagado, 0) AS monto_pagado,
  (p.total - COALESCE(p.monto_pagado, 0)) AS saldo_pendiente,
  CURRENT_DATE - p.fecha_pago AS dias_vencida,
  CASE
    WHEN CURRENT_DATE <= p.fecha_pago THEN 'corriente'
    WHEN CURRENT_DATE - p.fecha_pago BETWEEN 1 AND 30 THEN '1-30'
    WHEN CURRENT_DATE - p.fecha_pago BETWEEN 31 AND 60 THEN '31-60'
    WHEN CURRENT_DATE - p.fecha_pago BETWEEN 61 AND 90 THEN '61-90'
    ELSE '+120'
  END AS tramo
FROM presupuestos p
JOIN clientes c ON c.id = p.cliente_id
WHERE p.estado = 'pendiente'
  AND p.total > 0;

ALTER TABLE presupuestos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can manage presupuestos" ON presupuestos;
DROP POLICY IF EXISTS "ver_presupuestos" ON presupuestos;
DROP POLICY IF EXISTS "editar_presupuestos" ON presupuestos;
DROP POLICY IF EXISTS "update_presupuestos" ON presupuestos;
DROP POLICY IF EXISTS "delete_presupuestos" ON presupuestos;

CREATE POLICY "ver_presupuestos" ON presupuestos FOR SELECT
  TO authenticated USING (get_user_role() IS NOT NULL);

CREATE POLICY "editar_presupuestos" ON presupuestos FOR INSERT
  TO authenticated WITH CHECK (can_edit());

CREATE POLICY "update_presupuestos" ON presupuestos FOR UPDATE
  TO authenticated USING (can_edit());

CREATE POLICY "delete_presupuestos" ON presupuestos FOR DELETE
  TO authenticated USING (can_delete());

-- ============================================================
-- ARCHIVO: supabase/migrations/002_anticipos_pagos.sql
-- ============================================================
-- ============================================================
-- MIGRACIÓN 002: Anticipos, Pagos Parciales y Mejoras
-- ============================================================

-- ============================================================
-- 1. TABLA: anticipos
--    Depósitos anticipados de clientes antes de emitir factura
-- ============================================================
CREATE TABLE IF NOT EXISTS anticipos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  cuenta_id UUID NOT NULL REFERENCES banco_cuentas(id) ON DELETE RESTRICT,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  monto NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  numero_deposito TEXT,
  notas TEXT,
  estado TEXT DEFAULT 'activo' CHECK (estado IN ('activo', 'aplicado', 'anulado')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anticipos_cliente ON anticipos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_anticipos_fecha ON anticipos(fecha);
CREATE INDEX IF NOT EXISTS idx_anticipos_estado ON anticipos(estado);

CREATE OR REPLACE TRIGGER trg_anticipos_updated_at
  BEFORE UPDATE ON anticipos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 2. TABLA: pagos
--    Permite abonos parciales en facturas y compras
--    con soporte de múltiples cuentas por pago
-- ============================================================
CREATE TABLE IF NOT EXISTS pagos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  factura_id UUID REFERENCES facturas(id) ON DELETE CASCADE,
  compra_id UUID REFERENCES compras(id) ON DELETE CASCADE,
  cuenta_id UUID NOT NULL REFERENCES banco_cuentas(id) ON DELETE RESTRICT,
  monto NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  referencia TEXT,
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT pago_origen CHECK (
    (factura_id IS NOT NULL AND compra_id IS NULL) OR
    (factura_id IS NULL AND compra_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_pagos_factura ON pagos(factura_id);
CREATE INDEX IF NOT EXISTS idx_pagos_compra ON pagos(compra_id);
CREATE INDEX IF NOT EXISTS idx_pagos_fecha ON pagos(fecha);

-- ============================================================
-- 3. CAMPO: monto_pagado en facturas y compras
-- ============================================================
ALTER TABLE facturas
  ADD COLUMN IF NOT EXISTS monto_pagado NUMERIC(12,2) DEFAULT 0;

ALTER TABLE compras
  ADD COLUMN IF NOT EXISTS monto_pagado NUMERIC(12,2) DEFAULT 0;

-- Sincronizar monto_pagado con facturas ya marcadas como pagadas
UPDATE facturas SET monto_pagado = total WHERE estado = 'pagada' AND monto_pagado = 0;
UPDATE compras SET monto_pagado = total WHERE estado = 'pagada' AND monto_pagado = 0;

-- ============================================================
-- 4. TRIGGER: Al insertar un pago, crear movimiento bancario
--    y actualizar monto_pagado + estado de la factura/compra
-- ============================================================

-- Eliminar el trigger antiguo que crea movimientos al marcar como pagada
-- (ahora los movimientos se crean al registrar pagos)
DROP TRIGGER IF EXISTS trg_registrar_cobro ON facturas;
DROP TRIGGER IF EXISTS trg_registrar_pago_compra ON compras;

-- Nuevo trigger: cuando se inserta un pago de factura
CREATE OR REPLACE FUNCTION procesar_pago()
RETURNS TRIGGER AS $$
DECLARE
  v_total_factura NUMERIC;
  v_total_compra NUMERIC;
  v_monto_pagado NUMERIC;
  v_concepto TEXT;
BEGIN
  IF NEW.factura_id IS NOT NULL THEN
    -- Crear movimiento bancario (ingreso)
    SELECT total INTO v_total_factura FROM facturas WHERE id = NEW.factura_id;
    SELECT numero_factura INTO v_concepto FROM facturas WHERE id = NEW.factura_id;

    INSERT INTO banco_movimientos (cuenta_id, factura_id, tipo, concepto, monto, fecha, referencia)
    VALUES (
      NEW.cuenta_id,
      NEW.factura_id,
      'ingreso',
      'Cobro factura #' || v_concepto || COALESCE(' - ' || NEW.referencia, ''),
      NEW.monto,
      NEW.fecha,
      NEW.referencia
    );

    -- Recalcular monto_pagado
    SELECT COALESCE(SUM(monto), 0) INTO v_monto_pagado
    FROM pagos WHERE factura_id = NEW.factura_id;

    -- Actualizar factura
    UPDATE facturas SET
      monto_pagado = v_monto_pagado,
      estado = CASE WHEN v_monto_pagado >= total THEN 'pagada' ELSE 'pendiente' END,
      fecha_cobro = CASE WHEN v_monto_pagado >= total THEN NEW.fecha ELSE fecha_cobro END,
      banco_cuenta_id = CASE WHEN v_monto_pagado >= total THEN NEW.cuenta_id ELSE banco_cuenta_id END
    WHERE id = NEW.factura_id;

  ELSIF NEW.compra_id IS NOT NULL THEN
    -- Crear movimiento bancario (egreso)
    SELECT total INTO v_total_compra FROM compras WHERE id = NEW.compra_id;
    SELECT concepto INTO v_concepto FROM compras WHERE id = NEW.compra_id;

    INSERT INTO banco_movimientos (cuenta_id, compra_id, tipo, concepto, monto, fecha, referencia)
    VALUES (
      NEW.cuenta_id,
      NEW.compra_id,
      'egreso',
      'Pago compra: ' || COALESCE(v_concepto, 'sin concepto') || COALESCE(' - ' || NEW.referencia, ''),
      NEW.monto,
      NEW.fecha,
      NEW.referencia
    );

    -- Recalcular monto_pagado
    SELECT COALESCE(SUM(monto), 0) INTO v_monto_pagado
    FROM pagos WHERE compra_id = NEW.compra_id;

    -- Actualizar compra
    UPDATE compras SET
      monto_pagado = v_monto_pagado,
      estado = CASE WHEN v_monto_pagado >= total THEN 'pagada' ELSE 'pendiente' END,
      fecha_pago = CASE WHEN v_monto_pagado >= total THEN NEW.fecha ELSE fecha_pago END,
      banco_cuenta_id = CASE WHEN v_monto_pagado >= total THEN NEW.cuenta_id ELSE banco_cuenta_id END
    WHERE id = NEW.compra_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_procesar_pago
  AFTER INSERT ON pagos
  FOR EACH ROW EXECUTE FUNCTION procesar_pago();

-- ============================================================
-- 5. AGREGAR compra_id a banco_movimientos (si no existe)
-- ============================================================
ALTER TABLE banco_movimientos
  ADD COLUMN IF NOT EXISTS compra_id UUID REFERENCES compras(id) ON DELETE SET NULL;

-- ============================================================
-- 6. RLS para nuevas tablas
-- ============================================================
ALTER TABLE anticipos ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ver_anticipos" ON anticipos FOR SELECT
  TO authenticated USING (get_user_role() IS NOT NULL);

CREATE POLICY "editar_anticipos" ON anticipos FOR INSERT
  TO authenticated WITH CHECK (can_edit());

CREATE POLICY "update_anticipos" ON anticipos FOR UPDATE
  TO authenticated USING (can_edit());

CREATE POLICY "delete_anticipos" ON anticipos FOR DELETE
  TO authenticated USING (can_delete());

CREATE POLICY "ver_pagos" ON pagos FOR SELECT
  TO authenticated USING (get_user_role() IS NOT NULL);

CREATE POLICY "editar_pagos" ON pagos FOR INSERT
  TO authenticated WITH CHECK (can_edit());

CREATE POLICY "delete_pagos" ON pagos FOR DELETE
  TO authenticated USING (can_delete());

-- ============================================================
-- 7. ACTUALIZAR vista cartera_vencida para considerar abonos
-- ============================================================
DROP VIEW IF EXISTS cartera_vencida;
CREATE VIEW cartera_vencida WITH (security_invoker = true) AS
SELECT
  f.id,
  f.numero_factura,
  f.fecha,
  f.fecha_pago,
  c.nombre AS cliente,
  f.monto,
  f.itbms,
  f.total,
  COALESCE(f.monto_pagado, 0) AS monto_pagado,
  (f.total - COALESCE(f.monto_pagado, 0)) AS saldo_pendiente,
  CURRENT_DATE - f.fecha_pago AS dias_vencida,
  CASE
    WHEN CURRENT_DATE <= f.fecha_pago THEN 'corriente'
    WHEN CURRENT_DATE - f.fecha_pago BETWEEN 1 AND 30 THEN '1-30'
    WHEN CURRENT_DATE - f.fecha_pago BETWEEN 31 AND 60 THEN '31-60'
    WHEN CURRENT_DATE - f.fecha_pago BETWEEN 61 AND 90 THEN '61-90'
    ELSE '+120'
  END AS tramo
FROM facturas f
JOIN clientes c ON c.id = f.cliente_id
WHERE f.estado = 'pendiente'
  AND f.total > 0;

COMMIT;

-- Despues de crear el primer usuario en Authentication, ejecutar:
-- INSERT INTO user_roles (user_id, role, puede_ver, puede_editar, puede_borrar)
-- VALUES ('<UUID-DEL-USUARIO>', 'admin', true, true, true);
