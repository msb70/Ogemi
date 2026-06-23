'use client'

import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { createClient } from '@/lib/supabase'
import { formatCurrency, formatDate, tramoColor } from '@/lib/utils'
import { BancoCuenta, Cliente } from '@/types'
import { Search, CheckCircle, Filter, X, Plus, Trash2, FileText, Download, Eye, Printer } from 'lucide-react'
import type { CSSProperties } from 'react'
import { withPagePermission } from '@/components/PermissionGuard'

type EstadoFilter = 'todos' | 'pendiente' | 'pagada'

interface LineaPago {
  origen: 'cuenta' | 'anticipo'
  cuenta_id: string
  anticipo_id: string
  monto: string
  referencia: string
}

type AnticipoDisp = {
  id: string
  fecha: string
  monto: number
  saldo: number
  numero_deposito: string | null
  cuenta_id: string
}

const emptyLinea = (cuentaId = ''): LineaPago => ({
  origen: 'cuenta', cuenta_id: cuentaId, anticipo_id: '', monto: '', referencia: '',
})

interface Presupuesto {
  id: string
  numero_presupuesto: number
  orden_trabajo: string | null
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

function PresupuestosPage() {
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [cuentas, setCuentas] = useState<BancoCuenta[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [estadoFilter, setEstadoFilter] = useState<EstadoFilter>('todos')
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')

  // Modal pago (multi-línea, igual a facturas)
  const [selected, setSelected] = useState<Presupuesto | null>(null)
  const [showPagoModal, setShowPagoModal] = useState(false)
  const [fechaCobro, setFechaCobro] = useState('')
  const [lineas, setLineas] = useState<LineaPago[]>([emptyLinea()])
  const [anticipos, setAnticipos] = useState<AnticipoDisp[]>([])
  const [pagosExistentes, setPagosExistentes] = useState<any[]>([])
  const [saving, setSaving] = useState(false)

  // Modal de detalle (ver presupuesto)
  const [detalle, setDetalle] = useState<Presupuesto | null>(null)
  const [detallePagos, setDetallePagos] = useState<any[]>([])
  const [loadingDetalle, setLoadingDetalle] = useState(false)

  // Modal nuevo/editar
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [savingForm, setSavingForm] = useState(false)
  const otAnioActual = String(new Date().getFullYear() % 100).padStart(2, '0')
  const [form, setForm] = useState({
    numero_presupuesto: '',
    ot_anio: otAnioActual,
    ot_num: '',
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
    if (fechaDesde) query = query.gte('fecha', fechaDesde)
    if (fechaHasta) query = query.lte('fecha', fechaHasta)

    const [{ data: presData }, { data: cliData }, { data: cuentasData }] = await Promise.all([
      query,
      supabase.from('clientes').select('*').eq('activo', true).order('nombre'),
      supabase.from('banco_cuentas').select('*').eq('activo', true).order('nombre'),
    ])
    setPresupuestos(presData || [])
    setClientes(cliData || [])
    setCuentas(cuentasData || [])
    setLoading(false)
  }, [estadoFilter, fechaDesde, fechaHasta])

  useEffect(() => { loadData() }, [loadData])

  const filtered = presupuestos.filter(p => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      p.numero_presupuesto?.toString().includes(q) ||
      p.orden_trabajo?.toLowerCase().includes(q) ||
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

  const openPagoModal = async (p: Presupuesto) => {
    setSelected(p)
    setFechaCobro(new Date().toISOString().split('T')[0])
    setLineas([emptyLinea(cuentas[0]?.id || '')])
    setAnticipos([])
    setShowPagoModal(true)
    const [{ data: pagosData }, { data: anticData }] = await Promise.all([
      supabase.from('pagos').select('*, banco_cuentas(nombre, banco)')
        .eq('presupuesto_id', p.id).order('fecha', { ascending: false }),
      supabase.from('anticipos_saldos')
        .select('id, fecha, monto, saldo, numero_deposito, cuenta_id')
        .eq('cliente_id', p.cliente_id).eq('estado', 'activo').gt('saldo', 0).order('fecha'),
    ])
    setPagosExistentes(pagosData || [])
    setAnticipos((anticData || []) as AnticipoDisp[])
  }

  const openDetalle = async (p: Presupuesto) => {
    setDetalle(p)
    setLoadingDetalle(true)
    setDetallePagos([])
    const { data } = await supabase
      .from('pagos')
      .select('id, fecha, monto, referencia, anticipo_id, banco_cuentas(nombre, banco, numero_cuenta), anticipos(numero_deposito)')
      .eq('presupuesto_id', p.id)
      .order('fecha', { ascending: true })
    setDetallePagos(data || [])
    setLoadingDetalle(false)
  }

  const addLinea = () => setLineas(prev => [...prev, emptyLinea(cuentas[0]?.id || '')])
  const removeLinea = (idx: number) => setLineas(prev => prev.filter((_, i) => i !== idx))
  const updateLinea = (idx: number, field: keyof LineaPago, value: string) =>
    setLineas(prev => prev.map((l, i) => i === idx ? ({ ...l, [field]: value } as LineaPago) : l))

  const totalLineas = lineas.reduce((s, l) => s + (parseFloat(l.monto) || 0), 0)
  const saldoPendiente = selected ? (selected.total - (selected.monto_pagado || 0)) : 0

  const handleRegistrarAbono = async () => {
    if (!selected) return
    const validas = lineas.filter(l =>
      parseFloat(l.monto) > 0 && (l.origen === 'cuenta' ? l.cuenta_id : l.anticipo_id)
    )
    if (validas.length === 0) return
    for (const l of validas) {
      if (l.origen === 'anticipo') {
        const ant = anticipos.find(a => a.id === l.anticipo_id)
        if (ant && parseFloat(l.monto) > ant.saldo + 0.01) {
          alert(`El monto supera el saldo del anticipo (${formatCurrency(ant.saldo)})`)
          return
        }
      }
    }
    setSaving(true)
    const pagosInsert = validas.map(l => {
      const ant = l.origen === 'anticipo' ? anticipos.find(a => a.id === l.anticipo_id) : null
      return {
        presupuesto_id: selected.id,
        cuenta_id: l.origen === 'anticipo' ? (ant?.cuenta_id || null) : l.cuenta_id,
        anticipo_id: l.origen === 'anticipo' ? l.anticipo_id : null,
        monto: parseFloat(l.monto),
        fecha: fechaCobro,
        referencia: l.referencia || (l.origen === 'anticipo' ? 'Aplicación de anticipo' : null),
      }
    })
    const { error } = await supabase.from('pagos').insert(pagosInsert)
    setSaving(false)
    if (error) {
      alert(`Error al registrar el cobro: ${error.message}`)
      return
    }
    setShowPagoModal(false)
    setSelected(null)
    loadData()
  }

  const resetForm = () => {
    setForm({ numero_presupuesto: '', ot_anio: otAnioActual, ot_num: '', fecha: new Date().toISOString().split('T')[0], cliente_id: '', tipo_documento: 'PRESUPUESTO', monto: '', itbms: '0', notas: '' })
    setEditId(null)
  }

  const openForm = async (p?: Presupuesto) => {
    if (p) {
      setEditId(p.id)
      const otMatch = p.orden_trabajo?.match(/^(\d{2})-(\d+)$/)
      setForm({
        numero_presupuesto: String(p.numero_presupuesto),
        ot_anio: otMatch ? otMatch[1] : otAnioActual,
        ot_num: otMatch ? String(parseInt(otMatch[2], 10)) : '',
        fecha: p.fecha,
        cliente_id: p.cliente_id,
        tipo_documento: p.tipo_documento,
        monto: String(p.monto),
        itbms: String(p.itbms),
        notas: p.notas || '',
      })
    } else {
      // Auto-numerar presupuesto: max actual + 1
      const { data } = await supabase
        .from('presupuestos')
        .select('numero_presupuesto')
        .order('numero_presupuesto', { ascending: false })
        .limit(1)
      const siguiente = data && data.length > 0 ? (data[0].numero_presupuesto + 1) : 1
      // Auto-consecutivo de orden de trabajo del anio en curso
      const { data: otData } = await supabase
        .from('presupuestos')
        .select('orden_trabajo')
        .like('orden_trabajo', `${otAnioActual}-%`)
      const maxOt = (otData || []).reduce((m, r) => {
        const n = parseInt((r.orden_trabajo || '').split('-')[1] || '0', 10)
        return n > m ? n : m
      }, 0)
      resetForm()
      setForm(f => ({ ...f, numero_presupuesto: String(siguiente), ot_anio: otAnioActual, ot_num: String(maxOt + 1), itbms: '0' }))
    }
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.cliente_id || !form.numero_presupuesto || !form.monto) return
    setSavingForm(true)
    const monto = parseFloat(form.monto) || 0
    const itbms = parseFloat(form.itbms) || 0
    const ordenTrabajo = form.ot_num.trim()
      ? `${form.ot_anio}-${String(parseInt(form.ot_num, 10)).padStart(3, '0')}`
      : null
    const payload = {
      numero_presupuesto: parseInt(form.numero_presupuesto),
      orden_trabajo: ordenTrabajo,
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
      p.numero_presupuesto, p.orden_trabajo || '', p.fecha, p.clientes?.nombre || '', p.tipo_documento,
      p.monto, p.itbms, p.total, p.estado, p.fecha_pago || '', p.fecha_cobro || ''
    ])
    const csv = [
      ['#', 'Orden trabajo', 'Fecha', 'Cliente', 'Tipo', 'Monto', 'ITBMS', 'Total', 'Estado', 'Vence', 'Cobrado'],
      ...rows
    ].map(r => r.map(v => `"${v ?? ''}"`).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `presupuestos_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
  }

  const totalPendiente = filtered.filter(p => p.estado === 'pendiente').reduce((s, p) => s + p.total, 0)
  const totalPagado = filtered.filter(p => p.estado === 'pagada').reduce((s, p) => s + p.total, 0)

  return (
    <AppLayout>
      <Header
        title="Presupuestos"
        subtitle={`${filtered.length} registros · ${filtered.filter(p => p.estado === 'pendiente').length} pendientes`}
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
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <div className="bg-gray-50 rounded-xl p-3">
            <p className="text-[11px] font-semibold uppercase text-gray-500">Presupuestos</p>
            <p className="text-lg font-bold text-gray-900">{filtered.length.toLocaleString('es-PA')}</p>
          </div>
          <div className="bg-yellow-50 rounded-xl p-3">
            <p className="text-[11px] font-semibold uppercase text-gray-500">Pendientes</p>
            <p className="text-lg font-bold text-yellow-700">{filtered.filter(p => p.estado === 'pendiente').length.toLocaleString('es-PA')}</p>
          </div>
          <div className="bg-green-50 rounded-xl p-3">
            <p className="text-[11px] font-semibold uppercase text-gray-500">Pagados</p>
            <p className="text-lg font-bold text-green-600">{filtered.filter(p => p.estado === 'pagada').length.toLocaleString('es-PA')}</p>
          </div>
          <div className="bg-brand-50 rounded-xl p-3">
            <p className="text-[11px] font-semibold uppercase text-gray-500">Monto total</p>
            <p className="text-lg font-bold text-brand-700">{formatCurrency(totalPendiente + totalPagado)}</p>
          </div>
          <div className="bg-orange-50 rounded-xl p-3">
            <p className="text-[11px] font-semibold uppercase text-gray-500">Monto pendiente</p>
            <p className="text-lg font-bold text-orange-600">{formatCurrency(totalPendiente)}</p>
          </div>
          <div className="bg-green-50 rounded-xl p-3">
            <p className="text-[11px] font-semibold uppercase text-gray-500">Monto pagado</p>
            <p className="text-lg font-bold text-green-600">{formatCurrency(totalPagado)}</p>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-sm min-w-[200px]">
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
          <span className="text-xs text-gray-500">Desde</span>
          <input type="date" className="input py-1.5 text-sm w-[150px]" value={fechaDesde}
            onChange={e => setFechaDesde(e.target.value)} />
          <span className="text-xs text-gray-500">Hasta</span>
          <input type="date" className="input py-1.5 text-sm w-[150px]" value={fechaHasta}
            onChange={e => setFechaHasta(e.target.value)} />
          {(fechaDesde || fechaHasta) && (
            <button onClick={() => { setFechaDesde(''); setFechaHasta('') }}
              className="text-gray-400 hover:text-gray-600" title="Limpiar fechas">
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
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="table-header">#Presupuesto</th>
                <th className="table-header">Orden trabajo</th>
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
                <tr><td colSpan={11} className="text-center py-12 text-gray-400">Cargando...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={11} className="text-center py-12 text-gray-400">
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
                    <td className="table-cell font-mono text-gray-700">{p.orden_trabajo || '—'}</td>
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
                      <div className="flex items-center gap-3">
                        <button onClick={() => openDetalle(p)}
                          className="flex items-center gap-1 text-sm text-brand-600 hover:text-brand-800 font-medium"
                          title="Ver detalle">
                          <Eye size={15} /> Ver
                        </button>
                        {p.estado === 'pendiente' && p.total > 0 && (
                          <button onClick={() => openPagoModal(p)}
                            className="flex items-center gap-1.5 text-sm text-green-600 hover:text-green-800 font-medium">
                            <CheckCircle size={15} />Cobrar
                          </button>
                        )}
                        <button onClick={() => openForm(p)}
                          className="text-xs text-gray-400 hover:text-brand-600">Editar</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Cobrar presupuesto (multi-línea, igual a facturas) */}
      {showPagoModal && selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold mb-1">
              {(selected.monto_pagado || 0) > 0 ? 'Registrar abono' : 'Registrar cobro'}
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              Presupuesto #{selected.numero_presupuesto} · {selected.clientes?.nombre}
            </p>

            <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Total presupuesto</span>
                <span className="font-semibold">{formatCurrency(selected.total)}</span>
              </div>
              {(selected.monto_pagado || 0) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Ya cobrado</span>
                  <span className="text-green-600">{formatCurrency(selected.monto_pagado || 0)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-semibold border-t pt-1.5 mt-1.5">
                <span>Saldo pendiente</span>
                <span className="text-orange-600">{formatCurrency(saldoPendiente)}</span>
              </div>
            </div>

            {pagosExistentes.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-medium text-gray-500 uppercase mb-2">Cobros registrados</p>
                <div className="space-y-1.5">
                  {pagosExistentes.map(p => (
                    <div key={p.id} className="flex justify-between text-sm bg-green-50 rounded-lg px-3 py-2">
                      <span className="text-gray-600">{formatDate(p.fecha)} · {p.anticipo_id ? 'Anticipo' : p.banco_cuentas?.nombre}</span>
                      <span className="font-medium text-green-700">{formatCurrency(p.monto)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mb-4">
              <label className="label">Fecha de cobro</label>
              <input type="date" className="input" value={fechaCobro} onChange={e => setFechaCobro(e.target.value)} />
            </div>

            <div className="space-y-3 mb-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-700">Forma de cobro</p>
                <button onClick={addLinea} className="text-xs flex items-center gap-1 text-brand-600 hover:text-brand-800">
                  <Plus size={13} /> Agregar pago
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="label text-xs">Origen</label>
                      <select className="input text-sm" value={linea.origen}
                        onChange={e => updateLinea(idx, 'origen', e.target.value)}>
                        <option value="cuenta">Cuenta bancaria</option>
                        <option value="anticipo" disabled={anticipos.length === 0}>
                          {anticipos.length === 0 ? 'Anticipo (sin saldo)' : 'Anticipo'}
                        </option>
                      </select>
                    </div>
                    <div>
                      {linea.origen === 'cuenta' ? (
                        <>
                          <label className="label text-xs">Cuenta bancaria</label>
                          <select className="input text-sm" value={linea.cuenta_id}
                            onChange={e => updateLinea(idx, 'cuenta_id', e.target.value)}>
                            <option value="">Seleccionar cuenta...</option>
                            {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre} – {c.banco}</option>)}
                          </select>
                        </>
                      ) : (
                        <>
                          <label className="label text-xs">Anticipo</label>
                          <select className="input text-sm" value={linea.anticipo_id}
                            onChange={e => updateLinea(idx, 'anticipo_id', e.target.value)}>
                            <option value="">Seleccionar anticipo...</option>
                            {anticipos.map(a => (
                              <option key={a.id} value={a.id}>
                                {formatDate(a.fecha)} · saldo {formatCurrency(a.saldo)}{a.numero_deposito ? ` · ${a.numero_deposito}` : ''}
                              </option>
                            ))}
                          </select>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="label text-xs">Monto (USD)</label>
                      <input type="number" step="0.01" min="0.01" className="input text-sm" placeholder="0.00"
                        value={linea.monto} onChange={e => updateLinea(idx, 'monto', e.target.value)} />
                    </div>
                    <div>
                      <label className="label text-xs">Referencia</label>
                      <input className="input text-sm" placeholder="Cheque, transferencia..."
                        value={linea.referencia} onChange={e => updateLinea(idx, 'referencia', e.target.value)} />
                    </div>
                  </div>
                </div>
              ))}

              {lineas.length > 1 && (
                <div className="flex justify-between text-sm font-semibold bg-brand-50 rounded-lg px-3 py-2">
                  <span className="text-brand-700">Total este cobro</span>
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
              <button className="btn-secondary flex-1" onClick={() => setShowPagoModal(false)}>Cancelar</button>
              <button className="btn-primary flex-1" onClick={handleRegistrarAbono}
                disabled={saving || lineas.every(l => !l.monto || (l.origen === 'cuenta' ? !l.cuenta_id : !l.anticipo_id))}>
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
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="label">Número</label>
                  <div className="input bg-gray-50 text-gray-500 font-mono flex items-center">
                    #{form.numero_presupuesto || '—'}
                    {!editId && <span className="ml-auto text-xs text-gray-400">Auto</span>}
                  </div>
                </div>
                <div>
                  <label className="label">Orden de trabajo</label>
                  <div className="input flex items-center gap-1 font-mono px-2">
                    <span className="text-gray-500">{form.ot_anio}-</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={3}
                      className="flex-1 min-w-0 bg-transparent outline-none"
                      placeholder="000"
                      value={form.ot_num}
                      onChange={e => setForm(f => ({ ...f, ot_num: e.target.value.replace(/\D/g, '').slice(0, 3) }))}
                    />
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

      {/* Contenedor de impresión del detalle (solo visible al imprimir) */}
      {detalle && (
        <div id="presupuesto-print" className="hidden print:block">
          <PresupuestoDetalle presupuesto={detalle} pagos={detallePagos} fullPage />
        </div>
      )}

      {/* Modal: Detalle de presupuesto */}
      {detalle && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 print:hidden">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="text-lg font-semibold">Detalle de presupuesto #{detalle.numero_presupuesto}</h2>
              <div className="flex items-center gap-3">
                <button onClick={() => window.print()} className="btn-secondary flex items-center gap-2 py-1.5 text-sm">
                  <Printer size={15} /> Imprimir
                </button>
                <button onClick={() => setDetalle(null)} className="text-gray-400 hover:text-gray-600">
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="p-5">
              {loadingDetalle ? (
                <p className="text-sm text-gray-400 py-8 text-center">Cargando...</p>
              ) : (
                <PresupuestoDetalle presupuesto={detalle} pagos={detallePagos} />
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #presupuesto-print, #presupuesto-print * { visibility: visible !important; }
          #presupuesto-print {
            display: block !important;
            position: absolute;
            left: 0; top: 0;
            width: 100%;
            min-height: 100vh;
          }
          @page { margin: 14mm; }
        }
      `}</style>
    </AppLayout>
  )
}

function PrCampo({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <p className="text-gray-400 text-xs">{label}</p>
      <p className="font-medium text-gray-800">{valor}</p>
    </div>
  )
}

function PrFila({ label, valor, bold = false, className = '' }: { label: string; valor: string; bold?: boolean; className?: string }) {
  return (
    <div className="flex justify-between px-4 py-2.5">
      <span className="text-gray-500">{label}</span>
      <span className={`${bold ? 'font-bold' : 'font-medium'} ${className}`}>{valor}</span>
    </div>
  )
}

function PresupuestoDetalle({
  presupuesto, pagos, fullPage = false,
}: { presupuesto: Presupuesto; pagos: any[]; fullPage?: boolean }) {
  const exact = { WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } as CSSProperties
  const montoPagado = presupuesto.monto_pagado || 0
  const saldo = presupuesto.total - montoPagado

  return (
    <div className={`font-sans text-gray-900 ${fullPage ? 'w-full' : ''}`}>
      <div className={`overflow-hidden ${fullPage ? 'border-2 border-gray-200 rounded-2xl' : ''}`}>
        {/* Encabezado */}
        <div
          className={`flex items-center text-white ${fullPage ? 'gap-6 px-10 py-8' : 'gap-4 px-6 py-5 rounded-xl'}`}
          style={{ ...exact, background: 'linear-gradient(135deg, #0f766e 0%, #115e59 100%)' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.jpeg" alt="Logo" className={`rounded-xl bg-white object-contain p-1 shrink-0 ${fullPage ? 'w-24 h-24' : 'w-14 h-14'}`} style={exact} />
          <div className="flex-1 min-w-0">
            <h1 className={`font-bold leading-tight ${fullPage ? 'text-2xl' : 'text-base'}`}>IMPRESOS COMERCIALES S.A.</h1>
            <p className={`text-white/80 ${fullPage ? 'text-sm' : 'text-xs'}`}>RUC 1635517-1-672731 DV 0 · Tel. 6931-8390</p>
          </div>
          <div className="text-right shrink-0">
            <p className={`uppercase tracking-widest text-white/70 ${fullPage ? 'text-xs' : 'text-[10px]'}`}>Presupuesto</p>
            <p className={`font-bold ${fullPage ? 'text-2xl' : 'text-lg'}`}>#{presupuesto.numero_presupuesto}</p>
            {presupuesto.orden_trabajo && (
              <p className={`text-white/80 font-mono ${fullPage ? 'text-sm' : 'text-xs'}`}>OT {presupuesto.orden_trabajo}</p>
            )}
          </div>
        </div>

        <div className={fullPage ? 'p-10' : 'pt-5'}>
          {/* Datos */}
          <div className={`grid grid-cols-2 gap-x-6 gap-y-3 mb-6 ${fullPage ? 'text-base' : 'text-sm'}`}>
            <PrCampo label="Cliente" valor={presupuesto.clientes?.nombre || '—'} />
            <PrCampo label="Estado" valor={presupuesto.estado === 'pagada' ? 'Pagada' : 'Pendiente'} />
            <PrCampo label="Fecha" valor={formatDate(presupuesto.fecha)} />
            <PrCampo label="Vencimiento" valor={formatDate(presupuesto.fecha_pago)} />
            <PrCampo label="Tipo de documento" valor={presupuesto.tipo_documento} />
            {presupuesto.estado === 'pagada' && <PrCampo label="Fecha de cobro" valor={formatDate(presupuesto.fecha_cobro)} />}
          </div>

          {/* Montos */}
          <div className="rounded-xl bg-gray-50 border border-gray-100 divide-y divide-gray-100 mb-6" style={exact}>
            <PrFila label="Monto" valor={formatCurrency(presupuesto.monto)} />
            <PrFila label="ITBMS" valor={formatCurrency(presupuesto.itbms)} />
            <PrFila label="Total" valor={formatCurrency(presupuesto.total)} bold />
            <PrFila label="Pagado" valor={formatCurrency(montoPagado)} className="text-green-700" />
            <PrFila label="Saldo pendiente" valor={formatCurrency(saldo)} bold className={saldo > 0 ? 'text-orange-600' : 'text-green-700'} />
          </div>

          {/* Pagos / anticipos */}
          <p className={`font-semibold text-gray-700 mb-2 ${fullPage ? 'text-base' : 'text-sm'}`}>Pagos y anticipos aplicados</p>
          {pagos.length === 0 ? (
            <p className="text-sm text-gray-400 py-3">Sin pagos registrados.</p>
          ) : (
            <table className="w-full text-sm border border-gray-100 rounded-xl overflow-hidden" style={exact}>
              <thead>
                <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Origen</th>
                  <th className="px-3 py-2">Banco / Cuenta</th>
                  <th className="px-3 py-2">Referencia</th>
                  <th className="px-3 py-2 text-right">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pagos.map(p => (
                  <tr key={p.id}>
                    <td className="px-3 py-2">{formatDate(p.fecha)}</td>
                    <td className="px-3 py-2">{p.anticipo_id ? 'Anticipo' : 'Cobro'}</td>
                    <td className="px-3 py-2">
                      {p.anticipo_id
                        ? `Anticipo${p.anticipos?.numero_deposito ? ' · ' + p.anticipos.numero_deposito : ''}`
                        : `${p.banco_cuentas?.nombre || '—'}${p.banco_cuentas?.banco ? ' · ' + p.banco_cuentas.banco : ''}${p.banco_cuentas?.numero_cuenta ? ' · ' + p.banco_cuentas.numero_cuenta : ''}`}
                    </td>
                    <td className="px-3 py-2">{p.referencia || '—'}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatCurrency(p.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className={`text-center text-gray-400 border-t border-gray-100 pt-3 mt-6 ${fullPage ? 'text-xs' : 'text-[10px]'}`}>
            <p>Documento interno de control · No constituye una factura fiscal.</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default withPagePermission(PresupuestosPage, 'presupuestos', 'ver')
