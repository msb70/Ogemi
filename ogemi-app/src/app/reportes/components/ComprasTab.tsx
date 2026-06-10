'use client'

import { useState } from 'react'
import { formatCurrency, formatDate, formatDateObj } from '@/lib/utils'
import { Download, Search } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  TRAMOS, TRAMO_LABELS, TRAMO_COLORS_HEX,
  exportCSV, getNextFridays, buildVencimientoSemanal,
} from '../reportes.utils'
import FiltrosBar, { type FiltrosBarProps } from './FiltrosBar'

type ComprasSubTab = 'listado' | 'cxp' | 'porproveedor' | 'pormes' | 'semanal'

const WEEK_COLORS = [
  { bg: 'bg-red-50',    border: 'border-red-500',    text: 'text-red-700',    label: 'text-red-500' },
  { bg: 'bg-orange-50', border: 'border-orange-400', text: 'text-orange-700', label: 'text-orange-500' },
  { bg: 'bg-yellow-50', border: 'border-yellow-400', text: 'text-yellow-700', label: 'text-yellow-600' },
  { bg: 'bg-green-50',  border: 'border-green-600',  text: 'text-green-700',  label: 'text-green-600' },
]

interface ComprasTabProps extends FiltrosBarProps {
  comprasFiltradas: any[]
  cxp: any[]
  topProveedores: [string, number][]
  comprasPorMes: { mes: string; total: number; count: number }[]
  compras: any[]
}

