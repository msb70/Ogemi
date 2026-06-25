-- ============ Módulo Notas de Crédito ============
-- NC manual (tabla nueva) + aplicar como pago de facturas, uso único.
-- También se pueden aplicar las NC importadas (facturas tipo CRÉDITO).
-- (Aplicada a prod vía MCP 2026-06-25; archivo de registro en el repo.)

ALTER TABLE public.pagos ALTER COLUMN cuenta_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS public.notas_credito (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero text,
  cliente_id uuid NOT NULL REFERENCES public.clientes(id),
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  monto numeric(12,2) NOT NULL DEFAULT 0,
  itbms numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) GENERATED ALWAYS AS (round(COALESCE(monto,0)+COALESCE(itbms,0),2)) STORED,
  estado text NOT NULL DEFAULT 'disponible' CHECK (estado IN ('disponible','aplicada')),
  factura_aplicada_id uuid REFERENCES public.facturas(id),
  pago_id uuid REFERENCES public.pagos(id),
  notas text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notas_credito_cliente ON public.notas_credito(cliente_id);
CREATE INDEX IF NOT EXISTS idx_notas_credito_estado ON public.notas_credito(estado);

DROP TRIGGER IF EXISTS trg_notas_credito_updated_at ON public.notas_credito;
CREATE TRIGGER trg_notas_credito_updated_at BEFORE UPDATE ON public.notas_credito
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.pagos
  ADD COLUMN IF NOT EXISTS nota_credito_id uuid REFERENCES public.notas_credito(id),
  ADD COLUMN IF NOT EXISTS credito_factura_id uuid REFERENCES public.facturas(id);

ALTER TABLE public.facturas
  ADD COLUMN IF NOT EXISTS factura_aplicada_id uuid REFERENCES public.facturas(id);

-- procesar_pago: no tocar banco cuando el pago es un crédito (anticipo o NC)
CREATE OR REPLACE FUNCTION public.procesar_pago()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $pp$
DECLARE
  v_monto_pagado numeric; v_concepto text;
  v_total numeric; v_ret numeric; v_comp boolean;
BEGIN
  IF NEW.factura_id IS NOT NULL THEN
    SELECT numero_factura::text INTO v_concepto FROM public.facturas WHERE id = NEW.factura_id;
    IF NEW.anticipo_id IS NULL AND NEW.nota_credito_id IS NULL AND NEW.credito_factura_id IS NULL THEN
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
    SELECT concepto INTO v_concepto FROM public.compras WHERE id = NEW.compra_id;
    IF NEW.anticipo_id IS NULL THEN
      INSERT INTO public.banco_movimientos (cuenta_id, compra_id, pago_id, tipo, concepto, monto, fecha, referencia)
      VALUES (NEW.cuenta_id, NEW.compra_id, NEW.id, 'egreso',
        'Pago compra: ' || COALESCE(v_concepto,'sin concepto') || COALESCE(' - ' || NEW.referencia,''), NEW.monto, NEW.fecha, NEW.referencia);
    END IF;
    v_monto_pagado := public.monto_pagado_compra(NEW.compra_id);
    UPDATE public.compras SET monto_pagado = v_monto_pagado,
      estado = CASE WHEN v_monto_pagado >= total THEN 'pagada' ELSE 'pendiente' END,
      fecha_pago = CASE WHEN v_monto_pagado >= total THEN NEW.fecha ELSE NULL END,
      banco_cuenta_id = CASE WHEN v_monto_pagado >= total THEN NEW.cuenta_id ELSE NULL END
    WHERE id = NEW.compra_id;

  ELSIF NEW.presupuesto_id IS NOT NULL THEN
    SELECT numero_presupuesto::text INTO v_concepto FROM public.presupuestos WHERE id = NEW.presupuesto_id;
    IF NEW.anticipo_id IS NULL THEN
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
$pp$;

-- _reversar_pago_core: sin banco para créditos + restaurar NC al reversar
CREATE OR REPLACE FUNCTION public._reversar_pago_core(p_pago_id uuid, p_motivo text, p_fecha date)
 RETURNS pago_reversos LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'app_private', 'pg_temp'
