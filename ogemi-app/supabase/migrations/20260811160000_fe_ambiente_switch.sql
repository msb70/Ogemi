-- Switch de ambiente pruebas/produccion para el modulo de Factura Electronica.
-- Las columnas pin/usuario/clave/endpoint_url existentes pasan a ser el juego de PRUEBAS;
-- se agregan columnas *_prod para el juego de PRODUCCION y un campo ambiente que decide
-- cual usa /api/fe/timbrar.

ALTER TABLE public.fe_config
  ADD COLUMN IF NOT EXISTS ambiente text NOT NULL DEFAULT 'pruebas',
  ADD COLUMN IF NOT EXISTS pin_prod text,
  ADD COLUMN IF NOT EXISTS usuario_prod text,
  ADD COLUMN IF NOT EXISTS clave_prod text,
  ADD COLUMN IF NOT EXISTS endpoint_url_prod text NOT NULL DEFAULT 'https://cfe.premium-soft.com/Pac/TimbradoPanamaTheFactoryPremium';

ALTER TABLE public.fe_config DROP CONSTRAINT IF EXISTS fe_config_ambiente_check;
ALTER TABLE public.fe_config ADD CONSTRAINT fe_config_ambiente_check CHECK (ambiente IN ('pruebas', 'produccion'));

-- RPC para que cualquier usuario autenticado pueda ver el ambiente activo (fe_config tiene RLS solo-admin).
-- Solo expone el nombre del ambiente, nunca credenciales.
CREATE OR REPLACE FUNCTION public.fe_ambiente_activo()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ambiente FROM public.fe_config WHERE id = true;
$$;

REVOKE ALL ON FUNCTION public.fe_ambiente_activo() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fe_ambiente_activo() TO authenticated;
