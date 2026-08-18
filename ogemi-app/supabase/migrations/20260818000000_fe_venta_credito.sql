-- Venta a crédito en Factura Electrónica.
--
-- Verificado 2026-08-18 contra el PAC TheFactory y el portal de consulta de la DGI
-- (ambiente de pruebas): el código de forma de pago 01 es "Crédito" en el catálogo
-- de la DGI (el manual del PAC lo etiqueta erróneamente como "NOTA DE CREDITO").
-- El PAC ignora total_pagado y el monto de la cuota: la DGI siempre imprime
-- TOTAL PAGADO = total del documento.
--
-- El código queda parametrizable para poder corregirlo sin redeploy si el PAC cambia.

alter table public.fe_config
  add column if not exists fp_credito_codigo text not null default '01',
  add column if not exists fp_credito_nombre text not null default 'CREDITO';

comment on column public.fe_config.fp_credito_codigo is 'Código de forma de pago enviado al PAC cuando la factura es a crédito (01 = Crédito en el catálogo DGI)';

alter table public.fe_documentos
  add column if not exists es_credito boolean not null default false;

comment on column public.fe_documentos.es_credito is 'Venta a crédito: la forma de pago se fuerza al código de crédito de fe_config y no se elige a mano';
