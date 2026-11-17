-- Asistente (Grok): consulta SELECT de solo lectura ejecutada con los permisos y RLS del usuario.
-- SECURITY INVOKER: el usuario solo ve lo que ya puede ver en la app.
-- Defensas: una sola sentencia SELECT/WITH, envuelta en subconsulta (el parser rechaza
-- INSERT/UPDATE/DELETE dentro de ella), lista negra de palabras y de funciones volátiles,
-- sin esquemas internos, máximo 200 filas.
create or replace function public.asistente_consulta(p_sql text)
 returns jsonb language plpgsql volatile security invoker set search_path to 'public', 'pg_temp'
as $function$
declare q text; v jsonb; bad text;
begin
  if auth.uid() is null then raise exception 'No autenticado.'; end if;
  q := btrim(coalesce(p_sql, ''));
  q := regexp_replace(q, ';\s*$', '');
  if length(q) = 0 or length(q) > 6000 then raise exception 'Consulta vacía o demasiado larga.'; end if;
  if q !~* '^(select|with)\s' then raise exception 'Solo se permiten consultas SELECT.'; end if;
  if position(';' in q) > 0 then raise exception 'Solo una consulta, sin punto y coma.'; end if;
  if q ~ '(--|/\*)' then raise exception 'No se permiten comentarios en la consulta.'; end if;
  if q ~* '\m(insert|update|delete|merge|truncate|alter|drop|create|grant|revoke|copy|call|do|execute|vacuum|analyze|notify|listen|unlisten|lock|into|set_config|current_setting|nextval|setval|dblink|lo_import|lo_export|lo_unlink)\M'
     or q ~* '\mfor\s+(share|key|no\s+key)\M'
     or q ~* '\mpg_\w*\s*\('
     or q ~* '_to_xml'
     or q ~* '\m(auth|storage|app_private|vault|extensions|supabase_functions|graphql|graphql_public|realtime|net|cron|pgsodium|pg_catalog|information_schema)\s*\.'
  then
    raise exception 'Consulta no permitida (solo lectura de datos de la app).';
  end if;
  select p.proname into bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.provolatile = 'v'
     and q ~* ('\m' || p.proname || '\s*\(')
   limit 1;
  if bad is not null then raise exception 'Función no permitida en consultas: %', bad; end if;

  execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (select * from (%s) s limit 200) t', q) into v;
  return v;
end $function$;

revoke all on function public.asistente_consulta(text) from public, anon;
grant execute on function public.asistente_consulta(text) to authenticated;

notify pgrst, 'reload schema';
