-- 1) Faltaba la política de UPDATE en flujo_pago_marcas: al fijar un monto parcial
--    sobre una compra ya marcada "Pagará", el upsert hacía UPDATE y RLS lo bloqueaba,
--    por lo que el monto volvía solo al saldo completo.
drop policy if exists flujo_pago_marcas_update_edit on public.flujo_pago_marcas;
create policy flujo_pago_marcas_update_edit on public.flujo_pago_marcas
  for update
  using (app_private.has_module_permission('gastos_fijos', 'editar'))
  with check (app_private.has_module_permission('gastos_fijos', 'editar'));

-- 2) Semana elegida a mano para pagar una compra (adelantar o atrasar el pago
--    respecto de su vencimiento). NULL = la semana que toque por vencimiento.
alter table public.flujo_pago_marcas
  add column if not exists semana_idx smallint;

alter table public.flujo_pago_marcas
  drop constraint if exists flujo_pago_marcas_semana_idx_check;
alter table public.flujo_pago_marcas
  add constraint flujo_pago_marcas_semana_idx_check
  check (semana_idx is null or (semana_idx >= 0 and semana_idx <= 3));

comment on column public.flujo_pago_marcas.semana_idx is 'Semana del período (0-3) en la que se proyecta el pago. NULL = la que corresponda por vencimiento.';
