'use client'

import { useState } from 'react'
import { formatMonto, formatDate, formatDateObj } from '@/lib/utils'
import { Search } from 'lucide-react'
import { getNextFridays, buildVencimientoSemanal } from '../reportes.utils'

const WEEK_COLORS = [
  { bg: 'bg-red-50',    border: 'border-red-500',    text: 'text-red-700',    label: 'text-red-500' },
  { bg: 'bg-orange-50', border: 'border-orange-400', text: 'text-orange-700', label: 'text-orange-500' },
  { bg: 'bg-yellow-50', border: 'border-yellow-400', text: 'text-yellow-700', label: 'text-yellow-600' },
  { bg: 'bg-green-50',  border: 'border-green-600',  text: 'text-green-700',  label: 'text-green-600' },
]

export interface VencimientoSemanalPresupuestosProps {
  presupuestos: any[]
  /** Fechas controladas (ej. las semanas de Gastos fijos). Si se omiten, usa los próximos 4 viernes. */
  weekDates?: string[]
  setWeekDates?: (dates: string[]) => void
}

export default function VencimientoSemanalPresupuestos({
  presupuestos, weekDates: weekDatesProp, setWeekDates: setWeekDatesProp,
}: VencimientoSemanalPresupuestosProps) {
  const [internalDates, setInternalDates] = useState<string[]>(() =>
    getNextFridays(4).map(d => d.toISOString().split('T')[0])
  )
  const presWeekDates = weekDatesProp ?? internalDates
  const setPresWeekDates = setWeekDatesProp ?? setInternalDates
  const [presSearch, setPresSearch] = useState('')
  const [presSemFilter, setPresSemFilter] = useState<string>('all')
  const [presNoPagaraSet, setPresNoPagaraSet] = useState<Set<number>>(new Set())

  const presWeekDateObjs = presWeekDates.map(d => new Date(d + 'T00:00:00'))
  const vencPresupuestos = buildVencimientoSemanal(presupuestos, presWeekDateObjs, 'fecha_pago')

  const presRows = vencPresupuestos.rows.filter((r: any) => {
    const matchSearch = !presSearch ||
      (r.clientes?.nombre || '').toLowerCase().includes(presSearch.toLowerCase()) ||
      String(r.numero_presupuesto).includes(presSearch)
    const matchSem = presSemFilter === 'all' || r.fridayIdx === parseInt(presSemFilter)
    return matchSearch && matchSem
  })

  // Agrupado por cliente para el vencimiento semanal (con subtotales por semana)
  const presGroups = (() => {
    const m = new Map<string, any[]>()
    presRows.forEach((r: any) => {
      const k = r.clientes?.nombre || '—'
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(r)
    })
    return Array.from(m.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([nombre, rows]) => ({
        nombre,
        rows,
        weekTotals: presWeekDateObjs.map((_, i) =>
          rows.filter((r: any) => r.fridayIdx === i).reduce((s: number, r: any) => s + (r.saldo ?? r.total ?? 0), 0)
        ),
        total: rows.reduce((s: number, r: any) => s + (r.saldo ?? r.total ?? 0), 0),
      }))
  })()

  const presTotProbable = presWeekDateObjs.map((_, i) =>
    vencPresupuestos.rows.filter((r: any) => r.fridayIdx === i && !presNoPagaraSet.has(r.id))
      .reduce((s: number, r: any) => s + (r.saldo ?? r.total ?? 0), 0)
  )
  const presTotNoPaga = presWeekDateObjs.map((_, i) =>
    vencPresupuestos.rows.filter((r: any) => r.fridayIdx === i && presNoPagaraSet.has(r.id))
      .reduce((s: number, r: any) => s + (r.saldo ?? r.total ?? 0), 0)
  )
  const presGrandProbable = presTotProbable.reduce((s, t) => s + t, 0)
  const presGrandNoPaga = presTotNoPaga.reduce((s, t) => s + t, 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-700">Vencimientos — próximas 4 semanas</p>
          <p className="text-xs text-gray-400 mt-0.5">{vencPresupuestos.rows.length} presupuestos pendientes</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input pl-8 text-sm py-1.5 max-w-[220px]" placeholder="Buscar cliente o #..."
              value={presSearch} onChange={e => setPresSearch(e.target.value)} />
          </div>
          <select value={presSemFilter} onChange={e => setPresSemFilter(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 bg-white focus:outline-none focus:border-gray-400">
            <option value="all">Todas las semanas</option>
            <option value="0">Semana 1</option>
            <option value="1">Semana 2</option>
            <option value="2">Semana 3</option>
            <option value="3">Semana 4</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
        {presWeekDateObjs.map((_, i) => {
          const c = WEEK_COLORS[i]
          const cnt = vencPresupuestos.rows.filter((r: any) => r.fridayIdx === i).length
          const noPaga = presTotNoPaga[i]
          return (
            <div key={i} className={`card p-4 border-t-4 ${c.bg} ${c.border}`}>
              <p className={`text-xs font-semibold uppercase tracking-wide ${c.label}`}>Semana {i + 1}</p>
              <input type="date" value={presWeekDates[i]}
                onChange={e => { const nd = [...presWeekDates]; nd[i] = e.target.value; setPresWeekDates(nd) }}
                className="text-xs text-gray-600 border border-gray-200 rounded px-1.5 py-0.5 mt-0.5 mb-2 w-full bg-white focus:outline-none focus:border-gray-400" />
              <p className={`text-lg font-bold ${c.text}`}>{formatMonto(presTotProbable[i])}</p>
              {noPaga > 0 && (
                <p className="text-[11px] text-red-500 mt-0.5">
                  No pagará: −{formatMonto(noPaga)} · bruto {formatMonto(vencPresupuestos.totals[i])}
                </p>
              )}
              <p className="text-xs text-gray-400 mt-1">{cnt} {cnt === 1 ? 'presupuesto' : 'presupuestos'}</p>
            </div>
          )
        })}
      </div>

      <div className="card p-4 bg-brand-50 border border-brand-200 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-brand-700">Total general vencido</span>
          <span className="text-2xl font-bold text-brand-900">{formatMonto(vencPresupuestos.grandTotal)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-green-600 font-medium">↳ Probable pago</span>
          <span className="text-sm font-bold text-green-700">{formatMonto(presGrandProbable)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-red-500 font-medium">↳ No pagará</span>
          <span className="text-sm font-bold text-red-600">{formatMonto(presGrandNoPaga)}</span>
        </div>
      </div>

      {vencPresupuestos.rows.length === 0 ? (
        <div className="card p-12 text-center text-gray-400">No hay presupuestos pendientes en las próximas 4 semanas</div>
      ) : (
        <div className="card overflow-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="border-b-2 border-gray-300 bg-gray-50">
                <th className="table-header text-left sticky left-0 bg-gray-50 z-10 min-w-[200px]">Cliente</th>
                <th className="table-header text-center min-w-[100px]">Nº Presupuesto</th>
                <th className="table-header text-center min-w-[110px]">Orden trabajo</th>
                <th className="table-header text-center min-w-[100px]">F. Presupuesto</th>
                <th className="table-header text-center min-w-[100px]">F. Vencimiento</th>
                {presWeekDateObjs.map((fri, i) => (
                  <th key={i} className="table-header text-right min-w-[120px]">
                    Sem {i + 1}<br />
                    <span className="font-normal text-[10px] opacity-80">{formatDateObj(fri).slice(0, 5)}</span>
                  </th>
                ))}
                <th className="table-header text-center min-w-[60px] text-[11px]">No<br />Pagará</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {presGroups.flatMap((g) => [
                <tr key={`h-${g.nombre}`} className="bg-gray-100 border-t-2 border-gray-300">
                  <td colSpan={5 + presWeekDateObjs.length + 1} className="table-cell sticky left-0 bg-gray-100 z-10 font-bold text-gray-800 text-sm">
                    {g.nombre}
                    <span className="text-xs font-normal text-gray-400"> · {g.rows.length} {g.rows.length === 1 ? 'presupuesto' : 'presupuestos'} · {formatMonto(g.total)}</span>
                  </td>
                </tr>,
                ...g.rows.map((p: any) => {
                  const isNoPaga = presNoPagaraSet.has(p.id)
                  return (
                    <tr key={p.id} className={`hover:bg-gray-50 transition-opacity ${isNoPaga ? 'opacity-50 bg-red-50/40' : ''}`}>
                      <td className={`table-cell sticky left-0 z-10 max-w-[220px] ${isNoPaga ? 'bg-red-50' : 'bg-white'}`}>
                        <span className="truncate block text-sm">{p.clientes?.nombre || '—'}</span>
                      </td>
                      <td className="table-cell text-center font-mono text-sm text-gray-500">#{p.numero_presupuesto}</td>
                      <td className="table-cell text-center text-sm text-gray-600">{p.orden_trabajo || '—'}</td>
                      <td className="table-cell text-center text-sm text-gray-400">{formatDate(p.fecha)}</td>
                      <td className="table-cell text-center text-sm font-semibold text-red-600">{formatDate(p.fecha_pago)}</td>
                      {presWeekDateObjs.map((_, i) => (
                        <td key={i} className="table-cell text-right text-sm">
                          {p.fridayIdx === i
                            ? (
                              <span className={i === 0 ? 'font-semibold text-red-600' : 'font-medium text-gray-700'}>
                                {formatMonto(p.saldo ?? p.total)}
                                {(p.monto_pagado || 0) > 0 && (
                                  <span className="block text-[10px] font-normal text-gray-400">abonado {formatMonto(p.monto_pagado)}</span>
                                )}
                              </span>
                            )
                            : <span className="text-gray-200">—</span>}
                        </td>
                      ))}
                      <td className="table-cell text-center">
                        <input type="checkbox" checked={isNoPaga}
                          onChange={e => { setPresNoPagaraSet(prev => { const next = new Set(prev); e.target.checked ? next.add(p.id) : next.delete(p.id); return next }) }}
                          className="w-4 h-4 accent-red-600 cursor-pointer" title="Marcar como No Pagará" />
                      </td>
                    </tr>
                  )
                }),
                <tr key={`s-${g.nombre}`} className="border-t border-gray-200 bg-gray-50 text-sm font-semibold">
                  <td colSpan={5} className="table-cell text-right sticky left-0 bg-gray-50 z-10 text-gray-500">Subtotal {g.nombre}</td>
                  {g.weekTotals.map((t, i) => (
                    <td key={i} className="table-cell text-right text-gray-700">{t > 0 ? formatMonto(t) : '—'}</td>
                  ))}
                  <td className="table-cell" />
                </tr>,
              ])}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-400 bg-gray-100 font-bold">
                <td colSpan={5} className="table-cell text-right sticky left-0 bg-gray-100 z-10 text-sm text-gray-600">TOTAL VENCIDO</td>
                {vencPresupuestos.totals.map((t, i) => (
                  <td key={i} className="table-cell text-right text-brand-800">{t > 0 ? formatMonto(t) : '—'}</td>
                ))}
                <td className="table-cell" />
              </tr>
              <tr className="bg-green-50 text-xs font-semibold">
                <td colSpan={5} className="table-cell text-right sticky left-0 bg-green-50 z-10 text-green-700">↳ Probable Pago</td>
                {presTotProbable.map((t, i) => (
                  <td key={i} className="table-cell text-right text-green-700">{t > 0 ? formatMonto(t) : '—'}</td>
                ))}
                <td className="table-cell" />
              </tr>
              <tr className="bg-red-50 text-xs font-semibold">
                <td colSpan={5} className="table-cell text-right sticky left-0 bg-red-50 z-10 text-red-600">↳ No Pagará</td>
                {presTotNoPaga.map((t, i) => (
                  <td key={i} className="table-cell text-right text-red-600">{t > 0 ? formatMonto(t) : '—'}</td>
                ))}
                <td className="table-cell" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {presSearch && presRows.length === 0 && (
        <p className="text-center text-gray-400 text-sm">Sin resultados para &quot;{presSearch}&quot;</p>
      )}
    </div>
  )
}
