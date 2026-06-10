'use client'

import { useState } from 'react'
import { formatCurrency, formatDate, formatDateObj, tramoColor } from '@/lib/utils'
import { Download, Search } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts'
import {
  TRAMOS, TRAMO_LABELS, TRAMO_COLORS_HEX, PIE_COLORS,
  exportCSV, getNextFridays, buildVencimientoSemanal,
} from '../reportes.utils'
import FiltrosBar, { type FiltrosBarProps } from './FiltrosBar'

type PresupuestosSubTab = 'listado' | 'cartera' | 'porcliente' | 'pormes' | 'semanal'

const WEEK_COLORS = [
  { bg: 'bg-red-50',    border: 'border-red-500',    text: 'text-red-700',    label: 'text-red-500' },
  { bg: 'bg-orange-50', border: 'border-orange-400', text: 'text-orange-700', label: 'text-orange-500' },
  { bg: 'bg-yellow-50', border: 'border-yellow-400', text: 'text-yellow-700', label: 'text-yellow-600' },
  { bg: 'bg-green-50',  border: 'border-green-600',  text: 'text-green-700',  label: 'text-green-600' },
]

interface PresupuestosTabProps extends FiltrosBarProps {
  presupuestosFiltrados: any[]
  carteraPresupuestos: any[]
  topClientesPresupuestos: [string, number][]
  presupuestosPorMes: { mes: string; total: number; count: number }[]
  presupuestos: any[]
}

