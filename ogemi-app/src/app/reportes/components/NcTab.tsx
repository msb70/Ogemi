'use client'

import { formatMonto, formatDate } from '@/lib/utils'
import { Download } from 'lucide-react'
import { exportXLSX, buildKpiSheet } from '../reportes.utils'
import FiltrosBar, { type FiltrosBarProps } from './FiltrosBar'

/**
 * Listado de notas de crédito — se usa como sub-pestaña de Reportes → Ventas.
 * (El reporte "por cliente" de NC se eliminó a pedido del usuario, 2026-07-22.)
 */

interface NcTabProps extends FiltrosBarProps {
  ncFiltradas: any[]
}

export default function NcTab({
  ncFiltradas,
  search, setSearch, fechaDesde, setFechaDesde, fechaHasta, setFechaHasta,
}: NcTabProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2 print:hidden">
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
      <div className="grid grid-cols-2 gap-4 print:hidden">
        <div className="card p-4">
          <p className="text-xs font-semibold uppercase text-gray-500">Número de notas de crédito</p>
          <p className="text-2xl font-bold text-gray-900">{ncFiltradas.length.toLocaleString('es-PA')}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-semibold uppercase text-gray-500">Total notas de crédito</p>
          <p className="text-2xl font-bold text-amber-700">{formatMonto(ncFiltradas.reduce((s, f) => s + Math.abs(f.total || 0), 0))}</p>
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
                <td className="table-cell text-right">{formatMonto(Math.abs(f.monto))}</td>
                <td className="table-cell text-right font-semibold text-amber-700">{formatMonto(Math.abs(f.total))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Totales al pie — solo en el PDF */}
      <div className="hidden print:block">
        <table className="print-totales">
          <tbody>
            <tr><td>Número de notas de crédito</td><td>{ncFiltradas.length.toLocaleString('es-PA')}</td></tr>
            <tr><td>Total notas de crédito</td><td>{formatMonto(ncFiltradas.reduce((s, f) => s + Math.abs(f.total || 0), 0))}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
