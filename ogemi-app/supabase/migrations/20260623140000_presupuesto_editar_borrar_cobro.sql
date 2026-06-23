-- ============================================================
-- Editar/borrar presupuesto y editar/reversar cobro de presupuesto
-- Respeta inmutabilidad de pagos (edición = reversa + nuevo cobro)
-- y el bloqueo de periodo cerrado (fecha_cierre_bloqueo).
-- ============================================================

-- 0. Trazabilidad de reversos de presupuesto
ALTER TABLE public.pago_reversos
  ADD COLUMN IF NOT EXISTS presupuesto_id uuid REFERENCES public.presupuestos(id) ON DELETE RESTRICT;

-- CHECK de origen: permitir reversos de presupuesto (uno solo de factura/compra/presupuesto)
ALTER TABLE public.pago_reversos DROP CONSTRAINT IF EXISTS pago_reverso_origen;
ALTER TABLE public.pago_reversos ADD CONSTRAINT pago_reverso_origen CHECK (
  (factura_id IS NOT NULL)::int + (compra_id IS NOT NULL)::int + (presupuesto_id IS NOT NULL)::int = 1
);

-- 1. Inmutabilidad de pagos con escape para RPCs de confianza (GUC local)
CREATE OR REPLACE FUNCTION public.prevent_pagos_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF COALESCE(current_setting('app.allow_pago_mutation', true), '') = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Los pagos son inmutables. Use reversar_pago()/editar_cobro_presupuesto()/eliminar_presupuesto().';
END;
$$;

-- 2. Núcleo de reversa (sin chequeo de permiso); valida periodo cerrado del cobro original
CREATE OR REPLACE FUNCTION public._reversar_pago_core(p_pago_id uuid, p_motivo text, p_fecha date)
RETURNS public.pago_reversos
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','app_private','pg_temp' AS $$
DECLARE v_pago public.pagos%ROWTYPE; v_rev public.pago_reversos%ROWTYPE; v_mov uuid; v_pagado numeric; v_lim date;
BEGIN
  IF p_motivo IS NULL OR length(trim(p_motivo)) < 3 THEN
    RAISE EXCEPTION 'Debe indicar un motivo de reverso.';
  END IF;
  SELECT * INTO v_pago FROM public.pagos WHERE id = p_pago_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'El pago no existe.'; END IF;
  IF EXISTS (SELECT 1 FROM public.pago_reversos WHERE pago_id = p_pago_id) THEN
    RAISE EXCEPTION 'El pago ya fue reversado.';
  END IF;

  v_lim := public.fecha_cierre_bloqueo(v_pago.cuenta_id);
  IF v_lim IS NOT NULL AND v_pago.fecha <= v_lim THEN
    RAISE EXCEPTION 'No se puede reversar/editar: el cobro del % pertenece a un periodo cerrado (cierre hasta %).',
      v_pago.fecha, v_lim USING errcode = 'P0001';
  END IF;

  IF v_pago.factura_id IS NOT NULL THEN
    INSERT INTO public.pago_reversos (pago_id, factura_id, cuenta_id, monto, fecha, motivo, created_by)
    VALUES (v_pago.id, v_pago.factura_id, v_pago.cuenta_id, v_pago.monto, COALESCE(p_fecha,CURRENT_DATE), trim(p_motivo), auth.uid())
    RETURNING * INTO v_rev;
    IF v_pago.anticipo_id IS NULL THEN
      INSERT INTO public.banco_movimientos (cuenta_id, factura_id, pago_reverso_id, tipo, concepto, monto, fecha, referencia)
      VALUES (v_pago.cuenta_id, v_pago.factura_id, v_rev.id, 'egreso', 'Reverso cobro factura - '||trim(p_motivo), v_pago.monto, COALESCE(p_fecha,CURRENT_DATE), v_pago.referencia)
      RETURNING id INTO v_mov;
    END IF;
    v_pagado := public.monto_pagado_factura(v_pago.factura_id);
    UPDATE public.facturas SET monto_pagado = v_pagado,
      estado = CASE WHEN v_pagado >= total THEN 'pagada' ELSE 'pendiente' END,
      fecha_cobro = CASE WHEN v_pagado >= total THEN fecha_cobro ELSE NULL END,
      banco_cuenta_id = CASE WHEN v_pagado >= total THEN banco_cuenta_id ELSE NULL END
    WHERE id = v_pago.factura_id;

  ELSIF v_pago.compra_id IS NOT NULL THEN
    INSERT INTO public.pago_reversos (pago_id, compra_id, cuenta_id, monto, fecha, motivo, created_by)
    VALUES (v_pago.id, v_pago.compra_id, v_pago.cuenta_id, v_pago.monto, COALESCE(p_fecha,CURRENT_DATE), trim(p_motivo), auth.uid())
    RETURNING * INTO v_rev;
    IF v_pago.anticipo_id IS NULL THEN
      INSERT INTO public.banco_movimientos (cuenta_id, compra_id, pago_reverso_id, tipo, concepto, monto, fecha, referencia)
      VALUES (v_pago.cuenta_id, v_pago.compra_id, v_rev.id, 'ingreso', 'Reverso pago compra - '||trim(p_motivo), v_pago.monto, COALESCE(p_fecha,CURRENT_DATE), v_pago.referencia)
      RETURNING id INTO v_mov;
    END IF;
    v_pagado := public.monto_pagado_compra(v_pago.compra_id);
    UPDATE public.compras SET monto_pagado = v_pagado,
      estado = CASE WHEN v_pagado >= total THEN 'pagada' ELSE 'pendiente' END,
      fecha_pago = CASE WHEN v_pagado >= total THEN fecha_pago ELSE NULL END,
      banco_cuenta_id = CASE WHEN v_pagado >= total THEN banco_cuenta_id ELSE NULL END
    WHERE id = v_pago.compra_id;

  ELSIF v_pago.presupuesto_id IS NOT NULL THEN
    INSERT INTO public.pago_reversos (pago_id, presupuesto_id, cuenta_id, monto, fecha, motivo, created_by)
    VALUES (v_pago.id, v_pago.presupuesto_id, v_pago.cuenta_id, v_pago.monto, COALESCE(p_fecha,CURRENT_DATE), trim(p_motivo), auth.uid())
    RETURNING * INTO v_rev;
    IF v_pago.anticipo_id IS NULL THEN
      INSERT INTO public.banco_movimientos (cuenta_id, presupuesto_id, pago_reverso_id, tipo, concepto, monto, fecha, referencia)
      VALUES (v_pago.cuenta_id, v_pago.presupuesto_id, v_rev.id, 'egreso', 'Reverso cobro presupuesto - '||trim(p_motivo), v_pago.monto, COALESCE(p_fecha,CURRENT_DATE), v_pago.referencia)
      RETURNING id INTO v_mov;
    END IF;
    v_pagado := public.monto_pagado_presupuesto(v_pago.presupuesto_id);
    UPDATE public.presupuestos SET monto_pagado = v_pagado,
      estado = CASE WHEN v_pagado >= total THEN 'pagada' ELSE 'pendiente' END,
      fecha_cobro = CASE WHEN v_pagado >= total THEN fecha_cobro ELSE NULL END,
      banco_cuenta_id = CASE WHEN v_pagado >= total THEN banco_cuenta_id ELSE NULL END
    WHERE id = v_pago.presupuesto_id;
  END IF;

  IF v_mov IS NOT NULL THEN
    UPDATE public.pago_reversos SET banco_movimiento_id = v_mov WHERE id = v_rev.id RETURNING * INTO v_rev;
  END IF;
  RETURN v_rev;
