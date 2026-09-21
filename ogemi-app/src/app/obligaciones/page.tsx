'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { Toast } from '@/components/Toast'
import { useToast } from '@/hooks/useToast'
import { createClient } from '@/lib/supabase'
import { formatMonto, formatDate } from '@/lib/utils'
import { Plus, Pencil, Trash2, Search, X, CalendarDays, ClipboardList, Printer, Save } from 'lucide-react'
import { withPagePermission } from '@/components/PermissionGuard'
import { useAuth } from '@/context/AuthContext'
import EmpresaFilter, { useEmpresaFiltro, filtrarEmpresa } from '@/components/EmpresaFilter'
import { Empresa, EMPRESA_LABEL } from '@/types'

// ── Tipos ─────────────────────────────────────────────────────────────────────
type Frecuencia = 'semanal' | 'quincenal' | 'mensual' | 'trimestral' | 'semestral' | 'anual'
const FRECUENCIAS: { id: Frecuencia; label: string }[] = [
  { id: 'semanal',    label: 'Semanal (cada 7 días)' },
  { id: 'quincenal',  label: 'Quincenal (cada 15 días)' },
  { id: 'mensual',    label: 'Mensual' },
  { id: 'trimestral', label: 'Trimestral' },
  { id: 'semestral',  label: 'Semestral' },
  { id: 'anual',      label: 'Anual' },
]
const FREC_LABEL: Record<Frecuencia, string> = {
  semanal: 'Semanal', quincenal: 'Quincenal', mensual: 'Mensual', trimestral: 'Trimestral', semestral: 'Semestral', anual: 'Anual',
}

interface Obligacion {
  id: string
  empresa: Empresa
  nombre: string
  descripcion: string | null
  monto_total: number
  num_periodos: number
  frecuencia: Frecuencia
  fecha_inicio: string
  activo: boolean
}
interface Cuota {
  id: string
  obligacion_id: string
  numero: number
  fecha: string
  monto: number
  notas: string | null
  pagada: boolean
  fecha_pago: string | null
}

type Pestana = 'obligaciones' | 'calendario'
type Vista = 'mes' | 'trimestre' | 'semestre' | 'anio'

