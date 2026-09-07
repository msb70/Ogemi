'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { createClient } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Cliente, BancoCuenta, VentaOgemi } from '@/types'
import { Plus, Search, X, Pencil, Trash2, Wallet, RefreshCw, Download } from 'lucide-react'
import { withPagePermission } from '@/components/PermissionGuard'
import { Toast } from '@/components/Toast'
import { useToast } from '@/hooks/useToast'
import { useAuth } from '@/context/AuthContext'
import { exportXLSX, kpiSheet } from '@/lib/exportXlsx'

type Filtro = 'todas' | 'pendiente' | 'pagada'

const hoy = () => new Date().toISOString().split('T')[0]

const emptyForm = () => ({
  cliente_id: '',
  fecha: hoy(),
  concepto: '',
  monto: '',
  itbms_pct: '7',
  dias_credito: '',
  notas: '',
})

function VentasOgemiPage() {
  const supabase = useMemo(() => createClient(), [])
  const { toast, showToast, hideToast } = useToast()
  const { puedeHacer } = useAuth()

  const [ventas, setVentas] = useState<VentaOgemi[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [cuentas, setCuentas] = useState<BancoCuenta[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todas')

  // Alta / edición
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)

  // Cobro
  const [cobrar, setCobrar] = useState<VentaOgemi | null>(null)
  const [cobroForm, setCobroForm] = useState({ cuenta_id: '', fecha: hoy(), monto: '', referencia: '' })
  const [cobrando, setCobrando] = useState(false)

  // Historial de cobros / reverso
  const [historial, setHistorial] = useState<VentaOgemi | null>(null)
  const [pagos, setPagos] = useState<any[]>([])
  const [reversar, setReversar] = useState<any | null>(null)
  const [motivo, setMotivo] = useState('')
  const [reversando, setReversando] = useState(false)

  const [eliminar, setEliminar] = useState<VentaOgemi | null>(null)
  const [eliminando, setEliminando] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: v, error }, { data: c }, { data: b }] = await Promise.all([
      supabase.from('ventas_ogemi').select('*, clientes(nombre, dias_credito)')
        .order('fecha', { ascending: false }).order('numero', { ascending: false }),
      supabase.from('clientes').select('*').eq('activo', true).order('nombre'),
      supabase.from('banco_cuentas').select('*').eq('activo', true).order('orden').order('nombre'),
    ])
    if (error) showToast(`Error al cargar ventas: ${error.message}`, 'error')
    setVentas((v || []) as VentaOgemi[])
    setClientes(c || [])
    // Solo cuentas bancarias (no tarjetas) para recibir cobros
    setCuentas((b || []).filter((x: BancoCuenta) => x.tipo !== 'tarjeta_credito'))
    setLoading(false)
  }, [supabase, showToast])

  useEffect(() => { load() }, [load])

  // ── Formulario ────────────────────────────────────────────────────────────
  const monto = parseFloat(form.monto) || 0
  const pct = parseFloat(form.itbms_pct) || 0
  const itbmsCalc = Math.round(monto * pct) / 100
  const totalCalc = Math.round((monto + itbmsCalc) * 100) / 100
  const clienteSel = clientes.find(c => c.id === form.cliente_id)
  const diasEfectivos = form.dias_credito !== '' ? parseInt(form.dias_credito) : (clienteSel?.dias_credito ?? 30)
  const fechaPagoCalc = (() => {
    if (!form.fecha) return ''
    const d = new Date(form.fecha + 'T00:00:00')
    d.setDate(d.getDate() + (Number.isFinite(diasEfectivos) ? diasEfectivos : 30))
    return d.toISOString().split('T')[0]
  })()

  const abrirNueva = () => { setEditId(null); setForm(emptyForm()); setShowForm(true) }
  const abrirEditar = (v: VentaOgemi) => {
    setEditId(v.id)
    setForm({
      cliente_id: v.cliente_id,
      fecha: v.fecha,
      concepto: v.concepto || '',
      monto: String(v.monto),
      itbms_pct: String(v.itbms_pct),
      dias_credito: String(v.dias_credito),
      notas: v.notas || '',
    })
    setShowForm(true)
  }

  const onClienteChange = (id: string) => {
    const c = clientes.find(x => x.id === id)
    // Los días de crédito se toman del cliente (editables por venta)
    setForm(p => ({ ...p, cliente_id: id, dias_credito: c ? String(c.dias_credito ?? 30) : p.dias_credito }))
  }

  const guardar = async () => {
    if (!form.cliente_id) { showToast('Selecciona el cliente', 'error'); return }
    if (!form.fecha) { showToast('Indica la fecha', 'error'); return }
    if (!(monto > 0)) { showToast('El monto debe ser mayor a cero', 'error'); return }
    setSaving(true)
    const row = {
      cliente_id: form.cliente_id,
      fecha: form.fecha,
      concepto: form.concepto.trim() || null,
      monto,
      itbms_pct: pct,
      dias_credito: Number.isFinite(diasEfectivos) ? diasEfectivos : 30,
      notas: form.notas.trim() || null,
    }
    const { error } = editId
      ? await supabase.from('ventas_ogemi').update(row).eq('id', editId)
      : await supabase.from('ventas_ogemi').insert(row)
    setSaving(false)
    if (error) { showToast(`Error al guardar: ${error.message}`, 'error'); return }
    showToast(editId ? 'Venta actualizada' : 'Venta registrada', 'success')
    setShowForm(false); setEditId(null); setForm(emptyForm())
    load()
  }

  // ── Cobro ─────────────────────────────────────────────────────────────────
  const saldoDe = (v: VentaOgemi) => Math.max(0, (v.total || 0) - (v.monto_pagado || 0))
  const abrirCobro = (v: VentaOgemi) => {
    setCobrar(v)
    setCobroForm({ cuenta_id: cuentas[0]?.id || '', fecha: hoy(), monto: saldoDe(v).toFixed(2), referencia: '' })
  }
  const registrarCobro = async () => {
    if (!cobrar) return
    const m = parseFloat(cobroForm.monto) || 0
    if (!cobroForm.cuenta_id) { showToast('Selecciona la cuenta de banco', 'error'); return }
    if (!(m > 0)) { showToast('El monto debe ser mayor a cero', 'error'); return }
    if (m > saldoDe(cobrar) + 0.005) { showToast('El monto supera el saldo pendiente', 'error'); return }
    setCobrando(true)
    const { error } = await supabase.from('pagos').insert({
      venta_ogemi_id: cobrar.id,
      cuenta_id: cobroForm.cuenta_id,
      fecha: cobroForm.fecha,
      monto: m,
      referencia: cobroForm.referencia.trim() || null,
    })
    setCobrando(false)
    if (error) { showToast(`No se pudo registrar el cobro: ${error.message}`, 'error'); return }
    showToast('Cobro registrado en banco', 'success')
    setCobrar(null)
    load()
  }

  // ── Historial / reverso ───────────────────────────────────────────────────
  const abrirHistorial = async (v: VentaOgemi) => {
    setHistorial(v)
    const { data } = await supabase
      .from('pagos')
      .select('id, fecha, monto, referencia, numero_recibo, cuenta_id, banco_cuentas(nombre, banco), pago_reversos(id, fecha, motivo)')
      .eq('venta_ogemi_id', v.id)
      .order('fecha', { ascending: false })
    setPagos(data || [])
  }
  const confirmarReverso = async () => {
    if (!reversar || motivo.trim().length < 3) return
    setReversando(true)
    const { error } = await supabase.rpc('reversar_pago', { p_pago_id: reversar.id, p_motivo: motivo.trim() })
    setReversando(false)
    if (error) { showToast(`No se pudo reversar: ${error.message}`, 'error'); return }
    showToast('Cobro reversado', 'success')
    setReversar(null); setMotivo('')
    if (historial) abrirHistorial(historial)
    load()
  }

  const confirmarEliminar = async () => {
    if (!eliminar) return
    setEliminando(true)
    const { error } = await supabase.rpc('eliminar_venta_ogemi', { p_id: eliminar.id })
    setEliminando(false)
    if (error) { showToast(`No se pudo borrar: ${error.message}`, 'error'); return }
    showToast('Venta eliminada', 'success')
    setEliminar(null)
    load()
  }

  // ── Listado ───────────────────────────────────────────────────────────────
  const filtradas = ventas.filter(v => {
    if (filtro !== 'todas' && v.estado !== filtro) return false
    if (!search) return true
    const q = search.toLowerCase()
    return (v.clientes?.nombre || '').toLowerCase().includes(q)
      || (v.concepto || '').toLowerCase().includes(q)
      || String(v.numero).includes(q)
  })
  const totPendiente = ventas.filter(v => v.estado === 'pendiente').reduce((s, v) => s + saldoDe(v), 0)
  const totVentas = filtradas.reduce((s, v) => s + (v.total || 0), 0)
  const vencidas = ventas.filter(v => v.estado === 'pendiente' && v.fecha_pago && v.fecha_pago < hoy()).length

  const exportExcel = () => {
    exportXLSX('ventas_ogemi', [
      kpiSheet('Resumen', 'Todas las ventas', [
        ['Ventas listadas (total)', totVentas],
        ['Saldo pendiente', totPendiente],
        ['# vencidas', vencidas],
      ]),
      { name: 'Ventas', rows: [
        ['N°', 'Fecha', 'Cliente', 'Concepto', 'Monto', '% ITBMS', 'ITBMS', 'Total', 'Días crédito', 'Vence', 'Cobrado', 'Saldo', 'Estado'],
        ...filtradas.map(v => [
          v.numero, v.fecha, v.clientes?.nombre || '', v.concepto || '', v.monto, v.itbms_pct, v.itbms, v.total,
          v.dias_credito, v.fecha_pago || '', v.monto_pagado || 0, saldoDe(v), v.estado,
        ]),
      ] },
    ])
  }

  const puedeEditar = puedeHacer('ventas_ogemi', 'editar')
  const puedeBorrar = puedeHacer('ventas_ogemi', 'borrar')

  return (
    <AppLayout>
      <Header
        title="Ventas Impresora OGEMI"
        subtitle="Registro de ventas y cuentas por cobrar de Impresora Ogemi"
        actions={
          <div className="flex items-center gap-2">
            <button className="btn-secondary flex items-center gap-2" onClick={exportExcel}>
              <Download size={16} /> Exportar Excel
            </button>
            {puedeHacer('ventas_ogemi', 'agregar') && (
              <button className="btn-primary flex items-center gap-2" onClick={abrirNueva}>
                <Plus size={16} /> Nueva venta
              </button>
            )}
          </div>
        }
      />

      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-6 flex-wrap text-sm">
        <div><span className="text-xs text-gray-500">Saldo por cobrar: </span><span className="font-semibold text-orange-600">{formatCurrency(totPendiente)}</span></div>
        <div><span className="text-xs text-gray-500">Vencidas: </span><span className="font-semibold text-red-600">{vencidas}</span></div>
        <div><span className="text-xs text-gray-500">Ventas listadas: </span><span className="font-semibold text-gray-700">{formatCurrency(totVentas)}</span></div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {showForm && (
          <div className="card p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="col-span-full text-sm font-semibold text-gray-700">{editId ? 'Editar venta' : 'Nueva venta'}</div>
            <div className="lg:col-span-2">
              <label className="label">Cliente</label>
              <select className="input" value={form.cliente_id} onChange={e => onClienteChange(e.target.value)}>
                <option value="">Seleccionar cliente...</option>
                {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            <div><label className="label">Fecha</label><input type="date" className="input" value={form.fecha} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} /></div>
            <div>
              <label className="label">Días de crédito</label>
              <input type="number" min={0} className="input" value={form.dias_credito} placeholder={String(clienteSel?.dias_credito ?? 30)}
                onChange={e => setForm(p => ({ ...p, dias_credito: e.target.value }))} />
              <p className="text-[11px] text-gray-400 mt-0.5">Vence: {fechaPagoCalc ? formatDate(fechaPagoCalc) : '—'}</p>
            </div>
            <div className="lg:col-span-2"><label className="label">Concepto</label><input className="input" value={form.concepto} onChange={e => setForm(p => ({ ...p, concepto: e.target.value }))} placeholder="Descripción del trabajo" /></div>
            <div><label className="label">Monto (sin ITBMS)</label><input type="number" step="0.01" min={0} className="input" value={form.monto} onChange={e => setForm(p => ({ ...p, monto: e.target.value }))} /></div>
            <div><label className="label">% ITBMS</label><input type="number" step="0.01" min={0} max={100} className="input" value={form.itbms_pct} onChange={e => setForm(p => ({ ...p, itbms_pct: e.target.value }))} /></div>
            <div className="col-span-full flex flex-wrap items-center gap-6 text-sm bg-gray-50 rounded-lg px-4 py-2">
              <span className="text-gray-500">ITBMS: <span className="font-semibold text-gray-800">{formatCurrency(itbmsCalc)}</span></span>
              <span className="text-gray-500">Total: <span className="font-bold text-brand-700 text-base">{formatCurrency(totalCalc)}</span></span>
            </div>
            <div className="col-span-full"><label className="label">Notas</label><input className="input" value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} /></div>
            <div className="col-span-full flex gap-2">
              <button className="btn-primary" onClick={guardar} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button>
              <button className="btn-secondary" onClick={() => { setShowForm(false); setEditId(null) }}>Cancelar</button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input pl-9" placeholder="Buscar por cliente, concepto o N°..." value={search} onChange={e => setSearch(e.target.value)} />
            {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"><X size={14} /></button>}
          </div>
          <select className="input max-w-[180px]" value={filtro} onChange={e => setFiltro(e.target.value as Filtro)}>
            <option value="todas">Todas</option>
            <option value="pendiente">Pendientes</option>
            <option value="pagada">Pagadas</option>
          </select>
        </div>

        <div className="card overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="table-header">N°</th>
                <th className="table-header">Fecha</th>
                <th className="table-header">Cliente</th>
                <th className="table-header">Concepto</th>
                <th className="table-header text-right">Monto</th>
                <th className="table-header text-right">ITBMS</th>
                <th className="table-header text-right">Total</th>
                <th className="table-header">Vence</th>
                <th className="table-header text-right">Saldo</th>
                <th className="table-header">Estado</th>
                <th className="table-header">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={11} className="text-center py-12 text-gray-400">Cargando...</td></tr>
              ) : filtradas.length === 0 ? (
                <tr><td colSpan={11} className="text-center py-12 text-gray-400">Sin ventas registradas</td></tr>
              ) : filtradas.map(v => {
                const saldo = saldoDe(v)
                const vencida = v.estado === 'pendiente' && !!v.fecha_pago && v.fecha_pago < hoy()
                const abono = v.estado === 'pendiente' && (v.monto_pagado || 0) > 0
                return (
                  <tr key={v.id} className="hover:bg-gray-50">
                    <td className="table-cell font-mono text-sm text-gray-600">#{v.numero}</td>
                    <td className="table-cell text-sm text-gray-500">{formatDate(v.fecha)}</td>
                    <td className="table-cell font-medium">{v.clientes?.nombre}</td>
                    <td className="table-cell text-sm text-gray-500 max-w-[220px]"><span className="truncate block">{v.concepto || '—'}</span></td>
                    <td className="table-cell text-right">{formatCurrency(v.monto)}</td>
                    <td className="table-cell text-right text-gray-400">{formatCurrency(v.itbms)} <span className="text-[10px]">({v.itbms_pct}%)</span></td>
                    <td className="table-cell text-right font-semibold">{formatCurrency(v.total)}</td>
                    <td className={`table-cell text-sm ${vencida ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>{formatDate(v.fecha_pago)}</td>
                    <td className={`table-cell text-right font-semibold ${saldo > 0 ? 'text-orange-600' : 'text-gray-300'}`}>{saldo > 0 ? formatCurrency(saldo) : '—'}</td>
                    <td className="table-cell">
                      <span className={`badge ${v.estado === 'pagada' ? 'bg-green-100 text-green-700' : abono ? 'bg-yellow-100 text-yellow-700' : 'bg-orange-100 text-orange-700'}`}>
                        {v.estado === 'pagada' ? 'Pagada' : abono ? 'Abono parcial' : 'Pendiente'}
                      </span>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center gap-2">
                        {puedeEditar && v.estado === 'pendiente' && (
                          <button onClick={() => abrirCobro(v)} className="flex items-center gap-1 text-xs text-green-700 hover:text-green-900" title="Registrar cobro en banco">
                            <Wallet size={14} /> Cobrar
                          </button>
                        )}
                        {(v.monto_pagado || 0) > 0 || v.estado === 'pagada' ? (
                          <button onClick={() => abrirHistorial(v)} className="text-xs text-brand-600 hover:text-brand-800" title="Ver cobros">Cobros</button>
                        ) : null}
                        {puedeEditar && (v.monto_pagado || 0) === 0 && (
                          <button onClick={() => abrirEditar(v)} className="text-gray-400 hover:text-brand-600" title="Editar"><Pencil size={14} /></button>
                        )}
                        {puedeBorrar && (v.monto_pagado || 0) === 0 && (
                          <button onClick={() => setEliminar(v)} className="text-gray-300 hover:text-red-600" title="Eliminar"><Trash2 size={14} /></button>
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

      {/* Modal cobro */}
      {cobrar && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setCobrar(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-900">Cobrar venta #{cobrar.numero}</h3>
            <p className="text-sm text-gray-500">{cobrar.clientes?.nombre} · saldo {formatCurrency(saldoDe(cobrar))}</p>
            <div>
              <label className="label">Cuenta de banco</label>
              <select className="input" value={cobroForm.cuenta_id} onChange={e => setCobroForm(p => ({ ...p, cuenta_id: e.target.value }))}>
                {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre} – {c.banco}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Fecha</label><input type="date" className="input" value={cobroForm.fecha} onChange={e => setCobroForm(p => ({ ...p, fecha: e.target.value }))} /></div>
              <div><label className="label">Monto</label><input type="number" step="0.01" min={0} className="input" value={cobroForm.monto} onChange={e => setCobroForm(p => ({ ...p, monto: e.target.value }))} /></div>
            </div>
            <div><label className="label">Referencia</label><input className="input" value={cobroForm.referencia} onChange={e => setCobroForm(p => ({ ...p, referencia: e.target.value }))} placeholder="N° depósito, transferencia..." /></div>
            <div className="flex gap-2 pt-1">
              <button className="btn-primary" onClick={registrarCobro} disabled={cobrando}>{cobrando ? 'Registrando...' : 'Registrar cobro'}</button>
              <button className="btn-secondary" onClick={() => setCobrar(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal historial de cobros */}
      {historial && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setHistorial(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-900">Cobros de la venta #{historial.numero}</h3>
            {pagos.length === 0 ? (
              <p className="text-sm text-gray-400">Sin cobros.</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-200">
                  <th className="table-header">Recibo</th><th className="table-header">Fecha</th><th className="table-header">Cuenta</th>
                  <th className="table-header text-right">Monto</th><th className="table-header"></th>
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {pagos.map(p => {
                    const rev = Array.isArray(p.pago_reversos) ? p.pago_reversos[0] : p.pago_reversos
                    return (
                      <tr key={p.id} className={rev ? 'opacity-50' : ''}>
                        <td className="table-cell font-mono text-xs">{p.numero_recibo ? `REC-${String(p.numero_recibo).padStart(5, '0')}` : '—'}</td>
                        <td className="table-cell">{formatDate(p.fecha)}</td>
                        <td className="table-cell text-gray-500">{p.banco_cuentas?.nombre}</td>
                        <td className="table-cell text-right font-semibold">{formatCurrency(p.monto)}</td>
                        <td className="table-cell">
                          {rev ? (
                            <span className="text-xs text-red-500" title={rev.motivo}>Reversado {formatDate(rev.fecha)}</span>
                          ) : puedeBorrar ? (
                            <button onClick={() => { setReversar(p); setMotivo('') }} className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700">
                              <RefreshCw size={12} /> Reversar
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
            <div className="flex justify-end"><button className="btn-secondary" onClick={() => setHistorial(null)}>Cerrar</button></div>
          </div>
        </div>
      )}

      {/* Modal reverso */}
      {reversar && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setReversar(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-900">Reversar cobro de {formatCurrency(reversar.monto)}</h3>
            <p className="text-sm text-gray-500">Se registrará un egreso en banco por el mismo monto y la venta volverá a pendiente.</p>
            <div><label className="label">Motivo</label><input className="input" value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Mínimo 3 caracteres" /></div>
            <div className="flex gap-2">
              <button className="btn-primary bg-red-600 hover:bg-red-700" onClick={confirmarReverso} disabled={reversando || motivo.trim().length < 3}>{reversando ? 'Reversando...' : 'Reversar'}</button>
              <button className="btn-secondary" onClick={() => setReversar(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal eliminar */}
      {eliminar && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setEliminar(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-900">Eliminar venta #{eliminar.numero}</h3>
            <p className="text-sm text-gray-500">{eliminar.clientes?.nombre} · {formatCurrency(eliminar.total)}. Esta acción no se puede deshacer.</p>
            <div className="flex gap-2">
              <button className="btn-primary bg-red-600 hover:bg-red-700" onClick={confirmarEliminar} disabled={eliminando}>{eliminando ? 'Eliminando...' : 'Eliminar'}</button>
              <button className="btn-secondary" onClick={() => setEliminar(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast {...toast} onClose={hideToast} />}
    </AppLayout>
  )
}

export default withPagePermission(VentasOgemiPage, 'ventas_ogemi', 'ver')
