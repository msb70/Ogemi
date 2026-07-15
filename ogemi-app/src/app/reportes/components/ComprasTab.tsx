'use client'

import { useState, Fragment } from 'react'
import { formatMonto, formatDate, formatDateObj } from '@/lib/utils'
import { Download, Search } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  TRAMOS, TRAMO_LABELS, TRAMO_COLORS_HEX, BUCKETS,
  exportXLSX, buildKpiSheet, getNextFridays, buildVencimientoSemanal,
} from '../reportes.utils'
import FiltrosBar, { type FiltrosBarProps } from './FiltrosBar'

type ComprasSubTab = 'listado' | 'cxp' | 'antiguedad' | 'porproveedor' | 'pormes' | 'semanal'

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

  // Listado ordenado por fecha de la factura descendente
  const comprasOrdenadas = [...comprasFiltradas].sort((a: any, b: any) =>
    a.fecha === b.fecha ? 0 : (a.fecha < b.fecha ? 1 : -1)
  )
  const [compWeekDates, setCompWeekDates] = useState<string[]>(() =>
    getNextFridays(4).map(d => d.toISOString().split('T')[0])
  )
  const [compSearch, setCompSearch] = useState('')
  const [compSemFilter, setCompSemFilter] = useState<string>('all')
  const [compNoPagaraSet, setCompNoPagaraSet] = useState<Set<number>>(new Set())

  // Antigüedad de cartera (pivot proveedor × tramo)
  const [antExpandidos, setAntExpandidos] = useState<Record<string, boolean>>({})
  const [antMostrarTodas, setAntMostrarTodas] = useState(false)

  const pivotAntData: Record<string, Record<string, number>> = {}
  const comprasPorProveedor: Record<string, any[]> = {}
  cxp.forEach((c: any) => {
    const k = c.proveedor || 'N/A'
    if (!pivotAntData[k]) { pivotAntData[k] = {}; comprasPorProveedor[k] = [] }
    comprasPorProveedor[k].push(c)
    pivotAntData[k][c.tramo] = (pivotAntData[k][c.tramo] || 0) + (c.saldo_pendiente ?? c.total ?? 0)
  })
  const proveedoresAnt = Object.keys(pivotAntData).sort()
  const totalCarteraCxp = cxp.reduce((s: number, c: any) => s + (c.saldo_pendiente ?? c.total ?? 0), 0)

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
      .reduce((s: number, r: any) => s + (r.saldo ?? r.total ?? 0), 0)
  )
  const compTotNoPaga = compWeekDateObjs.map((_, i) =>
    vencCompras.rows.filter((r: any) => r.fridayIdx === i && compNoPagaraSet.has(r.id))
      .reduce((s: number, r: any) => s + (r.saldo ?? r.total ?? 0), 0)
  )
  const compGrandProbable = compTotProbable.reduce((s, t) => s + t, 0)
  const compGrandNoPaga = compTotNoPaga.reduce((s, t) => s + t, 0)

  return (
    <div className="p-6 space-y-4">
      <div className="flex gap-2 flex-wrap">
        {[
          { key: 'listado',      label: 'Listado' },
          { key: 'cxp',          label: 'Cuentas por pagar' },
          { key: 'antiguedad',   label: 'Antigüedad de cartera' },
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
            <button className="btn-secondary flex items-center gap-2 text-sm py-1.5" onClick={() => {
              const total = comprasFiltradas.reduce((s, c) => s + (c.total || 0), 0)
              // Pagado incluye abonos parciales de compras pendientes
              const pagado = comprasFiltradas.reduce((s, c) => s + (c.estado === 'pagada' ? (c.total || 0) : (c.monto_pagado || 0)), 0)
              const pendiente = comprasFiltradas.reduce((s, c) => s + (c.estado === 'pendiente' ? (c.total || 0) - (c.monto_pagado || 0) : 0), 0)
              exportXLSX(`compras_${new Date().toISOString().split('T')[0]}.xlsx`, [
                buildKpiSheet('Compras — Listado', `${fechaDesde} a ${fechaHasta}`, [
                  ['Total compras', total],
                  ['Pagado (incluye abonos)', pagado],
                  ['Saldo pendiente', pendiente],
                  ['# Compras', comprasFiltradas.length],
                ]),
                { name: 'Listado', rows: [
                  ['Fecha','Proveedor','Concepto','Referencia','Monto','ITBMS','Total','Abonado','Saldo','Estado','Vencimiento'],
                  ...comprasFiltradas.map(c => [c.fecha, c.proveedores?.nombre, c.concepto, c.referencia, c.monto, c.itbms, c.total,
                    c.monto_pagado || 0,
                    c.estado === 'pagada' ? 0 : (c.total || 0) - (c.monto_pagado || 0),
                    c.estado, c.vencimiento]),
                ] },
              ])
            }}>
              <Download size={14} />Exportar Excel
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Total compras', val: comprasFiltradas.reduce((s, c) => s + (c.total || 0), 0), color: 'text-brand-700' },
              // Pagado = compras pagadas completas + abonos parciales de pendientes
              { label: 'Pagado', val: comprasFiltradas.reduce((s, c) => s + (c.estado === 'pagada' ? (c.total || 0) : (c.monto_pagado || 0)), 0), color: 'text-green-600' },
              // Pendiente = saldo real (total − abonos)
              { label: 'Pendiente', val: comprasFiltradas.reduce((s, c) => s + (c.estado === 'pendiente' ? (c.total || 0) - (c.monto_pagado || 0) : 0), 0), color: 'text-orange-600' },
              { label: '# Compras', val: comprasFiltradas.length, color: 'text-gray-700', isCnt: true },
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
                <th className="table-header">Fecha</th>
                <th className="table-header">Proveedor</th>
                <th className="table-header">Concepto</th>
                <th className="table-header text-right">Monto</th>
                <th className="table-header text-right">ITBMS</th>
                <th className="table-header text-right">Total</th>
                <th className="table-header text-right">Abonado</th>
                <th className="table-header text-right">Saldo</th>
                <th className="table-header">Estado</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {comprasOrdenadas.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-8 text-gray-400">Sin resultados</td></tr>
                ) : comprasOrdenadas.map((c: any) => {
                  const abonado = c.monto_pagado || 0
                  const saldo = c.estado === 'pagada' ? 0 : (c.total || 0) - abonado
                  const abonoParcial = c.estado === 'pendiente' && abonado > 0
                  return (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="table-cell text-sm">{formatDate(c.fecha)}</td>
                    <td className="table-cell font-medium">{c.proveedores?.nombre}</td>
                    <td className="table-cell text-sm text-gray-500 max-w-[150px]"><span className="truncate block">{c.concepto || '—'}</span></td>
                    <td className="table-cell text-right">{formatMonto(c.monto)}</td>
                    <td className="table-cell text-right text-gray-400">{formatMonto(c.itbms)}</td>
                    <td className="table-cell text-right font-semibold">{formatMonto(c.total)}</td>
                    <td className={`table-cell text-right ${abonado > 0 ? 'text-green-600 font-medium' : 'text-gray-300'}`}>{abonado > 0 ? formatMonto(abonado) : '—'}</td>
                    <td className={`table-cell text-right font-semibold ${saldo > 0 ? 'text-orange-600' : 'text-gray-300'}`}>{saldo > 0 ? formatMonto(saldo) : '—'}</td>
                    <td className="table-cell">
                      <span className={`badge ${c.estado === 'pagada' ? 'bg-green-100 text-green-700' : abonoParcial ? 'bg-yellow-100 text-yellow-700' : 'bg-orange-100 text-orange-700'}`}>
                        {c.estado === 'pagada' ? 'Pagada' : abonoParcial ? 'Abono parcial' : 'Pendiente'}
                      </span>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {comprasTab === 'cxp' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
            {TRAMOS.map(tramo => {
              const items = cxp.filter((c: any) => c.tramo === tramo)
              return (
                <div key={tramo} className="card p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-3 h-3 rounded-full" style={{ background: TRAMO_COLORS_HEX[tramo] }} />
                    <span className="text-xs font-medium text-gray-600">{TRAMO_LABELS[tramo]}</span>
                  </div>
                  <p className="text-lg font-bold">{formatMonto(items.reduce((s: number, c: any) => s + (c.saldo_pendiente ?? c.total), 0))}</p>
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
                <th className="table-header text-right">Saldo</th>
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
                    <td className="table-cell text-right font-semibold">{formatMonto(c.saldo_pendiente ?? c.total)}</td>
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

      {comprasTab === 'antiguedad' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm font-semibold text-gray-700">Antigüedad de cartera por proveedor (saldos pendientes de pago)</p>
            <button className="btn-secondary flex items-center gap-2 text-sm py-1.5" onClick={() => {
              exportXLSX(`compras_antiguedad_${new Date().toISOString().split('T')[0]}.xlsx`, [
                buildKpiSheet('Compras — Antigüedad de cartera', 'Saldos pendientes por proveedor', [
                  ...BUCKETS.map(b => [
                    b.label,
                    proveedoresAnt.reduce((s, p) => s + (pivotAntData[p]?.[b.key] || 0), 0),
                  ] as [string, number]),
                  ['Total cartera', totalCarteraCxp],
                ]),
                { name: 'Por proveedor', rows: [
                  ['Proveedor', ...BUCKETS.map(b => b.label), 'Total'],
                  ...proveedoresAnt.map(p => [
                    p,
                    ...BUCKETS.map(b => pivotAntData[p]?.[b.key] || 0),
                    BUCKETS.reduce((s, b) => s + (pivotAntData[p]?.[b.key] || 0), 0),
                  ]),
                ] },
                { name: 'Detalle', rows: [
                  ['Proveedor', 'Concepto', 'Vencimiento', 'Días vencida', 'Tramo', 'Total', 'Abonado', 'Saldo'],
                  ...cxp.map((c: any) => [
                    c.proveedor, c.concepto || '', c.vencimiento, c.dias_vencida,
                    TRAMO_LABELS[c.tramo] || c.tramo, c.total, c.monto_pagado || 0, c.saldo_pendiente ?? c.total,
                  ]),
                ] },
              ])
            }}>
              <Download size={14} />Exportar Excel
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-3">
            {BUCKETS.map(bucket => {
              const total = proveedoresAnt.reduce((s, p) => s + (pivotAntData[p]?.[bucket.key] || 0), 0)
              return (
                <div key={bucket.key} className="card p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-3 h-3 rounded-full" style={{ background: TRAMO_COLORS_HEX[bucket.key] }} />
                    <span className="text-xs font-medium text-gray-600">{bucket.label}</span>
                  </div>
                  <p className="text-lg font-bold">{formatMonto(total)}</p>
                </div>
              )
            })}
          </div>

          <div className="card p-4 bg-brand-50 border-brand-200">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-brand-700">Total cuentas por pagar</span>
              <span className="text-2xl font-bold text-brand-800">{formatMonto(totalCarteraCxp)}</span>
            </div>
          </div>

          <div className="flex justify-end">
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
              <input type="checkbox" className="w-4 h-4 accent-brand-600 cursor-pointer"
                checked={antMostrarTodas}
                onChange={e => setAntMostrarTodas(e.target.checked)} />
              Mostrar todas las compras
            </label>
          </div>

          {proveedoresAnt.length === 0 ? (
            <div className="card p-12 text-center text-gray-400">No hay cuentas por pagar pendientes</div>
          ) : (
            <div className="card overflow-auto">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="border-b-2 border-gray-300 bg-gray-50">
                    <th className="table-header text-left sticky left-0 bg-gray-50 z-10 min-w-[220px]">Proveedor / Compra</th>
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
                  {proveedoresAnt.map((prov: string) => {
                    const provTotal = BUCKETS.reduce((s, b) => s + (pivotAntData[prov]?.[b.key] || 0), 0)
                    const expandido = antMostrarTodas || (antExpandidos[prov] ?? false)
                    return (
                      <Fragment key={prov}>
                        <tr
                          className="border-b border-gray-200 bg-brand-50/30 hover:bg-brand-50 cursor-pointer"
                          onClick={() => setAntExpandidos(p => ({ ...p, [prov]: !expandido }))}>
                          <td className="table-cell sticky left-0 bg-brand-50/30 z-10 font-semibold text-brand-800">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs transition-transform ${expandido ? 'rotate-90' : ''}`}>▶</span>
                              {prov}
                            </div>
                          </td>
                          {BUCKETS.map(b => (
                            <td key={b.key} className="table-cell text-right font-semibold">
                              {(pivotAntData[prov]?.[b.key] || 0) > 0 ? (
                                <span style={{ color: TRAMO_COLORS_HEX[b.key] }}>
                                  {formatMonto(pivotAntData[prov][b.key])}
                                </span>
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                            </td>
                          ))}
                          <td className="table-cell text-right font-bold text-brand-900 bg-brand-50">
                            {formatMonto(provTotal)}
                          </td>
                        </tr>

                        {expandido && (comprasPorProveedor[prov] || []).map((c: any) => (
                          <tr key={`d-${c.id}`} className="border-b border-gray-100 bg-white hover:bg-gray-50">
                            <td className="table-cell sticky left-0 bg-white z-10 pl-10 text-sm">
                              <span className="text-gray-500 mr-2">{c.concepto || 'Sin concepto'}</span>
                              <span className="text-gray-400">Vence: {formatDate(c.vencimiento)}</span>
                              {(c.monto_pagado || 0) > 0 && (
                                <span className="text-green-600 ml-2 text-xs">abonado {formatMonto(c.monto_pagado)}</span>
                              )}
                            </td>
                            {BUCKETS.map(b => (
                              <td key={b.key} className="table-cell text-right text-sm">
                                {c.tramo === b.key ? (
                                  <span style={{ color: TRAMO_COLORS_HEX[b.key] }}>
                                    {formatMonto(c.saldo_pendiente ?? c.total)}
                                  </span>
                                ) : (
                                  <span className="text-gray-200">—</span>
                                )}
                              </td>
                            ))}
                            <td className="table-cell text-right text-sm font-medium bg-brand-50/30">
                              {formatMonto(c.saldo_pendiente ?? c.total)}
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-400 bg-gray-100 font-bold">
                    <td className="table-cell sticky left-0 bg-gray-100 z-10">TOTAL</td>
                    {BUCKETS.map(b => {
                      const total = proveedoresAnt.reduce((s, p) => s + (pivotAntData[p]?.[b.key] || 0), 0)
                      return (
                        <td key={b.key} className="table-cell text-right" style={{ color: total > 0 ? TRAMO_COLORS_HEX[b.key] : '#d1d5db' }}>
                          {total > 0 ? formatMonto(total) : '—'}
                        </td>
                      )
                    })}
                    <td className="table-cell text-right text-brand-900 bg-gray-200">
                      {formatMonto(totalCarteraCxp)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {comprasTab === 'porproveedor' && (
        <div className="space-y-4">
          <FiltrosBar {...{ search, setSearch, fechaDesde, setFechaDesde, fechaHasta, setFechaHasta }} />
          {(() => {
            const totalMonto = comprasFiltradas.reduce((s, c) => s + (c.total || 0), 0)
            const totalCount = comprasFiltradas.length
            const map: Record<string, { count: number; monto: number }> = {}
            comprasFiltradas.forEach((c: any) => {
              const k = c.proveedores?.nombre || 'Sin nombre'
              if (!map[k]) map[k] = { count: 0, monto: 0 }
              map[k].count += 1
              map[k].monto += c.total || 0
            })
            const rows = Object.entries(map)
              .map(([nombre, v]) => ({ nombre, count: v.count, monto: v.monto, pct: totalMonto > 0 ? (v.monto / totalMonto) * 100 : 0 }))
              .sort((a, b) => b.monto - a.monto)
            let acc = 0
            return (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="card p-4">
                    <p className="text-xs font-semibold uppercase text-gray-500">Total compras</p>
                    <p className="text-2xl font-bold text-gray-900">{totalCount.toLocaleString('es-PA')}</p>
                  </div>
                  <div className="card p-4">
                    <p className="text-xs font-semibold uppercase text-gray-500">Monto total</p>
                    <p className="text-2xl font-bold text-orange-700">{formatMonto(totalMonto)}</p>
                  </div>
                </div>
                <div className="card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 text-xs text-gray-500 uppercase border-b border-gray-200">
                          <th className="text-left px-3 py-2 font-semibold">#</th>
                          <th className="text-left px-3 py-2 font-semibold">Proveedor</th>
                          <th className="text-right px-3 py-2 font-semibold">Compras</th>
                          <th className="text-right px-3 py-2 font-semibold">Monto</th>
                          <th className="text-right px-3 py-2 font-semibold">% del total</th>
                          <th className="text-right px-3 py-2 font-semibold">% acumulado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {rows.length === 0 ? (
                          <tr><td colSpan={6} className="text-center py-8 text-gray-400">Sin compras en el período</td></tr>
                        ) : rows.map((r, i) => {
                          acc += r.pct
                          return (
                            <tr key={r.nombre} className="hover:bg-gray-50">
                              <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                              <td className="px-3 py-2 font-medium">{r.nombre}</td>
                              <td className="px-3 py-2 text-right text-gray-500">{r.count}</td>
                              <td className="px-3 py-2 text-right font-semibold">{formatMonto(r.monto)}</td>
                              <td className="px-3 py-2 text-right text-orange-700">{r.pct.toFixed(1)}%</td>
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
                <div className="card p-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Top proveedores</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={topProveedores.slice(0, 10).map(([n, v]) => ({ name: n.substring(0, 18), monto: v }))}
                      layout="vertical" margin={{ left: 10, right: 30 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                      <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={130} />
                      <Tooltip formatter={(v: number) => formatMonto(v)} />
                      <Bar dataKey="monto" name="Compras" fill="#f97316" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            )
          })()}
        </div>
      )}

      {comprasTab === 'pormes' && (
        <div className="space-y-4">
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Compras mensuales</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={comprasPorMes} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => formatMonto(v)} />
                <Bar dataKey="total" name="Compras" fill="#f97316" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {(() => {
            const totalMonto = comprasPorMes.reduce((s, m) => s + (m.total || 0), 0)
            const totalCount = comprasPorMes.reduce((s, m) => s + (m.count || 0), 0)
            return (
              <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-xs text-gray-500 uppercase border-b border-gray-200">
                        <th className="text-left px-3 py-2 font-semibold">Mes</th>
                        <th className="text-right px-3 py-2 font-semibold">Compras</th>
                        <th className="text-right px-3 py-2 font-semibold">Monto</th>
                        <th className="text-right px-3 py-2 font-semibold">% del total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {comprasPorMes.length === 0 ? (
                        <tr><td colSpan={4} className="text-center py-8 text-gray-400">Sin datos en el período</td></tr>
                      ) : comprasPorMes.map(m => (
                        <tr key={m.mes} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-medium">{m.mes}</td>
                          <td className="px-3 py-2 text-right text-gray-500">{m.count}</td>
                          <td className="px-3 py-2 text-right font-semibold">{formatMonto(m.total)}</td>
                          <td className="px-3 py-2 text-right text-orange-700">
                            {totalMonto > 0 ? ((m.total / totalMonto) * 100).toFixed(1) : '0.0'}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {comprasPorMes.length > 0 && (
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

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {compWeekDateObjs.map((_, i) => {
              const c = WEEK_COLORS[i]
              const cnt = vencCompras.rows.filter((r: any) => r.fridayIdx === i).length
              const noPaga = compTotNoPaga[i]
              return (
                <div key={i} className={`card p-4 border-t-4 ${c.bg} ${c.border}`}>
                  <p className={`text-xs font-semibold uppercase tracking-wide ${c.label}`}>Semana {i + 1}</p>
                  <input type="date" value={compWeekDates[i]}
                    onChange={e => { const nd = [...compWeekDates]; nd[i] = e.target.value; setCompWeekDates(nd) }}
                    className="text-xs text-gray-600 border border-gray-200 rounded px-1.5 py-0.5 mt-0.5 mb-2 w-full bg-white focus:outline-none focus:border-gray-400" />
                  <p className={`text-lg font-bold ${c.text}`}>{formatMonto(compTotProbable[i])}</p>
                  {noPaga > 0 && (
                    <p className="text-[11px] text-red-500 mt-0.5">
                      No pagará: −{formatMonto(noPaga)} · bruto {formatMonto(vencCompras.totals[i])}
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
              <span className="text-xs text-green-600 font-medium">↳ Probable pago</span>
              <span className="text-sm font-bold text-green-700">{formatMonto(compGrandProbable)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-red-500 font-medium">↳ No pagará</span>
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
                      <td key={i} className="table-cell text-right text-brand-800">{t > 0 ? formatMonto(t) : '—'}</td>
                    ))}
                    <td className="table-cell" />
                  </tr>
                  <tr className="bg-green-50 text-xs font-semibold">
                    <td colSpan={4} className="table-cell text-right sticky left-0 bg-green-50 z-10 text-green-700">↳ Probable Pago</td>
                    {compTotProbable.map((t, i) => (
                      <td key={i} className="table-cell text-right text-green-700">{t > 0 ? formatMonto(t) : '—'}</td>
                    ))}
                    <td className="table-cell" />
                  </tr>
                  <tr className="bg-red-50 text-xs font-semibold">
                    <td colSpan={4} className="table-cell text-right sticky left-0 bg-red-50 z-10 text-red-600">↳ No Pagará</td>
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
      )}
    </div>
  )
}
