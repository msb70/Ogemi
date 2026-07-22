'use client'

import { useMemo, useState } from 'react'
import { formatMonto, formatDate, tramoColor } from '@/lib/utils'
import { Download } from 'lucide-react'
import { CarteraVencida } from '@/types'
import { exportXLSX, buildKpiSheet, TRAMO_LABELS, normTramo, isNC } from '../reportes.utils'

/**
 * Estado de cuenta por cliente, con dos vistas:
 *
 * - Cliente: TODAS las facturas pendientes del cliente (sin filtro de fechas),
 *   con su saldo real (total − retención − abonos) tomado de la vista
 *   cartera_vencida — la misma fuente que usa el resto de los reportes.
 * - Movimiento: TODAS las ventas del cliente (pagadas y pendientes) con KPIs
 *   de # facturas, pagadas, vencidas, saldo deudor, monto facturado y pagado.
 */

type EstadoCuentaSubTab = 'cliente' | 'movimiento'

interface EstadoCuentaTabProps {
  cartera: CarteraVencida[]
  facturas: any[]
}

export default function EstadoCuentaTab({ cartera, facturas }: EstadoCuentaTabProps) {
  const [subTab, setSubTab] = useState<EstadoCuentaSubTab>('cliente')

  return (
    <div className="p-6 space-y-4">
      <div className="flex gap-2 flex-wrap">
        {[
          { key: 'cliente',    label: 'Cliente' },
          { key: 'movimiento', label: 'Movimiento' },
        ].map(s => (
          <button key={s.key} onClick={() => setSubTab(s.key as EstadoCuentaSubTab)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              subTab === s.key ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-200 text-gray-600 hover:border-gray-300'
            }`}>
            {s.label}
          </button>
        ))}
      </div>

      {subTab === 'cliente' && <EstadoCuentaCliente cartera={cartera} />}
      {subTab === 'movimiento' && <MovimientoCliente facturas={facturas} />}
    </div>
  )
}

// ── Sub-vista: Estado de cuenta (solo facturas pendientes) ───────────────────

function EstadoCuentaCliente({ cartera }: { cartera: CarteraVencida[] }) {
  const [cliente, setCliente] = useState('')

  // Clientes con saldo pendiente (derivados de la cartera)
  const clientes = useMemo(
    () => Array.from(new Set(cartera.map(c => c.cliente).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [cartera],
  )

  const pendientes = useMemo(
    () => cartera
      .filter(c => c.cliente === cliente)
      .slice()
      .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : (a.numero_factura || 0) - (b.numero_factura || 0))),
    [cartera, cliente],
  )

  const totFacturado = pendientes.reduce((s, c) => s + (c.total || 0), 0)
  const totAbonado   = pendientes.reduce((s, c) => s + (c.monto_pagado || 0), 0)
  const totSaldo     = pendientes.reduce((s, c) => s + (c.saldo_pendiente ?? c.total ?? 0), 0)
  const vencidas     = pendientes.filter(c => (c.dias_vencida || 0) > 0)

  // Saldo corrido acumulado sobre las pendientes (orden cronológico)
  let running = 0
  const rows = pendientes.map(c => {
    running += c.saldo_pendiente ?? c.total ?? 0
    return { ...c, saldo_acum: running }
  })

  const exportExcel = () => {
    const hoy = new Date().toISOString().split('T')[0]
    exportXLSX(`estado_cuenta_${cliente.replace(/\s+/g, '_')}_${hoy}.xlsx`, [
      buildKpiSheet(`Estado de cuenta — ${cliente}`, `Facturas pendientes al ${hoy}`, [
        ['# Facturas pendientes', pendientes.length],
        ['# Vencidas', vencidas.length],
        ['Total facturado', totFacturado],
        ['Abonado', totAbonado],
        ['Saldo adeudado', totSaldo],
      ]),
      { name: 'Pendientes', rows: [
        ['Fecha', 'N° Factura', 'Vence', 'Días vencida', 'Antigüedad', 'Total', 'Abonado', 'Saldo', 'Saldo acumulado'],
        ...rows.map(c => [
          c.fecha, c.numero_factura, c.fecha_pago,
          c.dias_vencida > 0 ? c.dias_vencida : 0,
          TRAMO_LABELS[normTramo(c.tramo)] || c.tramo,
          c.total, c.monto_pagado || 0,
          c.saldo_pendiente ?? c.total, c.saldo_acum,
        ]),
      ] },
    ])
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <select className="input w-72" value={cliente} onChange={e => setCliente(e.target.value)}>
          <option value="">Seleccionar cliente...</option>
          {clientes.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {cliente && (
          <button className="btn-secondary flex items-center gap-2 text-sm py-1.5" onClick={exportExcel}>
            <Download size={14} />Exportar Excel
          </button>
        )}
      </div>

      {!cliente ? (
        <div className="card p-10 text-center text-gray-400 text-sm">
          Seleccione un cliente para generar su estado de cuenta.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Facturas pendientes', val: `${pendientes.length} (${vencidas.length} vencidas)`, color: 'text-gray-700' },
              { label: 'Total facturado',     val: formatMonto(totFacturado), color: 'text-brand-700' },
              { label: 'Abonado',             val: formatMonto(totAbonado),   color: 'text-green-700' },
              { label: 'Saldo adeudado',      val: formatMonto(totSaldo),     color: totSaldo > 0 ? 'text-red-600' : 'text-green-700' },
            ].map(s => (
              <div key={s.label} className="card p-3">
                <p className="text-xs text-gray-500">{s.label}</p>
                <p className={`text-lg font-bold ${s.color}`}>{s.val}</p>
              </div>
            ))}
          </div>

          <div className="card overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Estado de cuenta · {cliente} · Facturas pendientes al {formatDate(new Date().toISOString().split('T')[0])}
              </p>
            </div>
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="table-header">Fecha</th>
                  <th className="table-header">#Factura</th>
                  <th className="table-header">Vence</th>
                  <th className="table-header">Antigüedad</th>
                  <th className="table-header text-right">Total</th>
                  <th className="table-header text-right">Abonado</th>
                  <th className="table-header text-right">Saldo</th>
                  <th className="table-header text-right">Saldo acum.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-8 text-gray-400">El cliente no tiene facturas pendientes</td></tr>
                ) : rows.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="table-cell text-sm">{formatDate(c.fecha)}</td>
                    <td className="table-cell font-mono text-sm">#{c.numero_factura}</td>
                    <td className="table-cell text-sm">{formatDate(c.fecha_pago)}</td>
                    <td className="table-cell">
                      <span className={`badge text-xs ${tramoColor(normTramo(c.tramo))}`}>
                        {TRAMO_LABELS[normTramo(c.tramo)] || c.tramo}{c.dias_vencida > 0 ? ` · ${c.dias_vencida}d` : ''}
                      </span>
                    </td>
                    <td className="table-cell text-right">{formatMonto(c.total)}</td>
                    <td className="table-cell text-right text-green-700">{c.monto_pagado ? formatMonto(c.monto_pagado) : ''}</td>
                    <td className="table-cell text-right font-semibold">{formatMonto(c.saldo_pendiente ?? c.total)}</td>
                    <td className="table-cell text-right font-semibold text-gray-500">{formatMonto(c.saldo_acum)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                  <td colSpan={4} className="table-cell text-right text-sm text-gray-600">TOTALES</td>
                  <td className="table-cell text-right text-brand-700">{formatMonto(totFacturado)}</td>
                  <td className="table-cell text-right text-green-700">{formatMonto(totAbonado)}</td>
                  <td className="table-cell text-right text-red-600">{formatMonto(totSaldo)}</td>
                  <td className="table-cell" />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ── Sub-vista: Movimiento del cliente (todas las ventas) ─────────────────────

function MovimientoCliente({ facturas }: { facturas: any[] }) {
  const [cliente, setCliente] = useState('')
  const hoy = new Date().toISOString().split('T')[0]

  // Ventas = facturas sin notas de crédito
  const ventas = useMemo(() => facturas.filter((f: any) => !isNC(f.tipo_documento)), [facturas])

  // Todos los clientes con al menos una factura
  const clientes = useMemo(
    () => Array.from(new Set(ventas.map((f: any) => f.clientes?.nombre).filter(Boolean) as string[]))
      .sort((a, b) => a.localeCompare(b)),
    [ventas],
  )

  const movs = useMemo(
    () => ventas
      .filter((f: any) => f.clientes?.nombre === cliente)
      .slice()
      .sort((a: any, b: any) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : (Number(a.numero_factura) || 0) - (Number(b.numero_factura) || 0))),
    [ventas, cliente],
  )

  // Saldo de una factura: solo pendientes deben dinero (total − retención − abonos)
  const saldoDe = (f: any) => f.estado === 'pendiente'
    ? Math.max((f.total || 0) - (f.retencion_monto || 0) - (f.monto_pagado || 0), 0)
    : 0
  // Pagado de una factura: pagadas completas + abonos de pendientes
  const pagadoDe = (f: any) => f.estado === 'pagada' ? (f.total || 0) : (f.monto_pagado || 0)

  const pagadas        = movs.filter((f: any) => f.estado === 'pagada')
  const vencidas       = movs.filter((f: any) => f.estado === 'pendiente' && f.fecha_pago && f.fecha_pago < hoy)
  const montoFacturado = movs.reduce((s: number, f: any) => s + (f.total || 0), 0)
  const montoPagado    = movs.reduce((s: number, f: any) => s + pagadoDe(f), 0)
  const saldoDeudor    = movs.reduce((s: number, f: any) => s + saldoDe(f), 0)

  const estadoBadge = (f: any) => {
    if (f.estado === 'pagada') return <span className="badge bg-green-100 text-green-700">Cobrada</span>
    if (f.estado === 'falta_retencion') return <span className="badge bg-amber-100 text-amber-700">Falta retención</span>
    if (f.fecha_pago && f.fecha_pago < hoy) return <span className="badge bg-red-100 text-red-700">Vencida</span>
    return <span className="badge bg-orange-100 text-orange-700">Pendiente</span>
  }

  const exportExcel = () => {
    exportXLSX(`movimiento_${cliente.replace(/\s+/g, '_')}_${hoy}.xlsx`, [
      buildKpiSheet(`Movimiento de cliente — ${cliente}`, `Todas las ventas al ${hoy}`, [
        ['# Facturas', movs.length],
        ['# Pagadas', pagadas.length],
        ['# Vencidas', vencidas.length],
        ['Monto facturado', montoFacturado],
        ['Monto pagado', montoPagado],
        ['Saldo deudor', saldoDeudor],
      ]),
      { name: 'Movimiento', rows: [
        ['Fecha', 'N° Factura', 'Tipo Doc', 'Vencimiento', 'Estado', 'Total', 'Pagado', 'Saldo'],
        ...movs.map((f: any) => [
          f.fecha, f.numero_factura, f.tipo_documento, f.fecha_pago,
          f.estado === 'pagada' ? 'Cobrada'
            : f.estado === 'falta_retencion' ? 'Falta retención'
            : (f.fecha_pago && f.fecha_pago < hoy) ? 'Vencida' : 'Pendiente',
          f.total, pagadoDe(f), saldoDe(f),
        ]),
      ] },
    ])
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <select className="input w-72" value={cliente} onChange={e => setCliente(e.target.value)}>
          <option value="">Seleccionar cliente...</option>
          {clientes.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {cliente && (
          <button className="btn-secondary flex items-center gap-2 text-sm py-1.5" onClick={exportExcel}>
            <Download size={14} />Exportar Excel
          </button>
        )}
      </div>

      {!cliente ? (
        <div className="card p-10 text-center text-gray-400 text-sm">
          Seleccione un cliente para ver su movimiento.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            {[
              { label: '# Facturas',      val: String(movs.length),        color: 'text-gray-700' },
              { label: 'Pagadas',         val: String(pagadas.length),     color: 'text-green-700' },
              { label: 'Vencidas',        val: String(vencidas.length),    color: 'text-red-600' },
              { label: 'Monto facturado', val: formatMonto(montoFacturado), color: 'text-brand-700' },
              { label: 'Monto pagado',    val: formatMonto(montoPagado),    color: 'text-green-700' },
              { label: 'Saldo deudor',    val: formatMonto(saldoDeudor),    color: saldoDeudor > 0 ? 'text-red-600' : 'text-green-700' },
            ].map(s => (
              <div key={s.label} className="card p-3">
                <p className="text-xs text-gray-500">{s.label}</p>
                <p className={`text-lg font-bold ${s.color}`}>{s.val}</p>
              </div>
            ))}
          </div>

          <div className="card overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Movimiento · {cliente} · Todas las ventas al {formatDate(hoy)}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="table-header">Fecha</th>
                    <th className="table-header">#Factura</th>
                    <th className="table-header">Tipo</th>
                    <th className="table-header">Vencimiento</th>
                    <th className="table-header">Estado</th>
                    <th className="table-header text-right">Total</th>
                    <th className="table-header text-right">Pagado</th>
                    <th className="table-header text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {movs.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-8 text-gray-400">El cliente no tiene facturas</td></tr>
                  ) : movs.map((f: any) => {
                    const saldo = saldoDe(f)
                    return (
                      <tr key={f.id} className="hover:bg-gray-50">
                        <td className="table-cell text-sm">{formatDate(f.fecha)}</td>
                        <td className="table-cell font-mono text-sm">#{f.numero_factura}</td>
                        <td className="table-cell text-xs text-gray-400">{f.tipo_documento}</td>
                        <td className={`table-cell text-sm ${f.estado === 'pendiente' && f.fecha_pago && f.fecha_pago < hoy ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                          {formatDate(f.fecha_pago)}
                        </td>
                        <td className="table-cell">{estadoBadge(f)}</td>
                        <td className="table-cell text-right">{formatMonto(f.total)}</td>
                        <td className="table-cell text-right text-green-700">{pagadoDe(f) ? formatMonto(pagadoDe(f)) : ''}</td>
                        <td className="table-cell text-right font-semibold">{saldo > 0 ? formatMonto(saldo) : ''}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                    <td colSpan={5} className="table-cell text-right text-sm text-gray-600">TOTALES</td>
                    <td className="table-cell text-right text-brand-700">{formatMonto(montoFacturado)}</td>
                    <td className="table-cell text-right text-green-700">{formatMonto(montoPagado)}</td>
                    <td className="table-cell text-right text-red-600">{formatMonto(saldoDeudor)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
