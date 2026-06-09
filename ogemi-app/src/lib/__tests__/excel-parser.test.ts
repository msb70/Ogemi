/**
 * Tests para excel-parser.ts — lógica de parsing del Libro de Ventas Premium Soft
 *
 * Para ejecutar:
 *   npm test
 *
 * Estos tests documentan los casos edge del formato europeo (punto=miles, coma=decimal)
 * y sirven como red de seguridad contra regresiones en parseNumeroExcel y classifyTramo.
 */

import { parseNumeroExcel } from '../excel-parser'
import { classifyTramo } from '../utils'

// ── parseNumeroExcel ──────────────────────────────────────────────────────────

describe('parseNumeroExcel — formato europeo (punto=miles, coma=decimal)', () => {
  // Casos básicos
  test('valor pequeño sin miles: "373,10" → 373.10', () => {
    expect(parseNumeroExcel({ w: '373,10', v: 37310, t: 'n' })).toBeCloseTo(373.10, 2)
  })

  test('valor con miles: "1.836,00" → 1836.00', () => {
    expect(parseNumeroExcel({ w: '1.836,00', v: 1.836, t: 'n' })).toBeCloseTo(1836.00, 2)
  })

  test('valor con miles y decimales: "1.964,52" → 1964.52', () => {
    expect(parseNumeroExcel({ w: '1.964,52', v: 1.96452, t: 'n' })).toBeCloseTo(1964.52, 2)
  })

  // Casos edge que fallaban con la lógica anterior
  test('CASO CRÍTICO — mil redondo: "1.000,00" → 1000.00 (NO 0.01)', () => {
    // BUG anterior: cell.v=1.0, Number.isInteger(1.0)===true → 1.0/100 = 0.01
    expect(parseNumeroExcel({ w: '1.000,00', v: 1.0, t: 'n' })).toBeCloseTo(1000.00, 2)
  })

  test('CASO CRÍTICO — cinco mil: "5.000,00" → 5000.00 (NO 0.05)', () => {
    expect(parseNumeroExcel({ w: '5.000,00', v: 5.0, t: 'n' })).toBeCloseTo(5000.00, 2)
  })

  test('monto de decenas de miles: "12.500,75" → 12500.75', () => {
    expect(parseNumeroExcel({ w: '12.500,75', v: 12.50075, t: 'n' })).toBeCloseTo(12500.75, 2)
  })

  test('cero: "0,00" → 0', () => {
    expect(parseNumeroExcel({ w: '0,00', v: 0, t: 'n' })).toBe(0)
  })

  test('celda undefined → 0', () => {
    expect(parseNumeroExcel(undefined)).toBe(0)
  })

  test('celda sin w ni v → 0', () => {
    expect(parseNumeroExcel({ t: 'n' })).toBe(0)
  })

  // Fallback cuando cell.w no está disponible (SheetJS no provee w para celdas de fórmula)
  test('fallback a cell.v string cuando no hay cell.w', () => {
    expect(parseNumeroExcel({ v: '1.500,00', t: 's' })).toBeCloseTo(1500.00, 2)
  })

  // Limpieza de símbolos
  test('texto con símbolo $: "$373,10" → 373.10', () => {
    expect(parseNumeroExcel({ w: '$373,10', t: 's' })).toBeCloseTo(373.10, 2)
  })

  test('texto con espacios: " 373,10 " → 373.10', () => {
    expect(parseNumeroExcel({ w: ' 373,10 ', t: 's' })).toBeCloseTo(373.10, 2)
  })
})

// ── classifyTramo ─────────────────────────────────────────────────────────────

describe('classifyTramo — antigüedad de cartera', () => {
  test('al día (0 días) → corriente', () => expect(classifyTramo(0)).toBe('corriente'))
  test('vence mañana (-1 días) → corriente', () => expect(classifyTramo(-1)).toBe('corriente'))
  test('1 día vencida → 1-30', () => expect(classifyTramo(1)).toBe('1-30'))
  test('30 días → 1-30', () => expect(classifyTramo(30)).toBe('1-30'))
  test('31 días → 31-60', () => expect(classifyTramo(31)).toBe('31-60'))
  test('60 días → 31-60', () => expect(classifyTramo(60)).toBe('31-60'))
  test('61 días → 61-90', () => expect(classifyTramo(61)).toBe('61-90'))
  test('90 días → 61-90', () => expect(classifyTramo(90)).toBe('61-90'))
  // Bug corregido en Sprint 2: 91-120 días caían en '+120'
  test('CASO BUG — 91 días → 91-120 (NO +120)', () => expect(classifyTramo(91)).toBe('91-120'))
  test('100 días → 91-120', () => expect(classifyTramo(100)).toBe('91-120'))
  test('120 días → 91-120', () => expect(classifyTramo(120)).toBe('91-120'))
  test('121 días → +120', () => expect(classifyTramo(121)).toBe('+120'))
  test('200 días → +120', () => expect(classifyTramo(200)).toBe('+120'))
})
