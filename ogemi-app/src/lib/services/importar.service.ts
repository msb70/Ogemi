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

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convierte un Date a string 'YYYY-MM-DD' usando los componentes LOCALES.
 *
 * NO usar toISOString(): convierte a UTC y puede correr la fecha un día
 * según la zona horaria (ej. medianoche local en un servidor UTC). Como las
 * facturas guardan solo la fecha (sin hora), tomamos año/mes/día locales.
 */
export function toISODateLocal(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
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
      fecha: toISODateLocal(row.fecha),
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
    monto_ventas: 0,
    monto_notas_credito: 0,
    monto_neto: 0,
  }

  // Acumula montos de una factura insertada con éxito.
  const esNotaCredito = (f: FacturaInsert) => /CREDITO/i.test(f.tipo_documento)
  const acumularMonto = (f: FacturaInsert) => {
    if (esNotaCredito(f)) result.monto_notas_credito += f.total
    else result.monto_ventas += f.total
  }
  const redondear = (n: number) => Math.round(n * 100) / 100

  // 1. Cargar estado actual en paralelo. Las NC ahora viven en notas_credito,
  //    así que también cargamos las existentes para deduplicar.
  const [{ data: clientesDB }, { data: facturasDB }, { data: ncDB }] = await Promise.all([
    supabase.from('clientes').select('id, nombre'),
    supabase.from('facturas').select('numero_factura, tipo_documento'),
    supabase.from('notas_credito').select('cliente_id, fecha, total'),
  ])

  const clientesMap: Record<string, string> = {}
  clientesDB?.forEach(c => { clientesMap[c.nombre.toUpperCase()] = c.id })

  const existentes = new Set(
    facturasDB?.map(f => `${f.numero_factura}-${f.tipo_documento}`) || []
  )
  const ncKey = (clienteId: string, fecha: string, total: number) =>
    `${clienteId}|${fecha}|${Math.abs(total).toFixed(2)}`
  const ncExistentes = new Set(
    ncDB?.map(n => ncKey(n.cliente_id, n.fecha, Number(n.total))) || []
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

  // 5. Separar facturas reales de notas de crédito.
  //    Las NC ya NO se insertan en facturas: van a notas_credito (disponibles).
  const realFacturas = facturasAInsertar.filter(f => !esNotaCredito(f))
  const ncCandidatas = facturasAInsertar.filter(f => esNotaCredito(f))

  // 5a. Insertar facturas reales en chunks (evitar timeout Vercel 30s)
  for (let i = 0; i < realFacturas.length; i += CHUNK_SIZE) {
    const chunk = realFacturas.slice(i, i + CHUNK_SIZE)
    const { error: eBatch } = await supabase.from('facturas').insert(chunk)

    if (!eBatch) {
      result.importadas += chunk.length
      chunk.forEach(acumularMonto)
    } else {
      // Fallback: individual para aislar qué fila falló (UNIQUE constraint inesperado)
      for (const fila of chunk) {
        const { error: eFila } = await supabase.from('facturas').insert(fila)
        if (eFila) {
          result.errores.push(`Error factura #${fila.numero_factura}: ${eFila.message}`)
        } else {
          result.importadas++
          acumularMonto(fila)
        }
      }
    }
  }

  // 5b. Insertar NC en notas_credito (disponibles), deduplicando por cliente+fecha+monto.
  //     total es columna generada (monto+itbms), no se envía.
  const ncKeysEnLote = new Set<string>()
  const ncAInsertar = ncCandidatas
    .filter(f => {
      const k = ncKey(f.cliente_id, f.fecha, f.total)
      if (ncExistentes.has(k) || ncKeysEnLote.has(k)) { result.duplicadas++; return false }
      ncKeysEnLote.add(k)
      return true
    })
    .map(f => ({
      numero: `NC ${f.numero_factura}`,
      cliente_id: f.cliente_id,
      fecha: f.fecha,
      monto: Math.abs(f.monto),
      itbms: Math.abs(f.itbms),
      estado: 'disponible' as const,
      documento_afectado: f.documento_afectado,
      notas: f.documento_afectado != null
        ? `Importada del libro de ventas. Doc afectado #${f.documento_afectado}`
        : 'Importada del libro de ventas',
    }))

  for (let i = 0; i < ncAInsertar.length; i += CHUNK_SIZE) {
    const chunk = ncAInsertar.slice(i, i + CHUNK_SIZE)
    const { error: eNC } = await supabase.from('notas_credito').insert(chunk)
    if (!eNC) {
      result.importadas += chunk.length
      chunk.forEach(n => { result.monto_notas_credito += -(n.monto + n.itbms) })
    } else {
      for (const n of chunk) {
        const { error: eFila } = await supabase.from('notas_credito').insert(n)
        if (eFila) {
          result.errores.push(`Error NC ${n.numero}: ${eFila.message}`)
        } else {
          result.importadas++
          result.monto_notas_credito += -(n.monto + n.itbms)
        }
      }
    }
  }
  // 5c. Auto-aplicar las NC disponibles a su factura afectada (mismo cliente,
  //     saldo suficiente). Idempotente: también aplica NC de corridas previas
  //     que quedaron disponibles.
  result.ncs_aplicadas = 0
  const { data: autoNC, error: eAuto } = await supabase.rpc('auto_aplicar_ncs_disponibles')
  if (eAuto) {
    result.errores.push(`No se pudieron auto-aplicar las NC: ${eAuto.message}`)
  } else {
    result.ncs_aplicadas = (autoNC as { aplicadas?: number } | null)?.aplicadas || 0
  }

  // Redondear a 2 decimales para evitar ruido de coma flotante
  result.monto_ventas = redondear(result.monto_ventas)
  result.monto_notas_credito = redondear(result.monto_notas_credito)
  result.monto_neto = redondear(result.monto_ventas + result.monto_notas_credito)

  return { result }
}
