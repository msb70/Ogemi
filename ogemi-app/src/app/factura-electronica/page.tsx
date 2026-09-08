'use client'

import { useEffect, useState, useCallback, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { createClient } from '@/lib/supabase'
import { formatCurrency, formatDate, classifyTramo, tramoColor } from '@/lib/utils'
import { FeDocumento, FeArticulo, FeConfig, FeDocumentoLinea, FeDocumentoPago } from '@/types'
import { Plus, Search, X, Pencil, Trash2, Copy, QrCode, AlertCircle, CheckCircle, Loader2, Save, FileText, Printer, Eye } from 'lucide-react'
import ComprobanteFE, { FeEmisor, calcLinea } from '@/components/ComprobanteFE'
import { Toast } from '@/components/Toast'
import { useToast } from '@/hooks/useToast'
import PermissionGuard, { withPagePermission } from '@/components/PermissionGuard'
import { useAuth } from '@/context/AuthContext'
import { FE_TIPO_DOC, FE_ITBMS, FE_UNIDADES, FE_CPBS_GRUPOS, FE_TIPO_CLIENTE, FE_TIPO_CONTRIBUYENTE, FE_FORMAS_PAGO, FE_RETENCIONES } from '@/lib/fe-catalogos'

type Tab = 'documentos' | 'articulos' | 'config'
type EstadoFilter = 'todos' | 'borrador' | 'aceptado' | 'rechazado'

const ESTADO_BADGE: Record<string, string> = {
  borrador: 'bg-gray-100 text-gray-600',
  enviando: 'bg-blue-100 text-blue-700',
  aceptado: 'bg-green-100 text-green-700',
  rechazado: 'bg-red-100 text-red-700',
}

/** Vencimiento, pagado, saldo y estado de cobro de un doc FE, tomados de la factura vinculada en cobros. */
function cobroInfo(d: FeDocumento) {
  const f = d.facturas
  if (!f) return null
  const cobrable = Number(f.total) - Number(f.retencion_monto || 0)
  const pagado = Number(f.monto_pagado || 0)
  const saldo = Math.max(0, cobrable - pagado)
  let dias = 0
  if (f.fecha_pago && f.estado === 'pendiente') {
    dias = Math.floor((Date.now() - new Date(f.fecha_pago + 'T00:00:00').getTime()) / 86400000)
  }
  const badge = f.estado === 'pagada' ? { cls: 'bg-green-100 text-green-700', txt: 'pagada' }
    : f.estado === 'falta_retencion' ? { cls: 'bg-amber-100 text-amber-700', txt: 'falta retención' }
    : pagado > 0 ? { cls: 'bg-blue-100 text-blue-700', txt: 'abono' }
    : { cls: 'bg-yellow-100 text-yellow-700', txt: 'pendiente' }
  return { f, cobrable, pagado, saldo, dias, tramo: f.estado === 'pendiente' ? classifyTramo(dias) : null, badge }
}

const emptyArticulo = () => ({
  id: '', codigo: '', nombre: '', precio: '', prc_impuesto: 7, unidad: 'und',
  grupo_inv: '82', subgr_inv: '8212',
})

function FacturaElectronicaPage() {
  const [tab, setTab] = useState<Tab>('documentos')
  const [docs, setDocs] = useState<FeDocumento[]>([])
  const [articulos, setArticulos] = useState<FeArticulo[]>([])
  const [config, setConfig] = useState<FeConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [estadoFilter, setEstadoFilter] = useState<EstadoFilter>('todos')
  const [timbrando, setTimbrando] = useState<string | null>(null)
  const [ambienteActivo, setAmbienteActivo] = useState<'pruebas' | 'produccion' | null>(null)
  const [detalle, setDetalle] = useState<FeDocumento | null>(null)
  const [detalleLineas, setDetalleLineas] = useState<FeDocumentoLinea[]>([])
  const [detallePagos, setDetallePagos] = useState<FeDocumentoPago[]>([])
  const [detalleLoading, setDetalleLoading] = useState(false)
  const [emisor, setEmisor] = useState<FeEmisor | null>(null)
  // Comprobante Auxiliar (CAFE): doc + líneas + pagos listos para previsualizar/imprimir
  const [cafe, setCafe] = useState<{ doc: FeDocumento; lineas: FeDocumentoLinea[]; pagos: FeDocumentoPago[] } | null>(null)
  const [cafeLoading, setCafeLoading] = useState<string | null>(null)

  // artículos
  const [showArtForm, setShowArtForm] = useState(false)
  const [artForm, setArtForm] = useState(emptyArticulo())
  const [savingArt, setSavingArt] = useState(false)

  // config
  const [configForm, setConfigForm] = useState({
    ambiente: 'pruebas' as 'pruebas' | 'produccion',
    pin: '', usuario: '', clave: '', endpoint_url: '',
    pin_prod: '', usuario_prod: '', clave_prod: '', endpoint_url_prod: '',
    codigo_sucursal: '001', nro_terminal: '1', activo: false,
    fp_credito_codigo: '01', fp_credito_nombre: 'CREDITO',
    emisor_nombre: '', emisor_ruc: '', emisor_dv: '', emisor_direccion: '',
  })
  const [savingConfig, setSavingConfig] = useState(false)

  const { toast, showToast, hideToast } = useToast()
  const { profile } = useAuth()
  const esAdmin = profile?.rol_id === 'admin'
  const supabase = createClient()

  const loadData = useCallback(async () => {
    setLoading(true)
    const [{ data: docsData }, { data: artData }] = await Promise.all([
      supabase.from('fe_documentos')
        .select('*, facturas:factura_id(id, numero_factura, total, monto_pagado, retencion_monto, fecha_pago, estado, fecha_cobro)')
        .order('created_at', { ascending: false }),
      supabase.from('fe_articulos').select('*').order('codigo'),
    ])
    setDocs((docsData || []) as FeDocumento[])
    setArticulos((artData || []) as FeArticulo[])
    const [{ data: amb }, { data: emi }] = await Promise.all([
      supabase.rpc('fe_ambiente_activo'),
      supabase.rpc('fe_emisor'),
    ])
    setAmbienteActivo(amb === 'produccion' ? 'produccion' : amb ? 'pruebas' : null)
    const e = Array.isArray(emi) ? emi[0] : emi
    setEmisor(e ? (e as FeEmisor) : null)
    if (esAdmin) {
      const { data: cfg } = await supabase.from('fe_config').select('*').eq('id', true).single()
      if (cfg) {
        setConfig(cfg as FeConfig)
        setConfigForm({
          ambiente: cfg.ambiente === 'produccion' ? 'produccion' : 'pruebas',
          pin: cfg.pin || '', usuario: cfg.usuario || '', clave: cfg.clave || '',
          endpoint_url: cfg.endpoint_url || '',
          pin_prod: cfg.pin_prod || '', usuario_prod: cfg.usuario_prod || '', clave_prod: cfg.clave_prod || '',
          endpoint_url_prod: cfg.endpoint_url_prod || cfg.endpoint_url || '',
          codigo_sucursal: cfg.codigo_sucursal || '001', nro_terminal: cfg.nro_terminal || '1',
          activo: cfg.activo,
          fp_credito_codigo: cfg.fp_credito_codigo || '01',
          fp_credito_nombre: cfg.fp_credito_nombre || 'CREDITO',
          emisor_nombre: cfg.emisor_nombre || '', emisor_ruc: cfg.emisor_ruc || '',
          emisor_dv: cfg.emisor_dv || '', emisor_direccion: cfg.emisor_direccion || '',
        })
      }
    }
    setLoading(false)
  }, [esAdmin])

  useEffect(() => { loadData() }, [loadData])

  const filtered = docs.filter(d => {
    if (estadoFilter !== 'todos' && d.estado !== estadoFilter) return false
    if (!search) return true
    const s = search.toLowerCase()
    return d.nombre_cliente.toLowerCase().includes(s) || d.documento.toLowerCase().includes(s) || (d.cufe || '').toLowerCase().includes(s)
  })

  /** Carga líneas y formas de pago de un documento (para el detalle y el comprobante) */
  const cargarDetalleDoc = async (id: string) => {
    const [{ data: ln }, { data: pg }] = await Promise.all([
      supabase.from('fe_documento_lineas').select('*').eq('documento_id', id).order('orden'),
      supabase.from('fe_documento_pagos').select('*').eq('documento_id', id),
    ])
    return { lineas: (ln || []) as FeDocumentoLinea[], pagos: (pg || []) as FeDocumentoPago[] }
  }

  const abrirDetalle = async (d: FeDocumento) => {
    setDetalle(d); setDetalleLineas([]); setDetallePagos([]); setDetalleLoading(true)
    const { lineas, pagos } = await cargarDetalleDoc(d.id)
    setDetalleLineas(lineas); setDetallePagos(pagos); setDetalleLoading(false)
  }

  const abrirCafe = async (d: FeDocumento) => {
    setCafeLoading(d.id)
    const { lineas, pagos } = await cargarDetalleDoc(d.id)
    setCafe({ doc: d, lineas, pagos })
    setCafeLoading(null)
  }

  const imprimirCafe = () => {
    // Título del archivo al "Guardar como PDF" en el diálogo de impresión
    const prev = document.title
    if (cafe) document.title = `CAFE_${cafe.doc.documento}_${cafe.doc.nombre_cliente.replace(/[^\w]+/g, '_').slice(0, 30)}`
    window.print()
    setTimeout(() => { document.title = prev }, 1000)
  }

  const timbrar = async (d: FeDocumento) => {
    if (!confirm(`¿Timbrar el documento ${d.documento} (${d.nombre_cliente}) por ${formatCurrency(d.totalfinal)} contra el PAC?`)) return
    setTimbrando(d.id)
    try {
      const res = await fetch('/api/fe/timbrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documento_id: d.id }),
      })
      const data = await res.json()
      if (data.ok) {
        showToast(`Documento aceptado. CUFE recibido. ${data.integracion || ''}`, 'success')
      } else {
        showToast(data.error || data.mensaje || 'El PAC rechazó el documento', 'error')
      }
    } catch (e: any) {
      showToast(`Error: ${e.message}`, 'error')
    }
    setTimbrando(null)
    loadData()
  }

  const eliminarDoc = async (d: FeDocumento) => {
    if (d.estado === 'aceptado') { showToast('No se puede eliminar un documento timbrado.', 'error'); return }
    if (!confirm(`¿Eliminar el borrador ${d.documento}?`)) return
    const { error } = await supabase.from('fe_documentos').delete().eq('id', d.id)
    if (error) { showToast(`No se pudo eliminar: ${error.message}`, 'error'); return }
    showToast('Borrador eliminado', 'success')
    loadData()
  }

  const copiarCufe = (cufe: string) => {
    navigator.clipboard.writeText(cufe)
    showToast('CUFE copiado', 'success')
  }

  // ---- Artículos ----
  const openArtEdit = (a: FeArticulo) => {
    setArtForm({ id: a.id, codigo: a.codigo, nombre: a.nombre, precio: String(a.precio), prc_impuesto: a.prc_impuesto, unidad: a.unidad, grupo_inv: a.grupo_inv, subgr_inv: a.subgr_inv })
    setShowArtForm(true)
  }

  const saveArticulo = async () => {
    if (!artForm.codigo.trim() || !artForm.nombre.trim()) { showToast('Código y nombre son obligatorios.', 'error'); return }
    if (!/^\d{4,}$/.test(artForm.subgr_inv.trim())) { showToast('El subgrupo CPBS debe ser numérico (mínimo 4 dígitos).', 'error'); return }
    if (!artForm.subgr_inv.trim().startsWith(artForm.grupo_inv)) { showToast(`El subgrupo CPBS debe comenzar con el grupo ${artForm.grupo_inv}.`, 'error'); return }
    setSavingArt(true)
    const payload = {
      codigo: artForm.codigo.trim(), nombre: artForm.nombre.trim(),
      precio: parseFloat(artForm.precio) || 0, prc_impuesto: artForm.prc_impuesto,
      unidad: artForm.unidad, grupo_inv: artForm.grupo_inv, subgr_inv: artForm.subgr_inv.trim(),
    }
    const { error } = artForm.id
      ? await supabase.from('fe_articulos').update(payload).eq('id', artForm.id)
      : await supabase.from('fe_articulos').insert(payload)
    setSavingArt(false)
    if (error) { showToast(`No se pudo guardar: ${error.message}`, 'error'); return }
    setShowArtForm(false)
    showToast('Artículo guardado', 'success')
    loadData()
  }

  const toggleArticulo = async (a: FeArticulo) => {
    const { error } = await supabase.from('fe_articulos').update({ activo: !a.activo }).eq('id', a.id)
    if (error) { showToast(error.message, 'error'); return }
    loadData()
  }

  // ---- Config ----
  const saveConfig = async () => {
    setSavingConfig(true)
    const { error } = await supabase.from('fe_config').update({
      ambiente: configForm.ambiente,
      pin: configForm.pin.trim() || null,
      usuario: configForm.usuario.trim() || null,
      clave: configForm.clave.trim() || null,
      endpoint_url: configForm.endpoint_url.trim(),
      pin_prod: configForm.pin_prod.trim() || null,
      usuario_prod: configForm.usuario_prod.trim() || null,
      clave_prod: configForm.clave_prod.trim() || null,
      endpoint_url_prod: configForm.endpoint_url_prod.trim(),
      codigo_sucursal: configForm.codigo_sucursal.trim() || '001',
      nro_terminal: configForm.nro_terminal.trim() || '1',
      activo: configForm.activo,
      fp_credito_codigo: configForm.fp_credito_codigo.trim() || '01',
      fp_credito_nombre: configForm.fp_credito_nombre.trim() || 'CREDITO',
      emisor_nombre: configForm.emisor_nombre.trim(),
      emisor_ruc: configForm.emisor_ruc.trim(),
      emisor_dv: configForm.emisor_dv.trim(),
      emisor_direccion: configForm.emisor_direccion.trim(),
    }).eq('id', true)
    setSavingConfig(false)
    if (error) { showToast(`No se pudo guardar: ${error.message}`, 'error'); return }
    showToast('Configuración guardada', 'success')
    loadData()
  }

  const esProduccion = ambienteActivo === 'produccion'
  const pacListo = config?.activo && (config?.ambiente === 'produccion' ? config?.pin_prod : config?.pin)

  return (
    <AppLayout>
      <Header
        title="Factura Electrónica"
        subtitle="Emisión de FE y NC electrónica — PAC TheFactory Panamá"
        actions={
          <PermissionGuard modulo="factura_electronica" accion="agregar" silent>
            <Link href="/factura-electronica/nueva"
              className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
              <Plus size={16} /> Nuevo documento
            </Link>
          </PermissionGuard>
        }
      />

      <div className="p-4 md:p-6 space-y-4">
        {ambienteActivo && (
          <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${esProduccion ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${esProduccion ? 'bg-red-500' : 'bg-amber-500'}`} />
            {esProduccion
              ? 'Ambiente de PRODUCCIÓN — los documentos timbrados tienen validez fiscal ante la DGI.'
              : 'Ambiente de PRUEBAS — los documentos se timbran contra la DGI de test, sin validez fiscal.'}
          </div>
        )}
        {esAdmin && !pacListo && (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
            <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
            <p>El PAC no está configurado o está inactivo. Puedes crear borradores, pero para timbrar necesitas completar las credenciales en la pestaña <button className="underline font-medium" onClick={() => setTab('config')}>Configuración</button>.</p>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200">
          {(esAdmin
            ? ([['documentos', 'Documentos'], ['articulos', 'Artículos'], ['config', 'Configuración']] as [Tab, string][])
            : ([['documentos', 'Documentos'], ['articulos', 'Artículos']] as [Tab, string][])
          ).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {label}
            </button>
          ))}
        </div>

        {/* ===== Documentos ===== */}
        {tab === 'documentos' && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por cliente, número o CUFE..."
                  className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500" />
              </div>
              <select value={estadoFilter} onChange={e => setEstadoFilter(e.target.value as EstadoFilter)}
                className="text-sm border border-gray-300 rounded-lg px-3 py-2">
                <option value="todos">Todos los estados</option>
                <option value="borrador">Borradores</option>
                <option value="aceptado">Aceptados</option>
                <option value="rechazado">Rechazados</option>
              </select>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 uppercase border-b border-gray-200">
                    <th className="px-4 py-3">#Factura</th>
                    <th className="px-4 py-3">Fecha</th>
                    <th className="px-4 py-3">Cliente</th>
                    <th className="px-4 py-3">Tipo</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-right">Pagado</th>
                    <th className="px-4 py-3 text-right">Saldo</th>
                    <th className="px-4 py-3">Vence</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-400">Cargando...</td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-400">No hay documentos electrónicos.</td></tr>
                  ) : filtered.map(d => {
                    const tipoNombre = FE_TIPO_DOC.find(t => t.codigo === d.tipo_doc)?.nombre || d.tipo_doc
                    const esNC = ['04', '06'].includes(d.tipo_doc)
                    const cobro = cobroInfo(d)
                    return (
                      <tr key={d.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3 font-mono font-medium text-gray-900">
                          #{d.documento}
                          {d.cufe && (
                            <button onClick={() => copiarCufe(d.cufe!)} className="ml-1 text-gray-300 hover:text-brand-600 align-middle" title={`Copiar CUFE ${d.cufe}`}><Copy size={12} /></button>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500">{formatDate(d.fecha)}</td>
                        <td className="px-4 py-3 text-gray-700 max-w-[200px]">
                          <span className="truncate block" title={d.nombre_cliente}>{d.nombre_cliente}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`badge ${esNC ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`} title={tipoNombre}>
                            {esNC ? 'N. CRÉDITO' : 'FACTURA'}
                          </span>
                          {d.es_credito && <span className="block mt-1 text-[11px] text-gray-500">Crédito</span>}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold">{formatCurrency(d.totalfinal)}</td>
                        <td className="px-4 py-3 text-right text-green-600">
                          {cobro && cobro.pagado > 0 ? formatCurrency(cobro.pagado) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-orange-600">
                          {!cobro ? <span className="text-gray-300">—</span>
                            : cobro.f.estado === 'pagada' ? <span className="text-green-600" title="Saldada">{formatCurrency(0)}</span>
                            : cobro.f.estado === 'falta_retencion' ? <span className="text-amber-600 text-sm" title={`Retención pendiente de comprobante: ${formatCurrency(Number(cobro.f.retencion_monto || 0))}`}>Falta comprobante</span>
                            : formatCurrency(cobro.saldo)}
                        </td>
                        <td className="px-4 py-3">
                          {cobro ? (
                            <div className="flex flex-col">
                              <span className="text-xs">{formatDate(cobro.f.fecha_pago)}</span>
                              {cobro.tramo && <span className={`badge mt-0.5 text-xs ${tramoColor(cobro.tramo)}`}>{cobro.tramo}</span>}
                            </div>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col items-start gap-1">
                            {cobro
                              ? <span className={`badge ${cobro.badge.cls}`}>{cobro.badge.txt}</span>
                              : <span className={`badge capitalize ${ESTADO_BADGE[d.estado] || ''}`}>{d.estado}</span>}
                            <div className="flex items-center gap-1">
                              {d.estado === 'aceptado' && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200" title={`CUFE ${d.cufe || ''}`}>CUFE</span>
                              )}
                              {d.ambiente === 'pruebas' && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300" title="Timbrado en ambiente de PRUEBAS: no está en cobros ni en reportes">PRUEBA</span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => abrirDetalle(d)} className="flex items-center gap-1 text-sm text-brand-600 hover:text-brand-800 font-medium" title="Ver detalle">
                              <Eye size={15} /> Ver
                            </button>
                            {d.cufe && (
                              <button onClick={() => abrirCafe(d)} disabled={cafeLoading === d.id}
                                className="flex items-center gap-1 text-sm text-gray-700 hover:text-brand-700 font-medium disabled:opacity-50" title="Comprobante Auxiliar de Factura Electrónica (PDF)">
                                {cafeLoading === d.id ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />} PDF
                              </button>
                            )}
                            {d.url_dgi && (
                              <a href={d.url_dgi} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-brand-600 p-1" title="Consultar en la DGI"><QrCode size={15} /></a>
                            )}
                            {d.estado !== 'aceptado' && (
                              <>
                                <PermissionGuard modulo="factura_electronica" accion="agregar" silent>
                                  <button onClick={() => timbrar(d)} disabled={timbrando === d.id}
                                    className="inline-flex items-center gap-1 text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 px-2.5 py-1 rounded-md">
                                    {timbrando === d.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
                                    Timbrar
                                  </button>
                                </PermissionGuard>
                                <PermissionGuard modulo="factura_electronica" accion="editar" silent>
                                  <Link href={`/factura-electronica/nueva?id=${d.id}`} className="text-gray-400 hover:text-brand-600 p-1" title="Editar borrador">
                                    <Pencil size={15} />
                                  </Link>
                                </PermissionGuard>
                                <PermissionGuard modulo="factura_electronica" accion="borrar" silent>
                                  <button onClick={() => eliminarDoc(d)} className="text-gray-400 hover:text-red-600 p-1" title="Eliminar">
                                    <Trash2 size={15} />
                                  </button>
                                </PermissionGuard>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ===== Artículos ===== */}
        {tab === 'articulos' && (
          <>
            <div className="flex justify-end">
              <PermissionGuard modulo="factura_electronica" accion="agregar" silent>
                <button onClick={() => { setArtForm(emptyArticulo()); setShowArtForm(true) }}
                  className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg">
                  <Plus size={16} /> Nuevo artículo
                </button>
              </PermissionGuard>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 uppercase border-b border-gray-200">
                    <th className="px-4 py-3">Código</th>
                    <th className="px-4 py-3">Nombre</th>
                    <th className="px-4 py-3 text-right">Precio</th>
                    <th className="px-4 py-3">ITBMS</th>
                    <th className="px-4 py-3">Unidad</th>
                    <th className="px-4 py-3">CPBS</th>
                    <th className="px-4 py-3">Activo</th>
                    <th className="px-4 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {articulos.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">Sin artículos. Crea el catálogo para facturar más rápido.</td></tr>
                  ) : articulos.map(a => (
                    <tr key={a.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs">{a.codigo}</td>
                      <td className="px-4 py-3">{a.nombre}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(a.precio)}</td>
                      <td className="px-4 py-3">{a.prc_impuesto}%</td>
                      <td className="px-4 py-3">{a.unidad}</td>
                      <td className="px-4 py-3 font-mono text-xs">{a.grupo_inv} / {a.subgr_inv}</td>
                      <td className="px-4 py-3">
                        <PermissionGuard modulo="factura_electronica" accion="editar" silent>
                          <button onClick={() => toggleArticulo(a)}
                            className={`text-xs px-2 py-0.5 rounded-full ${a.activo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                            {a.activo ? 'Activo' : 'Inactivo'}
                          </button>
                        </PermissionGuard>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <PermissionGuard modulo="factura_electronica" accion="editar" silent>
                          <button onClick={() => openArtEdit(a)} className="text-gray-400 hover:text-brand-600 p-1"><Pencil size={15} /></button>
                        </PermissionGuard>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ===== Configuración (solo admin) ===== */}
        {tab === 'config' && esAdmin && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 max-w-xl space-y-4">
            <p className="text-sm text-gray-500">Credenciales de integración con el PAC TheFactory (CFE Premium Soft). La clave solo es visible para administradores y se usa únicamente desde el servidor.</p>

            {/* Switch de ambiente */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">Ambiente activo</label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setConfigForm(f => ({ ...f, ambiente: 'pruebas' }))}
                  className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${configForm.ambiente === 'pruebas' ? 'bg-amber-50 border-amber-400 text-amber-800 ring-1 ring-amber-400' : 'border-gray-300 text-gray-500 hover:bg-gray-50'}`}>
                  Pruebas
                  <span className="block text-[11px] font-normal">DGI test — sin validez fiscal</span>
                </button>
                <button type="button" onClick={() => setConfigForm(f => ({ ...f, ambiente: 'produccion' }))}
                  className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${configForm.ambiente === 'produccion' ? 'bg-red-50 border-red-400 text-red-800 ring-1 ring-red-400' : 'border-gray-300 text-gray-500 hover:bg-gray-50'}`}>
                  Producción
                  <span className="block text-[11px] font-normal">Documentos fiscales reales</span>
                </button>
              </div>
              {configForm.ambiente === 'produccion' && (
                <p className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  En producción cada documento timbrado genera un CUFE real ante la DGI. Verifica las credenciales antes de guardar.
                </p>
              )}
            </div>

            {/* Credenciales de pruebas */}
            <fieldset className={`rounded-lg border p-3 space-y-3 ${configForm.ambiente === 'pruebas' ? 'border-amber-300 bg-amber-50/40' : 'border-gray-200'}`}>
              <legend className="text-xs font-semibold text-amber-700 px-1">Credenciales de PRUEBAS</legend>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">PIN</label>
                  <input value={configForm.pin} onChange={e => setConfigForm(f => ({ ...f, pin: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Usuario</label>
                  <input value={configForm.usuario} onChange={e => setConfigForm(f => ({ ...f, usuario: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Clave</label>
                  <input type="password" value={configForm.clave} onChange={e => setConfigForm(f => ({ ...f, clave: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div className="col-span-3">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Endpoint (pruebas)</label>
                  <input value={configForm.endpoint_url} onChange={e => setConfigForm(f => ({ ...f, endpoint_url: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-xs" />
                </div>
              </div>
            </fieldset>

            {/* Credenciales de producción */}
            <fieldset className={`rounded-lg border p-3 space-y-3 ${configForm.ambiente === 'produccion' ? 'border-red-300 bg-red-50/40' : 'border-gray-200'}`}>
              <legend className="text-xs font-semibold text-red-700 px-1">Credenciales de PRODUCCIÓN</legend>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">PIN</label>
                  <input value={configForm.pin_prod} onChange={e => setConfigForm(f => ({ ...f, pin_prod: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Usuario</label>
                  <input value={configForm.usuario_prod} onChange={e => setConfigForm(f => ({ ...f, usuario_prod: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Clave</label>
                  <input type="password" value={configForm.clave_prod} onChange={e => setConfigForm(f => ({ ...f, clave_prod: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div className="col-span-3">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Endpoint (producción)</label>
                  <input value={configForm.endpoint_url_prod} onChange={e => setConfigForm(f => ({ ...f, endpoint_url_prod: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-xs" />
                </div>
              </div>
            </fieldset>

            {/* Comunes */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Código de sucursal</label>
                <input value={configForm.codigo_sucursal} onChange={e => setConfigForm(f => ({ ...f, codigo_sucursal: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Punto de facturación (terminal)</label>
                <input value={configForm.nro_terminal} onChange={e => setConfigForm(f => ({ ...f, nro_terminal: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            {/* Emisor (CAFE) */}
            <fieldset className="rounded-lg border border-gray-200 p-3 space-y-3">
              <legend className="text-xs font-semibold text-gray-600 px-1">Datos del emisor (comprobante PDF)</legend>
              <p className="text-xs text-gray-500">Se imprimen en el Comprobante Auxiliar de Factura Electrónica. Deben coincidir con los registrados ante la DGI.</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-3">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Razón social</label>
                  <input value={configForm.emisor_nombre} onChange={e => setConfigForm(f => ({ ...f, emisor_nombre: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">RUC</label>
                  <input value={configForm.emisor_ruc} onChange={e => setConfigForm(f => ({ ...f, emisor_ruc: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">DV</label>
                  <input value={configForm.emisor_dv} onChange={e => setConfigForm(f => ({ ...f, emisor_dv: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" />
                </div>
                <div className="col-span-3">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Dirección</label>
                  <input value={configForm.emisor_direccion} onChange={e => setConfigForm(f => ({ ...f, emisor_direccion: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
            </fieldset>

            {/* Venta a crédito */}
            <fieldset className="rounded-lg border border-gray-200 p-3 space-y-3">
              <legend className="text-xs font-semibold text-gray-600 px-1">Venta a crédito</legend>
              <p className="text-xs text-gray-500">
                Cuando una factura se marca como &ldquo;Venta a crédito&rdquo;, el sistema envía al PAC esta forma de pago
                en lugar de la que se elige a mano. El código 01 es el que la DGI imprime como &ldquo;Crédito&rdquo;
                (verificado en ambiente de pruebas). Sólo cámbialo si el PAC informa otro código.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Código de forma de pago</label>
                  <input value={configForm.fp_credito_codigo} onChange={e => setConfigForm(f => ({ ...f, fp_credito_codigo: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Nombre que se envía</label>
                  <input value={configForm.fp_credito_nombre} onChange={e => setConfigForm(f => ({ ...f, fp_credito_nombre: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
            </fieldset>

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={configForm.activo} onChange={e => setConfigForm(f => ({ ...f, activo: e.target.checked }))}
                className="rounded border-gray-300" />
              Integración activa (permite timbrar)
            </label>
            <button onClick={saveConfig} disabled={savingConfig}
              className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
              {savingConfig ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Guardar configuración
            </button>
          </div>
        )}
      </div>

      {/* Modal detalle documento */}
      {detalle && (() => {
        const cobro = cobroInfo(detalle)
        const esNC = ['04', '06'].includes(detalle.tipo_doc)
        const filas = detalleLineas.map(l => ({ l, ...calcLinea(l) }))
        const ret = FE_RETENCIONES.find(r => r.codigo === detalle.codigo_retencion)
        const Row = ({ k, v, mono = false }: { k: string; v: ReactNode; mono?: boolean }) => (
          <div className="flex justify-between gap-4 py-1 border-b border-gray-50 last:border-0">
            <span className="text-gray-500 flex-shrink-0">{k}</span>
            <span className={`text-right text-gray-900 ${mono ? 'font-mono text-xs break-all' : ''}`}>{v}</span>
          </div>
        )
        return (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 print:hidden" onClick={() => setDetalle(null)}>
            <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <div>
                  <h3 className="font-semibold text-gray-900">{esNC ? 'Nota de crédito' : 'Factura'} electrónica #{detalle.documento}</h3>
                  <p className="text-xs text-gray-500">{FE_TIPO_DOC.find(t => t.codigo === detalle.tipo_doc)?.nombre} · {formatDate(detalle.fecha)}</p>
                </div>
                <div className="flex items-center gap-2">
                  {detalle.cufe && (
                    <button onClick={() => { setDetalle(null); abrirCafe(detalle) }}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 px-3 py-1.5 rounded-lg">
                      <FileText size={15} /> Comprobante PDF
                    </button>
                  )}
                  <button onClick={() => setDetalle(null)} className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
                </div>
              </div>

              <div className="overflow-y-auto p-5 space-y-5 text-sm">
                {detalle.ambiente === 'pruebas' && (
                  <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs">
                    Timbrado en ambiente de PRUEBAS: no está registrado en cobros y no aparece en ningún reporte.
                  </p>
                )}

                {/* Estado / cobro */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="rounded-lg bg-gray-50 p-3">
                    <p className="text-[11px] uppercase text-gray-500">Estado FE</p>
                    <span className={`badge capitalize mt-1 ${ESTADO_BADGE[detalle.estado] || ''}`}>{detalle.estado}</span>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-3">
                    <p className="text-[11px] uppercase text-gray-500">Estado de cobro</p>
                    {cobro ? <span className={`badge mt-1 ${cobro.badge.cls}`}>{cobro.badge.txt}</span> : <p className="text-gray-400 mt-1">No está en cobros</p>}
                  </div>
                  <div className="rounded-lg bg-gray-50 p-3">
                    <p className="text-[11px] uppercase text-gray-500">Pagado</p>
                    <p className="font-semibold text-green-700 mt-1">{cobro ? formatCurrency(cobro.pagado) : '—'}</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-3">
                    <p className="text-[11px] uppercase text-gray-500">Saldo</p>
                    <p className="font-semibold text-orange-600 mt-1">{cobro ? formatCurrency(cobro.f.estado === 'pagada' ? 0 : cobro.saldo) : '—'}</p>
                    {cobro?.f.fecha_pago && <p className="text-[11px] text-gray-500">Vence {formatDate(cobro.f.fecha_pago)}{cobro.tramo ? ` · ${cobro.tramo}` : ''}</p>}
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-5">
                  {/* Cliente */}
                  <div>
                    <h4 className="text-xs font-semibold uppercase text-gray-500 mb-2">Receptor</h4>
                    <Row k="Cliente" v={detalle.nombre_cliente} />
                    <Row k="Tipo de receptor" v={FE_TIPO_CLIENTE.find(c => c.codigo === detalle.tipo_cliente)?.nombre || detalle.tipo_cliente} />
                    <Row k="Contribuyente" v={FE_TIPO_CONTRIBUYENTE.find(c => c.codigo === detalle.tipo_contribuyente)?.nombre || detalle.tipo_contribuyente} />
                    {detalle.ruc && <Row k="RUC / DV" v={`${detalle.ruc} · DV ${detalle.dv || '—'}`} mono />}
                    <Row k="Dirección" v={detalle.direccion_cliente} />
                    {detalle.email_cliente && <Row k="Email" v={detalle.email_cliente} />}
                  </div>
                  {/* Documento */}
                  <div>
                    <h4 className="text-xs font-semibold uppercase text-gray-500 mb-2">Documento</h4>
                    <Row k="Número" v={`#${detalle.documento}`} />
                    <Row k="Fecha de emisión" v={formatDate(detalle.fecha)} />
                    <Row k="Condición" v={detalle.es_credito ? <span className="font-medium text-brand-700">Venta a crédito</span> : 'Contado'} />
                    <Row k="Ambiente" v={detalle.ambiente ? (detalle.ambiente === 'produccion' ? 'Producción' : 'Pruebas') : '—'} />
                    {detalle.fecha_cufe && <Row k="Fecha de autorización" v={detalle.fecha_cufe} />}
                    {cobro && <Row k="Factura en cobros" v={<Link href={`/facturas?search=${cobro.f.numero_factura}`} className="text-brand-600 underline">#{cobro.f.numero_factura}</Link>} />}
                    {esNC && detalle.cufe_devol && <Row k="CUFE afectado" v={detalle.cufe_devol} mono />}
                    {esNC && detalle.fecha_cufe_devol && <Row k="Fecha doc. afectado" v={detalle.fecha_cufe_devol} />}
                  </div>
                </div>

                {/* Líneas */}
                <div>
                  <h4 className="text-xs font-semibold uppercase text-gray-500 mb-2">Detalle</h4>
                  <div className="border border-gray-200 rounded-lg overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 text-gray-500">
                        <tr>
                          <th className="px-2 py-1.5 text-left">#</th>
                          <th className="px-2 py-1.5 text-left">Código</th>
                          <th className="px-2 py-1.5 text-left">Descripción</th>
                          <th className="px-2 py-1.5 text-right">Cant.</th>
                          <th className="px-2 py-1.5 text-left">Und.</th>
                          <th className="px-2 py-1.5 text-right">P. unit.</th>
                          <th className="px-2 py-1.5 text-right">Monto</th>
                          <th className="px-2 py-1.5 text-right">ITBMS</th>
                          <th className="px-2 py-1.5 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {detalleLoading ? (
                          <tr><td colSpan={9} className="px-2 py-4 text-center text-gray-400">Cargando...</td></tr>
                        ) : filas.length === 0 ? (
                          <tr><td colSpan={9} className="px-2 py-4 text-center text-gray-400">Sin líneas</td></tr>
                        ) : filas.map((f, i) => (
                          <tr key={f.l.id || i}>
                            <td className="px-2 py-1.5 text-gray-400">{i + 1}</td>
                            <td className="px-2 py-1.5 font-mono">{f.l.codigo_articulo}</td>
                            <td className="px-2 py-1.5">{f.l.nombre_articulo}<span className="block text-[10px] text-gray-400">CPBS {f.l.grupo_inv}/{f.l.subgr_inv}</span></td>
                            <td className="px-2 py-1.5 text-right">{Number(f.l.cantidad).toLocaleString('es-PA', { maximumFractionDigits: 3 })}</td>
                            <td className="px-2 py-1.5">{f.l.unidad}</td>
                            <td className="px-2 py-1.5 text-right">{formatCurrency(Number(f.l.precioneto))}</td>
                            <td className="px-2 py-1.5 text-right">{formatCurrency(f.monto)}</td>
                            <td className="px-2 py-1.5 text-right">{formatCurrency(f.itbms)} <span className="text-gray-400">({f.l.prc_impuesto}%)</span></td>
                            <td className="px-2 py-1.5 text-right font-medium">{formatCurrency(f.valorItem)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-5">
                  {/* Pagos */}
                  <div>
                    <h4 className="text-xs font-semibold uppercase text-gray-500 mb-2">Forma de pago</h4>
                    {detalle.es_credito ? (
                      <Row k="Crédito" v={formatCurrency(detalle.totalfinal)} />
                    ) : detallePagos.length === 0 ? (
                      <p className="text-gray-400">—</p>
                    ) : detallePagos.map((pg, i) => (
                      <Row key={pg.id || i} k={FE_FORMAS_PAGO.find(f => f.codigo === pg.codigo)?.nombre || pg.nombre} v={formatCurrency(Number(pg.monto))} />
                    ))}
                    {Number(detalle.retencion) > 0 && (
                      <Row k={`Retención ITBMS ${detalle.prc_retencion}%${ret ? ` (${ret.codigo})` : ''}`} v={formatCurrency(Number(detalle.retencion))} />
                    )}
                  </div>
                  {/* Totales */}
                  <div>
                    <h4 className="text-xs font-semibold uppercase text-gray-500 mb-2">Totales</h4>
                    <Row k="Neto" v={formatCurrency(detalle.totneto)} />
                    <Row k="ITBMS" v={formatCurrency(detalle.totimpuest)} />
                    <Row k="Total" v={<strong>{formatCurrency(detalle.totalfinal)}</strong>} />
                  </div>
                </div>

                {/* DGI */}
                <div>
                  <h4 className="text-xs font-semibold uppercase text-gray-500 mb-2">Autorización DGI</h4>
                  {detalle.cufe ? (
                    <>
                      <Row k="CUFE" v={<span className="inline-flex items-center gap-1">{detalle.cufe}<button onClick={() => copiarCufe(detalle.cufe!)} className="text-gray-400 hover:text-brand-600" title="Copiar"><Copy size={12} /></button></span>} mono />
                      {detalle.url_dgi && <Row k="Consulta" v={<a href={detalle.url_dgi} target="_blank" rel="noopener noreferrer" className="text-brand-600 underline">Ver en la DGI</a>} />}
                    </>
                  ) : <p className="text-gray-400">Documento sin timbrar.</p>}
                  {detalle.respuesta_pac && (
                    <details className="mt-2">
                      <summary className="text-xs text-gray-500 cursor-pointer">Respuesta del PAC</summary>
                      <pre className="mt-1 bg-gray-50 border border-gray-200 rounded-lg p-2 text-xs whitespace-pre-wrap break-all">{detalle.respuesta_pac}</pre>
                    </details>
                  )}
                </div>
                {detalle.notas && <p className="text-xs text-gray-600"><span className="text-gray-500">Notas:</span> {detalle.notas}</p>}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Comprobante Auxiliar (CAFE): vista previa + impresión/PDF */}
      {cafe && typeof document !== 'undefined' && createPortal(
        <div id="cafe-print" className="hidden print:block">
          <ComprobanteFE doc={cafe.doc} emisor={emisor} lineas={cafe.lineas} pagos={cafe.pagos} />
        </div>,
        document.body,
      )}
      {cafe && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 print:hidden" onClick={() => setCafe(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-base font-semibold">Comprobante Auxiliar de Factura Electrónica</h2>
                <p className="text-xs text-gray-500">#{cafe.doc.documento} · {cafe.doc.nombre_cliente} · en el diálogo elige &ldquo;Guardar como PDF&rdquo;</p>
              </div>
              <button onClick={() => setCafe(null)} className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto p-6 bg-gray-100">
              <div className="bg-white shadow p-8 mx-auto" style={{ width: '215.9mm', maxWidth: '100%' }}>
                <ComprobanteFE doc={cafe.doc} emisor={emisor} lineas={cafe.lineas} pagos={cafe.pagos} preview />
              </div>
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-gray-100">
              <button className="btn-secondary flex-1" onClick={() => setCafe(null)}>Cerrar</button>
              <button className="btn-primary flex-1 flex items-center justify-center gap-2" onClick={imprimirCafe}>
                <Printer size={16} /> Imprimir / Guardar PDF
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @media print {
          /* display:none colapsa el layout (visibility dejaba páginas en blanco) */
          body > :not(#cafe-print) { display: none !important; }
          #cafe-print { display: block !important; width: 100%; }
          @page { size: letter; margin: 12mm; }
        }
      `}</style>

      {/* Modal artículo */}
      {showArtForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowArtForm(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">{artForm.id ? 'Editar artículo' : 'Nuevo artículo'}</h3>
              <button onClick={() => setShowArtForm(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Código *</label>
                <input value={artForm.codigo} onChange={e => setArtForm(f => ({ ...f, codigo: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Precio</label>
                <input type="number" step="0.01" value={artForm.precio} onChange={e => setArtForm(f => ({ ...f, precio: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Nombre / descripción *</label>
                <input value={artForm.nombre} onChange={e => setArtForm(f => ({ ...f, nombre: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">% ITBMS</label>
                <select value={artForm.prc_impuesto} onChange={e => setArtForm(f => ({ ...f, prc_impuesto: Number(e.target.value) }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  {FE_ITBMS.map(i => <option key={i.pct} value={i.pct}>{i.nombre}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Unidad</label>
                <select value={artForm.unidad} onChange={e => setArtForm(f => ({ ...f, unidad: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  {FE_UNIDADES.map(u => <option key={u.codigo} value={u.codigo}>{u.nombre} ({u.codigo})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Grupo CPBS</label>
                <select value={artForm.grupo_inv} onChange={e => setArtForm(f => ({ ...f, grupo_inv: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  {FE_CPBS_GRUPOS.map(g => <option key={g.codigo} value={g.codigo}>{g.codigo} — {g.nombre}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Subgrupo CPBS (código completo)</label>
                <input value={artForm.subgr_inv} onChange={e => setArtForm(f => ({ ...f, subgr_inv: e.target.value }))}
                  placeholder="ej. 8212" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowArtForm(false)} className="text-sm text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-100">Cancelar</button>
              <button onClick={saveArticulo} disabled={savingArt}
                className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
                {savingArt ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast {...toast} onClose={hideToast} />}
    </AppLayout>
  )
}

export default withPagePermission(FacturaElectronicaPage, 'factura_electronica')
