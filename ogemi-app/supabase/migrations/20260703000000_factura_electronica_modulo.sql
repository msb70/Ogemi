-- ============ Módulo Factura Electrónica (PAC TheFactory Panamá) ============
-- Emisión de FE (tipo 01) y NC electrónica (tipos 04/06) vía CFE Premium Soft.
-- Manual: endpoint https://cfe.premium-soft.com/Pac/TimbradoPanamaTheFactoryPremium (id_pac 4)

-- 1) Datos fiscales del cliente (requeridos por operti)
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS ruc text,
  ADD COLUMN IF NOT EXISTS dv text,
  ADD COLUMN IF NOT EXISTS tipo_contribuyente smallint NOT NULL DEFAULT 2 CHECK (tipo_contribuyente IN (1,2)),
  ADD COLUMN IF NOT EXISTS tipo_cliente text NOT NULL DEFAULT '01' CHECK (tipo_cliente IN ('01','02','03','04')),
  ADD COLUMN IF NOT EXISTS direccion text,
  ADD COLUMN IF NOT EXISTS email text;

-- 2) Configuración PAC (singleton). La clave solo la lee el servidor (service role)
--    y admins vía RLS; el resto de roles no puede leerla.
CREATE TABLE IF NOT EXISTS public.fe_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  pin text,
  usuario text,
  clave text,
  codigo_sucursal text NOT NULL DEFAULT '001',
  nro_terminal text NOT NULL DEFAULT '1',
  endpoint_url text NOT NULL DEFAULT 'https://cfe.premium-soft.com/Pac/TimbradoPanamaTheFactoryPremium',
  activo boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.fe_config (id) VALUES (true) ON CONFLICT DO NOTHING;

DROP TRIGGER IF EXISTS trg_fe_config_updated_at ON public.fe_config;
CREATE TRIGGER trg_fe_config_updated_at BEFORE UPDATE ON public.fe_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) Catálogo de artículos/servicios (CPBS obligatorio por línea)
--    Default imprenta: grupo 82 (Servicios Editoriales / Artes Gráficas), subgrupo 8212.
CREATE TABLE IF NOT EXISTS public.fe_articulos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE,
  nombre text NOT NULL,
  precio numeric(12,2) NOT NULL DEFAULT 0,
  prc_impuesto numeric NOT NULL DEFAULT 7 CHECK (prc_impuesto IN (0,7,10,15)),
  unidad text NOT NULL DEFAULT 'und',
  grupo_inv text NOT NULL DEFAULT '82',
  subgr_inv text NOT NULL DEFAULT '8212',
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_fe_articulos_updated_at ON public.fe_articulos;
CREATE TRIGGER trg_fe_articulos_updated_at BEFORE UPDATE ON public.fe_articulos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4) Documentos electrónicos (encabezado = operti + resultado del timbrado)
CREATE TABLE IF NOT EXISTS public.fe_documentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_doc text NOT NULL DEFAULT '01' CHECK (tipo_doc IN ('01','02','03','04','05','06','07','08','09','10')),
  documento text NOT NULL,                     -- número fiscal enviado al PAC
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  cliente_id uuid NOT NULL REFERENCES public.clientes(id),
  -- snapshot fiscal del cliente al momento de emitir
  nombre_cliente text NOT NULL,
  tipo_contribuyente smallint NOT NULL DEFAULT 2 CHECK (tipo_contribuyente IN (1,2)),
  tipo_cliente text NOT NULL DEFAULT '01' CHECK (tipo_cliente IN ('01','02','03','04')),
  ruc text,
  dv text,
  direccion_cliente text NOT NULL DEFAULT 'Panamá',
  email_cliente text,
  -- totales (deben cuadrar con la suma de líneas)
  totneto numeric(12,2) NOT NULL DEFAULT 0,
  totimpuest numeric(12,2) NOT NULL DEFAULT 0,
  totalfinal numeric(12,2) NOT NULL DEFAULT 0,
  total_pagado numeric(12,2) NOT NULL DEFAULT 0,
  -- retención (opcional)
  codigo_retencion text,
  prc_retencion numeric NOT NULL DEFAULT 0,
  retencion numeric(12,2) NOT NULL DEFAULT 0,
  -- referencia para NC/ND tipos 04 y 05 (obligatoria según manual)
  cufe_devol text,
  fecha_cufe_devol text,
  fe_referencia_id uuid REFERENCES public.fe_documentos(id),
  notas text,
  -- resultado del timbrado
  estado text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','enviando','aceptado','rechazado')),
  cufe text,
  fecha_cufe text,
  url_dgi text,
  respuesta_pac text,
  -- integración con cobros
  factura_id uuid REFERENCES public.facturas(id),
  nota_credito_id uuid REFERENCES public.notas_credito(id),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fe_documentos_cliente ON public.fe_documentos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_fe_documentos_estado ON public.fe_documentos(estado);
CREATE INDEX IF NOT EXISTS idx_fe_documentos_fecha ON public.fe_documentos(fecha);

DROP TRIGGER IF EXISTS trg_fe_documentos_updated_at ON public.fe_documentos;
CREATE TRIGGER trg_fe_documentos_updated_at BEFORE UPDATE ON public.fe_documentos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5) Líneas del documento (opermv)
CREATE TABLE IF NOT EXISTS public.fe_documento_lineas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id uuid NOT NULL REFERENCES public.fe_documentos(id) ON DELETE CASCADE,
  orden integer NOT NULL DEFAULT 1,
  articulo_id uuid REFERENCES public.fe_articulos(id),
  codigo_articulo text NOT NULL,
  nombre_articulo text NOT NULL,
  precioneto numeric(12,4) NOT NULL DEFAULT 0,
  prc_impuesto numeric NOT NULL DEFAULT 7 CHECK (prc_impuesto IN (0,7,10,15)),
  cantidad numeric(12,2) NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  unidad text NOT NULL DEFAULT 'und',
  grupo_inv text NOT NULL,
  subgr_inv text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fe_lineas_documento ON public.fe_documento_lineas(documento_id);

