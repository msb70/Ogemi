-- ============================================================
-- Facturas y compras: editar monto, borrar y editar cobro (reflejado en banco)
-- Solo administrador. Respeta el bloqueo de periodo cerrado.
-- Reusa _reversar_pago_core (ya soporta factura/compra).
-- ============================================================

CREATE OR REPLACE FUNCTION public._es_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.rol_id = 'admin')
      OR EXISTS (SELECT 1 FROM public.user_roles  ur WHERE ur.user_id = auth.uid() AND ur.role  = 'admin');
$$;
REVOKE ALL ON FUNCTION public._es_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._es_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.factura_recalc_estado()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.total IS DISTINCT FROM OLD.total THEN
    NEW.estado := CASE WHEN NEW.total > 0 AND COALESCE(NEW.monto_pagado,0) >= NEW.total THEN 'pagada' ELSE 'pendiente' END;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_factura_recalc_estado ON public.facturas;
CREATE TRIGGER trg_factura_recalc_estado BEFORE UPDATE OF monto, itbms, total ON public.facturas
  FOR EACH ROW EXECUTE FUNCTION public.factura_recalc_estado();

CREATE OR REPLACE FUNCTION public.compra_recalc_estado()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.total IS DISTINCT FROM OLD.total THEN
    NEW.estado := CASE WHEN NEW.total > 0 AND COALESCE(NEW.monto_pagado,0) >= NEW.total THEN 'pagada' ELSE 'pendiente' END;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_compra_recalc_estado ON public.compras;
CREATE TRIGGER trg_compra_recalc_estado BEFORE UPDATE OF monto, itbms, total ON public.compras
  FOR EACH ROW EXECUTE FUNCTION public.compra_recalc_estado();

