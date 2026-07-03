'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { createClient } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { FeDocumento, FeArticulo, FeConfig } from '@/types'
import { Plus, Search, X, Pencil, Trash2, Copy, QrCode, AlertCircle, CheckCircle, Loader2, Save } from 'lucide-react'
import { Toast } from '@/components/Toast'
import { useToast } from '@/hooks/useToast'
import PermissionGuard, { withPagePermission } from '@/components/PermissionGuard'
import { useAuth } from '@/context/AuthContext'
import { FE_TIPO_DOC, FE_ITBMS, FE_UNIDADES, FE_CPBS_GRUPOS } from '@/lib/fe-catalogos'

type Tab = 'documentos' | 'articulos' | 'config'
type EstadoFilter = 'todos' | 'borrador' | 'aceptado' | 'rechazado'

const ESTADO_BADGE: Record<string, string> = {
  borrador: 'bg-gray-100 text-gray-600',
  enviando: 'bg-blue-100 text-blue-700',
  aceptado: 'bg-green-100 text-green-700',
  rechazado: 'bg-red-100 text-red-700',
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
  const [detalle, setDetalle] = useState<FeDocumento | null>(null)

  // artículos
  const [showArtForm, setShowArtForm] = useState(false)
  const [artForm, setArtForm] = useState(emptyArticulo())
  const [savingArt, setSavingArt] = useState(false)

  // config
  const [configForm, setConfigForm] = useState({
    pin: '', usuario: '', clave: '', codigo_sucursal: '001', nro_terminal: '1',
    endpoint_url: '', activo: false,
  })
  const [savingConfig, setSavingConfig] = useState(false)

  const { toast, showToast, hideToast } = useToast()
  const { profile } = useAuth()
  const esAdmin = profile?.rol_id === 'admin'
  const supabase = createClient()

  const loadData = useCallback(async () => {
    setLoading(true)
    const [{ data: docsData }, { data: artData }] = await Promise.all([
      supabase.from('fe_documentos').select('*').order('created_at', { ascending: false }),
      supabase.from('fe_articulos').select('*').order('codigo'),
    ])
    setDocs((docsData || []) as FeDocumento[])
    setArticulos((artData || []) as FeArticulo[])
    if (esAdmin) {
      const { data: cfg } = await supabase.from('fe_config').select('*').eq('id', true).single()
      if (cfg) {
        setConfig(cfg as FeConfig)
        setConfigForm({
          pin: cfg.pin || '', usuario: cfg.usuario || '', clave: cfg.clave || '',
          codigo_sucursal: cfg.codigo_sucursal || '001', nro_terminal: cfg.nro_terminal || '1',
          endpoint_url: cfg.endpoint_url || '', activo: cfg.activo,
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
      pin: configForm.pin.trim() || null,
      usuario: configForm.usuario.trim() || null,
      clave: configForm.clave.trim() || null,
      codigo_sucursal: configForm.codigo_sucursal.trim() || '001',
      nro_terminal: configForm.nro_terminal.trim() || '1',
      endpoint_url: configForm.endpoint_url.trim(),
      activo: configForm.activo,
    }).eq('id', true)
    setSavingConfig(false)
    if (error) { showToast(`No se pudo guardar: ${error.message}`, 'error'); return }
    showToast('Configuración guardada', 'success')
    loadData()
  }

  const pacListo = config?.activo && config?.pin

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
                    <th className="px-4 py-3">Documento</th>
                    <th className="px-4 py-3">Tipo</th>
                    <th className="px-4 py-3">Fecha</th>
                    <th className="px-4 py-3">Cliente</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3">CUFE</th>
                    <th className="px-4 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">Cargando...</td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">No hay documentos electrónicos.</td></tr>
                  ) : filtered.map(d => {
                    const tipoNombre = FE_TIPO_DOC.find(t => t.codigo === d.tipo_doc)?.nombre || d.tipo_doc
                    const esNC = ['04', '06'].includes(d.tipo_doc)
                    return (
                      <tr key={d.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">{d.documento}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${esNC ? 'bg-purple-100 text-purple-700' : 'bg-blue-50 text-blue-700'}`} title={tipoNombre}>
                            {esNC ? 'NC' : 'FE'} {d.tipo_doc}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{formatDate(d.fecha)}</td>
                        <td className="px-4 py-3 text-gray-700 max-w-[220px] truncate">{d.nombre_cliente}</td>
                        <td className="px-4 py-3 text-right font-medium">{formatCurrency(d.totalfinal)}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${ESTADO_BADGE[d.estado] || ''}`}>{d.estado}</span>
                        </td>
                        <td className="px-4 py-3">
                          {d.cufe ? (
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-gray-500 font-mono">{d.cufe.slice(0, 12)}…</span>
                              <button onClick={() => copiarCufe(d.cufe!)} className="text-gray-400 hover:text-brand-600" title="Copiar CUFE"><Copy size={13} /></button>
                              {d.url_dgi && (
                                <a href={d.url_dgi} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-brand-600" title="Ver en DGI"><QrCode size={13} /></a>
                              )}
                            </div>
                          ) : <span className="text-xs text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <button onClick={() => setDetalle(d)} className="text-gray-400 hover:text-gray-700 p-1" title="Ver detalle / respuesta PAC">
                              <Search size={15} />
                            </button>
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">PIN (licencia CFE)</label>
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
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Endpoint</label>
                <input value={configForm.endpoint_url} onChange={e => setConfigForm(f => ({ ...f, endpoint_url: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-xs" />
              </div>
            </div>
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
      {detalle && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setDetalle(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-5 space-y-3 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Documento {detalle.documento}</h3>
              <button onClick={() => setDetalle(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="text-sm space-y-1.5">
              <p><span className="text-gray-500">Tipo:</span> {FE_TIPO_DOC.find(t => t.codigo === detalle.tipo_doc)?.nombre}</p>
              <p><span className="text-gray-500">Cliente:</span> {detalle.nombre_cliente} {detalle.ruc ? `(RUC ${detalle.ruc} DV ${detalle.dv})` : ''}</p>
              <p><span className="text-gray-500">Neto:</span> {formatCurrency(detalle.totneto)} · <span className="text-gray-500">ITBMS:</span> {formatCurrency(detalle.totimpuest)} · <span className="text-gray-500">Total:</span> <strong>{formatCurrency(detalle.totalfinal)}</strong></p>
              {detalle.cufe && <p className="break-all"><span className="text-gray-500">CUFE:</span> <span className="font-mono text-xs">{detalle.cufe}</span></p>}
              {detalle.url_dgi && <p><a href={detalle.url_dgi} target="_blank" rel="noopener noreferrer" className="text-brand-600 underline text-xs">Consultar en DGI</a></p>}
              {detalle.respuesta_pac && (
                <div>
                  <p className="text-gray-500 mb-1">Respuesta del PAC:</p>
                  <pre className="bg-gray-50 border border-gray-200 rounded-lg p-2 text-xs whitespace-pre-wrap break-all">{detalle.respuesta_pac}</pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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
