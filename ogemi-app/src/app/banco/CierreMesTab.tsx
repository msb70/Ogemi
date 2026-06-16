'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { BancoCuenta } from '@/types'
import {
  CalendarDays, Check, Lock, TrendingUp, TrendingDown,
  CheckCircle, AlertCircle,
} from 'lucide-react'

type Resumen = {
  saldo_inicial: number
  total_ingresos: number
  total_egresos: number
  saldo_final: number
  cerrado: boolean
}

type Linea = {
  id: string
  fecha: string
  concepto: string
  referencia: string | null
  tipo: 'ingreso' | 'egreso'
  ingreso: number
  egreso: number
  saldo: number
  conciliado: boolean
}

const num = (v: unknown): number => (v == null ? 0 : Number(v))

export default function CierreMesTab({
  cuentas,
  cuentaInicial,
  showToast,
  onSaved,
}: {
  cuentas: BancoCuenta[]
  cuentaInicial?: string
  showToast: (msg: string, type?: 'success' | 'error') => void
  onSaved?: () => void
}) {
  const supabase = useMemo(() => createClient(), [])

  const [cuentaId, setCuentaId] = useState<string>(cuentaInicial || '')
  const [periodo, setPeriodo] = useState<string>(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [resumen, setResumen] = useState<Resumen | null>(null)
  const [lineas, setLineas] = useState<Linea[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notas, setNotas] = useState('')

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
      showToast(`Error al cargar cierre: ${(resErr || detErr)?.message}`, 'error')
      setResumen(null)
      setLineas([])
      setLoading(false)
      return
    }
    const r = Array.isArray(resData) ? resData[0] : resData
    setResumen(
      r
        ? {
            saldo_inicial: num(r.saldo_inicial),
            total_ingresos: num(r.total_ingresos),
            total_egresos: num(r.total_egresos),
            saldo_final: num(r.saldo_final),
            cerrado: !!r.cerrado,
          }
        : null
    )
    setLineas(
      (detData || []).map((l: Linea) => ({
        id: l.id,
        fecha: l.fecha,
        concepto: l.concepto,
        referencia: l.referencia,
        tipo: l.tipo,
        ingreso: num(l.ingreso),
        egreso: num(l.egreso),
        saldo: num(l.saldo),
        conciliado: !!l.conciliado,
      }))
    )
    setLoading(false)
  }, [cuentaId, periodo, supabase, showToast])

  useEffect(() => {
    cargar()
  }, [cargar])

  const cerrado = resumen?.cerrado ?? false

  // Conciliar un movimiento (persiste en banco_movimientos)
  const toggleUno = async (id: string, value: boolean) => {
    if (cerrado) return
    setLineas(prev => prev.map(l => (l.id === id ? { ...l, conciliado: value } : l)))
    const { error } = await supabase.from('banco_movimientos').update({ conciliado: value }).eq('id', id)
    if (error) {
      showToast(`No se pudo conciliar: ${error.message}`, 'error')
      setLineas(prev => prev.map(l => (l.id === id ? { ...l, conciliado: !value } : l)))
    }
  }

  const todosMarcados = lineas.length > 0 && lineas.every(l => l.conciliado)

  const marcarTodos = async () => {
    if (cerrado || lineas.length === 0) return
    const value = !todosMarcados
    const ids = lineas.map(l => l.id)
    setLineas(prev => prev.map(l => ({ ...l, conciliado: value })))
    const { error } = await supabase.from('banco_movimientos').update({ conciliado: value }).in('id', ids)
    if (error) {
      showToast(`No se pudo actualizar: ${error.message}`, 'error')
      cargar()
    }
  }

  // Agregados
  const numIngresos = lineas.filter(l => l.tipo === 'ingreso').length
  const numEgresos = lineas.filter(l => l.tipo === 'egreso').length
  const sumaIngConc = lineas.filter(l => l.tipo === 'ingreso' && l.conciliado).reduce((a, l) => a + l.ingreso, 0)
  const sumaEgrConc = lineas.filter(l => l.tipo === 'egreso' && l.conciliado).reduce((a, l) => a + l.egreso, 0)
  const saldoInicial = resumen?.saldo_inicial ?? 0
  const saldoFinal = resumen?.saldo_final ?? 0
  const saldoConciliado = saldoInicial + sumaIngConc - sumaEgrConc
  const diferencia = saldoConciliado - saldoFinal
  const cuadra = !!resumen && Math.abs(diferencia) < 0.01

  const guardar = async () => {
    if (!cuentaId || !resumen || !cuadra || cerrado) return
    setSaving(true)
    const { error } = await supabase.from('cierre_mes').upsert(
      {
        cuenta_id: cuentaId,
        periodo,
        saldo_inicial: saldoInicial,
        saldo_final: saldoFinal,
        saldo_sistema: saldoFinal,
        num_ingresos: numIngresos,
        num_egresos: numEgresos,
        monto_ingresos: resumen.total_ingresos,
        monto_egresos: resumen.total_egresos,
        monto_conciliado: saldoConciliado,
        notas: notas || null,
        cerrado: true,
      },
      { onConflict: 'cuenta_id,periodo' }
    )
    setSaving(false)
    if (error) {
      showToast(`Error al guardar cierre: ${error.message}`, 'error')
      return
    }
    showToast('Cierre de mes guardado', 'success')
    onSaved?.()
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
          <span className={`badge flex items-center gap-1 mb-1 ${cerrado ? 'bg-gray-200 text-gray-700' : 'bg-green-100 text-green-700'}`}>
            {cerrado && <Lock size={12} />}
            {cerrado ? 'Mes cerrado' : 'Mes abierto'}
          </span>
        )}
      </div>

      {/* KPIs del cierre */}
      {resumen && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="card p-4">
            <p className="text-xs text-gray-500">Saldo inicial</p>
            <p className="text-lg font-bold text-gray-800">{formatCurrency(saldoInicial)}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-500">Ingresos del mes</p>
            <p className="text-lg font-bold text-green-700">{formatCurrency(resumen.total_ingresos)}</p>
            <p className="text-xs text-gray-400 mt-0.5">{numIngresos} movimiento{numIngresos === 1 ? '' : 's'}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-500">Egresos del mes</p>
            <p className="text-lg font-bold text-red-600">{formatCurrency(resumen.total_egresos)}</p>
            <p className="text-xs text-gray-400 mt-0.5">{numEgresos} movimiento{numEgresos === 1 ? '' : 's'}</p>
          </div>
          <div className="card p-4 bg-brand-50">
            <p className="text-xs text-brand-600">Saldo final</p>
            <p className="text-lg font-bold text-brand-800">{formatCurrency(saldoFinal)}</p>
          </div>
        </div>
      )}

      {/* Panel de conciliación en vivo */}
      {resumen && (
        <div className={`card p-4 ${cuadra ? 'border-green-300 bg-green-50/40' : 'border-orange-300 bg-orange-50/40'}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
              <div>
                <p className="text-xs text-gray-500">Ingresos conciliados</p>
                <p className="font-semibold text-green-700">{formatCurrency(sumaIngConc)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Egresos conciliados</p>
                <p className="font-semibold text-red-600">{formatCurrency(sumaEgrConc)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Saldo conciliado</p>
                <p className="font-bold text-gray-900">{formatCurrency(saldoConciliado)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Diferencia con saldo final</p>
                <p className={`font-semibold ${cuadra ? 'text-green-700' : 'text-orange-600'}`}>{formatCurrency(diferencia)}</p>
              </div>
            </div>
            <span className={`badge flex items-center gap-1 ${cuadra ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
              {cuadra ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
              {cuadra ? 'Conciliado' : 'Falta conciliar'}
            </span>
          </div>
        </div>
      )}

      {/* Tabla de movimientos del mes con checkmark */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CalendarDays size={16} className="text-brand-600" />
            <h3 className="text-sm font-semibold text-gray-700">
              Movimientos · {nombreCuenta} · {periodo}
            </h3>
          </div>
          <button
            className="btn-secondary flex items-center gap-2 text-xs py-1.5"
            onClick={marcarTodos}
            disabled={cerrado || lineas.length === 0}
          >
            <Check size={14} />
            {todosMarcados ? 'Desmarcar todos' : 'Marcar todos'}
          </button>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="table-header w-10 text-center">
                <input
                  type="checkbox"
                  checked={todosMarcados}
                  disabled={cerrado || lineas.length === 0}
                  onChange={marcarTodos}
                  title={todosMarcados ? 'Desmarcar todos' : 'Marcar todos'}
                  className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 cursor-pointer disabled:cursor-not-allowed"
                />
              </th>
              <th className="table-header">Fecha</th>
              <th className="table-header">Concepto</th>
              <th className="table-header">Referencia</th>
              <th className="table-header">Tipo</th>
              <th className="table-header text-right">Monto</th>
              <th className="table-header text-right">Saldo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={7} className="text-center py-10 text-gray-400">Cargando…</td></tr>
            ) : lineas.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-10 text-gray-400">Sin movimientos en el período</td></tr>
            ) : (
              lineas.map(l => (
                <tr key={l.id} className={`hover:bg-gray-50 ${l.conciliado ? 'bg-green-50/40' : ''}`}>
                  <td className="table-cell text-center">
                    <input
                      type="checkbox"
                      checked={l.conciliado}
                      disabled={cerrado}
                      onChange={e => toggleUno(l.id, e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 cursor-pointer disabled:cursor-not-allowed"
                    />
                  </td>
                  <td className="table-cell text-gray-500">{formatDate(l.fecha)}</td>
                  <td className="table-cell">{l.concepto}</td>
                  <td className="table-cell text-gray-400 text-xs">{l.referencia || '—'}</td>
                  <td className="table-cell">
                    <span className={`badge flex items-center gap-1 w-fit ${l.tipo === 'ingreso' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {l.tipo === 'ingreso' ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                      {l.tipo}
                    </span>
                  </td>
                  <td className={`table-cell text-right font-semibold ${l.tipo === 'ingreso' ? 'text-green-700' : 'text-red-600'}`}>
                    {l.tipo === 'egreso' ? '-' : ''}{formatCurrency(l.tipo === 'ingreso' ? l.ingreso : l.egreso)}
                  </td>
                  <td className="table-cell text-right font-semibold text-gray-800">{formatCurrency(l.saldo)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Notas + guardar */}
      <div className="max-w-lg space-y-3">
        <div>
          <label className="label">Notas</label>
          <textarea
            className="input min-h-[70px] resize-y"
            placeholder="Observaciones del cierre..."
            value={notas}
            disabled={cerrado}
            onChange={e => setNotas(e.target.value)}
          />
        </div>
        {!cuadra && resumen && !cerrado && (
          <p className="text-xs text-orange-600 flex items-center gap-1">
            <AlertCircle size={12} />
            Marca todos los movimientos hasta que el saldo conciliado cuadre con el saldo final para poder cerrar el mes.
          </p>
        )}
        <button
          className="btn-primary w-full"
          onClick={guardar}
          disabled={!cuentaId || !resumen || !cuadra || cerrado || saving}
        >
          {cerrado ? 'Mes ya cerrado' : saving ? 'Guardando…' : 'Guardar cierre de mes'}
        </button>
      </div>
    </div>
  )
}
