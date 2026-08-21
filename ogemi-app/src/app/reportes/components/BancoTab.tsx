'use client'

import { useState } from 'react'
import { formatMonto, formatDate } from '@/lib/utils'
import { Download, TrendingUp, TrendingDown } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import { exportXLSX, buildKpiSheet } from '../reportes.utils'
import { ResumenTarjeta } from '@/lib/tarjetas'

type BancoSubTab = 'movimientos' | 'flujo' | 'cierres' | 'tarjetas'

export interface BancoTabProps {
  cuentas: any[]
  saldos: Record<string, number>
  tarjetas: ResumenTarjeta[]
  movimientos: any[]
  cierres: any[]
  flujoMovs: any[]
  flujoDesde: string
  setFlujoDesde: (v: string) => void
  flujoHasta: string
  setFlujoHasta: (v: string) => void
  flujoCuentas: string[]
  setFlujoCuentas: (v: string[]) => void
  cuentaSeleccionada: string
  setCuentaSeleccionada: (v: string) => void
  fechaDesde: string
  setFechaDesde: (v: string) => void
  fechaHasta: string
  setFechaHasta: (v: string) => void
  loadMovimientos: () => void
  loadCierres: () => void
}

function Kpi({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="card p-4">
      <p className="text-[11px] font-semibold uppercase text-gray-500">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
    </div>
  )
}

