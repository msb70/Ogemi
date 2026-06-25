'use client'

import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { createClient } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { NotaCredito, Cliente } from '@/types'
import { Plus, Search, X, Pencil, Trash2 } from 'lucide-react'
import { Toast } from '@/components/Toast'
import { useToast } from '@/hooks/useToast'
import PermissionGuard, { withPagePermission } from '@/components/PermissionGuard'

type EstadoFilter = 'todas' | 'disponible' | 'aplicada'

const emptyForm = () => ({
  id: '' as string,
  cliente_id: '',
  numero: '',
  fecha: new Date().toISOString().split('T')[0],
  monto: '',
  itbms: '',
})

function NotasCreditoPage() {
  const [notas, setNotas] = useState<NotaCredito[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [estadoFilter, setEstadoFilter] = useState<EstadoFilter>('todas')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)

  const { toast, showToast, hideToast } = useToast()
  const supabase = createClient()

  const loadData = useCallback(async () => {
    setLoading(true)
    const [{ data: ncData }, { data: cliData }] = await Promise.all([
      supabase.from('notas_credito').select('*, clientes(nombre), factura_aplicada:facturas!factura_aplicada_id(numero_factura)').order('fecha', { ascending: false }),
      supabase.from('clientes').select('*').eq('activo', true).order('nombre'),
    ])
    setNotas((ncData || []) as NotaCredito[])
    setClientes((cliData || []) as Cliente[])
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const filtered = notas.filter(n => {
    if (estadoFilter !== 'todas' && n.estado !== estadoFilter) return false
    if (!search) return true
    const s = search.toLowerCase()
    return (n.clientes?.nombre || '').toLowerCase().includes(s) || (n.numero || '').toLowerCase().includes(s)
  })

  const totalForm = (parseFloat(form.monto) || 0) + (parseFloat(form.itbms) || 0)

  const openNew = () => { setForm(emptyForm()); setShowForm(true) }

  // Des-aplica una NC: reversa su pago, lo que la devuelve a 'disponible' y
  // restaura el saldo de la factura. Devuelve true si quedó libre.
  const desaplicarNC = async (n: NotaCredito): Promise<boolean> => {
    if (n.estado !== 'aplicada' || !n.pago_id) return true
    const { error } = await supabase.rpc('reversar_pago', {
      p_pago_id: n.pago_id,
      p_motivo: 'Edición/borrado de nota de crédito',
    })
    if (error) { showToast(`No se pudo liberar la NC: ${error.message}`, 'error'); return false }
    return true
  }

  const openEdit = async (n: NotaCredito) => {
    if (n.estado === 'aplicada') {
      const fnum = n.factura_aplicada?.numero_factura
      if (!confirm(`Esta NC está aplicada a la factura #${fnum ?? ''}. Para editarla se liberará ese pago (la factura volverá a quedar con saldo). ¿Continuar?`)) return
      const ok = await desaplicarNC(n)
      if (!ok) return
      showToast('NC liberada. Ahora puedes editarla.', 'success')
    }
    setForm({ id: n.id, cliente_id: n.cliente_id, numero: n.numero || '', fecha: n.fecha, monto: String(n.monto), itbms: String(n.itbms) })
    setShowForm(true)
    loadData()
  }

  const handleSave = async () => {
    if (!form.cliente_id) { showToast('Selecciona un cliente.', 'error'); return }
    const monto = parseFloat(form.monto) || 0
    const itbms = parseFloat(form.itbms) || 0
    if (monto + itbms <= 0) { showToast('El total debe ser mayor a 0.', 'error'); return }
    setSaving(true)
    const payload = { cliente_id: form.cliente_id, numero: form.numero.trim() || null, fecha: form.fecha, monto, itbms }
    const { error } = form.id
      ? await supabase.from('notas_credito').update(payload).eq('id', form.id)
      : await supabase.from('notas_credito').insert(payload)
    setSaving(false)
    if (error) { showToast(`No se pudo guardar: ${error.message}`, 'error'); return }
    setShowForm(false)
    showToast('Nota de crédito guardada', 'success')
    loadData()
  }

  const handleDelete = async (n: NotaCredito) => {
    if (n.estado === 'aplicada') {
      const fnum = n.factura_aplicada?.numero_factura
      if (!confirm(`La NC ${n.numero || ''} está aplicada a la factura #${fnum ?? ''}. Al borrarla se liberará ese pago (la factura volverá a quedar con saldo) y se eliminará la NC. ¿Continuar?`)) return
      const ok = await desaplicarNC(n)
      if (!ok) return
    } else {
      if (!confirm(`¿Borrar la nota de crédito ${n.numero || ''} de ${formatCurrency(n.total)}?`)) return
    }
    const { error } = await supabase.from('notas_credito').delete().eq('id', n.id)
    if (error) { showToast(`No se pudo borrar: ${error.message}`, 'error'); return }
    showToast('Nota de crédito borrada', 'success')
    loadData()
  }

  return (
    <AppLayout>
      {toast && <Toast {...toast} onClose={hideToast} />}
      <Header
        title="Notas de crédito"
        subtitle={`${filtered.length} registros`}
        actions={
          <PermissionGuard modulo="notas_credito" accion="agregar" silent>
            <button className="btn-primary flex items-center gap-2" onClick={openNew}>
              <Plus size={16} /> Nueva nota de crédito
            </button>
          </PermissionGuard>
        }
      />

      {/* Filtros */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-sm min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9" placeholder="Buscar por cliente o número..." value={search} onChange={e => setSearch(e.target.value)} />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"><X size={14} /></button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {(['todas', 'disponible', 'aplicada'] as EstadoFilter[]).map(e => (
            <button key={e} onClick={() => setEstadoFilter(e)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${estadoFilter === e ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {e.charAt(0).toUpperCase() + e.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="table-header">Número</th>
                <th className="table-header">Fecha</th>
                <th className="table-header">Cliente</th>
                <th className="table-header text-right">Neto</th>
                <th className="table-header text-right">ITBMS</th>
                <th className="table-header text-right">Total</th>
                <th className="table-header">Estado</th>
                <th className="table-header">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={8} className="text-center py-12 text-gray-400">Cargando...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-gray-400">Sin notas de crédito</td></tr>
              ) : filtered.map(n => (
                <tr key={n.id} className="hover:bg-gray-50">
                  <td className="table-cell font-mono">{n.numero || '—'}</td>
                  <td className="table-cell text-gray-500">{formatDate(n.fecha)}</td>
                  <td className="table-cell max-w-[220px]"><span className="truncate block" title={n.clientes?.nombre}>{n.clientes?.nombre}</span></td>
                  <td className="table-cell text-right">{formatCurrency(n.monto)}</td>
                  <td className="table-cell text-right">{formatCurrency(n.itbms)}</td>
                  <td className="table-cell text-right font-semibold">{formatCurrency(n.total)}</td>
                  <td className="table-cell">
                    <span className={`badge ${n.estado === 'aplicada' ? 'bg-gray-200 text-gray-600' : 'bg-green-100 text-green-700'}`}>
                      {n.estado === 'aplicada' ? 'Aplicada' : 'Disponible'}
                    </span>
                  </td>
                  <td className="table-cell">
                    <div className="flex items-center gap-3">
                      {n.estado === 'aplicada' && (
                        <span className="text-xs text-gray-500">Aplicada a factura #{n.factura_aplicada?.numero_factura ?? '—'}</span>
                      )}
                      <PermissionGuard modulo="notas_credito" accion="editar" silent>
                        <button onClick={() => openEdit(n)} className="flex items-center gap-1 text-sm text-brand-600 hover:text-brand-800"><Pencil size={14} /> Editar</button>
                      </PermissionGuard>
                      <PermissionGuard modulo="notas_credito" accion="borrar" silent>
                        <button onClick={() => handleDelete(n)} className="flex items-center gap-1 text-sm text-red-500 hover:text-red-700"><Trash2 size={14} /> Borrar</button>
                      </PermissionGuard>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-3">
          Las notas de crédito disponibles se aplican como pago desde la factura (botón Cobrar). Una NC se usa una sola vez.
        </p>
      </div>

      {/* Modal crear/editar */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold mb-4">{form.id ? 'Editar' : 'Nueva'} nota de crédito</h2>
            <div className="space-y-3">
              <div>
                <label className="label">Cliente *</label>
                <select className="input" value={form.cliente_id} onChange={e => setForm(f => ({ ...f, cliente_id: e.target.value }))}>
                  <option value="">Seleccionar cliente...</option>
                  {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Número</label>
                  <input className="input" placeholder="NC-001" value={form.numero} onChange={e => setForm(f => ({ ...f, numero: e.target.value }))} /></div>
                <div><label className="label">Fecha *</label>
                  <input type="date" className="input" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Neto *</label>
                  <input type="number" step="0.01" min="0" className="input" placeholder="0.00" value={form.monto} onChange={e => setForm(f => ({ ...f, monto: e.target.value }))} /></div>
                <div><label className="label">ITBMS</label>
                  <input type="number" step="0.01" min="0" className="input" placeholder="0.00" value={form.itbms} onChange={e => setForm(f => ({ ...f, itbms: e.target.value }))} /></div>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 flex justify-between">
                <span className="text-sm text-gray-600">Total</span>
                <span className="text-lg font-bold text-brand-700">{formatCurrency(totalForm)}</span>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button className="btn-secondary flex-1" onClick={() => setShowForm(false)}>Cancelar</button>
              <button className="btn-primary flex-1" onClick={handleSave} disabled={saving || !form.cliente_id || totalForm <= 0}>
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}

export default withPagePermission(NotasCreditoPage, 'notas_credito', 'ver')
