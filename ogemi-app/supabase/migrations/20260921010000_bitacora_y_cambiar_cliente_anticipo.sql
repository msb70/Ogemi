-- Bitácora (pantalla /bitacora) + cambio de cliente en anticipos ya grabados.
-- Aplicada en prod (tnuz) el 2026-09-21 vía MCP como `bitacora_y_cambiar_cliente_anticipo`.
-- Las definiciones completas de funciones viven en la BD; aquí queda el registro de lo que cambió:
--
-- 1. pagos_auditoria: pago_id pasa a NULLable; accion admite 'anticipo_cliente';
--    policy de SELECT = _es_admin() OR has_module_permission('usuarios','ver').
-- 2. prevent_movimiento_periodo_cerrado(): en UPDATE, si lo ÚNICO que cambia es `concepto`
--    (to_jsonb(new) - 'concepto' - 'updated_at' = to_jsonb(old) - ...), se permite aunque el
--    periodo esté cerrado (no altera saldos). Todo lo demás sigue bloqueado.
-- 3. cambiar_cliente_anticipo(p_anticipo_id, p_cliente_id, p_motivo): permiso 'editar' del módulo
--    (facturas | ventas_ogemi según empresa); rechaza anulados y anticipos con aplicaciones no
--    reversadas; actualiza anticipos.cliente_id y el concepto del ingreso en banco; audita.
-- 4. bitacora_pagos(p_desde, p_hasta): eventos enriquecidos (documento, tercero, usuario, cuentas).

alter table public.pagos_auditoria alter column pago_id drop not null;
alter table public.pagos_auditoria drop constraint if exists pagos_auditoria_accion_check;
alter table public.pagos_auditoria add constraint pagos_auditoria_accion_check
  check (accion in ('editar','borrar','anticipo_cliente'));
drop policy if exists pagos_auditoria_select_admin on public.pagos_auditoria;
create policy pagos_auditoria_select_admin on public.pagos_auditoria
  for select to authenticated
  using (public._es_admin() or app_private.has_module_permission('usuarios','ver'));
