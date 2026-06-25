'use client'

import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { createClient } from '@/lib/supabase'
import { Cliente } from '@/types'
import { Plus, Pencil, Search, X, Check } from 'lucide-react'
import { withPagePermission } from '@/components/PermissionGuard'

function ClientesPage() {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDias, setEditDias] = useState<number>(30)
  const [editRet, setEditRet] = useState<number>(0)
  const [showNew, setShowNew] = useState(false)
  const [newNombre, setNewNombre] = useState('')
  const [newDias, setNewDias] = useState(30)
  const [newRet, setNewRet] = useState(0)
  const [saving, setSaving] = useState(false)

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

  const filtered = clientes.filter(c =>
    !search || c.nombre.toLowerCase().includes(search.toLowerCase())
  )

  const handleSaveDias = async (id: string) => {
    const ret = Math.min(100, Math.max(0, editRet || 0))
    setSaving(true)
    await supabase.from('clientes').update({ dias_credito: editDias, retencion_pct: ret }).eq('id', id)
    setEditingId(null)
    setSaving(false)
    loadData()
  }

  const handleCreate = async () => {
    if (!newNombre.trim()) return
    const ret = Math.min(100, Math.max(0, newRet || 0))
    setSaving(true)
    await supabase.from('clientes').insert({ nombre: newNombre.trim(), dias_credito: newDias, retencion_pct: ret })
    setShowNew(false)
    setNewNombre('')
    setNewDias(30)
    setNewRet(0)
    setSaving(false)
    loadData()
  }

  const handleToggleActivo = async (c: Cliente) => {
    await supabase.from('clientes').update({ activo: !c.activo }).eq('id', c.id)
    loadData()
  }

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

  const fmt = (n: number) => new Intl.NumberFormat('es-PA', { style: 'currency', currency: 'USD' }).format(n)

  return (
    <AppLayout>
      <Header
        title="Clientes"
        subtitle={`${filtered.length} clientes`}
        actions={
          <button className="btn-primary flex items-center gap-2" onClick={() => setShowNew(true)}>
            <Plus size={16} />
            Nuevo cliente
          </button>
        }
      />

      {/* Filters */}
      <div className="bg-white border-b border-gray-200 px-6 py-3">
        <div className="relative max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="input pl-9"
            placeholder="Buscar cliente..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6">
        {/* New cliente form */}
        {showNew && (
          <div className="card p-4 mb-4 flex items-center gap-3">
            <div className="flex-1">
              <input
                className="input"
                placeholder="Nombre del cliente"
                value={newNombre}
                onChange={(e) => setNewNombre(e.target.value)}
                autoFocus
              />
            </div>
            <div className="w-36">
              <label className="block text-[11px] text-gray-500 mb-0.5">Días crédito</label>
              <input
                type="number"
                className="input"
                placeholder="Días crédito"
                value={newDias}
                min={0}
                onChange={(e) => setNewDias(parseInt(e.target.value) || 0)}
              />
            </div>
            <div className="w-32">
              <label className="block text-[11px] text-gray-500 mb-0.5">Retención %</label>
              <input
                type="number"
                className="input"
                placeholder="0"
                value={newRet}
                min={0}
                max={100}
                step="0.01"
                onChange={(e) => setNewRet(parseFloat(e.target.value) || 0)}
              />
            </div>
            <button className="btn-primary self-end" onClick={handleCreate} disabled={saving || !newNombre.trim()}>
              {saving ? '...' : 'Guardar'}
            </button>
            <button className="btn-secondary" onClick={() => setShowNew(false)}>Cancelar</button>
          </div>
        )}

        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="table-header">Cliente</th>
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
                <tr><td colSpan={7} className="text-center py-12 text-gray-400">Cargando...</td></tr>
              ) : filtered.map(c => (
                <tr key={c.id} className={`hover:bg-gray-50 ${!c.activo ? 'opacity-50' : ''}`}>
                  <td className="table-cell font-medium max-w-[280px]">
                    <span className="truncate block" title={c.nombre}>{c.nombre}</span>
                  </td>
                  <td className="table-cell">
                    {editingId === c.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          className="input w-20 py-1"
                          value={editDias}
                          min={0}
                          onChange={(e) => setEditDias(parseInt(e.target.value) || 0)}
                          autoFocus
                        />
                        <button onClick={() => handleSaveDias(c.id)} className="text-green-600 hover:text-green-800">
                          <Check size={16} />
                        </button>
                        <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-600">
                          <X size={16} />
                        </button>
                      </div>
                    ) : (
                      <span className="badge bg-blue-50 text-blue-700">{c.dias_credito} días</span>
                    )}
                  </td>
                  <td className="table-cell">
                    {editingId === c.id ? (
                      <input
                        type="number"
                        className="input w-20 py-1"
                        value={editRet}
                        min={0}
                        max={100}
                        step="0.01"
                        onChange={(e) => setEditRet(parseFloat(e.target.value) || 0)}
                      />
                    ) : (
                      (c.retencion_pct || 0) > 0
                        ? <span className="badge bg-amber-50 text-amber-700">{c.retencion_pct}%</span>
                        : <span className="text-gray-400 text-sm">—</span>
                    )}
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
                        onClick={() => { setEditingId(c.id); setEditDias(c.dias_credito); setEditRet(c.retencion_pct || 0) }}
                        className="text-gray-400 hover:text-brand-600"
                        title="Editar días de crédito y retención"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => handleToggleActivo(c)}
                        className={`text-xs font-medium ${c.activo ? 'text-red-500 hover:text-red-700' : 'text-green-500 hover:text-green-700'}`}
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
    </AppLayout>
  )
}

export default withPagePermission(ClientesPage, 'clientes', 'ver')
