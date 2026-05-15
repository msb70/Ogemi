'use client'

import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { createClient } from '@/lib/supabase'
import { formatCurrency, formatDate, tramoColor } from '@/lib/utils'
import { Factura, BancoCuenta } from '@/types'
import { Search, CheckCircle, Filter, X } from 'lucide-react'

type EstadoFilter = 'todos' | 'pendiente' | 'pagada'

export default function FacturasPage() {
  const [facturas, setFacturas] = useState<Factura[]>([])
  const [cuentas, setCuentas] = useState<BancoCuenta[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [estadoFilter, setEstadoFilter] = useState<EstadoFilter>('todos')
  const [selectedFactura, setSelectedFactura] = useState<Factura | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [fechaCobro, setFechaCobro] = useState('')
  const [cuentaSeleccionada, setCuentaSeleccionada] = useState('')
  const [saving, setSaving] = useState(false)

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
      .from('banco_cuentas')
      .select('*')
      .eq('activo', true)
      .order('nombre')
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

  const openPagoModal = (f: Factura) => {
    setSelectedFactura(f)
    setFechaCobro(new Date().toISOString().split('T')[0])
    setCuentaSeleccionada(cuentas[0]?.id || '')
    setShowModal(true)
  }

  const handleMarcarPagada = async () => {
    if (!selectedFactura || !cuentaSeleccionada) return
    setSaving(true)

    const { error } = await supabase
      .from('facturas')
      .update({
        estado: 'pagada',
        fecha_cobro: fechaCobro,
        banco_cuenta_id: cuentaSeleccionada,
      })
      .eq('id', selectedFactura.id)

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
                <th className="table-header text-right">Monto</th>
                <th className="table-header text-right">ITBMS</th>
                <th className="table-header text-right">Total</th>
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
                  return (
                    <tr key={f.id} className="hover:bg-gray-50 transition-colors">
                      <td className="table-cell font-mono font-medium">#{f.numero_factura}</td>
                      <td className="table-cell text-gray-500">{formatDate(f.fecha)}</td>
                      <td className="table-cell max-w-[200px]">
                        <span className="truncate block" title={f.clientes?.nombre}>{f.clientes?.nombre}</span>
                      </td>
                      <td className="table-cell">
                        <span className={`badge ${tipoCorto === 'N. CRÉDITO' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                          {tipoCorto}
                        </span>
                      </td>
                      <td className="table-cell text-right">{formatCurrency(f.monto)}</td>
                      <td className="table-cell text-right">{formatCurrency(f.itbms)}</td>
                      <td className="table-cell text-right font-semibold">{formatCurrency(f.total)}</td>
                      <td className="table-cell">
                        <div className="flex flex-col">
                          <span className="text-xs">{formatDate(f.fecha_pago)}</span>
                          {tramo && f.estado === 'pendiente' && (
                            <span className={`badge mt-0.5 text-xs ${tramoColor(tramo)}`}>{tramo}</span>
                          )}
                        </div>
                      </td>
                      <td className="table-cell">
                        <span className={`badge ${f.estado === 'pagada' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                          {f.estado}
                        </span>
                      </td>
                      <td className="table-cell">
                        {f.estado === 'pendiente' && f.total > 0 && (
                          <button
                            onClick={() => openPagoModal(f)}
                            className="flex items-center gap-1.5 text-sm text-green-600 hover:text-green-800 font-medium"
                          >
                            <CheckCircle size={15} />
                            Cobrar
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

      {/* Modal: Registrar Cobro */}
      {showModal && selectedFactura && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold mb-1">Registrar Cobro</h2>
            <p className="text-sm text-gray-500 mb-4">
              Factura #{selectedFactura.numero_factura} · {selectedFactura.clientes?.nombre}
            </p>

            <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Monto</span>
                <span>{formatCurrency(selectedFactura.monto)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">ITBMS</span>
                <span>{formatCurrency(selectedFactura.itbms)}</span>
              </div>
              <div className="flex justify-between text-sm font-semibold border-t pt-1.5 mt-1.5">
                <span>Total a cobrar</span>
                <span className="text-brand-700">{formatCurrency(selectedFactura.total)}</span>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="label">Fecha de cobro</label>
                <input
                  type="date"
                  className="input"
                  value={fechaCobro}
                  onChange={(e) => setFechaCobro(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Cuenta bancaria</label>
                <select
                  className="input"
                  value={cuentaSeleccionada}
                  onChange={(e) => setCuentaSeleccionada(e.target.value)}
                >
                  <option value="">Seleccionar cuenta...</option>
                  {cuentas.map(c => (
                    <option key={c.id} value={c.id}>{c.nombre} – {c.banco}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button className="btn-secondary flex-1" onClick={() => setShowModal(false)}>
                Cancelar
              </button>
              <button
                className="btn-primary flex-1"
                onClick={handleMarcarPagada}
                disabled={saving || !cuentaSeleccionada}
              >
                {saving ? 'Guardando...' : 'Confirmar cobro'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
