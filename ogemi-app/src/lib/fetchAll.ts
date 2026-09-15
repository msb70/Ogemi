/**
 * Supabase/PostgREST devuelve como máximo 1000 filas por consulta (max-rows) y NO avisa:
 * `.limit(5000)` tampoco lo supera. Cualquier lectura "de toda la tabla" que pase de 1000
 * filas pierde datos en silencio (pasó con `pagos` en el Informe diario, 2026-09-15).
 *
 * fetchAll() pagina con .range() hasta agotar. `build` debe devolver una consulta NUEVA en
 * cada llamada (los builders de supabase-js no son reutilizables). Se añade `.order('id')`
 * como desempate para que la paginación sea estable aunque la consulta ordene por fecha.
 */
type AnyQuery = any

export const FETCH_PAGE = 1000

export async function fetchAll<T = AnyQuery>(
  build: () => AnyQuery,
  opts: { pageSize?: number; idOrder?: boolean } = {},
): Promise<{ data: T[]; error: { message: string } | null }> {
  const size = opts.pageSize ?? FETCH_PAGE
  const out: T[] = []
  for (let from = 0; ; from += size) {
    let q = build()
    if (opts.idOrder !== false) q = q.order('id', { ascending: true })
    const { data, error } = await q.range(from, from + size - 1)
    if (error) return { data: out, error }
    out.push(...((data || []) as T[]))
    if (!data || data.length < size) break
  }
  return { data: out, error: null }
}
