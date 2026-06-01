'use client'

import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { createClient } from '@/lib/supabase'
import { formatCurrency, formatDate, tramoColor } from '@/lib/utils'
import { Factura, BancoCuenta } from '@/types'
import { Search, CheckCircle, Filter, X, Plus, Trash2 } from 'lucide-react'

type EstadoFilter = 'todos' | 'pendiente' | 'pagada'

interface LineaPago {
  cuenta_id: string
  monto: string
  referencia: string
}

export default function FacturasPage() {
  const [facturas, setFacturas] = useState<Factura[]>([])
  const [cuentas, setCuentas] = useState<BancoCuenta[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [estadoFilter, setEstadoFilter] = useState<EstadoFilter>('todos')

  // Modal de abonos
  const [selectedFactura, setSelectedFactura] = useState<Factura | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [fechaPago, setFechaPago] = useState('')
  const [lineas, setLineas] = useState<LineaPago[]>([{ cuenta_id: '', monto: '', referencia: '' }])
  const [saving, setSaving] = useState(false)
  const [pagosExistentes, setPagosExistentes] = useState<any[]>([])

  const supabase = createClient()

  const loadData = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('facturas')
      .select('*, clientes(nombre, dias_credito), banco_cuentas(nombre, banco)')
      .order('fecha', { ascending: false })
      .order('numero_factura', { ascending: false })

    if (estadoFilter !== 'todos') {
      query = query.eq('estado', estadoFilter)
    }

    const { data } = await query
    setFacturas(data || [])

    const { data: cuentasData } = await supabase
      .from('banco_cuentas').select('*').eq('activo', true).order('nombre')
    setCuentas(cuentasData || [])
    setLoading(false)
  }, [estadoFilter])

  useEffect(() => { loadData() }, [loadData])

  const filteredFacturas = facturas.filter(f => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      f.numero_factura?.toString().includes(q) ||
      f.clientes?.nombre?.toLowerCase().includes(q) ||
      f.tipo_documento?.toLowerCase().includes(q)
    )
  })

  const openPagoModal = async (f: Factura) => {
    setSelectedFactura(f)
    setFechaPago(new Date().toISOString().split('T')[0])
    setLineas([{ cuenta_id: cuentas[0]?.id || '', monto: '', referencia: '' }])
    setShowModal(true)

    // Cargar pagos existentes
    const { data } = await supabase
      .from('pagos')
      .select('*, banco_cuentas(nombre, banco)')
      .eq('factura_id', f.id)
      .order('fecha', { ascending: false })
    setPagosExistentes(data || [])
  }

  const addLinea = () => {
    setLineas(prev => [...prev, { cuenta_id: cuentas[0]?.id || '', monto: '', referencia: '' }])
  }

  const removeLinea = (idx: number) => {
    setLineas(prev => prev.filter((_, i) => i !== idx))
  }

  const updateLinea = (idx: number, field: keyof LineaPago, value: string) => {
    setLineas(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l))
  }

  const totalLineas = lineas.reduce((s, l) => s + (parseFloat(l.monto) || 0), 0)

  const saldoPendiente = selectedFactura
    ? (selectedFactura.total - (selectedFactura.monto_pagado || 0))
    : 0

  const handleRegistrarAbono = async () => {
    if (!selectedFactura) return
    const lineasValidas = lineas.filter(l => l.cuenta_id && parseFloat(l.monto) > 0)
    if (lineasValidas.length === 0) return

    setSaving(true)

    // Insertar cada línea como un pago
    const pagosInsert = lineasValidas.map(l => ({
      factura_id: selectedFactura.id,
      cuenta_id: l.cuenta_id,
      monto: parseFloat(l.monto),
      fecha: fechaPago,
      referencia: l.referencia || null,
    }))

    const { error } = await supabase.from('pagos').insert(pagosInsert)

    setSaving(false)
    if (!error) {
      setShowModal(false)
      loadData()
    }
  }

  const getDiasVencida = (f: Factura): number => {
    if (!f.fecha_pago) return 0
    const hoy = new Date()
    const vence = new Date(f.fecha_pago + 'T00:00:00')
    return Math.floor((hoy.getTime() - vence.getTime()) / 86400000)
  }

  const getTramo = (dias: number): string => {
    if (dias <= 0) return 'corriente'
    if (dias <= 30) return '1-30'
    if (dias <= 60) return '31-60'
    if (dias <= 90) return '61-90'
    return '+120'
  }

  return (
    <AppLayout>
      <Header
        title="Facturas"
        subtitle={`${filteredFacturas.length} registros`}
      />

      {/* Filters */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="input pl-9"
            placeholder="Buscar por #factura, cliente..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Filter size={16} className="text-gray-400" />
          {(['todos', 'pendiente', 'pagada'] as EstadoFilter[]).map(e => (
            <button
              key={e}
              onClick={() => setEstadoFilter(e)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                estadoFilter === e
                  ? 'bg-brand-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {e.charAt(0).toUpperCase() + e.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto p-6">
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="table-header">#Factura</th>
                <th className="table-header">Fecha</th>
                <th className="table-header">Cliente</th>
                <th className="table-header">Tipo</th>
                <th className="table-header text-right">Total</th>
                <th className="table-header text-right">Pagado</th>
                <th className="table-header text-right">Saldo</th>
                <th className="table-header">Vence</th>
                <th className="table-header">Estado</th>
                <th className="table-header">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={10} className="text-center py-12 text-gray-400">Cargando...</td></tr>
              ) : filteredFacturas.length === 0 ? (
                <tr><td colSpan={10} className="text-center py-12 text-gray-400">Sin resultados</td></tr>
              ) : (
                filteredFacturas.map(f => {
                  const dias = f.estado === 'pendiente' ? getDiasVencida(f) : 0
                  const tramo = f.estado === 'pendiente' ? getTramo(dias) : null
                  const tipoCorto = f.tipo_documento.includes('CREDITO') ? 'N. CRÉDITO' : 'FACTURA'
                  const montoPagado = f.monto_pagado || 0
                  const saldo = f.total - montoPagado
                  return (
                    <tr key={f.id} className="hover:bg-gray-50 transition-colors">
                      <td className="table-cell font-mono font-medium">#{f.numero_factura}</td>
                      <td className="table-cell text-gray-500">{formatDate(f.fecha)}</td>
                      <td className="table-cell max-w-[180px]">
                        <span className="truncate block" title={f.clientes?.nombre}>{f.clientes?.nombre}</span>
                      </td>
                      <td className="table-cell">
                        <span className={`badge ${tipoCorto === 'N. CRÉDITO' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                          {tipoCorto}
                        </span>
                      </td>
                      <td className="table-cell text-right font-semibold">{formatCurrency(f.total)}</td>
                      <td className="table-cell text-right text-green-600">
                        {montoPagado > 0 ? formatCurrency(montoPagado) : '—'}
                      </td>
                      <td className="table-cell text-right font-semibold text-orange-600">
                        {f.estado === 'pagada' ? <span className="text-green-600 text-sm">Saldada</span> : formatCurrency(saldo)}
                      </td>
                      <td className="table-cell">
                        <div className="flex flex-col">
                          <span className="text-xs">{formatDate(f.fecha_pago)}</span>
                          {tramo && f.estado === 'pendiente' && (
                            <span className={`badge mt-0.5 text-xs ${tramoColor(tramo)}`}>{tramo}</span>
                          )}
                        </div>
                      </td>
                      <td className="table-cell">
                        <span className={`badge ${f.estado === 'pagada' ? 'bg-green-100 text-green-700' : montoPagado > 0 ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700'}`}>
                          {f.estado === 'pagada' ? 'pagada' : montoPagado > 0 ? 'abono' : 'pendiente'}
                        </span>
                      </td>
                      <td className="table-cell">
                        {f.estado === 'pendiente' && f.total > 0 && (
                          <button
                            onClick={() => openPagoModal(f)}
                            className="flex items-center gap-1.5 text-sm text-green-600 hover:text-green-800 font-medium"
                          >
                            <CheckCircle size={15} />
                            {montoPagado > 0 ? 'Abonar' : 'Cobrar'}
                          </button>
                        )}
                        {f.estado === 'pagada' && (
                          <span className="text-xs text-gray-400">{formatDate(f.fecha_cobro)}</span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Registrar Abono/Cobro */}
      {showModal && selectedFactura && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold mb-1">
              {(selectedFactura.monto_pagado || 0) > 0 ? 'Registrar abono' : 'Registrar cobro'}
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              Factura #{selectedFactura.numero_factura} · {selectedFactura.clientes?.nombre}
            </p>

            {/* Resumen */}
            <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Total factura</span>
                <span className="font-semibold">{formatCurrency(selectedFactura.total)}</span>
              </div>
              {(selectedFactura.monto_pagado || 0) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Ya pagado</span>
                  <span className="text-green-600">{formatCurrency(selectedFactura.monto_pagado || 0)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-semibold border-t pt-1.5 mt-1.5">
                <span>Saldo pendiente</span>
                <span className="text-orange-600">{formatCurrency(saldoPendiente)}</span>
              </div>
            </div>

            {/* Pagos existentes */}
            {pagosExistentes.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-medium text-gray-500 uppercase mb-2">Pagos registrados</p>
                <div className="space-y-1.5">
                  {pagosExistentes.map(p => (
                    <div key={p.id} className="flex justify-between text-sm bg-green-50 rounded-lg px-3 py-2">
                      <span className="text-gray-600">{formatDate(p.fecha)} · {p.banco_cuentas?.nombre}</span>
                      <span className="font-medium text-green-700">{formatCurrency(p.monto)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Fecha de pago */}
            <div className="mb-4">
              <label className="label">Fecha de cobro</label>
              <input
                type="date"
                className="input"
                value={fechaPago}
                onChange={e => setFechaPago(e.target.value)}
              />
            </div>

            {/* Líneas de pago (multi-cuenta) */}
            <div className="space-y-3 mb-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-700">Forma de pago</p>
                <button
                  onClick={addLinea}
                  className="text-xs flex items-center gap-1 text-brand-600 hover:text-brand-800"
                >
                  <Plus size={13} /> Agregar cuenta
                </button>
              </div>

              {lineas.map((linea, idx) => (
                <div key={idx} className="border border-gray-200 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500 font-medium">Pago {idx + 1}</span>
                    {lineas.length > 1 && (
                      <button onClick={() => removeLinea(idx)} className="text-red-400 hover:text-red-600">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                  <div>
                    <label className="label text-xs">Cuenta bancaria</label>
                    <select
                      className="input text-sm"
                      value={linea.cuenta_id}
                      onChange={e => updateLinea(idx, 'cuenta_id', e.target.value)}
                    >
                      <option value="">Seleccionar cuenta...</option>
                      {cuentas.map(c => (
                        <option key={c.id} value={c.id}>{c.nombre} – {c.banco}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="label text-xs">Monto (USD)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        className="input text-sm"
                        placeholder="0.00"
                        value={linea.monto}
                        onChange={e => updateLinea(idx, 'monto', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="label text-xs">Referencia</label>
                      <input
                        className="input text-sm"
                        placeholder="Cheque, transferencia..."
                        value={linea.referencia}
                        onChange={e => updateLinea(idx, 'referencia', e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              ))}

              {/* Total líneas */}
              {lineas.length > 1 && (
                <div className="flex justify-between text-sm font-semibold bg-brand-50 rounded-lg px-3 py-2">
                  <span className="text-brand-700">Total este abono</span>
                  <span className="text-brand-800">{formatCurrency(totalLineas)}</span>
                </div>
              )}

              {totalLineas > saldoPendiente + 0.01 && (
                <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
                  ⚠ El monto supera el saldo pendiente ({formatCurrency(saldoPendiente)})
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => setShowModal(false)}>
                Cancelar
              </button>
              <button
                className="btn-primary flex-1"
                onClick={handleRegistrarAbono}
                disabled={saving || lineas.every(l => !l.cuenta_id || !l.monto)}
              >
                {saving ? 'Guardando...' : 'Registrar pago'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
