'use client'

import { useState } from 'react'
import { formatMonto, formatDate } from '@/lib/utils'
import { CarteraVencida } from '@/types'
import {
  BUCKETS, TRAMO_COLORS_HEX, normTramo, buildPivotAntiguedad,
} from '../reportes.utils'
import VencimientoSemanalVentas from './VencimientoSemanalVentas'

type PivotSubTab = 'semanal' | 'antigüedad'

export interface PivotTabProps {
  facturas: any[]
  cartera: CarteraVencida[]
  initialTab?: PivotSubTab
  hideTabs?: boolean
  /** Fechas controladas para el vencimiento semanal (ej. semanas de Gastos fijos). */
  weekDates?: string[]
  setWeekDates?: (dates: string[]) => void
}

export default function PivotTab({ facturas, cartera, initialTab = 'semanal', hideTabs = false, weekDates, setWeekDates }: PivotTabProps) {
  const [pivotTab, setPivotTab] = useState<PivotSubTab>(initialTab)

  // Antigüedad expand state
  const [antExpandidos, setAntExpandidos] = useState<Record<string, boolean>>({})
  const [antMostrarTodas, setAntMostrarTodas] = useState(false)

  const pivotAnt = buildPivotAntiguedad(cartera)

  return (
    <div className={hideTabs ? 'space-y-4' : 'p-6 space-y-4'}>
      {!hideTabs && (
        <div className="flex gap-2 flex-wrap print:hidden">
          {[
            { key: 'semanal',    label: 'Vencimientos por semana' },
            { key: 'antigüedad', label: 'Antigüedad de cartera' },
          ].map(s => (
            <button key={s.key} onClick={() => setPivotTab(s.key as PivotSubTab)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                pivotTab === s.key ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      {pivotTab === 'semanal' && (
        <VencimientoSemanalVentas facturas={facturas} weekDates={weekDates} setWeekDates={setWeekDates} />
      )}

      {pivotTab === 'antigüedad' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
            {BUCKETS.map(bucket => {
              const total = pivotAnt.clientes.reduce((s: number, c: string) => s + (pivotAnt.data[c]?.[bucket.key] || 0), 0)
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
              <span className="text-sm font-medium text-brand-700">Total cartera pendiente</span>
              <span className="text-2xl font-bold text-brand-800">
                {formatMonto(cartera.reduce((s, c) => s + (c.saldo_pendiente ?? c.total), 0))}
              </span>
            </div>
          </div>

          <div className="flex justify-end print:hidden">
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
              <input type="checkbox" className="w-4 h-4 accent-brand-600 cursor-pointer"
                checked={antMostrarTodas}
                onChange={e => setAntMostrarTodas(e.target.checked)} />
              Mostrar todas las facturas
            </label>
          </div>

          {pivotAnt.clientes.length === 0 ? (
            <div className="card p-12 text-center text-gray-400">No hay cartera pendiente</div>
          ) : (
            <div className="card overflow-auto">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="border-b-2 border-gray-300 bg-gray-50">
                    <th className="table-header text-left sticky left-0 bg-gray-50 z-10 min-w-[220px]">Cliente / Factura</th>
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
                  {pivotAnt.clientes.map((cliente: string) => {
                    const clienteTotal = BUCKETS.reduce((s, b) => s + (pivotAnt.data[cliente]?.[b.key] || 0), 0)
                    const expandido = antMostrarTodas || (antExpandidos[cliente] ?? false)
                    return (
                      <>
                        <tr key={`c-${cliente}`}
                          className="border-b border-gray-200 bg-brand-50/30 hover:bg-brand-50 cursor-pointer"
                          onClick={() => setAntExpandidos(p => ({ ...p, [cliente]: !expandido }))}>
                          <td className="table-cell sticky left-0 bg-brand-50/30 z-10 font-semibold text-brand-800">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs transition-transform ${expandido ? 'rotate-90' : ''}`}>▶</span>
                              {cliente}
                            </div>
                          </td>
                          {BUCKETS.map(b => (
                            <td key={b.key} className="table-cell text-right font-semibold">
                              {(pivotAnt.data[cliente]?.[b.key] || 0) > 0 ? (
                                <span style={{ color: TRAMO_COLORS_HEX[b.key] }}>
                                  {formatMonto(pivotAnt.data[cliente][b.key])}
                                </span>
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                            </td>
                          ))}
                          <td className="table-cell text-right font-bold text-brand-900 bg-brand-50">
                            {formatMonto(clienteTotal)}
                          </td>
                        </tr>

                        {expandido && (pivotAnt.factByCliente[cliente] || []).map((c: any) => (
                          <tr key={`f-${c.id}`} className="border-b border-gray-100 bg-white hover:bg-gray-50">
                            <td className="table-cell sticky left-0 bg-white z-10 pl-10 text-sm">
                              <span className="font-mono text-gray-400 mr-2">#{c.numero_factura}</span>
                              <span className="text-gray-500">Vence: {formatDate(c.fecha_pago)}</span>
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
                      </>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-400 bg-gray-100 font-bold">
                    <td className="table-cell sticky left-0 bg-gray-100 z-10">TOTAL</td>
                    {BUCKETS.map(b => {
                      const total = pivotAnt.clientes.reduce((s: number, c: string) => s + (pivotAnt.data[c]?.[b.key] || 0), 0)
                      return (
                        <td key={b.key} className="table-cell text-right" style={{ color: total > 0 ? TRAMO_COLORS_HEX[b.key] : '#d1d5db' }}>
                          {total > 0 ? formatMonto(total) : '—'}
                        </td>
                      )
                    })}
                    <td className="table-cell text-right text-brand-900 bg-gray-200">
                      {formatMonto(cartera.reduce((s, c) => s + (c.saldo_pendiente ?? c.total), 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
