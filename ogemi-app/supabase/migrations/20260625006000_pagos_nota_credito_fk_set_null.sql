-- Permite borrar una NC (previamente des-aplicada/reversada) aunque exista un pago
-- reversado que la referenciaba: el vínculo del pago queda en NULL en vez de bloquear.
ALTER TABLE public.pagos DROP CONSTRAINT IF EXISTS pagos_nota_credito_id_fkey;
ALTER TABLE public.pagos ADD CONSTRAINT pagos_nota_credito_id_fkey
  FOREIGN KEY (nota_credito_id) REFERENCES public.notas_credito(id) ON DELETE SET NULL;
