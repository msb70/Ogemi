'use client'

import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { createClient } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Compra, Proveedor, BancoCuenta } from '@/types'
import {
  Plus, Search, X, Download, Filter,
  TrendingDown, Clock, CheckCircle, ShoppingCart, Pencil
} from 'lucide-react'

type Tab = 'listado' | 'vencidas'
type EstadoFilter = 'todos' | 'pendiente' | 'pagada'

const TRAMO_COLORS: Record<string, string> = {
  'corriente': '#22c55e', '1-30': '#facc15',
  '31-60': '#fb923c', '61-90': '#f87171', '+120': '#b91c1c',
}
const TRAMO_LABELS: Record<string, string> = {
  'corriente': 'Al día', '1-30': '1–30 días',
  '31-60': '31–60 días', '61-90': '61–90 días', '+120': '+120 días',
}

export default function ComprasPage() {
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
    if (editId) {
      await supabase.from('compras').update(payload).eq('id', editId)
    } else {
      await supabase.from('compras').insert(payload)
    }
    setSaving(false)
    setShowForm(false)
    resetForm()
    load()
  }

  const handlePagar = async (c: Compra, cuentaId: string) => {
    await supabase.from('compras').update({
      estado: 'pagada',
      banco_cuenta_id: cuentaId,
      fecha_pago: new Date().toISOString().split('T')[0],
    }).eq('id', c.id)
    load()
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
      <Header
        title="Compras"
        subtitle={`${countPendiente} compras pendientes · ${formatCurrency(totalPendiente)}`}
        actions={
          <div className="flex items-center gap-2">
            <button className="btn-secondary flex items-center gap-2" onClick={exportCSV}>
              <Download size={16} />Exportar
            </button>
            <button className="btn-primary flex items-center gap-2" onClick={() => handleOpenForm()}>
              <Plus size={16} />Nueva compra
            </button>
          </div>
        }
      />

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 px-6">
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

      <div className="flex-1 overflow-auto p-6">

        {/* TAB: LISTADO */}
        {tab === 'listado' && (
          <div className="space-y-4">
            {/* KPIs */}
            <div className="grid grid-cols-3 gap-4">
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

            {/* Tabla */}
            <div className="card overflow-hidden">
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
                            {c.estado === 'pendiente' && cuentas.length > 0 && (
                              <select
                                className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-brand-600 hover:border-brand-400 cursor-pointer"
                                defaultValue=""
                                onChange={e => { if (e.target.value) handlePagar(c, e.target.value) }}
                              >
                                <option value="" disabled>Pagar con...</option>
                                {cuentas.map(ct => (
                                  <option key={ct.id} value={ct.id}>{ct.nombre} – {ct.banco}</option>
                                ))}
                              </select>
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
            <div className="grid grid-cols-5 gap-3">
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

            {/* Tabla */}
            <div className="card overflow-hidden">
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

      {/* Modal nueva/editar compra */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold mb-5">{editId ? 'Editar compra' : 'Nueva compra'}</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
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
              <div className="grid grid-cols-2 gap-3">
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
                <div className="grid grid-cols-2 gap-3 border-t pt-3">
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
    </AppLayout>
  )
}
