-- 2026-09-24 · Aplicada en prod (tnuzaaetfbbnxtbedlhs) vía MCP como
-- "orden_bancos_y_tipo_venta_por_codigo_fe".

-- 1) Orden de cuentas pedido por el usuario (Banco, Informe diario y selectores)
update banco_cuentas set orden = v.o
from (values
  ('IMPRESOS COMERCIALES CORRIENTE', 1),
  ('OGEMI BAC EMPRESARIAL', 2),
  ('OGEMI CORRIENTE', 3),
  ('OGEMI AHORRO', 4),
  ('DIRECTORES BAC', 5),
  ('DIRECTORES GENERAL', 6),
  ('OGEMI BAC TC CONECTMILES', 7),
  ('OGEMI BAC TC PRICESMART', 8),
  ('IMPRESOS COMERCIALES BAC TC', 9)
) v(nombre, o)
where upper(trim(banco_cuentas.nombre)) = v.nombre and banco_cuentas.activo;

-- 2) Tipo de venta según el código del artículo de la FE:
--    001 → litografico (400-01), 002 → digital (400-02), 003 → otras (400-05).
--    Si hay varios códigos, gana el de mayor importe. Solo rellena facturas sin tipo.
create or replace function public.tipo_venta_desde_fe(p_documento_id uuid)
returns text language sql stable set search_path = public as $$
  select case l.codigo_articulo
           when '001' then 'litografico'
           when '002' then 'digital'
           when '003' then 'otras'
         end
  from fe_documento_lineas l
  where l.documento_id = p_documento_id
    and l.codigo_articulo in ('001','002','003')
  group by l.codigo_articulo
  order by sum(coalesce(l.precioneto,0) * coalesce(l.cantidad,1)) desc, l.codigo_articulo
  limit 1
$$;

create or replace function public.trg_fe_clasificar_factura()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_tipo text;
begin
  if new.factura_id is not null and new.tipo_doc = '01' then
    v_tipo := tipo_venta_desde_fe(new.id);
    if v_tipo is not null then
      update facturas set tipo_venta = v_tipo
      where id = new.factura_id and tipo_venta is null;
    end if;
  end if;
  return new;
end $$;

revoke execute on function public.trg_fe_clasificar_factura() from public, anon, authenticated;
revoke execute on function public.tipo_venta_desde_fe(uuid) from public, anon;
grant execute on function public.tipo_venta_desde_fe(uuid) to authenticated, service_role;

drop trigger if exists fe_clasificar_factura on public.fe_documentos;
create trigger fe_clasificar_factura
  after insert or update of factura_id on public.fe_documentos
  for each row execute function public.trg_fe_clasificar_factura();

-- 3) Backfill: facturas sin tipo que tienen FE con detalle (599-602 el 2026-09-24)
update facturas f set tipo_venta = tipo_venta_desde_fe(d.id)
from fe_documentos d
where d.factura_id = f.id and d.tipo_doc = '01' and f.tipo_venta is null
  and tipo_venta_desde_fe(d.id) is not null;