// ── Fechas ────────────────────────────────────────────────────────────────────
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const iso = (d: Date) => {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
const parse = (s: string) => new Date(s + 'T00:00:00')
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
/** Suma meses conservando el día (recortado en meses cortos: 31 → 30/28). */
const addMonths = (d: Date, n: number) => {
  const y = d.getFullYear(), m = d.getMonth() + n, day = d.getDate()
  const last = new Date(y, m + 1, 0).getDate()
  return new Date(y, m, Math.min(day, last))
}
function fechaCuota(inicio: Date, frecuencia: Frecuencia, k: number): Date {
  switch (frecuencia) {
    case 'semanal':    return addDays(inicio, 7 * k)
    case 'quincenal':  return addDays(inicio, 15 * k)
    case 'mensual':    return addMonths(inicio, k)
    case 'trimestral': return addMonths(inicio, 3 * k)
    case 'semestral':  return addMonths(inicio, 6 * k)
    case 'anual':      return addMonths(inicio, 12 * k)
  }
}
/** Cuotas iguales (2 decimales); la última absorbe el redondeo para que sumen exactamente el total. */
function generarCuotas(total: number, n: number, inicio: string, frecuencia: Frecuencia): { numero: number; fecha: string; monto: number }[] {
  const base = Math.floor((total / n) * 100) / 100
  const out: { numero: number; fecha: string; monto: number }[] = []
  let acumulado = 0
  for (let k = 0; k < n; k++) {
    const monto = k === n - 1 ? Math.round((total - acumulado) * 100) / 100 : base
    acumulado = Math.round((acumulado + monto) * 100) / 100
    out.push({ numero: k + 1, fecha: iso(fechaCuota(parse(inicio), frecuencia, k)), monto })
  }
  return out
}

// ── Página ────────────────────────────────────────────────────────────────────
function ObligacionesPage() {
  const supabase = createClient()
  const { toast, showToast, hideToast } = useToast()
  const { puedeHacer } = useAuth()
  const canAdd = puedeHacer('obligaciones', 'agregar')
  const canEdit = puedeHacer('obligaciones', 'editar')
  const canDelete = puedeHacer('obligaciones', 'borrar')

  const [pestana, setPestana] = useState<Pestana>('obligaciones')
  const [obligaciones, setObligaciones] = useState<Obligacion[]>([])
  const [cuotas, setCuotas] = useState<Cuota[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [empresaFiltro, setEmpresaFiltro] = useEmpresaFiltro()
  const [mostrarInactivas, setMostrarInactivas] = useState(false)

  // Formulario crear/editar obligación
  const hoy = iso(new Date())
  const emptyForm = { empresa: 'impresos' as Empresa, nombre: '', descripcion: '', monto_total: '', num_periodos: '12', frecuencia: 'mensual' as Frecuencia, fecha_inicio: hoy }
  const [form, setForm] = useState(emptyForm)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // Detalle de cuotas (edición individual)
  const [detalleId, setDetalleId] = useState<string | null>(null)
  const [cuotaDraft, setCuotaDraft] = useState<Record<string, { fecha: string; monto: string }>>({})

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: ob, error: e1 }, { data: cu, error: e2 }] = await Promise.all([
      supabase.from('obligaciones').select('*').order('fecha_inicio', { ascending: false }),
      supabase.from('obligaciones_cuotas').select('*').order('fecha', { ascending: true }),
    ])
    if (e1 || e2) showToast(`Error al cargar obligaciones: ${(e1 || e2)!.message}`, 'error')
    setObligaciones((ob || []) as Obligacion[])
    setCuotas((cu || []) as Cuota[])
    setLoading(false)
  }, [supabase, showToast])

  useEffect(() => { load() }, [load])

  const cuotasPor = useMemo(() => {
    const m = new Map<string, Cuota[]>()
    cuotas.forEach(c => { if (!m.has(c.obligacion_id)) m.set(c.obligacion_id, []); m.get(c.obligacion_id)!.push(c) })
    return m
  }, [cuotas])

  const obligacionesVisibles = useMemo<Obligacion[]>(() => {
    const q = search.toLowerCase()
    return (filtrarEmpresa(obligaciones, empresaFiltro) as Obligacion[])
      .filter(o => mostrarInactivas || o.activo)
      .filter(o => !q || o.nombre.toLowerCase().includes(q) || (o.descripcion || '').toLowerCase().includes(q))
  }, [obligaciones, empresaFiltro, mostrarInactivas, search])

  // ── Crear / editar ─────────────────────────────────────────────────────────
  const abrirNueva = () => { setEditId(null); setForm(emptyForm); setShowForm(true) }
  const abrirEditar = (o: Obligacion) => {
    setEditId(o.id)
    setForm({ empresa: o.empresa, nombre: o.nombre, descripcion: o.descripcion || '', monto_total: String(o.monto_total), num_periodos: String(o.num_periodos), frecuencia: o.frecuencia, fecha_inicio: o.fecha_inicio })
    setShowForm(true)
  }

  const guardar = async () => {
    const total = parseFloat(form.monto_total)
    const n = parseInt(form.num_periodos)
    if (!form.nombre.trim() || !(total > 0) || !(n >= 1) || !form.fecha_inicio) {
      showToast('Completa nombre, monto total, períodos y fecha de inicio', 'error'); return
    }
    setSaving(true)
    const payload = {
      empresa: form.empresa, nombre: form.nombre.trim(), descripcion: form.descripcion.trim() || null,
      monto_total: Math.round(total * 100) / 100, num_periodos: n, frecuencia: form.frecuencia, fecha_inicio: form.fecha_inicio,
    }
    if (editId) {
      const prev = obligaciones.find(o => o.id === editId)
      const cambiaPlan = !!prev && (prev.monto_total !== payload.monto_total || prev.num_periodos !== n || prev.frecuencia !== form.frecuencia || prev.fecha_inicio !== form.fecha_inicio)
      if (cambiaPlan && !confirm('Cambiaste monto, períodos, frecuencia o fecha: las cuotas se regenerarán y se perderán las ediciones manuales de fecha y monto (la marca de pagada se conserva por número de cuota). ¿Continuar?')) { setSaving(false); return }
      const { error } = await supabase.from('obligaciones').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editId)
      if (error) { setSaving(false); showToast(`Error al guardar: ${error.message}`, 'error'); return }
      if (cambiaPlan) {
        const { error: eDel } = await supabase.from('obligaciones_cuotas').delete().eq('obligacion_id', editId)
        if (eDel) { setSaving(false); showToast(`Error al regenerar cuotas: ${eDel.message}`, 'error'); return }
        // Conserva la marca de pagada por número de cuota
        const pagadasPrev = new Map((cuotasPor.get(editId) || []).filter(c => c.pagada).map(c => [c.numero, c.fecha_pago]))
        const nuevas = generarCuotas(payload.monto_total, n, form.fecha_inicio, form.frecuencia).map(c => ({
          ...c, obligacion_id: editId, pagada: pagadasPrev.has(c.numero), fecha_pago: pagadasPrev.get(c.numero) ?? null,
        }))
        const { error: eIns } = await supabase.from('obligaciones_cuotas').insert(nuevas)
        if (eIns) { setSaving(false); showToast(`Error al crear cuotas: ${eIns.message}`, 'error'); return }
      }
      showToast('Obligación actualizada', 'success')
    } else {
      const { data, error } = await supabase.from('obligaciones').insert(payload).select('id').single()
      if (error || !data) { setSaving(false); showToast(`Error al crear: ${error?.message}`, 'error'); return }
      const nuevas = generarCuotas(payload.monto_total, n, form.fecha_inicio, form.frecuencia).map(c => ({ ...c, obligacion_id: data.id }))
      const { error: eIns } = await supabase.from('obligaciones_cuotas').insert(nuevas)
      if (eIns) { setSaving(false); showToast(`Obligación creada pero fallaron las cuotas: ${eIns.message}`, 'error'); return }
      showToast('Obligación creada', 'success')
    }
    setSaving(false)
    setShowForm(false)
    load()
  }

  const toggleActivo = async (o: Obligacion) => {
    const { error } = await supabase.from('obligaciones').update({ activo: !o.activo, updated_at: new Date().toISOString() }).eq('id', o.id)
    if (error) showToast(`Error: ${error.message}`, 'error'); else load()
  }

  const eliminar = async (id: string) => {
    const { error } = await supabase.from('obligaciones').delete().eq('id', id)
    setDeleteConfirm(null)
    if (error) showToast(`Error al eliminar: ${error.message}`, 'error'); else { showToast('Obligación eliminada', 'success'); load() }
  }

  // ── Cuotas: edición individual ─────────────────────────────────────────────
  const abrirDetalle = (o: Obligacion) => {
    const d: Record<string, { fecha: string; monto: string }> = {}
    ;(cuotasPor.get(o.id) || []).forEach(c => { d[c.id] = { fecha: c.fecha, monto: String(c.monto) } })
    setCuotaDraft(d)
    setDetalleId(o.id)
  }
  const guardarCuotas = async () => {
    if (!detalleId) return
    const originales = cuotasPor.get(detalleId) || []
    const cambios = originales
      .map(c => ({ c, d: cuotaDraft[c.id] }))
      .filter(({ c, d }) => d && (d.fecha !== c.fecha || parseFloat(d.monto) !== c.monto))
    if (cambios.length === 0) { setDetalleId(null); return }
    for (const { c, d } of cambios) {
      const monto = parseFloat(d.monto)
      if (!(monto >= 0) || !d.fecha) { showToast(`Cuota ${c.numero}: fecha o monto inválido`, 'error'); return }
    }
    setSaving(true)
    for (const { c, d } of cambios) {
      const { error } = await supabase.from('obligaciones_cuotas')
        .update({ fecha: d.fecha, monto: Math.round(parseFloat(d.monto) * 100) / 100, updated_at: new Date().toISOString() }).eq('id', c.id)
      if (error) { setSaving(false); showToast(`Error en cuota ${c.numero}: ${error.message}`, 'error'); return }
    }
    setSaving(false)
    showToast(`${cambios.length} cuota${cambios.length === 1 ? '' : 's'} actualizada${cambios.length === 1 ? '' : 's'}`, 'success')
    setDetalleId(null)
    load()
  }

  const [togglingId, setTogglingId] = useState<string | null>(null)
  const togglePagada = async (c: Cuota) => {
    const pagada = !c.pagada
    setTogglingId(c.id)
    const { error } = await supabase.from('obligaciones_cuotas')
      .update({ pagada, fecha_pago: pagada ? iso(new Date()) : null, updated_at: new Date().toISOString() }).eq('id', c.id)
    setTogglingId(null)
    if (error) { showToast(`Error en cuota ${c.numero}: ${error.message}`, 'error'); return }
    setCuotas(prev => prev.map(x => x.id === c.id ? { ...x, pagada, fecha_pago: pagada ? iso(new Date()) : null } : x))
  }

  /** KPI de cuotas: pagadas / vencidas (sin pagar, fecha pasada) / pendientes (sin pagar, por vencer). */
  const kpiCuotas = (cs: Cuota[]) => {
    const k = { pendientes: 0, pendientesMonto: 0, pagadas: 0, pagadasMonto: 0, vencidas: 0, vencidasMonto: 0 }
    cs.forEach(c => {
      if (c.pagada) { k.pagadas++; k.pagadasMonto += c.monto || 0 }
      else if (c.fecha < hoy) { k.vencidas++; k.vencidasMonto += c.monto || 0 }
      else { k.pendientes++; k.pendientesMonto += c.monto || 0 }
    })
    return k
  }

  // ── Calendario (sumatoria) ─────────────────────────────────────────────────
  const ahora = new Date()
  const [vista, setVista] = useState<Vista>('mes')
  const [anio, setAnio] = useState(ahora.getFullYear())
  const [mes, setMes] = useState(ahora.getMonth() + 1)      // 1-12
  const [trimestre, setTrimestre] = useState(Math.floor(ahora.getMonth() / 3) + 1) // 1-4
  const [semestre, setSemestre] = useState(ahora.getMonth() < 6 ? 1 : 2)

  /** Tramos del calendario: mes → semanas (lunes a domingo, recortadas al mes); resto → meses. */
  const tramos = useMemo((): { label: string; sub: string; desde: string; hasta: string }[] => {
    if (vista === 'mes') {
      const first = new Date(anio, mes - 1, 1), last = new Date(anio, mes, 0)
      const out: { label: string; sub: string; desde: string; hasta: string }[] = []
      // Lunes de la semana que contiene el día 1
      let ini = addDays(first, -((first.getDay() + 6) % 7))
      let n = 1
      while (ini <= last) {
        const fin = addDays(ini, 6)
        const d = ini < first ? first : ini
        const h = fin > last ? last : fin
        out.push({ label: `Semana ${n}`, sub: `${formatDate(iso(d)).slice(0, 5)} – ${formatDate(iso(h)).slice(0, 5)}`, desde: iso(d), hasta: iso(h) })
        ini = addDays(ini, 7); n++
      }
      return out
    }
    const m0 = vista === 'trimestre' ? (trimestre - 1) * 3 : vista === 'semestre' ? (semestre - 1) * 6 : 0
    const cnt = vista === 'trimestre' ? 3 : vista === 'semestre' ? 6 : 12
    return Array.from({ length: cnt }, (_, i) => {
      const d = new Date(anio, m0 + i, 1), h = new Date(anio, m0 + i + 1, 0)
      return { label: MESES[m0 + i], sub: String(anio), desde: iso(d), hasta: iso(h) }
    })
  }, [vista, anio, mes, trimestre, semestre])

  const calendario = useMemo<{ filas: { o: Obligacion; porTramo: Cuota[][]; total: number }[]; totales: number[]; gran: number }>(() => {
    const visibles: Obligacion[] = obligacionesVisibles
    const desde = tramos[0]?.desde, hasta = tramos[tramos.length - 1]?.hasta
    const filas = visibles.map(o => {
      const cs = (cuotasPor.get(o.id) || []).filter(c => c.fecha >= desde && c.fecha <= hasta)
      const porTramo = tramos.map(t => cs.filter(c => c.fecha >= t.desde && c.fecha <= t.hasta))
      return { o, porTramo, total: cs.reduce((s, c) => s + (c.monto || 0), 0) }
    }).filter(f => f.total > 0)
    const totales = tramos.map((_, i) => filas.reduce((s, f) => s + f.porTramo[i].reduce((x, c) => x + (c.monto || 0), 0), 0))
    return { filas, totales, gran: totales.reduce((s, t) => s + t, 0) }
  }, [obligacionesVisibles, cuotasPor, tramos])

  const kpiListado = kpiCuotas(obligacionesVisibles.flatMap(o => cuotasPor.get(o.id) || []))
  const kpiCalendario = kpiCuotas(calendario.filas.flatMap(f => f.porTramo.flat()))
  const KpiCuotas = ({ k, ambito }: { k: ReturnType<typeof kpiCuotas>; ambito: string }) => (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {[
        { label: 'Cuotas pendientes', sub: 'sin pagar, por vencer', n: k.pendientes, m: k.pendientesMonto, color: 'text-blue-700' },
        { label: 'Cuotas pagadas', sub: 'marcadas como pagadas', n: k.pagadas, m: k.pagadasMonto, color: 'text-green-700' },
        { label: 'Cuotas vencidas', sub: 'sin pagar, fecha pasada', n: k.vencidas, m: k.vencidasMonto, color: k.vencidas > 0 ? 'text-red-600' : 'text-gray-400' },
      ].map(x => (
        <div key={x.label} className="card p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{x.label}</p>
          <p className="text-[11px] text-gray-400">{x.sub} · {ambito}</p>
          <p className={`text-2xl font-bold mt-1 ${x.color}`}>{x.n}</p>
          <p className="text-xs text-gray-500">{formatMonto(x.m)}</p>
        </div>
      ))}
    </div>
  )

  const tituloVista = vista === 'mes' ? `${MESES[mes - 1]} ${anio}` : vista === 'trimestre' ? `Trimestre ${trimestre} · ${anio}` : vista === 'semestre' ? `Semestre ${semestre} · ${anio}` : `Año ${anio}`
  const anios = Array.from({ length: 7 }, (_, i) => ahora.getFullYear() - 2 + i)

  // Resumen para el listado
  const resumen = (o: Obligacion) => {
    const cs = cuotasPor.get(o.id) || []
    const sinPagar = cs.filter(c => !c.pagada)
    return {
      pendiente: sinPagar.reduce((s, c) => s + c.monto, 0),
      proxima: sinPagar[0],
      ultima: cs[cs.length - 1],
      cuotasPagadas: cs.length - sinPagar.length,
      cuotasVencidas: sinPagar.filter(c => c.fecha < hoy).length,
    }
  }

  const detalle = detalleId ? obligaciones.find(o => o.id === detalleId) : null
  const pestanas: { key: Pestana; label: string; icon: React.ElementType }[] = [
    { key: 'obligaciones', label: 'Obligaciones', icon: ClipboardList },
    { key: 'calendario',   label: 'Calendario de pagos', icon: CalendarDays },
  ]

  return (
    <AppLayout>
      {toast && <Toast {...toast} onClose={hideToast} />}
      <Header
        title="Obligaciones"
        subtitle="Compromisos de pago en cuotas: préstamos, contratos, arrendamientos"
        actions={
          <div className="flex items-center gap-2">
            <EmpresaFilter value={empresaFiltro} onChange={setEmpresaFiltro} label="Empresa:" title="Obligaciones de qué empresa se incluyen" />
            {pestana === 'calendario' && (
              <button onClick={() => window.print()} className="btn-secondary flex items-center gap-2">
                <Printer size={16} /> Imprimir
              </button>
            )}
            {canAdd && (
              <button onClick={abrirNueva} className="btn-primary flex items-center gap-2">
                <Plus size={16} /> Nueva obligación
              </button>
            )}
          </div>
        }
      />

      <div className="bg-white border-b border-gray-200 px-6 print:hidden">
        <div className="flex gap-1 overflow-x-auto">
          {pestanas.map(t => {
            const Icon = t.icon
            return (
              <button key={t.key} onClick={() => setPestana(t.key)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  pestana === t.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}>
                <Icon size={14} />{t.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Pestaña: listado ─────────────────────────────────────────────── */}
      {pestana === 'obligaciones' && (
        <div className="flex-1 overflow-auto p-6 space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className="input pl-9" placeholder="Buscar obligación..." value={search} onChange={e => setSearch(e.target.value)} />
              {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"><X size={14} /></button>}
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
              <input type="checkbox" className="w-4 h-4 accent-brand-600" checked={mostrarInactivas} onChange={e => setMostrarInactivas(e.target.checked)} />
              Mostrar inactivas
            </label>
            <span className="text-xs text-gray-400">{obligacionesVisibles.length} obligaciones</span>
          </div>

          <KpiCuotas k={kpiListado} ambito="obligaciones listadas" />

          <div className="card overflow-auto">
            <table className="w-full min-w-max">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="table-header">Obligación</th>
                  <th className="table-header">Empresa</th>
                  <th className="table-header">Frecuencia</th>
                  <th className="table-header text-center">Cuotas</th>
                  <th className="table-header">Inicio</th>
                  <th className="table-header">Última cuota</th>
                  <th className="table-header text-right">Monto total</th>
                  <th className="table-header text-right">Cuota</th>
                  <th className="table-header">Próxima</th>
                  <th className="table-header text-right">Pendiente</th>
                  <th className="table-header">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={11} className="text-center py-12 text-gray-400">Cargando...</td></tr>
                ) : obligacionesVisibles.length === 0 ? (
                  <tr><td colSpan={11} className="text-center py-12 text-gray-400">Sin obligaciones registradas</td></tr>
                ) : obligacionesVisibles.map(o => {
                  const r = resumen(o)
                  const cuotaBase = o.num_periodos > 0 ? o.monto_total / o.num_periodos : 0
                  return (
                    <tr key={o.id} className={`hover:bg-gray-50 ${o.activo ? '' : 'opacity-50'}`}>
                      <td className="table-cell">
                        <span className="font-medium block">{o.nombre}</span>
                        {o.descripcion && <span className="text-xs text-gray-400 block max-w-[260px] truncate" title={o.descripcion}>{o.descripcion}</span>}
                      </td>
                      <td className="table-cell text-sm">
                        <span className={`badge ${o.empresa === 'ogemi' ? 'bg-amber-100 text-amber-700' : 'bg-sky-100 text-sky-700'}`}>{EMPRESA_LABEL[o.empresa]}</span>
                      </td>
                      <td className="table-cell text-sm text-gray-600">{FREC_LABEL[o.frecuencia]}</td>
                      <td className="table-cell text-center text-sm text-gray-600">
                        {o.num_periodos}
                        <span className="block text-[10px] text-green-700">{r.cuotasPagadas} pagada{r.cuotasPagadas === 1 ? '' : 's'}</span>
                        {r.cuotasVencidas > 0 && <span className="block text-[10px] text-red-600">{r.cuotasVencidas} vencida{r.cuotasVencidas === 1 ? '' : 's'}</span>}
                      </td>
                      <td className="table-cell text-sm text-gray-500">{formatDate(o.fecha_inicio)}</td>
                      <td className="table-cell text-sm text-gray-500">{r.ultima ? formatDate(r.ultima.fecha) : '—'}</td>
                      <td className="table-cell text-right font-semibold text-brand-700">{formatMonto(o.monto_total)}</td>
                      <td className="table-cell text-right text-sm text-gray-600">{formatMonto(cuotaBase)}</td>
                      <td className="table-cell text-sm">
                        {r.proxima ? <><span className={r.proxima.fecha < hoy ? 'text-red-600 font-medium' : 'text-gray-700'}>{formatDate(r.proxima.fecha)}</span><span className="block text-[10px] text-gray-400">{formatMonto(r.proxima.monto)}</span></> : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="table-cell text-right font-semibold text-orange-600">{formatMonto(r.pendiente)}</td>
                      <td className="table-cell">
                        <div className="flex items-center gap-2">
                          <button onClick={() => abrirDetalle(o)} className="text-xs text-brand-600 hover:text-brand-800" title="Ver y editar cuotas">Cuotas</button>
                          {canEdit && <button onClick={() => abrirEditar(o)} className="text-gray-400 hover:text-brand-600" title="Editar"><Pencil size={14} /></button>}
                          {canEdit && <button onClick={() => toggleActivo(o)} className="text-xs text-gray-400 hover:text-gray-700" title={o.activo ? 'Desactivar' : 'Activar'}>{o.activo ? 'Desactivar' : 'Activar'}</button>}
                          {canDelete && (deleteConfirm === o.id ? (
                            <span className="flex items-center gap-1">
                              <button onClick={() => eliminar(o.id)} className="text-xs text-red-600 font-semibold">Confirmar</button>
                              <button onClick={() => setDeleteConfirm(null)} className="text-xs text-gray-400">Cancelar</button>
                            </span>
                          ) : (
                            <button onClick={() => setDeleteConfirm(o.id)} className="text-red-400 hover:text-red-600" title="Eliminar"><Trash2 size={14} /></button>
                          ))}
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

      {/* ── Pestaña: calendario ──────────────────────────────────────────── */}
      {pestana === 'calendario' && (
        <div className="flex-1 overflow-auto p-6 space-y-4" id="obligaciones-print">
          <div className="flex items-center gap-3 flex-wrap print:hidden">
            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
              {([['mes', 'Mes'], ['trimestre', 'Trimestre'], ['semestre', 'Semestre'], ['anio', 'Año']] as [Vista, string][]).map(([v, l]) => (
                <button key={v} onClick={() => setVista(v)}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${vista === v ? 'bg-brand-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>{l}</button>
              ))}
            </div>
            <select value={anio} onChange={e => setAnio(parseInt(e.target.value))} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
              {anios.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            {vista === 'mes' && (
              <select value={mes} onChange={e => setMes(parseInt(e.target.value))} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
                {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            )}
            {vista === 'trimestre' && (
              <select value={trimestre} onChange={e => setTrimestre(parseInt(e.target.value))} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
                {[1, 2, 3, 4].map(q => <option key={q} value={q}>Trimestre {q} ({MESES[(q - 1) * 3].slice(0, 3)}–{MESES[q * 3 - 1].slice(0, 3)})</option>)}
              </select>
            )}
            {vista === 'semestre' && (
              <select value={semestre} onChange={e => setSemestre(parseInt(e.target.value))} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
                <option value={1}>Semestre 1 (Ene–Jun)</option>
                <option value={2}>Semestre 2 (Jul–Dic)</option>
              </select>
            )}
            <span className="text-xs text-gray-400">{vista === 'mes' ? 'Sumatoria por semana (lunes a domingo)' : 'Sumatoria por mes'}</span>
          </div>

          <div className="hidden print:block mb-2">
            <div className="text-base font-bold">Obligaciones · {tituloVista}</div>
            <div className="text-xs text-gray-500">Generado: {new Date().toLocaleString('es-PA')}</div>
          </div>

          <div className="card p-4 bg-brand-50 border border-brand-200 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-brand-700">Total a pagar · {tituloVista}</p>
              <p className="text-xs text-gray-500">{calendario.filas.length} obligaciones con cuotas en el período</p>
            </div>
            <span className="text-2xl font-bold text-brand-900">{formatMonto(calendario.gran)}</span>
          </div>

          <KpiCuotas k={kpiCalendario} ambito={tituloVista} />

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {tramos.map((t, i) => (
              <div key={i} className="card p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t.label}</p>
                <p className="text-[11px] text-gray-400">{t.sub}</p>
                <p className={`text-lg font-bold mt-1 ${calendario.totales[i] > 0 ? 'text-brand-800' : 'text-gray-300'}`}>{formatMonto(calendario.totales[i])}</p>
              </div>
            ))}
          </div>

          <div className="card overflow-auto">
            <table className="w-full min-w-max">
              <thead>
                <tr className="border-b-2 border-gray-300 bg-gray-50">
                  <th className="table-header text-left sticky left-0 bg-gray-50 z-10 min-w-[220px]">Obligación</th>
                  <th className="table-header text-left min-w-[90px]">Frecuencia</th>
                  {tramos.map((t, i) => (
                    <th key={i} className="table-header text-right min-w-[110px]">{t.label}<br /><span className="font-normal text-[10px] opacity-80">{t.sub}</span></th>
                  ))}
                  <th className="table-header text-right min-w-[110px]">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {calendario.filas.length === 0 ? (
                  <tr><td colSpan={tramos.length + 3} className="text-center py-10 text-gray-400">No hay cuotas en {tituloVista}</td></tr>
                ) : calendario.filas.map(f => (
                  <tr key={f.o.id} className="hover:bg-gray-50">
                    <td className="table-cell sticky left-0 bg-white z-10">
                      <span className="font-medium text-sm block">{f.o.nombre}</span>
                      <span className="text-[10px] text-gray-400">{EMPRESA_LABEL[f.o.empresa]}</span>
                    </td>
                    <td className="table-cell text-sm text-gray-500">{FREC_LABEL[f.o.frecuencia]}</td>
                    {f.porTramo.map((cs, i) => {
                      const s = cs.reduce((x, c) => x + (c.monto || 0), 0)
                      return (
                        <td key={i} className="table-cell text-right text-sm">
                          {s > 0 ? (
                            <span className="font-medium text-gray-700">
                              {formatMonto(s)}
                              <span className="block text-[10px] font-normal text-gray-400">
                                {cs.map((c, j) => (
                                  <span key={c.id} className={c.pagada ? 'text-green-700' : c.fecha < hoy ? 'text-red-600' : ''}>
                                    {j > 0 ? ' · ' : ''}#{c.numero} {formatDate(c.fecha).slice(0, 5)}{c.pagada ? ' ✓' : ''}
                                  </span>
                                ))}
                              </span>
                            </span>
                          ) : <span className="text-gray-200">—</span>}
                        </td>
                      )
                    })}
                    <td className="table-cell text-right font-semibold text-brand-700">{formatMonto(f.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-400 bg-gray-100 font-bold">
                  <td colSpan={2} className="table-cell text-right sticky left-0 bg-gray-100 z-10 text-sm text-gray-600">TOTAL</td>
                  {calendario.totales.map((t, i) => <td key={i} className="table-cell text-right text-brand-800">{t > 0 ? formatMonto(t) : '—'}</td>)}
                  <td className="table-cell text-right text-brand-900">{formatMonto(calendario.gran)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ── Modal: crear / editar ────────────────────────────────────────── */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-auto">
            <h2 className="text-lg font-semibold mb-5">{editId ? 'Editar obligación' : 'Nueva obligación'}</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">Empresa *</label>
                  <select className="input" value={form.empresa} onChange={e => setForm(p => ({ ...p, empresa: e.target.value as Empresa }))}>
                    <option value="impresos">{EMPRESA_LABEL.impresos}</option>
                    <option value="ogemi">{EMPRESA_LABEL.ogemi}</option>
                  </select>
                </div>
                <div>
                  <label className="label">Frecuencia *</label>
                  <select className="input" value={form.frecuencia} onChange={e => setForm(p => ({ ...p, frecuencia: e.target.value as Frecuencia }))}>
                    {FRECUENCIAS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Nombre *</label>
                <input className="input" placeholder="Préstamo banco, alquiler local, leasing..." value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} />
              </div>
              <div>
                <label className="label">Descripción</label>
                <input className="input" placeholder="Referencia, contrato, acreedor..." value={form.descripcion} onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="label">Monto total *</label>
                  <input type="number" step="0.01" min="0.01" className="input" placeholder="0.00" value={form.monto_total} onChange={e => setForm(p => ({ ...p, monto_total: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Nº de períodos *</label>
                  <input type="number" step="1" min="1" max="600" className="input" value={form.num_periodos} onChange={e => setForm(p => ({ ...p, num_periodos: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Fecha de inicio *</label>
                  <input type="date" className="input" value={form.fecha_inicio} onChange={e => setForm(p => ({ ...p, fecha_inicio: e.target.value }))} />
                </div>
              </div>
              {(() => {
                const total = parseFloat(form.monto_total), n = parseInt(form.num_periodos)
                if (!(total > 0) || !(n >= 1) || !form.fecha_inicio) return null
                const prev = generarCuotas(total, n, form.fecha_inicio, form.frecuencia)
                return (
                  <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-xs text-gray-600">
                    <span className="font-semibold text-gray-800">{n} cuotas de {formatMonto(prev[0].monto)}</span>
                    {prev[n - 1].monto !== prev[0].monto && <span> (última {formatMonto(prev[n - 1].monto)})</span>}
                    <span className="block mt-0.5">Primera: {formatDate(prev[0].fecha)} · Última: {formatDate(prev[n - 1].fecha)}</span>
                    {editId && <span className="block mt-1 text-amber-700">Si cambias monto, períodos, frecuencia o fecha, las cuotas se regeneran.</span>}
                  </div>
                )
              })()}
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button className="btn-secondary" onClick={() => setShowForm(false)} disabled={saving}>Cancelar</button>
              <button className="btn-primary flex items-center gap-2" onClick={guardar} disabled={saving}>
                <Save size={15} /> {saving ? 'Guardando...' : editId ? 'Guardar cambios' : 'Crear obligación'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: cuotas ────────────────────────────────────────────────── */}
      {detalle && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] flex flex-col">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold">{detalle.nombre}</h2>
                <p className="text-xs text-gray-500">{FREC_LABEL[detalle.frecuencia]} · {detalle.num_periodos} cuotas · total {formatMonto(detalle.monto_total)} · {EMPRESA_LABEL[detalle.empresa]}</p>
              </div>
              <button onClick={() => setDetalleId(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="overflow-auto flex-1 border border-gray-200 rounded-lg">
              <table className="w-full">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="table-header text-center w-14">#</th>
                    <th className="table-header">Fecha</th>
                    <th className="table-header text-right">Monto</th>
                    <th className="table-header">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(cuotasPor.get(detalle.id) || []).map(c => {
                    const d = cuotaDraft[c.id] || { fecha: c.fecha, monto: String(c.monto) }
                    const vencida = !c.pagada && d.fecha < hoy
                    return (
                      <tr key={c.id} className={c.pagada ? 'bg-green-50' : vencida ? 'bg-red-50' : ''}>
                        <td className="table-cell text-center text-sm text-gray-500">{c.numero}</td>
                        <td className="table-cell">
                          <input type="date" className="input py-1 text-sm" value={d.fecha} disabled={!canEdit}
                            onChange={e => setCuotaDraft(p => ({ ...p, [c.id]: { ...d, fecha: e.target.value } }))} />
                        </td>
                        <td className="table-cell text-right">
                          <input type="number" step="0.01" min="0" className="input py-1 text-sm text-right max-w-[140px] ml-auto" value={d.monto} disabled={!canEdit}
                            onChange={e => setCuotaDraft(p => ({ ...p, [c.id]: { ...d, monto: e.target.value } }))} />
                        </td>
                        <td className="table-cell text-xs">
                          <div className="flex items-center gap-2 whitespace-nowrap">
                            <span className={`badge ${c.pagada ? 'bg-green-100 text-green-700' : vencida ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                              {c.pagada ? 'Pagada' : vencida ? 'Vencida' : 'Pendiente'}
                            </span>
                            {canEdit && (
                              <button onClick={() => togglePagada(c)} disabled={togglingId === c.id}
                                className={`text-xs font-medium ${c.pagada ? 'text-gray-400 hover:text-gray-700' : 'text-green-700 hover:text-green-900'}`}>
                                {togglingId === c.id ? '...' : c.pagada ? 'Desmarcar' : 'Marcar pagada'}
                              </button>
                            )}
                          </div>
                          {c.pagada && c.fecha_pago && <span className="block text-[10px] text-gray-400 mt-0.5">el {formatDate(c.fecha_pago)}</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 font-semibold text-sm">
                    <td colSpan={2} className="table-cell text-right text-gray-600">Suma de cuotas</td>
                    <td className="table-cell text-right text-brand-800">
                      {formatMonto((cuotasPor.get(detalle.id) || []).reduce((s, c) => s + (parseFloat(cuotaDraft[c.id]?.monto ?? String(c.monto)) || 0), 0))}
                    </td>
                    <td className="table-cell text-xs text-gray-400">
                      {(() => {
                        const suma = (cuotasPor.get(detalle.id) || []).reduce((s, c) => s + (parseFloat(cuotaDraft[c.id]?.monto ?? String(c.monto)) || 0), 0)
                        const dif = Math.round((suma - detalle.monto_total) * 100) / 100
                        return dif !== 0 ? <span className="text-amber-700">difiere del total en {formatMonto(dif)}</span> : 'cuadra con el total'
                      })()}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn-secondary" onClick={() => setDetalleId(null)} disabled={saving}>Cerrar</button>
              {canEdit && (
                <button className="btn-primary flex items-center gap-2" onClick={guardarCuotas} disabled={saving}>
                  <Save size={15} /> {saving ? 'Guardando...' : 'Guardar cuotas'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @media print {
          body *:not(#obligaciones-print):not(#obligaciones-print *):not(:has(#obligaciones-print)) { display: none !important; }
          body :has(#obligaciones-print) { display: block !important; height: auto !important; min-height: 0 !important; overflow: visible !important; }
          #obligaciones-print { padding: 0 !important; }
        }
      `}</style>
    </AppLayout>
  )
}

export default withPagePermission(ObligacionesPage, 'obligaciones', 'ver')