export default function BancoTab({
  cuentas, saldos, tarjetas, movimientos, cierres,
  flujoMovs, flujoDesde, setFlujoDesde, flujoHasta, setFlujoHasta, flujoCuentas, setFlujoCuentas,
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

  // KPIs de movimientos
  const movIng = movimientos.filter(m => m.tipo === 'ingreso')
  const movEgr = movimientos.filter(m => m.tipo === 'egreso')
  const movIngMonto = movIng.reduce((s, m) => s + (m.monto || 0), 0)
  const movEgrMonto = movEgr.reduce((s, m) => s + (m.monto || 0), 0)

  // Agregados de flujo
  const cuentaById: Record<string, any> = Object.fromEntries(cuentas.map(c => [c.id, c]))
  const flIngCount = flujoMovs.filter(m => m.tipo === 'ingreso').length
  const flEgrCount = flujoMovs.filter(m => m.tipo === 'egreso').length
  const flIngMonto = flujoMovs.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + (m.monto || 0), 0)
  const flEgrMonto = flujoMovs.filter(m => m.tipo === 'egreso').reduce((s, m) => s + (m.monto || 0), 0)

  const flujoPorMes = (() => {
    const map: Record<string, { ingresos: number; egresos: number }> = {}
    flujoMovs.forEach(m => {
      const mes = (m.fecha || '').substring(0, 7)
      if (!map[mes]) map[mes] = { ingresos: 0, egresos: 0 }
      if (m.tipo === 'ingreso') map[mes].ingresos += m.monto || 0
      else map[mes].egresos += m.monto || 0
    })
    return Object.entries(map).sort().map(([mes, v]) => ({ mes, ...v, neto: v.ingresos - v.egresos }))
  })()

  const flujoTabla = (() => {
    const map: Record<string, { mes: string; cuentaId: string; ingCount: number; egrCount: number; ing: number; egr: number }> = {}
    flujoMovs.forEach(m => {
      const mes = (m.fecha || '').substring(0, 7)
      const key = `${mes}|${m.cuenta_id}`
      if (!map[key]) map[key] = { mes, cuentaId: m.cuenta_id, ingCount: 0, egrCount: 0, ing: 0, egr: 0 }
      if (m.tipo === 'ingreso') { map[key].ingCount++; map[key].ing += m.monto || 0 }
      else { map[key].egrCount++; map[key].egr += m.monto || 0 }
    })
    return Object.values(map).sort((a, b) =>
      a.mes !== b.mes ? a.mes.localeCompare(b.mes)
        : (cuentaById[a.cuentaId]?.nombre || '').localeCompare(cuentaById[b.cuentaId]?.nombre || '')
    )
  })()

  const toggleCuentaFlujo = (id: string) => {
    setFlujoCuentas(flujoCuentas.includes(id) ? flujoCuentas.filter(x => x !== id) : [...flujoCuentas, id])
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex gap-2 flex-wrap mb-2 print:hidden">
        {[
          { key: 'movimientos', label: 'Movimientos' },
          { key: 'flujo',       label: 'Flujo de caja' },
          { key: 'tarjetas',    label: 'Tarjetas de crédito' },
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
              {formatMonto(saldos[c.id] || 0)}
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
              onClick={() => {
                const cuenta = cuentas.find(c => c.id === cuentaSeleccionada)
                exportXLSX(`movimientos_${new Date().toISOString().split('T')[0]}.xlsx`, [
                  buildKpiSheet(`Banco — Movimientos (${cuenta?.nombre || ''})`, `${fechaDesde} a ${fechaHasta}`, [
                    ['# Ingresos', movIng.length],
                    ['# Egresos', movEgr.length],
                    ['Monto ingresos', movIngMonto],
                    ['Monto egresos', movEgrMonto],
                    ['Saldo de la cuenta', saldos[cuentaSeleccionada] || 0],
                  ]),
                  { name: 'Movimientos', rows: [
                    ['Fecha', 'Tipo', 'Concepto', 'Referencia', 'Monto', 'Saldo'],
                    ...movimientos.map(m => [m.fecha, m.tipo, m.concepto, m.referencia, m.monto, m.saldo]),
                  ] },
                ])
              }}>
              <Download size={14} />Exportar Excel
            </button>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="# Ingresos" value={movIng.length.toLocaleString('es-PA')} color="text-green-700" />
            <Kpi label="# Egresos" value={movEgr.length.toLocaleString('es-PA')} color="text-red-600" />
            <Kpi label="Monto ingresos" value={formatMonto(movIngMonto)} color="text-green-700" />
            <Kpi label="Monto egresos" value={formatMonto(movEgrMonto)} color="text-red-600" />
          </div>

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-gray-200">
                  <th className="table-header">Fecha</th>
                  <th className="table-header">Concepto</th>
                  <th className="table-header">Referencia</th>
                  <th className="table-header">Tipo</th>
                  <th className="table-header text-right">Monto</th>
                  <th className="table-header text-right">Saldo</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {movimientos.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-8 text-gray-400">Sin movimientos</td></tr>
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
                        {m.tipo === 'egreso' ? '-' : ''}{formatMonto(m.monto)}
                      </td>
                      <td className={`table-cell text-right font-semibold ${(m.saldo || 0) >= 0 ? 'text-gray-800' : 'text-red-600'}`}>
                        {formatMonto(m.saldo || 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {bancoTab === 'flujo' && (
        <div className="space-y-4">
          {/* Filtros */}
          <div className="card p-4 space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">Desde</label>
                <input type="date" className="input text-sm py-1.5 max-w-[140px]" value={flujoDesde}
                  onChange={e => setFlujoDesde(e.target.value)} />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">Hasta</label>
                <input type="date" className="input text-sm py-1.5 max-w-[140px]" value={flujoHasta}
                  onChange={e => setFlujoHasta(e.target.value)} />
              </div>
              <button className="text-xs text-brand-600 hover:text-brand-800"
                onClick={() => setFlujoCuentas(cuentas.map(c => c.id))}>Todas</button>
              <button className="text-xs text-gray-500 hover:text-gray-700"
                onClick={() => setFlujoCuentas([])}>Ninguna</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {cuentas.map(c => {
                const on = flujoCuentas.includes(c.id)
                return (
                  <button key={c.id} onClick={() => toggleCuentaFlujo(c.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      on ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}>
                    {c.nombre} · {c.banco}
                  </button>
                )
              })}
            </div>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="# Depósitos" value={flIngCount.toLocaleString('es-PA')} color="text-green-700" />
            <Kpi label="# Egresos" value={flEgrCount.toLocaleString('es-PA')} color="text-red-600" />
            <Kpi label="Monto depósitos" value={formatMonto(flIngMonto)} color="text-green-700" />
            <Kpi label="Monto egresos" value={formatMonto(flEgrMonto)} color="text-red-600" />
          </div>

          {/* Gráfica */}
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
                  <Tooltip formatter={(v: number) => formatMonto(v)} />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Bar dataKey="ingresos" name="Ingresos" fill="#22c55e" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="egresos" name="Egresos" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Tabla por período/cuenta */}
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase border-b border-gray-200">
                    <th className="text-left px-3 py-2 font-semibold">Período</th>
                    <th className="text-left px-3 py-2 font-semibold">Banco</th>
                    <th className="text-left px-3 py-2 font-semibold">Cuenta</th>
                    <th className="text-right px-3 py-2 font-semibold"># Ingresos</th>
                    <th className="text-right px-3 py-2 font-semibold"># Egresos</th>
                    <th className="text-right px-3 py-2 font-semibold">Ingresos</th>
                    <th className="text-right px-3 py-2 font-semibold">Egresos</th>
                    <th className="text-right px-3 py-2 font-semibold">Saldo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {flujoTabla.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-8 text-gray-400">Sin datos en el período</td></tr>
                  ) : flujoTabla.map(r => {
                    const saldo = r.ing - r.egr
                    return (
                      <tr key={`${r.mes}|${r.cuentaId}`} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-medium">{r.mes}</td>
                        <td className="px-3 py-2 text-gray-600">{cuentaById[r.cuentaId]?.banco || '—'}</td>
                        <td className="px-3 py-2 text-gray-600">{cuentaById[r.cuentaId]?.nombre || '—'}</td>
                        <td className="px-3 py-2 text-right text-gray-500">{r.ingCount}</td>
                        <td className="px-3 py-2 text-right text-gray-500">{r.egrCount}</td>
                        <td className="px-3 py-2 text-right text-green-700">{formatMonto(r.ing)}</td>
                        <td className="px-3 py-2 text-right text-red-600">{formatMonto(r.egr)}</td>
                        <td className={`px-3 py-2 text-right font-semibold ${saldo >= 0 ? 'text-gray-800' : 'text-red-600'}`}>{formatMonto(saldo)}</td>
                      </tr>
                    )
                  })}
                </tbody>
                {flujoTabla.length > 0 && (
                  <tfoot>
                    <tr className="bg-gray-50 border-t border-gray-200 font-bold">
                      <td className="px-3 py-2" colSpan={3}>Total</td>
                      <td className="px-3 py-2 text-right">{flIngCount}</td>
                      <td className="px-3 py-2 text-right">{flEgrCount}</td>
                      <td className="px-3 py-2 text-right text-green-700">{formatMonto(flIngMonto)}</td>
                      <td className="px-3 py-2 text-right text-red-600">{formatMonto(flEgrMonto)}</td>
                      <td className="px-3 py-2 text-right">{formatMonto(flIngMonto - flEgrMonto)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}

      {bancoTab === 'tarjetas' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm text-gray-500">
              Monto a pagar por tarjeta: saldo del último corte menos los pagos aplicados después del corte.
            </p>
            <button className="btn-secondary text-sm py-1.5 flex items-center gap-1"
              onClick={() => {
                exportXLSX(`tarjetas_credito_${new Date().toISOString().split('T')[0]}.xlsx`, [
                  buildKpiSheet('Tarjetas de crédito — A pagar', new Date().toISOString().split('T')[0], [
                    ['Total a pagar', tarjetas.reduce((s, t) => s + t.aPagar, 0)],
                    ['Deuda total actual', tarjetas.reduce((s, t) => s + t.deudaActual, 0)],
                  ]),
                  { name: 'Tarjetas', rows: [
                    ['Tarjeta', 'Banco', 'Fecha corte', 'Saldo al corte', 'Pagos después del corte', 'A pagar', 'Fecha límite de pago', 'Consumos post-corte', 'Deuda actual'],
                    ...tarjetas.map(t => [t.nombre, t.banco, t.fechaCorte, t.saldoAlCorte, t.pagosDespuesCorte, t.aPagar, t.fechaPago, t.consumosPostCorte, t.deudaActual]),
                  ] },
                ])
              }}>
              <Download size={14} />Exportar Excel
            </button>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <Kpi label="Tarjetas" value={String(tarjetas.length)} color="text-gray-800" />
            <Kpi label="Total a pagar" value={formatMonto(tarjetas.reduce((s, t) => s + t.aPagar, 0))} color="text-red-600" />
            <Kpi label="Deuda total actual" value={formatMonto(tarjetas.reduce((s, t) => s + t.deudaActual, 0))} color="text-gray-800" />
          </div>

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px]">
                <thead><tr className="border-b border-gray-200">
                  <th className="table-header">Tarjeta</th>
                  <th className="table-header">Corte</th>
                  <th className="table-header text-right">Saldo al corte</th>
                  <th className="table-header text-right">Pagos post-corte</th>
                  <th className="table-header text-right">A pagar</th>
                  <th className="table-header">Pagar antes de</th>
                  <th className="table-header text-right">Consumos post-corte</th>
                  <th className="table-header text-right">Deuda actual</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {tarjetas.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-8 text-gray-400">
                      No hay cuentas tipo tarjeta de crédito. Créalas en Banco → Cuentas → Nueva cuenta.
                    </td></tr>
                  ) : tarjetas.map(t => (
                    <tr key={t.cuentaId} className="hover:bg-gray-50">
                      <td className="table-cell">
                        <span className="font-medium">{t.nombre}</span>
                        <span className="block text-xs text-gray-400">{t.banco}</span>
                      </td>
                      <td className="table-cell text-sm text-gray-500">{formatDate(t.fechaCorte)}</td>
                      <td className="table-cell text-right">{formatMonto(t.saldoAlCorte)}</td>
                      <td className="table-cell text-right text-green-700">{formatMonto(t.pagosDespuesCorte)}</td>
                      <td className={`table-cell text-right font-bold ${t.aPagar > 0 ? 'text-red-600' : 'text-green-700'}`}>
                        {formatMonto(t.aPagar)}
                      </td>
                      <td className="table-cell">
                        <span className={`text-sm ${t.vencido ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>
                          {formatDate(t.fechaPago)}
                        </span>
                        {t.vencido && <span className="badge bg-red-100 text-red-700 ml-1.5">Vencido</span>}
                      </td>
                      <td className="table-cell text-right text-gray-500">{formatMonto(t.consumosPostCorte)}</td>
                      <td className="table-cell text-right font-semibold">{formatMonto(t.deudaActual)}</td>
                    </tr>
                  ))}
                </tbody>
                {tarjetas.length > 0 && (
                  <tfoot>
                    <tr className="bg-gray-50 border-t border-gray-200 font-bold">
                      <td className="px-3 py-2" colSpan={2}>Total</td>
                      <td className="px-3 py-2 text-right">{formatMonto(tarjetas.reduce((s, t) => s + t.saldoAlCorte, 0))}</td>
                      <td className="px-3 py-2 text-right text-green-700">{formatMonto(tarjetas.reduce((s, t) => s + t.pagosDespuesCorte, 0))}</td>
                      <td className="px-3 py-2 text-right text-red-600">{formatMonto(tarjetas.reduce((s, t) => s + t.aPagar, 0))}</td>
                      <td className="px-3 py-2"></td>
                      <td className="px-3 py-2 text-right">{formatMonto(tarjetas.reduce((s, t) => s + t.consumosPostCorte, 0))}</td>
                      <td className="px-3 py-2 text-right">{formatMonto(tarjetas.reduce((s, t) => s + t.deudaActual, 0))}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
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
                  <td className="table-cell text-right">{formatMonto(c.saldo_sistema)}</td>
                  <td className="table-cell text-right">{formatMonto(c.saldo_banco)}</td>
                  <td className={`table-cell text-right font-semibold ${Math.abs(c.diferencia) < 0.01 ? 'text-green-600' : 'text-red-600'}`}>
                    {c.diferencia >= 0 ? '+' : ''}{formatMonto(c.diferencia)}
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
