/**
 * Servicio de importación del Libro de Ventas.
 *
 * Separa la lógica de negocio del componente React para:
 *   1. Permitir tests unitarios sobre lógica pura sin Supabase.
 *   2. Reutilizar en otras rutas o en scripts de línea de comandos.
 *
 * Flujo de dos fases (necesario porque los clientes nuevos no tienen ID hasta que se crean):
 *   Fase 1: identifyNewClientNames  → qué clientes hay que crear en DB
 *   [DB: upsert clientes + reload map]
 *   Fase 2: buildInsertBatch        → qué facturas insertar, con IDs ya resueltos
 *   [DB: insert facturas en chunks]
 *
 * La función de alto nivel importarLibroVentas() orquesta ambas fases.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { ExcelRow, ImportResult } from '@/types'

// ── Interfaces internas ───────────────────────────────────────────────────────

export interface FacturaInsert {
  numero_factura: number
  fecha: string
  cliente_id: string
  tipo_documento: string
  documento_afectado: number | null
  monto: number
  itbms: number
  total: number
  estado: 'pendiente'
}

export interface InsertBatchResult {
  facturasAInsertar: FacturaInsert[]
  duplicadas: number
  errores: string[]
}

// ── Lógica pura (sin Supabase — exportada para tests) ────────────────────────

/**
 * Fase 1: Identifica nombres de clientes que no existen en la DB.
 * Deduplica: si el mismo cliente nuevo aparece 10 veces en el archivo, solo cuenta 1.
 */
export function identifyNewClientNames(
  preview: ExcelRow[],
  clientesMap: Record<string, string>
): string[] {
  return Array.from(new Set(
    preview
      .filter(r => !clientesMap[r.nombre_cliente.toUpperCase()])
      .map(r => r.nombre_cliente)
  ))
}

/**
 * Fase 2: Construye el batch de facturas a insertar.
 * Debe llamarse DESPUÉS de que el clientesMap ya incluya los clientes nuevos.
 *
 * Deduplicación:
 *   - `existentes`: facturas ya en DB (cargadas al inicio del flujo)
 *   - `keysEnArchivo`: facturas duplicadas dentro del mismo archivo Excel
 *
 * La clave de deduplicación incluye tipo_documento para que una NC con el
 * mismo número que una factura no se considere duplicado.
 */
export function buildInsertBatch(
  preview: ExcelRow[],
  clientesMap: Record<string, string>,
  existentes: Set<string>
): InsertBatchResult {
  const facturasAInsertar: FacturaInsert[] = []
  const keysEnArchivo = new Set<string>()
  let duplicadas = 0
  const errores: string[] = []

  for (const row of preview) {
    const key = `${row.numero_factura}-${row.tipo_documento}`

    if (existentes.has(key) || keysEnArchivo.has(key)) {
      duplicadas++
      continue
    }
    keysEnArchivo.add(key)

    const clienteId = clientesMap[row.nombre_cliente.toUpperCase()]
    if (!clienteId) {
      // No debería ocurrir si identifyNewClientNames + upsert se ejecutaron antes
      errores.push(`Sin cliente para: ${row.nombre_cliente}`)
      continue
    }

    facturasAInsertar.push({
      numero_factura: row.numero_factura,
      fecha: row.fecha.toISOString().split('T')[0],
      cliente_id: clienteId,
      tipo_documento: row.tipo_documento,
      documento_afectado: row.documento_afectado,
      monto: row.neto,
      itbms: row.impuesto,
      total: row.total,
      estado: 'pendiente',
    })
  }

  return { facturasAInsertar, duplicadas, errores }
}

// ── Orquestador con Supabase ──────────────────────────────────────────────────

const CHUNK_SIZE = 200

/**
 * Importa el Libro de Ventas completo.
 * Devuelve result + error opcional para que el componente maneje el estado UI.
 */
export async function importarLibroVentas(
  supabase: SupabaseClient,
  preview: ExcelRow[]
): Promise<{ result: ImportResult; dbError?: string }> {
  const result: ImportResult = {
    total: preview.length,
    importadas: 0,
    duplicadas: 0,
    errores: [],
    clientes_creados: 0,
  }

  // 1. Cargar estado actual en paralelo (2 requests)
  const [{ data: clientesDB }, { data: facturasDB }] = await Promise.all([
    supabase.from('clientes').select('id, nombre'),
    supabase.from('facturas').select('numero_factura, tipo_documento'),
  ])

  const clientesMap: Record<string, string> = {}
  clientesDB?.forEach(c => { clientesMap[c.nombre.toUpperCase()] = c.id })

  const existentes = new Set(
    facturasDB?.map(f => `${f.numero_factura}-${f.tipo_documento}`) || []
  )

  // 2. Fase 1: identificar clientes nuevos
  const nuevosNombres = identifyNewClientNames(preview, clientesMap)

  // 3. Crear clientes nuevos (1 request de upsert + 1 reload)
  if (nuevosNombres.length > 0) {
    const { error: eClientes } = await supabase
      .from('clientes')
      .upsert(
        nuevosNombres.map(nombre => ({ nombre, dias_credito: 30 })),
        { onConflict: 'nombre', ignoreDuplicates: true }
      )
    if (eClientes) {
      return { result, dbError: 'Error creando clientes: ' + eClientes.message }
    }

    const { data: actualizados } = await supabase.from('clientes').select('id, nombre')
    actualizados?.forEach(c => { clientesMap[c.nombre.toUpperCase()] = c.id })
    result.clientes_creados = nuevosNombres.length
  }

  // 4. Fase 2: construir batch (clientesMap ya tiene todos los IDs)
  const { facturasAInsertar, duplicadas, errores } = buildInsertBatch(
    preview, clientesMap, existentes
  )
  result.duplicadas = duplicadas
  result.errores.push(...errores)

  // 5. Batch insert en chunks (evitar timeout Vercel 30s)
  for (let i = 0; i < facturasAInsertar.length; i += CHUNK_SIZE) {
    const chunk = facturasAInsertar.slice(i, i + CHUNK_SIZE)
    const { error: eBatch } = await supabase.from('facturas').insert(chunk)

    if (!eBatch) {
      result.importadas += chunk.length
    } else {
      // Fallback: individual para aislar qué fila falló (UNIQUE constraint inesperado)
      for (const fila of chunk) {
        const { error: eFila } = await supabase.from('facturas').insert(fila)
        if (eFila) {
          result.errores.push(`Error factura #${fila.numero_factura}: ${eFila.message}`)
        } else {
          result.importadas++
        }
      }
    }
  }

  return { result }
}
