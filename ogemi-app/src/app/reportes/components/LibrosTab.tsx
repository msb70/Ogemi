'use client'

import { useState } from 'react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Download } from 'lucide-react'
import { isNC, exportCSV } from '../reportes.utils'
import FiltrosBar, { type FiltrosBarProps } from './FiltrosBar'

type LibroSubTab = 'venta' | 'compra'

export interface LibrosTabProps extends Omit<FiltrosBarProps, 'search' | 'setSearch'> {
  libroVentaFiltrado: any[]
  libroCompraFiltrado: any[]
  ventasFiltradas: any[]
  ncFiltradas: any[]
}

export default function LibrosTab({
  libroVentaFiltrado, libroCompraFiltrado, ventasFiltradas, ncFiltradas,
  fechaDesde, setFechaDesde, fechaHasta, setFechaHasta,
}: LibrosTabProps) {
  const [libroTab, setLibroTab] = useState<LibroSubTab>('venta')

  // FiltrosBar sin búsqueda — pasamos dummies para satisfacer la interfaz
  const noopSearch = ''
  const noopSetSearch = (_v: string) => {}

  return (
    <div className="p-6 space-y-4">
      <div className="flex gap-2 flex-wrap">
        {[
          { key: 'venta',  label: 'Libro de Venta' },
          { key: 'compra', label: 'Libro de Compra' },
        ].map(s => (
          <button key={s.key} onClick={() => setLibroTab(s.key as LibroSubTab)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              libroTab === s.key ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-200 text-gray-600 hover:border-gray-300'
            }`}>
            {s.label}
          </button>
        ))}
      </div>

      {libroTab === 'venta' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <FiltrosBar
              search={noopSearch} setSearch={noopSetSearch}
              fechaDesde={fechaDesde} setFechaDesde={setFechaDesde}
              fechaHasta={fechaHasta} setFechaHasta={setFechaHasta}
              showSearch={false}
            />
            <button className="btn-secondary flex items-center gap-2 text-sm py-1.5" onClick={() =>
              exportCSV(
                ['N°', 'Fecha', 'Cliente', 'Tipo Documento', 'Doc. Afectado', 'Monto Gravable', 'ITBMS', 'Total'],
                libroVentaFiltrado.map((f, i) => [
                  i + 1, f.fecha, f.clientes?.nombre, f.tipo_documento,
                  f.documento_afectado || '', f.monto, f.itbms, f.total,
                ]),
                `libro_venta_${fechaDesde}_${fechaHasta}.csv`
              )
            }>
              <Download size={14} />Exportar CSV
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Total ventas',      val: ventasFiltradas.reduce((s, f) => s + (f.total || 0), 0),              color: 'text-brand-700' },
              { label: 'Total NC',          val: ncFiltradas.reduce((s, f) => s + Math.abs(f.total || 0), 0),          color: 'text-amber-600' },
              { label: 'ITBMS recaudado',   val: ventasFiltradas.reduce((s, f) => s + (f.itbms || 0), 0),              color: 'text-purple-600' },
              { label: 'Neto (Ventas - NC)', val: ventasFiltradas.reduce((s, f) => s + (f.total || 0), 0) - ncFiltradas.reduce((s, f) => s + Math.abs(f.total || 0), 0), color: 'text-green-700' },
            ].map(s => (
              <div key={s.label} className="card p-3">
                <p className="text-xs text-gray-500">{s.label}</p>
                <p className={`text-lg font-bold ${s.color}`}>{formatCurrency(s.val as number)}</p>
              </div>
            ))}
          </div>

          <div className="card overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Libro de Ventas · {fechaDesde} al {fechaHasta}
              </p>
            </div>
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="table-header w-10">N°</th>
                  <th className="table-header">Fecha</th>
                  <th className="table-header">#Factura</th>
                  <th className="table-header">Cliente</th>
                  <th className="table-header">Tipo Documento</th>
                  <th className="table-header">Doc. Afectado</th>
                  <th className="table-header text-right">Monto Gravable</th>
                  <th className="table-header text-right">ITBMS (7%)</th>
                  <th className="table-header text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {libroVentaFiltrado.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-8 text-gray-400">Sin registros en el período</td></tr>
                ) : libroVentaFiltrado.map((f, i) => {
                  const esNC = isNC(f.tipo_documento)
                  return (
                    <tr key={f.id} className={`hover:bg-gray-50 ${esNC ? 'bg-amber-50/40' : ''}`}>
                      <td className="table-cell text-gray-400 text-xs w-10">{i + 1}</td>
                      <td className="table-cell text-sm">{formatDate(f.fecha)}</td>
                      <td className="table-cell font-mono text-sm">#{f.numero_factura}</td>
                      <td className="table-cell max-w-[180px]">
                        <span className="truncate block text-sm">{f.clientes?.nombre}</span>
                      </td>
                      <td className="table-cell">
                        <span className={`badge text-xs ${esNC ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                          {f.tipo_documento}
                        </span>
                      </td>
                      <td className="table-cell text-sm text-gray-400">
                        {f.documento_afectado ? `#${f.documento_afectado}` : '—'}
                      </td>
                      <td className="table-cell text-right">
                        <span className={esNC ? 'text-amber-600' : ''}>{formatCurrency(Math.abs(f.monto))}</span>
                      </td>
                      <td className="table-cell text-right text-gray-500">{formatCurrency(Math.abs(f.itbms))}</td>
                      <td className="table-cell text-right font-semibold">
                        <span className={esNC ? 'text-amber-700' : 'text-brand-700'}>{formatCurrency(Math.abs(f.total))}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                  <td colSpan={6} className="table-cell text-right text-sm text-gray-600">TOTALES</td>
                  <td className="table-cell text-right text-brand-700">
                    {formatCurrency(libroVentaFiltrado.reduce((s, f) => s + Math.abs(f.monto || 0), 0))}
                  </td>
                  <td className="table-cell text-right text-gray-600">
                    {formatCurrency(libroVentaFiltrado.reduce((s, f) => s + Math.abs(f.itbms || 0), 0))}
                  </td>
                  <td className="table-cell text-right text-brand-800">
                    {formatCurrency(libroVentaFiltrado.reduce((s, f) => s + Math.abs(f.total || 0), 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {libroTab === 'compra' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <FiltrosBar
              search={noopSearch} setSearch={noopSetSearch}
              fechaDesde={fechaDesde} setFechaDesde={setFechaDesde}
              fechaHasta={fechaHasta} setFechaHasta={setFechaHasta}
              showSearch={false}
            />
            <button className="btn-secondary flex items-center gap-2 text-sm py-1.5" onClick={() =>
              exportCSV(
                ['N°', 'Fecha', 'Proveedor', 'Concepto', 'Referencia', 'Monto Gravable', 'ITBMS', 'Total', 'Estado'],
                libroCompraFiltrado.map((c, i) => [
                  i + 1, c.fecha, c.proveedores?.nombre, c.concepto || '',
                  c.referencia || '', c.monto, c.itbms, c.total, c.estado,
                ]),
                `libro_compra_${fechaDesde}_${fechaHasta}.csv`
              )
            }>
              <Download size={14} />Exportar CSV
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Total compras',      val: libroCompraFiltrado.reduce((s, c) => s + (c.total || 0), 0),                         color: 'text-orange-600' },
              { label: 'ITBMS acreditable',  val: libroCompraFiltrado.reduce((s, c) => s + (c.itbms || 0), 0),                         color: 'text-purple-600' },
              { label: 'Pagadas',            val: libroCompraFiltrado.filter(c => c.estado === 'pagada').reduce((s, c) => s + (c.total || 0), 0), color: 'text-green-600' },
              { label: 'Pendientes',         val: libroCompraFiltrado.filter(c => c.estado === 'pendiente').reduce((s, c) => s + (c.total || 0), 0), color: 'text-red-600' },
            ].map(s => (
              <div key={s.label} className="card p-3">
                <p className="text-xs text-gray-500">{s.label}</p>
                <p className={`text-lg font-bold ${s.color}`}>{formatCurrency(s.val as number)}</p>
              </div>
            ))}
          </div>

          <div className="card overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Libro de Compras · {fechaDesde} al {fechaHasta}
              </p>
            </div>
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="table-header w-10">N°</th>
                  <th className="table-header">Fecha</th>
                  <th className="table-header">Proveedor</th>
                  <th className="table-header">Concepto</th>
                  <th className="table-header">Referencia</th>
                  <th className="table-header text-right">Monto Gravable</th>
                  <th className="table-header text-right">ITBMS (7%)</th>
                  <th className="table-header text-right">Total</th>
                  <th className="table-header">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {libroCompraFiltrado.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-8 text-gray-400">Sin registros en el período</td></tr>
                ) : libroCompraFiltrado.map((c, i) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="table-cell text-gray-400 text-xs">{i + 1}</td>
                    <td className="table-cell text-sm">{formatDate(c.fecha)}</td>
                    <td className="table-cell font-medium max-w-[150px]">
                      <span className="truncate block">{c.proveedores?.nombre}</span>
                    </td>
                    <td className="table-cell text-sm text-gray-500 max-w-[150px]">
                      <span className="truncate block">{c.concepto || '—'}</span>
                    </td>
                    <td className="table-cell text-sm font-mono text-gray-400">{c.referencia || '—'}</td>
                    <td className="table-cell text-right">{formatCurrency(c.monto)}</td>
                    <td className="table-cell text-right text-gray-500">{formatCurrency(c.itbms)}</td>
                    <td className="table-cell text-right font-semibold text-orange-700">{formatCurrency(c.total)}</td>
                    <td className="table-cell">
                      <span className={`badge text-xs ${c.estado === 'pagada' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                        {c.estado === 'pagada' ? 'Pagada' : 'Pendiente'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                  <td colSpan={5} className="table-cell text-right text-sm text-gray-600">TOTALES</td>
                  <td className="table-cell text-right text-orange-700">
                    {formatCurrency(libroCompraFiltrado.reduce((s, c) => s + (c.monto || 0), 0))}
                  </td>
                  <td className="table-cell text-right text-gray-600">
                    {formatCurrency(libroCompraFiltrado.reduce((s, c) => s + (c.itbms || 0), 0))}
                  </td>
                  <td className="table-cell text-right text-orange-800">
                    {formatCurrency(libroCompraFiltrado.reduce((s, c) => s + (c.total || 0), 0))}
                  </td>
                  <td className="table-cell" />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
