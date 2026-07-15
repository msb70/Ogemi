-- ============================================================================
-- 1) Número de recibo autonumérico para pagos de facturas de clientes
--    (mismo patrón que anticipos.numero_recibo: secuencia + REC-NNNNN en UI)
-- 2) procesar_pago: el concepto del movimiento de banco de un pago de compra
--    incluye el nombre del proveedor.
-- ============================================================================

-- ── 1) Recibo autonumérico en pagos de facturas ─────────────────────────────
create sequence if not exists public.pagos_recibo_seq;

alter table public.pagos add column if not exists numero_recibo int;

create or replace function public.asignar_numero_recibo()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.factura_id is not null and new.numero_recibo is null then
    new.numero_recibo := nextval('public.pagos_recibo_seq');
  end if;
  return new;
end $$;

drop trigger if exists trg_pagos_numero_recibo on public.pagos;
create trigger trg_pagos_numero_recibo
  before insert on public.pagos
  for each row execute function public.asignar_numero_recibo();

-- Backfill histórico en orden cronológico (pagos inmutables: se permite la
-- mutación solo dentro de esta transacción)
select set_config('app.allow_pago_mutation', 'on', true);

with ordenados as (
  select id, row_number() over (order by fecha, created_at, id) as rn
  from public.pagos
  where factura_id is not null and numero_recibo is null
)
update public.pagos p
   set numero_recibo = o.rn
  from ordenados o
 where p.id = o.id;

select setval('public.pagos_recibo_seq',
  coalesce((select max(numero_recibo) from public.pagos), 0) + 1, false);

-- ── 2) procesar_pago con proveedor en el concepto (rama compras) ────────────
create or replace function public.procesar_pago()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_monto_pagado numeric; v_concepto text; v_prov text;
  v_total numeric; v_ret numeric; v_comp boolean;
BEGIN
  IF NEW.factura_id IS NOT NULL THEN
    SELECT numero_factura::text INTO v_concepto FROM public.facturas WHERE id = NEW.factura_id;
    IF NEW.anticipo_id IS NULL AND NEW.nota_credito_id IS NULL AND NEW.credito_factura_id IS NULL AND NEW.lote_id IS NULL THEN
      INSERT INTO public.banco_movimientos (cuenta_id, factura_id, pago_id, tipo, concepto, monto, fecha, referencia)
      VALUES (NEW.cuenta_id, NEW.factura_id, NEW.id, 'ingreso',
        'Cobro factura #' || COALESCE(v_concepto,'') || COALESCE(' - ' || NEW.referencia,''), NEW.monto, NEW.fecha, NEW.referencia);
    END IF;
    SELECT total, round(COALESCE(retencion_pct,0)/100.0 * COALESCE(itbms,0), 2), retencion_comprobante_entregado
      INTO v_total, v_ret, v_comp FROM public.facturas WHERE id = NEW.factura_id;
    v_monto_pagado := public.monto_pagado_factura(NEW.factura_id);
    UPDATE public.facturas SET monto_pagado = v_monto_pagado,
      estado = public.calc_estado_factura(v_total, v_monto_pagado, v_ret, v_comp),
      fecha_cobro = CASE WHEN v_monto_pagado >= (v_total - v_ret) THEN NEW.fecha ELSE NULL END,
      banco_cuenta_id = CASE WHEN v_monto_pagado >= (v_total - v_ret) THEN NEW.cuenta_id ELSE NULL END
    WHERE id = NEW.factura_id;

  ELSIF NEW.compra_id IS NOT NULL THEN
    SELECT c.concepto, pr.nombre INTO v_concepto, v_prov
      FROM public.compras c
      LEFT JOIN public.proveedores pr ON pr.id = c.proveedor_id
     WHERE c.id = NEW.compra_id;
    IF NEW.anticipo_id IS NULL AND NEW.lote_id IS NULL THEN
      INSERT INTO public.banco_movimientos (cuenta_id, compra_id, pago_id, tipo, concepto, monto, fecha, referencia)
      VALUES (NEW.cuenta_id, NEW.compra_id, NEW.id, 'egreso',
        'Pago compra ' || COALESCE(v_prov,'') || ': ' || COALESCE(v_concepto,'sin concepto') || COALESCE(' - ' || NEW.referencia,''), NEW.monto, NEW.fecha, NEW.referencia);
    END IF;
    v_monto_pagado := public.monto_pagado_compra(NEW.compra_id);
    UPDATE public.compras SET monto_pagado = v_monto_pagado,
      estado = CASE WHEN v_monto_pagado >= total THEN 'pagada' ELSE 'pendiente' END,
      fecha_pago = CASE WHEN v_monto_pagado >= total THEN NEW.fecha ELSE NULL END,
      banco_cuenta_id = CASE WHEN v_monto_pagado >= total THEN NEW.cuenta_id ELSE NULL END
    WHERE id = NEW.compra_id;

  ELSIF NEW.presupuesto_id IS NOT NULL THEN
    SELECT numero_presupuesto::text INTO v_concepto FROM public.presupuestos WHERE id = NEW.presupuesto_id;
    IF NEW.anticipo_id IS NULL AND NEW.lote_id IS NULL THEN
      INSERT INTO public.banco_movimientos (cuenta_id, presupuesto_id, pago_id, tipo, concepto, monto, fecha, referencia)
      VALUES (NEW.cuenta_id, NEW.presupuesto_id, NEW.id, 'ingreso',
        'Cobro presupuesto #' || COALESCE(v_concepto,'') || COALESCE(' - ' || NEW.referencia,''), NEW.monto, NEW.fecha, NEW.referencia);
    END IF;
    v_monto_pagado := public.monto_pagado_presupuesto(NEW.presupuesto_id);
    UPDATE public.presupuestos SET monto_pagado = v_monto_pagado,
      estado = CASE WHEN v_monto_pagado >= total THEN 'pagada' ELSE 'pendiente' END,
      fecha_cobro = CASE WHEN v_monto_pagado >= total THEN NEW.fecha ELSE NULL END,
      banco_cuenta_id = CASE WHEN v_monto_pagado >= total THEN NEW.cuenta_id ELSE NULL END
    WHERE id = NEW.presupuesto_id;
  END IF;
  RETURN NEW;
END;
$function$;
