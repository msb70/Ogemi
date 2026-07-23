/**
 * Constantes y funciones puras compartidas por todos los tabs de Reportes.
 *
 * Los reportes de antigüedad muestran 5 tramos: la columna de 120 días se
 * eliminó y todo lo mayor a 90 días se consolida en "Más de 90 días".
 * Las vistas de la BD (cartera_vencida, compras_vencidas, cartera_presupuestos)
 * siguen emitiendo 6 tramos ('91-120' y '+120'): usar normTramo() antes de
 * agrupar, comparar o etiquetar por tramo.
 */

import * as XLSX from 'xlsx'
import { CarteraVencida } from '@/types'
import { formatDateObj } from '@/lib/utils'
import { finalizeSheet } from '@/lib/xlsxHelpers'

// ── Constantes de tramos ──────────────────────────────────────────────────────

export const TRAMO_LABELS: Record<string, string> = {
  'corriente': 'Al día',
  '1-30':     '1–30 días',
  '31-60':    '31–60 días',
  '61-90':    '61–90 días',
  '+90':      'Más de 90 días',
}

export const TRAMO_COLORS_HEX: Record<string, string> = {
  'corriente': '#22c55e',
  '1-30':     '#facc15',
  '31-60':    '#fb923c',
  '61-90':    '#f87171',
  '+90':      '#b91c1c',
}

export const TRAMOS = ['corriente', '1-30', '31-60', '61-90', '+90'] as const

export type Tramo = typeof TRAMOS[number]

/** Normaliza el tramo de la BD (6 tramos) al tramo de UI (5 tramos, +90 consolidado) */
export const normTramo = (t: string): string => (t === '91-120' || t === '+120') ? '+90' : t

/** Para pivot de antigüedad — muestra columnas en orden */
export const BUCKETS: { key: Tramo; label: string }[] = [
  { key: 'corriente', label: 'Al día' },
  { key: '1-30',     label: '1–30 días' },
  { key: '31-60',    label: '31–60 días' },
  { key: '61-90',    label: '61–90 días' },
  { key: '+90',      label: 'Más de 90 días' },
]

export const PIE_COLORS = [
  '#0284c7','#7c3aed','#059669','#d97706',
  '#dc2626','#0891b2','#4f46e5','#16a34a','#ea580c','#6b7280',
]

// ── Helpers de clasificación ──────────────────────────────────────────────────

export function isNC(tipoDoc: string): boolean {
  const t = (tipoDoc || '').toUpperCase()
  return t.includes('NOTA') || t.includes('N/C') || t.includes('CREDITO')
}

// ── Export CSV ────────────────────────────────────────────────────────────────

export function exportCSV(headers: string[], rows: unknown[][], filename: string): void {
  const csv = [headers, ...rows]
    .map(r => r.map(v => `"${v ?? ''}"`).join(','))
    .join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
}

// ── Export XLSX (hoja de cálculo) ──────────────────────────────────────────────

type XlsxCell = string | number | null | undefined
export type XlsxSheet = { name: string; rows: XlsxCell[][] }

/**
 * Exporta un libro de Excel con una o más hojas.
 * Cada hoja es una matriz de filas (array de arrays).
 */
export function exportXLSX(filename: string, sheets: XlsxSheet[]): void {
  const wb = XLSX.utils.book_new()
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows.map(r => r.map(c => (c ?? ''))))
    finalizeSheet(ws)   // montos como número + auto-ancho de columnas
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31))
  }
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`)
}

/**
 * Exporta a Excel las tablas visibles dentro de un contenedor del DOM
 * (la vista de reporte activa). Cada <table> se convierte en una hoja.
 */
export function xlsxFromReporteArea(filename: string, scopeId = 'reporte-print'): boolean {
  if (typeof document === 'undefined') return false
  const area = document.getElementById(scopeId)
  if (!area) return false
  const tables = Array.from(area.querySelectorAll('table')) as HTMLTableElement[]
  if (tables.length === 0) return false
  const wb = XLSX.utils.book_new()
  tables.forEach((t, i) => {
    const ws = XLSX.utils.table_to_sheet(t, { raw: true })
    finalizeSheet(ws)   // convierte "US$..." a número sumable + auto-ancho
    XLSX.utils.book_append_sheet(wb, ws, `Tabla ${i + 1}`)
  })
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`)
  return true
}

