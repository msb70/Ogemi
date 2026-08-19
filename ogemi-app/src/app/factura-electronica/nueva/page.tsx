'use client'

import { useEffect, useState, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { createClient } from '@/lib/supabase'
import { formatCurrency, formatDateObj } from '@/lib/utils'
import { Cliente, FeArticulo, FeDocumento } from '@/types'
import { Plus, Trash2, Loader2, Save, CheckCircle, AlertCircle } from 'lucide-react'
import { Toast } from '@/components/Toast'
import { useToast } from '@/hooks/useToast'
import { withPagePermission } from '@/components/PermissionGuard'
import {
  FE_TIPO_DOC, FE_TIPO_CLIENTE, FE_TIPO_CONTRIBUYENTE, FE_ITBMS,
  FE_UNIDADES, FE_CPBS_GRUPOS, FE_FORMAS_PAGO, FE_FORMAS_PAGO_MANUAL, FE_RETENCIONES,
} from '@/lib/fe-catalogos'

interface LineaForm {
  articulo_id: string | null
  codigo_articulo: string
  nombre_articulo: string
  precioneto: string
  prc_impuesto: number
  cantidad: string
  unidad: string
  grupo_inv: string
  subgr_inv: string
}

interface PagoForm { codigo: string; nombre: string; monto: string }

const nuevaLinea = (): LineaForm => ({
  articulo_id: null, codigo_articulo: '', nombre_articulo: '', precioneto: '',
  prc_impuesto: 7, cantidad: '1', unidad: 'und', grupo_inv: '82', subgr_inv: '8212',
})

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

function NuevaFEForm() {
  const router = useRouter()
  const params = useSearchParams()
  const editId = params.get('id')

  const [clientes, setClientes] = useState<Cliente[]>([])
  const [articulos, setArticulos] = useState<FeArticulo[]>([])
  const [feAceptadas, setFeAceptadas] = useState<FeDocumento[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [timbrando, setTimbrando] = useState(false)

  const [tipoDoc, setTipoDoc] = useState('01')
  const [documento, setDocumento] = useState('')
  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0])
  const [clienteId, setClienteId] = useState('')
  const [fiscal, setFiscal] = useState({
    tipo_contribuyente: 2, tipo_cliente: '01', ruc: '', dv: '', direccion: '', email: '',
  })
  const [lineas, setLineas] = useState<LineaForm[]>([nuevaLinea()])
  const [pagos, setPagos] = useState<PagoForm[]>([{ codigo: '02', nombre: 'EFECTIVO', monto: '' }])
  const [esCredito, setEsCredito] = useState(false)
  const [retencion, setRetencion] = useState({ codigo: '', pct: '', monto: '' })
  const [referencia, setReferencia] = useState({ fe_id: '', cufe: '', fecha: '' })
  const [notas, setNotas] = useState('')

  const [ambienteActivo, setAmbienteActivo] = useState<'pruebas' | 'produccion' | null>(null)
  const { toast, showToast, hideToast } = useToast()
  const supabase = createClient()

  const esNCRef = tipoDoc === '04'
  const esNC = ['04', '06'].includes(tipoDoc)

  // Venta a crédito: la forma de pago la define Configuración (código del PAC) y
  // el vencimiento sale de los días de crédito del cliente. No aplica a notas de crédito.
  const clienteSel = clientes.find(c => c.id === clienteId)
  const diasCredito = clienteSel?.dias_credito ?? 30
  const creditoActivo = esCredito && !esNC
  const fechaVence = (() => {
    const d = new Date(`${fecha}T00:00:00`)
    d.setDate(d.getDate() + diasCredito)
    return formatDateObj(d)
  })()

  // Totales calculados desde las líneas
  const totNeto = round2(lineas.reduce((s, l) => s + (parseFloat(l.precioneto) || 0) * (parseFloat(l.cantidad) || 0), 0))
  const totImpuesto = round2(lineas.reduce((s, l) => s + (parseFloat(l.precioneto) || 0) * (parseFloat(l.cantidad) || 0) * l.prc_impuesto / 100, 0))
  const totalFinal = round2(totNeto + totImpuesto)
  const totalPagos = round2(pagos.reduce((s, p) => s + (parseFloat(p.monto) || 0), 0))

  const loadData = useCallback(async () => {
    setLoading(true)
    const [{ data: cli }, { data: art }, { data: fes }, { data: maxFact }] = await Promise.all([
      supabase.from('clientes').select('*').eq('activo', true).order('nombre'),
      supabase.from('fe_articulos').select('*').eq('activo', true).order('codigo'),
      supabase.from('fe_documentos').select('*').eq('estado', 'aceptado').in('tipo_doc', ['01', '02', '03', '08', '10']).order('fecha', { ascending: false }).limit(200),
      supabase.from('facturas').select('numero_factura').order('numero_factura', { ascending: false }).limit(1),
    ])
    setClientes((cli || []) as Cliente[])
    setArticulos((art || []) as FeArticulo[])
    setFeAceptadas((fes || []) as FeDocumento[])
    const { data: amb } = await supabase.rpc('fe_ambiente_activo')
    setAmbienteActivo(amb === 'produccion' ? 'produccion' : amb ? 'pruebas' : null)

    if (editId) {
      const { data: doc } = await supabase
        .from('fe_documentos')
        .select('*, fe_documento_lineas(*), fe_documento_pagos(*)')
        .eq('id', editId).single()
      if (doc) {
        setTipoDoc(doc.tipo_doc)
        setDocumento(doc.documento)
        setFecha(doc.fecha)
        setClienteId(doc.cliente_id)
        setFiscal({
          tipo_contribuyente: doc.tipo_contribuyente, tipo_cliente: doc.tipo_cliente,
          ruc: doc.ruc || '', dv: doc.dv || '', direccion: doc.direccion_cliente || '', email: doc.email_cliente || '',
        })
        setLineas((doc.fe_documento_lineas || []).sort((a: any, b: any) => a.orden - b.orden).map((l: any) => ({
          articulo_id: l.articulo_id, codigo_articulo: l.codigo_articulo, nombre_articulo: l.nombre_articulo,
          precioneto: String(l.precioneto), prc_impuesto: Number(l.prc_impuesto), cantidad: String(l.cantidad),
          unidad: l.unidad, grupo_inv: l.grupo_inv, subgr_inv: l.subgr_inv,
        })))
        setEsCredito(!!doc.es_credito)
        const pagosDoc = (doc.fe_documento_pagos || []).map((p: any) => ({ codigo: p.codigo, nombre: p.nombre, monto: String(p.monto) }))
        if (pagosDoc.length > 0) setPagos(pagosDoc)
        setRetencion({ codigo: doc.codigo_retencion || '', pct: String(doc.prc_retencion || ''), monto: String(doc.retencion || '') })
        setReferencia({ fe_id: doc.fe_referencia_id || '', cufe: doc.cufe_devol || '', fecha: doc.fecha_cufe_devol || '' })
        setNotas(doc.notas || '')
      }
    } else {
      // Continuar la numeración actual del libro de ventas
      const next = (maxFact?.[0]?.numero_factura || 0) + 1
      setDocumento(String(next))
    }
    setLoading(false)
  }, [editId])

  useEffect(() => { loadData() }, [loadData])

  // Al elegir cliente, precargar datos fiscales y retención
  const onClienteChange = (id: string) => {
    setClienteId(id)
    const c = clientes.find(x => x.id === id)
    if (c) {
      setFiscal({
        tipo_contribuyente: c.tipo_contribuyente ?? 2,
        tipo_cliente: c.tipo_cliente ?? '01',
        ruc: c.ruc || '', dv: c.dv || '', direccion: c.direccion || '', email: c.email || '',
      })
      setEsCredito((c.dias_credito ?? 30) > 0)
      if ((c.retencion_pct || 0) > 0) {
        setRetencion({ codigo: '2', pct: String(c.retencion_pct), monto: '' })
      } else {
        setRetencion({ codigo: '', pct: '', monto: '' })
      }
    }
  }

  // Retención calculada sobre el ITBMS (regla actual del negocio)
  const retencionCalc = retencion.codigo
    ? round2(totImpuesto * (parseFloat(retencion.pct) || 0) / 100)
    : 0

  const setLinea = (i: number, patch: Partial<LineaForm>) =>
    setLineas(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l))

  const onArticuloChange = (i: number, artId: string) => {
    const a = articulos.find(x => x.id === artId)
    if (a) {
      setLinea(i, {
        articulo_id: a.id, codigo_articulo: a.codigo, nombre_articulo: a.nombre,
        precioneto: String(a.precio), prc_impuesto: a.prc_impuesto, unidad: a.unidad,
        grupo_inv: a.grupo_inv, subgr_inv: a.subgr_inv,
      })
    } else {
      setLinea(i, { articulo_id: null })
    }
  }

  const onReferenciaChange = (feId: string) => {
    const fe = feAceptadas.find(f => f.id === feId)
    setReferencia({
      fe_id: feId,
      cufe: fe?.cufe || '',
      fecha: fe?.fecha_cufe || '',
    })
    if (fe && !clienteId) onClienteChange(fe.cliente_id)
  }

  const validar = (): string | null => {
    if (!documento.trim()) return 'Indica el número de documento fiscal.'
    if (!clienteId) return 'Selecciona un cliente.'
    if (['01', '03'].includes(fiscal.tipo_cliente) && (!fiscal.ruc.trim() || !fiscal.dv.trim()))
      return 'RUC y DV son obligatorios para clientes contribuyente/gobierno.'
    if (!fiscal.direccion.trim()) return 'La dirección del cliente es obligatoria.'
    if (lineas.length === 0) return 'Agrega al menos una línea.'
    for (const [i, l] of lineas.entries()) {
      if (!l.codigo_articulo.trim() || !l.nombre_articulo.trim()) return `Línea ${i + 1}: código y descripción son obligatorios.`
      if ((parseFloat(l.precioneto) || 0) <= 0) return `Línea ${i + 1}: el precio debe ser mayor a 0.`
      if ((parseFloat(l.cantidad) || 0) <= 0) return `Línea ${i + 1}: la cantidad debe ser mayor a 0.`
      if (!/^\d{4,}$/.test(l.subgr_inv.trim())) return `Línea ${i + 1}: subgrupo CPBS inválido (mínimo 4 dígitos).`
      if (!l.subgr_inv.trim().startsWith(l.grupo_inv)) return `Línea ${i + 1}: el subgrupo CPBS debe comenzar con el grupo ${l.grupo_inv}.`
    }
    if (esNCRef && !referencia.cufe.trim()) return 'La NC referenciada (tipo 04) requiere el CUFE del documento afectado.'
    if (esNCRef && !referencia.fecha.trim()) return 'La NC referenciada (tipo 04) requiere la fecha del CUFE afectado.'
    if (!creditoActivo && Math.abs(totalPagos - totalFinal) > 0.011) return `Las formas de pago (${formatCurrency(totalPagos)}) deben sumar el total (${formatCurrency(totalFinal)}). Usa "Cuadrar".`
    return null
  }

  const guardar = async (luegoTimbrar: boolean) => {
    const err = validar()
    if (err) { showToast(err, 'error'); return }
    setSaving(true)

    // Actualizar datos fiscales del cliente (master data)
    await supabase.from('clientes').update({
      ruc: fiscal.ruc.trim() || null, dv: fiscal.dv.trim() || null,
      tipo_contribuyente: fiscal.tipo_contribuyente, tipo_cliente: fiscal.tipo_cliente,
      direccion: fiscal.direccion.trim() || null, email: fiscal.email.trim() || null,
    }).eq('id', clienteId)

    const cliente = clientes.find(c => c.id === clienteId)
    const header = {
      tipo_doc: tipoDoc,
      documento: documento.trim(),
      fecha,
      cliente_id: clienteId,
      nombre_cliente: cliente?.nombre || '',
      tipo_contribuyente: fiscal.tipo_contribuyente,
      tipo_cliente: fiscal.tipo_cliente,
      ruc: fiscal.ruc.trim() || null,
      dv: fiscal.dv.trim() || null,
      direccion_cliente: fiscal.direccion.trim() || 'Panamá',
      email_cliente: fiscal.email.trim() || null,
      totneto: totNeto,
      totimpuest: totImpuesto,
      totalfinal: totalFinal,
      es_credito: creditoActivo,
      total_pagado: creditoActivo ? totalFinal : totalPagos,
      codigo_retencion: retencion.codigo || null,
      prc_retencion: parseFloat(retencion.pct) || 0,
      retencion: retencionCalc,
      cufe_devol: esNCRef ? referencia.cufe.trim() : null,
      fecha_cufe_devol: esNCRef ? referencia.fecha.trim() : null,
      fe_referencia_id: esNCRef && referencia.fe_id ? referencia.fe_id : null,
      notas: notas.trim() || null,
    }

    let docId = editId
    if (editId) {
      const { error } = await supabase.from('fe_documentos').update(header).eq('id', editId)
      if (error) { setSaving(false); showToast(`No se pudo guardar: ${error.message}`, 'error'); return }
      await supabase.from('fe_documento_lineas').delete().eq('documento_id', editId)
      await supabase.from('fe_documento_pagos').delete().eq('documento_id', editId)
    } else {
      const { data, error } = await supabase.from('fe_documentos').insert(header).select('id').single()
      if (error) { setSaving(false); showToast(`No se pudo guardar: ${error.message}`, 'error'); return }
      docId = data.id
    }

    const { error: lErr } = await supabase.from('fe_documento_lineas').insert(lineas.map((l, i) => ({
      documento_id: docId, orden: i + 1, articulo_id: l.articulo_id,
      codigo_articulo: l.codigo_articulo.trim(), nombre_articulo: l.nombre_articulo.trim(),
      precioneto: parseFloat(l.precioneto) || 0, prc_impuesto: l.prc_impuesto,
      cantidad: parseFloat(l.cantidad) || 1, unidad: l.unidad,
      grupo_inv: l.grupo_inv, subgr_inv: l.subgr_inv.trim(),
    })))
    // En venta a crédito la forma de pago la resuelve el servidor con el código
    // configurado en fe_config (fe_config sólo es legible por admin).
    const { error: pErr } = creditoActivo
      ? { error: null }
      : await supabase.from('fe_documento_pagos').insert(pagos.map(p => ({
          documento_id: docId, codigo: p.codigo,
          nombre: FE_FORMAS_PAGO.find(f => f.codigo === p.codigo)?.nombre || p.nombre,
          monto: parseFloat(p.monto) || 0,
        })))
    setSaving(false)
    if (lErr || pErr) { showToast(`Guardado con errores en detalle: ${(lErr || pErr)?.message}`, 'error'); return }

    if (!luegoTimbrar) {
      showToast('Borrador guardado', 'success')
      router.push('/factura-electronica')
      return
    }

    // Timbrar
    setTimbrando(true)
    try {
      const res = await fetch('/api/fe/timbrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documento_id: docId }),
      })
      const data = await res.json()
      if (data.ok) {
        showToast(`Documento aceptado por el PAC. ${data.integracion || ''}`, 'success')
        router.push('/factura-electronica')
      } else {
        showToast(data.error || data.mensaje || 'El PAC rechazó el documento. Quedó guardado como rechazado/borrador.', 'error')
      }
    } catch (e: any) {
      showToast(`Error al timbrar: ${e.message}`, 'error')
    }
    setTimbrando(false)
  }

  if (loading) {
    return (
      <AppLayout>
        <div className="flex-1 flex items-center justify-center py-20 text-sm text-gray-400">Cargando...</div>
      </AppLayout>
    )
  }

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <AppLayout>
      <Header
        title={editId ? `Editar documento ${documento}` : 'Nuevo documento electrónico'}
        subtitle={ambienteActivo === 'produccion'
          ? 'PRODUCCIÓN — los documentos timbrados tienen validez fiscal (DGI)'
          : ambienteActivo === 'pruebas'
            ? 'AMBIENTE DE PRUEBAS — timbrado contra DGI test, sin validez fiscal'
            : 'Factura electrónica / Nota de crédito electrónica — TheFactory Panamá'}
      />
      <div className="p-4 md:p-6 space-y-4 max-w-5xl">

        {/* Encabezado */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className={labelCls}>Tipo de documento *</label>
            <select value={tipoDoc} onChange={e => setTipoDoc(e.target.value)} className={inputCls}>
              {FE_TIPO_DOC.filter(t => ['01', '03', '04', '06', '08'].includes(t.codigo)).map(t => (
                <option key={t.codigo} value={t.codigo}>{t.codigo} — {t.nombre}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Número fiscal (documento) *</label>
            <input value={documento} onChange={e => setDocumento(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Fecha *</label>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Cliente *</label>
            <select value={clienteId} onChange={e => onClienteChange(e.target.value)} className={inputCls}>
              <option value="">Seleccionar...</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
        </div>

        {/* Referencia NC tipo 04 */}
        {esNCRef && (
          <div className="bg-purple-50 rounded-xl border border-purple-200 p-4 space-y-3">
            <p className="text-sm font-medium text-purple-800 flex items-center gap-2"><AlertCircle size={15} /> NC referenciada: requiere el CUFE del documento afectado</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>FE timbrada en este sistema</label>
                <select value={referencia.fe_id} onChange={e => onReferenciaChange(e.target.value)} className={inputCls}>
                  <option value="">Ingresar CUFE manualmente...</option>
                  {feAceptadas.filter(f => !clienteId || f.cliente_id === clienteId).map(f => (
                    <option key={f.id} value={f.id}>#{f.documento} — {f.nombre_cliente} ({formatCurrency(f.totalfinal)})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>CUFE del documento afectado *</label>
                <input value={referencia.cufe} onChange={e => setReferencia(r => ({ ...r, cufe: e.target.value }))} className={`${inputCls} font-mono text-xs`} />
              </div>
              <div>
                <label className={labelCls}>Fecha del CUFE *</label>
                <input value={referencia.fecha} onChange={e => setReferencia(r => ({ ...r, fecha: e.target.value }))}
                  placeholder="2026-07-03T08:00:00-05:00" className={`${inputCls} font-mono text-xs`} />
              </div>
            </div>
          </div>
        )}

        {/* Datos fiscales del cliente */}
        {clienteId && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <p className="text-sm font-medium text-gray-700">Datos fiscales del cliente <span className="text-xs font-normal text-gray-400">(se actualizan en la ficha del cliente al guardar)</span></p>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              <div>
                <label className={labelCls}>Tipo contribuyente</label>
                <select value={fiscal.tipo_contribuyente} onChange={e => setFiscal(f => ({ ...f, tipo_contribuyente: Number(e.target.value) }))} className={inputCls}>
                  {FE_TIPO_CONTRIBUYENTE.map(t => <option key={t.codigo} value={t.codigo}>{t.nombre}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Tipo cliente</label>
                <select value={fiscal.tipo_cliente} onChange={e => setFiscal(f => ({ ...f, tipo_cliente: e.target.value }))} className={inputCls}>
                  {FE_TIPO_CLIENTE.map(t => <option key={t.codigo} value={t.codigo}>{t.nombre}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>RUC {['01', '03'].includes(fiscal.tipo_cliente) ? '*' : ''}</label>
                <input value={fiscal.ruc} onChange={e => setFiscal(f => ({ ...f, ruc: e.target.value }))} placeholder="1654682-1-676378" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>DV {['01', '03'].includes(fiscal.tipo_cliente) ? '*' : ''}</label>
                <input value={fiscal.dv} onChange={e => setFiscal(f => ({ ...f, dv: e.target.value }))} placeholder="61" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Dirección *</label>
                <input value={fiscal.direccion} onChange={e => setFiscal(f => ({ ...f, direccion: e.target.value }))} placeholder="Panamá" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Email (notificación)</label>
                <input type="email" value={fiscal.email} onChange={e => setFiscal(f => ({ ...f, email: e.target.value }))} className={inputCls} />
              </div>
            </div>
          </div>
        )}

        {/* Líneas de detalle */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-700">Detalle (líneas del documento)</p>
            <button onClick={() => setLineas(ls => [...ls, nuevaLinea()])}
              className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:bg-brand-50 px-2 py-1 rounded-md">
              <Plus size={14} /> Agregar línea
            </button>
          </div>
          <div className="space-y-3">
            {lineas.map((l, i) => (
              <div key={i} className="border border-gray-100 rounded-lg p-3 bg-gray-50/50 space-y-2">
                <div className="grid grid-cols-2 md:grid-cols-12 gap-2 items-end">
                  <div className="md:col-span-3">
                    <label className={labelCls}>Artículo del catálogo</label>
                    <select value={l.articulo_id || ''} onChange={e => onArticuloChange(i, e.target.value)} className={inputCls}>
                      <option value="">— Línea libre —</option>
                      {articulos.map(a => <option key={a.id} value={a.id}>{a.codigo} — {a.nombre}</option>)}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className={labelCls}>Código *</label>
                    <input value={l.codigo_articulo} onChange={e => setLinea(i, { codigo_articulo: e.target.value })} className={inputCls} />
                  </div>
                  <div className="md:col-span-4">
                    <label className={labelCls}>Descripción *</label>
                    <input value={l.nombre_articulo} onChange={e => setLinea(i, { nombre_articulo: e.target.value })} className={inputCls} />
                  </div>
                  <div className="md:col-span-1">
                    <label className={labelCls}>Cant. *</label>
                    <input type="number" step="0.01" min="0" value={l.cantidad} onChange={e => setLinea(i, { cantidad: e.target.value })} className={inputCls} />
                  </div>
                  <div className="md:col-span-2">
                    <label className={labelCls}>Precio neto *</label>
                    <input type="number" step="0.01" min="0" value={l.precioneto} onChange={e => setLinea(i, { precioneto: e.target.value })} className={inputCls} />
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-12 gap-2 items-end">
                  <div className="md:col-span-2">
                    <label className={labelCls}>% ITBMS</label>
                    <select value={l.prc_impuesto} onChange={e => setLinea(i, { prc_impuesto: Number(e.target.value) })} className={inputCls}>
                      {FE_ITBMS.map(t => <option key={t.pct} value={t.pct}>{t.nombre}</option>)}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className={labelCls}>Unidad</label>
                    <select value={l.unidad} onChange={e => setLinea(i, { unidad: e.target.value })} className={inputCls}>
                      {FE_UNIDADES.map(u => <option key={u.codigo} value={u.codigo}>{u.codigo}</option>)}
                    </select>
                  </div>
                  <div className="md:col-span-4">
                    <label className={labelCls}>Grupo CPBS</label>
                    <select value={l.grupo_inv} onChange={e => setLinea(i, { grupo_inv: e.target.value })} className={inputCls}>
                      {FE_CPBS_GRUPOS.map(g => <option key={g.codigo} value={g.codigo}>{g.codigo} — {g.nombre}</option>)}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className={labelCls}>Subgrupo CPBS</label>
                    <input value={l.subgr_inv} onChange={e => setLinea(i, { subgr_inv: e.target.value })} className={`${inputCls} font-mono`} />
                  </div>
                  <div className="md:col-span-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-gray-700 whitespace-nowrap">
                      {formatCurrency(round2((parseFloat(l.precioneto) || 0) * (parseFloat(l.cantidad) || 0) * (1 + l.prc_impuesto / 100)))}
                    </span>
                    {lineas.length > 1 && (
                      <button onClick={() => setLineas(ls => ls.filter((_, idx) => idx !== i))} className="text-gray-400 hover:text-red-600 p-1">
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Retención + Pagos + Totales */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <p className="text-sm font-medium text-gray-700">Retención (opcional)</p>
            <div>
              <label className={labelCls}>Código de retención</label>
              <select value={retencion.codigo} onChange={e => setRetencion(r => ({ ...r, codigo: e.target.value }))} className={inputCls}>
                <option value="">Sin retención</option>
                {FE_RETENCIONES.map(r => <option key={r.codigo} value={r.codigo}>{r.codigo} — {r.nombre}</option>)}
              </select>
            </div>
            {retencion.codigo && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>% sobre ITBMS</label>
                  <input type="number" step="0.01" value={retencion.pct} onChange={e => setRetencion(r => ({ ...r, pct: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Monto retenido</label>
                  <input disabled value={retencionCalc.toFixed(2)} className={`${inputCls} bg-gray-50`} />
                </div>
              </div>
            )}

            <div className="pt-2 space-y-2">
              <p className="text-sm font-medium text-gray-700">Formas de pago</p>
              {!esNC && (
                <label className={`flex items-start gap-2 rounded-lg border p-2.5 cursor-pointer transition-colors ${creditoActivo ? 'border-brand-400 bg-brand-50/60' : 'border-gray-200 hover:bg-gray-50'}`}>
                  <input type="checkbox" checked={creditoActivo} onChange={e => setEsCredito(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                  <span className="text-sm leading-snug">
                    <span className="font-medium text-gray-800">Venta a crédito</span>
                    <span className="block text-xs text-gray-500">
                      {creditoActivo
                        ? `${diasCredito} días de crédito · vence el ${fechaVence}. El sistema declara la forma de pago como crédito.`
                        : `El cliente tiene ${diasCredito} días de crédito. Marca la casilla si la factura no se cobra hoy.`}
                    </span>
                  </span>
                </label>
              )}
            </div>
            {!creditoActivo && (
              <>
              {pagos.map((p, i) => (
                <div key={i} className="flex gap-2 items-end">
                  <div className="flex-1">
                    <label className={labelCls}>Forma</label>
                    <select value={p.codigo} onChange={e => setPagos(ps => ps.map((x, idx) => idx === i ? { ...x, codigo: e.target.value, nombre: FE_FORMAS_PAGO.find(f => f.codigo === e.target.value)?.nombre || '' } : x))} className={inputCls}>
                      {FE_FORMAS_PAGO_MANUAL.map(f => <option key={f.codigo} value={f.codigo}>{f.codigo} — {f.nombre}</option>)}
                    </select>
                  </div>
                  <div className="w-32">
                    <label className={labelCls}>Monto</label>
                    <input type="number" step="0.01" value={p.monto} onChange={e => setPagos(ps => ps.map((x, idx) => idx === i ? { ...x, monto: e.target.value } : x))} className={inputCls} />
                  </div>
                  {pagos.length > 1 && (
                    <button onClick={() => setPagos(ps => ps.filter((_, idx) => idx !== i))} className="text-gray-400 hover:text-red-600 p-2"><Trash2 size={15} /></button>
                  )}
                </div>
              ))}
              <div className="flex gap-2">
                <button onClick={() => setPagos(ps => [...ps, { codigo: '02', nombre: 'EFECTIVO', monto: '' }])}
                  className="text-xs font-medium text-brand-700 hover:bg-brand-50 px-2 py-1 rounded-md inline-flex items-center gap-1"><Plus size={13} /> Otra forma</button>
                <button onClick={() => setPagos(ps => ps.map((p, i) => i === 0 ? { ...p, monto: String(round2(totalFinal - ps.slice(1).reduce((s, x) => s + (parseFloat(x.monto) || 0), 0))) } : p))}
                  className="text-xs font-medium text-gray-600 hover:bg-gray-100 px-2 py-1 rounded-md">Cuadrar con el total</button>
              </div>
              </>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
            <p className="text-sm font-medium text-gray-700">Totales</p>
            <div className="text-sm space-y-1.5">
              <div className="flex justify-between"><span className="text-gray-500">Total neto</span><span className="font-medium">{formatCurrency(totNeto)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">ITBMS</span><span className="font-medium">{formatCurrency(totImpuesto)}</span></div>
              {retencionCalc > 0 && (
                <div className="flex justify-between text-amber-700"><span>Retención ITBMS</span><span>-{formatCurrency(retencionCalc)}</span></div>
              )}
              <div className="flex justify-between text-base border-t border-gray-100 pt-2"><span className="font-semibold text-gray-800">Total final</span><span className="font-bold">{formatCurrency(totalFinal)}</span></div>
              {creditoActivo ? (
                <div className="flex justify-between text-xs text-brand-700">
                  <span>A crédito · vence</span><span>{fechaVence}</span>
                </div>
              ) : (
                <div className={`flex justify-between text-xs ${Math.abs(totalPagos - totalFinal) > 0.011 ? 'text-red-600' : 'text-green-600'}`}>
                  <span>Suma formas de pago</span><span>{formatCurrency(totalPagos)}</span>
                </div>
              )}
            </div>
            <div>
              <label className={labelCls}>Notas del documento</label>
              <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2} className={inputCls} />
            </div>
          </div>
        </div>

        {/* Acciones */}
        <div className="flex flex-wrap items-center justify-end gap-2 pb-6">
          <button onClick={() => router.push('/factura-electronica')} className="text-sm text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-100">Cancelar</button>
          <button onClick={() => guardar(false)} disabled={saving || timbrando}
            className="inline-flex items-center gap-2 border border-brand-600 text-brand-700 hover:bg-brand-50 disabled:opacity-50 text-sm font-medium px-4 py-2 rounded-lg">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Guardar borrador
          </button>
          <button onClick={() => guardar(true)} disabled={saving || timbrando}
            className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
            {timbrando ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />} Guardar y timbrar
          </button>
        </div>
      </div>

      {toast && <Toast {...toast} onClose={hideToast} />}
    </AppLayout>
  )
}

function NuevaFEPage() {
  return (
    <Suspense fallback={
      <AppLayout>
        <div className="flex-1 flex items-center justify-center py-20 text-sm text-gray-400">Cargando...</div>
      </AppLayout>
    }>
      <NuevaFEForm />
    </Suspense>
  )
}

export default withPagePermission(NuevaFEPage, 'factura_electronica', 'agregar')
