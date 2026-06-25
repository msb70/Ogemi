'use client'

import { useState } from 'react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Download } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList,
} from 'recharts'
import { exportXLSX, buildKpiSheet } from '../reportes.utils'
import FiltrosBar, { type FiltrosBarProps } from './FiltrosBar'

type NcSubTab = 'listado' | 'porcliente'

interface NcTabProps extends FiltrosBarProps {
  ncFiltradas: any[]
  ncPorCliente: [string, number][]
}

export default function NcTab({
  ncFiltradas,
  search, setSearch, fechaDesde, setFechaDesde, fechaHasta, setFechaHasta,
}: NcTabProps) {
  const [ncTab, setNcTab] = useState<NcSubTab>('listado')

  return (
    <div className="p-6 space-y-4">
      <div className="flex gap-2 mb-2">
        {[
          { key: 'listado',     label: 'Listado' },
          { key: 'porcliente',  label: 'Por cliente' },
        ].map(s => (
          <button key={s.key} onClick={() => setNcTab(s.key as NcSubTab)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              ncTab === s.key ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-200 text-gray-600 hover:border-gray-300'
            }`}>
            {s.label}
          </button>
        ))}
      </div>

      {ncTab === 'listado' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <FiltrosBar {...{ search, setSearch, fechaDesde, setFechaDesde, fechaHasta, setFechaHasta }} />
            <button className="btn-secondary flex items-center gap-2 text-sm py-1.5" onClick={() => {
              const totalMonto = ncFiltradas.reduce((s, f) => s + Math.abs(f.total || 0), 0)
              exportXLSX(`notas_credito_${new Date().toISOString().split('T')[0]}.xlsx`, [
                buildKpiSheet('Notas de crédito — Listado', `${fechaDesde} a ${fechaHasta}`, [
                  ['# Notas de crédito', ncFiltradas.length],
                  ['Monto total', totalMonto],
                ]),
                { name: 'Listado', rows: [
                  ['#Documento','Fecha','Cliente','Tipo','Doc.Afectado','Monto','ITBMS','Total'],
                  ...ncFiltradas.map(f => [f.numero_factura, f.fecha, f.clientes?.nombre, f.tipo_documento, f.documento_afectado, f.monto, f.itbms, f.total]),
                ] },
              ])
            }}>
              <Download size={14} />Exportar Excel
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="card p-4">
              <p className="text-xs font-semibold uppercase text-gray-500">Número de notas de crédito</p>
              <p className="text-2xl font-bold text-gray-900">{ncFiltradas.length.toLocaleString('es-PA')}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs font-semibold uppercase text-gray-500">Total notas de crédito</p>
              <p className="text-2xl font-bold text-amber-700">{formatCurrency(ncFiltradas.reduce((s, f) => s + Math.abs(f.total || 0), 0))}</p>
            </div>
          </div>
          <div className="card overflow-hidden">
            <table className="w-full">
              <thead><tr className="border-b border-gray-200">
                <th className="table-header">#Doc</th>
                <th className="table-header">Fecha</th>
                <th className="table-header">Cliente</th>
                <th className="table-header">Tipo</th>
                <th className="table-header">Doc. Afectado</th>
                <th className="table-header text-right">Monto</th>
                <th className="table-header text-right">Total</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {ncFiltradas.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-8 text-gray-400">Sin notas de crédito</td></tr>
                ) : ncFiltradas.map((f: any) => (
                  <tr key={f.id} className="hover:bg-gray-50">
                    <td className="table-cell font-mono text-sm text-gray-500">#{f.numero_factura}</td>
                    <td className="table-cell text-sm">{formatDate(f.fecha)}</td>
                    <td className="table-cell max-w-[180px]"><span className="truncate block">{f.clientes?.nombre}</span></td>
                    <td className="table-cell text-xs text-amber-600">{f.tipo_documento}</td>
                    <td className="table-cell text-sm text-gray-400">{f.documento_afectado ? `#${f.documento_afectado}` : '—'}</td>
                    <td className="table-cell text-right">{formatCurrency(Math.abs(f.monto))}</td>
                    <td className="table-cell text-right font-semibold text-amber-700">{formatCurrency(Math.abs(f.total))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {ncTab === 'porcliente' && (
        <div className="space-y-4">
          <FiltrosBar {...{ search, setSearch, fechaDesde, setFechaDesde, fechaHasta, setFechaHasta }} />
          {(() => {
            const totalMonto = ncFiltradas.reduce((s, f) => s + Math.abs(f.total || 0), 0)
            const totalCount = ncFiltradas.length
            const map: Record<string, { count: number; monto: number }> = {}
            ncFiltradas.forEach((f: any) => {
              const k = f.clientes?.nombre || 'Sin nombre'
              if (!map[k]) map[k] = { count: 0, monto: 0 }
              map[k].count += 1
              map[k].monto += Math.abs(f.total || 0)
            })
            const rows = Object.entries(map)
              .map(([nombre, v]) => ({ nombre, count: v.count, monto: v.monto, pct: totalMonto > 0 ? (v.monto / totalMonto) * 100 : 0 }))
              .sort((a, b) => b.monto - a.monto)
            let acc = 0
            return (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="card p-4">
                    <p className="text-xs font-semibold uppercase text-gray-500">Total notas de crédito</p>
                    <p className="text-2xl font-bold text-gray-900">{totalCount.toLocaleString('es-PA')}</p>
                  </div>
                  <div className="card p-4">
                    <p className="text-xs font-semibold uppercase text-gray-500">Monto total</p>
                    <p className="text-2xl font-bold text-amber-700">{formatCurrency(totalMonto)}</p>
                  </div>
                </div>
                <div className="card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 text-xs text-gray-500 uppercase border-b border-gray-200">
                          <th className="text-left px-3 py-2 font-semibold">#</th>
                          <th className="text-left px-3 py-2 font-semibold">Cliente</th>
                          <th className="text-right px-3 py-2 font-semibold">Notas</th>
                          <th className="text-right px-3 py-2 font-semibold">Monto</th>
                          <th className="text-right px-3 py-2 font-semibold">% del total</th>
                          <th className="text-right px-3 py-2 font-semibold">% acumulado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {rows.length === 0 ? (
                          <tr><td colSpan={6} className="text-center py-8 text-gray-400">Sin notas de crédito en el período</td></tr>
                        ) : rows.map((r, i) => {
                          acc += r.pct
                          return (
                            <tr key={r.nombre} className="hover:bg-gray-50">
                              <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                              <td className="px-3 py-2 font-medium">{r.nombre}</td>
                              <td className="px-3 py-2 text-right text-gray-500">{r.count}</td>
                              <td className="px-3 py-2 text-right font-semibold">{formatCurrency(r.monto)}</td>
                              <td className="px-3 py-2 text-right text-amber-700">{r.pct.toFixed(1)}%</td>
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
                            <td className="px-3 py-2 text-right">{formatCurrency(totalMonto)}</td>
                            <td className="px-3 py-2 text-right">100%</td>
                            <td className="px-3 py-2"></td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </div>
                {(() => {
                  const chartRows = rows.slice(0, 15).map(r => ({ name: r.nombre.length > 22 ? r.nombre.substring(0, 22) + '…' : r.nombre, monto: r.monto }))
                  const chartH = Math.max(300, chartRows.length * 34 + 40)
                  return (
                    <div className="card p-5">
                      <h3 className="text-sm font-semibold text-gray-700 mb-3">Notas de crédito por cliente (top 15)</h3>
                      <ResponsiveContainer width="100%" height={chartH}>
                        <BarChart data={chartRows} layout="vertical" margin={{ left: 10, right: 70, top: 4, bottom: 4 }}>
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                          <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                          <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={160} />
                          <Tooltip formatter={(v: number) => formatCurrency(v)} />
                          <Bar dataKey="monto" name="NC" fill="#d97706" radius={[0, 4, 4, 0]}>
                            <LabelList dataKey="monto" position="right" style={{ fontSize: 11, fill: '#92400e' }}
                              formatter={(v) => formatCurrency(Number(v))} />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )
                })()}
              </>
            )
          })()}
        </div>
      )}
    </div>
  )
}
