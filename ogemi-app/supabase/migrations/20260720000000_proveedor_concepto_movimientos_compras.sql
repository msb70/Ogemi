-- ============================================================================
-- Proveedor en el concepto de TODOS los movimientos de banco ligados a compras
--
-- Estado previo:
--   * procesar_pago (pago individual de compra)  → ya incluye proveedor (20260715)
--   * registrar_pago_lote_compras (pago múltiple) → ya incluye proveedor
--   * _reversar_pago_core (reverso de pago de compra) → NO incluía → se corrige
--
-- Además: backfill de los movimientos EXISTENTES ligados a compras cuyo
-- concepto no menciona al proveedor (comparación normalizada sin puntuación,
-- para no duplicar nombres ya presentes con otra grafía).
-- ============================================================================

-- ── 1) _reversar_pago_core: proveedor en el concepto del reverso de compra ──
CREATE OR REPLACE FUNCTION public._reversar_pago_core(p_pago_id uuid, p_motivo text, p_fecha date)
 RETURNS pago_reversos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app_private', 'pg_temp'
AS $function$
DECLARE v_pago public.pagos%ROWTYPE; v_rev public.pago_reversos%ROWTYPE; v_mov uuid; v_pagado numeric; v_lim date; v_prov text;
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
    IF v_pago.anticipo_id IS NULL AND v_pago.nota_credito_id IS NULL AND v_pago.credito_factura_id IS NULL THEN
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
    SELECT pr.nombre INTO v_prov
      FROM public.compras c
      LEFT JOIN public.proveedores pr ON pr.id = c.proveedor_id
     WHERE c.id = v_pago.compra_id;
    INSERT INTO public.pago_reversos (pago_id, compra_id, cuenta_id, monto, fecha, motivo, created_by)
    VALUES (v_pago.id, v_pago.compra_id, v_pago.cuenta_id, v_pago.monto, COALESCE(p_fecha,CURRENT_DATE), trim(p_motivo), auth.uid())
    RETURNING * INTO v_rev;
    IF v_pago.anticipo_id IS NULL THEN
      INSERT INTO public.banco_movimientos (cuenta_id, compra_id, pago_reverso_id, tipo, concepto, monto, fecha, referencia)
      VALUES (v_pago.cuenta_id, v_pago.compra_id, v_rev.id, 'ingreso',
        'Reverso pago compra' || COALESCE(' '||v_prov,'') || ' - ' || trim(p_motivo),
        v_pago.monto, COALESCE(p_fecha,CURRENT_DATE), v_pago.referencia)
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

  -- Restaurar el crédito consumido para que vuelva a estar disponible
  IF v_pago.nota_credito_id IS NOT NULL THEN
    UPDATE public.notas_credito SET estado='disponible', factura_aplicada_id=NULL, pago_id=NULL WHERE id=v_pago.nota_credito_id;
  END IF;
  IF v_pago.credito_factura_id IS NOT NULL THEN
    UPDATE public.facturas SET factura_aplicada_id=NULL WHERE id=v_pago.credito_factura_id;
  END IF;

  IF v_mov IS NOT NULL THEN
    UPDATE public.pago_reversos SET banco_movimiento_id = v_mov WHERE id = v_rev.id RETURNING * INTO v_rev;
  END IF;
  RETURN v_rev;
END;
$function$;

-- ── 2) Backfill de movimientos existentes (solo cambia el texto del concepto;
--       montos y fechas intactos, por eso se salta temporalmente la guarda de
--       periodo cerrado dentro de esta misma transacción) ────────────────────
ALTER TABLE public.banco_movimientos DISABLE TRIGGER trg_prevent_movimiento_periodo_cerrado;

-- Egresos "Pago compra: ..." → "Pago compra <proveedor>: ..."
UPDATE public.banco_movimientos bm
   SET concepto = 'Pago compra ' || pr.nombre || ': ' || substr(bm.concepto, length('Pago compra: ') + 1)
  FROM public.compras c
  JOIN public.proveedores pr ON pr.id = c.proveedor_id
 WHERE c.id = bm.compra_id
   AND bm.concepto LIKE 'Pago compra: %'
   AND position(regexp_replace(lower(pr.nombre), '[^a-z0-9]', '', 'g')
                IN regexp_replace(lower(bm.concepto), '[^a-z0-9]', '', 'g')) = 0;

-- Reversos "Reverso pago compra - ..." → "Reverso pago compra <proveedor> - ..."
UPDATE public.banco_movimientos bm
   SET concepto = 'Reverso pago compra ' || pr.nombre || ' - ' || substr(bm.concepto, length('Reverso pago compra - ') + 1)
  FROM public.compras c
  JOIN public.proveedores pr ON pr.id = c.proveedor_id
 WHERE c.id = bm.compra_id
   AND bm.concepto LIKE 'Reverso pago compra - %'
   AND position(regexp_replace(lower(pr.nombre), '[^a-z0-9]', '', 'g')
                IN regexp_replace(lower(bm.concepto), '[^a-z0-9]', '', 'g')) = 0;

ALTER TABLE public.banco_movimientos ENABLE TRIGGER trg_prevent_movimiento_periodo_cerrado;
