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

export interface VencimientoSemanalComprasProps {
  compras: any[]
  /** Fechas controladas (ej. las semanas del Flujo de Pago). Si se omiten, usa los próximos 4 viernes. */
  weekDates?: string[]
  setWeekDates?: (dates: string[]) => void
  /** Marcas "Pagará" controladas (persistidas por el padre). Si se omiten, estado local. */
  pagaraSet?: Set<string>
  onTogglePagara?: (id: string, marked: boolean) => void
  onToggleManyPagara?: (ids: string[], marked: boolean) => void
}

/**
 * Vencimiento semanal de compras. A diferencia de ventas/presupuestos,
 * el check aquí es "Pagará": marcada = esta compra SÍ se pagará esa semana.
 */
export default function VencimientoSemanalCompras({
  compras, weekDates: weekDatesProp, setWeekDates: setWeekDatesProp,
  pagaraSet: pagaraProp, onTogglePagara, onToggleManyPagara,
}: VencimientoSemanalComprasProps) {
  const [internalDates, setInternalDates] = useState<string[]>(() =>
    getNextFridays(4).map(d => d.toISOString().split('T')[0])
  )
  const compWeekDates = weekDatesProp ?? internalDates
  const setCompWeekDates = setWeekDatesProp ?? setInternalDates
  const [compSearch, setCompSearch] = useState('')
  const [compSemFilter, setCompSemFilter] = useState<string>('all')
  const [internalPagara, setInternalPagara] = useState<Set<string>>(new Set())
  const pagaraSet = pagaraProp ?? internalPagara
  const togglePagara = (id: string, marked: boolean) => {
    if (onTogglePagara) { onTogglePagara(id, marked); return }
    setInternalPagara(prev => { const next = new Set(prev); marked ? next.add(id) : next.delete(id); return next })
  }

  const compWeekDateObjs = compWeekDates.map(d => new Date(d + 'T00:00:00'))
  const vencCompras = buildVencimientoSemanal(compras, compWeekDateObjs, 'vencimiento')

  const compRows = vencCompras.rows.filter((r: any) => {
    const matchSearch = !compSearch ||
      (r.proveedores?.nombre || '').toLowerCase().includes(compSearch.toLowerCase()) ||
      (r.concepto || '').toLowerCase().includes(compSearch.toLowerCase()) ||
      (r.referencia || '').toLowerCase().includes(compSearch.toLowerCase())
    const matchSem = compSemFilter === 'all' || r.fridayIdx === parseInt(compSemFilter)
    return matchSearch && matchSem
  })

  // Agrupado por proveedor para el vencimiento semanal (con subtotales por semana)
  const compGroups = (() => {
    const m = new Map<string, any[]>()
    compRows.forEach((r: any) => {
      const k = r.proveedores?.nombre || '—'
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(r)
    })
    return Array.from(m.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([nombre, rows]) => ({
        nombre,
        rows,
        weekTotals: compWeekDateObjs.map((_, i) =>
          rows.filter((r: any) => r.fridayIdx === i).reduce((s: number, r: any) => s + (r.saldo ?? r.total ?? 0), 0)
        ),
        total: rows.reduce((s: number, r: any) => s + (r.saldo ?? r.total ?? 0), 0),
      }))
  })()

  // Marcar/desmarcar todas las filas visibles (filtradas)
  const allMarked = compRows.length > 0 && compRows.every((r: any) => pagaraSet.has(r.id))
  const toggleAll = (marked: boolean) => {
    const ids = compRows.map((r: any) => r.id as string)
    if (onToggleManyPagara) { onToggleManyPagara(ids, marked); return }
    if (onTogglePagara) { ids.forEach(id => onTogglePagara(id, marked)); return }
    setInternalPagara(prev => {
      const next = new Set(prev)
      ids.forEach(id => marked ? next.add(id) : next.delete(id))
      return next
    })
  }

  // Check invertido: marcada = Pagará. Lo no marcado se considera "No pagará".
  const compTotPagara = compWeekDateObjs.map((_, i) =>
    vencCompras.rows.filter((r: any) => r.fridayIdx === i && pagaraSet.has(r.id))
      .reduce((s: number, r: any) => s + (r.saldo ?? r.total ?? 0), 0)
  )
  const compTotNoPaga = compWeekDateObjs.map((_, i) => (vencCompras.totals[i] || 0) - compTotPagara[i])
  const compGrandPagara = compTotPagara.reduce((s, t) => s + t, 0)
  const compGrandNoPaga = vencCompras.grandTotal - compGrandPagara

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-700">Vencimientos — próximas 4 semanas</p>
          <p className="text-xs text-gray-400 mt-0.5">{vencCompras.rows.length} compras pendientes</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input pl-8 text-sm py-1.5 max-w-[220px]" placeholder="Buscar proveedor o concepto..."
              value={compSearch} onChange={e => setCompSearch(e.target.value)} />
          </div>
          <select value={compSemFilter} onChange={e => setCompSemFilter(e.target.value)}
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
        {compWeekDateObjs.map((_, i) => {
          const c = WEEK_COLORS[i]
          const cnt = vencCompras.rows.filter((r: any) => r.fridayIdx === i).length
          const pagara = compTotPagara[i]
          return (
            <div key={i} className={`card p-4 border-t-4 ${c.bg} ${c.border}`}>
              <p className={`text-xs font-semibold uppercase tracking-wide ${c.label}`}>Semana {i + 1}</p>
              <input type="date" value={compWeekDates[i]}
                onChange={e => { const nd = [...compWeekDates]; nd[i] = e.target.value; setCompWeekDates(nd) }}
                className="text-xs text-gray-600 border border-gray-200 rounded px-1.5 py-0.5 mt-0.5 mb-2 w-full bg-white focus:outline-none focus:border-gray-400" />
              <p className={`text-lg font-bold ${c.text}`}>{formatMonto(vencCompras.totals[i])}</p>
              {pagara > 0 && (
                <p className="text-[11px] text-green-600 mt-0.5">
                  Pagará: {formatMonto(pagara)}
                </p>
              )}
              <p className="text-xs text-gray-400 mt-1">{cnt} {cnt === 1 ? 'compra' : 'compras'}</p>
            </div>
          )
        })}
      </div>

      <div className="card p-4 bg-brand-50 border border-brand-200 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-brand-700">Total general vencido</span>
          <span className="text-2xl font-bold text-brand-900">{formatMonto(vencCompras.grandTotal)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-green-600 font-medium">↳ Pagará (marcadas)</span>
          <span className="text-sm font-bold text-green-700">{formatMonto(compGrandPagara)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-red-500 font-medium">↳ No pagará (sin marcar)</span>
          <span className="text-sm font-bold text-red-600">{formatMonto(compGrandNoPaga)}</span>
        </div>
      </div>

      {vencCompras.rows.length === 0 ? (
        <div className="card p-12 text-center text-gray-400">No hay compras pendientes en las próximas 4 semanas</div>
      ) : (
        <div className="card overflow-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="border-b-2 border-gray-300 bg-gray-50">
                <th className="table-header text-left sticky left-0 bg-gray-50 z-10 min-w-[180px]">Proveedor</th>
                <th className="table-header text-center min-w-[140px]">Concepto</th>
                <th className="table-header text-center min-w-[100px]">F. Compra</th>
                <th className="table-header text-center min-w-[100px]">F. Vencimiento</th>
                {compWeekDateObjs.map((fri, i) => (
                  <th key={i} className="table-header text-right min-w-[120px]">
                    Sem {i + 1}<br />
                    <span className="font-normal text-[10px] opacity-80">{formatDateObj(fri).slice(0, 5)}</span>
                  </th>
                ))}
                <th className="table-header text-center min-w-[60px] text-[11px]">
                  <div className="flex flex-col items-center gap-1">
                    <span>Pagará</span>
                    <input type="checkbox" checked={allMarked}
                      onChange={e => toggleAll(e.target.checked)}
                      className="w-4 h-4 accent-green-600 cursor-pointer"
                      title="Marcar/desmarcar todas como Pagará" />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {compGroups.flatMap((g) => [
                <tr key={`h-${g.nombre}`} className="bg-gray-100 border-t-2 border-gray-300">
                  <td colSpan={4 + compWeekDateObjs.length + 1} className="table-cell sticky left-0 bg-gray-100 z-10 font-bold text-gray-800 text-sm">
                    {g.nombre}
                    <span className="text-xs font-normal text-gray-400"> · {g.rows.length} {g.rows.length === 1 ? 'compra' : 'compras'} · {formatMonto(g.total)}</span>
                  </td>
                </tr>,
                ...g.rows.map((c: any) => {
                  const isPagara = pagaraSet.has(c.id)
                  return (
                    <tr key={c.id} className={`hover:bg-gray-50 transition-colors ${isPagara ? 'bg-green-50/50' : ''}`}>
                      <td className={`table-cell sticky left-0 z-10 max-w-[180px] ${isPagara ? 'bg-green-50' : 'bg-white'}`}>
                        <span className="truncate block text-sm font-medium">{c.proveedores?.nombre || '—'}</span>
                      </td>
                      <td className="table-cell text-center text-sm text-gray-500 max-w-[140px]">
                        <span className="truncate block">{c.concepto || c.referencia || '—'}</span>
                      </td>
                      <td className="table-cell text-center text-sm text-gray-400">{formatDate(c.fecha)}</td>
                      <td className="table-cell text-center text-sm font-semibold text-red-600">{formatDate(c.vencimiento)}</td>
                      {compWeekDateObjs.map((_, i) => (
                        <td key={i} className="table-cell text-right text-sm">
                          {c.fridayIdx === i
                            ? (
                              <span className={i === 0 ? 'font-semibold text-red-600' : 'font-medium text-gray-700'}>
                                {formatMonto(c.saldo ?? c.total)}
                                {(c.monto_pagado || 0) > 0 && (
                                  <span className="block text-[10px] font-normal text-gray-400">abonado {formatMonto(c.monto_pagado)}</span>
                                )}
                              </span>
                            )
                            : <span className="text-gray-200">—</span>}
                        </td>
                      ))}
                      <td className="table-cell text-center">
                        <input type="checkbox" checked={isPagara}
                          onChange={e => togglePagara(c.id, e.target.checked)}
                          className="w-4 h-4 accent-green-600 cursor-pointer" title="Marcar como Pagará" />
                      </td>
                    </tr>
                  )
                }),
                <tr key={`s-${g.nombre}`} className="border-t border-gray-200 bg-gray-50 text-sm font-semibold">
                  <td colSpan={4} className="table-cell text-right sticky left-0 bg-gray-50 z-10 text-gray-500">Subtotal {g.nombre}</td>
                  {g.weekTotals.map((t, i) => (
                    <td key={i} className="table-cell text-right text-gray-700">{t > 0 ? formatMonto(t) : '—'}</td>
                  ))}
                  <td className="table-cell" />
                </tr>,
              ])}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-400 bg-gray-100 font-bold">
                <td colSpan={4} className="table-cell text-right sticky left-0 bg-gray-100 z-10 text-sm text-gray-600">TOTAL VENCIDO</td>
                {vencCompras.totals.map((t, i) => (
                  <td key={i} className="table-cell text-right text-brand-800">{t > 0 ? formatMonto(t) : '—'}</td>
                ))}
                <td className="table-cell" />
              </tr>
              <tr className="bg-green-50 text-xs font-semibold">
                <td colSpan={4} className="table-cell text-right sticky left-0 bg-green-50 z-10 text-green-700">↳ Pagará</td>
                {compTotPagara.map((t, i) => (
                  <td key={i} className="table-cell text-right text-green-700">{t > 0 ? formatMonto(t) : '—'}</td>
                ))}
                <td className="table-cell" />
              </tr>
              <tr className="bg-red-50 text-xs font-semibold">
                <td colSpan={4} className="table-cell text-right sticky left-0 bg-red-50 z-10 text-red-600">↳ No pagará</td>
                {compTotNoPaga.map((t, i) => (
                  <td key={i} className="table-cell text-right text-red-600">{t > 0 ? formatMonto(t) : '—'}</td>
                ))}
                <td className="table-cell" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {compSearch && compRows.length === 0 && (
        <p className="text-center text-gray-400 text-sm">Sin resultados para &quot;{compSearch}&quot;</p>
      )}
    </div>
  )
}