END;
$$;

-- 3. reversar_pago: chequeo de permiso por origen (incl. presupuestos) y delega al núcleo
CREATE OR REPLACE FUNCTION public.reversar_pago(p_pago_id uuid, p_motivo text, p_fecha date DEFAULT CURRENT_DATE)
RETURNS public.pago_reversos
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','app_private','pg_temp' AS $$
DECLARE v_pago public.pagos%ROWTYPE; v_mod text;
BEGIN
  SELECT * INTO v_pago FROM public.pagos WHERE id = p_pago_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'El pago no existe.'; END IF;
  v_mod := CASE WHEN v_pago.factura_id IS NOT NULL THEN 'facturas'
                WHEN v_pago.compra_id  IS NOT NULL THEN 'compras'
                ELSE 'presupuestos' END;
  IF NOT app_private.has_module_permission(v_mod, 'borrar') THEN
    RAISE EXCEPTION 'No tienes permiso para reversar este cobro/pago.';
  END IF;
  RETURN public._reversar_pago_core(p_pago_id, p_motivo, p_fecha);
END;
$$;

-- 4. Editar cobro de presupuesto = reversa del viejo + nuevo cobro (auditable)
CREATE OR REPLACE FUNCTION public.editar_cobro_presupuesto(
  p_pago_id uuid, p_monto numeric, p_fecha date, p_cuenta_id uuid,
  p_referencia text DEFAULT NULL, p_motivo text DEFAULT 'Edición de cobro'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','app_private','pg_temp' AS $$
DECLARE v_pago public.pagos%ROWTYPE; v_lim date; v_new_id uuid;
BEGIN
  IF NOT app_private.has_module_permission('presupuestos', 'editar') THEN
    RAISE EXCEPTION 'No tienes permiso para editar cobros de presupuestos.';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN RAISE EXCEPTION 'El monto debe ser mayor a 0.'; END IF;
  IF p_cuenta_id IS NULL THEN RAISE EXCEPTION 'Debe indicar la cuenta de banco.'; END IF;

  SELECT * INTO v_pago FROM public.pagos WHERE id = p_pago_id;
  IF NOT FOUND OR v_pago.presupuesto_id IS NULL THEN RAISE EXCEPTION 'Cobro de presupuesto no encontrado.'; END IF;
  IF v_pago.anticipo_id IS NOT NULL THEN RAISE EXCEPTION 'No se puede editar aquí un cobro aplicado desde anticipo.'; END IF;

  v_lim := public.fecha_cierre_bloqueo(p_cuenta_id);
  IF v_lim IS NOT NULL AND p_fecha <= v_lim THEN
    RAISE EXCEPTION 'La nueva fecha % cae en un periodo cerrado (cierre hasta %).', p_fecha, v_lim USING errcode = 'P0001';
  END IF;

  -- reversa el cobro original (valida que NO esté en periodo cerrado)
  PERFORM public._reversar_pago_core(p_pago_id, p_motivo, p_fecha);

  -- nuevo cobro corregido (trigger procesar_pago crea el ingreso y recalcula el presupuesto)
  INSERT INTO public.pagos (presupuesto_id, cuenta_id, monto, fecha, referencia)
  VALUES (v_pago.presupuesto_id, p_cuenta_id, p_monto, p_fecha, p_referencia)
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

-- 5. Eliminar presupuesto en cascada (solo si ningún movimiento cae en periodo cerrado)
CREATE OR REPLACE FUNCTION public.eliminar_presupuesto(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','app_private','pg_temp' AS $$
DECLARE v_bloqueados int;
BEGIN
  IF NOT app_private.has_module_permission('presupuestos', 'borrar') THEN
    RAISE EXCEPTION 'No tienes permiso para borrar presupuestos.';
  END IF;

  SELECT count(*) INTO v_bloqueados
  FROM public.banco_movimientos b
  WHERE b.presupuesto_id = p_id
    AND public.fecha_cierre_bloqueo(b.cuenta_id) IS NOT NULL
    AND b.fecha <= public.fecha_cierre_bloqueo(b.cuenta_id);
  IF v_bloqueados > 0 THEN
    RAISE EXCEPTION 'No se puede borrar: el presupuesto tiene movimientos en un periodo cerrado.' USING errcode = 'P0001';
  END IF;

  PERFORM set_config('app.allow_pago_mutation', 'on', true);

  -- romper referencia reversos -> movimientos antes de borrar movimientos
  UPDATE public.pago_reversos SET banco_movimiento_id = NULL
  WHERE presupuesto_id = p_id
     OR pago_id IN (SELECT id FROM public.pagos WHERE presupuesto_id = p_id);

  DELETE FROM public.banco_movimientos WHERE presupuesto_id = p_id;
  DELETE FROM public.pago_reversos
  WHERE presupuesto_id = p_id
     OR pago_id IN (SELECT id FROM public.pagos WHERE presupuesto_id = p_id);
  DELETE FROM public.pagos WHERE presupuesto_id = p_id;
  DELETE FROM public.presupuestos WHERE id = p_id;
END;
$$;

-- 6. Recalcular estado del presupuesto cuando se edita el monto/total
CREATE OR REPLACE FUNCTION public.presupuesto_recalc_estado()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.total IS DISTINCT FROM OLD.total THEN
    NEW.estado := CASE WHEN NEW.total > 0 AND COALESCE(NEW.monto_pagado,0) >= NEW.total THEN 'pagada' ELSE 'pendiente' END;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_presupuesto_recalc_estado ON public.presupuestos;
CREATE TRIGGER trg_presupuesto_recalc_estado
  BEFORE UPDATE OF monto, itbms, total ON public.presupuestos
  FOR EACH ROW EXECUTE FUNCTION public.presupuesto_recalc_estado();

-- 7. Permisos de ejecución (evitar exposición a anon)
REVOKE ALL ON FUNCTION public._reversar_pago_core(uuid, text, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.editar_cobro_presupuesto(uuid, numeric, date, uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.eliminar_presupuesto(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.editar_cobro_presupuesto(uuid, numeric, date, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.eliminar_presupuesto(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reversar_pago(uuid, text, date) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.reversar_pago(uuid, text, date) FROM PUBLIC, anon;

NOTIFY pgrst, 'reload schema';
