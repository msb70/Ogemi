'use client'

import { useState } from 'react'
import { formatCurrency, formatDate, tramoColor } from '@/lib/utils'
import { Download } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts'
import { CarteraVencida } from '@/types'
import {
  TRAMOS, TRAMO_LABELS, TRAMO_COLORS_HEX, PIE_COLORS, exportCSV,
} from '../reportes.utils'
import FiltrosBar, { type FiltrosBarProps } from './FiltrosBar'
import PivotTab from './PivotTab'

type VentasSubTab =
  | 'listado'
  | 'cartera'
  | 'porcliente'
  | 'pormes'
  | 'vencimiento_pivot'
  | 'antiguedad_pivot'

interface VentasTabProps extends FiltrosBarProps {
  ventasFiltradas: any[]
  facturas: any[]
  cartera: CarteraVencida[]
  topClientesVentas: [string, number][]
  ventasPorMes: { mes: string; ventas: number; count: number }[]
}

export default function VentasTab({
  ventasFiltradas, facturas, cartera, topClientesVentas, ventasPorMes,
  search, setSearch, fechaDesde, setFechaDesde, fechaHasta, setFechaHasta,
}: VentasTabProps) {
  const [ventasTab, setVentasTab] = useState<VentasSubTab>('listado')

  return (
    <div className="p-6 space-y-4">
      <div className="flex gap-2 flex-wrap">
        {[
          { key: 'listado',    label: 'Listado' },
          { key: 'cartera',    label: 'Cartera vencida' },
          { key: 'porcliente', label: 'Por cliente' },
          { key: 'pormes',     label: 'Por período' },
          { key: 'vencimiento_pivot', label: 'Vencimiento x semana' },
          { key: 'antiguedad_pivot',  label: 'Antigüedad de cartera' },
        ].map(s => (
          <button key={s.key} onClick={() => setVentasTab(s.key as VentasSubTab)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              ventasTab === s.key ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-200 text-gray-600 hover:border-gray-300'
            }`}>
            {s.label}
          </button>
        ))}
      </div>

      {ventasTab === 'listado' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <FiltrosBar {...{ search, setSearch, fechaDesde, setFechaDesde, fechaHasta, setFechaHasta }} />
            <button className="btn-secondary flex items-center gap-2 text-sm py-1.5" onClick={() =>
              exportCSV(
                ['#Factura','Fecha','Cliente','Tipo Doc','Monto','ITBMS','Total','Estado','Vencimiento'],
                ventasFiltradas.map(f => [f.numero_factura, f.fecha, f.clientes?.nombre, f.tipo_documento, f.monto, f.itbms, f.total, f.estado, f.fecha_pago]),
                `ventas_${new Date().toISOString().split('T')[0]}.csv`
              )
            }>
              <Download size={14} />Exportar
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Total facturado', val: ventasFiltradas.reduce((s, f) => s + (f.total || 0), 0), color: 'text-brand-700' },
              { label: 'Cobrado', val: ventasFiltradas.filter(f => f.estado === 'pagada').reduce((s, f) => s + (f.total || 0), 0), color: 'text-green-600' },
              { label: 'Pendiente', val: ventasFiltradas.filter(f => f.estado === 'pendiente').reduce((s, f) => s + (f.total || 0), 0), color: 'text-orange-600' },
              { label: '# Facturas', val: ventasFiltradas.length, color: 'text-gray-700', isCnt: true },
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
                {ventasFiltradas.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-8 text-gray-400">Sin resultados</td></tr>
                ) : ventasFiltradas.slice(0, 200).map((f: any) => (
                  <tr key={f.id} className="hover:bg-gray-50">
                    <td className="table-cell font-mono text-sm text-gray-500">#{f.numero_factura}</td>
                    <td className="table-cell text-sm">{formatDate(f.fecha)}</td>
                    <td className="table-cell max-w-[200px]"><span className="truncate block">{f.clientes?.nombre}</span></td>
                    <td className="table-cell text-xs text-gray-400">{f.tipo_documento}</td>
                    <td className="table-cell text-right font-semibold">{formatCurrency(f.total)}</td>
                    <td className="table-cell">
                      <span className={`badge ${f.estado === 'pagada' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                        {f.estado === 'pagada' ? 'Cobrada' : 'Pendiente'}
                      </span>
                    </td>
                    <td className="table-cell text-sm text-gray-400">{formatDate(f.fecha_pago)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {ventasTab === 'cartera' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
            {TRAMOS.map(tramo => {
              const items = cartera.filter(c => c.tramo === tramo)
              return (
                <div key={tramo} className="card p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-3 h-3 rounded-full" style={{ background: TRAMO_COLORS_HEX[tramo] }} />
                    <span className="text-xs font-medium text-gray-600">{TRAMO_LABELS[tramo]}</span>
                  </div>
                  <p className="text-lg font-bold">{formatCurrency(items.reduce((s, c) => s + (c.saldo_pendiente ?? c.total), 0))}</p>
                  <p className="text-xs text-gray-400">{items.length} facturas</p>
                </div>
              )
            })}
          </div>
          <div className="card p-4 bg-brand-50 border-brand-200">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-brand-700">Total cartera pendiente</span>
              <span className="text-2xl font-bold text-brand-800">{formatCurrency(cartera.reduce((s, c) => s + (c.saldo_pendiente ?? c.total), 0))}</span>
            </div>
          </div>
          <div className="card overflow-hidden">
            <table className="w-full">
              <thead><tr className="border-b border-gray-200">
                <th className="table-header">#Factura</th>
                <th className="table-header">Fecha</th>
                <th className="table-header">Cliente</th>
                <th className="table-header">Vencimiento</th>
                <th className="table-header text-right">Total</th>
                <th className="table-header text-right">Saldo</th>
                <th className="table-header text-right">Días</th>
                <th className="table-header">Tramo</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {cartera.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="table-cell font-mono">#{c.numero_factura}</td>
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

      {ventasTab === 'porcliente' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Top clientes</h3>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={topClientesVentas.slice(0, 10).map(([n, v]) => ({ name: n.substring(0, 18), monto: v }))}
                  layout="vertical" margin={{ left: 10, right: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={130} />
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  <Bar dataKey="monto" name="Ventas" fill="#0284c7" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Distribución</h3>
              <ResponsiveContainer width="100%" height={320}>
                <PieChart>
                  <Pie data={topClientesVentas.slice(0, 8).map(([n, v]) => ({ name: n.substring(0, 20), value: v }))}
                    cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2} dataKey="value">
                    {topClientesVentas.slice(0, 8).map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {ventasTab === 'pormes' && (
        <div className="space-y-4">
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Facturación mensual</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={ventasPorMes} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} />
                <Bar dataKey="ventas" name="Ventas" fill="#0284c7" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {ventasTab === 'vencimiento_pivot' && (
        <PivotTab key="ventas-vencimiento-pivot" facturas={facturas} cartera={cartera} initialTab="semanal" hideTabs />
      )}

      {ventasTab === 'antiguedad_pivot' && (
        <PivotTab key="ventas-antiguedad-pivot" facturas={facturas} cartera={cartera} initialTab="antigüedad" hideTabs />
      )}
    </div>
  )
}
