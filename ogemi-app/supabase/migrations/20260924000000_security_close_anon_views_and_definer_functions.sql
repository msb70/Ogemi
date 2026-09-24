-- 2026-09-24 · Aplicada en prod (tnuzaaetfbbnxtbedlhs) vía MCP como
-- "security_close_anon_views_and_definer_functions".
-- Cierra dos huecos detectados por el Security Advisor:
--   1) 3 vistas SECURITY DEFINER legibles por anon (saltaban RLS: cartera,
--      anticipos y compras vencidas visibles sin login con la anon key).
--   2) 21 funciones SECURITY DEFINER ejecutables por anon vía /rest/v1/rpc
--      (heredaban EXECUTE de PUBLIC).
-- Verificado: anon bloqueado; admin y contador ven las mismas filas que antes.

-- 1) Vistas: respetar RLS del usuario que consulta y cerrar a anon
alter view public.cartera_ventas_ogemi set (security_invoker = true);
alter view public.anticipos_saldos     set (security_invoker = true);
alter view public.compras_vencidas     set (security_invoker = true);
revoke all on public.cartera_ventas_ogemi, public.anticipos_saldos, public.compras_vencidas from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.cartera_ventas_ogemi, public.anticipos_saldos, public.compras_vencidas from authenticated;

-- 2) Funciones SECURITY DEFINER: quitar EXECUTE a PUBLIC y anon; mantener authenticated y service_role
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prosecdef
      and has_function_privilege('anon', p.oid, 'execute')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;

-- 3) Funciones futuras creadas por postgres: sin EXECUTE para PUBLIC ni anon.
--    Toda función nueva debe llevar su GRANT EXECUTE ... TO authenticated explícito
--    (lo recibe por el default privilege del schema public).
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
