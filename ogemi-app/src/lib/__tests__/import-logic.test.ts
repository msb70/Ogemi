/**
 * Tests para la lógica pura de importación.
 * Importa directamente del servicio — si la lógica cambia, los tests lo detectan.
 *
 * IMPORTANTE — qué NO testeamos aquí:
 *   No testeamos las llamadas a Supabase porque los mocks no detectan
 *   incompatibilidades de schema. Tests reales de integración requieren
 *   `supabase start` (Supabase local). Ver supabase/migrations/README.md.
 *
 * Qué SÍ testeamos:
 *   - identifyNewClientNames: clientes nuevos vs. existentes, deduplicación
 *   - buildInsertBatch: deduplicación contra DB, deduplicación intra-archivo,
 *     mapeo de campos, comportamiento ante NC con mismo número que factura
 *   - chunk: segmentación correcta para batch inserts de 200
 */

import { identifyNewClientNames, buildInsertBatch } from '../services/importar.service'
import { ExcelRow } from '../../types'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<ExcelRow> = {}): ExcelRow {
  return {
    fecha: new Date('2024-01-15'),
    tipo_documento: 'FACTURA DE OPERACION INTERNA',
    numero_factura: 1001,
    documento_afectado: null,
    nombre_cliente: 'CLIENTE SA',
    neto: 100,
    impuesto: 7,
    total: 107,
    ...overrides,
  }
}

// ── identifyNewClientNames ────────────────────────────────────────────────────

describe('identifyNewClientNames', () => {
  test('cliente nuevo → aparece en el resultado', () => {
    const preview = [makeRow({ nombre_cliente: 'NUEVO CLIENTE SRL' })]
    const clientesMap: Record<string, string> = {}

    expect(identifyNewClientNames(preview, clientesMap)).toContain('NUEVO CLIENTE SRL')
  })

  test('cliente ya existente → no está en el resultado', () => {
    const preview = [makeRow({ nombre_cliente: 'CLIENTE SA' })]
    const clientesMap = { 'CLIENTE SA': 'uuid-existente' }

    expect(identifyNewClientNames(preview, clientesMap)).toHaveLength(0)
  })

  test('mismo cliente nuevo 3 veces en archivo → se deduplica a 1', () => {
    const preview = [
      makeRow({ numero_factura: 1001, nombre_cliente: 'NUEVO SA' }),
      makeRow({ numero_factura: 1002, nombre_cliente: 'NUEVO SA' }),
      makeRow({ numero_factura: 1003, nombre_cliente: 'NUEVO SA' }),
    ]
    const result = identifyNewClientNames(preview, {})

    expect(result).toHaveLength(1)
    expect(result[0]).toBe('NUEVO SA')
  })

  test('mix de clientes nuevos y existentes → solo devuelve los nuevos', () => {
    const preview = [
      makeRow({ numero_factura: 1001, nombre_cliente: 'CLIENTE SA' }),
      makeRow({ numero_factura: 1002, nombre_cliente: 'NUEVO SA' }),
    ]
    const clientesMap = { 'CLIENTE SA': 'uuid-1' }

    const result = identifyNewClientNames(preview, clientesMap)
    expect(result).toEqual(['NUEVO SA'])
  })
})

// ── buildInsertBatch — deduplicación ─────────────────────────────────────────

describe('buildInsertBatch — deduplicación', () => {
  test('factura ya existente en DB → duplicada, no se inserta', () => {
    const preview = [makeRow({ numero_factura: 1001 })]
    const existentes = new Set(['1001-FACTURA DE OPERACION INTERNA'])
    const clientesMap = { 'CLIENTE SA': 'uuid-1' }

    const { duplicadas, facturasAInsertar } = buildInsertBatch(preview, clientesMap, existentes)

    expect(duplicadas).toBe(1)
    expect(facturasAInsertar).toHaveLength(0)
  })

  test('mismo número de factura dos veces en el archivo → segunda es duplicada', () => {
    const preview = [
      makeRow({ numero_factura: 1001 }),
      makeRow({ numero_factura: 1001 }),
    ]
    const clientesMap = { 'CLIENTE SA': 'uuid-1' }

    const { duplicadas, facturasAInsertar } = buildInsertBatch(preview, clientesMap, new Set())

    expect(duplicadas).toBe(1)
    expect(facturasAInsertar).toHaveLength(1)
  })

  test('factura en DB + otra nueva → 1 duplicada, 1 a insertar', () => {
    const preview = [
      makeRow({ numero_factura: 1001 }),
      makeRow({ numero_factura: 1002 }),
    ]
    const existentes = new Set(['1001-FACTURA DE OPERACION INTERNA'])
    const clientesMap = { 'CLIENTE SA': 'uuid-1' }

    const { duplicadas, facturasAInsertar } = buildInsertBatch(preview, clientesMap, existentes)

    expect(duplicadas).toBe(1)
    expect(facturasAInsertar).toHaveLength(1)
    expect(facturasAInsertar[0].numero_factura).toBe(1002)
  })

  test('NC con mismo número que factura → no es duplicado (clave incluye tipo_documento)', () => {
    const preview = [
      makeRow({ numero_factura: 1001, tipo_documento: 'FACTURA DE OPERACION INTERNA' }),
      makeRow({ numero_factura: 1001, tipo_documento: 'NOTA DE CREDITO' }),
    ]
    const clientesMap = { 'CLIENTE SA': 'uuid-1' }

    const { duplicadas, facturasAInsertar } = buildInsertBatch(preview, clientesMap, new Set())

    expect(duplicadas).toBe(0)
    expect(facturasAInsertar).toHaveLength(2)
  })
})

