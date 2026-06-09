'use client'

import { useState } from 'react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Download, TrendingUp, TrendingDown } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import { exportCSV } from '../reportes.utils'

type BancoSubTab = 'movimientos' | 'flujo' | 'cierres'

export interface BancoTabProps {
  cuentas: any[]
  saldos: Record<string, number>
  movimientos: any[]
  cierres: any[]
  flujoPorMes: { mes: string; ingresos: number; egresos: number; neto: number }[]
  cuentaSeleccionada: string
  setCuentaSeleccionada: (v: string) => void
  fechaDesde: string
  setFechaDesde: (v: string) => void
  fechaHasta: string
  setFechaHasta: (v: string) => void
  loadMovimientos: () => void
  loadCierres: () => void
}

export default function BancoTab({
  cuentas, saldos, movimientos, cierres, flujoPorMes,
  cuentaSeleccionada, setCuentaSeleccionada,
  fechaDesde, setFechaDesde, fechaHasta, setFechaHasta,
  loadMovimientos, loadCierres,
}: BancoTabProps) {
  const [bancoTab, setBancoTab] = useState<BancoSubTab>('movimientos')

  const handleTabChange = (t: BancoSubTab) => {
    setBancoTab(t)
    if (t === 'movimientos') loadMovimientos()
    if (t === 'cierres') loadCierres()
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex gap-2 flex-wrap mb-2">
        {[
          { key: 'movimientos', label: 'Movimientos' },
          { key: 'flujo',       label: 'Flujo de caja' },
          { key: 'cierres',     label: 'Cierres de mes' },
        ].map(s => (
          <button key={s.key} onClick={() => handleTabChange(s.key as BancoSubTab)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              bancoTab === s.key ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-200 text-gray-600 hover:border-gray-300'
            }`}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {cuentas.map(c => (
          <div key={c.id} className="card p-4">
            <p className="text-xs text-gray-500">{c.nombre} · {c.banco}</p>
            <p className={`text-xl font-bold mt-0.5 ${(saldos[c.id] || 0) >= 0 ? 'text-green-700' : 'text-red-600'}`}>
              {formatCurrency(saldos[c.id] || 0)}
            </p>
          </div>
        ))}
      </div>

      {bancoTab === 'movimientos' && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <select className="input text-sm py-1.5 max-w-[240px]" value={cuentaSeleccionada}
              onChange={e => setCuentaSeleccionada(e.target.value)}>
              {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre} – {c.banco}</option>)}
            </select>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">Desde</label>
              <input type="date" className="input text-sm py-1.5 max-w-[140px]" value={fechaDesde}
                onChange={e => setFechaDesde(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">Hasta</label>
              <input type="date" className="input text-sm py-1.5 max-w-[140px]" value={fechaHasta}
                onChange={e => setFechaHasta(e.target.value)} />
            </div>
            <button className="btn-secondary text-sm py-1.5 flex items-center gap-1"
              onClick={() => exportCSV(
                ['Fecha', 'Tipo', 'Concepto', 'Referencia', 'Monto'],
                movimientos.map(m => [m.fecha, m.tipo, m.concepto, m.referencia, m.monto]),
                `movimientos_${new Date().toISOString().split('T')[0]}.csv`
              )}>
              <Download size={14} />Exportar
            </button>
          </div>
          <div className="card overflow-hidden">
            <table className="w-full">
              <thead><tr className="border-b border-gray-200">
                <th className="table-header">Fecha</th>
                <th className="table-header">Concepto</th>
                <th className="table-header">Referencia</th>
                <th className="table-header">Tipo</th>
                <th className="table-header text-right">Monto</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {movimientos.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-8 text-gray-400">Sin movimientos</td></tr>
                ) : movimientos.map(m => (
                  <tr key={m.id} className="hover:bg-gray-50">
                    <td className="table-cell text-sm">{formatDate(m.fecha)}</td>
                    <td className="table-cell">{m.concepto}</td>
                    <td className="table-cell text-xs text-gray-400">{m.referencia || '—'}</td>
                    <td className="table-cell">
                      <span className={`badge flex items-center gap-1 w-fit ${m.tipo === 'ingreso' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {m.tipo === 'ingreso' ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                        {m.tipo}
                      </span>
                    </td>
                    <td className={`table-cell text-right font-semibold ${m.tipo === 'ingreso' ? 'text-green-700' : 'text-red-600'}`}>
                      {m.tipo === 'egreso' ? '-' : ''}{formatCurrency(m.monto)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {bancoTab === 'flujo' && (
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Flujo de caja mensual</h3>
          {flujoPorMes.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-400 text-sm">Sin datos</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={flujoPorMes} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Bar dataKey="ingresos" name="Ingresos" fill="#22c55e" radius={[4, 4, 0, 0]} />
                <Bar dataKey="egresos" name="Egresos" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {bancoTab === 'cierres' && (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead><tr className="border-b border-gray-200">
              <th className="table-header">Período</th>
              <th className="table-header">Cuenta</th>
              <th className="table-header text-right">Saldo sistema</th>
              <th className="table-header text-right">Saldo banco</th>
              <th className="table-header text-right">Diferencia</th>
              <th className="table-header">Estado</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {cierres.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-gray-400">Sin cierres</td></tr>
              ) : cierres.map(c => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="table-cell font-medium">{c.periodo}</td>
                  <td className="table-cell text-sm text-gray-500">{(c.banco_cuentas as any)?.nombre}</td>
                  <td className="table-cell text-right">{formatCurrency(c.saldo_sistema)}</td>
                  <td className="table-cell text-right">{formatCurrency(c.saldo_banco)}</td>
                  <td className={`table-cell text-right font-semibold ${Math.abs(c.diferencia) < 0.01 ? 'text-green-600' : 'text-red-600'}`}>
                    {c.diferencia >= 0 ? '+' : ''}{formatCurrency(c.diferencia)}
                  </td>
                  <td className="table-cell">
                    <span className={`badge ${c.cerrado ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {c.cerrado ? 'Cerrado' : 'Abierto'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
