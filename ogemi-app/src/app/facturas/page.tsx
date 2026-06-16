'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { createClient } from '@/lib/supabase'
import { formatCurrency, formatDate, tramoColor, classifyTramo } from '@/lib/utils'
import { Factura, BancoCuenta } from '@/types'
import { Search, CheckCircle, Filter, X, Plus, Trash2, RefreshCw, Eye, Printer } from 'lucide-react'
import type { CSSProperties } from 'react'
import { Toast } from '@/components/Toast'
import { useToast } from '@/hooks/useToast'
import PermissionGuard, { withPagePermission } from '@/components/PermissionGuard'

type EstadoFilter = 'todos' | 'pendiente' | 'pagada'

type FacturasResumen = {
  num_facturas: number
  num_pagadas: number
  num_pendientes: number
  monto_total: number
  monto_pagado: number
  monto_pendiente: number
  num_notas_credito: number
  total_notas_credito: number
}

const PAGE_SIZE = 50

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

function FacturasPage() {
  const [facturas, setFacturas] = useState<Factura[]>([])
  const [cuentas, setCuentas] = useState<BancoCuenta[]>([])
  const [loading, setLoading] = useState(true)
  const [searchInput, setSearchInput] = useState('')   // valor del input (sin debounce)
  const [search, setSearch] = useState('')             // valor comprometido que va al server
  const [estadoFilter, setEstadoFilter] = useState<EstadoFilter>('todos')
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')
  const [page, setPage] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [resumen, setResumen] = useState<FacturasResumen | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cuentasCargadasRef = useRef(false)

  // Modal de abonos
  const [selectedFactura, setSelectedFactura] = useState<Factura | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [fechaPago, setFechaPago] = useState('')
  const [lineas, setLineas] = useState<LineaPago[]>([emptyLinea()])
  const [saving, setSaving] = useState(false)
  const [anticipos, setAnticipos] = useState<AnticipoDisp[]>([])
  const [pagosExistentes, setPagosExistentes] = useState<any[]>([])
  const [reversadosIds, setReversadosIds] = useState<Set<string>>(new Set())

  // Modal de detalle (ver factura)
  const [detalle, setDetalle] = useState<Factura | null>(null)
  const [detallePagos, setDetallePagos] = useState<any[]>([])
  const [detalleReversados, setDetalleReversados] = useState<Set<string>>(new Set())
  const [loadingDetalle, setLoadingDetalle] = useState(false)

  // Reverso de pago
  const [pagoAReversar, setPagoAReversar] = useState<any | null>(null)
  const [motivoReverso, setMotivoReverso] = useState('')
  const [reversando, setReversando] = useState(false)

  const { toast, showToast, hideToast } = useToast()

  const supabase = createClient()

  const loadData = useCallback(async () => {
    setLoading(true)

    // Búsqueda server-side:
    //   - Si es número → filtrar por numero_factura exacto
    //   - Si es texto  → pre-cargar IDs de clientes que coincidan y filtrar por IN
    let clienteIdsFilter: string[] | null = null
    if (search && !/^\d+$/.test(search.trim())) {
      const { data: clientesMatch } = await supabase
        .from('clientes')
        .select('id')
        .ilike('nombre', `%${search.trim()}%`)
      clienteIdsFilter = clientesMatch?.map(c => c.id) || []

      // Ningún cliente coincide → retorno inmediato sin consultar facturas
      if (clienteIdsFilter.length === 0) {
        setFacturas([])
        setTotalCount(0)
        setLoading(false)
        return
      }
    }

    let query = supabase
      .from('facturas')
      .select('*, clientes(nombre, dias_credito), banco_cuentas(nombre, banco)', { count: 'exact' })
      .order('fecha', { ascending: false })
      .order('numero_factura', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (estadoFilter !== 'todos') {
      query = query.eq('estado', estadoFilter)
    }

    if (fechaDesde) query = query.gte('fecha', fechaDesde)
    if (fechaHasta) query = query.lte('fecha', fechaHasta)

    if (search.trim()) {
      if (/^\d+$/.test(search.trim())) {
        query = query.eq('numero_factura', parseInt(search.trim()))
      } else if (clienteIdsFilter && clienteIdsFilter.length > 0) {
        query = query.in('cliente_id', clienteIdsFilter)
      }
    }

    const { data, count } = await query
    setFacturas(data || [])
    setTotalCount(count || 0)

    // Cuentas bancarias: cargar sólo una vez por sesión (ref evita stale closure)
    if (!cuentasCargadasRef.current) {
      cuentasCargadasRef.current = true
      const { data: cuentasData } = await supabase
        .from('banco_cuentas').select('*').eq('activo', true).order('nombre')
      setCuentas(cuentasData || [])
    }

    setLoading(false)
  }, [estadoFilter, search, page, fechaDesde, fechaHasta])

  const loadResumen = useCallback(async () => {
    const { data } = await supabase.rpc('facturas_resumen', {
      p_estado: estadoFilter === 'todos' ? null : estadoFilter,
      p_search: search.trim() || null,
      p_desde: fechaDesde || null,
      p_hasta: fechaHasta || null,
    })
    if (data && data[0]) setResumen(data[0] as FacturasResumen)
  }, [supabase, estadoFilter, search, fechaDesde, fechaHasta])

  // Debounce: espera 400ms después de que el usuario deja de escribir para enviar al server
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setPage(0)
      setSearch(searchInput)
    }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [searchInput])

  // Resetear página cuando cambia el filtro de estado o las fechas
  useEffect(() => { setPage(0) }, [estadoFilter, fechaDesde, fechaHasta])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => { loadResumen() }, [loadResumen])

  const openPagoModal = async (f: Factura) => {
    setSelectedFactura(f)
    setFechaPago(new Date().toISOString().split('T')[0])
    setLineas([emptyLinea(cuentas[0]?.id || '')])
    setAnticipos([])
    setShowModal(true)

    // Cargar pagos existentes + reversos + anticipos disponibles del cliente (en paralelo)
    const [{ data }, { data: reversos }, { data: anticData }] = await Promise.all([
      supabase
        .from('pagos')
        .select('*, banco_cuentas(nombre, banco)')
        .eq('factura_id', f.id)
        .order('fecha', { ascending: false }),
      supabase
        .from('pago_reversos')
        .select('pago_id')
        .eq('factura_id', f.id),
      supabase
        .from('anticipos_saldos')
        .select('id, fecha, monto, saldo, numero_deposito, cuenta_id')
        .eq('cliente_id', f.cliente_id)
        .eq('estado', 'activo')
        .gt('saldo', 0)
        .order('fecha'),
    ])
    setPagosExistentes(data || [])
    setReversadosIds(new Set((reversos || []).map(r => r.pago_id)))
    setAnticipos((anticData || []) as AnticipoDisp[])
  }

  const openDetalle = async (f: Factura) => {
    setDetalle(f)
    setLoadingDetalle(true)
    setDetallePagos([])
    const [{ data: pagosData }, { data: reversos }] = await Promise.all([
      supabase
        .from('pagos')
        .select('id, fecha, monto, referencia, anticipo_id, banco_cuentas(nombre, banco, numero_cuenta), anticipos(numero_deposito)')
        .eq('factura_id', f.id)
        .order('fecha', { ascending: true }),
      supabase.from('pago_reversos').select('pago_id').eq('factura_id', f.id),
    ])
    setDetallePagos(pagosData || [])
    setDetalleReversados(new Set((reversos || []).map(r => r.pago_id)))
    setLoadingDetalle(false)
  }

  const handleReversarPago = async () => {
    if (!pagoAReversar) return
    if (motivoReverso.trim().length < 3) {
      showToast('El motivo debe tener al menos 3 caracteres', 'error')
      return
    }
    setReversando(true)
    const { error } = await supabase.rpc('reversar_pago', {
      p_pago_id: pagoAReversar.id,
      p_motivo: motivoReverso.trim(),
    })
    setReversando(false)
    if (error) {
      showToast(`No se pudo reversar el pago: ${error.message}`, 'error')
      return
    }
    showToast('Pago reversado correctamente', 'success')
    // Cerrar todo y recargar: la lista refleja el saldo/estado recalculado por la función
    setPagoAReversar(null)
    setMotivoReverso('')
    setShowModal(false)
    setSelectedFactura(null)
    loadData()
    loadResumen()
  }

  const addLinea = () => {
    setLineas(prev => [...prev, emptyLinea(cuentas[0]?.id || '')])
  }

  const removeLinea = (idx: number) => {
    setLineas(prev => prev.filter((_, i) => i !== idx))
  }

  const updateLinea = (idx: number, field: keyof LineaPago, value: string) => {
    setLineas(prev => prev.map((l, i) => i === idx ? ({ ...l, [field]: value } as LineaPago) : l))
  }

  const totalLineas = lineas.reduce((s, l) => s + (parseFloat(l.monto) || 0), 0)

  const saldoPendiente = selectedFactura
    ? (selectedFactura.total - (selectedFactura.monto_pagado || 0))
    : 0

  const handleRegistrarAbono = async () => {
    if (!selectedFactura) return
    const lineasValidas = lineas.filter(l =>
      parseFloat(l.monto) > 0 && (l.origen === 'cuenta' ? l.cuenta_id : l.anticipo_id)
    )
    if (lineasValidas.length === 0) return

    // Validar que no se exceda el saldo de cada anticipo usado
    for (const l of lineasValidas) {
      if (l.origen === 'anticipo') {
        const ant = anticipos.find(a => a.id === l.anticipo_id)
        if (ant && parseFloat(l.monto) > ant.saldo + 0.01) {
          showToast(`El monto supera el saldo del anticipo (${formatCurrency(ant.saldo)})`, 'error')
          return
        }
      }
    }

    setSaving(true)

    // Cada línea es un pago. Si es anticipo, se aplica el crédito (cuenta del anticipo, sin mover banco).
    const pagosInsert = lineasValidas.map(l => {
      const ant = l.origen === 'anticipo' ? anticipos.find(a => a.id === l.anticipo_id) : null
      return {
        factura_id: selectedFactura.id,
        cuenta_id: l.origen === 'anticipo' ? (ant?.cuenta_id || null) : l.cuenta_id,
        anticipo_id: l.origen === 'anticipo' ? l.anticipo_id : null,
        monto: parseFloat(l.monto),
        fecha: fechaPago,
        referencia: l.referencia || (l.origen === 'anticipo' ? 'Aplicación de anticipo' : null),
      }
    })

    const { error } = await supabase.from('pagos').insert(pagosInsert)

    setSaving(false)
    if (error) {
      showToast(`Error al registrar el pago: ${error.message}`, 'error')
    } else {
      setShowModal(false)
      showToast('Pago registrado correctamente', 'success')
      loadData()
      loadResumen()
    }
  }

  const getDiasVencida = (f: Factura): number => {
    if (!f.fecha_pago) return 0
    const hoy = new Date()
    const vence = new Date(f.fecha_pago + 'T00:00:00')
    return Math.floor((hoy.getTime() - vence.getTime()) / 86400000)
  }

  // Usar classifyTramo de utils para mantener única fuente de verdad
  const getTramo = (dias: number): string => classifyTramo(dias)

  return (
    <AppLayout>
      {toast && <Toast {...toast} onClose={hideToast} />}
      <Header
        title="Facturas"
        subtitle={`${totalCount.toLocaleString('es-PA')} registros`}
      />

      {/* Resumen */}
      {resumen && (
        <div className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
            <div className="rounded-xl bg-gray-50 p-3">
              <p className="text-[11px] font-semibold uppercase text-gray-500">Facturas</p>
              <p className="text-xl font-bold text-gray-900">{resumen.num_facturas.toLocaleString('es-PA')}</p>
            </div>
            <div className="rounded-xl bg-green-50 p-3">
              <p className="text-[11px] font-semibold uppercase text-gray-500">Pagadas</p>
              <p className="text-xl font-bold text-green-700">{resumen.num_pagadas.toLocaleString('es-PA')}</p>
            </div>
            <div className="rounded-xl bg-yellow-50 p-3">
              <p className="text-[11px] font-semibold uppercase text-gray-500">Pendientes</p>
              <p className="text-xl font-bold text-yellow-700">{resumen.num_pendientes.toLocaleString('es-PA')}</p>
            </div>
            <div className="rounded-xl bg-purple-50 p-3">
              <p className="text-[11px] font-semibold uppercase text-gray-500">N. crédito</p>
              <p className="text-xl font-bold text-purple-700">{resumen.num_notas_credito.toLocaleString('es-PA')}</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-3">
              <p className="text-[11px] font-semibold uppercase text-gray-500">Monto total</p>
              <p className="text-lg font-bold text-gray-900">{formatCurrency(resumen.monto_total)}</p>
            </div>
            <div className="rounded-xl bg-green-50 p-3">
              <p className="text-[11px] font-semibold uppercase text-gray-500">Monto pagado</p>
              <p className="text-lg font-bold text-green-700">{formatCurrency(resumen.monto_pagado)}</p>
            </div>
            <div className="rounded-xl bg-orange-50 p-3">
              <p className="text-[11px] font-semibold uppercase text-gray-500">Monto pendiente</p>
              <p className="text-lg font-bold text-orange-600">{formatCurrency(resumen.monto_pendiente)}</p>
            </div>
            <div className="rounded-xl bg-purple-50 p-3">
              <p className="text-[11px] font-semibold uppercase text-gray-500">Total N. crédito</p>
              <p className="text-lg font-bold text-purple-700">{formatCurrency(resumen.total_notas_credito)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-sm min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="input pl-9"
            placeholder="Buscar por #factura, cliente..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          {searchInput && (
            <button onClick={() => { setSearchInput(''); setSearch('') }} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Desde</span>
          <input
            type="date"
            className="input py-1.5 text-sm w-[150px]"
            value={fechaDesde}
            onChange={(e) => setFechaDesde(e.target.value)}
          />
          <span className="text-xs text-gray-500">Hasta</span>
          <input
            type="date"
            className="input py-1.5 text-sm w-[150px]"
            value={fechaHasta}
            onChange={(e) => setFechaHasta(e.target.value)}
          />
          {(fechaDesde || fechaHasta) && (
            <button
              onClick={() => { setFechaDesde(''); setFechaHasta('') }}
              className="text-gray-400 hover:text-gray-600"
              title="Limpiar fechas"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Filter size={16} className="text-gray-400" />
          {(['todos', 'pendiente', 'pagada'] as EstadoFilter[]).map(e => (
            <button
              key={e}
              onClick={() => setEstadoFilter(e)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                estadoFilter === e
                  ? 'bg-brand-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {e.charAt(0).toUpperCase() + e.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="table-header">#Factura</th>
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
              ) : facturas.length === 0 ? (
                <tr><td colSpan={10} className="text-center py-12 text-gray-400">Sin resultados</td></tr>
              ) : (
                facturas.map(f => {
                  const dias = f.estado === 'pendiente' ? getDiasVencida(f) : 0
                  const tramo = f.estado === 'pendiente' ? getTramo(dias) : null
                  const tipoCorto = f.tipo_documento.includes('CREDITO') ? 'N. CRÉDITO' : 'FACTURA'
                  const montoPagado = f.monto_pagado || 0
                  const saldo = f.total - montoPagado
                  return (
                    <tr key={f.id} className="hover:bg-gray-50 transition-colors">
                      <td className="table-cell font-mono font-medium">#{f.numero_factura}</td>
                      <td className="table-cell text-gray-500">{formatDate(f.fecha)}</td>
                      <td className="table-cell max-w-[180px]">
                        <span className="truncate block" title={f.clientes?.nombre}>{f.clientes?.nombre}</span>
                      </td>
                      <td className="table-cell">
                        <span className={`badge ${tipoCorto === 'N. CRÉDITO' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                          {tipoCorto}
                        </span>
                      </td>
                      <td className="table-cell text-right font-semibold">{formatCurrency(f.total)}</td>
                      <td className="table-cell text-right text-green-600">
                        {montoPagado > 0 ? formatCurrency(montoPagado) : '—'}
                      </td>
                      <td className="table-cell text-right font-semibold text-orange-600">
                        {f.estado === 'pagada' ? <span className="text-green-600 text-sm">Saldada</span> : formatCurrency(saldo)}
                      </td>
                      <td className="table-cell">
                        <div className="flex flex-col">
                          <span className="text-xs">{formatDate(f.fecha_pago)}</span>
                          {tramo && f.estado === 'pendiente' && (
                            <span className={`badge mt-0.5 text-xs ${tramoColor(tramo)}`}>{tramo}</span>
                          )}
                        </div>
                      </td>
                      <td className="table-cell">
                        <span className={`badge ${f.estado === 'pagada' ? 'bg-green-100 text-green-700' : montoPagado > 0 ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700'}`}>
                          {f.estado === 'pagada' ? 'pagada' : montoPagado > 0 ? 'abono' : 'pendiente'}
                        </span>
                      </td>
                      <td className="table-cell">
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => openDetalle(f)}
                            className="flex items-center gap-1 text-sm text-brand-600 hover:text-brand-800 font-medium"
                            title="Ver detalle"
                          >
                            <Eye size={15} /> Ver
                          </button>
                          {f.estado === 'pendiente' && f.total > 0 && (
                            <button
                              onClick={() => openPagoModal(f)}
                              className="flex items-center gap-1.5 text-sm text-green-600 hover:text-green-800 font-medium"
                            >
                              <CheckCircle size={15} />
                              {montoPagado > 0 ? 'Abonar' : 'Cobrar'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Paginación */}
        {totalCount > PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
            <p className="text-sm text-gray-500">
              Página {page + 1} de {Math.ceil(totalCount / PAGE_SIZE)} · {totalCount.toLocaleString('es-PA')} registros
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition-colors"
              >
                ← Anterior
              </button>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={(page + 1) * PAGE_SIZE >= totalCount}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition-colors"
              >
                Siguiente →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal: Registrar Abono/Cobro */}
      {showModal && selectedFactura && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold mb-1">
              {(selectedFactura.monto_pagado || 0) > 0 ? 'Registrar abono' : 'Registrar cobro'}
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              Factura #{selectedFactura.numero_factura} · {selectedFactura.clientes?.nombre}
            </p>

            {/* Resumen */}
            <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Total factura</span>
                <span className="font-semibold">{formatCurrency(selectedFactura.total)}</span>
              </div>
              {(selectedFactura.monto_pagado || 0) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Ya pagado</span>
                  <span className="text-green-600">{formatCurrency(selectedFactura.monto_pagado || 0)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-semibold border-t pt-1.5 mt-1.5">
                <span>Saldo pendiente</span>
                <span className="text-orange-600">{formatCurrency(saldoPendiente)}</span>
              </div>
            </div>

            {/* Pagos existentes */}
            {pagosExistentes.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-medium text-gray-500 uppercase mb-2">Pagos registrados</p>
                <div className="space-y-1.5">
                  {pagosExistentes.map(p => {
                    const reversado = reversadosIds.has(p.id)
                    return (
                      <div
                        key={p.id}
                        className={`flex items-center justify-between text-sm rounded-lg px-3 py-2 ${
                          reversado ? 'bg-gray-100' : 'bg-green-50'
                        }`}
                      >
                        <span className={reversado ? 'text-gray-400 line-through' : 'text-gray-600'}>
                          {formatDate(p.fecha)} · {p.banco_cuentas?.nombre}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className={`font-medium ${reversado ? 'text-gray-400 line-through' : 'text-green-700'}`}>
                            {formatCurrency(p.monto)}
                          </span>
                          {reversado ? (
                            <span className="badge bg-gray-200 text-gray-500 text-xs">Reversado</span>
                          ) : (
                            <PermissionGuard modulo="facturas" accion="borrar" silent>
                              <button
                                onClick={() => { setPagoAReversar(p); setMotivoReverso('') }}
                                className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 font-medium"
                                title="Reversar este pago"
                              >
                                <RefreshCw size={13} /> Reversar
                              </button>
                            </PermissionGuard>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Fecha de pago */}
            <div className="mb-4">
              <label className="label">Fecha de cobro</label>
              <input
                type="date"
                className="input"
                value={fechaPago}
                onChange={e => setFechaPago(e.target.value)}
              />
            </div>

            {/* Líneas de pago (multi-cuenta) */}
            <div className="space-y-3 mb-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-700">Forma de pago</p>
                <button
                  onClick={addLinea}
                  className="text-xs flex items-center gap-1 text-brand-600 hover:text-brand-800"
                >
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
                      <select
                        className="input text-sm"
                        value={linea.origen}
                        onChange={e => updateLinea(idx, 'origen', e.target.value)}
                      >
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
                          <select
                            className="input text-sm"
                            value={linea.cuenta_id}
                            onChange={e => updateLinea(idx, 'cuenta_id', e.target.value)}
                          >
                            <option value="">Seleccionar cuenta...</option>
                            {cuentas.map(c => (
                              <option key={c.id} value={c.id}>{c.nombre} – {c.banco}</option>
                            ))}
                          </select>
                        </>
                      ) : (
                        <>
                          <label className="label text-xs">Anticipo</label>
                          <select
                            className="input text-sm"
                            value={linea.anticipo_id}
                            onChange={e => updateLinea(idx, 'anticipo_id', e.target.value)}
                          >
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
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        className="input text-sm"
                        placeholder="0.00"
                        value={linea.monto}
                        onChange={e => updateLinea(idx, 'monto', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="label text-xs">Referencia</label>
                      <input
                        className="input text-sm"
                        placeholder="Cheque, transferencia..."
                        value={linea.referencia}
                        onChange={e => updateLinea(idx, 'referencia', e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              ))}

              {/* Total líneas */}
              {lineas.length > 1 && (
                <div className="flex justify-between text-sm font-semibold bg-brand-50 rounded-lg px-3 py-2">
                  <span className="text-brand-700">Total este abono</span>
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
              <button className="btn-secondary flex-1" onClick={() => setShowModal(false)}>
                Cancelar
              </button>
              <button
                className="btn-primary flex-1"
                onClick={handleRegistrarAbono}
                disabled={saving || lineas.every(l => !l.monto || (l.origen === 'cuenta' ? !l.cuenta_id : !l.anticipo_id))}
              >
                {saving ? 'Guardando...' : 'Registrar pago'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Reversar pago */}
      {pagoAReversar && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
              <RefreshCw size={18} className="text-red-500" /> Reversar pago
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              {formatDate(pagoAReversar.fecha)} · {pagoAReversar.banco_cuentas?.nombre} ·{' '}
              <span className="font-semibold text-gray-700">{formatCurrency(pagoAReversar.monto)}</span>
            </p>

            <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-4 text-xs text-amber-700">
              El pago no se borra: se registra un reverso contable y se genera el contra-movimiento en banco.
              El saldo de la factura se recalcula automáticamente.
            </div>

            <div className="mb-4">
              <label className="label">Motivo del reverso <span className="text-red-500">*</span></label>
              <textarea
                className="input"
                rows={3}
                placeholder="Ej: cheque devuelto, pago mal aplicado..."
                value={motivoReverso}
                onChange={e => setMotivoReverso(e.target.value)}
              />
              <p className="text-xs text-gray-400 mt-1">Mínimo 3 caracteres.</p>
            </div>

            <div className="flex gap-3">
              <button
                className="btn-secondary flex-1"
                onClick={() => { setPagoAReversar(null); setMotivoReverso('') }}
                disabled={reversando}
              >
                Cancelar
              </button>
              <button
                className="btn-primary flex-1 !bg-red-600 hover:!bg-red-700"
                onClick={handleReversarPago}
                disabled={reversando || motivoReverso.trim().length < 3}
              >
                {reversando ? 'Reversando...' : 'Confirmar reverso'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Contenedor de impresión del detalle (solo visible al imprimir) */}
      {detalle && (
        <div id="factura-print" className="hidden print:block">
          <FacturaDetalle factura={detalle} pagos={detallePagos} reversados={detalleReversados} fullPage />
        </div>
      )}

      {/* Modal: Detalle de factura */}
      {detalle && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 print:hidden">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="text-lg font-semibold">Detalle de factura #{detalle.numero_factura}</h2>
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
                <FacturaDetalle factura={detalle} pagos={detallePagos} reversados={detalleReversados} />
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #factura-print, #factura-print * { visibility: visible !important; }
          #factura-print {
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

function FacturaDetalle({
  factura, pagos, reversados, fullPage = false,
}: { factura: Factura; pagos: any[]; reversados: Set<string>; fullPage?: boolean }) {
  const exact = { WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } as CSSProperties
  const montoPagado = factura.monto_pagado || 0
  const saldo = factura.total - montoPagado
  const tipoLabel = factura.tipo_documento?.includes('CREDITO') ? 'Nota de crédito' : 'Factura'

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
            <p className={`uppercase tracking-widest text-white/70 ${fullPage ? 'text-xs' : 'text-[10px]'}`}>{tipoLabel}</p>
            <p className={`font-bold ${fullPage ? 'text-2xl' : 'text-lg'}`}>#{factura.numero_factura}</p>
          </div>
        </div>

        <div className={fullPage ? 'p-10' : 'pt-5'}>
          {/* Datos de la factura */}
          <div className={`grid grid-cols-2 gap-x-6 gap-y-3 mb-6 ${fullPage ? 'text-base' : 'text-sm'}`}>
            <Campo label="Cliente" valor={factura.clientes?.nombre || '—'} />
            <Campo label="Estado" valor={factura.estado === 'pagada' ? 'Pagada' : 'Pendiente'} />
            <Campo label="Fecha de emisión" valor={formatDate(factura.fecha)} />
            <Campo label="Vencimiento" valor={formatDate(factura.fecha_pago)} />
            <Campo label="Tipo de documento" valor={factura.tipo_documento} />
            {factura.estado === 'pagada' && <Campo label="Fecha de cobro" valor={formatDate(factura.fecha_cobro)} />}
          </div>

          {/* Montos */}
          <div className="rounded-xl bg-gray-50 border border-gray-100 divide-y divide-gray-100 mb-6" style={exact}>
            <Fila label="Neto" valor={formatCurrency(factura.monto)} />
            <Fila label="ITBMS" valor={formatCurrency(factura.itbms)} />
            <Fila label="Total" valor={formatCurrency(factura.total)} bold />
            <Fila label="Pagado" valor={formatCurrency(montoPagado)} className="text-green-700" />
            <Fila label="Saldo pendiente" valor={formatCurrency(saldo)} bold className={saldo > 0 ? 'text-orange-600' : 'text-green-700'} />
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
                {pagos.map(p => {
                  const rev = reversados.has(p.id)
                  return (
                    <tr key={p.id} className={rev ? 'text-gray-400 line-through' : ''}>
                      <td className="px-3 py-2">{formatDate(p.fecha)}</td>
                      <td className="px-3 py-2">{p.anticipo_id ? 'Anticipo' : 'Cobro'}{rev ? ' (reversado)' : ''}</td>
                      <td className="px-3 py-2">
                        {p.anticipo_id
                          ? `Anticipo${p.anticipos?.numero_deposito ? ' · ' + p.anticipos.numero_deposito : ''}`
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
            <p>Documento interno de control · No constituye una factura fiscal.</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function Campo({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <p className="text-gray-400 text-xs">{label}</p>
      <p className="font-medium text-gray-800">{valor}</p>
    </div>
  )
}

function Fila({ label, valor, bold = false, className = '' }: { label: string; valor: string; bold?: boolean; className?: string }) {
  return (
    <div className="flex justify-between px-4 py-2.5">
      <span className="text-gray-500">{label}</span>
      <span className={`${bold ? 'font-bold' : 'font-medium'} ${className}`}>{valor}</span>
    </div>
  )
}

export default withPagePermission(FacturasPage, 'facturas', 'ver')