export default function ComprasTab({
  comprasFiltradas, cxp, topProveedores, comprasPorMes, compras,
  search, setSearch, fechaDesde, setFechaDesde, fechaHasta, setFechaHasta,
}: ComprasTabProps) {
  const [comprasTab, setComprasTab] = useState<ComprasSubTab>('listado')
  const [compWeekDates, setCompWeekDates] = useState<string[]>(() =>
    getNextFridays(4).map(d => d.toISOString().split('T')[0])
  )
  const [compSearch, setCompSearch] = useState('')
  const [compSemFilter, setCompSemFilter] = useState<string>('all')
  const [compNoPagaraSet, setCompNoPagaraSet] = useState<Set<number>>(new Set())

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

  const compTotProbable = compWeekDateObjs.map((_, i) =>
    vencCompras.rows.filter((r: any) => r.fridayIdx === i && !compNoPagaraSet.has(r.id))
      .reduce((s: number, r: any) => s + (r.total || 0), 0)
  )
  const compTotNoPaga = compWeekDateObjs.map((_, i) =>
    vencCompras.rows.filter((r: any) => r.fridayIdx === i && compNoPagaraSet.has(r.id))
      .reduce((s: number, r: any) => s + (r.total || 0), 0)
  )
  const compGrandProbable = compTotProbable.reduce((s, t) => s + t, 0)
  const compGrandNoPaga = compTotNoPaga.reduce((s, t) => s + t, 0)

  return (
    <div className="p-6 space-y-4">
      <div className="flex gap-2 flex-wrap">
        {[
          { key: 'listado',      label: 'Listado' },
          { key: 'cxp',          label: 'Cuentas por pagar' },
          { key: 'porproveedor', label: 'Por proveedor' },
          { key: 'pormes',       label: 'Por período' },
          { key: 'semanal',      label: 'Vencimiento semanal' },
        ].map(s => (
          <button key={s.key} onClick={() => setComprasTab(s.key as ComprasSubTab)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              comprasTab === s.key ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-200 text-gray-600 hover:border-gray-300'
            }`}>
            {s.label}
          </button>
        ))}
      </div>

      {comprasTab === 'listado' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <FiltrosBar {...{ search, setSearch, fechaDesde, setFechaDesde, fechaHasta, setFechaHasta }} />
            <button className="btn-secondary flex items-center gap-2 text-sm py-1.5" onClick={() =>
              exportCSV(
                ['Fecha','Proveedor','Concepto','Referencia','Monto','ITBMS','Total','Estado','Vencimiento'],
                comprasFiltradas.map(c => [c.fecha, c.proveedores?.nombre, c.concepto, c.referencia, c.monto, c.itbms, c.total, c.estado, c.vencimiento]),
                `compras_${new Date().toISOString().split('T')[0]}.csv`
              )
            }>
              <Download size={14} />Exportar
            </button>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Total compras', val: comprasFiltradas.reduce((s, c) => s + (c.total || 0), 0), color: 'text-brand-700' },
              { label: 'Pagado', val: comprasFiltradas.filter(c => c.estado === 'pagada').reduce((s, c) => s + (c.total || 0), 0), color: 'text-green-600' },
              { label: 'Pendiente', val: comprasFiltradas.filter(c => c.estado === 'pendiente').reduce((s, c) => s + (c.total || 0), 0), color: 'text-orange-600' },
              { label: '# Compras', val: comprasFiltradas.length, color: 'text-gray-700', isCnt: true },
            ].map(s => (
              <div key={s.label} className="card p-3">
                <p className="text-xs text-gray-500">{s.label}</p>
                <p className={`text-lg font-bold ${s.color}`}>{(s as any).isCnt ? s.val : formatCurrency(s.val as number)}</p>
              </div>
            ))}
          </div>
          <div className="card overflow-hidden">
            <table className="w-full">
              <thead><tr className="border-b border-gray-200">
                <th className="table-header">Fecha</th>
                <th className="table-header">Proveedor</th>
                <th className="table-header">Concepto</th>
                <th className="table-header text-right">Monto</th>
                <th className="table-header text-right">ITBMS</th>
                <th className="table-header text-right">Total</th>
                <th className="table-header">Estado</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {comprasFiltradas.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-8 text-gray-400">Sin resultados</td></tr>
                ) : comprasFiltradas.slice(0, 200).map((c: any) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="table-cell text-sm">{formatDate(c.fecha)}</td>
                    <td className="table-cell font-medium">{c.proveedores?.nombre}</td>
                    <td className="table-cell text-sm text-gray-500 max-w-[150px]"><span className="truncate block">{c.concepto || '—'}</span></td>
                    <td className="table-cell text-right">{formatCurrency(c.monto)}</td>
                    <td className="table-cell text-right text-gray-400">{formatCurrency(c.itbms)}</td>
                    <td className="table-cell text-right font-semibold">{formatCurrency(c.total)}</td>
                    <td className="table-cell">
                      <span className={`badge ${c.estado === 'pagada' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                        {c.estado === 'pagada' ? 'Pagada' : 'Pendiente'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {comprasTab === 'cxp' && (
        <div className="space-y-4">
          <div className="grid grid-cols-5 gap-3">
            {TRAMOS.map(tramo => {
              const items = cxp.filter((c: any) => c.tramo === tramo)
              return (
                <div key={tramo} className="card p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-3 h-3 rounded-full" style={{ background: TRAMO_COLORS_HEX[tramo] }} />
                    <span className="text-xs font-medium text-gray-600">{TRAMO_LABELS[tramo]}</span>
                  </div>
                  <p className="text-lg font-bold">{formatCurrency(items.reduce((s: number, c: any) => s + c.total, 0))}</p>
                  <p className="text-xs text-gray-400">{items.length} compras</p>
                </div>
              )
            })}
          </div>
          <div className="card overflow-hidden">
            <table className="w-full">
              <thead><tr className="border-b border-gray-200">
                <th className="table-header">Proveedor</th>
                <th className="table-header">Concepto</th>
                <th className="table-header">Vencimiento</th>
                <th className="table-header text-right">Días</th>
                <th className="table-header text-right">Total</th>
                <th className="table-header">Tramo</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {cxp.map((c: any) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="table-cell font-medium">{c.proveedor}</td>
                    <td className="table-cell text-sm text-gray-500">{c.concepto || '—'}</td>
                    <td className="table-cell text-sm text-gray-400">{formatDate(c.vencimiento)}</td>
                    <td className="table-cell text-right">
                      <span className={c.dias_vencida > 0 ? 'text-red-600 font-medium' : 'text-green-600'}>
                        {c.dias_vencida > 0 ? `+${c.dias_vencida}` : c.dias_vencida}
                      </span>
                    </td>
                    <td className="table-cell text-right font-semibold">{formatCurrency(c.total)}</td>
                    <td className="table-cell">
                      <span className="badge text-xs" style={{ backgroundColor: TRAMO_COLORS_HEX[c.tramo] + '20', color: TRAMO_COLORS_HEX[c.tramo] }}>
                        {TRAMO_LABELS[c.tramo]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {comprasTab === 'porproveedor' && (
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Top proveedores</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={topProveedores.slice(0, 10).map(([n, v]) => ({ name: n.substring(0, 18), monto: v }))}
              layout="vertical" margin={{ left: 10, right: 30 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={130} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} />
              <Bar dataKey="monto" name="Compras" fill="#f97316" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {comprasTab === 'pormes' && (
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Compras mensuales</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={comprasPorMes} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} />
              <Bar dataKey="total" name="Compras" fill="#f97316" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {comprasTab === 'semanal' && (
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

          <div className="grid grid-cols-4 gap-3">
            {compWeekDateObjs.map((_, i) => {
              const c = WEEK_COLORS[i]
              const cnt = vencCompras.rows.filter((r: any) => r.fridayIdx === i).length
              return (
                <div key={i} className={`card p-4 border-t-4 ${c.bg} ${c.border}`}>
                  <p className={`text-xs font-semibold uppercase tracking-wide ${c.label}`}>Semana {i + 1}</p>
                  <input type="date" value={compWeekDates[i]}
                    onChange={e => { const nd = [...compWeekDates]; nd[i] = e.target.value; setCompWeekDates(nd) }}
                    className="text-xs text-gray-600 border border-gray-200 rounded px-1.5 py-0.5 mt-0.5 mb-2 w-full bg-white focus:outline-none focus:border-gray-400" />
                  <p className={`text-lg font-bold ${c.text}`}>{formatCurrency(vencCompras.totals[i])}</p>
                  <p className="text-xs text-gray-400 mt-1">{cnt} {cnt === 1 ? 'compra' : 'compras'}</p>
                </div>
              )
            })}
          </div>

          <div className="card p-4 bg-brand-50 border border-brand-200 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-brand-700">Total general vencido</span>
              <span className="text-2xl font-bold text-brand-900">{formatCurrency(vencCompras.grandTotal)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-green-600 font-medium">↳ Probable pago</span>
              <span className="text-sm font-bold text-green-700">{formatCurrency(compGrandProbable)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-red-500 font-medium">↳ No pagará</span>
              <span className="text-sm font-bold text-red-600">{formatCurrency(compGrandNoPaga)}</span>
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
                    <th className="table-header text-center min-w-[60px] text-[11px]">No<br />Pagará</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {compRows.map((c: any) => {
                    const isNoPaga = compNoPagaraSet.has(c.id)
                    return (
                      <tr key={c.id} className={`hover:bg-gray-50 transition-opacity ${isNoPaga ? 'opacity-50 bg-red-50/40' : ''}`}>
                        <td className={`table-cell sticky left-0 z-10 max-w-[180px] ${isNoPaga ? 'bg-red-50' : 'bg-white'}`}>
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
                              ? <span className={i === 0 ? 'font-semibold text-red-600' : 'font-medium text-gray-700'}>{formatCurrency(c.total)}</span>
                              : <span className="text-gray-200">—</span>}
                          </td>
                        ))}
                        <td className="table-cell text-center">
                          <input type="checkbox" checked={isNoPaga}
                            onChange={e => { setCompNoPagaraSet(prev => { const next = new Set(prev); e.target.checked ? next.add(c.id) : next.delete(c.id); return next }) }}
                            className="w-4 h-4 accent-red-600 cursor-pointer" title="Marcar como No Pagará" />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-400 bg-gray-100 font-bold">
                    <td colSpan={4} className="table-cell text-right sticky left-0 bg-gray-100 z-10 text-sm text-gray-600">TOTAL VENCIDO</td>
                    {vencCompras.totals.map((t, i) => (
                      <td key={i} className="table-cell text-right text-brand-800">{t > 0 ? formatCurrency(t) : '—'}</td>
                    ))}
                    <td className="table-cell" />
                  </tr>
                  <tr className="bg-green-50 text-xs font-semibold">
                    <td colSpan={4} className="table-cell text-right sticky left-0 bg-green-50 z-10 text-green-700">↳ Probable Pago</td>
                    {compTotProbable.map((t, i) => (
                      <td key={i} className="table-cell text-right text-green-700">{t > 0 ? formatCurrency(t) : '—'}</td>
                    ))}
                    <td className="table-cell" />
                  </tr>
                  <tr className="bg-red-50 text-xs font-semibold">
                    <td colSpan={4} className="table-cell text-right sticky left-0 bg-red-50 z-10 text-red-600">↳ No Pagará</td>
                    {compTotNoPaga.map((t, i) => (
                      <td key={i} className="table-cell text-right text-red-600">{t > 0 ? formatCurrency(t) : '—'}</td>
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
      )}
    </div>
  )
}