AS $rev$
DECLARE v_pago public.pagos%ROWTYPE; v_rev public.pago_reversos%ROWTYPE; v_mov uuid; v_pagado numeric; v_lim date;
BEGIN
  IF p_motivo IS NULL OR length(trim(p_motivo)) < 3 THEN RAISE EXCEPTION 'Debe indicar un motivo de reverso.'; END IF;
  SELECT * INTO v_pago FROM public.pagos WHERE id = p_pago_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'El pago no existe.'; END IF;
  IF EXISTS (SELECT 1 FROM public.pago_reversos WHERE pago_id = p_pago_id) THEN RAISE EXCEPTION 'El pago ya fue reversado.'; END IF;

  v_lim := public.fecha_cierre_bloqueo(v_pago.cuenta_id);
  IF v_lim IS NOT NULL AND v_pago.fecha <= v_lim THEN
    RAISE EXCEPTION 'No se puede reversar/editar: el cobro del % pertenece a un periodo cerrado (cierre hasta %).', v_pago.fecha, v_lim USING errcode = 'P0001';
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
$rev$;

-- RPC aplicar NC manual
CREATE OR REPLACE FUNCTION public.aplicar_nota_credito(p_nota_id uuid, p_factura_id uuid, p_fecha date DEFAULT CURRENT_DATE)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $anc$
DECLARE v_nc public.notas_credito%ROWTYPE; v_f public.facturas%ROWTYPE; v_saldo numeric; v_ret numeric; v_pago_id uuid;
BEGIN
  SELECT * INTO v_nc FROM public.notas_credito WHERE id=p_nota_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La nota de crédito no existe.'; END IF;
  IF v_nc.estado <> 'disponible' THEN RAISE EXCEPTION 'La nota de crédito ya fue aplicada.'; END IF;
  IF COALESCE(v_nc.total,0) <= 0 THEN RAISE EXCEPTION 'La nota de crédito no tiene monto.'; END IF;
  SELECT * INTO v_f FROM public.facturas WHERE id=p_factura_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'La factura no existe.'; END IF;
  IF v_f.cliente_id <> v_nc.cliente_id THEN RAISE EXCEPTION 'La nota de crédito es de otro cliente.'; END IF;
  v_ret := round(COALESCE(v_f.retencion_pct,0)/100.0*COALESCE(v_f.itbms,0),2);
  v_saldo := (v_f.total - v_ret) - public.monto_pagado_factura(p_factura_id);
  IF v_nc.total > v_saldo + 0.001 THEN RAISE EXCEPTION 'La nota de crédito (%) excede el saldo de la factura (%).', v_nc.total, round(v_saldo,2); END IF;
  INSERT INTO public.pagos (factura_id, cuenta_id, monto, fecha, referencia, nota_credito_id)
  VALUES (p_factura_id, NULL, v_nc.total, COALESCE(p_fecha,CURRENT_DATE), 'NC '||COALESCE(v_nc.numero,''), p_nota_id)
  RETURNING id INTO v_pago_id;
  UPDATE public.notas_credito SET estado='aplicada', factura_aplicada_id=p_factura_id, pago_id=v_pago_id WHERE id=p_nota_id;
  RETURN v_pago_id;
END;
$anc$;

