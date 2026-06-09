/**
 * Constantes y funciones puras compartidas por todos los tabs de Reportes.
 *
 * BUG CORREGIDO (Sprint 2 en compras/page.tsx, ahora en reportes):
 *   '91-120' estaba ausente en TRAMO_LABELS, TRAMO_COLORS_HEX, TRAMOS y BUCKETS.
 *   Facturas de 91-120 días vencidas se mostraban sin etiqueta y sin color.
 */

import { CarteraVencida } from '@/types'
import { formatDateObj } from '@/lib/utils'

// ── Constantes de tramos ──────────────────────────────────────────────────────

export const TRAMO_LABELS: Record<string, string> = {
  'corriente': 'Al día',
  '1-30':     '1–30 días',
  '31-60':    '31–60 días',
  '61-90':    '61–90 días',
  '91-120':   '91–120 días',   // ← BUG FIX: faltaba esta entrada
  '+120':     '+120 días',
}

export const TRAMO_COLORS_HEX: Record<string, string> = {
  'corriente': '#22c55e',
  '1-30':     '#facc15',
  '31-60':    '#fb923c',
  '61-90':    '#f87171',
  '91-120':   '#ef4444',       // ← BUG FIX: faltaba esta entrada
  '+120':     '#b91c1c',
}

export const TRAMOS = ['corriente', '1-30', '31-60', '61-90', '91-120', '+120'] as const

export type Tramo = typeof TRAMOS[number]

/** Para pivot de antigüedad — muestra columnas en orden */
export const BUCKETS: { key: Tramo; label: string }[] = [
  { key: 'corriente', label: 'Al día' },
  { key: '1-30',     label: '1–30 días' },
  { key: '31-60',    label: '31–60 días' },
  { key: '61-90',    label: '61–90 días' },
  { key: '91-120',   label: '91–120 días' },  // ← BUG FIX: faltaba esta entrada
  { key: '+120',     label: '+120 días' },
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

/** Agrupa facturas/presupuestos/compras por semana de vencimiento. */
export function buildVencimientoSemanal(
  items: Record<string, unknown>[],
  dates: Date[],
  dateField: string
): {
  rows: (Record<string, unknown> & { fridayIdx: number })[]
  totals: number[]
  grandTotal: number
} {
  const lastDate = dates[dates.length - 1]
  const rows: (Record<string, unknown> & { fridayIdx: number })[] = items
    .filter(item => {
      if (item.estado !== 'pendiente') return false
      const fd = item[dateField] ? new Date((item[dateField] as string) + 'T00:00:00') : null
      return fd !== null && fd <= lastDate
    })
    .map(item => {
      const fd = new Date((item[dateField] as string) + 'T00:00:00')
      const fridayIdx = dates.findIndex(d => fd <= d)
      return { ...item, fridayIdx }
    })
    .sort((a, b) => (((a as Record<string, unknown>)[dateField] as string) < ((b as Record<string, unknown>)[dateField] as string) ? -1 : 1))

  const totals = dates.map((_, i) =>
    rows.filter(r => r.fridayIdx === i).reduce((s, r) => s + ((r.total as number) || 0), 0)
  )
  return { rows, totals, grandTotal: totals.reduce((s, t) => s + t, 0) }
}

/** Variante específica para facturas (filtra también NC y total ≤ 0). */
export function buildVencimientoViernes(
  facturas: Record<string, unknown>[],
  fridays: Date[]
): {
  rows: (Record<string, unknown> & { fridayIdx: number })[]
  totals: number[]
  grandTotal: number
} {
  const lastFriday = fridays[fridays.length - 1]
  const rows: (Record<string, unknown> & { fridayIdx: number })[] = facturas
    .filter(f => {
      if (f.estado !== 'pendiente' || isNC(f.tipo_documento as string)) return false
      const fp = f.fecha_pago ? new Date((f.fecha_pago as string) + 'T00:00:00') : null
      return fp !== null && fp <= lastFriday
    })
    .map((f): Record<string, unknown> & { fridayIdx: number } => {
      const fp = new Date((f.fecha_pago as string) + 'T00:00:00')
      const fridayIdx = fridays.findIndex(fri => fp <= fri)
      return { ...f, fridayIdx }
    })
    .sort((a, b) => ((a.fecha_pago as string) < (b.fecha_pago as string) ? -1 : 1))

  const totals = fridays.map((_, i) =>
    rows.filter(r => r.fridayIdx === i).reduce((s, r) => s + ((r.total as number) || 0), 0)
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
    data[c.cliente][c.tramo] = (data[c.cliente][c.tramo] || 0) + (c.saldo_pendiente ?? c.total)
  })

  return { clientes: Array.from(clienteSet).sort(), data, factByCliente }
}
