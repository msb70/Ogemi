'use client'

import { Fragment, useState } from 'react'
import { formatMonto, formatDate, tramoColor } from '@/lib/utils'
import { Download } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts'
import {
  TRAMOS, TRAMO_LABELS, TRAMO_COLORS_HEX, PIE_COLORS, normTramo,
  exportXLSX, buildKpiSheet,
} from '../reportes.utils'
import FiltrosBar, { type FiltrosBarProps } from './FiltrosBar'

type PresupuestosSubTab = 'listado' | 'cartera' | 'porcliente' | 'pormes'

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
  // OT por número de presupuesto (la vista cartera_presupuestos no expone orden_trabajo)
  const otPorNumero = new Map<any, string>()
  presupuestos.forEach((p: any) => { if (p.orden_trabajo) otPorNumero.set(p.numero_presupuesto, p.orden_trabajo) })

  return (
    <div className="p-6 space-y-4">
      <div className="flex gap-2 flex-wrap">
        {[
          { key: 'listado',    label: 'Listado' },
          { key: 'cartera',    label: 'Cartera vencida' },
          { key: 'porcliente', label: 'Por cliente' },
          { key: 'pormes',     label: 'Por período' },
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
            <button className="btn-secondary flex items-center gap-2 text-sm py-1.5" onClick={() => {
              const total = presupuestosFiltrados.reduce((s, p) => s + (p.total || 0), 0)
              // Cobrado incluye abonos parciales de presupuestos pendientes
              const cobrado = presupuestosFiltrados.reduce((s, p) => s + (p.estado === 'pagada' ? (p.total || 0) : (p.monto_pagado || 0)), 0)
              const pendiente = presupuestosFiltrados.reduce((s, p) => s + (p.estado === 'pendiente' ? (p.total || 0) - (p.monto_pagado || 0) : 0), 0)
              exportXLSX(`presupuestos_${new Date().toISOString().split('T')[0]}.xlsx`, [
                buildKpiSheet('Presupuestos — Listado', `${fechaDesde} a ${fechaHasta}`, [
                  ['Total presupuestado', total],
                  ['Cobrado', cobrado],
                  ['Pendiente', pendiente],
                  ['# Presupuestos', presupuestosFiltrados.length],
                ]),
                { name: 'Listado', rows: [
                  ['#Presupuesto','Orden trabajo','Fecha','Cliente','Tipo Doc','Monto','ITBMS','Total','Estado','Vencimiento'],
                  ...presupuestosFiltrados.map(p => [p.numero_presupuesto, p.orden_trabajo || '', p.fecha, p.clientes?.nombre, p.tipo_documento, p.monto, p.itbms, p.total, p.estado, p.fecha_pago]),
                ] },
              ])
            }}>
              <Download size={14} />Exportar Excel
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Total presupuestado', val: presupuestosFiltrados.reduce((s, p) => s + (p.total || 0), 0), color: 'text-brand-700' },
              // Cobrado = pagados completos + abonos parciales; Pendiente = saldo real
              { label: 'Cobrado', val: presupuestosFiltrados.reduce((s, p) => s + (p.estado === 'pagada' ? (p.total || 0) : (p.monto_pagado || 0)), 0), color: 'text-green-600' },
              { label: 'Pendiente', val: presupuestosFiltrados.reduce((s, p) => s + (p.estado === 'pendiente' ? (p.total || 0) - (p.monto_pagado || 0) : 0), 0), color: 'text-orange-600' },
              { label: '# Presupuestos', val: presupuestosFiltrados.length, color: 'text-gray-700', isCnt: true },
            ].map(s => (
              <div key={s.label} className="card p-3">
                <p className="text-xs text-gray-500">{s.label}</p>
                <p className={`text-lg font-bold ${s.color}`}>{(s as any).isCnt ? s.val : formatMonto(s.val as number)}</p>
              </div>
            ))}
          </div>
          <div className="card overflow-hidden">
            <table className="w-full">
              <thead><tr className="border-b border-gray-200">
                <th className="table-header">#</th>
                <th className="table-header">Orden trabajo</th>
                <th className="table-header">Fecha</th>
                <th className="table-header">Cliente</th>
                <th className="table-header">Tipo</th>
                <th className="table-header text-right">Total</th>
                <th className="table-header">Estado</th>
                <th className="table-header">Vencimiento</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {presupuestosFiltrados.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-8 text-gray-400">Sin resultados</td></tr>
                ) : presupuestosFiltrados.map((p: any) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="table-cell font-mono text-sm text-gray-500">#{p.numero_presupuesto}</td>
                    <td className="table-cell text-sm text-gray-600">{p.orden_trabajo || '—'}</td>
                    <td className="table-cell text-sm">{formatDate(p.fecha)}</td>
                    <td className="table-cell max-w-[200px]"><span className="truncate block">{p.clientes?.nombre}</span></td>
                    <td className="table-cell text-xs text-gray-400">{p.tipo_documento}</td>
                    <td className="table-cell text-right font-semibold">{formatMonto(p.total)}</td>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
            {TRAMOS.map(tramo => {
              const items = carteraPresupuestos.filter((c: any) => normTramo(c.tramo) === tramo)
              return (
                <div key={tramo} className="card p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-3 h-3 rounded-full" style={{ background: TRAMO_COLORS_HEX[tramo] }} />
                    <span className="text-xs font-medium text-gray-600">{TRAMO_LABELS[tramo]}</span>
                  </div>
                  <p className="text-lg font-bold">{formatMonto(items.reduce((s: number, c: any) => s + (c.saldo_pendiente ?? c.total), 0))}</p>
                  <p className="text-xs text-gray-400">{items.length} presupuestos</p>
                </div>
              )
            })}
          </div>
          <div className="card p-4 bg-brand-50 border-brand-200">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-brand-700">Total cartera pendiente</span>
              <span className="text-2xl font-bold text-brand-800">{formatMonto(carteraPresupuestos.reduce((s: number, c: any) => s + (c.saldo_pendiente ?? c.total), 0))}</span>
            </div>
          </div>
          <div className="card overflow-hidden">
            <table className="w-full">
              <thead><tr className="border-b border-gray-200">
                <th className="table-header">#Presupuesto</th>
                <th className="table-header">Orden trabajo</th>
                <th className="table-header">Fecha</th>
                <th className="table-header">Cliente</th>
                <th className="table-header">Vencimiento</th>
                <th className="table-header text-right">Total</th>
                <th className="table-header text-right">Saldo</th>
                <th className="table-header text-right">Días</th>
                <th className="table-header">Tramo</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {carteraPresupuestos.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-8 text-gray-400">Sin cartera pendiente</td></tr>
                ) : Object.entries(
                    carteraPresupuestos.reduce((acc: Record<string, any[]>, c: any) => {
                      const k = c.cliente || 'Sin nombre'
                      ;(acc[k] = acc[k] || []).push(c)
                      return acc
                    }, {})
                  )
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([nombre, items]) => [nombre, (items as any[]).sort((a, b) => b.dias_vencida - a.dias_vencida)] as [string, any[]])
                    .map(([nombre, items]) => (
                      <Fragment key={nombre}>
                        <tr className="bg-brand-50/40 border-t border-gray-200">
                          <td colSpan={6} className="table-cell font-semibold text-brand-800">
                            {nombre} <span className="text-xs text-gray-400 font-normal">({items.length} presupuesto{items.length === 1 ? '' : 's'})</span>
                          </td>
                          <td className="table-cell text-right font-bold text-brand-800">
                            {formatMonto(items.reduce((s: number, c: any) => s + (c.saldo_pendiente ?? c.total), 0))}
                          </td>
                          <td colSpan={2} />
                        </tr>
                        {items.map((c: any) => (
                          <tr key={c.id} className="hover:bg-gray-50">
                            <td className="table-cell font-mono">#{c.numero_presupuesto}</td>
                            <td className="table-cell text-sm text-gray-600">{otPorNumero.get(c.numero_presupuesto) || '—'}</td>
                            <td className="table-cell text-sm text-gray-500">{formatDate(c.fecha)}</td>
                            <td className="table-cell max-w-[200px]"><span className="truncate block">{c.cliente}</span></td>
                            <td className="table-cell text-sm text-gray-500">{formatDate(c.fecha_pago)}</td>
                            <td className="table-cell text-right">{formatMonto(c.total)}</td>
                            <td className="table-cell text-right font-semibold text-orange-600">{formatMonto(c.saldo_pendiente ?? c.total)}</td>
                            <td className="table-cell text-right">
                              <span className={c.dias_vencida > 0 ? 'text-red-600 font-medium' : 'text-green-600'}>
                                {c.dias_vencida > 0 ? `+${c.dias_vencida}` : c.dias_vencida}
                              </span>
                            </td>
                            <td className="table-cell"><span className={`badge ${tramoColor(normTramo(c.tramo))}`}>{TRAMO_LABELS[normTramo(c.tramo)]}</span></td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {presupuestosTab === 'porcliente' && (
        <div className="space-y-4">
          <FiltrosBar {...{ search, setSearch, fechaDesde, setFechaDesde, fechaHasta, setFechaHasta }} />
          {(() => {
            const totalMonto = presupuestosFiltrados.reduce((s, p) => s + (p.total || 0), 0)
            const totalCount = presupuestosFiltrados.length
            const map: Record<string, { count: number; monto: number }> = {}
            presupuestosFiltrados.forEach((p: any) => {
              const k = p.clientes?.nombre || 'Sin nombre'
              if (!map[k]) map[k] = { count: 0, monto: 0 }
              map[k].count += 1
              map[k].monto += p.total || 0
            })
            const rows = Object.entries(map)
              .map(([nombre, v]) => ({ nombre, count: v.count, monto: v.monto, pct: totalMonto > 0 ? (v.monto / totalMonto) * 100 : 0 }))
              .sort((a, b) => b.monto - a.monto)
            let acc = 0
            return (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="card p-4">
                    <p className="text-xs font-semibold uppercase text-gray-500">Total presupuestos</p>
                    <p className="text-2xl font-bold text-gray-900">{totalCount.toLocaleString('es-PA')}</p>
                  </div>
                  <div className="card p-4">
                    <p className="text-xs font-semibold uppercase text-gray-500">Monto total</p>
                    <p className="text-2xl font-bold" style={{ color: '#7c3aed' }}>{formatMonto(totalMonto)}</p>
                  </div>
                </div>
                <div className="card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 text-xs text-gray-500 uppercase border-b border-gray-200">
                          <th className="text-left px-3 py-2 font-semibold">#</th>
                          <th className="text-left px-3 py-2 font-semibold">Cliente</th>
                          <th className="text-right px-3 py-2 font-semibold">Presupuestos</th>
                          <th className="text-right px-3 py-2 font-semibold">Monto</th>
                          <th className="text-right px-3 py-2 font-semibold">% del total</th>
                          <th className="text-right px-3 py-2 font-semibold">% acumulado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {rows.length === 0 ? (
                          <tr><td colSpan={6} className="text-center py-8 text-gray-400">Sin presupuestos en el período</td></tr>
                        ) : rows.map((r, i) => {
                          acc += r.pct
                          return (
                            <tr key={r.nombre} className="hover:bg-gray-50">
                              <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                              <td className="px-3 py-2 font-medium">{r.nombre}</td>
                              <td className="px-3 py-2 text-right text-gray-500">{r.count}</td>
                              <td className="px-3 py-2 text-right font-semibold">{formatMonto(r.monto)}</td>
                              <td className="px-3 py-2 text-right" style={{ color: '#7c3aed' }}>{r.pct.toFixed(1)}%</td>
                              <td className="px-3 py-2 text-right text-gray-600">{Math.min(acc, 100).toFixed(1)}%</td>
                            </tr>
                          )
                        })}
                      </tbody>
                      {rows.length > 0 && (
                        <tfoot>
                          <tr className="bg-gray-50 border-t border-gray-200 font-bold">
                            <td className="px-3 py-2" colSpan={2}>Total</td>
                            <td className="px-3 py-2 text-right">{totalCount}</td>
                            <td className="px-3 py-2 text-right">{formatMonto(totalMonto)}</td>
                            <td className="px-3 py-2 text-right">100%</td>
                            <td className="px-3 py-2"></td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="card p-5">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Top clientes</h3>
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={topClientesPresupuestos.slice(0, 10).map(([n, v]) => ({ name: n.substring(0, 18), monto: v }))}
                        layout="vertical" margin={{ left: 10, right: 30 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                        <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={130} />
                        <Tooltip formatter={(v: number) => formatMonto(v)} />
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
                        <Tooltip formatter={(v: number) => formatMonto(v)} />
                        <Legend wrapperStyle={{ fontSize: '11px' }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </>
            )
          })()}
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
                <Tooltip formatter={(v: number) => formatMonto(v)} />
                <Bar dataKey="total" name="Presupuestos" fill="#7c3aed" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {(() => {
            const totalMonto = presupuestosPorMes.reduce((s, m) => s + (m.total || 0), 0)
            const totalCount = presupuestosPorMes.reduce((s, m) => s + (m.count || 0), 0)
            return (
              <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-xs text-gray-500 uppercase border-b border-gray-200">
                        <th className="text-left px-3 py-2 font-semibold">Mes</th>
                        <th className="text-right px-3 py-2 font-semibold">Presupuestos</th>
                        <th className="text-right px-3 py-2 font-semibold">Monto</th>
                        <th className="text-right px-3 py-2 font-semibold">% del total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {presupuestosPorMes.length === 0 ? (
                        <tr><td colSpan={4} className="text-center py-8 text-gray-400">Sin datos en el período</td></tr>
                      ) : presupuestosPorMes.map(m => (
                        <tr key={m.mes} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-medium">{m.mes}</td>
                          <td className="px-3 py-2 text-right text-gray-500">{m.count}</td>
                          <td className="px-3 py-2 text-right font-semibold">{formatMonto(m.total)}</td>
                          <td className="px-3 py-2 text-right" style={{ color: '#7c3aed' }}>
                            {totalMonto > 0 ? ((m.total / totalMonto) * 100).toFixed(1) : '0.0'}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {presupuestosPorMes.length > 0 && (
                      <tfoot>
                        <tr className="bg-gray-50 border-t border-gray-200 font-bold">
                          <td className="px-3 py-2">Total</td>
                          <td className="px-3 py-2 text-right">{totalCount}</td>
                          <td className="px-3 py-2 text-right">{formatMonto(totalMonto)}</td>
                          <td className="px-3 py-2 text-right">100%</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            )
          })()}
        </div>
      )}

    </div>
  )
}
