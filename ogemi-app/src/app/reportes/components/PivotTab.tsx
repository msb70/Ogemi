'use client'

import { useState } from 'react'
import { formatCurrency, formatDate, formatDateObj } from '@/lib/utils'
import { Search } from 'lucide-react'
import { CarteraVencida } from '@/types'
import {
  BUCKETS, TRAMO_COLORS_HEX,
  getNextFridays, buildVencimientoViernes, buildPivotAntiguedad,
} from '../reportes.utils'

type PivotSubTab = 'semanal' | 'antigüedad'

const WEEK_COLORS = [
  { bg: 'bg-red-50',    border: 'border-red-500',    text: 'text-red-700',    label: 'text-red-500' },
  { bg: 'bg-orange-50', border: 'border-orange-400', text: 'text-orange-700', label: 'text-orange-500' },
  { bg: 'bg-yellow-50', border: 'border-yellow-400', text: 'text-yellow-700', label: 'text-yellow-600' },
  { bg: 'bg-green-50',  border: 'border-green-600',  text: 'text-green-700',  label: 'text-green-600' },
]

export interface PivotTabProps {
  facturas: any[]
  cartera: CarteraVencida[]
  initialTab?: PivotSubTab
  hideTabs?: boolean
}

export default function PivotTab({ facturas, cartera, initialTab = 'semanal', hideTabs = false }: PivotTabProps) {
  const [pivotTab, setPivotTab] = useState<PivotSubTab>(initialTab)

  // Semanal state
  const [weekDates, setWeekDates] = useState<string[]>(() =>
    getNextFridays(4).map(d => d.toISOString().split('T')[0])
  )
  const [viernesSearch, setViernesSearch] = useState('')
  const [semanaFilter, setSemanaFilter] = useState<string>('all')
  const [noPagaraSet, setNoPagaraSet] = useState<Set<number>>(new Set())

  // Antigüedad expand state
  const [antExpandidos, setAntExpandidos] = useState<Record<string, boolean>>({})

  const weekDateObjs = weekDates.map(d => new Date(d + 'T00:00:00'))
  const vencViernes = buildVencimientoViernes(facturas, weekDateObjs)
  const pivotAnt = buildPivotAntiguedad(cartera)

  const viernesRows = vencViernes.rows.filter((r: any) => {
    const matchSearch = !viernesSearch ||
      (r.clientes?.nombre || '').toLowerCase().includes(viernesSearch.toLowerCase()) ||
      String(r.numero_factura).includes(viernesSearch)
    const matchSemana = semanaFilter === 'all' || r.fridayIdx === parseInt(semanaFilter)
    return matchSearch && matchSemana
  })

  const totProbable = weekDateObjs.map((_, i) =>
    vencViernes.rows.filter((r: any) => r.fridayIdx === i && !noPagaraSet.has(r.id))
      .reduce((s: number, r: any) => s + (r.total || 0), 0)
  )
  const totNoPaga = weekDateObjs.map((_, i) =>
    vencViernes.rows.filter((r: any) => r.fridayIdx === i && noPagaraSet.has(r.id))
      .reduce((s: number, r: any) => s + (r.total || 0), 0)
  )
  const grandProbable = totProbable.reduce((s, t) => s + t, 0)
  const grandNoPaga = totNoPaga.reduce((s, t) => s + t, 0)

  return (
    <div className={hideTabs ? 'space-y-4' : 'p-6 space-y-4'}>
      {!hideTabs && (
        <div className="flex gap-2 flex-wrap">
          {[
            { key: 'semanal',    label: 'Vencimientos por semana' },
            { key: 'antigüedad', label: 'Antigüedad de cartera' },
          ].map(s => (
            <button key={s.key} onClick={() => setPivotTab(s.key as PivotSubTab)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                pivotTab === s.key ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      {pivotTab === 'semanal' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-700">Vencimientos — próximas 4 semanas</p>
              <p className="text-xs text-gray-400 mt-0.5">{vencViernes.rows.length} facturas pendientes</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input className="input pl-8 text-sm py-1.5 max-w-[220px]" placeholder="Buscar cliente o #..."
                  value={viernesSearch} onChange={e => setViernesSearch(e.target.value)} />
              </div>
              <select value={semanaFilter} onChange={e => setSemanaFilter(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 bg-white focus:outline-none focus:border-gray-400">
                <option value="all">Todas las semanas</option>
                <option value="0">Semana 1</option>
                <option value="1">Semana 2</option>
                <option value="2">Semana 3</option>
                <option value="3">Semana 4</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3">
            {weekDateObjs.map((_, i) => {
              const c = WEEK_COLORS[i]
              const cnt = vencViernes.rows.filter((r: any) => r.fridayIdx === i).length
              return (
                <div key={i} className={`card p-4 border-t-4 ${c.bg} ${c.border}`}>
                  <p className={`text-xs font-semibold uppercase tracking-wide ${c.label}`}>Semana {i + 1}</p>
                  <input type="date" value={weekDates[i]}
                    onChange={e => { const nd = [...weekDates]; nd[i] = e.target.value; setWeekDates(nd) }}
                    className="text-xs text-gray-600 border border-gray-200 rounded px-1.5 py-0.5 mt-0.5 mb-2 w-full bg-white focus:outline-none focus:border-gray-400" />
                  <p className={`text-lg font-bold ${c.text}`}>{formatCurrency(vencViernes.totals[i])}</p>
                  <p className="text-xs text-gray-400 mt-1">{cnt} {cnt === 1 ? 'factura' : 'facturas'}</p>
                </div>
              )
            })}
          </div>

          <div className="card p-4 bg-brand-50 border border-brand-200 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-brand-700">Total general vencido</span>
              <span className="text-2xl font-bold text-brand-900">{formatCurrency(vencViernes.grandTotal)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-green-600 font-medium">↳ Probable pago</span>
              <span className="text-sm font-bold text-green-700">{formatCurrency(grandProbable)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-red-500 font-medium">↳ No pagará</span>
              <span className="text-sm font-bold text-red-600">{formatCurrency(grandNoPaga)}</span>
            </div>
          </div>

          {vencViernes.rows.length === 0 ? (
            <div className="card p-12 text-center text-gray-400">No hay facturas pendientes en las próximas 4 semanas</div>
          ) : (
            <div className="card overflow-auto">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="border-b-2 border-gray-300 bg-gray-50">
                    <th className="table-header text-left sticky left-0 bg-gray-50 z-10 min-w-[200px]">Cliente</th>
                    <th className="table-header text-center min-w-[90px]">Nº Factura</th>
                    <th className="table-header text-center min-w-[100px]">F. Factura</th>
                    <th className="table-header text-center min-w-[100px]">F. Vencimiento</th>
                    {weekDateObjs.map((fri, i) => (
                      <th key={i} className="table-header text-right min-w-[120px]">
                        Sem {i + 1}<br />
                        <span className="font-normal text-[10px] opacity-80">{formatDateObj(fri).slice(0, 5)}</span>
                      </th>
                    ))}
                    <th className="table-header text-center min-w-[60px] text-[11px]">No<br />Pagará</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {viernesRows.map((f: any) => {
                    const isNoPaga = noPagaraSet.has(f.id)
                    return (
                      <tr key={f.id} className={`hover:bg-gray-50 transition-opacity ${isNoPaga ? 'opacity-50 bg-red-50/40' : ''}`}>
                        <td className={`table-cell sticky left-0 z-10 max-w-[220px] ${isNoPaga ? 'bg-red-50' : 'bg-white'}`}>
                          <span className="truncate block text-sm">{f.clientes?.nombre || '—'}</span>
                        </td>
                        <td className="table-cell text-center font-mono text-sm text-gray-500">#{f.numero_factura}</td>
                        <td className="table-cell text-center text-sm text-gray-400">{formatDate(f.fecha)}</td>
                        <td className="table-cell text-center text-sm font-semibold text-red-600">{formatDate(f.fecha_pago)}</td>
                        {weekDateObjs.map((_, i) => (
                          <td key={i} className="table-cell text-right text-sm">
                            {f.fridayIdx === i
                              ? <span className={i === 0 ? 'font-semibold text-red-600' : 'font-medium text-gray-700'}>{formatCurrency(f.total)}</span>
                              : <span className="text-gray-200">—</span>}
                          </td>
                        ))}
                        <td className="table-cell text-center">
                          <input type="checkbox" checked={isNoPaga}
                            onChange={e => { setNoPagaraSet(prev => { const next = new Set(prev); e.target.checked ? next.add(f.id) : next.delete(f.id); return next }) }}
                            className="w-4 h-4 accent-red-600 cursor-pointer" title="Marcar como No Pagará" />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-400 bg-gray-100 font-bold">
                    <td colSpan={4} className="table-cell text-right sticky left-0 bg-gray-100 z-10 text-sm text-gray-600">TOTAL VENCIDO</td>
                    {vencViernes.totals.map((t, i) => (
                      <td key={i} className="table-cell text-right text-brand-800">{t > 0 ? formatCurrency(t) : '—'}</td>
                    ))}
                    <td className="table-cell" />
                  </tr>
                  <tr className="bg-green-50 text-xs font-semibold">
                    <td colSpan={4} className="table-cell text-right sticky left-0 bg-green-50 z-10 text-green-700">↳ Probable Pago</td>
                    {totProbable.map((t, i) => (
                      <td key={i} className="table-cell text-right text-green-700">{t > 0 ? formatCurrency(t) : '—'}</td>
                    ))}
                    <td className="table-cell" />
                  </tr>
                  <tr className="bg-red-50 text-xs font-semibold">
                    <td colSpan={4} className="table-cell text-right sticky left-0 bg-red-50 z-10 text-red-600">↳ No Pagará</td>
                    {totNoPaga.map((t, i) => (
                      <td key={i} className="table-cell text-right text-red-600">{t > 0 ? formatCurrency(t) : '—'}</td>
                    ))}
                    <td className="table-cell" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {viernesSearch && viernesRows.length === 0 && (
            <p className="text-center text-gray-400 text-sm">Sin resultados para &quot;{viernesSearch}&quot;</p>
          )}
        </div>
      )}

      {pivotTab === 'antigüedad' && (
        <div className="space-y-4">
          <div className="grid grid-cols-5 gap-3">
            {BUCKETS.map(bucket => {
              const total = pivotAnt.clientes.reduce((s: number, c: string) => s + (pivotAnt.data[c]?.[bucket.key] || 0), 0)
              return (
                <div key={bucket.key} className="card p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-3 h-3 rounded-full" style={{ background: TRAMO_COLORS_HEX[bucket.key] }} />
                    <span className="text-xs font-medium text-gray-600">{bucket.label}</span>
                  </div>
                  <p className="text-lg font-bold">{formatCurrency(total)}</p>
                </div>
              )
            })}
          </div>

          <div className="card p-4 bg-brand-50 border-brand-200">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-brand-700">Total cartera pendiente</span>
              <span className="text-2xl font-bold text-brand-800">
                {formatCurrency(cartera.reduce((s, c) => s + (c.saldo_pendiente ?? c.total), 0))}
              </span>
            </div>
          </div>

          {pivotAnt.clientes.length === 0 ? (
            <div className="card p-12 text-center text-gray-400">No hay cartera pendiente</div>
          ) : (
            <div className="card overflow-auto">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="border-b-2 border-gray-300 bg-gray-50">
                    <th className="table-header text-left sticky left-0 bg-gray-50 z-10 min-w-[220px]">Cliente / Factura</th>
                    {BUCKETS.map(b => (
                      <th key={b.key} className="table-header text-right min-w-[120px]">
                        <div className="flex items-center justify-end gap-1">
                          <div className="w-2 h-2 rounded-full" style={{ background: TRAMO_COLORS_HEX[b.key] }} />
                          {b.label}
                        </div>
                      </th>
                    ))}
                    <th className="table-header text-right min-w-[120px] bg-gray-100">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {pivotAnt.clientes.map((cliente: string) => {
                    const clienteTotal = BUCKETS.reduce((s, b) => s + (pivotAnt.data[cliente]?.[b.key] || 0), 0)
                    const expandido = antExpandidos[cliente] ?? false
                    return (
                      <>
                        <tr key={`c-${cliente}`}
                          className="border-b border-gray-200 bg-brand-50/30 hover:bg-brand-50 cursor-pointer"
                          onClick={() => setAntExpandidos(p => ({ ...p, [cliente]: !expandido }))}>
                          <td className="table-cell sticky left-0 bg-brand-50/30 z-10 font-semibold text-brand-800">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs transition-transform ${expandido ? 'rotate-90' : ''}`}>▶</span>
                              {cliente}
                            </div>
                          </td>
                          {BUCKETS.map(b => (
                            <td key={b.key} className="table-cell text-right font-semibold">
                              {(pivotAnt.data[cliente]?.[b.key] || 0) > 0 ? (
                                <span style={{ color: TRAMO_COLORS_HEX[b.key] }}>
                                  {formatCurrency(pivotAnt.data[cliente][b.key])}
                                </span>
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                            </td>
                          ))}
                          <td className="table-cell text-right font-bold text-brand-900 bg-brand-50">
                            {formatCurrency(clienteTotal)}
                          </td>
                        </tr>

                        {expandido && (pivotAnt.factByCliente[cliente] || []).map((c: any) => (
                          <tr key={`f-${c.id}`} className="border-b border-gray-100 bg-white hover:bg-gray-50">
                            <td className="table-cell sticky left-0 bg-white z-10 pl-10 text-sm">
                              <span className="font-mono text-gray-400 mr-2">#{c.numero_factura}</span>
                              <span className="text-gray-500">Vence: {formatDate(c.fecha_pago)}</span>
                            </td>
                            {BUCKETS.map(b => (
                              <td key={b.key} className="table-cell text-right text-sm">
                                {c.tramo === b.key ? (
                                  <span style={{ color: TRAMO_COLORS_HEX[b.key] }}>
                                    {formatCurrency(c.saldo_pendiente ?? c.total)}
                                  </span>
                                ) : (
                                  <span className="text-gray-200">—</span>
                                )}
                              </td>
                            ))}
                            <td className="table-cell text-right text-sm font-medium bg-brand-50/30">
                              {formatCurrency(c.saldo_pendiente ?? c.total)}
                            </td>
                          </tr>
                        ))}
                      </>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-400 bg-gray-100 font-bold">
                    <td className="table-cell sticky left-0 bg-gray-100 z-10">TOTAL</td>
                    {BUCKETS.map(b => {
                      const total = pivotAnt.clientes.reduce((s: number, c: string) => s + (pivotAnt.data[c]?.[b.key] || 0), 0)
                      return (
                        <td key={b.key} className="table-cell text-right" style={{ color: total > 0 ? TRAMO_COLORS_HEX[b.key] : '#d1d5db' }}>
                          {total > 0 ? formatCurrency(total) : '—'}
                        </td>
                      )
                    })}
                    <td className="table-cell text-right text-brand-900 bg-gray-200">
                      {formatCurrency(cartera.reduce((s, c) => s + (c.saldo_pendiente ?? c.total), 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
