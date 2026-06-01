'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { createClient } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Anticipo, Cliente, BancoCuenta } from '@/types'
import { Plus, Printer, Search, X, CheckCircle, AlertCircle } from 'lucide-react'

export default function AnticiposPage() {
  const [anticipos, setAnticipos] = useState<Anticipo[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [cuentas, setCuentas] = useState<BancoCuenta[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [printData, setPrintData] = useState<Anticipo | null>(null)
  const printRef = useRef<HTMLDivElement>(null)

  const [form, setForm] = useState({
    cliente_id: '',
    cuenta_id: '',
    fecha: new Date().toISOString().split('T')[0],
    monto: '',
    numero_deposito: '',
    notas: '',
  })

  const supabase = createClient()

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: anticData }, { data: clientesData }, { data: cuentasData }] = await Promise.all([
      supabase
        .from('anticipos')
        .select('*, clientes(nombre), banco_cuentas(nombre, banco, numero_cuenta)')
        .order('fecha', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase.from('clientes').select('*').eq('activo', true).order('nombre'),
      supabase.from('banco_cuentas').select('*').eq('activo', true).order('nombre'),
    ])
    setAnticipos(anticData || [])
    setClientes(clientesData || [])
    setCuentas(cuentasData || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleGuardar = async () => {
    if (!form.cliente_id || !form.cuenta_id || !form.monto || !form.fecha) return
    setSaving(true)
    const { data, error } = await supabase
      .from('anticipos')
      .insert({
        cliente_id: form.cliente_id,
        cuenta_id: form.cuenta_id,
        fecha: form.fecha,
        monto: parseFloat(form.monto),
        numero_deposito: form.numero_deposito || null,
        notas: form.notas || null,
      })
      .select('*, clientes(nombre), banco_cuentas(nombre, banco, numero_cuenta)')
      .single()

    setSaving(false)
    if (!error && data) {
      setShowForm(false)
      resetForm()
      load()
      // Auto-imprimir al guardar
      setTimeout(() => setPrintData(data), 300)
    }
  }

  const resetForm = () => {
    setForm({
      cliente_id: '',
      cuenta_id: '',
      fecha: new Date().toISOString().split('T')[0],
      monto: '',
      numero_deposito: '',
      notas: '',
    })
  }

  const handlePrint = (anticipo: Anticipo) => {
    setPrintData(anticipo)
    setTimeout(() => window.print(), 400)
  }

  const handleAnular = async (id: string) => {
    if (!confirm('¿Anular este anticipo?')) return
    await supabase.from('anticipos').update({ estado: 'anulado' }).eq('id', id)
    load()
  }

  const filtered = anticipos.filter(a => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      (a.clientes?.nombre || '').toLowerCase().includes(q) ||
      (a.numero_deposito || '').toLowerCase().includes(q)
    )
  })

  const totalActivos = anticipos
    .filter(a => a.estado === 'activo')
    .reduce((s, a) => s + a.monto, 0)

  const estadoBadge = (estado: string) => {
    switch (estado) {
      case 'activo': return 'bg-green-100 text-green-700'
      case 'aplicado': return 'bg-blue-100 text-blue-700'
      case 'anulado': return 'bg-red-100 text-red-700'
      default: return 'bg-gray-100 text-gray-500'
    }
  }

  return (
    <AppLayout>
      {/* Área de impresión — solo visible al imprimir */}
      {printData && (
        <div ref={printRef} className="print-only hidden print:block">
          <ReciboAnticipo anticipo={printData} />
        </div>
      )}

      <Header
        title="Anticipos"
        subtitle="Depósitos anticipados de clientes"
        actions={
          <button className="btn-primary flex items-center gap-2" onClick={() => setShowForm(true)}>
            <Plus size={16} />Nuevo anticipo
          </button>
        }
      />

      {/* Resumen */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-6">
        <div>
          <span className="text-xs text-gray-500">Anticipos activos: </span>
          <span className="font-semibold text-brand-700">{formatCurrency(totalActivos)}</span>
        </div>
        <div>
          <span className="text-xs text-gray-500">Total registros: </span>
          <span className="font-semibold text-gray-700">{anticipos.length}</span>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {/* Búsqueda */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="input pl-9"
              placeholder="Buscar por cliente o N° depósito..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Tabla */}
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="table-header">Fecha</th>
                <th className="table-header">Cliente</th>
                <th className="table-header">Cuenta</th>
                <th className="table-header">N° Depósito</th>
                <th className="table-header text-right">Monto</th>
                <th className="table-header">Estado</th>
                <th className="table-header">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400">Cargando...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400">Sin anticipos registrados</td></tr>
              ) : filtered.map(a => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="table-cell text-gray-500">{formatDate(a.fecha)}</td>
                  <td className="table-cell font-medium">{a.clientes?.nombre}</td>
                  <td className="table-cell text-sm text-gray-500">
                    {a.banco_cuentas?.nombre} · {a.banco_cuentas?.banco}
                  </td>
                  <td className="table-cell text-sm text-gray-400 font-mono">
                    {a.numero_deposito || '—'}
                  </td>
                  <td className="table-cell text-right font-semibold text-brand-700">
                    {formatCurrency(a.monto)}
                  </td>
                  <td className="table-cell">
                    <span className={`badge ${estadoBadge(a.estado)}`}>
                      {a.estado}
                    </span>
                  </td>
                  <td className="table-cell">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handlePrint(a)}
                        className="flex items-center gap-1 text-xs text-gray-500 hover:text-brand-600 transition-colors"
                        title="Imprimir recibo"
                      >
                        <Printer size={14} />
                        Recibo
                      </button>
                      {a.estado === 'activo' && (
                        <button
                          onClick={() => handleAnular(a.id)}
                          className="flex items-center gap-1 text-xs text-red-400 hover:text-red-600 transition-colors"
                        >
                          <X size={14} />
                          Anular
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Nuevo anticipo */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
            <h2 className="text-lg font-semibold mb-5">Registrar anticipo</h2>

            <div className="space-y-4">
              <div>
                <label className="label">Cliente *</label>
                <select
                  className="input"
                  value={form.cliente_id}
                  onChange={e => setForm(p => ({ ...p, cliente_id: e.target.value }))}
                >
                  <option value="">Seleccionar cliente...</option>
                  {clientes.map(c => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Fecha *</label>
                  <input
                    type="date"
                    className="input"
                    value={form.fecha}
                    onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Monto (USD) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    className="input"
                    placeholder="0.00"
                    value={form.monto}
                    onChange={e => setForm(p => ({ ...p, monto: e.target.value }))}
                  />
                </div>
              </div>

              <div>
                <label className="label">Cuenta bancaria *</label>
                <select
                  className="input"
                  value={form.cuenta_id}
                  onChange={e => setForm(p => ({ ...p, cuenta_id: e.target.value }))}
                >
                  <option value="">Seleccionar cuenta...</option>
                  {cuentas.map(c => (
                    <option key={c.id} value={c.id}>{c.nombre} – {c.banco}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">N° de depósito / referencia</label>
                <input
                  className="input"
                  placeholder="Número de depósito, transferencia..."
                  value={form.numero_deposito}
                  onChange={e => setForm(p => ({ ...p, numero_deposito: e.target.value }))}
                />
              </div>

              <div>
                <label className="label">Notas</label>
                <textarea
                  className="input resize-none"
                  rows={2}
                  placeholder="Observaciones adicionales..."
                  value={form.notas}
                  onChange={e => setForm(p => ({ ...p, notas: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                className="btn-secondary flex-1"
                onClick={() => { setShowForm(false); resetForm() }}
              >
                Cancelar
              </button>
              <button
                className="btn-primary flex-1 flex items-center justify-center gap-2"
                onClick={handleGuardar}
                disabled={saving || !form.cliente_id || !form.cuenta_id || !form.monto}
              >
                {saving ? 'Guardando...' : (
                  <>
                    <CheckCircle size={16} />
                    Guardar e imprimir
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Vista previa de recibo antes de imprimir */}
      {printData && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 print:hidden">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-base font-semibold">Vista previa del recibo</h2>
            </div>
            <div className="p-6">
              <ReciboAnticipo anticipo={printData} preview />
            </div>
            <div className="flex gap-3 p-6 pt-0">
              <button
                className="btn-secondary flex-1"
                onClick={() => setPrintData(null)}
              >
                Cerrar
              </button>
              <button
                className="btn-primary flex-1 flex items-center justify-center gap-2"
                onClick={() => window.print()}
              >
                <Printer size={16} />
                Imprimir
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @media print {
          body > * { display: none !important; }
          .print-receipt { display: block !important; }
        }
      `}</style>
    </AppLayout>
  )
}

// ============================================================
// Componente: Recibo de anticipo
// ============================================================
function ReciboAnticipo({ anticipo, preview = false }: { anticipo: Anticipo; preview?: boolean }) {
  const fecha = formatDate(anticipo.fecha)
  const hoy = formatDate(new Date().toISOString().split('T')[0])

  return (
    <div className={`font-sans text-gray-900 ${preview ? 'text-sm' : ''}`}>
      {/* Encabezado */}
      <div className="text-center border-b-2 border-gray-900 pb-3 mb-4">
        <h1 className="text-lg font-bold uppercase tracking-wide">Ogemi · Impresoras Comerciales</h1>
        <p className="text-xs text-gray-500 mt-0.5">Recibo de Anticipo</p>
      </div>

      {/* Número y fecha */}
      <div className="flex justify-between text-xs mb-4">
        <div>
          <span className="text-gray-500">Fecha emisión:</span>
          <span className="ml-1 font-medium">{hoy}</span>
        </div>
        <div>
          <span className="text-gray-500">Fecha depósito:</span>
          <span className="ml-1 font-medium">{fecha}</span>
        </div>
      </div>

      {/* Datos del cliente */}
      <div className="border border-gray-200 rounded-lg p-3 mb-4 space-y-1.5">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Cliente:</span>
          <span className="font-semibold">{anticipo.clientes?.nombre}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Cuenta:</span>
          <span>{anticipo.banco_cuentas?.nombre} · {anticipo.banco_cuentas?.banco}</span>
        </div>
        {anticipo.numero_deposito && (
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">N° Depósito:</span>
            <span className="font-mono">{anticipo.numero_deposito}</span>
          </div>
        )}
        {anticipo.notas && (
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Notas:</span>
            <span className="max-w-[200px] text-right">{anticipo.notas}</span>
          </div>
        )}
      </div>

      {/* Monto */}
      <div className="bg-gray-50 border-2 border-gray-900 rounded-lg p-4 text-center mb-4">
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Monto recibido</p>
        <p className="text-3xl font-bold text-gray-900">{formatCurrency(anticipo.monto)}</p>
      </div>

      {/* Pie */}
      <div className="text-center text-xs text-gray-400 border-t border-gray-200 pt-3">
        <p>Este documento es un comprobante de anticipo.</p>
        <p>No constituye una factura fiscal.</p>
      </div>

      {/* Firmas */}
      <div className="flex justify-between mt-8 pt-4">
        <div className="text-center">
          <div className="border-t border-gray-400 pt-1 w-32 text-xs text-gray-500">Entregado por</div>
        </div>
        <div className="text-center">
          <div className="border-t border-gray-400 pt-1 w-32 text-xs text-gray-500">Recibido por</div>
        </div>
      </div>
    </div>
  )
}
