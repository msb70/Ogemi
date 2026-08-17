'use client'

import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { createClient } from '@/lib/supabase'
import { Cliente } from '@/types'
import { FE_TIPO_CONTRIBUYENTE, FE_TIPO_CLIENTE } from '@/lib/fe-catalogos'
import { Plus, Pencil, Search, X, Download, AlertCircle } from 'lucide-react'
import { withPagePermission } from '@/components/PermissionGuard'
import { exportXLSX, kpiSheet } from '@/lib/exportXlsx'

const emptyForm = {
  nombre: '',
  dias_credito: '30',
  retencion_pct: '0',
  tipo_contribuyente: '2',
  tipo_cliente: '01',
  ruc: '',
  dv: '',
  direccion: '',
  email: '',
  telefono: '',
  telefono_movil: '',
  contacto: '',
}

/** Un cliente sólo puede timbrarse en factura electrónica si tiene RUC y DV. */
const faltaFiscal = (c: Cliente) => !((c.ruc || '').trim() && (c.dv || '').trim())

function ClientesPage() {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [soloSinRuc, setSoloSinRuc] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const supabase = createClient()

  const loadData = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('clientes')
      .select('*')
      .order('nombre')
    setClientes(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const handleOpenForm = (c?: Cliente) => {
    setError(null)
    if (c) {
      setEditId(c.id)
      setForm({
        nombre: c.nombre,
        dias_credito: String(c.dias_credito ?? 30),
        retencion_pct: String(c.retencion_pct ?? 0),
        tipo_contribuyente: String(c.tipo_contribuyente ?? 2),
        tipo_cliente: c.tipo_cliente || '01',
        ruc: c.ruc || '',
        dv: c.dv || '',
        direccion: c.direccion || '',
        email: c.email || '',
        telefono: c.telefono || '',
        telefono_movil: c.telefono_movil || '',
        contacto: c.contacto || '',
      })
    } else {
      setEditId(null)
      setForm(emptyForm)
    }
    setShowForm(true)
  }

  const handleClose = () => {
    setShowForm(false)
    setEditId(null)
    setForm(emptyForm)
    setError(null)
  }

  const handleSave = async () => {
    if (!form.nombre.trim()) return
    setSaving(true)
    setError(null)
    const dv = form.dv.trim()
    const payload = {
      nombre: form.nombre.trim(),
      dias_credito: Math.max(0, parseInt(form.dias_credito) || 0),
      retencion_pct: Math.min(100, Math.max(0, parseFloat(form.retencion_pct) || 0)),
      tipo_contribuyente: parseInt(form.tipo_contribuyente) || 2,
      tipo_cliente: form.tipo_cliente || '01',
      ruc: form.ruc.trim() || null,
      // El DV en Panamá se escribe con dos dígitos: 6 -> 06
      dv: dv ? (/^\d{1,2}$/.test(dv) ? dv.padStart(2, '0') : dv) : null,
      direccion: form.direccion.trim() || null,
      email: form.email.trim() || null,
      telefono: form.telefono.trim() || null,
      telefono_movil: form.telefono_movil.trim() || null,
      contacto: form.contacto.trim() || null,
    }
    const { error: err } = editId
      ? await supabase.from('clientes').update(payload).eq('id', editId)
      : await supabase.from('clientes').insert(payload)
    setSaving(false)
    if (err) {
      setError(err.message.includes('duplicate') || err.message.includes('unique')
        ? 'Ya existe un cliente con ese nombre.'
        : err.message)
      return
    }
    handleClose()
    loadData()
  }

  const handleToggleActivo = async (c: Cliente) => {
    await supabase.from('clientes').update({ activo: !c.activo }).eq('id', c.id)
    loadData()
  }

  const filtered = clientes.filter(c => {
    const q = search.toLowerCase()
    const coincide = !q ||
      c.nombre.toLowerCase().includes(q) ||
      (c.ruc || '').toLowerCase().includes(q) ||
      (c.contacto || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.telefono || '').toLowerCase().includes(q) ||
      (c.telefono_movil || '').toLowerCase().includes(q)
    return coincide && (!soloSinRuc || faltaFiscal(c))
  })

  const sinFiscal = clientes.filter(faltaFiscal).length

  // Estadísticas por cliente
  const [clienteStats, setClienteStats] = useState<Record<string, { pendiente: number; total: number }>>({})

  useEffect(() => {
    async function loadStats() {
      const { data } = await supabase
        .from('facturas')
        .select('cliente_id, estado, total')
        .gt('total', 0)

      if (!data) return
      const stats: Record<string, { pendiente: number; total: number }> = {}
      data.forEach(f => {
        if (!stats[f.cliente_id]) stats[f.cliente_id] = { pendiente: 0, total: 0 }
        stats[f.cliente_id].total += f.total || 0
        if (f.estado === 'pendiente') stats[f.cliente_id].pendiente += f.total || 0
      })
      setClienteStats(stats)
    }
    loadStats()
  }, [clientes])

  const fmt = (n: number) => new Intl.NumberFormat('es-PA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

  const nombreTipoCliente = (codigo: string) => FE_TIPO_CLIENTE.find(t => t.codigo === codigo)?.nombre || codigo
  const nombreTipoContribuyente = (codigo: number) => FE_TIPO_CONTRIBUYENTE.find(t => t.codigo === codigo)?.nombre || String(codigo)

  const exportExcel = () => {
    exportXLSX(`clientes_${new Date().toISOString().split('T')[0]}.xlsx`, [
      kpiSheet('Clientes', `${filtered.length} clientes`, [
        ['# Clientes', clientes.length],
        ['Activos', clientes.filter(c => c.activo).length],
        ['Sin RUC o DV', sinFiscal],
      ]),
      { name: 'Listado', rows: [
        ['Cliente', 'RUC', 'DV', 'Tipo contribuyente', 'Tipo cliente', 'Contacto', 'Teléfono', 'Móvil',
         'Email', 'Dirección', 'Días crédito', 'Retención %', 'Pendiente', 'Total histórico', 'Estado'],
        ...filtered.map(c => [
          c.nombre, c.ruc || '', c.dv || '',
          nombreTipoContribuyente(c.tipo_contribuyente), nombreTipoCliente(c.tipo_cliente),
          c.contacto || '', c.telefono || '', c.telefono_movil || '',
          c.email || '', c.direccion || '',
          c.dias_credito, c.retencion_pct || 0,
          clienteStats[c.id]?.pendiente || 0, clienteStats[c.id]?.total || 0,
          c.activo ? 'Activo' : 'Inactivo',
        ]),
      ] },
    ])
  }

  return (
    <AppLayout>
      <Header
        title="Clientes"
        subtitle={`${filtered.length} clientes`}
        actions={
          <div className="flex items-center gap-2">
            <button className="btn-secondary flex items-center gap-2" onClick={exportExcel}>
              <Download size={16} /> Exportar Excel
            </button>
            <button className="btn-primary flex items-center gap-2" onClick={() => handleOpenForm()}>
              <Plus size={16} />
              Nuevo cliente
            </button>
          </div>
        }
      />

      {/* Filters */}
      <div className="bg-white border-b border-gray-200 px-6 py-3">
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative max-w-sm flex-1 min-w-[220px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="input pl-9"
              placeholder="Buscar por nombre, RUC, contacto, teléfono o email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                <X size={14} />
              </button>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={soloSinRuc}
              onChange={(e) => setSoloSinRuc(e.target.checked)}
              className="rounded border-gray-300"
            />
            Sólo sin RUC o DV
          </label>
          {sinFiscal > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 px-2.5 py-1 rounded-lg">
              <AlertCircle size={13} />
              {sinFiscal} sin datos fiscales completos (no se les puede timbrar factura electrónica)
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="table-header">Cliente</th>
                <th className="table-header">RUC / DV</th>
                <th className="table-header">Contacto</th>
                <th className="table-header">Días crédito</th>
                <th className="table-header">Retención</th>
                <th className="table-header text-right">Pendiente</th>
                <th className="table-header text-right">Total histórico</th>
                <th className="table-header">Estado</th>
                <th className="table-header">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={9} className="text-center py-12 text-gray-400">Cargando...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12 text-gray-400">Sin resultados</td></tr>
              ) : filtered.map(c => (
                <tr key={c.id} className={`hover:bg-gray-50 ${!c.activo ? 'opacity-50' : ''}`}>
                  <td className="table-cell font-medium max-w-[260px]">
                    <span className="truncate block" title={c.nombre}>{c.nombre}</span>
                    {c.email && <span className="text-xs text-gray-400 truncate block">{c.email}</span>}
                  </td>
                  <td className="table-cell">
                    {c.ruc
                      ? <span className="text-sm text-gray-700 whitespace-nowrap">{c.ruc}{c.dv ? ` DV ${c.dv}` : ''}</span>
                      : <span className="badge bg-amber-50 text-amber-700">Falta RUC</span>}
                  </td>
                  <td className="table-cell max-w-[200px]">
                    {c.contacto && <span className="text-sm text-gray-700 truncate block">{c.contacto}</span>}
                    {(c.telefono || c.telefono_movil) && (
                      <span className="text-xs text-gray-400 truncate block">
                        {[c.telefono, c.telefono_movil].filter(Boolean).join(' · ')}
                      </span>
                    )}
                    {!c.contacto && !c.telefono && !c.telefono_movil && <span className="text-gray-300 text-sm">—</span>}
                  </td>
                  <td className="table-cell">
                    <span className="badge bg-blue-50 text-blue-700 whitespace-nowrap">{c.dias_credito} días</span>
                  </td>
                  <td className="table-cell">
                    {(c.retencion_pct || 0) > 0
                      ? <span className="badge bg-amber-50 text-amber-700">{c.retencion_pct}%</span>
                      : <span className="text-gray-400 text-sm">—</span>}
                  </td>
                  <td className="table-cell text-right font-medium text-orange-600">
                    {fmt(clienteStats[c.id]?.pendiente || 0)}
                  </td>
                  <td className="table-cell text-right text-gray-500">
                    {fmt(clienteStats[c.id]?.total || 0)}
                  </td>
                  <td className="table-cell">
                    <span className={`badge ${c.activo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {c.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="table-cell">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleOpenForm(c)}
                        className="text-gray-400 hover:text-brand-600"
                        title="Editar cliente"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => handleToggleActivo(c)}
                        className={`text-xs font-medium whitespace-nowrap ${c.activo ? 'text-red-500 hover:text-red-700' : 'text-green-500 hover:text-green-700'}`}
                      >
                        {c.activo ? 'Desactivar' : 'Activar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      </div>

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold mb-5">
              {editId ? 'Editar cliente' : 'Nuevo cliente'}
            </h2>

            <div className="space-y-4">
              <div>
                <label className="label">Nombre del cliente</label>
                <input
                  className="input"
                  placeholder="Ej: Inversiones Panamá, S.A."
                  value={form.nombre}
                  onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Días de crédito</label>
                  <input
                    type="number"
                    min="0"
                    className="input"
                    value={form.dias_credito}
                    onChange={e => setForm(f => ({ ...f, dias_credito: e.target.value }))}
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    El vencimiento de cada factura se calcula como fecha + días de crédito.
                  </p>
                </div>
                <div>
                  <label className="label">Retención ITBMS %</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    className="input"
                    value={form.retencion_pct}
                    onChange={e => setForm(f => ({ ...f, retencion_pct: e.target.value }))}
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    0 si el cliente no es agente de retención.
                  </p>
                </div>
              </div>

              <div className="border-t border-gray-100 pt-4">
                <p className="text-sm font-medium text-gray-700 mb-3">
                  Datos fiscales
                  <span className="text-xs font-normal text-gray-400"> (necesarios para factura electrónica)</span>
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <label className="label">Tipo contribuyente</label>
                    <select
                      className="input"
                      value={form.tipo_contribuyente}
                      onChange={e => setForm(f => ({ ...f, tipo_contribuyente: e.target.value }))}
                    >
                      {FE_TIPO_CONTRIBUYENTE.map(t => (
                        <option key={t.codigo} value={String(t.codigo)}>{t.nombre}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Tipo cliente</label>
                    <select
                      className="input"
                      value={form.tipo_cliente}
                      onChange={e => setForm(f => ({ ...f, tipo_cliente: e.target.value }))}
                    >
                      {FE_TIPO_CLIENTE.map(t => (
                        <option key={t.codigo} value={t.codigo}>{t.nombre}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">RUC {['01', '03'].includes(form.tipo_cliente) ? '*' : ''}</label>
                    <input
                      className="input"
                      placeholder="1654682-1-676378"
                      value={form.ruc}
                      onChange={e => setForm(f => ({ ...f, ruc: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label">DV {['01', '03'].includes(form.tipo_cliente) ? '*' : ''}</label>
                    <input
                      className="input"
                      placeholder="06"
                      maxLength={2}
                      value={form.dv}
                      onChange={e => setForm(f => ({ ...f, dv: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="mt-3">
                  <label className="label">Dirección</label>
                  <input
                    className="input"
                    placeholder="Ej: Ave. Balboa, Edif. Torre 1, Piso 5"
                    value={form.direccion}
                    onChange={e => setForm(f => ({ ...f, direccion: e.target.value }))}
                  />
                </div>
              </div>

              <div className="border-t border-gray-100 pt-4">
                <p className="text-sm font-medium text-gray-700 mb-3">Contacto</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="label">Persona de contacto</label>
                    <input
                      className="input"
                      placeholder="Nombre de la persona"
                      value={form.contacto}
                      onChange={e => setForm(f => ({ ...f, contacto: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label">Email</label>
                    <input
                      type="email"
                      className="input"
                      placeholder="correo@cliente.com"
                      value={form.email}
                      onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label">Teléfono</label>
                    <input
                      className="input"
                      placeholder="Ej: 261-0000 ext 120"
                      value={form.telefono}
                      onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label">Teléfono móvil</label>
                    <input
                      className="input"
                      placeholder="Ej: 6000-0000"
                      value={form.telefono_movil}
                      onChange={e => setForm(f => ({ ...f, telefono_movil: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
            </div>

            {error && (
              <p className="mt-4 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
            )}

            <div className="flex gap-3 mt-6">
              <button className="btn-secondary flex-1" onClick={handleClose}>Cancelar</button>
              <button
                className="btn-primary flex-1"
                onClick={handleSave}
                disabled={saving || !form.nombre.trim()}
              >
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}

export default withPagePermission(ClientesPage, 'clientes', 'ver')
