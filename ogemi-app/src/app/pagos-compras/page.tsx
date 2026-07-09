'use client'

import { useEffect, useRef, useState } from 'react'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { createClient } from '@/lib/supabase'
import { formatCurrency, formatDate, tramoColor, classifyTramo } from '@/lib/utils'
import { Compra, BancoCuenta, Proveedor } from '@/types'
import { Search, X, CheckCircle, CreditCard, ShoppingCart } from 'lucide-react'
import { Toast } from '@/components/Toast'
import { useToast } from '@/hooks/useToast'
import PermissionGuard, { withPagePermission } from '@/components/PermissionGuard'

/** Saldo pagable de una compra: total − pagado */
const saldoCompra = (c: Compra) => (c.total || 0) - (c.monto_pagado || 0)

interface SelItem {
  checked: boolean
  monto: string // efectivo a pagar (default = saldo → pago completo)
}

function PagosComprasPage() {
  const supabase = createClient()
  const { toast, showToast, hideToast } = useToast()

  // Selección de proveedor (autocomplete)
  const [provSearch, setProvSearch] = useState('')
  const [provResults, setProvResults] = useState<Proveedor[]>([])
  const [proveedor, setProveedor] = useState<Proveedor | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [compras, setCompras] = useState<Compra[]>([])
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
    if (!provSearch.trim() || proveedor) { setProvResults([]); return }
    debounceRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from('proveedores')
        .select('*')
        .ilike('nombre', `%${provSearch.trim()}%`)
        .eq('activo', true)
        .order('nombre')
        .limit(15)
      setProvResults(data || [])
      setShowDropdown(true)
    }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provSearch, proveedor])

  const loadProveedor = async (p: Proveedor) => {
    setProveedor(p)
    setProvSearch(p.nombre)
    setShowDropdown(false)
    setSel({})
    setLoading(true)
    const { data } = await supabase
      .from('compras')
      .select('*')
      .eq('proveedor_id', p.id)
      .eq('estado', 'pendiente')
      .gt('total', 0)
      .order('fecha', { ascending: true })
    setCompras(data || [])
    setLoading(false)
  }

  const reset = () => {
    setProveedor(null)
    setProvSearch('')
    setCompras([])
    setSel({})
    setReferencia('')
  }

  const toggle = (c: Compra) => {
    setSel(prev => {
      const cur = prev[c.id]
      if (cur?.checked) return { ...prev, [c.id]: { checked: false, monto: '' } }
      return { ...prev, [c.id]: { checked: true, monto: saldoCompra(c).toFixed(2) } }
    })
  }

  const setMonto = (c: Compra, monto: string) => {
    setSel(prev => ({ ...prev, [c.id]: { checked: true, monto } }))
  }

  const seleccionadas = compras.filter(c => sel[c.id]?.checked)
  const total = seleccionadas.reduce((s, c) => s + (parseFloat(sel[c.id]?.monto || '') || 0), 0)

  const errores: string[] = []
  for (const c of seleccionadas) {
    const m = parseFloat(sel[c.id]?.monto || '') || 0
    const etiqueta = c.concepto || formatDate(c.fecha)
    if (m <= 0) errores.push(`Compra "${etiqueta}": indica un monto.`)
    if (m > saldoCompra(c) + 0.009) errores.push(`Compra "${etiqueta}": el monto supera el saldo (${formatCurrency(saldoCompra(c))}).`)
  }
  if (total > 0 && !cuentaId) errores.push('Selecciona la cuenta bancaria del pago.')

  const puedeGuardar = !saving && errores.length === 0 && total > 0

  const handleRegistrar = async () => {
    if (!proveedor || !puedeGuardar) return
    setSaving(true)
    const pagos = seleccionadas
      .map(c => ({ compra_id: c.id, monto: parseFloat(sel[c.id]?.monto || '') || 0 }))
      .filter(p => p.monto > 0)
    const { data, error } = await supabase.rpc('registrar_pago_lote_compras', {
      p_proveedor_id: proveedor.id,
      p_fecha: fecha,
      p_cuenta_id: cuentaId,
      p_referencia: referencia.trim() || null,
      p_pagos: pagos,
    })
    setSaving(false)
    if (error) {
      showToast(`No se pudo registrar el pago: ${error.message}`, 'error')
      return
    }
    const r = data as { pagadas_completas?: number; abonadas?: number; total_efectivo?: number }
    showToast(
      `Pago registrado: ${r?.pagadas_completas || 0} compra(s) pagadas, ${r?.abonadas || 0} abonada(s) · Banco (egreso): ${formatCurrency(r?.total_efectivo || 0)}`,
      'success'
    )
    setReferencia('')
    loadProveedor(proveedor)
  }

  const getDiasVencida = (c: Compra): number => {
    if (!c.vencimiento) return 0
    return Math.floor((Date.now() - new Date(c.vencimiento + 'T00:00:00').getTime()) / 86400000)
  }

  return (
    <AppLayout>
      {toast && <Toast {...toast} onClose={hideToast} />}
      <Header title="Pago de compras" subtitle="Pago múltiple de compras por proveedor" />

      {/* Selector de proveedor */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="relative max-w-xl">
          <label className="label">Proveedor</label>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="input pl-9"
              placeholder="Buscar proveedor..."
              value={provSearch}
              onChange={e => { setProvSearch(e.target.value); if (proveedor) setProveedor(null) }}
              onFocus={() => { if (provResults.length > 0 && !proveedor) setShowDropdown(true) }}
            />
            {(provSearch || proveedor) && (
              <button onClick={reset} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={14} />
              </button>
            )}
          </div>
          {showDropdown && provResults.length > 0 && !proveedor && (
            <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
              {provResults.map(p => (
                <button
                  key={p.id}
                  onClick={() => loadProveedor(p)}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 border-b border-gray-50 last:border-0"
                >
                  {p.nombre}
                  <span className="text-xs text-gray-400 ml-2">{p.dias_credito} días crédito</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4">
        {!proveedor ? (
          <div className="text-center py-20 text-gray-400">
            <ShoppingCart size={40} className="mx-auto mb-3 text-gray-300" />
            <p className="text-sm">Busca y selecciona un proveedor para ver sus compras pendientes.</p>
          </div>
        ) : loading ? (
          <div className="text-center py-20 text-gray-400">Cargando compras...</div>
        ) : (
          <>
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-700">
                  Compras pendientes ({compras.length})
                </p>
                {compras.length > 0 && (
                  <button
                    className="text-xs text-brand-600 hover:text-brand-800 font-medium"
                    onClick={() => {
                      const todas = compras.every(c => sel[c.id]?.checked)
                      if (todas) { setSel({}) } else {
                        const next: Record<string, SelItem> = {}
                        compras.forEach(c => { next[c.id] = { checked: true, monto: saldoCompra(c).toFixed(2) } })
                        setSel(next)
                      }
                    }}
                  >
                    {compras.every(c => sel[c.id]?.checked) ? 'Deseleccionar todo' : 'Seleccionar todo'}
                  </button>
                )}
              </div>
              {compras.length === 0 ? (
                <p className="text-center py-10 text-sm text-gray-400">Este proveedor no tiene compras pendientes.</p>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="table-header w-10"></th>
                      <th className="table-header">Fecha</th>
                      <th className="table-header">Concepto</th>
                      <th className="table-header">Vence</th>
                      <th className="table-header text-right">Total</th>
                      <th className="table-header text-right">Pagado</th>
                      <th className="table-header text-right">Saldo</th>
                      <th className="table-header text-right w-40">Monto a pagar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {compras.map(c => {
                      const s = sel[c.id]
                      const checked = !!s?.checked
                      const saldo = saldoCompra(c)
                      const dias = getDiasVencida(c)
                      const tramo = classifyTramo(dias)
                      const monto = parseFloat(s?.monto || '') || 0
                      const esCompleto = checked && Math.abs(monto - saldo) < 0.01
                      return (
                        <tr key={c.id} className={`transition-colors ${checked ? 'bg-brand-50/50' : 'hover:bg-gray-50'}`}>
                          <td className="table-cell">
                            <input type="checkbox" className="w-4 h-4 accent-brand-600 cursor-pointer"
                              checked={checked} onChange={() => toggle(c)} />
                          </td>
                          <td className="table-cell text-gray-500">{formatDate(c.fecha)}</td>
                          <td className="table-cell max-w-[220px]">
                            <span className="truncate block" title={c.concepto || ''}>{c.concepto || '—'}</span>
                          </td>
                          <td className="table-cell">
                            <div className="flex flex-col">
                              <span className="text-xs">{c.vencimiento ? formatDate(c.vencimiento) : '—'}</span>
                              {c.vencimiento && (
                                <span className={`badge mt-0.5 text-xs ${tramoColor(tramo)}`}>{tramo}</span>
                              )}
                            </div>
                          </td>
                          <td className="table-cell text-right">{formatCurrency(c.total)}</td>
                          <td className="table-cell text-right text-green-600">
                            {(c.monto_pagado || 0) > 0 ? formatCurrency(c.monto_pagado || 0) : '—'}
                          </td>
                          <td className="table-cell text-right font-semibold text-orange-600">{formatCurrency(saldo)}</td>
                          <td className="table-cell">
                            {checked ? (
                              <div className="flex flex-col items-end gap-0.5">
                                <input
                                  type="number" step="0.01" min="0" max={saldo}
                                  className="input text-sm text-right py-1.5"
                                  value={s.monto}
                                  onChange={e => setMonto(c, e.target.value)}
                                />
                                <span className={`text-[10px] font-medium ${esCompleto ? 'text-green-600' : 'text-blue-600'}`}>
                                  {esCompleto ? 'Pago completo' : 'Abono'}
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

            {seleccionadas.length > 0 && (
              <div className="card p-5">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div>
                    <label className="label">Fecha de pago</label>
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
                    <input className="input" placeholder="Transferencia, cheque, ACH..."
                      value={referencia} onChange={e => setReferencia(e.target.value)} />
                  </div>
                </div>

                <div className="bg-gray-50 rounded-xl p-4 mb-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-gray-500 uppercase font-semibold">Compras</p>
                    <p className="font-bold text-gray-900">{seleccionadas.length}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase font-semibold">Total a pagar</p>
                    <p className="font-bold text-red-600">{formatCurrency(total)}</p>
                  </div>
                </div>

                {total > 0 && (
                  <div className="flex items-center gap-2 text-xs text-blue-700 bg-blue-50 rounded-lg px-3 py-2 mb-3">
                    <CreditCard size={14} />
                    Se registrará <strong>una sola transacción de banco</strong> (egreso) por {formatCurrency(total)}.
                  </div>
                )}

                {errores.length > 0 && (
                  <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3 space-y-0.5">
                    {errores.map((e, i) => <p key={i}>⚠ {e}</p>)}
                  </div>
                )}

                <PermissionGuard modulo="compras" accion="editar">
                  <button
                    className="btn-primary w-full flex items-center justify-center gap-2"
                    disabled={!puedeGuardar}
                    onClick={handleRegistrar}
                  >
                    <CheckCircle size={16} />
                    {saving ? 'Registrando...' : 'Registrar pago'}
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

export default withPagePermission(PagosComprasPage, 'compras', 'ver')
