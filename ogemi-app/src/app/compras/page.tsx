'use client'

import { useEffect, useState, useCallback, Fragment } from 'react'
import { createPortal } from 'react-dom'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { createClient } from '@/lib/supabase'
// formatMonto: montos sin el símbolo USD/US$ (pedido del usuario)
import { formatMonto as formatCurrency, formatDate } from '@/lib/utils'
import { Compra, Proveedor, BancoCuenta } from '@/types'
import {
  Plus, Search, X, Download, Filter,
  TrendingDown, Clock, CheckCircle, ShoppingCart, Pencil, Trash2,
  QrCode, Loader2, AlertCircle, Link, Eye, Printer
} from 'lucide-react'
import type { CSSProperties } from 'react'
import { Toast } from '@/components/Toast'
import { useToast } from '@/hooks/useToast'
import { useAuth } from '@/context/AuthContext'
import { exportXLSX, kpiSheet } from '@/lib/exportXlsx'
import QrScanner from '@/components/QrScanner'
import { withPagePermission } from '@/components/PermissionGuard'

type Tab = 'listado' | 'vencidas'
type EstadoFilter = 'todos' | 'pendiente' | 'vencida' | 'pagada'

interface LineaPago {
  origen: 'cuenta' | 'nota_credito'
  cuenta_id: string
  nc_id: string
  monto: string
  referencia: string
}

