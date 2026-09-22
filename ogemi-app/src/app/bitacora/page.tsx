'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { createClient } from '@/lib/supabase'
import { formatMonto, formatDate } from '@/lib/utils'
import { Search, X, Download } from 'lucide-react'
import { withPagePermission } from '@/components/PermissionGuard'
import { exportXLSX, kpiSheet } from '@/lib/exportXlsx'

// Bitácora de correcciones: ediciones y borrados de cobros/pagos, y cambios de cliente en anticipos.
interface Evento {
  id: string
  created_at: string
  accion: 'editar' | 'borrar' | 'anticipo_cliente' | 'borrar_documento' | 'anticipo_deposito'
  documento_tipo: string
  documento: string | null
  tercero: string | null
  usuario: string
  motivo: string | null
  antes: Record<string, any>
  despues: Record<string, any> | null
  cuenta_antes: string | null
  cuenta_despues: string | null
}

const ACCION: Record<Evento['accion'], { label: string; cls: string }> = {
  editar: { label: 'Editó cobro/pago', cls: 'bg-blue-100 text-blue-700' },
  borrar: { label: 'Borró cobro/pago', cls: 'bg-red-100 text-red-700' },
  anticipo_cliente: { label: 'Cambió cliente de anticipo', cls: 'bg-amber-100 text-amber-700' },
  borrar_documento: { label: 'Borró documento completo', cls: 'bg-red-600 text-white' },
  anticipo_deposito: { label: 'Modificó depósito de anticipo', cls: 'bg-teal-100 text-teal-700' },
}
const MODULO: Record<string, string> = {
  facturas: 'Facturas', compras: 'Compras', presupuestos: 'Presupuestos', ventas_ogemi: 'Ventas Ogemi', anticipos: 'Anticipos',
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Lista legible de lo que cambió: [campo, antes, después] */
function cambios(e: Evento): [string, string, string][] {
  const a = e.antes || {}, d = e.despues || {}
  if (e.accion === 'anticipo_cliente') return [['Cliente', a.cliente || '—', d.cliente || '—']]
  if (e.accion === 'borrar_documento') {
    const pagos: any[] = Array.isArray(a._pagos) ? a._pagos : []
    return [
      ['Total', formatMonto(Number(a.total) || 0), '—'],
      ['Fecha', a.fecha ? formatDate(a.fecha) : '—', '—'],
      ['Estado', String(a.estado || '—'), '—'],
      ...(pagos.length === 0
        ? [['Cobros/pagos', 'ninguno', '—'] as [string, string, string]]
        : pagos.map((p, i) => [`Cobro/pago ${i + 1}`, `${formatMonto(Number(p.monto) || 0)} · ${p.fecha ? formatDate(p.fecha) : ''} · ${p.cuenta || (p.anticipo_id ? 'Anticipo' : 'Nota de crédito')}`, '—'] as [string, string, string])),
    ]
  }
  if (e.accion === 'borrar') {
    return [
      ['Monto', formatMonto(Number(a.monto) || 0), '—'],
      ['Fecha', a.fecha ? formatDate(a.fecha) : '—', '—'],
      ['Cuenta', a.anticipo_id ? 'Anticipo' : (a.nota_credito_id || a.credito_factura_id || a.credito_compra_id) ? 'Nota de crédito' : (e.cuenta_antes || '—'), '—'],
      ...(a.referencia ? [['Referencia', String(a.referencia), '—'] as [string, string, string]] : []),
    ]
  }
  const out: [string, string, string][] = []
  if (Number(a.monto) !== Number(d.monto)) out.push(['Monto', formatMonto(Number(a.monto) || 0), formatMonto(Number(d.monto) || 0)])
  if (a.fecha !== d.fecha) out.push(['Fecha', a.fecha ? formatDate(a.fecha) : '—', d.fecha ? formatDate(d.fecha) : '—'])
  if (a.cuenta_id !== d.cuenta_id) out.push(['Cuenta', e.cuenta_antes || '—', e.cuenta_despues || '—'])
  if ((a.referencia || '') !== (d.referencia || '')) out.push(['Referencia', a.referencia || '—', d.referencia || '—'])
  if (e.accion === 'anticipo_deposito') {
    if ((a.numero_deposito || '') !== (d.numero_deposito || '')) out.push(['N° depósito', a.numero_deposito || '—', d.numero_deposito || '—'])
    if ((a.notas || '') !== (d.notas || '')) out.push(['Notas', a.notas || '—', d.notas || '—'])
  }
  if (out.length === 0) out.push(['Sin cambios de valor', '', ''])
  return out
}

function BitacoraPage() {
  const supabase = createClient()
  const hoy = new Date()
  const [desde, setDesde] = useState(iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)))
  const [hasta, setHasta] = useState(iso(hoy))
  const [eventos, setEventos] = useState<Evento[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [fAccion, setFAccion] = useState('all')
  const [fUsuario, setFUsuario] = useState('all')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    const { data, error: e } = await supabase.rpc('bitacora_pagos', { p_desde: desde || null, p_hasta: hasta || null })
    if (e) setError(e.message)
    setEventos((data || []) as Evento[])
    setLoading(false)
  }, [supabase, desde, hasta])

  useEffect(() => { load() }, [load])

  const usuarios = useMemo(() => Array.from(new Set(eventos.map(e => e.usuario))).sort(), [eventos])
  const visibles = useMemo(() => {
    const q = search.trim().toLowerCase()
    return eventos.filter(e =>
      (fAccion === 'all' || e.accion === fAccion) &&
      (fUsuario === 'all' || e.usuario === fUsuario) &&
      (!q || [e.documento, e.tercero, e.usuario, e.motivo].some(x => (x || '').toLowerCase().includes(q))))
  }, [eventos, search, fAccion, fUsuario])

  const kpi = useMemo(() => ({
    editar: visibles.filter(e => e.accion === 'editar').length,
    borrar: visibles.filter(e => e.accion === 'borrar').length,
    docs: visibles.filter(e => e.accion === 'borrar_documento').length,
    anticipo: visibles.filter(e => e.accion === 'anticipo_cliente' || e.accion === 'anticipo_deposito').length,
    montoBorrado: visibles.reduce((s, e) => s
      + (e.accion === 'borrar' ? (Number(e.antes?.monto) || 0) : 0)
      + (e.accion === 'borrar_documento' && Array.isArray(e.antes?._pagos) ? e.antes._pagos.reduce((x: number, p: any) => x + (Number(p.monto) || 0), 0) : 0), 0),
  }), [visibles])

  const exportar = () => {
    exportXLSX(`bitacora_${desde}_${hasta}.xlsx`, [
      kpiSheet('Bitácora', `${visibles.length} eventos · ${desde} a ${hasta}`, [
        ['Ediciones', kpi.editar], ['Cobros/pagos borrados', kpi.borrar], ['Documentos borrados', kpi.docs], ['Cambios en anticipos', kpi.anticipo], ['Monto borrado', kpi.montoBorrado],
      ]),
      {
        name: 'Eventos',
        rows: [['Fecha y hora', 'Usuario', 'Acción', 'Módulo', 'Documento', 'Cliente / Proveedor', 'Cambios', 'Motivo'], ...visibles.map(e => [
          new Date(e.created_at).toLocaleString('es-PA'), e.usuario, ACCION[e.accion]?.label || e.accion, MODULO[e.documento_tipo] || e.documento_tipo,
          e.documento || '(documento borrado)', e.tercero || '',
          cambios(e).map(([c, a, d]) => d === '—' || !d ? `${c}: ${a}` : `${c}: ${a} → ${d}`).join(' | '), e.motivo || '',
        ])],
      },
    ])
  }

  return (
    <AppLayout>
      <Header
        title="Bitácora"
        subtitle="Correcciones de cobros, pagos y anticipos: quién cambió qué y cuándo"
        actions={<button className="btn-secondary flex items-center gap-2" onClick={exportar} disabled={visibles.length === 0}><Download size={16} /> Excel</button>}
      />
      <div className="flex-1 overflow-auto p-6 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>Desde</span>
            <input type="date" className="input py-1.5 text-sm w-auto" value={desde} onChange={e => setDesde(e.target.value)} />
            <span>hasta</span>
            <input type="date" className="input py-1.5 text-sm w-auto" value={hasta} onChange={e => setHasta(e.target.value)} />
          </div>
          <select value={fAccion} onChange={e => setFAccion(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
            <option value="all">Todas las acciones</option>
            <option value="editar">Ediciones</option>
            <option value="borrar">Cobros/pagos borrados</option>
            <option value="borrar_documento">Documentos borrados</option>
            <option value="anticipo_cliente">Cambio de cliente (anticipos)</option>
            <option value="anticipo_deposito">Cambio de depósito (anticipos)</option>
          </select>
          <select value={fUsuario} onChange={e => setFUsuario(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
            <option value="all">Todos los usuarios</option>
            {usuarios.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input pl-9" placeholder="Buscar documento, cliente, motivo..." value={search} onChange={e => setSearch(e.target.value)} />
            {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"><X size={14} /></button>}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { l: 'Ediciones', v: String(kpi.editar), c: 'text-blue-700' },
            { l: 'Cobros/pagos borrados', v: String(kpi.borrar), c: 'text-red-600' },
            { l: 'Documentos borrados', v: String(kpi.docs), c: 'text-red-700' },
            { l: 'Monto de cobros/pagos borrado', v: formatMonto(kpi.montoBorrado), c: 'text-red-600' },
            { l: 'Cambios en anticipos', v: String(kpi.anticipo), c: 'text-amber-700' },
          ].map(x => (
            <div key={x.l} className="card p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{x.l}</p>
              <p className={`text-2xl font-bold mt-1 ${x.c}`}>{x.v}</p>
            </div>
          ))}
        </div>

        {error && <div className="card p-4 text-sm text-red-600 bg-red-50 border border-red-200">{error}</div>}

        <div className="card overflow-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="table-header">Fecha y hora</th>
                <th className="table-header">Usuario</th>
                <th className="table-header">Acción</th>
                <th className="table-header">Documento</th>
                <th className="table-header">Cambios</th>
                <th className="table-header">Motivo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={6} className="text-center py-12 text-gray-400">Cargando...</td></tr>
              ) : visibles.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-12 text-gray-400">Sin correcciones en el período</td></tr>
              ) : visibles.map(e => (
                <tr key={e.id} className="hover:bg-gray-50 align-top">
                  <td className="table-cell text-sm text-gray-600 whitespace-nowrap">{new Date(e.created_at).toLocaleString('es-PA', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td className="table-cell text-sm font-medium">{e.usuario}</td>
                  <td className="table-cell"><span className={`badge ${ACCION[e.accion]?.cls || 'bg-gray-100 text-gray-600'}`}>{ACCION[e.accion]?.label || e.accion}</span></td>
                  <td className="table-cell text-sm">
                    <span className="font-medium block">{e.documento || <span className="text-gray-400">(documento borrado)</span>}</span>
                    <span className="text-xs text-gray-400">{MODULO[e.documento_tipo] || e.documento_tipo}{e.tercero ? ` · ${e.tercero}` : ''}</span>
                  </td>
                  <td className="table-cell text-sm">
                    {cambios(e).map(([campo, a, d], i) => (
                      <div key={i} className="whitespace-nowrap">
                        <span className="text-gray-400">{campo}{a || d ? ': ' : ''}</span>
                        <span className={e.accion === 'borrar' || e.accion === 'borrar_documento' ? 'text-red-600' : 'text-gray-500'}>{a}</span>
                        {d && d !== '—' && <><span className="text-gray-300"> → </span><span className="font-semibold text-gray-800">{d}</span></>}
                      </div>
                    ))}
                  </td>
                  <td className="table-cell text-sm text-gray-600 max-w-[260px]">{e.motivo || <span className="text-gray-300">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400">Se registran las ediciones y borrados de cobros/pagos, los documentos borrados completos (facturas, compras, presupuestos, ventas Ogemi) y los cambios de cliente en anticipos desde el 21/09/2026. Máximo 2.000 eventos por consulta.</p>
      </div>
    </AppLayout>
  )
}

export default withPagePermission(BitacoraPage, 'usuarios', 'ver')