// ── buildInsertBatch — clientes no resueltos ──────────────────────────────────

describe('buildInsertBatch — cliente sin ID en map', () => {
  test('cliente ausente del map → va a errores, no a facturasAInsertar', () => {
    // Esto no debería ocurrir si el servicio ejecutó identifyNewClientNames + upsert antes,
    // pero se testa para documentar el comportamiento defensivo.
    const preview = [makeRow({ nombre_cliente: 'FANTASMA SA' })]
    const clientesMap: Record<string, string> = {}

    const { errores, facturasAInsertar } = buildInsertBatch(preview, clientesMap, new Set())

    expect(errores).toHaveLength(1)
    expect(errores[0]).toContain('FANTASMA SA')
    expect(facturasAInsertar).toHaveLength(0)
  })
})

// ── buildInsertBatch — construcción de campos ─────────────────────────────────

describe('buildInsertBatch — mapeo de campos', () => {
  test('fecha se formatea como YYYY-MM-DD', () => {
    const preview = [makeRow({ fecha: new Date('2024-03-15') })]
    const clientesMap = { 'CLIENTE SA': 'uuid-1' }

    const { facturasAInsertar } = buildInsertBatch(preview, clientesMap, new Set())

    expect(facturasAInsertar[0].fecha).toBe('2024-03-15')
  })

  test('neto→monto, impuesto→itbms mapeados correctamente', () => {
    const preview = [makeRow({ neto: 500, impuesto: 35, total: 535 })]
    const clientesMap = { 'CLIENTE SA': 'uuid-1' }

    const { facturasAInsertar } = buildInsertBatch(preview, clientesMap, new Set())

    expect(facturasAInsertar[0].monto).toBe(500)
    expect(facturasAInsertar[0].itbms).toBe(35)
    expect(facturasAInsertar[0].total).toBe(535)
    expect(facturasAInsertar[0].estado).toBe('pendiente')
  })

  test('total = 0 con cliente existente → se incluye (NC pueden tener total 0)', () => {
    const preview = [makeRow({ total: 0, tipo_documento: 'NOTA DE CREDITO' })]
    const clientesMap = { 'CLIENTE SA': 'uuid-1' }

    const { facturasAInsertar } = buildInsertBatch(preview, clientesMap, new Set())

    expect(facturasAInsertar).toHaveLength(1)
  })
})

// ── chunk — lógica de segmentación ───────────────────────────────────────────
// Nota: chunk está embebida en el servicio (no exportada) por ser trivial.
// Se testa aquí con la implementación local para documentar el comportamiento esperado.

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size))
  return chunks
}

describe('chunk — segmentación para batch inserts de 200', () => {
  test('array vacío → array vacío', () => {
    expect(chunk([], 200)).toEqual([])
  })

  test('200 elementos → 1 chunk exacto', () => {
    expect(chunk(Array.from({ length: 200 }), 200)).toHaveLength(1)
  })

  test('201 elementos → 2 chunks (200 + 1)', () => {
    const chunks = chunk(Array.from({ length: 201 }), 200)
    expect(chunks).toHaveLength(2)
    expect(chunks[1]).toHaveLength(1)
  })

  test('500 elementos → 3 chunks (200 + 200 + 100)', () => {
    const chunks = chunk(Array.from({ length: 500 }), 200)
    expect(chunks).toHaveLength(3)
    expect(chunks[2]).toHaveLength(100)
  })

  test('todos los elementos están presentes', () => {
    const arr = Array.from({ length: 450 }, (_, i) => i)
    expect(chunk(arr, 200).flat()).toEqual(arr)
  })
})