-- RPC aplicar NC importada (factura tipo crédito)
CREATE OR REPLACE FUNCTION public.aplicar_nc_factura(p_nc_factura_id uuid, p_factura_id uuid, p_fecha date DEFAULT CURRENT_DATE)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $ncf$
DECLARE v_nc public.facturas%ROWTYPE; v_f public.facturas%ROWTYPE; v_credito numeric; v_saldo numeric; v_ret numeric; v_pago_id uuid;
BEGIN
  SELECT * INTO v_nc FROM public.facturas WHERE id=p_nc_factura_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La nota de crédito no existe.'; END IF;
  IF v_nc.tipo_documento NOT ILIKE '%credito%' THEN RAISE EXCEPTION 'El documento no es una nota de crédito.'; END IF;
  IF v_nc.factura_aplicada_id IS NOT NULL THEN RAISE EXCEPTION 'La nota de crédito ya fue aplicada.'; END IF;
  IF p_nc_factura_id = p_factura_id THEN RAISE EXCEPTION 'No se puede aplicar una NC a sí misma.'; END IF;
  v_credito := abs(v_nc.total);
  IF v_credito <= 0 THEN RAISE EXCEPTION 'La nota de crédito no tiene monto.'; END IF;
  SELECT * INTO v_f FROM public.facturas WHERE id=p_factura_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'La factura no existe.'; END IF;
  IF v_f.tipo_documento ILIKE '%credito%' THEN RAISE EXCEPTION 'No se puede aplicar una NC a otra NC.'; END IF;
  IF v_f.cliente_id <> v_nc.cliente_id THEN RAISE EXCEPTION 'La nota de crédito es de otro cliente.'; END IF;
  v_ret := round(COALESCE(v_f.retencion_pct,0)/100.0*COALESCE(v_f.itbms,0),2);
  v_saldo := (v_f.total - v_ret) - public.monto_pagado_factura(p_factura_id);
  IF v_credito > v_saldo + 0.001 THEN RAISE EXCEPTION 'La nota de crédito (%) excede el saldo de la factura (%).', v_credito, round(v_saldo,2); END IF;
  INSERT INTO public.pagos (factura_id, cuenta_id, monto, fecha, referencia, credito_factura_id)
  VALUES (p_factura_id, NULL, v_credito, COALESCE(p_fecha,CURRENT_DATE), 'NC #'||v_nc.numero_factura, p_nc_factura_id)
  RETURNING id INTO v_pago_id;
  UPDATE public.facturas SET factura_aplicada_id=p_factura_id WHERE id=p_nc_factura_id;
  RETURN v_pago_id;
END;
$ncf$;

REVOKE EXECUTE ON FUNCTION public.aplicar_nota_credito(uuid,uuid,date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.aplicar_nc_factura(uuid,uuid,date) FROM anon;
GRANT EXECUTE ON FUNCTION public.aplicar_nota_credito(uuid,uuid,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aplicar_nc_factura(uuid,uuid,date) TO authenticated;

-- Permisos: módulo notas_credito (mismos permisos que facturas por rol)
INSERT INTO public.rol_permisos (rol_id, modulo, puede_ver, puede_agregar, puede_editar, puede_borrar)
SELECT rol_id, 'notas_credito', puede_ver, puede_agregar, puede_editar, puede_borrar
FROM public.rol_permisos rp
WHERE rp.modulo='facturas'
  AND NOT EXISTS (SELECT 1 FROM public.rol_permisos x WHERE x.rol_id=rp.rol_id AND x.modulo='notas_credito');

-- RLS
ALTER TABLE public.notas_credito ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ver_notas_credito ON public.notas_credito;
DROP POLICY IF EXISTS agregar_notas_credito ON public.notas_credito;
DROP POLICY IF EXISTS editar_notas_credito ON public.notas_credito;
DROP POLICY IF EXISTS borrar_notas_credito ON public.notas_credito;
CREATE POLICY ver_notas_credito ON public.notas_credito FOR SELECT
  USING (app_private.has_module_permission('notas_credito','ver') OR app_private.has_module_permission('facturas','ver') OR app_private.has_module_permission('reportes','ver') OR app_private.has_module_permission('dashboard','ver'));
CREATE POLICY agregar_notas_credito ON public.notas_credito FOR INSERT
  WITH CHECK (app_private.has_module_permission('notas_credito','agregar'));
CREATE POLICY editar_notas_credito ON public.notas_credito FOR UPDATE
  USING (app_private.has_module_permission('notas_credito','editar'))
  WITH CHECK (app_private.has_module_permission('notas_credito','editar'));
CREATE POLICY borrar_notas_credito ON public.notas_credito FOR DELETE
  USING (app_private.has_module_permission('notas_credito','borrar'));

-- Reversos de pagos por crédito no tienen cuenta
ALTER TABLE public.pago_reversos ALTER COLUMN cuenta_id DROP NOT NULL;