CREATE OR REPLACE FUNCTION public.editar_cobro_factura(
  p_pago_id uuid, p_monto numeric, p_fecha date, p_cuenta_id uuid,
  p_referencia text DEFAULT NULL, p_motivo text DEFAULT 'Edición de cobro'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','app_private','pg_temp' AS $$
DECLARE v_pago public.pagos%ROWTYPE; v_lim date; v_new uuid;
BEGIN
  IF NOT public._es_admin() THEN RAISE EXCEPTION 'Solo un administrador puede editar cobros.'; END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN RAISE EXCEPTION 'El monto debe ser mayor a 0.'; END IF;
  IF p_cuenta_id IS NULL THEN RAISE EXCEPTION 'Debe indicar la cuenta de banco.'; END IF;
  SELECT * INTO v_pago FROM public.pagos WHERE id = p_pago_id;
  IF NOT FOUND OR v_pago.factura_id IS NULL THEN RAISE EXCEPTION 'Cobro de factura no encontrado.'; END IF;
  IF v_pago.anticipo_id IS NOT NULL THEN RAISE EXCEPTION 'No se puede editar aquí un cobro aplicado desde anticipo.'; END IF;
  v_lim := public.fecha_cierre_bloqueo(p_cuenta_id);
  IF v_lim IS NOT NULL AND p_fecha <= v_lim THEN
    RAISE EXCEPTION 'La nueva fecha % cae en un periodo cerrado (cierre hasta %).', p_fecha, v_lim USING errcode='P0001';
  END IF;
  PERFORM public._reversar_pago_core(p_pago_id, p_motivo, p_fecha);
  INSERT INTO public.pagos (factura_id, cuenta_id, monto, fecha, referencia)
  VALUES (v_pago.factura_id, p_cuenta_id, p_monto, p_fecha, p_referencia)
  RETURNING id INTO v_new;
  RETURN v_new;
END; $$;

CREATE OR REPLACE FUNCTION public.editar_cobro_compra(
  p_pago_id uuid, p_monto numeric, p_fecha date, p_cuenta_id uuid,
  p_referencia text DEFAULT NULL, p_motivo text DEFAULT 'Edición de pago'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','app_private','pg_temp' AS $$
DECLARE v_pago public.pagos%ROWTYPE; v_lim date; v_new uuid;
BEGIN
  IF NOT public._es_admin() THEN RAISE EXCEPTION 'Solo un administrador puede editar pagos.'; END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN RAISE EXCEPTION 'El monto debe ser mayor a 0.'; END IF;
  IF p_cuenta_id IS NULL THEN RAISE EXCEPTION 'Debe indicar la cuenta de banco.'; END IF;
  SELECT * INTO v_pago FROM public.pagos WHERE id = p_pago_id;
  IF NOT FOUND OR v_pago.compra_id IS NULL THEN RAISE EXCEPTION 'Pago de compra no encontrado.'; END IF;
  v_lim := public.fecha_cierre_bloqueo(p_cuenta_id);
  IF v_lim IS NOT NULL AND p_fecha <= v_lim THEN
    RAISE EXCEPTION 'La nueva fecha % cae en un periodo cerrado (cierre hasta %).', p_fecha, v_lim USING errcode='P0001';
  END IF;
  PERFORM public._reversar_pago_core(p_pago_id, p_motivo, p_fecha);
  INSERT INTO public.pagos (compra_id, cuenta_id, monto, fecha, referencia)
  VALUES (v_pago.compra_id, p_cuenta_id, p_monto, p_fecha, p_referencia)
  RETURNING id INTO v_new;
  RETURN v_new;
END; $$;

CREATE OR REPLACE FUNCTION public.eliminar_factura(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','app_private','pg_temp' AS $$
DECLARE v_bloq int;
BEGIN
  IF NOT public._es_admin() THEN RAISE EXCEPTION 'Solo un administrador puede borrar facturas.'; END IF;
  SELECT count(*) INTO v_bloq FROM public.banco_movimientos b
  WHERE b.factura_id = p_id AND public.fecha_cierre_bloqueo(b.cuenta_id) IS NOT NULL
    AND b.fecha <= public.fecha_cierre_bloqueo(b.cuenta_id);
  IF v_bloq > 0 THEN RAISE EXCEPTION 'No se puede borrar: la factura tiene movimientos en un periodo cerrado.' USING errcode='P0001'; END IF;
  PERFORM set_config('app.allow_pago_mutation','on', true);
  UPDATE public.pago_reversos SET banco_movimiento_id = NULL
  WHERE factura_id = p_id OR pago_id IN (SELECT id FROM public.pagos WHERE factura_id = p_id);
  DELETE FROM public.banco_movimientos WHERE factura_id = p_id;
  DELETE FROM public.pago_reversos WHERE factura_id = p_id OR pago_id IN (SELECT id FROM public.pagos WHERE factura_id = p_id);
  DELETE FROM public.pagos WHERE factura_id = p_id;
  DELETE FROM public.facturas WHERE id = p_id;
END; $$;

CREATE OR REPLACE FUNCTION public.eliminar_compra(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','app_private','pg_temp' AS $$
DECLARE v_bloq int;
BEGIN
  IF NOT public._es_admin() THEN RAISE EXCEPTION 'Solo un administrador puede borrar compras.'; END IF;
  SELECT count(*) INTO v_bloq FROM public.banco_movimientos b
  WHERE b.compra_id = p_id AND public.fecha_cierre_bloqueo(b.cuenta_id) IS NOT NULL
    AND b.fecha <= public.fecha_cierre_bloqueo(b.cuenta_id);
  IF v_bloq > 0 THEN RAISE EXCEPTION 'No se puede borrar: la compra tiene movimientos en un periodo cerrado.' USING errcode='P0001'; END IF;
  PERFORM set_config('app.allow_pago_mutation','on', true);
  UPDATE public.pago_reversos SET banco_movimiento_id = NULL
  WHERE compra_id = p_id OR pago_id IN (SELECT id FROM public.pagos WHERE compra_id = p_id);
  DELETE FROM public.banco_movimientos WHERE compra_id = p_id;
  DELETE FROM public.pago_reversos WHERE compra_id = p_id OR pago_id IN (SELECT id FROM public.pagos WHERE compra_id = p_id);
  DELETE FROM public.pagos WHERE compra_id = p_id;
  DELETE FROM public.compras WHERE id = p_id;
END; $$;

REVOKE ALL ON FUNCTION public.editar_cobro_factura(uuid,numeric,date,uuid,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.editar_cobro_compra(uuid,numeric,date,uuid,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.eliminar_factura(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.eliminar_compra(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.editar_cobro_factura(uuid,numeric,date,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.editar_cobro_compra(uuid,numeric,date,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.eliminar_factura(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.eliminar_compra(uuid) TO authenticated;
