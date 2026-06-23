-- ============================================================
-- FIX: doble ingreso en banco al cobrar presupuestos
-- El cobro se registra en banco vía procesar_pago (trigger sobre pagos).
-- El trigger legacy registrar_cobro_presupuesto_en_banco (sobre presupuestos)
-- insertaba un SEGUNDO ingreso al pasar el presupuesto a 'pagada' → duplicado.
-- Se elimina el trigger redundante.
-- ============================================================

DROP TRIGGER IF EXISTS trg_registrar_cobro_presupuesto ON public.presupuestos;
