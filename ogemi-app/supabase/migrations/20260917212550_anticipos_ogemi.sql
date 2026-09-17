-- ============================================================================
-- Módulo de anticipos para Ogemi
-- Anticipos separados por empresa + cobro de ventas Ogemi con anticipos.
-- Corrige además dos defectos preexistentes (ingreso duplicado en banco al
-- aplicar anticipo a venta Ogemi; saldo de anticipo no devuelto al reversar).
-- ============================================================================

-- 1. Separación por empresa en anticipos
ALTER TABLE public.anticipos
  ADD COLUMN IF NOT EXISTS empresa text NOT NULL DEFAULT 'impresos';

DO $mig$ BEGIN
  ALTER TABLE public.anticipos
    ADD CONSTRAINT anticipos_empresa_check CHECK (empresa = ANY (ARRAY['ogemi'::text, 'impresos'::text]));
EXCEPTION WHEN duplicate_object THEN NULL; END $mig$;

CREATE INDEX IF NOT EXISTS idx_anticipos_empresa ON public.anticipos USING btree (empresa);

COMMENT ON COLUMN public.anticipos.empresa IS
  'Empresa a la que pertenece el anticipo. Los anticipos solo pueden aplicarse a documentos de su misma empresa.';

-- 2. Vista de saldos: expone empresa y descuenta reversos
CREATE OR REPLACE VIEW public.anticipos_saldos AS
 SELECT a.id,
    a.cliente_id,
    a.cuenta_id,
    a.fecha,
    a.monto,
    a.numero_deposito,
    a.notas,
    a.estado,
    a.created_at,
    a.updated_at,
    COALESCE(ap.aplicado, (0)::numeric) AS aplicado,
        CASE
            WHEN (a.estado = 'anulado'::text) THEN (0)::numeric
            ELSE (a.monto - COALESCE(ap.aplicado, (0)::numeric))
        END AS saldo,
    a.empresa,
    a.numero_recibo
   FROM (anticipos a
     LEFT JOIN ( SELECT p.anticipo_id,
            sum(p.monto) - COALESCE(sum(r.monto), (0)::numeric) AS aplicado
           FROM pagos p
           LEFT JOIN pago_reversos r ON r.pago_id = p.id
          WHERE (p.anticipo_id IS NOT NULL)
          GROUP BY p.anticipo_id) ap ON ((ap.anticipo_id = a.id)));

