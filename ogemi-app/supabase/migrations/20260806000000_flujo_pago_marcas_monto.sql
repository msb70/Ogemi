-- Monto parcial proyectado para compras marcadas "Pagará" en el Flujo de Pago.
-- NULL = se proyecta el saldo completo de la compra.
-- Aplicada en prod (tnuz) el 2026-08-06 via MCP apply_migration.
alter table public.flujo_pago_marcas
  add column if not exists monto numeric;

comment on column public.flujo_pago_marcas.monto is
  'Monto proyectado a pagar (solo tipo=compra). NULL = saldo completo.';
