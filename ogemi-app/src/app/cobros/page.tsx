'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { createClient } from '@/lib/supabase'
import { formatCurrency, formatDate, tramoColor, classifyTramo } from '@/lib/utils'
import { Factura, BancoCuenta, NotaCredito, Cliente } from '@/types'
import { Search, X, CheckCircle, CreditCard, FileText } from 'lucide-react'
import { Toast } from '@/components/Toast'
import { useToast } from '@/hooks/useToast'
import PermissionGuard, { withPagePermission } from '@/components/PermissionGuard'

/** Saldo cobrable en efectivo de una factura: total − retención − pagado */
const saldoFactura = (f: Factura) =>
  (f.total || 0) - (f.retencion_monto || 0) - (f.monto_pagado || 0)

interface SelFactura {
  checked: boolean
  monto: string // efectivo a cobrar (editable; default = saldo → pago completo)
}

interface SelNC {
  checked: boolean
  factura_id: string
}

function CobrosPage() {
  const supabase = createClient()
  const { toast, showToast, hideToast } = useToast()

  // Selección de cliente (autocomplete)
  const [clienteSearch, setClienteSearch] = useState('')
  const [clienteResults, setClienteResults] = useState<Cliente[]>([])
  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Datos del cliente seleccionado
  const [facturas, setFacturas] = useState<Factura[]>([])
  const [ncs, setNcs] = useState<NotaCredito[]>([])
  const [loading, setLoading] = useState(false)

  // Selección de facturas y NC
  const [sel, setSel] = useState<Record<string, SelFactura>>({})
  const [ncSel, setNcSel] = useState<Record<string, SelNC>>({})

  // Datos del cobro
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

  // Autocomplete de clientes (400ms debounce)
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
    setNcSel({})
    setLoading(true)
    const [{ data: fData }, { data: ncData }] = await Promise.all([
      supabase
        .from('facturas')
        .select('*')
        .eq('cliente_id', c.id)
        .eq('estado', 'pendiente')
        .gt('total', 0)
        .order('fecha', { ascending: true })
        .order('numero_factura', { ascending: true }),
      supabase
        .from('notas_credito')
        .select('*')
        .eq('cliente_id', c.id)
        .eq('estado', 'disponible')
        .order('fecha', { ascending: true }),
    ])
    setFacturas(fData || [])
    setNcs(ncData || [])
    setLoading(false)
  }

  const reset = () => {
    setCliente(null)
    setClienteSearch('')
    setFacturas([])
    setNcs([])
    setSel({})
    setNcSel({})
    setReferencia('')
  }

  // NC asignadas (marcadas) por factura
  const ncPorFactura = useMemo(() => {
    const map: Record<string, number> = {}
    for (const nc of ncs) {
      const s = ncSel[nc.id]
      if (s?.checked && s.factura_id) {
        map[s.factura_id] = (map[s.factura_id] || 0) + (nc.total || 0)
      }
    }
    return map
  }, [ncs, ncSel])

  /** Máximo en efectivo cobrable a una factura = saldo − NC asignadas */
  const maxEfectivo = (f: Factura) =>
    Math.max(0, Math.round((saldoFactura(f) - (ncPorFactura[f.id] || 0)) * 100) / 100)

  const toggleFactura = (f: Factura) => {
    setSel(prev => {
      const cur = prev[f.id]
      if (cur?.checked) return { ...prev, [f.id]: { checked: false, monto: '' } }
      return { ...prev, [f.id]: { checked: true, monto: maxEfectivo(f).toFixed(2) } }
    })
  }

  const setMonto = (f: Factura, monto: string) => {
    setSel(prev => ({ ...prev, [f.id]: { checked: true, monto } }))
  }

  const toggleNC = (nc: NotaCredito) => {
    setNcSel(prev => {
      const cur = prev[nc.id]
      if (cur?.checked) return { ...prev, [nc.id]: { checked: false, factura_id: '' } }
      // Default: primera factura seleccionada con saldo suficiente, si no la primera pendiente que quepa
      const candidata = facturas.find(f =>
        saldoFactura(f) - (ncPorFactura[f.id] || 0) >= (nc.total || 0) - 0.001
      )
      return { ...prev, [nc.id]: { checked: true, factura_id: candidata?.id || '' } }
    })
  }

  const setNCFactura = (nc: NotaCredito, facturaId: string) => {
    setNcSel(prev => ({ ...prev, [nc.id]: { checked: true, factura_id: facturaId } }))
  }

  // Al cambiar asignaciones de NC, recortar montos en efectivo que ya no quepan
  useEffect(() => {
    setSel(prev => {
      let changed = false
      const next = { ...prev }
      for (const f of facturas) {
        const s = next[f.id]
        if (!s?.checked) continue
        const max = maxEfectivo(f)
        if ((parseFloat(s.monto) || 0) > max + 0.001) {
          next[f.id] = { checked: true, monto: max.toFixed(2) }
          changed = true
        }
      }
      return changed ? next : prev
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ncPorFactura])

  const seleccionadas = facturas.filter(f => sel[f.id]?.checked)
  const totalEfectivo = seleccionadas.reduce((s, f) => s + (parseFloat(sel[f.id]?.monto || '') || 0), 0)
  const ncsMarcadas = ncs.filter(n => ncSel[n.id]?.checked)
  const totalNC = ncsMarcadas.reduce((s, n) => s + (n.total || 0), 0)

  const errores: string[] = []
  for (const f of seleccionadas) {
    const m = parseFloat(sel[f.id]?.monto || '') || 0
    const max = maxEfectivo(f)
    if (m <= 0 && !(ncPorFactura[f.id] > 0)) errores.push(`Factura #${f.numero_factura}: indica un monto.`)
    if (m > max + 0.009) errores.push(`Factura #${f.numero_factura}: el monto supera el saldo (${formatCurrency(max)}).`)
  }
  for (const nc of ncsMarcadas) {
    const s = ncSel[nc.id]
    if (!s.factura_id) errores.push(`NC ${nc.numero || ''}: selecciona la factura a la que se aplica.`)
    else {
      const f = facturas.find(x => x.id === s.factura_id)
      if (f) {
        const otrasNC = ncsMarcadas
          .filter(o => o.id !== nc.id && ncSel[o.id]?.factura_id === f.id)
          .reduce((acc, o) => acc + (o.total || 0), 0)
        if ((nc.total || 0) + otrasNC > saldoFactura(f) + 0.001) {
          errores.push(`NC ${nc.numero || ''}: excede el saldo de la factura #${f.numero_factura}.`)
        }
      }
    }
  }
  if (totalEfectivo > 0 && !cuentaId) errores.push('Selecciona la cuenta bancaria del depósito.')

  const puedeGuardar = !saving && errores.length === 0 && (totalEfectivo > 0 || ncsMarcadas.length > 0)

  const handleRegistrar = async () => {
    if (!cliente || !puedeGuardar) return
    setSaving(true)
    const pagos = seleccionadas
      .map(f => ({ factura_id: f.id, monto: parseFloat(sel[f.id]?.monto || '') || 0 }))
      .filter(p => p.monto > 0)
    const ncsPayload = ncsMarcadas.map(nc => ({
      nota_credito_id: nc.id,
      factura_id: ncSel[nc.id].factura_id,
    }))
    const { data, error } = await supabase.rpc('registrar_cobro_lote', {
      p_cliente_id: cliente.id,
      p_fecha: fecha,
      p_cuenta_id: totalEfectivo > 0 ? cuentaId : null,
      p_referencia: referencia.trim() || null,
      p_pagos: pagos,
      p_ncs: ncsPayload,
    })
    setSaving(false)
    if (error) {
      showToast(`No se pudo registrar el cobro: ${error.message}`, 'error')
      return
    }
    const r = data as { pagadas_completas?: number; abonadas?: number; total_efectivo?: number; ncs_aplicadas?: number }
    showToast(
      `Cobro registrado: ${r?.pagadas_completas || 0} factura(s) pagadas, ${r?.abonadas || 0} abonada(s)` +
      ((r?.total_efectivo || 0) > 0 ? ` · Banco: ${formatCurrency(r?.total_efectivo || 0)}` : '') +
      ((r?.ncs_aplicadas || 0) > 0 ? ` · ${r?.ncs_aplicadas} NC aplicada(s)` : ''),
      'success'
    )
    setReferencia('')
    loadCliente(cliente)
  }

  const getDiasVencida = (f: Factura): number => {
    if (!f.fecha_pago) return 0
    return Math.floor((Date.now() - new Date(f.fecha_pago + 'T00:00:00').getTime()) / 86400000)
  }

  return (
    <AppLayout>
      {toast && <Toast {...toast} onClose={hideToast} />}
      <Header title="Cobros" subtitle="Cobro múltiple de facturas por cliente" />

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
            <FileText size={40} className="mx-auto mb-3 text-gray-300" />
            <p className="text-sm">Busca y selecciona un cliente para ver sus facturas pendientes.</p>
          </div>
        ) : loading ? (
          <div className="text-center py-20 text-gray-400">Cargando facturas...</div>
        ) : (
          <>
            {/* Facturas pendientes */}
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-700">
                  Facturas pendientes ({facturas.length})
                </p>
                {facturas.length > 0 && (
                  <button
                    className="text-xs text-brand-600 hover:text-brand-800 font-medium"
                    onClick={() => {
                      const todas = facturas.every(f => sel[f.id]?.checked)
                      if (todas) { setSel({}) } else {
                        const next: Record<string, SelFactura> = {}
                        facturas.forEach(f => { next[f.id] = { checked: true, monto: maxEfectivo(f).toFixed(2) } })
                        setSel(next)
                      }
                    }}
                  >
                    {facturas.every(f => sel[f.id]?.checked) ? 'Deseleccionar todo' : 'Seleccionar todo'}
                  </button>
                )}
              </div>
              {facturas.length === 0 ? (
                <p className="text-center py-10 text-sm text-gray-400">Este cliente no tiene facturas pendientes.</p>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="table-header w-10"></th>
                      <th className="table-header">#Factura</th>
                      <th className="table-header">Fecha</th>
                      <th className="table-header">Vence</th>
                      <th className="table-header text-right">Total</th>
                      <th className="table-header text-right">Retención</th>
                      <th className="table-header text-right">Pagado</th>
                      <th className="table-header text-right">Saldo</th>
                      <th className="table-header text-right w-40">Monto a cobrar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {facturas.map(f => {
                      const s = sel[f.id]
                      const checked = !!s?.checked
                      const saldo = saldoFactura(f)
                      const ncAsig = ncPorFactura[f.id] || 0
                      const dias = getDiasVencida(f)
                      const tramo = classifyTramo(dias)
                      const monto = parseFloat(s?.monto || '') || 0
                      const esCompleto = checked && Math.abs(monto + ncAsig - saldo) < 0.01
                      return (
                        <tr key={f.id} className={`transition-colors ${checked ? 'bg-brand-50/50' : 'hover:bg-gray-50'}`}>
                          <td className="table-cell">
                            <input type="checkbox" className="w-4 h-4 accent-brand-600 cursor-pointer"
                              checked={checked} onChange={() => toggleFactura(f)} />
                          </td>
                          <td className="table-cell font-mono font-medium">#{f.numero_factura}</td>
                          <td className="table-cell text-gray-500">{formatDate(f.fecha)}</td>
                          <td className="table-cell">
                            <div className="flex flex-col">
                              <span className="text-xs">{formatDate(f.fecha_pago)}</span>
                              <span className={`badge mt-0.5 text-xs ${tramoColor(tramo)}`}>{tramo}</span>
                            </div>
                          </td>
                          <td className="table-cell text-right">{formatCurrency(f.total)}</td>
                          <td className="table-cell text-right text-amber-600">
                            {(f.retencion_monto || 0) > 0 ? `− ${formatCurrency(f.retencion_monto || 0)}` : '—'}
                          </td>
                          <td className="table-cell text-right text-green-600">
                            {(f.monto_pagado || 0) > 0 ? formatCurrency(f.monto_pagado || 0) : '—'}
                          </td>
                          <td className="table-cell text-right font-semibold text-orange-600">{formatCurrency(saldo)}</td>
                          <td className="table-cell">
                            {checked ? (
                              <div className="flex flex-col items-end gap-0.5">
                                <input
                                  type="number" step="0.01" min="0" max={maxEfectivo(f)}
                                  className="input text-sm text-right py-1.5"
                                  value={s.monto}
                                  onChange={e => setMonto(f, e.target.value)}
                                />
                                <span className={`text-[10px] font-medium ${esCompleto ? 'text-green-600' : 'text-blue-600'}`}>
                                  {ncAsig > 0 && `+ NC ${formatCurrency(ncAsig)} · `}
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

            {/* Notas de crédito disponibles */}
            {ncs.length > 0 && (
              <div className="card overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100">
                  <p className="text-sm font-semibold text-gray-700">Notas de crédito disponibles ({ncs.length})</p>
                  <p className="text-xs text-gray-400 mt-0.5">Se aplican por su monto total a una factura y no pasan por banco.</p>
                </div>
                <div className="divide-y divide-gray-100">
                  {ncs.map(nc => {
                    const s = ncSel[nc.id]
                    const checked = !!s?.checked
                    return (
                      <div key={nc.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${checked ? 'bg-purple-50/50' : ''}`}>
                        <input type="checkbox" className="w-4 h-4 accent-purple-600 cursor-pointer"
                          checked={checked} onChange={() => toggleNC(nc)} />
                        <span className="text-sm font-medium">NC {nc.numero || 's/n'}</span>
                        <span className="text-xs text-gray-400">{formatDate(nc.fecha)}</span>
                        <span className="text-sm font-semibold text-purple-700">{formatCurrency(nc.total)}</span>
                        {checked && (
                          <div className="flex items-center gap-2 ml-auto">
                            <span className="text-xs text-gray-500">Aplicar a</span>
                            <select
                              className="input text-sm py-1.5 w-56"
                              value={s.factura_id}
                              onChange={e => setNCFactura(nc, e.target.value)}
                            >
                              <option value="">Seleccionar factura...</option>
                              {facturas.map(f => (
                                <option key={f.id} value={f.id}>
                                  #{f.numero_factura} · saldo {formatCurrency(saldoFactura(f))}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Resumen y registro */}
            {(seleccionadas.length > 0 || ncsMarcadas.length > 0) && (
              <div className="card p-5">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div>
                    <label className="label">Fecha de cobro</label>
                    <input type="date" className="input" value={fecha} onChange={e => setFecha(e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Cuenta bancaria {totalEfectivo > 0 && <span className="text-red-500">*</span>}</label>
                    <select className="input" value={cuentaId} onChange={e => setCuentaId(e.target.value)}
                      disabled={totalEfectivo <= 0}>
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

                <div className="bg-gray-50 rounded-xl p-4 mb-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-gray-500 uppercase font-semibold">Facturas</p>
                    <p className="font-bold text-gray-900">{seleccionadas.length + ncsMarcadas.filter(nc => !seleccionadas.some(f => f.id === ncSel[nc.id]?.factura_id)).length}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase font-semibold">Efectivo (banco)</p>
                    <p className="font-bold text-green-700">{formatCurrency(totalEfectivo)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase font-semibold">Notas de crédito</p>
                    <p className="font-bold text-purple-700">{formatCurrency(totalNC)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase font-semibold">Total aplicado</p>
                    <p className="font-bold text-gray-900">{formatCurrency(totalEfectivo + totalNC)}</p>
                  </div>
                </div>

                {totalEfectivo > 0 && (
                  <div className="flex items-center gap-2 text-xs text-blue-700 bg-blue-50 rounded-lg px-3 py-2 mb-3">
                    <CreditCard size={14} />
                    Se registrará <strong>una sola transacción de banco</strong> por {formatCurrency(totalEfectivo)}.
                  </div>
                )}

                {errores.length > 0 && (
                  <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3 space-y-0.5">
                    {errores.map((e, i) => <p key={i}>⚠ {e}</p>)}
                  </div>
                )}

                <PermissionGuard modulo="facturas" accion="editar">
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

export default withPagePermission(CobrosPage, 'facturas', 'ver')
