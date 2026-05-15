'use client'

import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { createClient } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import { Proveedor } from '@/types'
import { Plus, Pencil, Trash2, Truck, Search, X, Check } from 'lucide-react'

export default function ProveedoresPage() {
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ nombre: '', dias_credito: '30' })
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const supabase = createClient()

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('proveedores')
      .select('*')
      .order('nombre')
    setProveedores(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleOpenForm = (p?: Proveedor) => {
    if (p) {
      setEditId(p.id)
      setForm({ nombre: p.nombre, dias_credito: String(p.dias_credito) })
    } else {
      setEditId(null)
      setForm({ nombre: '', dias_credito: '30' })
    }
    setShowForm(true)
  }

  const handleClose = () => {
    setShowForm(false)
    setEditId(null)
    setForm({ nombre: '', dias_credito: '30' })
  }

  const handleSave = async () => {
    if (!form.nombre.trim()) return
    setSaving(true)
    const payload = {
      nombre: form.nombre.trim(),
      dias_credito: parseInt(form.dias_credito) || 30,
    }
    if (editId) {
      await supabase.from('proveedores').update(payload).eq('id', editId)
    } else {
      await supabase.from('proveedores').insert(payload)
    }
    setSaving(false)
    handleClose()
    load()
  }

  const handleToggleActivo = async (p: Proveedor) => {
    await supabase.from('proveedores').update({ activo: !p.activo }).eq('id', p.id)
    load()
  }

  const handleDelete = async (id: string) => {
    await supabase.from('proveedores').delete().eq('id', id)
    setDeleteConfirm(null)
    load()
  }

  const filtered = proveedores.filter(p =>
    p.nombre.toLowerCase().includes(search.toLowerCase())
  )

  const activos = filtered.filter(p => p.activo)
  const inactivos = filtered.filter(p => !p.activo)

  return (
    <AppLayout>
      <Header
        title="Proveedores"
        subtitle={`${proveedores.filter(p => p.activo).length} proveedores activos`}
        actions={
          <button className="btn-primary flex items-center gap-2" onClick={() => handleOpenForm()}>
            <Plus size={16} />
            Nuevo proveedor
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        {/* Búsqueda */}
        <div className="relative max-w-sm mb-5">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="input pl-9"
            placeholder="Buscar proveedor..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="absolute right-3 top-1/2 -translate-y-1/2" onClick={() => setSearch('')}>
              <X size={14} className="text-gray-400 hover:text-gray-600" />
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Tabla de proveedores activos */}
            <div className="card overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
                <span className="text-sm font-medium text-gray-700">Activos ({activos.length})</span>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="table-header">Nombre</th>
                    <th className="table-header text-center">Días de crédito</th>
                    <th className="table-header">Creado</th>
                    <th className="table-header text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {activos.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-center py-10 text-gray-400">
                        <Truck size={32} className="mx-auto mb-2 opacity-30" />
                        No hay proveedores activos
                      </td>
                    </tr>
                  ) : activos.map(p => (
                    <tr key={p.id} className="hover:bg-gray-50 group">
                      <td className="table-cell">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center flex-shrink-0">
                            <Truck size={14} className="text-orange-600" />
                          </div>
                          <span className="font-medium text-gray-900">{p.nombre}</span>
                        </div>
                      </td>
                      <td className="table-cell text-center">
                        <span className="badge bg-blue-100 text-blue-700">{p.dias_credito} días</span>
                      </td>
                      <td className="table-cell text-gray-400 text-sm">{formatDate(p.created_at)}</td>
                      <td className="table-cell text-right">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => handleOpenForm(p)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50"
                            title="Editar"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            onClick={() => handleToggleActivo(p)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-yellow-600 hover:bg-yellow-50"
                            title="Desactivar"
                          >
                            <X size={15} />
                          </button>
                          {deleteConfirm === p.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleDelete(p.id)}
                                className="p-1.5 rounded-lg text-red-600 hover:bg-red-50"
                                title="Confirmar eliminación"
                              >
                                <Check size={15} />
                              </button>
                              <button
                                onClick={() => setDeleteConfirm(null)}
                                className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100"
                              >
                                <X size={15} />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDeleteConfirm(p.id)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"
                              title="Eliminar"
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Inactivos */}
            {inactivos.length > 0 && (
              <div className="card overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
                  <span className="text-sm font-medium text-gray-500">Inactivos ({inactivos.length})</span>
                </div>
                <table className="w-full">
                  <tbody className="divide-y divide-gray-100">
                    {inactivos.map(p => (
                      <tr key={p.id} className="hover:bg-gray-50 group opacity-60">
                        <td className="table-cell">
                          <span className="font-medium text-gray-600">{p.nombre}</span>
                        </td>
                        <td className="table-cell text-center">
                          <span className="badge bg-gray-100 text-gray-500">{p.dias_credito} días</span>
                        </td>
                        <td className="table-cell text-gray-400 text-sm">{formatDate(p.created_at)}</td>
                        <td className="table-cell text-right">
                          <button
                            onClick={() => handleToggleActivo(p)}
                            className="text-xs text-brand-600 hover:text-brand-800 opacity-0 group-hover:opacity-100"
                          >
                            Reactivar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold mb-5">
              {editId ? 'Editar proveedor' : 'Nuevo proveedor'}
            </h2>
            <div className="space-y-4">
              <div>
                <label className="label">Nombre del proveedor</label>
                <input
                  className="input"
                  placeholder="Ej: Distribuidora Nacional"
                  value={form.nombre}
                  onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                  autoFocus
                />
              </div>
              <div>
                <label className="label">Días de crédito</label>
                <input
                  type="number"
                  min="0"
                  className="input"
                  placeholder="30"
                  value={form.dias_credito}
                  onChange={e => setForm(f => ({ ...f, dias_credito: e.target.value }))}
                />
                <p className="text-xs text-gray-400 mt-1">
                  El vencimiento de cada compra se calcula automáticamente como fecha + días de crédito.
                </p>
              </div>
            </div>
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