CREATE OR REPLACE FUNCTION public.monto_aplicado_anticipo(p_anticipo_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(sum(p.monto), 0) - COALESCE(sum(r.monto), 0)
  FROM public.pagos p
  LEFT JOIN public.pago_reversos r ON r.pago_id = p.id
  WHERE p.anticipo_id = p_anticipo_id;
$function$;

-- 3. Cartera de ventas Ogemi (espejo de cartera_vencida)
CREATE OR REPLACE VIEW public.cartera_ventas_ogemi AS
 SELECT v.id,
    v.numero,
    v.fecha,
    v.fecha_pago,
    c.nombre AS cliente,
    v.monto,
    v.itbms,
    v.total,
    COALESCE(v.monto_pagado, (0)::numeric) AS monto_pagado,
    (v.total - COALESCE(v.monto_pagado, (0)::numeric)) AS saldo_pendiente,
    (CURRENT_DATE - v.fecha_pago) AS dias_vencida,
        CASE
            WHEN (CURRENT_DATE <= v.fecha_pago) THEN 'corriente'::text
            WHEN (((CURRENT_DATE - v.fecha_pago) >= 1) AND ((CURRENT_DATE - v.fecha_pago) <= 30)) THEN '1-30'::text
            WHEN (((CURRENT_DATE - v.fecha_pago) >= 31) AND ((CURRENT_DATE - v.fecha_pago) <= 60)) THEN '31-60'::text
            WHEN (((CURRENT_DATE - v.fecha_pago) >= 61) AND ((CURRENT_DATE - v.fecha_pago) <= 90)) THEN '61-90'::text
            WHEN (((CURRENT_DATE - v.fecha_pago) >= 91) AND ((CURRENT_DATE - v.fecha_pago) <= 120)) THEN '91-120'::text
            ELSE '+120'::text
        END AS tramo
   FROM (ventas_ogemi v
     JOIN clientes c ON ((c.id = v.cliente_id)))
  WHERE ((v.estado = 'pendiente'::text) AND (v.total > (0)::numeric)
     AND ((v.total - COALESCE(v.monto_pagado, (0)::numeric)) > (0)::numeric));

-- 4. El concepto del movimiento de banco distingue la empresa
CREATE OR REPLACE FUNCTION public.procesar_anticipo()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_nombre text; v_pre text;
BEGIN
  v_pre := CASE WHEN NEW.empresa = 'ogemi' THEN 'Anticipo Ogemi ' ELSE 'Anticipo ' END;
  IF TG_OP = 'INSERT' THEN
    SELECT nombre INTO v_nombre FROM public.clientes WHERE id = NEW.cliente_id;
    INSERT INTO public.banco_movimientos (cuenta_id, anticipo_id, tipo, concepto, monto, fecha, referencia)
    VALUES (NEW.cuenta_id, NEW.id, 'ingreso',
      v_pre || COALESCE(v_nombre,'') || COALESCE(' - ' || NEW.numero_deposito,''), NEW.monto, NEW.fecha, NEW.numero_deposito);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' AND NEW.estado = 'anulado' AND OLD.estado <> 'anulado' THEN
    INSERT INTO public.banco_movimientos (cuenta_id, anticipo_id, tipo, concepto, monto, fecha, referencia)
    VALUES (NEW.cuenta_id, NEW.id, 'egreso',
      'Anulación anticipo' || CASE WHEN NEW.empresa = 'ogemi' THEN ' Ogemi' ELSE '' END
        || COALESCE(' - ' || NEW.numero_deposito,''), NEW.monto, CURRENT_DATE, NEW.numero_deposito);
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$function$;

-- 5. CORRECCIÓN: cobro de venta Ogemi con anticipo o lote NO toca el banco
CREATE OR REPLACE FUNCTION public.procesar_pago()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    IF NEW.anticipo_id IS NULL AND NEW.lote_id IS NULL AND NEW.credito_compra_id IS NULL THEN
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

  ELSIF NEW.venta_ogemi_id IS NOT NULL THEN
    SELECT v.numero::text, cl.nombre INTO v_concepto, v_prov
      FROM public.ventas_ogemi v LEFT JOIN public.clientes cl ON cl.id = v.cliente_id
     WHERE v.id = NEW.venta_ogemi_id;
    IF NEW.anticipo_id IS NULL AND NEW.lote_id IS NULL THEN
      INSERT INTO public.banco_movimientos (cuenta_id, venta_ogemi_id, pago_id, tipo, concepto, monto, fecha, referencia)
      VALUES (NEW.cuenta_id, NEW.venta_ogemi_id, NEW.id, 'ingreso',
        'Cobro venta Ogemi #' || COALESCE(v_concepto,'') || COALESCE(' ' || v_prov,'') || COALESCE(' - ' || NEW.referencia,''), NEW.monto, NEW.fecha, NEW.referencia);
    END IF;
    v_monto_pagado := public.monto_pagado_venta_ogemi(NEW.venta_ogemi_id);
    UPDATE public.ventas_ogemi SET monto_pagado = v_monto_pagado,
      estado = CASE WHEN v_monto_pagado >= total THEN 'pagada' ELSE 'pendiente' END,
      fecha_cobro = CASE WHEN v_monto_pagado >= total THEN NEW.fecha ELSE NULL END,
      banco_cuenta_id = CASE WHEN v_monto_pagado >= total THEN NEW.cuenta_id ELSE NULL END
    WHERE id = NEW.venta_ogemi_id;
  END IF;
  RETURN NEW;
END;
$function$;

-- 6. CORRECCIÓN simétrica en el reverso
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
    IF v_pago.anticipo_id IS NULL AND v_pago.credito_compra_id IS NULL THEN
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

  ELSIF v_pago.venta_ogemi_id IS NOT NULL THEN
    INSERT INTO public.pago_reversos (pago_id, venta_ogemi_id, cuenta_id, monto, fecha, motivo, created_by)
    VALUES (v_pago.id, v_pago.venta_ogemi_id, v_pago.cuenta_id, v_pago.monto, COALESCE(p_fecha,CURRENT_DATE), trim(p_motivo), auth.uid())
    RETURNING * INTO v_rev;
    IF v_pago.anticipo_id IS NULL THEN
      INSERT INTO public.banco_movimientos (cuenta_id, venta_ogemi_id, pago_reverso_id, tipo, concepto, monto, fecha, referencia)
      VALUES (v_pago.cuenta_id, v_pago.venta_ogemi_id, v_rev.id, 'egreso', 'Reverso cobro venta Ogemi - '||trim(p_motivo), v_pago.monto, COALESCE(p_fecha,CURRENT_DATE), v_pago.referencia)
      RETURNING id INTO v_mov;
    END IF;
    v_pagado := public.monto_pagado_venta_ogemi(v_pago.venta_ogemi_id);
    UPDATE public.ventas_ogemi SET monto_pagado = v_pagado,
      estado = CASE WHEN v_pagado >= total THEN 'pagada' ELSE 'pendiente' END,
      fecha_cobro = CASE WHEN v_pagado >= total THEN fecha_cobro ELSE NULL END,
      banco_cuenta_id = CASE WHEN v_pagado >= total THEN banco_cuenta_id ELSE NULL END
    WHERE id = v_pago.venta_ogemi_id;
  END IF;

  IF v_pago.nota_credito_id IS NOT NULL THEN
    UPDATE public.notas_credito SET estado='disponible', factura_aplicada_id=NULL, pago_id=NULL WHERE id=v_pago.nota_credito_id;
  END IF;
  IF v_pago.credito_factura_id IS NOT NULL THEN
    UPDATE public.facturas SET factura_aplicada_id=NULL WHERE id=v_pago.credito_factura_id;
  END IF;
  IF v_pago.credito_compra_id IS NOT NULL THEN
    UPDATE public.compras
       SET compra_aplicada_id = NULL, estado = 'pendiente', fecha_pago = NULL, banco_cuenta_id = NULL
     WHERE id = v_pago.credito_compra_id;
  END IF;

  IF v_mov IS NOT NULL THEN
    UPDATE public.pago_reversos SET banco_movimiento_id = v_mov WHERE id = v_rev.id RETURNING * INTO v_rev;
  END IF;
  RETURN v_rev;
END;
$function$;

-- 6bis. El estado del anticipo descuenta reversos y se recalcula al reversar
CREATE OR REPLACE FUNCTION public.sync_anticipo_estado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[] := ARRAY[]::uuid[];
  v_id uuid;
  v_monto numeric;
  v_aplicado numeric;
  v_nuevo text;
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.anticipo_id IS NOT NULL THEN
    v_ids := array_append(v_ids, NEW.anticipo_id);
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.anticipo_id IS NOT NULL
     AND (TG_OP = 'DELETE' OR OLD.anticipo_id IS DISTINCT FROM NEW.anticipo_id) THEN
    v_ids := array_append(v_ids, OLD.anticipo_id);
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT a.monto INTO v_monto FROM public.anticipos a WHERE a.id = v_id;
    v_aplicado := public.monto_aplicado_anticipo(v_id);

    v_nuevo := CASE WHEN v_aplicado >= v_monto THEN 'aplicado' ELSE 'activo' END;

    UPDATE public.anticipos
       SET estado = v_nuevo
     WHERE id = v_id
       AND estado <> 'anulado'
       AND estado IS DISTINCT FROM v_nuevo;
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_anticipo_estado_reverso()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ant uuid; v_monto numeric; v_aplicado numeric; v_nuevo text;
BEGIN
  SELECT p.anticipo_id INTO v_ant
    FROM public.pagos p
   WHERE p.id = COALESCE(NEW.pago_id, OLD.pago_id);

  IF v_ant IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT a.monto INTO v_monto FROM public.anticipos a WHERE a.id = v_ant;
  v_aplicado := public.monto_aplicado_anticipo(v_ant);
  v_nuevo := CASE WHEN v_aplicado >= v_monto THEN 'aplicado' ELSE 'activo' END;

  UPDATE public.anticipos
     SET estado = v_nuevo
   WHERE id = v_ant
     AND estado <> 'anulado'
     AND estado IS DISTINCT FROM v_nuevo;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_anticipo_estado_reverso ON public.pago_reversos;
CREATE TRIGGER trg_sync_anticipo_estado_reverso
  AFTER INSERT OR DELETE ON public.pago_reversos
  FOR EACH ROW EXECUTE FUNCTION public.sync_anticipo_estado_reverso();

-- 7. Los lotes de cobro admiten ventas Ogemi
ALTER TABLE public.cobro_lotes DROP CONSTRAINT IF EXISTS cobro_lotes_tipo_check;
ALTER TABLE public.cobro_lotes ADD CONSTRAINT cobro_lotes_tipo_check
  CHECK (tipo = ANY (ARRAY['factura'::text, 'presupuesto'::text, 'compra'::text, 'venta_ogemi'::text]));

ALTER TABLE public.cobro_lotes DROP CONSTRAINT IF EXISTS cobro_lotes_origen_check;
ALTER TABLE public.cobro_lotes ADD CONSTRAINT cobro_lotes_origen_check
  CHECK (
    ((tipo = ANY (ARRAY['factura'::text, 'presupuesto'::text, 'venta_ogemi'::text])) AND (cliente_id IS NOT NULL))
    OR ((tipo = 'compra'::text) AND (proveedor_id IS NOT NULL))
  );

-- 8. Los anticipos de Impresos solo se aplican a facturas de Impresos
CREATE OR REPLACE FUNCTION public.registrar_cobro_lote(p_cliente_id uuid, p_fecha date, p_cuenta_id uuid, p_referencia text, p_pagos jsonb, p_ncs jsonb DEFAULT '[]'::jsonb, p_anticipos jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app_private', 'pg_temp'
AS $function$
DECLARE
  v_item jsonb; v_f public.facturas%ROWTYPE; v_ant public.anticipos%ROWTYPE;
  v_total_efectivo numeric := 0; v_total_credito numeric := 0; v_total_anticipo numeric := 0;
  v_lote public.cobro_lotes%ROWTYPE;
  v_saldo numeric; v_monto numeric; v_nc_total numeric; v_ant_saldo numeric;
  v_num int := 0; v_pagadas int := 0; v_abonadas int := 0;
  v_lim date; v_cliente text; v_ref text;
  v_fids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF NOT app_private.has_module_permission('facturas','editar') THEN
    RAISE EXCEPTION 'No tienes permiso para registrar cobros.';
  END IF;

  SELECT nombre INTO v_cliente FROM public.clientes WHERE id = p_cliente_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'El cliente no existe.'; END IF;

  v_ref := nullif(trim(coalesce(p_referencia,'')),'');

  SELECT COALESCE(sum((x->>'monto')::numeric),0) INTO v_total_efectivo
  FROM jsonb_array_elements(COALESCE(p_pagos,'[]'::jsonb)) x
  WHERE COALESCE((x->>'monto')::numeric,0) > 0;

  IF v_total_efectivo <= 0
     AND jsonb_array_length(COALESCE(p_ncs,'[]'::jsonb)) = 0
     AND jsonb_array_length(COALESCE(p_anticipos,'[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'No hay nada que cobrar: selecciona al menos una factura con monto, una nota de crédito o un anticipo.';
  END IF;

  IF v_total_efectivo > 0 THEN
    IF p_cuenta_id IS NULL THEN RAISE EXCEPTION 'Selecciona la cuenta bancaria del depósito.'; END IF;
    v_lim := public.fecha_cierre_bloqueo(p_cuenta_id);
    IF v_lim IS NOT NULL AND COALESCE(p_fecha,CURRENT_DATE) <= v_lim THEN
      RAISE EXCEPTION 'No se puede cobrar con fecha %: el periodo está cerrado (cierre hasta %).',
        COALESCE(p_fecha,CURRENT_DATE), v_lim USING errcode='P0001';
    END IF;
  END IF;

  INSERT INTO public.cobro_lotes (cliente_id, cuenta_id, fecha, referencia, tipo)
  VALUES (p_cliente_id,
          CASE WHEN v_total_efectivo > 0 THEN p_cuenta_id ELSE NULL END,
          COALESCE(p_fecha,CURRENT_DATE), v_ref, 'factura')
  RETURNING * INTO v_lote;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_ncs,'[]'::jsonb)) LOOP
    SELECT total INTO v_nc_total FROM public.notas_credito WHERE id = (v_item->>'nota_credito_id')::uuid;
    PERFORM public.aplicar_nota_credito(
      (v_item->>'nota_credito_id')::uuid,
      (v_item->>'factura_id')::uuid,
      COALESCE(p_fecha,CURRENT_DATE),
      v_lote.id
    );
    v_total_credito := v_total_credito + COALESCE(v_nc_total,0);
    v_fids := array_append(v_fids, (v_item->>'factura_id')::uuid);
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_anticipos,'[]'::jsonb)) LOOP
    v_monto := (v_item->>'monto')::numeric;
    IF v_monto IS NULL OR v_monto <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_ant FROM public.anticipos WHERE id = (v_item->>'anticipo_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Uno de los anticipos seleccionados no existe.'; END IF;
    IF v_ant.empresa <> 'impresos' THEN
      RAISE EXCEPTION 'El anticipo REC-% es de Ogemi y no puede aplicarse a facturas de Impresos Comerciales.', v_ant.numero_recibo;
    END IF;
    IF v_ant.cliente_id <> p_cliente_id THEN
      RAISE EXCEPTION 'El anticipo REC-% es de otro cliente.', v_ant.numero_recibo;
    END IF;
    IF v_ant.estado <> 'activo' THEN
      RAISE EXCEPTION 'El anticipo REC-% no está activo.', v_ant.numero_recibo;
    END IF;
    v_ant_saldo := v_ant.monto - public.monto_aplicado_anticipo(v_ant.id);
    IF v_monto > v_ant_saldo + 0.01 THEN
      RAISE EXCEPTION 'El monto % del anticipo REC-% excede su saldo (%).',
        v_monto, v_ant.numero_recibo, round(v_ant_saldo,2);
    END IF;

    SELECT * INTO v_f FROM public.facturas WHERE id = (v_item->>'factura_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Una de las facturas seleccionadas no existe.'; END IF;
    IF v_f.cliente_id <> p_cliente_id THEN
      RAISE EXCEPTION 'La factura #% es de otro cliente.', v_f.numero_factura;
    END IF;
    IF COALESCE(v_f.total,0) <= 0 THEN
      RAISE EXCEPTION 'La factura #% no es cobrable.', v_f.numero_factura;
    END IF;
    v_saldo := (v_f.total - COALESCE(v_f.retencion_monto,0)) - public.monto_pagado_factura(v_f.id);
    IF v_monto > v_saldo + 0.01 THEN
      RAISE EXCEPTION 'El anticipo aplicado (%) a la factura #% excede su saldo (%).',
        v_monto, v_f.numero_factura, round(v_saldo,2);
    END IF;

    INSERT INTO public.pagos (factura_id, cuenta_id, monto, fecha, referencia, anticipo_id, lote_id)
    VALUES (v_f.id, v_ant.cuenta_id, v_monto, COALESCE(p_fecha,CURRENT_DATE),
            'Aplicación de anticipo REC-' || lpad(v_ant.numero_recibo::text, 5, '0'),
            v_ant.id, v_lote.id);

    v_total_anticipo := v_total_anticipo + v_monto;
    v_fids := array_append(v_fids, v_f.id);
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_pagos,'[]'::jsonb)) LOOP
    v_monto := (v_item->>'monto')::numeric;
    IF v_monto IS NULL OR v_monto <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_f FROM public.facturas WHERE id = (v_item->>'factura_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Una de las facturas seleccionadas no existe.'; END IF;
    IF v_f.cliente_id <> p_cliente_id THEN
      RAISE EXCEPTION 'La factura #% es de otro cliente.', v_f.numero_factura;
    END IF;
    IF COALESCE(v_f.total,0) <= 0 THEN
      RAISE EXCEPTION 'La factura #% no es cobrable.', v_f.numero_factura;
    END IF;

    v_saldo := (v_f.total - COALESCE(v_f.retencion_monto,0)) - public.monto_pagado_factura(v_f.id);
    IF v_monto > v_saldo + 0.01 THEN
      RAISE EXCEPTION 'El monto % de la factura #% excede su saldo (%).',
        v_monto, v_f.numero_factura, round(v_saldo,2);
    END IF;

    INSERT INTO public.pagos (factura_id, cuenta_id, monto, fecha, referencia, lote_id)
    VALUES (v_f.id, p_cuenta_id, v_monto, COALESCE(p_fecha,CURRENT_DATE), v_ref, v_lote.id);

    v_num := v_num + 1;
    v_fids := array_append(v_fids, v_f.id);
  END LOOP;

  IF v_total_efectivo > 0 THEN
    INSERT INTO public.banco_movimientos (cuenta_id, tipo, concepto, monto, fecha, referencia, lote_id)
    VALUES (p_cuenta_id, 'ingreso',
      'Cobro múltiple ' || COALESCE(v_cliente,'') || ' (' || v_num || ' factura' || CASE WHEN v_num=1 THEN '' ELSE 's' END || ')'
        || COALESCE(' - ' || v_ref, ''),
      v_total_efectivo, COALESCE(p_fecha,CURRENT_DATE), v_ref, v_lote.id);
  END IF;

  SELECT COALESCE(count(*) FILTER (WHERE f.estado = 'pagada'),0),
         COALESCE(count(*) FILTER (WHERE f.estado <> 'pagada'),0)
    INTO v_pagadas, v_abonadas
    FROM (SELECT DISTINCT unnest(v_fids) AS id) t
    JOIN public.facturas f ON f.id = t.id;

  UPDATE public.cobro_lotes
     SET monto_efectivo = v_total_efectivo, monto_credito = v_total_credito,
         monto_anticipo = v_total_anticipo, num_facturas = v_num
   WHERE id = v_lote.id;

  RETURN jsonb_build_object(
    'lote_id', v_lote.id,
    'total_efectivo', v_total_efectivo,
    'total_credito', v_total_credito,
    'total_anticipo', v_total_anticipo,
    'facturas_efectivo', v_num,
    'pagadas_completas', v_pagadas,
    'abonadas', v_abonadas,
    'ncs_aplicadas', jsonb_array_length(COALESCE(p_ncs,'[]'::jsonb))
  );
END;
$function$;

-- 9. Cobro de ventas Ogemi con anticipos
CREATE OR REPLACE FUNCTION public.registrar_cobro_lote_ventas_ogemi(
  p_cliente_id uuid, p_fecha date, p_cuenta_id uuid, p_referencia text,
  p_pagos jsonb, p_anticipos jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app_private', 'pg_temp'
AS $function$
DECLARE
  v_item jsonb; v_v public.ventas_ogemi%ROWTYPE; v_ant public.anticipos%ROWTYPE;
  v_total_efectivo numeric := 0; v_total_anticipo numeric := 0;
  v_lote public.cobro_lotes%ROWTYPE;
  v_saldo numeric; v_monto numeric; v_ant_saldo numeric;
  v_num int := 0; v_pagadas int := 0; v_abonadas int := 0;
  v_lim date; v_cliente text; v_ref text;
  v_vids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF NOT app_private.has_module_permission('ventas_ogemi','editar') THEN
    RAISE EXCEPTION 'No tienes permiso para registrar cobros de ventas Ogemi.';
  END IF;

  SELECT nombre INTO v_cliente FROM public.clientes WHERE id = p_cliente_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'El cliente no existe.'; END IF;

  v_ref := nullif(trim(coalesce(p_referencia,'')),'');

  SELECT COALESCE(sum((x->>'monto')::numeric),0) INTO v_total_efectivo
  FROM jsonb_array_elements(COALESCE(p_pagos,'[]'::jsonb)) x
  WHERE COALESCE((x->>'monto')::numeric,0) > 0;

  IF v_total_efectivo <= 0 AND jsonb_array_length(COALESCE(p_anticipos,'[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'No hay nada que cobrar: selecciona al menos una venta con monto o un anticipo.';
  END IF;

  IF v_total_efectivo > 0 THEN
    IF p_cuenta_id IS NULL THEN RAISE EXCEPTION 'Selecciona la cuenta bancaria del depósito.'; END IF;
    v_lim := public.fecha_cierre_bloqueo(p_cuenta_id);
    IF v_lim IS NOT NULL AND COALESCE(p_fecha,CURRENT_DATE) <= v_lim THEN
      RAISE EXCEPTION 'No se puede cobrar con fecha %: el periodo está cerrado (cierre hasta %).',
        COALESCE(p_fecha,CURRENT_DATE), v_lim USING errcode='P0001';
    END IF;
  END IF;

  INSERT INTO public.cobro_lotes (cliente_id, cuenta_id, fecha, referencia, tipo)
  VALUES (p_cliente_id,
          CASE WHEN v_total_efectivo > 0 THEN p_cuenta_id ELSE NULL END,
          COALESCE(p_fecha,CURRENT_DATE), v_ref, 'venta_ogemi')
  RETURNING * INTO v_lote;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_anticipos,'[]'::jsonb)) LOOP
    v_monto := (v_item->>'monto')::numeric;
    IF v_monto IS NULL OR v_monto <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_ant FROM public.anticipos WHERE id = (v_item->>'anticipo_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Uno de los anticipos seleccionados no existe.'; END IF;
    IF v_ant.empresa <> 'ogemi' THEN
      RAISE EXCEPTION 'El anticipo REC-% es de Impresos Comerciales y no puede aplicarse a ventas de Ogemi.', v_ant.numero_recibo;
    END IF;
    IF v_ant.cliente_id <> p_cliente_id THEN
      RAISE EXCEPTION 'El anticipo REC-% es de otro cliente.', v_ant.numero_recibo;
    END IF;
    IF v_ant.estado <> 'activo' THEN
      RAISE EXCEPTION 'El anticipo REC-% no está activo.', v_ant.numero_recibo;
    END IF;
    v_ant_saldo := v_ant.monto - public.monto_aplicado_anticipo(v_ant.id);
    IF v_monto > v_ant_saldo + 0.01 THEN
      RAISE EXCEPTION 'El monto % del anticipo REC-% excede su saldo (%).',
        v_monto, v_ant.numero_recibo, round(v_ant_saldo,2);
    END IF;

    SELECT * INTO v_v FROM public.ventas_ogemi WHERE id = (v_item->>'venta_ogemi_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Una de las ventas seleccionadas no existe.'; END IF;
    IF v_v.cliente_id <> p_cliente_id THEN
      RAISE EXCEPTION 'La venta #% es de otro cliente.', v_v.numero;
    END IF;
    IF COALESCE(v_v.total,0) <= 0 THEN
      RAISE EXCEPTION 'La venta #% no es cobrable.', v_v.numero;
    END IF;
    v_saldo := v_v.total - public.monto_pagado_venta_ogemi(v_v.id);
    IF v_monto > v_saldo + 0.01 THEN
      RAISE EXCEPTION 'El anticipo aplicado (%) a la venta #% excede su saldo (%).',
        v_monto, v_v.numero, round(v_saldo,2);
    END IF;

    INSERT INTO public.pagos (venta_ogemi_id, cuenta_id, monto, fecha, referencia, anticipo_id, lote_id)
    VALUES (v_v.id, v_ant.cuenta_id, v_monto, COALESCE(p_fecha,CURRENT_DATE),
            'Aplicación de anticipo REC-' || lpad(v_ant.numero_recibo::text, 5, '0'),
            v_ant.id, v_lote.id);

    v_total_anticipo := v_total_anticipo + v_monto;
    v_vids := array_append(v_vids, v_v.id);
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_pagos,'[]'::jsonb)) LOOP
    v_monto := (v_item->>'monto')::numeric;
    IF v_monto IS NULL OR v_monto <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_v FROM public.ventas_ogemi WHERE id = (v_item->>'venta_ogemi_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Una de las ventas seleccionadas no existe.'; END IF;
    IF v_v.cliente_id <> p_cliente_id THEN
      RAISE EXCEPTION 'La venta #% es de otro cliente.', v_v.numero;
    END IF;
    IF COALESCE(v_v.total,0) <= 0 THEN
      RAISE EXCEPTION 'La venta #% no es cobrable.', v_v.numero;
    END IF;

    v_saldo := v_v.total - public.monto_pagado_venta_ogemi(v_v.id);
    IF v_monto > v_saldo + 0.01 THEN
      RAISE EXCEPTION 'El monto % de la venta #% excede su saldo (%).',
        v_monto, v_v.numero, round(v_saldo,2);
    END IF;

    INSERT INTO public.pagos (venta_ogemi_id, cuenta_id, monto, fecha, referencia, lote_id)
    VALUES (v_v.id, p_cuenta_id, v_monto, COALESCE(p_fecha,CURRENT_DATE), v_ref, v_lote.id);

    v_num := v_num + 1;
    v_vids := array_append(v_vids, v_v.id);
  END LOOP;

  IF v_total_efectivo > 0 THEN
    INSERT INTO public.banco_movimientos (cuenta_id, tipo, concepto, monto, fecha, referencia, lote_id)
    VALUES (p_cuenta_id, 'ingreso',
      'Cobro múltiple Ogemi ' || COALESCE(v_cliente,'') || ' (' || v_num || ' venta' || CASE WHEN v_num=1 THEN '' ELSE 's' END || ')'
        || COALESCE(' - ' || v_ref, ''),
      v_total_efectivo, COALESCE(p_fecha,CURRENT_DATE), v_ref, v_lote.id);
  END IF;

  SELECT COALESCE(count(*) FILTER (WHERE v.estado = 'pagada'),0),
         COALESCE(count(*) FILTER (WHERE v.estado <> 'pagada'),0)
    INTO v_pagadas, v_abonadas
    FROM (SELECT DISTINCT unnest(v_vids) AS id) t
    JOIN public.ventas_ogemi v ON v.id = t.id;

  UPDATE public.cobro_lotes
     SET monto_efectivo = v_total_efectivo, monto_anticipo = v_total_anticipo, num_facturas = v_num
   WHERE id = v_lote.id;

  RETURN jsonb_build_object(
    'lote_id', v_lote.id,
    'total_efectivo', v_total_efectivo,
    'total_anticipo', v_total_anticipo,
    'ventas_efectivo', v_num,
    'pagadas_completas', v_pagadas,
    'abonadas', v_abonadas
  );
END;
$function$;

-- 10. Editar un cobro de venta Ogemi
CREATE OR REPLACE FUNCTION public.editar_cobro_venta_ogemi(
  p_pago_id uuid, p_monto numeric, p_fecha date, p_cuenta_id uuid,
  p_referencia text DEFAULT NULL::text, p_motivo text DEFAULT 'Edición de cobro'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app_private', 'pg_temp'
AS $function$
DECLARE v_pago public.pagos%ROWTYPE; v_v public.ventas_ogemi%ROWTYPE; v_saldo numeric; v_nuevo uuid;
BEGIN
  IF NOT app_private.has_module_permission('ventas_ogemi','editar') THEN
    RAISE EXCEPTION 'No tienes permiso para editar cobros de ventas Ogemi.';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor que cero.';
  END IF;

  SELECT * INTO v_pago FROM public.pagos WHERE id = p_pago_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'El cobro no existe.'; END IF;
  IF v_pago.venta_ogemi_id IS NULL THEN RAISE EXCEPTION 'El cobro no corresponde a una venta Ogemi.'; END IF;
  IF v_pago.anticipo_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este cobro proviene de un anticipo. Reversa la aplicación en lugar de editarla.';
  END IF;

  PERFORM public._reversar_pago_core(p_pago_id, p_motivo, COALESCE(p_fecha, CURRENT_DATE));

  SELECT * INTO v_v FROM public.ventas_ogemi WHERE id = v_pago.venta_ogemi_id FOR UPDATE;
  v_saldo := v_v.total - public.monto_pagado_venta_ogemi(v_v.id);
  IF p_monto > v_saldo + 0.01 THEN
    RAISE EXCEPTION 'El monto % excede el saldo de la venta #% (%).', p_monto, v_v.numero, round(v_saldo,2);
  END IF;

  INSERT INTO public.pagos (venta_ogemi_id, cuenta_id, monto, fecha, referencia)
  VALUES (v_v.id, p_cuenta_id, p_monto, COALESCE(p_fecha,CURRENT_DATE), p_referencia)
  RETURNING id INTO v_nuevo;

  RETURN v_nuevo;
END;
$function$;

-- 11. Permisos: los anticipos de Ogemi dependen del módulo 'ventas_ogemi'
DROP POLICY IF EXISTS ver_anticipos ON public.anticipos;
CREATE POLICY ver_anticipos ON public.anticipos AS PERMISSIVE FOR SELECT TO authenticated
USING (
  CASE WHEN empresa = 'ogemi'
       THEN app_private.has_module_permission('ventas_ogemi'::text, 'ver'::text)
       ELSE app_private.has_module_permission('facturas'::text, 'ver'::text)
  END
  OR app_private.has_module_permission('reportes'::text, 'ver'::text)
);

DROP POLICY IF EXISTS editar_anticipos ON public.anticipos;
CREATE POLICY editar_anticipos ON public.anticipos AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (
  CASE WHEN empresa = 'ogemi'
       THEN app_private.has_module_permission('ventas_ogemi'::text, 'agregar'::text)
       ELSE app_private.has_module_permission('facturas'::text, 'agregar'::text)
  END
);

DROP POLICY IF EXISTS update_anticipos ON public.anticipos;
CREATE POLICY update_anticipos ON public.anticipos AS PERMISSIVE FOR UPDATE TO authenticated
USING (
  CASE WHEN empresa = 'ogemi'
       THEN app_private.has_module_permission('ventas_ogemi'::text, 'editar'::text)
       ELSE app_private.has_module_permission('facturas'::text, 'editar'::text)
  END
)
WITH CHECK (
  CASE WHEN empresa = 'ogemi'
       THEN app_private.has_module_permission('ventas_ogemi'::text, 'editar'::text)
       ELSE app_private.has_module_permission('facturas'::text, 'editar'::text)
  END
);

DROP POLICY IF EXISTS delete_anticipos ON public.anticipos;
CREATE POLICY delete_anticipos ON public.anticipos AS PERMISSIVE FOR DELETE TO authenticated
USING (
  CASE WHEN empresa = 'ogemi'
       THEN app_private.has_module_permission('ventas_ogemi'::text, 'borrar'::text)
       ELSE app_private.has_module_permission('facturas'::text, 'borrar'::text)
  END
);