export default function PresupuestosTab({
  presupuestosFiltrados, carteraPresupuestos, topClientesPresupuestos, presupuestosPorMes, presupuestos,
  search, setSearch, fechaDesde, setFechaDesde, fechaHasta, setFechaHasta,
}: PresupuestosTabProps) {
  const [presupuestosTab, setPresupuestosTab] = useState<PresupuestosSubTab>('listado')
  const [presWeekDates, setPresWeekDates] = useState<string[]>(() =>
    getNextFridays(4).map(d => d.toISOString().split('T')[0])
  )
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

  const presTotProbable = presWeekDateObjs.map((_, i) =>
    vencPresupuestos.rows.filter((r: any) => r.fridayIdx === i && !presNoPagaraSet.has(r.id))
      .reduce((s: number, r: any) => s + (r.total || 0), 0)
  )
  const presTotNoPaga = presWeekDateObjs.map((_, i) =>
    vencPresupuestos.rows.filter((r: any) => r.fridayIdx === i && presNoPagaraSet.has(r.id))
      .reduce((s: number, r: any) => s + (r.total || 0), 0)
  )
  const presGrandProbable = presTotProbable.reduce((s, t) => s + t, 0)
  const presGrandNoPaga = presTotNoPaga.reduce((s, t) => s + t, 0)

  return (
    <div className="p-6 space-y-4">
      <div className="flex gap-2 flex-wrap">
        {[
          { key: 'listado',    label: 'Listado' },
          { key: 'cartera',    label: 'Cartera vencida' },
          { key: 'porcliente', label: 'Por cliente' },
          { key: 'pormes',     label: 'Por período' },
          { key: 'semanal',    label: 'Vencimiento semanal' },
        ].map(s => (
          <button key={s.key} onClick={() => setPresupuestosTab(s.key as PresupuestosSubTab)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              presupuestosTab === s.key ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-200 text-gray-600 hover:border-gray-300'
            }`}>
            {s.label}
          </button>
        ))}
      </div>

      {presupuestosTab === 'listado' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <FiltrosBar {...{ search, setSearch, fechaDesde, setFechaDesde, fechaHasta, setFechaHasta }} />
            <button className="btn-secondary flex items-center gap-2 text-sm py-1.5" onClick={() =>
              exportCSV(
                ['#Presupuesto','Fecha','Cliente','Tipo Doc','Monto','ITBMS','Total','Estado','Vencimiento'],
                presupuestosFiltrados.map(p => [p.numero_presupuesto, p.fecha, p.clientes?.nombre, p.tipo_documento, p.monto, p.itbms, p.total, p.estado, p.fecha_pago]),
                `presupuestos_${new Date().toISOString().split('T')[0]}.csv`
              )
            }>
              <Download size={14} />Exportar
            </button>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Total presupuestado', val: presupuestosFiltrados.reduce((s, p) => s + (p.total || 0), 0), color: 'text-brand-700' },
              { label: 'Cobrado', val: presupuestosFiltrados.filter(p => p.estado === 'pagada').reduce((s, p) => s + (p.total || 0), 0), color: 'text-green-600' },
              { label: 'Pendiente', val: presupuestosFiltrados.filter(p => p.estado === 'pendiente').reduce((s, p) => s + (p.total || 0), 0), color: 'text-orange-600' },
              { label: '# Presupuestos', val: presupuestosFiltrados.length, color: 'text-gray-700', isCnt: true },
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
                <th className="table-header">#</th>
                <th className="table-header">Fecha</th>
                <th className="table-header">Cliente</th>
                <th className="table-header">Tipo</th>
                <th className="table-header text-right">Total</th>
                <th className="table-header">Estado</th>
                <th className="table-header">Vencimiento</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {presupuestosFiltrados.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-8 text-gray-400">Sin resultados</td></tr>
                ) : presupuestosFiltrados.slice(0, 200).map((p: any) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="table-cell font-mono text-sm text-gray-500">#{p.numero_presupuesto}</td>
                    <td className="table-cell text-sm">{formatDate(p.fecha)}</td>
                    <td className="table-cell max-w-[200px]"><span className="truncate block">{p.clientes?.nombre}</span></td>
                    <td className="table-cell text-xs text-gray-400">{p.tipo_documento}</td>
                    <td className="table-cell text-right font-semibold">{formatCurrency(p.total)}</td>
                    <td className="table-cell">
                      <span className={`badge ${p.estado === 'pagada' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                        {p.estado === 'pagada' ? 'Cobrado' : 'Pendiente'}
                      </span>
                    </td>
                    <td className="table-cell text-sm text-gray-400">{formatDate(p.fecha_pago)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {presupuestosTab === 'cartera' && (
        <div className="space-y-4">
          <div className="grid grid-cols-5 gap-3">
            {TRAMOS.map(tramo => {
              const items = carteraPresupuestos.filter((c: any) => c.tramo === tramo)
              return (
                <div key={tramo} className="card p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-3 h-3 rounded-full" style={{ background: TRAMO_COLORS_HEX[tramo] }} />
                    <span className="text-xs font-medium text-gray-600">{TRAMO_LABELS[tramo]}</span>
                  </div>
                  <p className="text-lg font-bold">{formatCurrency(items.reduce((s: number, c: any) => s + (c.saldo_pendiente ?? c.total), 0))}</p>
                  <p className="text-xs text-gray-400">{items.length} presupuestos</p>
                </div>
              )
            })}
          </div>
          <div className="card p-4 bg-brand-50 border-brand-200">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-brand-700">Total cartera pendiente</span>
              <span className="text-2xl font-bold text-brand-800">{formatCurrency(carteraPresupuestos.reduce((s: number, c: any) => s + (c.saldo_pendiente ?? c.total), 0))}</span>
            </div>
          </div>
          <div className="card overflow-hidden">
            <table className="w-full">
              <thead><tr className="border-b border-gray-200">
                <th className="table-header">#Presupuesto</th>
                <th className="table-header">Fecha</th>
                <th className="table-header">Cliente</th>
                <th className="table-header">Vencimiento</th>
                <th className="table-header text-right">Total</th>
                <th className="table-header text-right">Saldo</th>
                <th className="table-header text-right">Días</th>
                <th className="table-header">Tramo</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {carteraPresupuestos.map((c: any) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="table-cell font-mono">#{c.numero_presupuesto}</td>
                    <td className="table-cell text-sm text-gray-500">{formatDate(c.fecha)}</td>
                    <td className="table-cell max-w-[200px]"><span className="truncate block">{c.cliente}</span></td>
                    <td className="table-cell text-sm text-gray-500">{formatDate(c.fecha_pago)}</td>
                    <td className="table-cell text-right">{formatCurrency(c.total)}</td>
                    <td className="table-cell text-right font-semibold text-orange-600">{formatCurrency(c.saldo_pendiente ?? c.total)}</td>
                    <td className="table-cell text-right">
                      <span className={c.dias_vencida > 0 ? 'text-red-600 font-medium' : 'text-green-600'}>
                        {c.dias_vencida > 0 ? `+${c.dias_vencida}` : c.dias_vencida}
                      </span>
                    </td>
                    <td className="table-cell"><span className={`badge ${tramoColor(c.tramo)}`}>{TRAMO_LABELS[c.tramo]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {presupuestosTab === 'porcliente' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Top clientes</h3>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={topClientesPresupuestos.slice(0, 10).map(([n, v]) => ({ name: n.substring(0, 18), monto: v }))}
                  layout="vertical" margin={{ left: 10, right: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={130} />
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  <Bar dataKey="monto" name="Presupuestos" fill="#7c3aed" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Distribución</h3>
              <ResponsiveContainer width="100%" height={320}>
                <PieChart>
                  <Pie data={topClientesPresupuestos.slice(0, 8).map(([n, v]) => ({ name: n.substring(0, 20), value: v }))}
                    cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2} dataKey="value">
                    {topClientesPresupuestos.slice(0, 8).map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {presupuestosTab === 'pormes' && (
        <div className="space-y-4">
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Presupuestos por período</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={presupuestosPorMes} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} />
                <Bar dataKey="total" name="Presupuestos" fill="#7c3aed" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {presupuestosTab === 'semanal' && (
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

          <div className="grid grid-cols-4 gap-3">
            {presWeekDateObjs.map((_, i) => {
              const c = WEEK_COLORS[i]
              const cnt = vencPresupuestos.rows.filter((r: any) => r.fridayIdx === i).length
              return (
                <div key={i} className={`card p-4 border-t-4 ${c.bg} ${c.border}`}>
                  <p className={`text-xs font-semibold uppercase tracking-wide ${c.label}`}>Semana {i + 1}</p>
                  <input type="date" value={presWeekDates[i]}
                    onChange={e => { const nd = [...presWeekDates]; nd[i] = e.target.value; setPresWeekDates(nd) }}
                    className="text-xs text-gray-600 border border-gray-200 rounded px-1.5 py-0.5 mt-0.5 mb-2 w-full bg-white focus:outline-none focus:border-gray-400" />
                  <p className={`text-lg font-bold ${c.text}`}>{formatCurrency(vencPresupuestos.totals[i])}</p>
                  <p className="text-xs text-gray-400 mt-1">{cnt} {cnt === 1 ? 'presupuesto' : 'presupuestos'}</p>
                </div>
              )
            })}
          </div>

          <div className="card p-4 bg-brand-50 border border-brand-200 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-brand-700">Total general vencido</span>
              <span className="text-2xl font-bold text-brand-900">{formatCurrency(vencPresupuestos.grandTotal)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-green-600 font-medium">↳ Probable pago</span>
              <span className="text-sm font-bold text-green-700">{formatCurrency(presGrandProbable)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-red-500 font-medium">↳ No pagará</span>
              <span className="text-sm font-bold text-red-600">{formatCurrency(presGrandNoPaga)}</span>
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
                  {presRows.map((p: any) => {
                    const isNoPaga = presNoPagaraSet.has(p.id)
                    return (
                      <tr key={p.id} className={`hover:bg-gray-50 transition-opacity ${isNoPaga ? 'opacity-50 bg-red-50/40' : ''}`}>
                        <td className={`table-cell sticky left-0 z-10 max-w-[220px] ${isNoPaga ? 'bg-red-50' : 'bg-white'}`}>
                          <span className="truncate block text-sm">{p.clientes?.nombre || '—'}</span>
                        </td>
                        <td className="table-cell text-center font-mono text-sm text-gray-500">#{p.numero_presupuesto}</td>
                        <td className="table-cell text-center text-sm text-gray-400">{formatDate(p.fecha)}</td>
                        <td className="table-cell text-center text-sm font-semibold text-red-600">{formatDate(p.fecha_pago)}</td>
                        {presWeekDateObjs.map((_, i) => (
                          <td key={i} className="table-cell text-right text-sm">
                            {p.fridayIdx === i
                              ? <span className={i === 0 ? 'font-semibold text-red-600' : 'font-medium text-gray-700'}>{formatCurrency(p.total)}</span>
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
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-400 bg-gray-100 font-bold">
                    <td colSpan={4} className="table-cell text-right sticky left-0 bg-gray-100 z-10 text-sm text-gray-600">TOTAL VENCIDO</td>
                    {vencPresupuestos.totals.map((t, i) => (
                      <td key={i} className="table-cell text-right text-brand-800">{t > 0 ? formatCurrency(t) : '—'}</td>
                    ))}
                    <td className="table-cell" />
                  </tr>
                  <tr className="bg-green-50 text-xs font-semibold">
                    <td colSpan={4} className="table-cell text-right sticky left-0 bg-green-50 z-10 text-green-700">↳ Probable Pago</td>
                    {presTotProbable.map((t, i) => (
                      <td key={i} className="table-cell text-right text-green-700">{t > 0 ? formatCurrency(t) : '—'}</td>
                    ))}
                    <td className="table-cell" />
                  </tr>
                  <tr className="bg-red-50 text-xs font-semibold">
                    <td colSpan={4} className="table-cell text-right sticky left-0 bg-red-50 z-10 text-red-600">↳ No Pagará</td>
                    {presTotNoPaga.map((t, i) => (
                      <td key={i} className="table-cell text-right text-red-600">{t > 0 ? formatCurrency(t) : '—'}</td>
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
      )}
    </div>
  )
}