/** Atajo: una hoja de KPIs (lista de [etiqueta, valor]) + una hoja de listado. */
export function buildKpiSheet(
  titulo: string,
  rango: string,
  kpis: [string, XlsxCell][],
): XlsxSheet {
  return {
    name: 'KPIs',
    rows: [
      ['Reporte', titulo],
      ['Rango', rango],
      ['Generado', new Date().toLocaleString('es-PA')],
      [],
      ['Indicador', 'Valor'],
      ...kpis.map(([k, v]) => [k, v] as XlsxCell[]),
    ],
  }
}

// ── Vencimiento semanal ───────────────────────────────────────────────────────

/** Devuelve los próximos `n` viernes desde hoy (inclusive el próximo si hoy no es viernes). */
export function getNextFridays(n = 4): Date[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(today)
  const dow = d.getDay()
  const daysToFri = dow === 5 ? 7 : (5 - dow + 7) % 7 || 7
  d.setDate(d.getDate() + daysToFri)
  const fridays: Date[] = []
  for (let i = 0; i < n; i++) {
    fridays.push(new Date(d))
    d.setDate(d.getDate() + 7)
  }
  return fridays
}

/**
 * Índice de semana para una fecha de vencimiento.
 * Regla: lo vencido ANTES de la fecha de corte cae en la primera semana cuya
 * fecha sea >= corte (la semana próxima), no en semanas ya pasadas. Si el corte
 * queda después de todas las semanas (períodos históricos), se mantiene la
 * asignación normal (primera semana >= vencimiento).
 */
function weekIdxFor(fd: Date, dates: Date[], cutoff?: Date): number {
  if (cutoff && fd < cutoff) {
    const idxNext = dates.findIndex(d => d >= cutoff)
    if (idxNext !== -1) return idxNext
  }
  return dates.findIndex(d => fd <= d)
}

/**
 * Agrupa facturas/presupuestos/compras por semana de vencimiento.
 * Cada fila expone `saldo` = total − monto_pagado (abonos parciales descontados);
 * los totales semanales suman el saldo, no el total bruto del documento.
 */
export function buildVencimientoSemanal(
  items: Record<string, unknown>[],
  dates: Date[],
  dateField: string,
  cutoff?: Date
): {
  rows: (Record<string, unknown> & { fridayIdx: number; saldo: number })[]
  totals: number[]
  grandTotal: number
} {
  const lastDate = dates[dates.length - 1]
  const rows: (Record<string, unknown> & { fridayIdx: number; saldo: number })[] = items
    .filter(item => {
      if (item.estado !== 'pendiente') return false
      const fd = item[dateField] ? new Date((item[dateField] as string) + 'T00:00:00') : null
      return fd !== null && fd <= lastDate
    })
    .map(item => {
      const fd = new Date((item[dateField] as string) + 'T00:00:00')
      const fridayIdx = weekIdxFor(fd, dates, cutoff)
      const saldo = ((item.total as number) || 0) - ((item.monto_pagado as number) || 0)
      return { ...item, fridayIdx, saldo }
    })
    .filter(r => r.saldo > 0)
    .sort((a, b) => (((a as Record<string, unknown>)[dateField] as string) < ((b as Record<string, unknown>)[dateField] as string) ? -1 : 1))

  const totals = dates.map((_, i) =>
    rows.filter(r => r.fridayIdx === i).reduce((s, r) => s + r.saldo, 0)
  )
  return { rows, totals, grandTotal: totals.reduce((s, t) => s + t, 0) }
}

/**
 * Variante específica para facturas (filtra también NC y saldo ≤ 0).
 * Cada fila expone `saldo` = total − retención − monto_pagado (lo que falta por
 * cobrar en efectivo); los totales semanales suman el saldo, no el total bruto.
 */
