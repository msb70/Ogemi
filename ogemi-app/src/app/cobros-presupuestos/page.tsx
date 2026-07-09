'use client'

import { useEffect, useRef, useState } from 'react'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { createClient } from '@/lib/supabase'
import { formatCurrency, formatDate, tramoColor, classifyTramo } from '@/lib/utils'
import { Presupuesto, BancoCuenta, Cliente } from '@/types'
import { Search, X, CheckCircle, CreditCard, ClipboardList } from 'lucide-react'
import { Toast } from '@/components/Toast'
import { useToast } from '@/hooks/useToast'
import PermissionGuard, { withPagePermission } from '@/components/PermissionGuard'

/** Saldo cobrable de un presupuesto: total − pagado */
const saldoPresupuesto = (p: Presupuesto) => (p.total || 0) - (p.monto_pagado || 0)

interface SelItem {
  checked: boolean
  monto: string // efectivo a cobrar (default = saldo → cobro completo)
}

function CobrosPresupuestosPage() {
  const supabase = createClient()
  const { toast, showToast, hideToast } = useToast()

  // Selección de cliente (autocomplete)
  const [clienteSearch, setClienteSearch] = useState('')
  const [clienteResults, setClienteResults] = useState<Cliente[]>([])
  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([])
  const [loading, setLoading] = useState(false)
  const [sel, setSel] = useState<Record<string, SelItem>>({})

  const [cuentas, setCuentas] = useState<BancoCuenta[]>([])
  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0])
  const [cuentaId, setCuentaId] = useState('')
  const [referencia, setReferencia] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.from('banco_cuentas').select('*').eq('activo', true).order('nombre')
      .then(({ data }) => {
        setCuentas(data || [])
        if (data && data[0]) setCuentaId(data[0].id)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!clienteSearch.trim() || cliente) { setClienteResults([]); return }
    debounceRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from('clientes')
        .select('*')
        .ilike('nombre', `%${clienteSearch.trim()}%`)
        .eq('activo', true)
        .order('nombre')
        .limit(15)
      setClienteResults(data || [])
      setShowDropdown(true)
    }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteSearch, cliente])

  const loadCliente = async (c: Cliente) => {
    setCliente(c)
    setClienteSearch(c.nombre)
    setShowDropdown(false)
    setSel({})
    setLoading(true)
    const { data } = await supabase
      .from('presupuestos')
      .select('*')
      .eq('cliente_id', c.id)
      .eq('estado', 'pendiente')
      .gt('total', 0)
      .order('fecha', { ascending: true })
      .order('numero_presupuesto', { ascending: true })
    setPresupuestos(data || [])
    setLoading(false)
  }

  const reset = () => {
    setCliente(null)
    setClienteSearch('')
    setPresupuestos([])
    setSel({})
    setReferencia('')
  }

  const toggle = (p: Presupuesto) => {
    setSel(prev => {
      const cur = prev[p.id]
      if (cur?.checked) return { ...prev, [p.id]: { checked: false, monto: '' } }
      return { ...prev, [p.id]: { checked: true, monto: saldoPresupuesto(p).toFixed(2) } }
    })
  }

  const setMonto = (p: Presupuesto, monto: string) => {
    setSel(prev => ({ ...prev, [p.id]: { checked: true, monto } }))
  }

  const seleccionados = presupuestos.filter(p => sel[p.id]?.checked)
  const total = seleccionados.reduce((s, p) => s + (parseFloat(sel[p.id]?.monto || '') || 0), 0)

  const errores: string[] = []
  for (const p of seleccionados) {
    const m = parseFloat(sel[p.id]?.monto || '') || 0
    if (m <= 0) errores.push(`Presupuesto #${p.numero_presupuesto}: indica un monto.`)
    if (m > saldoPresupuesto(p) + 0.009) errores.push(`Presupuesto #${p.numero_presupuesto}: el monto supera el saldo (${formatCurrency(saldoPresupuesto(p))}).`)
  }
  if (total > 0 && !cuentaId) errores.push('Selecciona la cuenta bancaria del depósito.')

  const puedeGuardar = !saving && errores.length === 0 && total > 0

  const handleRegistrar = async () => {
    if (!cliente || !puedeGuardar) return
    setSaving(true)
    const pagos = seleccionados
      .map(p => ({ presupuesto_id: p.id, monto: parseFloat(sel[p.id]?.monto || '') || 0 }))
      .filter(p => p.monto > 0)
    const { data, error } = await supabase.rpc('registrar_cobro_lote_presupuestos', {
      p_cliente_id: cliente.id,
      p_fecha: fecha,
      p_cuenta_id: cuentaId,
      p_referencia: referencia.trim() || null,
      p_pagos: pagos,
    })
    setSaving(false)
    if (error) {
      showToast(`No se pudo registrar el cobro: ${error.message}`, 'error')
      return
    }
    const r = data as { pagados_completos?: number; abonados?: number; total_efectivo?: number }
    showToast(
      `Cobro registrado: ${r?.pagados_completos || 0} presupuesto(s) pagados, ${r?.abonados || 0} abonado(s) · Banco: ${formatCurrency(r?.total_efectivo || 0)}`,
      'success'
    )
    setReferencia('')
    loadCliente(cliente)
  }

  const getDiasVencido = (p: Presupuesto): number => {
    if (!p.fecha_pago) return 0
    return Math.floor((Date.now() - new Date(p.fecha_pago + 'T00:00:00').getTime()) / 86400000)
  }

  return (
    <AppLayout>
      {toast && <Toast {...toast} onClose={hideToast} />}
      <Header title="Cobro de presupuestos" subtitle="Cobro múltiple de presupuestos por cliente" />

      {/* Selector de cliente */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="relative max-w-xl">
          <label className="label">Cliente</label>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="input pl-9"
              placeholder="Buscar cliente..."
              value={clienteSearch}
              onChange={e => { setClienteSearch(e.target.value); if (cliente) setCliente(null) }}
              onFocus={() => { if (clienteResults.length > 0 && !cliente) setShowDropdown(true) }}
            />
            {(clienteSearch || cliente) && (
              <button onClick={reset} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={14} />
              </button>
            )}
          </div>
          {showDropdown && clienteResults.length > 0 && !cliente && (
            <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
              {clienteResults.map(c => (
                <button
                  key={c.id}
                  onClick={() => loadCliente(c)}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 border-b border-gray-50 last:border-0"
                >
                  {c.nombre}
                  <span className="text-xs text-gray-400 ml-2">{c.dias_credito} días crédito</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4">
        {!cliente ? (
          <div className="text-center py-20 text-gray-400">
            <ClipboardList size={40} className="mx-auto mb-3 text-gray-300" />
            <p className="text-sm">Busca y selecciona un cliente para ver sus presupuestos pendientes.</p>
          </div>
        ) : loading ? (
          <div className="text-center py-20 text-gray-400">Cargando presupuestos...</div>
        ) : (
          <>
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-700">
                  Presupuestos pendientes ({presupuestos.length})
                </p>
                {presupuestos.length > 0 && (
                  <button
                    className="text-xs text-brand-600 hover:text-brand-800 font-medium"
                    onClick={() => {
                      const todos = presupuestos.every(p => sel[p.id]?.checked)
                      if (todos) { setSel({}) } else {
                        const next: Record<string, SelItem> = {}
                        presupuestos.forEach(p => { next[p.id] = { checked: true, monto: saldoPresupuesto(p).toFixed(2) } })
                        setSel(next)
                      }
                    }}
                  >
                    {presupuestos.every(p => sel[p.id]?.checked) ? 'Deseleccionar todo' : 'Seleccionar todo'}
                  </button>
                )}
              </div>
              {presupuestos.length === 0 ? (
                <p className="text-center py-10 text-sm text-gray-400">Este cliente no tiene presupuestos pendientes.</p>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="table-header w-10"></th>
                      <th className="table-header">#Presupuesto</th>
                      <th className="table-header">O. Trabajo</th>
                      <th className="table-header">Fecha</th>
                      <th className="table-header">Vence</th>
                      <th className="table-header text-right">Total</th>
                      <th className="table-header text-right">Pagado</th>
                      <th className="table-header text-right">Saldo</th>
                      <th className="table-header text-right w-40">Monto a cobrar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {presupuestos.map(p => {
                      const s = sel[p.id]
                      const checked = !!s?.checked
                      const saldo = saldoPresupuesto(p)
                      const dias = getDiasVencido(p)
                      const tramo = classifyTramo(dias)
                      const monto = parseFloat(s?.monto || '') || 0
                      const esCompleto = checked && Math.abs(monto - saldo) < 0.01
                      return (
                        <tr key={p.id} className={`transition-colors ${checked ? 'bg-brand-50/50' : 'hover:bg-gray-50'}`}>
                          <td className="table-cell">
                            <input type="checkbox" className="w-4 h-4 accent-brand-600 cursor-pointer"
                              checked={checked} onChange={() => toggle(p)} />
                          </td>
                          <td className="table-cell font-mono font-medium">#{p.numero_presupuesto}</td>
                          <td className="table-cell text-gray-500">{p.orden_trabajo || '—'}</td>
                          <td className="table-cell text-gray-500">{formatDate(p.fecha)}</td>
                          <td className="table-cell">
                            <div className="flex flex-col">
                              <span className="text-xs">{formatDate(p.fecha_pago)}</span>
                              <span className={`badge mt-0.5 text-xs ${tramoColor(tramo)}`}>{tramo}</span>
                            </div>
                          </td>
                          <td className="table-cell text-right">{formatCurrency(p.total)}</td>
                          <td className="table-cell text-right text-green-600">
                            {(p.monto_pagado || 0) > 0 ? formatCurrency(p.monto_pagado || 0) : '—'}
                          </td>
                          <td className="table-cell text-right font-semibold text-orange-600">{formatCurrency(saldo)}</td>
                          <td className="table-cell">
                            {checked ? (
                              <div className="flex flex-col items-end gap-0.5">
                                <input
                                  type="number" step="0.01" min="0" max={saldo}
                                  className="input text-sm text-right py-1.5"
                                  value={s.monto}
                                  onChange={e => setMonto(p, e.target.value)}
                                />
                                <span className={`text-[10px] font-medium ${esCompleto ? 'text-green-600' : 'text-blue-600'}`}>
                                  {esCompleto ? 'Cobro completo' : 'Abono'}
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs text-gray-300 block text-right">—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {seleccionados.length > 0 && (
              <div className="card p-5">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div>
                    <label className="label">Fecha de cobro</label>
                    <input type="date" className="input" value={fecha} onChange={e => setFecha(e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Cuenta bancaria <span className="text-red-500">*</span></label>
                    <select className="input" value={cuentaId} onChange={e => setCuentaId(e.target.value)}>
                      <option value="">Seleccionar cuenta...</option>
                      {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre} – {c.banco}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Referencia</label>
                    <input className="input" placeholder="Depósito, transferencia, cheque..."
                      value={referencia} onChange={e => setReferencia(e.target.value)} />
                  </div>
                </div>

                <div className="bg-gray-50 rounded-xl p-4 mb-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-gray-500 uppercase font-semibold">Presupuestos</p>
                    <p className="font-bold text-gray-900">{seleccionados.length}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase font-semibold">Total a cobrar</p>
                    <p className="font-bold text-green-700">{formatCurrency(total)}</p>
                  </div>
                </div>

                {total > 0 && (
                  <div className="flex items-center gap-2 text-xs text-blue-700 bg-blue-50 rounded-lg px-3 py-2 mb-3">
                    <CreditCard size={14} />
                    Se registrará <strong>una sola transacción de banco</strong> (ingreso) por {formatCurrency(total)}.
                  </div>
                )}

                {errores.length > 0 && (
                  <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3 space-y-0.5">
                    {errores.map((e, i) => <p key={i}>⚠ {e}</p>)}
                  </div>
                )}

                <PermissionGuard modulo="presupuestos" accion="editar">
                  <button
                    className="btn-primary w-full flex items-center justify-center gap-2"
                    disabled={!puedeGuardar}
                    onClick={handleRegistrar}
                  >
                    <CheckCircle size={16} />
                    {saving ? 'Registrando...' : 'Registrar cobro'}
                  </button>
                </PermissionGuard>
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  )
}

export default withPagePermission(CobrosPresupuestosPage, 'presupuestos', 'ver')
