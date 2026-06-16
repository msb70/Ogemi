'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import { BancoCuenta } from '@/types'
import { TrendingUp, TrendingDown, Lock, FileText } from 'lucide-react'

type Resumen = {
  cuenta_id: string
  periodo: string
  desde: string
  hasta: string
  saldo_inicial: number
  total_ingresos: number
  total_egresos: number
  saldo_final: number
  cerrado: boolean
  saldo_banco_cierre: number | null
  diferencia_cierre: number | null
}

type Linea = {
  fecha: string
  concepto: string
  referencia: string | null
  tipo: 'ingreso' | 'egreso'
  ingreso: number
  egreso: number
  saldo: number
}

const num = (v: unknown): number => (v == null ? 0 : Number(v))

export default function EstadoCuentaTab({
  cuentas,
  cuentaInicial,
  showToast,
}: {
  cuentas: BancoCuenta[]
  cuentaInicial?: string
  showToast: (msg: string, type?: 'success' | 'error') => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const { profile } = useAuth()
  const esAdmin = profile?.rol_id === 'admin'

  const [cuentaId, setCuentaId] = useState<string>(cuentaInicial || '')
  const [periodo, setPeriodo] = useState<string>(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [resumen, setResumen] = useState<Resumen | null>(null)
  const [lineas, setLineas] = useState<Linea[]>([])
  const [loading, setLoading] = useState(false)
  const [reabriendo, setReabriendo] = useState(false)

  useEffect(() => {
    if (!cuentaId && cuentas.length > 0) setCuentaId(cuentas[0].id)
  }, [cuentas, cuentaId])

  const cargar = useCallback(async () => {
    if (!cuentaId || !periodo) return
    setLoading(true)
    const [{ data: resData, error: resErr }, { data: detData, error: detErr }] = await Promise.all([
      supabase.rpc('estado_cuenta_mes_resumen', { p_cuenta_id: cuentaId, p_periodo: periodo }),
      supabase.rpc('estado_cuenta_mes', { p_cuenta_id: cuentaId, p_periodo: periodo }),
    ])
    if (resErr || detErr) {
      showToast(`Error al cargar estado de cuenta: ${(resErr || detErr)?.message}`, 'error')
      setResumen(null)
      setLineas([])
      setLoading(false)
      return
    }
    const r = Array.isArray(resData) ? resData[0] : resData
    setResumen(
      r
        ? {
            ...r,
            saldo_inicial: num(r.saldo_inicial),
            total_ingresos: num(r.total_ingresos),
            total_egresos: num(r.total_egresos),
            saldo_final: num(r.saldo_final),
            saldo_banco_cierre: r.saldo_banco_cierre == null ? null : num(r.saldo_banco_cierre),
            diferencia_cierre: r.diferencia_cierre == null ? null : num(r.diferencia_cierre),
          }
        : null
    )
    setLineas(
      (detData || []).map((l: Linea) => ({
        ...l,
        ingreso: num(l.ingreso),
        egreso: num(l.egreso),
        saldo: num(l.saldo),
      }))
    )
    setLoading(false)
  }, [cuentaId, periodo, supabase, showToast])

  useEffect(() => {
    cargar()
  }, [cargar])

  const handleReabrir = async () => {
    if (!resumen?.cerrado || !cuentaId) return
    const ok = window.confirm(
      `¿Reabrir el cierre de ${periodo}? Esto permitirá volver a modificar los movimientos del período. La acción queda registrada en la bitácora.`
    )
    if (!ok) return
    setReabriendo(true)
    const { error } = await supabase
      .from('cierre_mes')
      .update({ cerrado: false })
      .eq('cuenta_id', cuentaId)
      .eq('periodo', periodo)
    setReabriendo(false)
    if (error) {
      showToast(error.message, 'error')
      return
    }
    showToast('Cierre reabierto', 'success')
    cargar()
  }

  const nombreCuenta = cuentas.find(c => c.id === cuentaId)?.nombre || ''

  return (
    <div className="space-y-4">
      {/* Controles */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Cuenta bancaria</label>
          <select className="input max-w-xs" value={cuentaId} onChange={e => setCuentaId(e.target.value)}>
            {cuentas.map(c => (
              <option key={c.id} value={c.id}>{c.nombre} – {c.banco}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Período (AAAA-MM)</label>
          <input type="month" className="input" value={periodo} onChange={e => setPeriodo(e.target.value)} />
        </div>
        {resumen && (
          <span
            className={`badge flex items-center gap-1 mb-1 ${
              resumen.cerrado ? 'bg-gray-200 text-gray-700' : 'bg-green-100 text-green-700'
            }`}
          >
            {resumen.cerrado && <Lock size={12} />}
            {resumen.cerrado ? 'Mes cerrado' : 'Mes abierto'}
          </span>
        )}
        {resumen?.cerrado && esAdmin && (
          <button
            className="btn-secondary flex items-center gap-2 mb-1"
            onClick={handleReabrir}
            disabled={reabriendo}
          >
            <Lock size={14} />
            {reabriendo ? 'Reabriendo…' : 'Reabrir cierre'}
          </button>
        )}
      </div>

      {/* KPIs */}
      {resumen && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="card p-4">
            <p className="text-xs text-gray-500">Saldo inicial</p>
            <p className="text-lg font-bold text-gray-800">{formatCurrency(resumen.saldo_inicial)}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-500">Ingresos del mes</p>
            <p className="text-lg font-bold text-green-700">{formatCurrency(resumen.total_ingresos)}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-500">Egresos del mes</p>
            <p className="text-lg font-bold text-red-600">{formatCurrency(resumen.total_egresos)}</p>
          </div>
          <div className="card p-4 bg-brand-50">
            <p className="text-xs text-brand-600">Saldo final</p>
            <p className="text-lg font-bold text-brand-800">{formatCurrency(resumen.saldo_final)}</p>
          </div>
        </div>
      )}

      {/* Conciliación si está cerrado */}
      {resumen?.cerrado && resumen.saldo_banco_cierre != null && (
        <div
          className={`card p-4 flex flex-wrap items-center gap-x-8 gap-y-2 ${
            Math.abs(num(resumen.diferencia_cierre)) < 0.01 ? '' : 'border-orange-300'
          }`}
        >
          <div>
            <p className="text-xs text-gray-500">Saldo según banco (cierre)</p>
            <p className="font-semibold text-gray-800">{formatCurrency(num(resumen.saldo_banco_cierre))}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Diferencia con sistema</p>
            <p
              className={`font-semibold ${
                Math.abs(num(resumen.diferencia_cierre)) < 0.01 ? 'text-green-700' : 'text-orange-600'
              }`}
            >
              {formatCurrency(num(resumen.diferencia_cierre))}
            </p>
          </div>
        </div>
      )}

      {/* Detalle con saldo corrido */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <FileText size={16} className="text-brand-600" />
          <h3 className="text-sm font-semibold text-gray-700">
            Estado de cuenta · {nombreCuenta} · {periodo}
          </h3>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="table-header">Fecha</th>
              <th className="table-header">Concepto</th>
              <th className="table-header">Referencia</th>
              <th className="table-header text-right">Ingreso</th>
              <th className="table-header text-right">Egreso</th>
              <th className="table-header text-right">Saldo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {/* Fila de saldo inicial */}
            {resumen && (
              <tr className="bg-gray-50">
                <td className="table-cell text-gray-400">{formatDate(resumen.desde)}</td>
                <td className="table-cell font-medium text-gray-500" colSpan={4}>Saldo inicial</td>
                <td className="table-cell text-right font-semibold text-gray-700">
                  {formatCurrency(resumen.saldo_inicial)}
                </td>
              </tr>
            )}
            {loading ? (
              <tr><td colSpan={6} className="text-center py-10 text-gray-400">Cargando…</td></tr>
            ) : lineas.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-10 text-gray-400">Sin movimientos en el período</td></tr>
            ) : (
              lineas.map((l, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="table-cell text-gray-500">{formatDate(l.fecha)}</td>
                  <td className="table-cell">
                    <span className="flex items-center gap-1.5">
                      {l.tipo === 'ingreso'
                        ? <TrendingUp size={12} className="text-green-600 flex-shrink-0" />
                        : <TrendingDown size={12} className="text-red-500 flex-shrink-0" />}
                      {l.concepto}
                    </span>
                  </td>
                  <td className="table-cell text-gray-400 text-xs">{l.referencia || '—'}</td>
                  <td className="table-cell text-right text-green-700">
                    {l.ingreso > 0 ? formatCurrency(l.ingreso) : '—'}
                  </td>
                  <td className="table-cell text-right text-red-600">
                    {l.egreso > 0 ? formatCurrency(l.egreso) : '—'}
                  </td>
                  <td className="table-cell text-right font-semibold text-gray-800">
                    {formatCurrency(l.saldo)}
                  </td>
                </tr>
              ))
            )}
            {/* Fila de saldo final */}
            {resumen && lineas.length > 0 && (
              <tr className="bg-brand-50 border-t-2 border-brand-200">
                <td className="table-cell text-gray-400">{formatDate(resumen.hasta)}</td>
                <td className="table-cell font-semibold text-brand-800" colSpan={4}>Saldo final</td>
                <td className="table-cell text-right font-bold text-brand-800">
                  {formatCurrency(resumen.saldo_final)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