export function buildVencimientoViernes(
  facturas: Record<string, unknown>[],
  fridays: Date[],
  cutoff?: Date
): {
  rows: (Record<string, unknown> & { fridayIdx: number; saldo: number })[]
  totals: number[]
  grandTotal: number
} {
  const lastFriday = fridays[fridays.length - 1]
  const rows: (Record<string, unknown> & { fridayIdx: number; saldo: number })[] = facturas
    .filter(f => {
      if (f.estado !== 'pendiente' || isNC(f.tipo_documento as string)) return false
      const fp = f.fecha_pago ? new Date((f.fecha_pago as string) + 'T00:00:00') : null
      return fp !== null && fp <= lastFriday
    })
    .map((f): Record<string, unknown> & { fridayIdx: number; saldo: number } => {
      const fp = new Date((f.fecha_pago as string) + 'T00:00:00')
      const fridayIdx = weekIdxFor(fp, fridays, cutoff)
      const saldo = ((f.total as number) || 0)
        - ((f.retencion_monto as number) || 0)
        - ((f.monto_pagado as number) || 0)
      return { ...f, fridayIdx, saldo }
    })
    .filter(r => r.saldo > 0)
    .sort((a, b) => ((a.fecha_pago as string) < (b.fecha_pago as string) ? -1 : 1))

  const totals = fridays.map((_, i) =>
    rows.filter(r => r.fridayIdx === i).reduce((s, r) => s + r.saldo, 0)
  )
  return { rows, totals, grandTotal: totals.reduce((s, t) => s + t, 0) }
}

// ── Pivot semanal ─────────────────────────────────────────────────────────────

export function buildPivotSemanal(
  facturas: Record<string, unknown>[],
  fechaDesde: string,
  fechaHasta: string
): {
  clientes: string[]
  semanas: string[]
  data: Record<string, Record<string, number>>
  factByCliente: Record<string, Record<string, unknown>[]>
} {
  const desde = new Date(fechaDesde + 'T00:00:00')
  const hasta = new Date(fechaHasta + 'T00:00:00')
  const semanas: { label: string; start: Date; end: Date }[] = []
  const cur = new Date(desde)
  let semNum = 1
  while (cur <= hasta) {
    const start = new Date(cur)
    const end = new Date(cur)
    end.setDate(end.getDate() + 6)
    if (end > hasta) end.setTime(hasta.getTime())
    semanas.push({
      label: `Sem ${semNum} (${formatDateObj(start).slice(0, 5)}–${formatDateObj(end).slice(0, 5)})`,
      start, end,
    })
    cur.setDate(cur.getDate() + 7)
    semNum++
  }

  const pending = facturas.filter(f => {
    if (f.estado !== 'pendiente' || (f.total as number) <= 0 || isNC(f.tipo_documento as string)) return false
    const fp = f.fecha_pago ? new Date((f.fecha_pago as string) + 'T00:00:00') : null
    if (!fp) return false
    return fp >= desde && fp <= hasta
  })

  const clienteSet = new Set<string>()
  const data: Record<string, Record<string, number>> = {}
  const factByCliente: Record<string, Record<string, unknown>[]> = {}

  pending.forEach(f => {
    const cliente = (f.clientes as { nombre: string } | null)?.nombre || 'N/A'
    const fp = new Date((f.fecha_pago as string) + 'T00:00:00')
    clienteSet.add(cliente)
    if (!data[cliente]) data[cliente] = {}
    if (!factByCliente[cliente]) factByCliente[cliente] = []
    factByCliente[cliente].push(f)
    const semana = semanas.find(s => fp >= s.start && fp <= s.end)
    if (semana) {
      data[cliente][semana.label] = (data[cliente][semana.label] || 0) +
        ((f.total as number) - ((f.monto_pagado as number) || 0))
    }
  })

  return { clientes: Array.from(clienteSet).sort(), semanas: semanas.map(s => s.label), data, factByCliente }
}

// ── Pivot antigüedad ──────────────────────────────────────────────────────────

export function buildPivotAntiguedad(cartera: CarteraVencida[]): {
  clientes: string[]
  data: Record<string, Record<string, number>>
  factByCliente: Record<string, CarteraVencida[]>
} {
  const clienteSet = new Set<string>()
  const data: Record<string, Record<string, number>> = {}
  const factByCliente: Record<string, CarteraVencida[]> = {}

  cartera.forEach(c => {
    clienteSet.add(c.cliente)
    if (!data[c.cliente]) data[c.cliente] = {}
    if (!factByCliente[c.cliente]) factByCliente[c.cliente] = []
    factByCliente[c.cliente].push(c)
    const tramo = normTramo(c.tramo)
    data[c.cliente][tramo] = (data[c.cliente][tramo] || 0) + (c.saldo_pendiente ?? c.total)
  })

  return { clientes: Array.from(clienteSet).sort(), data, factByCliente }
}
