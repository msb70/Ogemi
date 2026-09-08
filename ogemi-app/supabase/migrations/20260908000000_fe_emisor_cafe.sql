-- Datos del emisor para el Comprobante Auxiliar de Factura Electrónica (CAFE)
-- Aplicada en prod (tnuz) el 2026-09-08 vía MCP como `fe_emisor_cafe`.
alter table public.fe_config
  add column if not exists emisor_nombre    text not null default 'IMPRESOS COMERCIALES',
  add column if not exists emisor_ruc       text not null default '1635517-1-672731',
  add column if not exists emisor_dv        text not null default '00',
  add column if not exists emisor_direccion text not null default 'CALLE 8VA DE RIO ABAJO, GALERA 22, Rio Abajo - Panamá';

-- Expone SOLO los datos del emisor (no credenciales) a cualquier usuario autenticado,
-- igual que fe_ambiente_activo(); fe_config sigue con RLS solo-admin.
create or replace function public.fe_emisor()
returns table (nombre text, ruc text, dv text, direccion text, codigo_sucursal text, nro_terminal text)
language sql
security definer
set search_path = public
stable
as $$
  select emisor_nombre, emisor_ruc, emisor_dv, emisor_direccion, codigo_sucursal, nro_terminal
  from public.fe_config where id = true
$$;

revoke execute on function public.fe_emisor() from public, anon;
grant execute on function public.fe_emisor() to authenticated;