-- 6) Formas de pago del documento (pagos)
CREATE TABLE IF NOT EXISTS public.fe_documento_pagos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id uuid NOT NULL REFERENCES public.fe_documentos(id) ON DELETE CASCADE,
  codigo text NOT NULL DEFAULT '99',
  nombre text NOT NULL DEFAULT 'CREDITO',
  monto numeric(12,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_fe_pagos_documento ON public.fe_documento_pagos(documento_id);

-- 7) Permisos: módulo factura_electronica (hereda los permisos de facturas por rol)
INSERT INTO public.rol_permisos (rol_id, modulo, puede_ver, puede_agregar, puede_editar, puede_borrar)
SELECT rol_id, 'factura_electronica', puede_ver, puede_agregar, puede_editar, puede_borrar
FROM public.rol_permisos rp
WHERE rp.modulo='facturas'
  AND NOT EXISTS (SELECT 1 FROM public.rol_permisos x WHERE x.rol_id=rp.rol_id AND x.modulo='factura_electronica');

-- 8) RLS
ALTER TABLE public.fe_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fe_articulos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fe_documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fe_documento_lineas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fe_documento_pagos ENABLE ROW LEVEL SECURITY;

-- fe_config: solo admin (la clave del PAC no debe ser visible para otros roles)
DROP POLICY IF EXISTS admin_fe_config ON public.fe_config;
CREATE POLICY admin_fe_config ON public.fe_config FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.rol_id = 'admin' AND up.activo))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.rol_id = 'admin' AND up.activo));

-- fe_articulos: mismo módulo
DROP POLICY IF EXISTS ver_fe_articulos ON public.fe_articulos;
DROP POLICY IF EXISTS agregar_fe_articulos ON public.fe_articulos;
DROP POLICY IF EXISTS editar_fe_articulos ON public.fe_articulos;
DROP POLICY IF EXISTS borrar_fe_articulos ON public.fe_articulos;
CREATE POLICY ver_fe_articulos ON public.fe_articulos FOR SELECT
  USING (app_private.has_module_permission('factura_electronica','ver'));
CREATE POLICY agregar_fe_articulos ON public.fe_articulos FOR INSERT
  WITH CHECK (app_private.has_module_permission('factura_electronica','agregar'));
CREATE POLICY editar_fe_articulos ON public.fe_articulos FOR UPDATE
  USING (app_private.has_module_permission('factura_electronica','editar'))
  WITH CHECK (app_private.has_module_permission('factura_electronica','editar'));
CREATE POLICY borrar_fe_articulos ON public.fe_articulos FOR DELETE
  USING (app_private.has_module_permission('factura_electronica','borrar'));

-- fe_documentos
DROP POLICY IF EXISTS ver_fe_documentos ON public.fe_documentos;
DROP POLICY IF EXISTS agregar_fe_documentos ON public.fe_documentos;
DROP POLICY IF EXISTS editar_fe_documentos ON public.fe_documentos;
DROP POLICY IF EXISTS borrar_fe_documentos ON public.fe_documentos;
CREATE POLICY ver_fe_documentos ON public.fe_documentos FOR SELECT
  USING (app_private.has_module_permission('factura_electronica','ver'));
CREATE POLICY agregar_fe_documentos ON public.fe_documentos FOR INSERT
  WITH CHECK (app_private.has_module_permission('factura_electronica','agregar'));
CREATE POLICY editar_fe_documentos ON public.fe_documentos FOR UPDATE
  USING (app_private.has_module_permission('factura_electronica','editar') AND estado IN ('borrador','rechazado'))
  WITH CHECK (app_private.has_module_permission('factura_electronica','editar'));
CREATE POLICY borrar_fe_documentos ON public.fe_documentos FOR DELETE
  USING (app_private.has_module_permission('factura_electronica','borrar') AND estado IN ('borrador','rechazado'));

-- Líneas y pagos: heredan del documento (política simple por módulo)
DROP POLICY IF EXISTS ver_fe_lineas ON public.fe_documento_lineas;
DROP POLICY IF EXISTS escribir_fe_lineas ON public.fe_documento_lineas;
CREATE POLICY ver_fe_lineas ON public.fe_documento_lineas FOR SELECT
  USING (app_private.has_module_permission('factura_electronica','ver'));
CREATE POLICY escribir_fe_lineas ON public.fe_documento_lineas FOR ALL
  USING (app_private.has_module_permission('factura_electronica','editar') OR app_private.has_module_permission('factura_electronica','agregar'))
  WITH CHECK (app_private.has_module_permission('factura_electronica','editar') OR app_private.has_module_permission('factura_electronica','agregar'));

DROP POLICY IF EXISTS ver_fe_pagos ON public.fe_documento_pagos;
DROP POLICY IF EXISTS escribir_fe_pagos ON public.fe_documento_pagos;
CREATE POLICY ver_fe_pagos ON public.fe_documento_pagos FOR SELECT
  USING (app_private.has_module_permission('factura_electronica','ver'));
CREATE POLICY escribir_fe_pagos ON public.fe_documento_pagos FOR ALL
  USING (app_private.has_module_permission('factura_electronica','editar') OR app_private.has_module_permission('factura_electronica','agregar'))
  WITH CHECK (app_private.has_module_permission('factura_electronica','editar') OR app_private.has_module_permission('factura_electronica','agregar'));
