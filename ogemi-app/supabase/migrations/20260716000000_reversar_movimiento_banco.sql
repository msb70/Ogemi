-- Reverso de movimientos manuales de banco (contra-movimiento con rastro de auditoría)
-- Solo aplica a movimientos MANUALES: los que provienen de cobros/pagos/lotes/anticipos
-- se reversan desde su propio módulo, porque también tocan el estado del documento.
alter table public.banco_movimientos
  add column if not exists reverso_de_id uuid references public.banco_movimientos(id);

create index if not exists idx_banco_mov_reverso_de
  on public.banco_movimientos(reverso_de_id);

comment on column public.banco_movimientos.reverso_de_id is
  'Si no es null, esta fila es el contra-movimiento que reversa al movimiento indicado.';

create or replace function public.reversar_movimiento_banco(
  p_movimiento_id uuid,
  p_motivo text,
  p_fecha date default null
) returns public.banco_movimientos
language plpgsql
security definer
set search_path to 'public', 'app_private', 'pg_temp'
as $$
declare
  v_mov public.banco_movimientos%rowtype;
  v_new public.banco_movimientos%rowtype;
  v_lim date;
  v_tipo_inv text;
begin
  if not app_private.has_module_permission('banco', 'editar') then
    raise exception 'No tiene permiso para reversar movimientos de banco.'
      using errcode = '42501';
  end if;

  if p_motivo is null or length(trim(p_motivo)) < 3 then
    raise exception 'Debe indicar un motivo de reverso (mínimo 3 caracteres).';
  end if;

  select * into v_mov from public.banco_movimientos where id = p_movimiento_id;
  if not found then
    raise exception 'El movimiento no existe.';
  end if;

  -- Solo movimientos MANUALES (sin vínculo a documentos/pagos) se reversan aquí.
  if v_mov.factura_id is not null or v_mov.compra_id is not null
     or v_mov.presupuesto_id is not null or v_mov.pago_id is not null
     or v_mov.pago_reverso_id is not null or v_mov.anticipo_id is not null
     or v_mov.lote_id is not null then
    raise exception 'Este movimiento proviene de un cobro, pago o documento. Reverse la operación desde su módulo (cobros, compras, presupuestos o anticipos), no desde Banco.'
      using errcode = 'P0001';
  end if;

  -- No se reversa un reverso.
  if v_mov.reverso_de_id is not null then
    raise exception 'No se puede reversar un movimiento que ya es un reverso.';
  end if;

  -- No se reversa dos veces.
  if exists (select 1 from public.banco_movimientos where reverso_de_id = v_mov.id) then
    raise exception 'Este movimiento ya fue reversado.';
  end if;

  -- Periodo cerrado: mismo criterio que el reverso de cobros.
  v_lim := public.fecha_cierre_bloqueo(v_mov.cuenta_id);
  if v_lim is not null and v_mov.fecha <= v_lim then
    raise exception 'No se puede reversar: el movimiento del % pertenece a un periodo cerrado (cierre hasta %).',
      v_mov.fecha, v_lim using errcode = 'P0001';
  end if;

  v_tipo_inv := case when v_mov.tipo = 'ingreso' then 'egreso' else 'ingreso' end;

  -- El contra se fecha igual que el original por defecto para que neteen en el mismo periodo.
  insert into public.banco_movimientos
    (cuenta_id, tipo, concepto, monto, fecha, referencia, reverso_de_id)
  values (
    v_mov.cuenta_id,
    v_tipo_inv,
    'Reverso: ' || v_mov.concepto || ' — ' || trim(p_motivo),
    v_mov.monto,
    coalesce(p_fecha, v_mov.fecha),
    v_mov.referencia,
    v_mov.id
  ) returning * into v_new;

  return v_new;
end;
$$;

grant execute on function public.reversar_movimiento_banco(uuid, text, date) to authenticated;
