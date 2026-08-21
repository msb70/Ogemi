'use client'

import { useState, Fragment } from 'react'
import { formatMonto, formatDate } from '@/lib/utils'
import { Download } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  TRAMOS, TRAMO_LABELS, TRAMO_COLORS_HEX, BUCKETS, normTramo,
  exportXLSX, buildKpiSheet,
} from '../reportes.utils'
import FiltrosBar, { type FiltrosBarProps } from './FiltrosBar'

type ComprasSubTab = 'listado' | 'cxp' | 'antiguedad' | 'porproveedor' | 'pormes'

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
  const [agruparProveedor, setAgruparProveedor] = useState(false)

  // Listado ordenado por fecha de la factura descendente
  const comprasOrdenadas = [...comprasFiltradas].sort((a: any, b: any) =>
    a.fecha === b.fecha ? 0 : (a.fecha < b.fecha ? 1 : -1)
  )

  // Totales del listado (mismos cálculos que las tarjetas KPI; se imprimen al pie del PDF)
  const totalCompras = comprasFiltradas.reduce((s, c) => s + (c.total || 0), 0)
  const totalPagado = comprasFiltradas.reduce((s, c) => s + (c.estado === 'pagada' ? (c.total || 0) : (c.monto_pagado || 0)), 0)
  const totalPendienteCompras = comprasFiltradas.reduce((s, c) => s + (c.estado === 'pendiente' ? (c.total || 0) - (c.monto_pagado || 0) : 0), 0)

  const filaCompra = (c: any) => {
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
  }
  // Antigüedad de cartera (pivot proveedor × tramo)
  const [antExpandidos, setAntExpandidos] = useState<Record<string, boolean>>({})
  const [antMostrarTodas, setAntMostrarTodas] = useState(false)

  const pivotAntData: Record<string, Record<string, number>> = {}
  const comprasPorProveedor: Record<string, any[]> = {}
  cxp.forEach((c: any) => {
    const k = c.proveedor || 'N/A'
    if (!pivotAntData[k]) { pivotAntData[k] = {}; comprasPorProveedor[k] = [] }
    comprasPorProveedor[k].push(c)
    const tramo = normTramo(c.tramo)
    pivotAntData[k][tramo] = (pivotAntData[k][tramo] || 0) + (c.saldo_pendiente ?? c.total ?? 0)
  })
  const proveedoresAnt = Object.keys(pivotAntData).sort()
  const totalCarteraCxp = cxp.reduce((s: number, c: any) => s + (c.saldo_pendiente ?? c.total ?? 0), 0)

  return (
    <div className="p-6 space-y-4">
      <div className={`flex gap-2 flex-wrap ${comprasTab === 'listado' ? 'print:hidden' : ''}`}>
        {[
          { key: 'listado',      label: 'Listado' },
          { key: 'cxp',          label: 'Cuentas por pagar' },
          { key: 'antiguedad',   label: 'Antigüedad de cartera' },
          { key: 'porproveedor', label: 'Por proveedor' },
          { key: 'pormes',       label: 'Por período' },
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
        <div className="space-y-3 listado-compras-print">
          <div className="flex items-center justify-between flex-wrap gap-2 print:hidden">
            <FiltrosBar {...{ search, setSearch, fechaDesde, setFechaDesde, fechaHasta, setFechaHasta }} />
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
              <input type="checkbox" className="w-4 h-4 accent-brand-600 cursor-pointer"
                checked={agruparProveedor} onChange={e => setAgruparProveedor(e.target.checked)} />
              Agrupar por proveedor
            </label>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 print:hidden">
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
                ) : agruparProveedor ? (
                  Object.entries(
                    comprasOrdenadas.reduce((acc: Record<string, any[]>, c: any) => {
                      const k = c.proveedores?.nombre || 'Sin nombre'
                      ;(acc[k] = acc[k] || []).push(c)
                      return acc
                    }, {})
                  )
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([nombre, cs]) => (
                      <Fragment key={nombre}>
                        <tr className="bg-brand-50/40 border-t border-gray-200">
                          <td colSpan={5} className="table-cell font-semibold text-brand-800">
                            {nombre} <span className="text-xs text-gray-400 font-normal print:hidden">({cs.length} compra{cs.length === 1 ? '' : 's'})</span>
                          </td>
                          <td className="table-cell text-right font-bold text-brand-800">
                            {formatMonto(cs.reduce((s, c) => s + (c.total || 0), 0))}
                          </td>
                          <td className="table-cell text-right font-bold text-green-700">
                            {formatMonto(cs.reduce((s, c) => s + (c.monto_pagado || 0), 0))}
                          </td>
                          <td className="table-cell text-right font-bold text-orange-600">
                            {formatMonto(cs.reduce((s, c) => s + (c.estado === 'pagada' ? 0 : (c.total || 0) - (c.monto_pagado || 0)), 0))}
                          </td>
                          <td />
                        </tr>
                        {cs.map(filaCompra)}
                      </Fragment>
                    ))
                ) : comprasOrdenadas.map(filaCompra)}
              </tbody>
            </table>
          </div>
          {/* Totales al pie — solo en el PDF (en pantalla se ven las tarjetas de arriba) */}
          <div className="hidden print:block">
            <table className="print-totales">
              <tbody>
                <tr><td>Total compras</td><td>{formatMonto(totalCompras)}</td></tr>
                <tr><td>Pagado (incluye abonos)</td><td>{formatMonto(totalPagado)}</td></tr>
                <tr><td>Pendiente</td><td>{formatMonto(totalPendienteCompras)}</td></tr>
                <tr><td># Compras</td><td>{comprasFiltradas.length}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {comprasTab === 'cxp' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
            {TRAMOS.map(tramo => {
              const items = cxp.filter((c: any) => normTramo(c.tramo) === tramo)
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
                {cxp.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-gray-400">Sin cuentas por pagar</td></tr>
                ) : Object.entries(
                    cxp.reduce((acc: Record<string, any[]>, c: any) => {
                      const k = c.proveedor || 'N/A'
                      ;(acc[k] = acc[k] || []).push(c)
                      return acc
                    }, {})
                  )
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([nombre, items]) => [nombre, (items as any[]).sort((a, b) => b.dias_vencida - a.dias_vencida)] as [string, any[]])
                    .map(([nombre, items]) => (
                      <Fragment key={nombre}>
                        <tr className="bg-brand-50/40 border-t border-gray-200">
                          <td colSpan={4} className="table-cell font-semibold text-brand-800">
                            {nombre} <span className="text-xs text-gray-400 font-normal">({items.length} compra{items.length === 1 ? '' : 's'})</span>
                          </td>
                          <td className="table-cell text-right font-bold text-brand-800">
                            {formatMonto(items.reduce((s: number, c: any) => s + (c.saldo_pendiente ?? c.total), 0))}
                          </td>
                          <td />
                        </tr>
                        {items.map((c: any) => (
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
                              <span className="badge text-xs" style={{ backgroundColor: TRAMO_COLORS_HEX[normTramo(c.tramo)] + '20', color: TRAMO_COLORS_HEX[normTramo(c.tramo)] }}>
                                {TRAMO_LABELS[normTramo(c.tramo)]}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </Fragment>
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
                    TRAMO_LABELS[normTramo(c.tramo)] || c.tramo, c.total, c.monto_pagado || 0, c.saldo_pendiente ?? c.total,
                  ]),
                ] },
              ])
            }}>
              <Download size={14} />Exportar Excel
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
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
                                {normTramo(c.tramo) === b.key ? (
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

    </div>
  )
}
