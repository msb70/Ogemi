'use client'

import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { createClient } from '@/lib/supabase'
import { formatCurrency, formatDate, tramoColor } from '@/lib/utils'
import { BancoCuenta, Cliente } from '@/types'
import { Search, CheckCircle, Filter, X, Plus, Trash2, FileText, Download } from 'lucide-react'

type EstadoFilter = 'todos' | 'pendiente' | 'pagada'

interface Presupuesto {
  id: string
  numero_presupuesto: number
  fecha: string
  cliente_id: string
  tipo_documento: string
  documento_afectado: number | null
  monto: number
  itbms: number
  total: number
  fecha_pago: string | null
  estado: 'pendiente' | 'pagada'
  fecha_cobro: string | null
  banco_cuenta_id: string | null
  notas: string | null
  monto_pagado: number
  clientes?: Cliente
  banco_cuentas?: BancoCuenta
}

export default function PresupuestosPage() {
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [cuentas, setCuentas] = useState<BancoCuenta[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [estadoFilter, setEstadoFilter] = useState<EstadoFilter>('todos')

  // Modal pago
  const [selected, setSelected] = useState<Presupuesto | null>(null)
  const [showPagoModal, setShowPagoModal] = useState(false)
  const [fechaCobro, setFechaCobro] = useState('')
  const [cuentaId, setCuentaId] = useState('')
  const [saving, setSaving] = useState(false)

  // Modal nuevo/editar
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [savingForm, setSavingForm] = useState(false)
  const [form, setForm] = useState({
    numero_presupuesto: '',
    fecha: new Date().toISOString().split('T')[0],
    cliente_id: '',
    tipo_documento: 'PRESUPUESTO',
    monto: '',
    itbms: '',
    notas: '',
  })

  const supabase = createClient()

  const loadData = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('presupuestos')
      .select('*, clientes(nombre, dias_credito), banco_cuentas(nombre, banco)')
      .order('fecha', { ascending: false })
      .order('numero_presupuesto', { ascending: false })
    if (estadoFilter !== 'todos') query = query.eq('estado', estadoFilter)

    const [{ data: presData }, { data: cliData }, { data: cuentasData }] = await Promise.all([
      query,
      supabase.from('clientes').select('*').eq('activo', true).order('nombre'),
      supabase.from('banco_cuentas').select('*').eq('activo', true).order('nombre'),
    ])
    setPresupuestos(presData || [])
    setClientes(cliData || [])
    setCuentas(cuentasData || [])
    setLoading(false)
  }, [estadoFilter])

  useEffect(() => { loadData() }, [loadData])

  const filtered = presupuestos.filter(p => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      p.numero_presupuesto?.toString().includes(q) ||
      p.clientes?.nombre?.toLowerCase().includes(q)
    )
  })

  const getDiasVencida = (p: Presupuesto) => {
    if (!p.fecha_pago) return 0
    return Math.floor((new Date().getTime() - new Date(p.fecha_pago + 'T00:00:00').getTime()) / 86400000)
  }
  const getTramo = (dias: number) => {
    if (dias <= 0) return 'corriente'
    if (dias <= 30) return '1-30'
    if (dias <= 60) return '31-60'
    if (dias <= 90) return '61-90'
    return '+120'
  }

  const openPagoModal = (p: Presupuesto) => {
    setSelected(p)
    setFechaCobro(new Date().toISOString().split('T')[0])
    setCuentaId(cuentas[0]?.id || '')
    setShowPagoModal(true)
  }

  const handleCobrar = async () => {
    if (!selected || !cuentaId) return
    setSaving(true)
    await supabase.from('presupuestos').update({
      estado: 'pagada',
      fecha_cobro: fechaCobro,
      banco_cuenta_id: cuentaId,
      monto_pagado: selected.total,
    }).eq('id', selected.id)
    setSaving(false)
    setShowPagoModal(false)
    loadData()
  }

  const resetForm = () => {
    setForm({ numero_presupuesto: '', fecha: new Date().toISOString().split('T')[0], cliente_id: '', tipo_documento: 'PRESUPUESTO', monto: '', itbms: '0', notas: '' })
    setEditId(null)
  }

  const openForm = async (p?: Presupuesto) => {
    if (p) {
      setEditId(p.id)
      setForm({
        numero_presupuesto: String(p.numero_presupuesto),
        fecha: p.fecha,
        cliente_id: p.cliente_id,
        tipo_documento: p.tipo_documento,
        monto: String(p.monto),
        itbms: String(p.itbms),
        notas: p.notas || '',
      })
    } else {
      // Auto-numerar: max actual + 1
      const { data } = await supabase
        .from('presupuestos')
        .select('numero_presupuesto')
        .order('numero_presupuesto', { ascending: false })
        .limit(1)
      const siguiente = data && data.length > 0 ? (data[0].numero_presupuesto + 1) : 1
      resetForm()
      setForm(f => ({ ...f, numero_presupuesto: String(siguiente), itbms: '0' }))
    }
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.cliente_id || !form.numero_presupuesto || !form.monto) return
    setSavingForm(true)
    const monto = parseFloat(form.monto) || 0
    const itbms = parseFloat(form.itbms) || 0
    const payload = {
      numero_presupuesto: parseInt(form.numero_presupuesto),
      fecha: form.fecha,
      cliente_id: form.cliente_id,
      tipo_documento: form.tipo_documento,
      monto,
      itbms,
      total: monto + itbms,
      notas: form.notas || null,
    }
    if (editId) {
      await supabase.from('presupuestos').update(payload).eq('id', editId)
    } else {
      await supabase.from('presupuestos').insert(payload)
    }
    setSavingForm(false)
    setShowForm(false)
    resetForm()
    loadData()
  }

  const exportCSV = () => {
    const rows = filtered.map(p => [
      p.numero_presupuesto, p.fecha, p.clientes?.nombre || '', p.tipo_documento,
      p.monto, p.itbms, p.total, p.estado, p.fecha_pago || '', p.fecha_cobro || ''
    ])
    const csv = [
      ['#', 'Fecha', 'Cliente', 'Tipo', 'Monto', 'ITBMS', 'Total', 'Estado', 'Vence', 'Cobrado'],
      ...rows
    ].map(r => r.map(v => `"${v ?? ''}"`).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `presupuestos_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
  }

  const totalPendiente = presupuestos.filter(p => p.estado === 'pendiente').reduce((s, p) => s + p.total, 0)
  const totalPagado = presupuestos.filter(p => p.estado === 'pagada').reduce((s, p) => s + p.total, 0)

  return (
    <AppLayout>
      <Header
        title="Presupuestos"
        subtitle={`${filtered.length} registros · ${presupuestos.filter(p => p.estado === 'pendiente').length} pendientes`}
        actions={
          <div className="flex items-center gap-2">
            <button className="btn-secondary flex items-center gap-2" onClick={exportCSV}>
              <Download size={16} />Exportar
            </button>
            <button className="btn-primary flex items-center gap-2" onClick={() => openForm()}>
              <Plus size={16} />Nuevo presupuesto
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className="px-6 py-4 bg-white border-b border-gray-100">
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-orange-50 rounded-xl p-3">
            <p className="text-xs text-gray-500 mb-0.5">Pendiente de cobro</p>
            <p className="text-lg font-bold text-orange-600">{formatCurrency(totalPendiente)}</p>
          </div>
          <div className="bg-green-50 rounded-xl p-3">
            <p className="text-xs text-gray-500 mb-0.5">Cobrado</p>
            <p className="text-lg font-bold text-green-600">{formatCurrency(totalPagado)}</p>
          </div>
          <div className="bg-brand-50 rounded-xl p-3">
            <p className="text-xs text-gray-500 mb-0.5">Total registrado</p>
            <p className="text-lg font-bold text-brand-700">{formatCurrency(totalPendiente + totalPagado)}</p>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9" placeholder="Buscar por #, cliente..." value={search}
            onChange={e => setSearch(e.target.value)} />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Filter size={16} className="text-gray-400" />
          {(['todos', 'pendiente', 'pagada'] as EstadoFilter[]).map(e => (
            <button key={e} onClick={() => setEstadoFilter(e)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                estadoFilter === e ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              {e.charAt(0).toUpperCase() + e.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Tabla */}
      <div className="flex-1 overflow-auto p-6">
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="table-header">#Presupuesto</th>
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
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} className="text-center py-12 text-gray-400">
                  <FileText size={32} className="mx-auto mb-2 opacity-30" />
                  Sin presupuestos registrados
                </td></tr>
              ) : filtered.map(p => {
                const dias = p.estado === 'pendiente' ? getDiasVencida(p) : 0
                const tramo = p.estado === 'pendiente' ? getTramo(dias) : null
                const montoPagado = p.monto_pagado || 0
                const saldo = p.total - montoPagado
                return (
                  <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                    <td className="table-cell font-mono font-medium">#{p.numero_presupuesto}</td>
                    <td className="table-cell text-gray-500">{formatDate(p.fecha)}</td>
                    <td className="table-cell max-w-[180px]">
                      <span className="truncate block" title={p.clientes?.nombre}>{p.clientes?.nombre}</span>
                    </td>
                    <td className="table-cell">
                      <span className="badge bg-blue-100 text-blue-700 text-xs">{p.tipo_documento}</span>
                    </td>
                    <td className="table-cell text-right font-semibold">{formatCurrency(p.total)}</td>
                    <td className="table-cell text-right text-green-600">
                      {montoPagado > 0 ? formatCurrency(montoPagado) : '—'}
                    </td>
                    <td className="table-cell text-right font-semibold text-orange-600">
                      {p.estado === 'pagada'
                        ? <span className="text-green-600 text-sm">Saldado</span>
                        : formatCurrency(saldo)}
                    </td>
                    <td className="table-cell">
                      <div className="flex flex-col">
                        <span className="text-xs">{formatDate(p.fecha_pago)}</span>
                        {tramo && p.estado === 'pendiente' && (
                          <span className={`badge mt-0.5 text-xs ${tramoColor(tramo)}`}>{tramo}</span>
                        )}
                      </div>
                    </td>
                    <td className="table-cell">
                      <span className={`badge ${p.estado === 'pagada' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                        {p.estado}
                      </span>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center gap-2">
                        {p.estado === 'pendiente' && p.total > 0 && (
                          <button onClick={() => openPagoModal(p)}
                            className="flex items-center gap-1.5 text-sm text-green-600 hover:text-green-800 font-medium">
                            <CheckCircle size={15} />Cobrar
                          </button>
                        )}
                        <button onClick={() => openForm(p)}
                          className="text-xs text-gray-400 hover:text-brand-600">Editar</button>
                        {p.estado === 'pagada' && (
                          <span className="text-xs text-gray-400">{formatDate(p.fecha_cobro)}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Cobrar presupuesto */}
      {showPagoModal && selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold mb-1">Registrar cobro</h2>
            <p className="text-sm text-gray-500 mb-4">
              Presupuesto #{selected.numero_presupuesto} · {selected.clientes?.nombre}
            </p>
            <div className="bg-gray-50 rounded-xl p-4 mb-4">
              <div className="flex justify-between text-sm font-semibold">
                <span>Total a cobrar</span>
                <span className="text-brand-700">{formatCurrency(selected.total)}</span>
              </div>
            </div>
            <div className="space-y-3 mb-5">
              <div>
                <label className="label">Fecha de cobro</label>
                <input type="date" className="input" value={fechaCobro}
                  onChange={e => setFechaCobro(e.target.value)} />
              </div>
              <div>
                <label className="label">Cuenta bancaria</label>
                <select className="input" value={cuentaId} onChange={e => setCuentaId(e.target.value)}>
                  <option value="">Seleccionar cuenta...</option>
                  {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre} – {c.banco}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => setShowPagoModal(false)}>Cancelar</button>
              <button className="btn-primary flex-1" onClick={handleCobrar}
                disabled={saving || !cuentaId}>
                {saving ? 'Guardando...' : 'Registrar cobro'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Nuevo / Editar presupuesto */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold mb-5">{editId ? 'Editar presupuesto' : 'Nuevo presupuesto'}</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Número</label>
                  <div className="input bg-gray-50 text-gray-500 font-mono flex items-center">
                    #{form.numero_presupuesto || '—'}
                    {!editId && <span className="ml-auto text-xs text-gray-400">Auto</span>}
                  </div>
                </div>
                <div>
                  <label className="label">Fecha *</label>
                  <input type="date" className="input" value={form.fecha}
                    onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="label">Cliente *</label>
                <select className="input" value={form.cliente_id}
                  onChange={e => setForm(f => ({ ...f, cliente_id: e.target.value }))}>
                  <option value="">Seleccionar cliente...</option>
                  {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Tipo de documento</label>
                <input className="input" value={form.tipo_documento}
                  onChange={e => setForm(f => ({ ...f, tipo_documento: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Monto *</label>
                  <input type="number" step="0.01" className="input" placeholder="0.00"
                    value={form.monto} autoFocus
                    onChange={e => setForm(f => ({ ...f, monto: e.target.value }))} />
                </div>
                <div>
                  <label className="label">ITBMS</label>
                  <input type="number" step="0.01" className="input"
                    value={form.itbms}
                    onChange={e => setForm(f => ({ ...f, itbms: e.target.value }))} />
                </div>
              </div>
              {(parseFloat(form.monto) || 0) + (parseFloat(form.itbms) || 0) > 0 && (
                <div className="bg-gray-50 rounded-xl p-3 flex justify-between">
                  <span className="text-sm text-gray-600">Total</span>
                  <span className="text-lg font-bold text-brand-700">
                    {formatCurrency((parseFloat(form.monto) || 0) + (parseFloat(form.itbms) || 0))}
                  </span>
                </div>
              )}
              <div>
                <label className="label">Notas</label>
                <textarea className="input resize-none" rows={2} value={form.notas}
                  onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button className="btn-secondary flex-1" onClick={() => { setShowForm(false); resetForm() }}>Cancelar</button>
              <button className="btn-primary flex-1" onClick={handleSave}
                disabled={savingForm || !form.cliente_id || !form.numero_presupuesto || !form.monto}>
                {savingForm ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
