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
    WHEN CURRENT_DATE - f.fecha_pago BETWEEN 91 AND 120 THEN '91-120'
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
