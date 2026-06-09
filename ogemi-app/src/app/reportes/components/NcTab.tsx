'use client'

import { useState } from 'react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Download } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { exportCSV } from '../reportes.utils'
import FiltrosBar, { type FiltrosBarProps } from './FiltrosBar'

type NcSubTab = 'listado' | 'porcliente'

interface NcTabProps extends FiltrosBarProps {
  ncFiltradas: any[]
  ncPorCliente: [string, number][]
}

export default function NcTab({
  ncFiltradas, ncPorCliente,
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
            <button className="btn-secondary flex items-center gap-2 text-sm py-1.5" onClick={() =>
              exportCSV(
                ['#Documento','Fecha','Cliente','Tipo','Doc.Afectado','Monto','ITBMS','Total'],
                ncFiltradas.map(f => [f.numero_factura, f.fecha, f.clientes?.nombre, f.tipo_documento, f.documento_afectado, f.monto, f.itbms, f.total]),
                `notas_credito_${new Date().toISOString().split('T')[0]}.csv`
              )
            }>
              <Download size={14} />Exportar
            </button>
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
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Notas de crédito por cliente</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={ncPorCliente.slice(0, 15).map(([n, v]) => ({ name: n.substring(0, 20), monto: v }))}
              layout="vertical" margin={{ left: 10, right: 30 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={140} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} />
              <Bar dataKey="monto" name="NC" fill="#d97706" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