const lineaVacia = (cuentaId: string): LineaPago =>
  ({ origen: 'cuenta', cuenta_id: cuentaId, nc_id: '', monto: '', referencia: '' })

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
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [agruparProveedor, setAgruparProveedor] = useState(false)
  const [agruparProveedorCxp, setAgruparProveedorCxp] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Vencidas
  const [vencidas, setVencidas] = useState<any[]>([])

  // Modal de abonos
  const [selectedCompra, setSelectedCompra] = useState<Compra | null>(null)
  const [showPagoModal, setShowPagoModal] = useState(false)
  const [fechaPago, setFechaPago] = useState('')
  const [lineas, setLineas] = useState<LineaPago[]>([lineaVacia('')])
  const [ncsProveedor, setNcsProveedor] = useState<Compra[]>([])
  const [savingPago, setSavingPago] = useState(false)
  const [pagosExistentes, setPagosExistentes] = useState<any[]>([])
  const [pagoReversados, setPagoReversados] = useState<Set<string>>(new Set())

  // Editar cobro / borrar (solo admin)
  const [cobroEdit, setCobroEdit] = useState<any | null>(null)
  const [cobroForm, setCobroForm] = useState({ monto: '', fecha: '', cuenta_id: '', motivo: '' })
  const [savingCobro, setSavingCobro] = useState(false)

  // Modal de detalle (ver compra)
  const [detalle, setDetalle] = useState<Compra | null>(null)
  const [detallePagos, setDetallePagos] = useState<any[]>([])
  const [detalleReversados, setDetalleReversados] = useState<Set<string>>(new Set())
  const [loadingDetalle, setLoadingDetalle] = useState(false)

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
    tipo_documento: 'FACTURA',
    documento_afectado: '',
    monto: '',
    itbms: '',
    estado: 'pendiente',
    banco_cuenta_id: '',
    fecha_pago: new Date().toISOString().split('T')[0],
    notas: '',
  })

  const esNotaCredito = (t?: string | null) => !!t && t.toUpperCase().includes('CREDITO')

  const { profile } = useAuth()
  const isAdmin = profile?.rol_id === 'admin'

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
      concepto: '', referencia: '', tipo_documento: 'FACTURA', documento_afectado: '',
      monto: '', itbms: '',
      estado: 'pendiente', banco_cuenta_id: '',
      fecha_pago: new Date().toISOString().split('T')[0], notas: '',
    })
    setEditId(null)
  }

  const handleOpenForm = (c?: Compra) => {
    if (c && c.compra_aplicada_id) {
      showToast('Esta nota de crédito ya está aplicada como pago. Reversa ese pago antes de editarla.', 'error')
      return
    }
    if (c) {
      setEditId(c.id)
      setForm({
        proveedor_id: c.proveedor_id,
        fecha: c.fecha,
        concepto: c.concepto || '',
        referencia: c.referencia || '',
        tipo_documento: c.tipo_documento || 'FACTURA',
        documento_afectado: c.documento_afectado || '',
        // Se muestran magnitudes positivas; el signo lo aplica el tipo de documento al guardar
        monto: String(Math.abs(c.monto)),
        itbms: String(Math.abs(c.itbms)),
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
    // Las notas de crédito se guardan en negativo (igual que en facturas)
    const esNC = esNotaCredito(form.tipo_documento)
    const signo = esNC ? -1 : 1
    const payload: any = {
      proveedor_id: form.proveedor_id,
      fecha: form.fecha,
      concepto: form.concepto || null,
      referencia: form.referencia || null,
      tipo_documento: form.tipo_documento || 'FACTURA',
      documento_afectado: esNC ? (form.documento_afectado || null) : null,
      monto: signo * Math.abs(parseFloat(form.monto) || 0),
      itbms: signo * Math.abs(parseFloat(form.itbms) || 0),
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
    setLineas([lineaVacia(cuentas[0]?.id || '')])
    setNcsProveedor([])
    setShowPagoModal(true)
    const [{ data }, { data: reversos }, { data: ncsData }] = await Promise.all([
      supabase.from('pagos').select('*, banco_cuentas(nombre, banco)')
        .eq('compra_id', c.id).order('fecha', { ascending: false }),
      supabase.from('pago_reversos').select('pago_id').eq('compra_id', c.id),
      // NC del proveedor disponibles (total negativo, aún no aplicadas)
      supabase.from('compras')
        .select('id, fecha, referencia, concepto, total, documento_afectado')
        .eq('proveedor_id', c.proveedor_id)
        .ilike('tipo_documento', '%credito%')
        .lt('total', 0)
        .is('compra_aplicada_id', null)
        .order('fecha'),
    ])
    setPagosExistentes(data || [])
    setPagoReversados(new Set((reversos || []).map(r => r.pago_id)))
    setNcsProveedor((ncsData || []) as Compra[])
  }

  const openDetalle = async (c: Compra) => {
    setDetalle(c)
    setLoadingDetalle(true)
    setDetallePagos([])
    const [{ data: pagosData }, { data: reversos }] = await Promise.all([
      supabase
        .from('pagos')
        .select('id, fecha, monto, referencia, credito_compra_id, banco_cuentas(nombre, banco, numero_cuenta)')
        .eq('compra_id', c.id)
        .order('fecha', { ascending: true }),
      supabase.from('pago_reversos').select('pago_id').eq('compra_id', c.id),
    ])
    setDetallePagos(pagosData || [])
    setDetalleReversados(new Set((reversos || []).map(r => r.pago_id)))
    setLoadingDetalle(false)
  }

  const handleEliminarCompra = async (c: Compra) => {
    if (!confirm(`¿Borrar la compra de ${c.proveedores?.nombre || ''} (${formatCurrency(c.total)})? Se eliminarán sus pagos y movimientos de banco. No se puede deshacer.`)) return
    const { error } = await supabase.rpc('eliminar_compra', { p_id: c.id })
    if (error) { showToast(`No se pudo borrar: ${error.message}`, 'error'); return }
    showToast('Compra borrada', 'success')
    load(); loadVencidas()
  }

  const openEditCobro = (p: any) => {
    setCobroEdit(p)
    setCobroForm({ monto: String(p.monto), fecha: p.fecha, cuenta_id: p.cuenta_id || '', motivo: '' })
  }

  const handleEditCobro = async () => {
    if (!cobroEdit) return
    const monto = parseFloat(cobroForm.monto) || 0
    if (monto <= 0 || !cobroForm.cuenta_id) return
    if (cobroForm.motivo.trim().length < 3) { showToast('Indica un motivo (mín. 3 caracteres).', 'error'); return }
    setSavingCobro(true)
    const { error } = await supabase.rpc('editar_cobro_compra', {
      p_pago_id: cobroEdit.id, p_monto: monto, p_fecha: cobroForm.fecha,
      p_cuenta_id: cobroForm.cuenta_id, p_referencia: cobroEdit.referencia || null,
      p_motivo: cobroForm.motivo.trim(),
    })
    setSavingCobro(false)
    if (error) { showToast(`No se pudo editar el pago: ${error.message}`, 'error'); return }
    setCobroEdit(null)
    setShowPagoModal(false)
    setSelectedCompra(null)
    showToast('Pago actualizado', 'success')
    load(); loadVencidas()
  }

  const addLinea = () => setLineas(p => [...p, lineaVacia(cuentas[0]?.id || '')])
  const removeLinea = (idx: number) => setLineas(p => p.filter((_, i) => i !== idx))
  const updateLinea = (idx: number, field: keyof LineaPago, value: string) =>
    setLineas(p => p.map((l, i) => {
      if (i !== idx) return l
      const next = { ...l, [field]: value }
      // Al elegir origen NC, el monto queda fijo al total de la NC (uso único)
      if (field === 'origen') {
        next.cuenta_id = value === 'cuenta' ? (cuentas[0]?.id || '') : ''
        next.nc_id = ''
        next.monto = ''
      }
      if (field === 'nc_id') {
        const nc = ncsProveedor.find(n => n.id === value)
        next.monto = nc ? Math.abs(nc.total).toFixed(2) : ''
      }
      return next
    }))

  // Ids de NC ya elegidas en otras líneas (para no ofrecerlas dos veces)
  const ncsUsadas = (idx: number) =>
    new Set(lineas.filter((l, i) => i !== idx && l.origen === 'nota_credito' && l.nc_id).map(l => l.nc_id))

  const handleRegistrarAbono = async () => {
    if (!selectedCompra) return
    const validas = lineas.filter(l =>
      parseFloat(l.monto) > 0 && (l.origen === 'cuenta' ? l.cuenta_id : l.nc_id)
    )
    if (validas.length === 0) return
    setSavingPago(true)

    // 1) Notas de crédito: vía RPC (uso único + validación de saldo en DB)
    for (const l of validas.filter(x => x.origen === 'nota_credito')) {
      const { error: eNC } = await supabase.rpc('aplicar_nc_compra', {
        p_nc_id: l.nc_id,
        p_compra_id: selectedCompra.id,
        p_fecha: fechaPago,
      })
      if (eNC) {
        setSavingPago(false)
        showToast(`No se pudo aplicar la nota de crédito: ${eNC.message}`, 'error')
        return
      }
    }

    // 2) Cuentas bancarias: pagos normales
    const pagosInsert = validas
      .filter(l => l.origen === 'cuenta')
      .map(l => ({
        compra_id: selectedCompra.id,
        cuenta_id: l.cuenta_id,
        monto: parseFloat(l.monto),
        fecha: fechaPago,
        referencia: l.referencia || null,
      }))
    const { error } = pagosInsert.length > 0
      ? await supabase.from('pagos').insert(pagosInsert)
      : { error: null }

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

  const exportExcel = () => {
    const fecha = new Date().toISOString().split('T')[0]
    if (tab === 'vencidas') {
      const total = vencidas.reduce((s: number, c: any) => s + (c.saldo_pendiente ?? c.total ?? 0), 0)
      exportXLSX(`cuentas_por_pagar_${fecha}.xlsx`, [
        kpiSheet('Compras — Cuentas por pagar', 'Pendientes', [
          ['Total por pagar', total],
          ['# Cuentas', vencidas.length],
          ...resumenTramos.map(t => [`${t.label}`, t.monto] as [string, number]),
        ]),
        { name: 'Cuentas por pagar', rows: [
          ['Fecha', 'Proveedor', 'Concepto', 'Vencimiento', 'Días', 'Total', 'Saldo', 'Tramo'],
          ...vencidas.map((c: any) => [
            c.fecha, c.proveedor, c.concepto || '', c.vencimiento, c.dias_vencida,
            c.total, c.saldo_pendiente ?? c.total, TRAMO_LABELS[c.tramo] || c.tramo,
          ]),
        ] },
      ])
      return
    }
    const total = filtered.reduce((s, c) => s + (c.total || 0), 0)
    // Pagado incluye abonos parciales de compras pendientes; Pendiente = saldo real
    const pagado = filtered.reduce((s, c) => s + (c.estado === 'pagada' ? (c.total || 0) : (c.monto_pagado || 0)), 0)
    const pendiente = filtered.reduce((s, c) => s + (c.estado === 'pendiente' ? (c.total || 0) - (c.monto_pagado || 0) : 0), 0)
    exportXLSX(`compras_${fecha}.xlsx`, [
      kpiSheet('Compras — Listado', 'Filtros activos', [
        ['# Compras', filtered.length],
        ['Pendientes', filtered.filter(c => c.estado === 'pendiente').length],
        ['Pagadas', filtered.filter(c => c.estado === 'pagada').length],
        ['Monto total', total],
        ['Pagado', pagado],
        ['Pendiente', pendiente],
      ]),
      { name: 'Listado', rows: [
        ['Fecha', 'Proveedor', 'Concepto', 'Referencia', 'Tipo documento', 'Documento afectado',
         'Monto', 'ITBMS', 'Total', 'Pagado', 'Saldo', 'Estado', 'Vencimiento'],
        ...filtered.map(c => [
          c.fecha, (c.proveedores as any)?.nombre || '', c.concepto || '', c.referencia || '',
          c.tipo_documento || 'FACTURA', c.documento_afectado || '',
          c.monto, c.itbms, c.total, c.monto_pagado || 0, c.total - (c.monto_pagado || 0),
          c.estado, c.vencimiento || '',
        ]),
      ] },
    ])
  }

  const hoyStr = new Date().toISOString().split('T')[0]
  const filtered = compras.filter(c => {
    const prov = (c.proveedores as any)?.nombre || ''
    const matchSearch = !search || prov.toLowerCase().includes(search.toLowerCase()) ||
      (c.concepto || '').toLowerCase().includes(search.toLowerCase())
    const esVencida = c.estado === 'pendiente' && !!c.vencimiento && c.vencimiento < hoyStr && c.total > 0
    const matchEstado =
      estadoFilter === 'todos' ? true :
      estadoFilter === 'vencida' ? esVencida :
      c.estado === estadoFilter
    const matchDesde = !fechaDesde || c.fecha >= fechaDesde
    const matchHasta = !fechaHasta || c.fecha <= fechaHasta
    return matchSearch && matchEstado && matchDesde && matchHasta
  })

  // Totales del set filtrado (reflejan búsqueda, estado y rango de fechas)
  // Pendiente = saldo real (total − abonos); Pagado = pagadas completas + abonos de pendientes
  const totalPendiente = filtered.filter(c => c.estado === 'pendiente').reduce((s, c) => s + c.total - (c.monto_pagado || 0), 0)
  const totalPagado = filtered.reduce((s, c) => s + (c.estado === 'pagada' ? c.total : (c.monto_pagado || 0)), 0)
  const countPendiente = filtered.filter(c => c.estado === 'pendiente').length

  const totalVencidas = vencidas.reduce((s: number, c: any) => s + (c.total || 0), 0)

  const resumenTramos = ['corriente', '1-30', '31-60', '61-90', '+120'].map(tramo => ({
    tramo,
    label: TRAMO_LABELS[tramo],
    cantidad: vencidas.filter((c: any) => c.tramo === tramo).length,
    monto: vencidas.filter((c: any) => c.tramo === tramo).reduce((s: number, c: any) => s + c.total, 0),
  }))

  // Fila de cuentas por pagar (escritorio); reutilizada por la vista agrupada
  const filaVencida = (c: any) => (
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
  )

  // Fila del listado de compras (escritorio); reutilizada por la vista agrupada
  const filaCompraListado = (c: Compra) => {
                    const hoy = new Date().toISOString().split('T')[0]
                    const vencida = c.vencimiento && c.estado === 'pendiente' && c.vencimiento < hoy
                    return (
                      <tr key={c.id} className={`hover:bg-gray-50 ${vencida ? 'bg-red-50/30' : ''}`}>
                        <td className="table-cell text-gray-500 text-sm">{formatDate(c.fecha)}</td>
                        <td className="table-cell font-medium">
                          {esNotaCredito(c.tipo_documento) && <span className="badge bg-purple-100 text-purple-700 mr-1">NC</span>}
                          {(c.proveedores as any)?.nombre || '—'}
                        </td>
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
                        <td className="table-cell text-right text-green-600">
                          {(c.monto_pagado || 0) > 0 ? formatCurrency(c.monto_pagado || 0) : '—'}
                        </td>
                        <td className="table-cell text-right font-semibold text-orange-600">
                          {c.estado === 'pagada'
                            ? <span className="text-green-600" title="Saldada">{formatCurrency(0)}</span>
                            : formatCurrency(c.total - (c.monto_pagado || 0))}
                        </td>
                        <td className="table-cell">
                          {esNotaCredito(c.tipo_documento) ? (
                            <span className="badge flex items-center gap-1 w-fit bg-purple-100 text-purple-700">
                              {c.compra_aplicada_id ? <CheckCircle size={11} /> : <Clock size={11} />}
                              {c.compra_aplicada_id ? 'Aplicada' : 'Disponible'}
                            </span>
                          ) : (
                            <span className={`badge flex items-center gap-1 w-fit ${
                              c.estado === 'pagada' ? 'bg-green-100 text-green-700' : vencida ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
                            }`}>
                              {c.estado === 'pagada' ? <CheckCircle size={11} /> : <Clock size={11} />}
                              {c.estado === 'pagada' ? 'Pagada' : vencida ? 'Vencida' : 'Pendiente'}
                            </span>
                          )}
                        </td>
                        <td className="table-cell text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => openDetalle(c)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50"
                              title="Ver detalle">
                              <Eye size={14} />
                            </button>
                            <button onClick={() => handleOpenForm(c)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50"
                              title="Editar">
                              <Pencil size={14} />
                            </button>
                            {c.estado === 'pendiente' && !esNotaCredito(c.tipo_documento) && (
                              <button
                                onClick={() => openPagarModal(c)}
                                className="flex items-center gap-1 text-xs text-green-600 hover:text-green-800 font-medium border border-green-200 rounded-lg px-2 py-1"
                              >
                                <CheckCircle size={12} />
                                {(c.monto_pagado || 0) > 0 ? 'Abonar' : 'Pagar'}
                              </button>
                            )}
                            {isAdmin && (
                              <button onClick={() => handleEliminarCompra(c)}
                                className="p-1.5 rounded-lg text-red-500 hover:text-red-700 hover:bg-red-50"
                                title="Borrar compra (admin)">
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
  }

  return (
    <AppLayout>
      {toast && <Toast {...toast} onClose={hideToast} />}
      <Header
        title="Compras"
        subtitle={`${countPendiente} compras pendientes · ${formatCurrency(totalPendiente)}`}
        actions={
          <div className="flex items-center gap-2">
            <button className="btn-secondary flex items-center gap-2" onClick={exportExcel}>
              <Download size={16} />Exportar Excel
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
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              <div className="card p-4">
                <p className="text-[11px] font-semibold uppercase text-gray-500">Compras</p>
                <p className="text-xl font-bold text-gray-900">{filtered.length.toLocaleString('es-PA')}</p>
              </div>
              <div className="card p-4">
                <p className="text-[11px] font-semibold uppercase text-gray-500">Pendientes</p>
                <p className="text-xl font-bold text-orange-600">{countPendiente.toLocaleString('es-PA')}</p>
              </div>
              <div className="card p-4">
                <p className="text-[11px] font-semibold uppercase text-gray-500">Pagadas</p>
                <p className="text-xl font-bold text-green-600">{filtered.filter(c => c.estado === 'pagada').length.toLocaleString('es-PA')}</p>
              </div>
              <div className="card p-4">
                <p className="text-[11px] font-semibold uppercase text-gray-500">Monto total</p>
                <p className="text-lg font-bold text-brand-700">{formatCurrency(totalPendiente + totalPagado)}</p>
              </div>
              <div className="card p-4">
                <p className="text-[11px] font-semibold uppercase text-gray-500">Monto pendiente</p>
                <p className="text-lg font-bold text-orange-600">{formatCurrency(totalPendiente)}</p>
              </div>
              <div className="card p-4">
                <p className="text-[11px] font-semibold uppercase text-gray-500">Monto pagado</p>
                <p className="text-lg font-bold text-green-600">{formatCurrency(totalPagado)}</p>
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
                <option value="vencida">Vencidas</option>
                <option value="pagada">Pagadas</option>
              </select>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Desde</span>
                <input type="date" className="input text-sm w-[150px]" value={fechaDesde}
                  onChange={e => setFechaDesde(e.target.value)} />
                <span className="text-xs text-gray-500">Hasta</span>
                <input type="date" className="input text-sm w-[150px]" value={fechaHasta}
                  onChange={e => setFechaHasta(e.target.value)} />
              </div>
              <label className="hidden md:flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
                <input type="checkbox" className="w-4 h-4 accent-brand-600 cursor-pointer"
                  checked={agruparProveedor} onChange={e => setAgruparProveedor(e.target.checked)} />
                Agrupar por proveedor
              </label>
              {(search || estadoFilter !== 'todos' || fechaDesde || fechaHasta) && (
                <button className="text-sm text-brand-600 hover:text-brand-800"
                  onClick={() => { setSearch(''); setEstadoFilter('todos'); setFechaDesde(''); setFechaHasta('') }}>
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
                      <p className="font-medium text-sm flex-1 min-w-0 truncate">
                        {esNotaCredito(c.tipo_documento) && <span className="badge bg-purple-100 text-purple-700 mr-1">NC</span>}
                        {(c.proveedores as any)?.nombre || '—'}
                      </p>
                      {esNotaCredito(c.tipo_documento) ? (
                        <span className="badge flex items-center gap-1 flex-shrink-0 bg-purple-100 text-purple-700">
                          {c.compra_aplicada_id ? <CheckCircle size={11} /> : <Clock size={11} />}
                          {c.compra_aplicada_id ? 'Aplicada' : 'Disponible'}
                        </span>
                      ) : (
                        <span className={`badge flex items-center gap-1 flex-shrink-0 ${
                          c.estado === 'pagada' ? 'bg-green-100 text-green-700' : vencida ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
                        }`}>
                          {c.estado === 'pagada' ? <CheckCircle size={11} /> : <Clock size={11} />}
                          {c.estado === 'pagada' ? 'Pagada' : vencida ? 'Vencida' : 'Pendiente'}
                        </span>
                      )}
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
                        <button onClick={() => openDetalle(c)}
                          className="p-2 rounded-lg text-gray-500 border border-gray-200 hover:text-brand-600 hover:bg-brand-50"
                          aria-label="Ver detalle">
                          <Eye size={15} />
                        </button>
                        <button onClick={() => handleOpenForm(c)}
                          className="p-2 rounded-lg text-gray-500 border border-gray-200 hover:text-brand-600 hover:bg-brand-50"
                          aria-label="Editar">
                          <Pencil size={15} />
                        </button>
                        {c.estado === 'pendiente' && !esNotaCredito(c.tipo_documento) && (
                          <button
                            onClick={() => openPagarModal(c)}
                            className="flex items-center gap-1 text-sm text-green-700 font-medium border border-green-300 bg-green-50 rounded-lg px-3 py-2"
                          >
                            <CheckCircle size={14} />
                            {(c.monto_pagado || 0) > 0 ? 'Abonar' : 'Pagar'}
                          </button>
                        )}
                        {isAdmin && (
                          <button onClick={() => handleEliminarCompra(c)}
                            className="p-2 rounded-lg text-red-500 border border-gray-200 hover:bg-red-50"
                            aria-label="Borrar compra (admin)" title="Borrar compra (admin)">
                            <Trash2 size={15} />
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
                    <th className="table-header text-right">Pagado</th>
                    <th className="table-header text-right">Saldo</th>
                    <th className="table-header">Estado</th>
                    <th className="table-header text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading ? (
                    <tr><td colSpan={11} className="text-center py-10 text-gray-400">Cargando...</td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={11} className="text-center py-10 text-gray-400">
                      <ShoppingCart size={32} className="mx-auto mb-2 opacity-30" />
                      Sin compras registradas
                    </td></tr>
                  ) : agruparProveedor ? (
                    Object.entries(
                      filtered.reduce((acc: Record<string, Compra[]>, c) => {
                        const k = (c.proveedores as any)?.nombre || 'Sin nombre'
                        ;(acc[k] = acc[k] || []).push(c)
                        return acc
                      }, {})
                    )
                      .sort((a, b) => a[0].localeCompare(b[0]))
                      .map(([nombre, cs]) => (
                        <Fragment key={nombre}>
                          <tr className="bg-brand-50/40 border-t border-gray-200">
                            <td colSpan={6} className="table-cell font-semibold text-brand-800">
                              {nombre} <span className="text-xs text-gray-400 font-normal">({cs.length} compra{cs.length === 1 ? '' : 's'})</span>
                            </td>
                            <td className="table-cell text-right font-bold text-brand-800">
                              {formatCurrency(cs.reduce((s, c) => s + (c.total || 0), 0))}
                            </td>
                            <td className="table-cell text-right font-bold text-green-700">
                              {formatCurrency(cs.reduce((s, c) => s + (c.estado === 'pagada' ? (c.total || 0) : (c.monto_pagado || 0)), 0))}
                            </td>
                            <td className="table-cell text-right font-bold text-orange-600">
                              {formatCurrency(cs.reduce((s, c) => s + (c.estado === 'pendiente' ? (c.total || 0) - (c.monto_pagado || 0) : 0), 0))}
                            </td>
                            <td colSpan={2} />
                          </tr>
                          {cs.map(filaCompraListado)}
                        </Fragment>
                      ))
                  ) : filtered.map(filaCompraListado)}
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

            {/* Agrupar por proveedor (solo escritorio) */}
            <div className="hidden md:flex justify-end">
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
                <input type="checkbox" className="w-4 h-4 accent-brand-600 cursor-pointer"
                  checked={agruparProveedorCxp} onChange={e => setAgruparProveedorCxp(e.target.checked)} />
                Agrupar por proveedor
              </label>
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
                  ) : agruparProveedorCxp ? (
                    Object.entries(
                      vencidas.reduce((acc: Record<string, any[]>, c: any) => {
                        const k = c.proveedor || 'Sin nombre'
                        ;(acc[k] = acc[k] || []).push(c)
                        return acc
                      }, {})
                    )
                      .sort((a, b) => a[0].localeCompare(b[0]))
                      .map(([nombre, items]) => [nombre, (items as any[]).sort((a, b) => b.dias_vencida - a.dias_vencida)] as [string, any[]])
                      .map(([nombre, items]) => (
                        <Fragment key={nombre}>
                          <tr className="bg-brand-50/40 border-t border-gray-200">
                            <td colSpan={5} className="table-cell font-semibold text-brand-800">
                              {nombre} <span className="text-xs text-gray-400 font-normal">({items.length} compra{items.length === 1 ? '' : 's'})</span>
                            </td>
                            <td className="table-cell text-right font-bold text-brand-800">
                              {formatCurrency(items.reduce((s: number, c: any) => s + (c.total || 0), 0))}
                            </td>
                            <td />
                          </tr>
                          {items.map(filaVencida)}
                        </Fragment>
                      ))
                  ) : vencidas.map(filaVencida)}
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
                  {pagosExistentes.map(p => {
                    const reversado = pagoReversados.has(p.id)
                    const esNCPago = !!p.credito_compra_id
                    return (
                      <div key={p.id} className={`flex justify-between items-center text-sm rounded-lg px-3 py-2 ${reversado ? 'bg-gray-100' : esNCPago ? 'bg-purple-50' : 'bg-green-50'}`}>
                        <span className={reversado ? 'text-gray-400 line-through' : 'text-gray-600'}>
                          {formatDate(p.fecha)} · {esNCPago ? 'Nota de crédito' : p.banco_cuentas?.nombre}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className={`font-medium ${reversado ? 'text-gray-400 line-through' : esNCPago ? 'text-purple-700' : 'text-green-700'}`}>{formatCurrency(p.monto)}</span>
                          {reversado ? (
                            <span className="badge bg-gray-200 text-gray-500 text-xs">Reversado</span>
                          ) : isAdmin && !esNCPago ? (
                            <button onClick={() => openEditCobro(p)}
                              className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-800 font-medium"
                              title="Editar este pago (admin)">
                              <Pencil size={13} /> Editar
                            </button>
                          ) : null}
                        </div>
                      </div>
                    )
                  })}
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
              {lineas.map((linea, idx) => {
                const usadas = ncsUsadas(idx)
                const ncsElegibles = ncsProveedor.filter(n => !usadas.has(n.id))
                return (
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
                    <label className="label text-xs">Origen</label>
                    <select className="input text-sm" value={linea.origen}
                      onChange={e => updateLinea(idx, 'origen', e.target.value)}>
                      <option value="cuenta">Cuenta bancaria</option>
                      <option value="nota_credito" disabled={ncsProveedor.length === 0}>
                        {ncsProveedor.length === 0 ? 'Nota de crédito (sin disponibles)' : 'Nota de crédito'}
                      </option>
                    </select>
                  </div>
                  {linea.origen === 'cuenta' ? (
                    <div>
                      <label className="label text-xs">Cuenta</label>
                      <select className="input text-sm" value={linea.cuenta_id}
                        onChange={e => updateLinea(idx, 'cuenta_id', e.target.value)}>
                        <option value="">Seleccionar...</option>
                        {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre} – {c.banco}</option>)}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <label className="label text-xs">Nota de crédito del proveedor</label>
                      <select className="input text-sm" value={linea.nc_id}
                        onChange={e => updateLinea(idx, 'nc_id', e.target.value)}>
                        <option value="">Seleccionar NC...</option>
                        {ncsElegibles.map(n => (
                          <option key={n.id} value={n.id}>
                            {formatDate(n.fecha)} · {n.referencia || n.concepto || 'NC'} · {formatCurrency(Math.abs(n.total))}
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] text-purple-700 mt-1">
                        La NC se aplica por su monto total y no pasa por banco.
                      </p>
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="label text-xs">Monto</label>
                      <input type="number" step="0.01" className="input text-sm" placeholder="0.00"
                        value={linea.monto} readOnly={linea.origen === 'nota_credito'}
                        onChange={e => updateLinea(idx, 'monto', e.target.value)} />
                    </div>
                    <div>
                      <label className="label text-xs">Referencia</label>
                      <input className="input text-sm" placeholder="Cheque, transferencia..."
                        value={linea.referencia} disabled={linea.origen === 'nota_credito'}
                        onChange={e => updateLinea(idx, 'referencia', e.target.value)} />
                    </div>
                  </div>
                </div>
                )
              })}
            </div>

            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => setShowPagoModal(false)}>Cancelar</button>
              <button className="btn-primary flex-1" onClick={handleRegistrarAbono}
                disabled={savingPago || lineas.every(l => !l.monto || (l.origen === 'cuenta' ? !l.cuenta_id : !l.nc_id))}>
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
                  <label className="label">Tipo de documento</label>
                  <select className="input" value={esNotaCredito(form.tipo_documento) ? 'NC' : 'FACTURA'}
                    onChange={e => setForm(f => ({
                      ...f,
                      tipo_documento: e.target.value === 'NC' ? 'NOTA DE CREDITO REFERENTE A UNA FE' : 'FACTURA',
                      documento_afectado: e.target.value === 'NC' ? f.documento_afectado : '',
                    }))}>
                    <option value="FACTURA">Factura</option>
                    <option value="NC">Nota de crédito</option>
                  </select>
                </div>
                {esNotaCredito(form.tipo_documento) && (
                  <div>
                    <label className="label">Documento afectado (factura)</label>
                    <input className="input" placeholder="Ej: 166642" value={form.documento_afectado}
                      onChange={e => setForm(f => ({ ...f, documento_afectado: e.target.value }))} />
                  </div>
                )}
              </div>
              {esNotaCredito(form.tipo_documento) && (
                <p className="text-xs text-purple-700 bg-purple-50 rounded-lg px-3 py-2">
                  Nota de crédito: ingresa los montos en positivo; se guardarán en negativo y restarán de la cuenta por pagar del proveedor.
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">Monto sin ITBMS *</label>
                  <input type="number" step="0.01" className="input" placeholder="0.00" value={form.monto}
                    onChange={e => setForm(f => ({ ...f, monto: e.target.value }))} />
                </div>
                <div>
                  <label className="label">ITBMS</label>
                  <input type="number" step="0.01" className="input" placeholder="0.00" value={form.itbms}
                    onChange={e => setForm(f => ({ ...f, itbms: e.target.value }))} />
                </div>
              </div>
              {(Math.abs(parseFloat(form.monto) || 0) + Math.abs(parseFloat(form.itbms) || 0)) > 0 && (
                <div className="bg-gray-50 rounded-xl p-3 flex items-center justify-between">
                  <span className="text-sm text-gray-600">Total</span>
                  <span className={`text-lg font-bold ${esNotaCredito(form.tipo_documento) ? 'text-purple-700' : 'text-brand-700'}`}>
                    {formatCurrency((esNotaCredito(form.tipo_documento) ? -1 : 1) * (Math.abs(parseFloat(form.monto) || 0) + Math.abs(parseFloat(form.itbms) || 0)))}
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

      {/* Contenedor de impresión del detalle (portal a body para colapsar el
          resto con display:none y evitar páginas en blanco) */}
      {detalle && typeof document !== 'undefined' && createPortal(
        <div id="compra-print" className="hidden print:block">
          <CompraDetalle compra={detalle} pagos={detallePagos} reversados={detalleReversados} fullPage />
        </div>,
        document.body,
      )}

      {/* Modal: Detalle de compra */}
      {detalle && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 print:hidden">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="text-lg font-semibold">Detalle de compra</h2>
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
                <CompraDetalle compra={detalle} pagos={detallePagos} reversados={detalleReversados} />
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @media print {
          /* display:none colapsa el layout (visibility dejaba páginas en blanco) */
          body > :not(#compra-print) { display: none !important; }
          #compra-print { display: block !important; width: 100%; }
          @page { margin: 14mm; }
        }
      `}</style>

      {/* Modal: Editar pago de compra (admin) */}
      {cobroEdit && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4 print:hidden">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold mb-1">Editar pago</h2>
            <p className="text-sm text-gray-500 mb-4">Se reversará el pago actual y se registrará uno nuevo.</p>
            <div className="space-y-3">
              <div><label className="label">Monto *</label>
                <input type="number" step="0.01" className="input" value={cobroForm.monto}
                  onChange={e => setCobroForm(f => ({ ...f, monto: e.target.value }))} /></div>
              <div><label className="label">Fecha *</label>
                <input type="date" className="input" value={cobroForm.fecha}
                  onChange={e => setCobroForm(f => ({ ...f, fecha: e.target.value }))} /></div>
              <div><label className="label">Cuenta de banco *</label>
                <select className="input" value={cobroForm.cuenta_id}
                  onChange={e => setCobroForm(f => ({ ...f, cuenta_id: e.target.value }))}>
                  <option value="">Seleccionar cuenta...</option>
                  {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre} – {c.banco}</option>)}
                </select></div>
              <div><label className="label">Motivo de la edición *</label>
                <input className="input" placeholder="Ej: monto corregido" value={cobroForm.motivo}
                  onChange={e => setCobroForm(f => ({ ...f, motivo: e.target.value }))} /></div>
            </div>
            <div className="flex gap-3 mt-5">
              <button className="btn-secondary flex-1" onClick={() => setCobroEdit(null)}>Cancelar</button>
              <button className="btn-primary flex-1" onClick={handleEditCobro}
                disabled={savingCobro || !(parseFloat(cobroForm.monto) > 0) || !cobroForm.cuenta_id || cobroForm.motivo.trim().length < 3}>
                {savingCobro ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}

function CmpCampo({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <p className="text-gray-400 text-xs">{label}</p>
      <p className="font-medium text-gray-800">{valor}</p>
    </div>
  )
}

function CmpFila({ label, valor, bold = false, className = '' }: { label: string; valor: string; bold?: boolean; className?: string }) {
  return (
    <div className="flex justify-between px-4 py-2.5">
      <span className="text-gray-500">{label}</span>
      <span className={`${bold ? 'font-bold' : 'font-medium'} ${className}`}>{valor}</span>
    </div>
  )
}

function CompraDetalle({
  compra, pagos, reversados, fullPage = false,
}: { compra: Compra; pagos: any[]; reversados: Set<string>; fullPage?: boolean }) {
  const exact = { WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } as CSSProperties
  const montoPagado = compra.monto_pagado || 0
  const saldo = compra.total - montoPagado

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
            <p className={`uppercase tracking-widest text-white/70 ${fullPage ? 'text-xs' : 'text-[10px]'}`}>Detalle de</p>
            <p className={`font-bold ${fullPage ? 'text-2xl' : 'text-lg'}`}>
              {compra.tipo_documento?.toUpperCase().includes('CREDITO') ? 'NOTA DE CRÉDITO' : 'COMPRA'}
            </p>
          </div>
        </div>

        <div className={fullPage ? 'p-10' : 'pt-5'}>
          {/* Datos */}
          <div className={`grid grid-cols-2 gap-x-6 gap-y-3 mb-6 ${fullPage ? 'text-base' : 'text-sm'}`}>
            <CmpCampo label="Proveedor" valor={(compra.proveedores as any)?.nombre || '—'} />
            <CmpCampo label="Estado" valor={compra.estado === 'pagada' ? 'Pagada' : 'Pendiente'} />
            <CmpCampo label="Fecha" valor={formatDate(compra.fecha)} />
            <CmpCampo label="Vencimiento" valor={formatDate(compra.vencimiento)} />
            <CmpCampo label="Concepto" valor={compra.concepto || '—'} />
            <CmpCampo label="Referencia" valor={compra.referencia || '—'} />
            <CmpCampo label="Tipo de documento" valor={compra.tipo_documento || 'FACTURA'} />
            {compra.tipo_documento?.toUpperCase().includes('CREDITO') && (
              <CmpCampo label="Documento afectado" valor={compra.documento_afectado || '—'} />
            )}
          </div>

          {/* Montos */}
          <div className="rounded-xl bg-gray-50 border border-gray-100 divide-y divide-gray-100 mb-6" style={exact}>
            <CmpFila label="Monto" valor={formatCurrency(compra.monto)} />
            <CmpFila label="ITBMS" valor={formatCurrency(compra.itbms)} />
            <CmpFila label="Total" valor={formatCurrency(compra.total)} bold />
            <CmpFila label="Pagado" valor={formatCurrency(montoPagado)} className="text-green-700" />
            <CmpFila label="Saldo pendiente" valor={formatCurrency(saldo)} bold className={saldo > 0 ? 'text-orange-600' : 'text-green-700'} />
          </div>

          {/* Pagos */}
          <p className={`font-semibold text-gray-700 mb-2 ${fullPage ? 'text-base' : 'text-sm'}`}>Pagos realizados</p>
          {pagos.length === 0 ? (
            <p className="text-sm text-gray-400 py-3">Sin pagos registrados.</p>
          ) : (
            <table className="w-full text-sm border border-gray-100 rounded-xl overflow-hidden" style={exact}>
              <thead>
                <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Banco / Cuenta</th>
                  <th className="px-3 py-2">Referencia</th>
                  <th className="px-3 py-2 text-right">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pagos.map(p => {
                  const rev = reversados.has(p.id)
                  return (
                    <tr key={p.id} className={rev ? 'text-gray-400 line-through' : ''}>
                      <td className="px-3 py-2">{formatDate(p.fecha)}{rev ? ' (reversado)' : ''}</td>
                      <td className="px-3 py-2">
                        {p.credito_compra_id
                          ? 'Nota de crédito'
                          : `${p.banco_cuentas?.nombre || '—'}${p.banco_cuentas?.banco ? ' · ' + p.banco_cuentas.banco : ''}${p.banco_cuentas?.numero_cuenta ? ' · ' + p.banco_cuentas.numero_cuenta : ''}`}
                      </td>
                      <td className="px-3 py-2">{p.referencia || '—'}</td>
                      <td className="px-3 py-2 text-right font-medium">{formatCurrency(p.monto)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          <div className={`text-center text-gray-400 border-t border-gray-100 pt-3 mt-6 ${fullPage ? 'text-xs' : 'text-[10px]'}`}>
            <p>Documento interno de control de compras.</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default withPagePermission(ComprasPage, 'compras', 'ver')
