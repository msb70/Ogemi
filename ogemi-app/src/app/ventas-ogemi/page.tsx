'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { createClient } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetchAll'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Cliente, BancoCuenta, VentaOgemi } from '@/types'
import { Plus, Search, X, Pencil, Trash2, Wallet, RefreshCw, Download, Printer, Eye, Percent } from 'lucide-react'
import { withPagePermission } from '@/components/PermissionGuard'
import PagoAcciones from '@/components/PagoAcciones'
import { Toast } from '@/components/Toast'
import { useToast } from '@/hooks/useToast'
import { useAuth } from '@/context/AuthContext'
import { exportXLSX, kpiSheet } from '@/lib/exportXlsx'
import FacturaOgemiPrint from '@/components/FacturaOgemiPrint'

type Filtro = 'todas' | 'pendiente' | 'pagada' | 'falta_retencion'

// Cobro por líneas, igual que en Facturas (Impresos): cuenta bancaria o anticipo
interface LineaCobro {
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
  numero_recibo: number
  cuenta_id: string
}

const emptyLinea = (cuentaId = ''): LineaCobro => ({
  origen: 'cuenta', cuenta_id: cuentaId, anticipo_id: '', monto: '', referencia: '',
})

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
  const { puedeHacer, profile } = useAuth()
  const isAdmin = profile?.rol_id === 'admin'

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

  // Impresión / PDF de una factura
  const [printVenta, setPrintVenta] = useState<VentaOgemi | null>(null)
  const imprimir = (v: VentaOgemi) => {
    setPrintVenta(v)
    // El título del documento es el nombre sugerido al "Guardar como PDF"
    const titulo = document.title
    document.title = `Factura-Ogemi-${v.numero}`
    const restaurar = () => { document.title = titulo; setPrintVenta(null); window.removeEventListener('afterprint', restaurar) }
    window.addEventListener('afterprint', restaurar)
    setTimeout(() => window.print(), 300)
  }

  // Cobro
  const [cobrar, setCobrar] = useState<VentaOgemi | null>(null)
  const [fechaCobro, setFechaCobro] = useState(hoy())
  const [lineas, setLineas] = useState<LineaCobro[]>([emptyLinea()])
  const [anticipos, setAnticipos] = useState<AnticipoDisp[]>([])
  const [cobrando, setCobrando] = useState(false)

  // Historial de cobros / reverso
  const [historial, setHistorial] = useState<VentaOgemi | null>(null)
  const [pagos, setPagos] = useState<any[]>([])

  // Retención de ITBMS
  const [retVenta, setRetVenta] = useState<VentaOgemi | null>(null)
  const [retForm, setRetForm] = useState({ pct: '', comprobante: false, fecha: hoy() })
  const [savingRet, setSavingRet] = useState(false)

  const [eliminar, setEliminar] = useState<VentaOgemi | null>(null)
  const [eliminando, setEliminando] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: v, error }, { data: c }, { data: b }] = await Promise.all([
      fetchAll(() => supabase.from('ventas_ogemi').select('*, clientes(nombre, dias_credito)')
        .order('fecha', { ascending: false }).order('numero', { ascending: false })),
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
  // A cobrar = total − retención de ITBMS − cobrado (la retención no entra al banco)
  const retDe = (v: VentaOgemi) => Number(v.retencion_monto) || 0
  const saldoDe = (v: VentaOgemi) => Math.max(0, Math.round(((v.total || 0) - retDe(v) - (v.monto_pagado || 0)) * 100) / 100)
  const abrirCobro = async (v: VentaOgemi) => {
    setCobrar(v)
    setFechaCobro(hoy())
    const l0 = emptyLinea(cuentas[0]?.id || '')
    l0.monto = saldoDe(v).toFixed(2)
    setLineas([l0])
    setAnticipos([])
    // Anticipos de Ogemi del cliente con saldo disponible
    const { data } = await supabase
      .from('anticipos_saldos')
      .select('id, fecha, monto, saldo, numero_deposito, numero_recibo, cuenta_id')
      .eq('cliente_id', v.cliente_id)
      .eq('empresa', 'ogemi')
      .eq('estado', 'activo')
      .gt('saldo', 0)
      .order('fecha')
    setAnticipos((data || []) as AnticipoDisp[])
  }

  const addLinea = () => setLineas(prev => [...prev, emptyLinea(cuentas[0]?.id || '')])
  const removeLinea = (idx: number) => setLineas(prev => prev.filter((_, i) => i !== idx))
  const updateLinea = (idx: number, field: keyof LineaCobro, value: string) =>
    setLineas(prev => prev.map((l, i) => i === idx ? ({ ...l, [field]: value } as LineaCobro) : l))
  const totalLineas = lineas.reduce((t, l) => t + (parseFloat(l.monto) || 0), 0)

  const registrarCobro = async () => {
    if (!cobrar) return
    const validas = lineas.filter(l => parseFloat(l.monto) > 0 && (l.origen === 'cuenta' ? l.cuenta_id : l.anticipo_id))
    if (validas.length === 0) { showToast('Agrega al menos un pago con monto y origen', 'error'); return }
    if (totalLineas > saldoDe(cobrar) + 0.005) { showToast('El monto supera el saldo pendiente', 'error'); return }

    // Un anticipo puede usarse en varias líneas: validar el acumulado contra su saldo
    const usoAnt = new Map<string, number>()
    validas.filter(l => l.origen === 'anticipo').forEach(l => usoAnt.set(l.anticipo_id, (usoAnt.get(l.anticipo_id) || 0) + parseFloat(l.monto)))
    for (const [id, usado] of Array.from(usoAnt.entries())) {
      const ant = anticipos.find(a => a.id === id)
      if (ant && usado > ant.saldo + 0.01) {
        showToast(`El monto supera el saldo del anticipo (${formatCurrency(ant.saldo)})`, 'error')
        return
      }
    }

    setCobrando(true)

    // 1) Anticipos: vía RPC (valida empresa, cliente, saldo del anticipo y de la venta; no mueve banco)
    if (usoAnt.size > 0) {
      const { error: eAnt } = await supabase.rpc('registrar_cobro_lote_ventas_ogemi', {
        p_cliente_id: cobrar.cliente_id,
        p_fecha: fechaCobro,
        p_cuenta_id: null,
        p_referencia: null,
        p_pagos: [],
        p_anticipos: Array.from(usoAnt.entries()).map(([anticipo_id, monto]) => ({
          anticipo_id, venta_ogemi_id: cobrar.id, monto: Math.round(monto * 100) / 100,
        })),
      })
      if (eAnt) {
        setCobrando(false)
        showToast(`No se pudo aplicar el anticipo: ${eAnt.message}`, 'error')
        return
      }
    }

    // 2) Cuentas bancarias: pagos normales (generan el ingreso en banco)
    const pagosInsert = validas.filter(l => l.origen === 'cuenta').map(l => ({
      venta_ogemi_id: cobrar.id,
      cuenta_id: l.cuenta_id,
      fecha: fechaCobro,
      monto: parseFloat(l.monto),
      referencia: l.referencia.trim() || null,
    }))
    const { error } = pagosInsert.length > 0
      ? await supabase.from('pagos').insert(pagosInsert)
      : { error: null }

    setCobrando(false)
    if (error) {
      showToast(`${usoAnt.size > 0 ? 'El anticipo se aplicó, pero no' : 'No'} se pudo registrar el cobro en banco: ${error.message}`, 'error')
      if (usoAnt.size > 0) { setCobrar(null); load() }
      return
    }
    showToast(pagosInsert.length > 0 ? 'Cobro registrado' : 'Anticipo aplicado', 'success')
    setCobrar(null)
    load()
  }

  // ── Historial / reverso ───────────────────────────────────────────────────
  const abrirHistorial = async (v: VentaOgemi) => {
    setHistorial(v)
    const { data } = await supabase
      .from('pagos')
      .select('id, fecha, monto, referencia, numero_recibo, cuenta_id, lote_id, anticipo_id, banco_cuentas(nombre, banco), pago_reversos(id, fecha, motivo)')
      .eq('venta_ogemi_id', v.id)
      .order('fecha', { ascending: false })
    setPagos(data || [])
  }
  const onPagoChanged = (msg: string) => {
    showToast(msg, 'success')
    if (historial) abrirHistorial(historial)
    load()
  }

  const abrirRetencion = (v: VentaOgemi) => {
    setRetVenta(v)
    setRetForm({
      pct: v.retencion_pct ? String(v.retencion_pct) : '',
      comprobante: !!v.retencion_comprobante_entregado,
      fecha: v.retencion_comprobante_fecha || hoy(),
    })
  }
  const guardarRetencion = async () => {
    if (!retVenta) return
    const p = parseFloat(retForm.pct) || 0
    if (p < 0 || p > 100) { showToast('El % de retención debe estar entre 0 y 100.', 'error'); return }
    setSavingRet(true)
    const { error } = await supabase.from('ventas_ogemi').update({
      retencion_pct: p,
      retencion_comprobante_entregado: retForm.comprobante,
      retencion_comprobante_fecha: retForm.comprobante ? (retForm.fecha || null) : null,
    }).eq('id', retVenta.id)
    setSavingRet(false)
    if (error) { showToast(`No se pudo guardar la retención: ${error.message}`, 'error'); return }
    setRetVenta(null)
    showToast('Retención actualizada', 'success')
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
        ['N°', 'Fecha', 'Cliente', 'Concepto', 'Monto', '% ITBMS', 'ITBMS', 'Total', 'Retención %', 'Retención', 'A cobrar', 'Días crédito', 'Vence', 'Cobrado', 'Saldo', 'Estado'],
        ...filtradas.map(v => [
          v.numero, v.fecha, v.clientes?.nombre || '', v.concepto || '', v.monto, v.itbms_pct, v.itbms, v.total,
          v.retencion_pct || 0, retDe(v), Math.round(((v.total || 0) - retDe(v)) * 100) / 100,
          v.dias_credito, v.fecha_pago || '', v.monto_pagado || 0, saldoDe(v), v.estado,
        ]),
      ] },
    ])
  }

  const puedeEditar = puedeHacer('ventas_ogemi', 'editar')
  const puedeBorrar = puedeHacer('ventas_ogemi', 'borrar')

  return (
    <AppLayout>
      {/* Área de impresión: portal a body + display:none del resto (visibility deja páginas en blanco) */}
      {printVenta && typeof document !== 'undefined' && createPortal(
        <div id="factura-ogemi-print" className="hidden print:block">
          <FacturaOgemiPrint venta={printVenta} />
        </div>,
        document.body,
      )}
      {printVenta && <style>{`
        @media print {
          body > :not(#factura-ogemi-print) { display: none !important; }
          #factura-ogemi-print { display: block !important; width: 100%; }
          @page { margin: 14mm; }
        }
      `}</style>}
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
              <select className="input" value={form.cliente_id} onChange={e => onClienteChange(e.target.value)}
                disabled={!!editId && (ventas.find(x => x.id === editId)?.monto_pagado || 0) > 0}
                title={editId && (ventas.find(x => x.id === editId)?.monto_pagado || 0) > 0 ? 'La venta tiene cobros: no se puede cambiar el cliente' : undefined}>
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
            <option value="falta_retencion">Falta comprobante de retención</option>
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
                      <span className={`badge ${v.estado === 'pagada' ? 'bg-green-100 text-green-700' : v.estado === 'falta_retencion' ? 'bg-amber-100 text-amber-700' : abono ? 'bg-yellow-100 text-yellow-700' : 'bg-orange-100 text-orange-700'}`}>
                        {v.estado === 'pagada' ? 'Pagada' : v.estado === 'falta_retencion' ? 'Falta comprobante' : abono ? 'Abono parcial' : 'Pendiente'}
                      </span>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center gap-3">
                        <button onClick={() => abrirHistorial(v)} className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-800 font-medium" title="Ver detalle y cobros">
                          <Eye size={14} /> Ver
                        </button>
                        {puedeEditar && v.estado === 'pendiente' && (v.total || 0) > 0 && (
                          <button onClick={() => abrirCobro(v)} className="flex items-center gap-1 text-xs text-green-700 hover:text-green-900 font-medium" title="Registrar cobro en banco">
                            <Wallet size={14} /> {(v.monto_pagado || 0) > 0 ? 'Abonar' : 'Cobrar'}
                          </button>
                        )}
                        {puedeEditar && (
                          <button onClick={() => abrirRetencion(v)}
                            className={`flex items-center gap-1 text-xs font-medium ${v.estado === 'falta_retencion' ? 'text-amber-600 hover:text-amber-800' : 'text-gray-400 hover:text-brand-600'}`}
                            title="Retención de ITBMS">
                            <Percent size={14} /> {v.estado === 'falta_retencion' ? 'Comprobante' : 'Retención'}
                          </button>
                        )}
                        <button onClick={() => imprimir(v)} className="flex items-center gap-1 text-xs text-gray-500 hover:text-brand-600" title="Imprimir / guardar en PDF">
                          <Printer size={14} /> PDF
                        </button>
                        {puedeEditar && ((v.monto_pagado || 0) === 0 || isAdmin) && (
                          <button onClick={() => abrirEditar(v)} className="flex items-center gap-1 text-xs text-gray-400 hover:text-brand-600"
                            title={(v.monto_pagado || 0) > 0 ? 'Editar (admin): tiene cobros, el cliente no se puede cambiar' : 'Editar'}>
                            <Pencil size={14} /> Editar
                          </button>
                        )}
                        {((puedeBorrar && (v.monto_pagado || 0) === 0) || isAdmin) && (
                          <button onClick={() => setEliminar(v)} className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700" title="Borrar venta">
                            <Trash2 size={14} /> Borrar
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

      {/* Modal cobro — mismo formato que Facturas (Impresos): líneas con origen cuenta/anticipo */}
      {cobrar && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setCobrar(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-900">Cobrar venta #{cobrar.numero}</h3>
            <p className="text-sm text-gray-500 mb-3">{cobrar.clientes?.nombre} · saldo {formatCurrency(saldoDe(cobrar))}</p>

            {anticipos.length > 0 && (
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
                El cliente tiene {anticipos.length} anticipo{anticipos.length === 1 ? '' : 's'} disponible{anticipos.length === 1 ? '' : 's'} por {formatCurrency(anticipos.reduce((t, a) => t + a.saldo, 0))}. Elige el origen &quot;Anticipo&quot; para aplicarlo.
              </div>
            )}

            <div className="mb-4">
              <label className="label">Fecha de cobro</label>
              <input type="date" className="input" value={fechaCobro} onChange={e => setFechaCobro(e.target.value)} />
            </div>

            <div className="space-y-3 mb-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-700">Forma de pago</p>
                <button onClick={addLinea} className="text-xs flex items-center gap-1 text-brand-600 hover:text-brand-800">
                  <Plus size={13} /> Agregar pago
                </button>
              </div>

              {lineas.map((linea, idx) => (
                <div key={idx} className="border border-gray-200 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500 font-medium">Pago {idx + 1}</span>
                    {lineas.length > 1 && (
                      <button onClick={() => removeLinea(idx)} className="text-red-400 hover:text-red-600"><Trash2 size={13} /></button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="label text-xs">Origen</label>
                      <select className="input text-sm" value={linea.origen} onChange={e => updateLinea(idx, 'origen', e.target.value)}>
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
                          <select className="input text-sm" value={linea.cuenta_id} onChange={e => updateLinea(idx, 'cuenta_id', e.target.value)}>
                            <option value="">Seleccionar cuenta...</option>
                            {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre} – {c.banco}</option>)}
                          </select>
                        </>
                      ) : (
                        <>
                          <label className="label text-xs">Anticipo</label>
                          <select
                            className="input text-sm"
                            value={linea.anticipo_id}
                            onChange={e => {
                              const a = anticipos.find(x => x.id === e.target.value)
                              // Sugerir el menor entre el saldo del anticipo y lo que falta por cubrir
                              const otros = lineas.reduce((t, l, i) => i === idx ? t : t + (parseFloat(l.monto) || 0), 0)
                              const falta = Math.max(0, saldoDe(cobrar) - otros)
                              setLineas(prev => prev.map((l, i) => i === idx ? ({
                                ...l, anticipo_id: e.target.value,
                                monto: a ? Math.min(a.saldo, falta).toFixed(2) : l.monto,
                              }) : l))
                            }}
                          >
                            <option value="">Seleccionar anticipo...</option>
                            {anticipos.map(a => (
                              <option key={a.id} value={a.id}>
                                REC-{String(a.numero_recibo).padStart(5, '0')} · {formatDate(a.fecha)} · saldo {formatCurrency(a.saldo)}{a.numero_deposito ? ` · ${a.numero_deposito}` : ''}
                              </option>
                            ))}
                          </select>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="label text-xs">Monto</label>
                      <input type="number" step="0.01" min="0.01" className="input text-sm" placeholder="0.00"
                        value={linea.monto} onChange={e => updateLinea(idx, 'monto', e.target.value)} />
                    </div>
                    <div>
                      <label className="label text-xs">Referencia</label>
                      <input className="input text-sm" placeholder="Cheque, transferencia..." value={linea.referencia}
                        disabled={linea.origen === 'anticipo'}
                        title={linea.origen === 'anticipo' ? 'La referencia se genera con el N° de recibo del anticipo' : undefined}
                        onChange={e => updateLinea(idx, 'referencia', e.target.value)} />
                    </div>
                  </div>
                </div>
              ))}

              {lineas.length > 1 && (
                <div className="flex justify-between text-sm font-semibold bg-brand-50 rounded-lg px-3 py-2">
                  <span className="text-brand-700">Total este abono</span>
                  <span className="text-brand-800">{formatCurrency(totalLineas)}</span>
                </div>
              )}

              {totalLineas > saldoDe(cobrar) + 0.01 && (
                <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
                  ⚠ El monto supera el saldo pendiente ({formatCurrency(saldoDe(cobrar))})
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => setCobrar(null)}>Cancelar</button>
              <button
                className="btn-primary flex-1"
                onClick={registrarCobro}
                disabled={cobrando || lineas.every(l => !l.monto || (l.origen === 'cuenta' ? !l.cuenta_id : !l.anticipo_id))}
              >
                {cobrando ? 'Registrando...' : 'Registrar cobro'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Ver: detalle de la venta + cobros (editar/borrar cobro) */}
      {historial && (() => {
        const h = ventas.find(x => x.id === historial.id) || historial
        const fila = (l: string, val: string, cls = '') => (
          <div className="flex justify-between py-1"><span className="text-gray-500">{l}</span><span className={`text-right ${cls}`}>{val}</span></div>
        )
        return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setHistorial(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-gray-900">Factura Ogemi #{h.numero}</h3>
                <p className="text-sm text-gray-500">{h.clientes?.nombre}</p>
              </div>
              <span className={`badge ${h.estado === 'pagada' ? 'bg-green-100 text-green-700' : h.estado === 'falta_retencion' ? 'bg-amber-100 text-amber-700' : 'bg-orange-100 text-orange-700'}`}>
                {h.estado === 'pagada' ? 'Pagada' : h.estado === 'falta_retencion' ? 'Falta comprobante' : (h.monto_pagado || 0) > 0 ? 'Abono parcial' : 'Pendiente'}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 text-sm">
              <div>
                {fila('Fecha', formatDate(h.fecha))}
                {fila('Días de crédito', String(h.dias_credito ?? '—'))}
                {fila('Vence', formatDate(h.fecha_pago))}
                {fila('Concepto', h.concepto || '—')}
                {h.notas ? fila('Notas', h.notas) : null}
              </div>
              <div>
                {fila('Monto', formatCurrency(h.monto))}
                {fila(`ITBMS (${h.itbms_pct}%)`, formatCurrency(h.itbms))}
                {fila('Total', formatCurrency(h.total), 'font-semibold')}
                {retDe(h) > 0 && fila(`Retención (${h.retencion_pct}% ITBMS)`, `− ${formatCurrency(retDe(h))}`, 'text-amber-600')}
                {retDe(h) > 0 && fila('Comprobante', h.retencion_comprobante_entregado ? `Entregado ${formatDate(h.retencion_comprobante_fecha)}` : 'Pendiente', h.retencion_comprobante_entregado ? 'text-green-600' : 'text-amber-600')}
                {fila('Cobrado', formatCurrency(h.monto_pagado || 0))}
                {fila('Saldo a cobrar', formatCurrency(saldoDe(h)), 'font-bold text-orange-600')}
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold text-gray-700 mb-1">Cobros</p>
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
                          <td className="table-cell text-gray-500">{p.anticipo_id ? <span className="badge bg-amber-100 text-amber-700">Anticipo</span> : p.banco_cuentas?.nombre}</td>
                          <td className="table-cell text-right font-semibold">{formatCurrency(p.monto)}</td>
                          <td className="table-cell">
                            <div className="flex items-center gap-2">
                              {rev && <span className="text-xs text-red-500" title={rev.motivo}>Reversado {formatDate(rev.fecha)}</span>}
                              <PagoAcciones pago={p} modulo="ventas_ogemi" cuentas={cuentas} reversado={!!rev} onChanged={onPagoChanged} />
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary flex items-center gap-2" onClick={() => imprimir(h)}><Printer size={15} /> PDF</button>
              <button className="btn-secondary" onClick={() => setHistorial(null)}>Cerrar</button>
            </div>
          </div>
        </div>
        )
      })()}

      {/* Modal Retención de ITBMS */}
      {retVenta && (() => {
        const p = Math.min(100, Math.max(0, parseFloat(retForm.pct) || 0))
        const rm = Math.round(p / 100 * (retVenta.itbms || 0) * 100) / 100
        return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !savingRet && setRetVenta(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Percent size={18} className="text-amber-600" /> Retención de ITBMS</h3>
            <p className="text-sm text-gray-500">Venta #{retVenta.numero} · {retVenta.clientes?.nombre}</p>
            <div>
              <label className="label">% de retención sobre el ITBMS</label>
              <input type="number" min={0} max={100} step="0.01" className="input" placeholder="0" value={retForm.pct} onChange={e => setRetForm(f => ({ ...f, pct: e.target.value }))} />
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-gray-500">Total</span><span>{formatCurrency(retVenta.total)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">ITBMS</span><span>{formatCurrency(retVenta.itbms)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Retención</span><span className="font-medium text-amber-600">− {formatCurrency(rm)}</span></div>
              <div className="flex justify-between border-t border-gray-200 pt-1"><span className="font-medium">A cobrar (entra al banco)</span><span className="font-semibold">{formatCurrency(Math.round(((retVenta.total || 0) - rm) * 100) / 100)}</span></div>
            </div>
            {rm > 0 && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={retForm.comprobante} onChange={e => setRetForm(f => ({ ...f, comprobante: e.target.checked }))} />
                Comprobante de retención entregado
              </label>
            )}
            {rm > 0 && retForm.comprobante && (
              <div><label className="label">Fecha del comprobante</label><input type="date" className="input" value={retForm.fecha} onChange={e => setRetForm(f => ({ ...f, fecha: e.target.value }))} /></div>
            )}
            <p className="text-[11px] text-gray-400">Cobrado el neto sin comprobante, la venta queda en &quot;Falta comprobante&quot;; con comprobante pasa a Pagada.</p>
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setRetVenta(null)} disabled={savingRet}>Cancelar</button>
              <button className="btn-primary flex-1" onClick={guardarRetencion} disabled={savingRet}>{savingRet ? 'Guardando...' : 'Guardar'}</button>
            </div>
          </div>
        </div>
        )
      })()}

      {/* Modal eliminar */}
      {eliminar && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setEliminar(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-900">Eliminar venta #{eliminar.numero}</h3>
            <p className="text-sm text-gray-500">{eliminar.clientes?.nombre} · {formatCurrency(eliminar.total)}. Esta acción no se puede deshacer.</p>
            {(eliminar.monto_pagado || 0) > 0 && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                Tiene {formatCurrency(eliminar.monto_pagado)} cobrado: se borrarán también sus cobros y movimientos de banco (los anticipos aplicados quedan libres).
              </p>
            )}
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
