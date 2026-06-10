'use client'

import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { createClient } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Compra, Proveedor, BancoCuenta } from '@/types'
import {
  Plus, Search, X, Download, Filter,
  TrendingDown, Clock, CheckCircle, ShoppingCart, Pencil, Trash2,
  QrCode, Loader2, AlertCircle, Link
} from 'lucide-react'
import { Toast } from '@/components/Toast'
import { useToast } from '@/hooks/useToast'
import QrScanner from '@/components/QrScanner'
import { withPagePermission } from '@/components/PermissionGuard'

type Tab = 'listado' | 'vencidas'
type EstadoFilter = 'todos' | 'pendiente' | 'pagada'

interface LineaPago {
  cuenta_id: string
  monto: string
  referencia: string
}

const TRAMO_COLORS: Record<string, string> = {
  'corriente': '#22c55e', '1-30': '#facc15',
  '31-60': '#fb923c', '61-90': '#f87171', '91-120': '#ef4444', '+120': '#b91c1c',
}
const TRAMO_LABELS: Record<string, string> = {
  'corriente': 'Al día', '1-30': '1–30 días',
  '31-60': '31–60 días', '61-90': '61–90 días', '91-120': '91–120 días', '+120': '+120 días',
}

function ComprasPage() {
  const [tab, setTab] = useState<Tab>('listado')
  const [compras, setCompras] = useState<Compra[]>([])
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [cuentas, setCuentas] = useState<BancoCuenta[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [estadoFilter, setEstadoFilter] = useState<EstadoFilter>('todos')
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Vencidas
  const [vencidas, setVencidas] = useState<any[]>([])

  // Modal de abonos
  const [selectedCompra, setSelectedCompra] = useState<Compra | null>(null)
  const [showPagoModal, setShowPagoModal] = useState(false)
  const [fechaPago, setFechaPago] = useState('')
  const [lineas, setLineas] = useState<LineaPago[]>([{ cuenta_id: '', monto: '', referencia: '' }])
  const [savingPago, setSavingPago] = useState(false)
  const [pagosExistentes, setPagosExistentes] = useState<any[]>([])

  // QR Scanner
  const [showQrModal, setShowQrModal] = useState(false)
  const [qrUrl, setQrUrl] = useState('')
  const [qrLoading, setQrLoading] = useState(false)
  const [qrError, setQrError] = useState('')
  const [qrMode, setQrMode] = useState<'camera' | 'manual'>('camera')
  const [scannerActive, setScannerActive] = useState(false)

  const [form, setForm] = useState({
    proveedor_id: '',
    fecha: new Date().toISOString().split('T')[0],
    concepto: '',
    referencia: '',
    monto: '',
    itbms: '',
    estado: 'pendiente',
    banco_cuenta_id: '',
    fecha_pago: new Date().toISOString().split('T')[0],
    notas: '',
  })

  const supabase = createClient()
  const { toast, showToast, hideToast } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: comprasData }, { data: provData }, { data: cuentasData }] = await Promise.all([
      supabase.from('compras').select('*, proveedores(nombre), banco_cuentas(nombre, banco)').order('fecha', { ascending: false }),
      supabase.from('proveedores').select('*').eq('activo', true).order('nombre'),
      supabase.from('banco_cuentas').select('*').eq('activo', true).order('nombre'),
    ])
    setCompras(comprasData || [])
    setProveedores(provData || [])
    setCuentas(cuentasData || [])
    setLoading(false)
  }, [])

  const loadVencidas = useCallback(async () => {
    const { data } = await supabase.from('compras_vencidas').select('*').order('dias_vencida', { ascending: false })
    setVencidas(data || [])
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (tab === 'vencidas') loadVencidas() }, [tab, loadVencidas])

  const resetForm = () => {
    setForm({
      proveedor_id: '', fecha: new Date().toISOString().split('T')[0],
      concepto: '', referencia: '', monto: '', itbms: '',
      estado: 'pendiente', banco_cuenta_id: '',
      fecha_pago: new Date().toISOString().split('T')[0], notas: '',
    })
    setEditId(null)
  }

  const handleOpenForm = (c?: Compra) => {
    if (c) {
      setEditId(c.id)
      setForm({
        proveedor_id: c.proveedor_id,
        fecha: c.fecha,
        concepto: c.concepto || '',
        referencia: c.referencia || '',
        monto: String(c.monto),
        itbms: String(c.itbms),
        estado: c.estado,
        banco_cuenta_id: c.banco_cuenta_id || '',
        fecha_pago: c.fecha_pago || new Date().toISOString().split('T')[0],
        notas: c.notas || '',
      })
    } else {
      resetForm()
    }
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.proveedor_id || !form.monto) return
    setSaving(true)
    const payload: any = {
      proveedor_id: form.proveedor_id,
      fecha: form.fecha,
      concepto: form.concepto || null,
      referencia: form.referencia || null,
      monto: parseFloat(form.monto) || 0,
      itbms: parseFloat(form.itbms) || 0,
      estado: form.estado,
      banco_cuenta_id: form.estado === 'pagada' && form.banco_cuenta_id ? form.banco_cuenta_id : null,
      fecha_pago: form.estado === 'pagada' ? form.fecha_pago : null,
      notas: form.notas || null,
    }
    let error
    if (editId) {
      ;({ error } = await supabase.from('compras').update(payload).eq('id', editId))
    } else {
      ;({ error } = await supabase.from('compras').insert(payload))
    }
    setSaving(false)
    if (error) {
      showToast(`Error al guardar: ${error.message}`, 'error')
    } else {
      setShowForm(false)
      resetForm()
      showToast(editId ? 'Compra actualizada' : 'Compra registrada', 'success')
      load()
    }
  }

  const handlePagar = async (c: Compra, cuentaId: string) => {
    const { error } = await supabase.from('compras').update({
      estado: 'pagada',
      banco_cuenta_id: cuentaId,
      fecha_pago: new Date().toISOString().split('T')[0],
    }).eq('id', c.id)
    if (error) {
      showToast(`Error al registrar pago: ${error.message}`, 'error')
    } else {
      showToast('Compra marcada como pagada', 'success')
      load()
    }
  }

  const openPagarModal = async (c: Compra) => {
    setSelectedCompra(c)
    setFechaPago(new Date().toISOString().split('T')[0])
    setLineas([{ cuenta_id: cuentas[0]?.id || '', monto: '', referencia: '' }])
    setShowPagoModal(true)
    const { data } = await supabase
      .from('pagos')
      .select('*, banco_cuentas(nombre, banco)')
      .eq('compra_id', c.id)
      .order('fecha', { ascending: false })
    setPagosExistentes(data || [])
  }

  const addLinea = () => setLineas(p => [...p, { cuenta_id: cuentas[0]?.id || '', monto: '', referencia: '' }])
  const removeLinea = (idx: number) => setLineas(p => p.filter((_, i) => i !== idx))
  const updateLinea = (idx: number, field: keyof LineaPago, value: string) =>
    setLineas(p => p.map((l, i) => i === idx ? { ...l, [field]: value } : l))

  const handleRegistrarAbono = async () => {
    if (!selectedCompra) return
    const validas = lineas.filter(l => l.cuenta_id && parseFloat(l.monto) > 0)
    if (validas.length === 0) return
    setSavingPago(true)
    const { error } = await supabase.from('pagos').insert(
      validas.map(l => ({
        compra_id: selectedCompra.id,
        cuenta_id: l.cuenta_id,
        monto: parseFloat(l.monto),
        fecha: fechaPago,
        referencia: l.referencia || null,
      }))
    )
    setSavingPago(false)
    if (error) {
      showToast(`Error al registrar abono: ${error.message}`, 'error')
    } else {
      setShowPagoModal(false)
      showToast('Abono registrado correctamente', 'success')
      load()
    }
  }

  const handleQrScan = async (detectedUrl?: string) => {
    const urlToUse = detectedUrl || qrUrl.trim()
    if (!urlToUse) return
    setScannerActive(false)
    setQrLoading(true)
    setQrError('')
    try {
      const res = await fetch('/api/dgi-qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlToUse }),
      })
      const data = await res.json()
      if (!res.ok) {
        setQrError(data.error || 'Error al consultar el DGI')
        return
      }

      // Buscar o crear proveedor por nombre
      let proveedorId = ''
      const nombreNorm = data.emisor_nombre.trim().toUpperCase()
      const existente = proveedores.find(
        p => p.nombre.toUpperCase() === nombreNorm
      )
      if (existente) {
        proveedorId = existente.id
      } else {
        // Crear proveedor automáticamente
        const { data: nuevo, error } = await supabase
          .from('proveedores')
          .insert({ nombre: data.emisor_nombre.trim(), dias_credito: 30, activo: true })
          .select()
          .single()
        if (error || !nuevo) {
          setQrError('Error al crear el proveedor: ' + (error?.message || ''))
          return
        }
        proveedorId = nuevo.id
        await load() // recargar lista de proveedores
      }

      // Pre-llenar el formulario
      setForm(f => ({
        ...f,
        proveedor_id: proveedorId,
        fecha: data.fecha || f.fecha,
        referencia: data.numero_factura ? `FAC-${data.numero_factura}` : f.referencia,
        monto: String(data.monto),
        itbms: String(data.itbms),
        concepto: `Factura ${data.numero_factura} - ${data.emisor_nombre}`,
      }))

      setShowQrModal(false)
      setQrUrl('')
      setShowForm(true)
    } catch (e: any) {
      setQrError(e.message || 'Error inesperado')
    } finally {
      setQrLoading(false)
    }
  }

  const exportCSV = () => {
    const rows = filtered.map(c => [
      c.fecha, (c.proveedores as any)?.nombre || '', c.concepto || '',
      c.monto, c.itbms, c.total, c.estado, c.vencimiento || ''
    ])
    const csv = [
      ['Fecha', 'Proveedor', 'Concepto', 'Monto', 'ITBMS', 'Total', 'Estado', 'Vencimiento'],
      ...rows
    ].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `compras_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
  }

  const filtered = compras.filter(c => {
    const prov = (c.proveedores as any)?.nombre || ''
    const matchSearch = !search || prov.toLowerCase().includes(search.toLowerCase()) ||
      (c.concepto || '').toLowerCase().includes(search.toLowerCase())
    const matchEstado = estadoFilter === 'todos' || c.estado === estadoFilter
    return matchSearch && matchEstado
  })

  const totalPendiente = compras.filter(c => c.estado === 'pendiente').reduce((s, c) => s + c.total, 0)
  const totalPagado = compras.filter(c => c.estado === 'pagada').reduce((s, c) => s + c.total, 0)
  const countPendiente = compras.filter(c => c.estado === 'pendiente').length

  const totalVencidas = vencidas.reduce((s: number, c: any) => s + (c.total || 0), 0)

  const resumenTramos = ['corriente', '1-30', '31-60', '61-90', '+120'].map(tramo => ({
    tramo,
    label: TRAMO_LABELS[tramo],
    cantidad: vencidas.filter((c: any) => c.tramo === tramo).length,
    monto: vencidas.filter((c: any) => c.tramo === tramo).reduce((s: number, c: any) => s + c.total, 0),
  }))

  return (
    <AppLayout>
      {toast && <Toast {...toast} onClose={hideToast} />}
      <Header
        title="Compras"
        subtitle={`${countPendiente} compras pendientes · ${formatCurrency(totalPendiente)}`}
        actions={
          <div className="flex items-center gap-2">
            <button className="btn-secondary flex items-center gap-2" onClick={exportCSV}>
              <Download size={16} />Exportar
            </button>
            <button className="btn-secondary flex items-center gap-2" onClick={() => { setQrUrl(''); setQrError(''); setQrMode('camera'); setScannerActive(true); setShowQrModal(true) }}>
              <QrCode size={16} />Escanear QR
            </button>
            <button className="btn-primary flex items-center gap-2" onClick={() => handleOpenForm()}>
              <Plus size={16} />Nueva compra
            </button>
          </div>
        }
      />

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 px-4 md:px-6 overflow-x-auto">
        <div className="flex gap-1">
          {[{ key: 'listado', label: 'Listado' }, { key: 'vencidas', label: 'Cuentas por pagar' }].map(t => (
            <button key={t.key} onClick={() => setTab(t.key as Tab)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6">

        {/* TAB: LISTADO */}
        {tab === 'listado' && (
          <div className="space-y-4">
            {/* KPIs */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="card p-4">
                <p className="text-xs text-gray-500 mb-1">Pendiente de pago</p>
                <p className="text-xl font-bold text-orange-600">{formatCurrency(totalPendiente)}</p>
                <p className="text-xs text-gray-400">{countPendiente} compras</p>
              </div>
              <div className="card p-4">
                <p className="text-xs text-gray-500 mb-1">Pagado total</p>
                <p className="text-xl font-bold text-green-600">{formatCurrency(totalPagado)}</p>
                <p className="text-xs text-gray-400">{compras.filter(c => c.estado === 'pagada').length} compras</p>
              </div>
              <div className="card p-4">
                <p className="text-xs text-gray-500 mb-1">Total registrado</p>
                <p className="text-xl font-bold text-brand-700">{formatCurrency(totalPendiente + totalPagado)}</p>
                <p className="text-xs text-gray-400">{compras.length} compras</p>
              </div>
            </div>

            {/* Filtros */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input className="input pl-8 text-sm" placeholder="Buscar proveedor o concepto..." value={search}
                  onChange={e => setSearch(e.target.value)} />
              </div>
              <select className="input text-sm max-w-[160px]" value={estadoFilter}
                onChange={e => setEstadoFilter(e.target.value as EstadoFilter)}>
                <option value="todos">Todos los estados</option>
                <option value="pendiente">Pendientes</option>
                <option value="pagada">Pagadas</option>
              </select>
              {(search || estadoFilter !== 'todos') && (
                <button className="text-sm text-brand-600 hover:text-brand-800"
                  onClick={() => { setSearch(''); setEstadoFilter('todos') }}>
                  Limpiar
                </button>
              )}
            </div>

            {/* Tarjetas (solo móvil) */}
            <div className="md:hidden space-y-3">
              {loading ? (
                <div className="card p-6 text-center text-gray-400">Cargando...</div>
              ) : filtered.length === 0 ? (
                <div className="card p-6 text-center text-gray-400">
                  <ShoppingCart size={32} className="mx-auto mb-2 opacity-30" />
                  Sin compras registradas
                </div>
              ) : filtered.map(c => {
                const hoy = new Date().toISOString().split('T')[0]
                const vencida = c.vencimiento && c.estado === 'pendiente' && c.vencimiento < hoy
                return (
                  <div key={c.id} className={`card p-4 ${vencida ? 'border-red-200 bg-red-50/30' : ''}`}>
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="font-medium text-sm flex-1 min-w-0 truncate">{(c.proveedores as any)?.nombre || '—'}</p>
                      <span className={`badge flex items-center gap-1 flex-shrink-0 ${
                        c.estado === 'pagada' ? 'bg-green-100 text-green-700' : vencida ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
                      }`}>
                        {c.estado === 'pagada' ? <CheckCircle size={11} /> : <Clock size={11} />}
                        {c.estado === 'pagada' ? 'Pagada' : vencida ? 'Vencida' : 'Pendiente'}
                      </span>
                    </div>
                    {c.concepto && <p className="text-xs text-gray-500 mb-2 line-clamp-2">{c.concepto}</p>}
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
                      <span>Fecha: {formatDate(c.fecha)}</span>
                      {c.vencimiento && (
                        <span className={vencida ? 'text-red-600 font-medium' : ''}>
                          Vence: {formatDate(c.vencimiento)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-end justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-lg font-bold text-gray-900">{formatCurrency(c.total)}</p>
                        <p className="text-[11px] text-gray-400">
                          Monto {formatCurrency(c.monto)} · ITBMS {formatCurrency(c.itbms)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button onClick={() => handleOpenForm(c)}
                          className="p-2 rounded-lg text-gray-500 border border-gray-200 hover:text-brand-600 hover:bg-brand-50"
                          aria-label="Editar">
                          <Pencil size={15} />
                        </button>
                        {c.estado === 'pendiente' && (
                          <button
                            onClick={() => openPagarModal(c)}
                            className="flex items-center gap-1 text-sm text-green-700 font-medium border border-green-300 bg-green-50 rounded-lg px-3 py-2"
                          >
                            <CheckCircle size={14} />
                            {(c.monto_pagado || 0) > 0 ? 'Abonar' : 'Pagar'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Tabla (solo escritorio) */}
            <div className="card overflow-hidden hidden md:block">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="table-header">Fecha</th>
                    <th className="table-header">Proveedor</th>
                    <th className="table-header">Concepto</th>
                    <th className="table-header">Vencimiento</th>
                    <th className="table-header text-right">Monto</th>
                    <th className="table-header text-right">ITBMS</th>
                    <th className="table-header text-right">Total</th>
                    <th className="table-header">Estado</th>
                    <th className="table-header text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading ? (
                    <tr><td colSpan={9} className="text-center py-10 text-gray-400">Cargando...</td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={9} className="text-center py-10 text-gray-400">
                      <ShoppingCart size={32} className="mx-auto mb-2 opacity-30" />
                      Sin compras registradas
                    </td></tr>
                  ) : filtered.map(c => {
                    const hoy = new Date().toISOString().split('T')[0]
                    const vencida = c.vencimiento && c.estado === 'pendiente' && c.vencimiento < hoy
                    return (
                      <tr key={c.id} className={`hover:bg-gray-50 ${vencida ? 'bg-red-50/30' : ''}`}>
                        <td className="table-cell text-gray-500 text-sm">{formatDate(c.fecha)}</td>
                        <td className="table-cell font-medium">{(c.proveedores as any)?.nombre || '—'}</td>
                        <td className="table-cell text-gray-500 max-w-[160px]">
                          <span className="truncate block" title={c.concepto || ''}>{c.concepto || '—'}</span>
                        </td>
                        <td className="table-cell text-sm">
                          {c.vencimiento ? (
                            <span className={vencida ? 'text-red-600 font-medium' : 'text-gray-500'}>
                              {formatDate(c.vencimiento)}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="table-cell text-right">{formatCurrency(c.monto)}</td>
                        <td className="table-cell text-right text-gray-500">{formatCurrency(c.itbms)}</td>
                        <td className="table-cell text-right font-semibold">{formatCurrency(c.total)}</td>
                        <td className="table-cell">
                          <span className={`badge flex items-center gap-1 w-fit ${
                            c.estado === 'pagada' ? 'bg-green-100 text-green-700' : vencida ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
                          }`}>
                            {c.estado === 'pagada' ? <CheckCircle size={11} /> : <Clock size={11} />}
                            {c.estado === 'pagada' ? 'Pagada' : vencida ? 'Vencida' : 'Pendiente'}
                          </span>
                        </td>
                        <td className="table-cell text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => handleOpenForm(c)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50"
                              title="Editar">
                              <Pencil size={14} />
                            </button>
                            {c.estado === 'pendiente' && (
                              <button
                                onClick={() => openPagarModal(c)}
                                className="flex items-center gap-1 text-xs text-green-600 hover:text-green-800 font-medium border border-green-200 rounded-lg px-2 py-1"
                              >
                                <CheckCircle size={12} />
                                {(c.monto_pagado || 0) > 0 ? 'Abonar' : 'Pagar'}
                              </button>
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
        )}

        {/* TAB: CUENTAS POR PAGAR */}
        {tab === 'vencidas' && (
          <div className="space-y-5">
            {/* Tramos */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
              {resumenTramos.map(t => (
                <div key={t.tramo} className="card p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-3 h-3 rounded-full" style={{ background: TRAMO_COLORS[t.tramo] }} />
                    <span className="text-xs font-medium text-gray-600">{t.label}</span>
                  </div>
                  <p className="text-lg font-bold text-gray-900">{formatCurrency(t.monto)}</p>
                  <p className="text-xs text-gray-400">{t.cantidad} compras</p>
                </div>
              ))}
            </div>

            {/* Total */}
            <div className="card p-4 bg-orange-50 border-orange-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingDown size={18} className="text-orange-600" />
                  <span className="text-sm font-medium text-orange-700">Total cuentas por pagar pendientes</span>
                </div>
                <span className="text-2xl font-bold text-orange-800">{formatCurrency(totalVencidas)}</span>
              </div>
            </div>

            {/* Tarjetas (solo móvil) */}
            <div className="md:hidden space-y-3">
              {vencidas.length === 0 ? (
                <div className="card p-6 text-center text-gray-400">Sin cuentas pendientes</div>
              ) : vencidas.map((c: any) => (
                <div key={c.id} className="card p-4">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="font-medium text-sm flex-1 min-w-0 truncate">{c.proveedor}</p>
                    <span className="badge text-xs flex-shrink-0" style={{
                      backgroundColor: TRAMO_COLORS[c.tramo] + '20',
                      color: TRAMO_COLORS[c.tramo],
                    }}>
                      {TRAMO_LABELS[c.tramo]}
                    </span>
                  </div>
                  {c.concepto && <p className="text-xs text-gray-500 mb-2 line-clamp-2">{c.concepto}</p>}
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                    <span>Vence: {formatDate(c.vencimiento)}</span>
                    <span className={c.dias_vencida > 0 ? 'text-red-600 font-medium' : 'text-green-600'}>
                      {c.dias_vencida > 0 ? `${c.dias_vencida} días vencida` : 'Al día'}
                    </span>
                  </div>
                  <p className="text-lg font-bold text-gray-900">{formatCurrency(c.total)}</p>
                </div>
              ))}
            </div>

            {/* Tabla (solo escritorio) */}
            <div className="card overflow-hidden hidden md:block">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="table-header">Fecha</th>
                    <th className="table-header">Proveedor</th>
                    <th className="table-header">Concepto</th>
                    <th className="table-header">Vencimiento</th>
                    <th className="table-header text-right">Días</th>
                    <th className="table-header text-right">Total</th>
                    <th className="table-header">Tramo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {vencidas.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-10 text-gray-400">Sin cuentas pendientes</td></tr>
                  ) : vencidas.map((c: any) => (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="table-cell text-gray-500 text-sm">{formatDate(c.fecha)}</td>
                      <td className="table-cell font-medium">{c.proveedor}</td>
                      <td className="table-cell text-gray-500">{c.concepto || '—'}</td>
                      <td className="table-cell text-gray-500 text-sm">{formatDate(c.vencimiento)}</td>
                      <td className="table-cell text-right">
                        <span className={c.dias_vencida > 0 ? 'text-red-600 font-medium' : 'text-green-600'}>
                          {c.dias_vencida > 0 ? `+${c.dias_vencida}` : c.dias_vencida}
                        </span>
                      </td>
                      <td className="table-cell text-right font-semibold">{formatCurrency(c.total)}</td>
                      <td className="table-cell">
                        <span className="badge text-xs" style={{
                          backgroundColor: TRAMO_COLORS[c.tramo] + '20',
                          color: TRAMO_COLORS[c.tramo],
                        }}>
                          {TRAMO_LABELS[c.tramo]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Modal: Registrar Abono/Pago en Compra */}
      {showPagoModal && selectedCompra && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold mb-1">Registrar pago</h2>
            <p className="text-sm text-gray-500 mb-4">
              {(selectedCompra.proveedores as any)?.nombre} · {selectedCompra.concepto || 'Compra'}
            </p>

            <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Total compra</span>
                <span className="font-semibold">{formatCurrency(selectedCompra.total)}</span>
              </div>
              {(selectedCompra.monto_pagado || 0) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Ya pagado</span>
                  <span className="text-green-600">{formatCurrency(selectedCompra.monto_pagado || 0)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-semibold border-t pt-1.5 mt-1.5">
                <span>Saldo pendiente</span>
                <span className="text-orange-600">
                  {formatCurrency(selectedCompra.total - (selectedCompra.monto_pagado || 0))}
                </span>
              </div>
            </div>

            {pagosExistentes.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-medium text-gray-500 uppercase mb-2">Pagos anteriores</p>
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

            <div className="mb-4">
              <label className="label">Fecha de pago</label>
              <input type="date" className="input" value={fechaPago}
                onChange={e => setFechaPago(e.target.value)} />
            </div>

            <div className="space-y-3 mb-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-700">Forma de pago</p>
                <button onClick={addLinea} className="text-xs flex items-center gap-1 text-brand-600">
                  <Plus size={13} /> Agregar cuenta
                </button>
              </div>
              {lineas.map((linea, idx) => (
                <div key={idx} className="border border-gray-200 rounded-xl p-3 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-xs text-gray-500">Pago {idx + 1}</span>
                    {lineas.length > 1 && (
                      <button onClick={() => removeLinea(idx)} className="text-red-400">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                  <div>
                    <label className="label text-xs">Cuenta</label>
                    <select className="input text-sm" value={linea.cuenta_id}
                      onChange={e => updateLinea(idx, 'cuenta_id', e.target.value)}>
                      <option value="">Seleccionar...</option>
                      {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre} – {c.banco}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="label text-xs">Monto (USD)</label>
                      <input type="number" step="0.01" className="input text-sm" placeholder="0.00"
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
            </div>

            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => setShowPagoModal(false)}>Cancelar</button>
              <button className="btn-primary flex-1" onClick={handleRegistrarAbono}
                disabled={savingPago || lineas.every(l => !l.cuenta_id || !l.monto)}>
                {savingPago ? 'Guardando...' : 'Registrar pago'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal nueva/editar compra */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold mb-5">{editId ? 'Editar compra' : 'Nueva compra'}</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">Proveedor *</label>
                  <select className="input" value={form.proveedor_id}
                    onChange={e => setForm(f => ({ ...f, proveedor_id: e.target.value }))}>
                    <option value="">Seleccionar...</option>
                    {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Fecha *</label>
                  <input type="date" className="input" value={form.fecha}
                    onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="label">Concepto / Descripción</label>
                <input className="input" placeholder="Ej: Materiales de impresión" value={form.concepto}
                  onChange={e => setForm(f => ({ ...f, concepto: e.target.value }))} />
              </div>
              <div>
                <label className="label">Referencia (factura proveedor)</label>
                <input className="input" placeholder="Ej: FAC-0012345" value={form.referencia}
                  onChange={e => setForm(f => ({ ...f, referencia: e.target.value }))} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">Monto sin ITBMS (USD) *</label>
                  <input type="number" step="0.01" className="input" placeholder="0.00" value={form.monto}
                    onChange={e => setForm(f => ({ ...f, monto: e.target.value }))} />
                </div>
                <div>
                  <label className="label">ITBMS (USD)</label>
                  <input type="number" step="0.01" className="input" placeholder="0.00" value={form.itbms}
                    onChange={e => setForm(f => ({ ...f, itbms: e.target.value }))} />
                </div>
              </div>
              {(parseFloat(form.monto) || 0) + (parseFloat(form.itbms) || 0) > 0 && (
                <div className="bg-gray-50 rounded-xl p-3 flex items-center justify-between">
                  <span className="text-sm text-gray-600">Total</span>
                  <span className="text-lg font-bold text-brand-700">
                    {formatCurrency((parseFloat(form.monto) || 0) + (parseFloat(form.itbms) || 0))}
                  </span>
                </div>
              )}
              <div>
                <label className="label">Estado</label>
                <div className="flex gap-2">
                  {['pendiente', 'pagada'].map(s => (
                    <button key={s} onClick={() => setForm(f => ({ ...f, estado: s }))}
                      className={`flex-1 py-2 text-sm rounded-lg border transition-colors ${
                        form.estado === s
                          ? s === 'pagada' ? 'bg-green-600 text-white border-green-600' : 'bg-orange-500 text-white border-orange-500'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}>
                      {s === 'pagada' ? 'Pagada' : 'Pendiente'}
                    </button>
                  ))}
                </div>
              </div>
              {form.estado === 'pagada' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t pt-3">
                  <div>
                    <label className="label">Banco / Cuenta de pago</label>
                    <select className="input" value={form.banco_cuenta_id}
                      onChange={e => setForm(f => ({ ...f, banco_cuenta_id: e.target.value }))}>
                      <option value="">Seleccionar cuenta...</option>
                      {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre} – {c.banco}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Fecha de pago</label>
                    <input type="date" className="input" value={form.fecha_pago}
                      onChange={e => setForm(f => ({ ...f, fecha_pago: e.target.value }))} />
                  </div>
                </div>
              )}
              <div>
                <label className="label">Notas</label>
                <textarea className="input resize-none" rows={2} placeholder="Observaciones..." value={form.notas}
                  onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button className="btn-secondary flex-1" onClick={() => { setShowForm(false); resetForm() }}>Cancelar</button>
              <button className="btn-primary flex-1" onClick={handleSave}
                disabled={saving || !form.proveedor_id || !form.monto}>
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Modal: Escanear QR DGI */}
      {showQrModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <QrCode size={20} className="text-brand-600" />
                <h2 className="text-lg font-semibold">Importar Factura DGI</h2>
              </div>
              <button onClick={() => { setShowQrModal(false); setScannerActive(false) }} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            {/* Tabs cámara / manual */}
            <div className="flex gap-1 mb-4 bg-gray-100 rounded-xl p-1">
              <button
                onClick={() => { setQrMode('camera'); setScannerActive(true) }}
                className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-lg transition-colors ${
                  qrMode === 'camera' ? 'bg-white shadow text-brand-700 font-medium' : 'text-gray-500'
                }`}
              >
                <QrCode size={15} />Cámara
              </button>
              <button
                onClick={() => { setQrMode('manual'); setScannerActive(false) }}
                className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-lg transition-colors ${
                  qrMode === 'manual' ? 'bg-white shadow text-brand-700 font-medium' : 'text-gray-500'
                }`}
              >
                <Link size={15} />Pegar URL
              </button>
            </div>

            {qrLoading ? (
              <div className="flex flex-col items-center justify-center py-10 gap-3 text-gray-500">
                <Loader2 size={32} className="animate-spin text-brand-600" />
                <span className="text-sm">Consultando DGI Panama...</span>
              </div>
            ) : (
              <>
                {/* Modo cámara */}
                {qrMode === 'camera' && (
                  <div className="mb-4">
                    <QrScanner
                      active={scannerActive}
                      onDetected={(url) => handleQrScan(url)}
                    />
                    {!scannerActive && (
                      <button
                        className="btn-primary w-full mt-3 flex items-center justify-center gap-2"
                        onClick={() => setScannerActive(true)}
                      >
                        <QrCode size={16} />Activar cámara
                      </button>
                    )}
                  </div>
                )}

                {/* Modo manual */}
                {qrMode === 'manual' && (
                  <div className="mb-4">
                    <label className="label">URL del QR (dgi-fep.mef.gob.pa)</label>
                    <textarea
                      className="input resize-none text-xs font-mono"
                      rows={4}
                      placeholder="https://dgi-fep.mef.gob.pa/Consultas/FacturasPorQR?chFE=..."
                      value={qrUrl}
                      onChange={e => { setQrUrl(e.target.value); setQrError('') }}
                      autoFocus
                    />
                    <button
                      className="btn-primary w-full mt-3 flex items-center justify-center gap-2"
                      onClick={() => handleQrScan()}
                      disabled={!qrUrl.trim()}
                    >
                      <QrCode size={16} />Importar factura
                    </button>
                  </div>
                )}
              </>
            )}

            {qrError && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 mb-4 text-sm text-red-700">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span>{qrError}</span>
              </div>
            )}

            <button className="btn-secondary w-full" onClick={() => { setShowQrModal(false); setScannerActive(false) }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

    </AppLayout>
  )
}

export default withPagePermission(ComprasPage, 'compras', 'ver')
