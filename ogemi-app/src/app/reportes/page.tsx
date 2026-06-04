'use client'

import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { createClient } from '@/lib/supabase'
import { formatCurrency, formatDate, formatDateObj, tramoColor } from '@/lib/utils'
import { CarteraVencida } from '@/types'
import {
  Download, Filter, Search, X, TrendingUp, TrendingDown,
  FileText, ShoppingCart, CreditCard, Building2, BookOpen, BarChart2, ClipboardList
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend
} from 'recharts'

type ReporteTab = 'ventas' | 'presupuestos' | 'compras' | 'nc' | 'banco' | 'libros' | 'pivot'
type VentasSubTab = 'listado' | 'cartera' | 'porcliente' | 'pormes'
type PresupuestosSubTab = 'listado' | 'cartera' | 'porcliente' | 'pormes'
type ComprasSubTab = 'listado' | 'cxp' | 'porproveedor' | 'pormes'
type NcSubTab = 'listado' | 'porcliente'
type BancoSubTab = 'movimientos' | 'flujo' | 'cierres'
type LibroSubTab = 'venta' | 'compra'
type PivotSubTab = 'semanal' | 'antigüedad'

const TRAMO_LABELS: Record<string, string> = {
  'corriente': 'Al día', '1-30': '1–30 días',
  '31-60': '31–60 días', '61-90': '61–90 días', '+120': '+120 días',
}
const TRAMO_COLORS_HEX: Record<string, string> = {
  'corriente': '#22c55e', '1-30': '#facc15',
  '31-60': '#fb923c', '61-90': '#f87171', '+120': '#b91c1c',
}
const TRAMOS = ['corriente', '1-30', '31-60', '61-90', '+120'] as const
const PIE_COLORS = ['#0284c7','#7c3aed','#059669','#d97706','#dc2626','#0891b2','#4f46e5','#16a34a','#ea580c','#6b7280']

function isNC(tipoDoc: string) {
  const t = (tipoDoc || '').toUpperCase()
  return t.includes('NOTA') || t.includes('N/C') || t.includes('CREDITO')
}

function exportCSV(headers: string[], rows: any[][], filename: string) {
  const csv = [headers, ...rows].map(r => r.map(v => `"${v ?? ''}"`).join(',')).join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
}

// ============================================================
// VENCIMIENTO SEMANAL: próximos 4 viernes desde hoy
// ============================================================
function getNextFridays(n = 4): Date[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(today)
  const dow = d.getDay() // 0=dom, 5=vie
  const daysToFri = dow === 5 ? 7 : (5 - dow + 7) % 7 || 7
  d.setDate(d.getDate() + daysToFri)
  const fridays: Date[] = []
  for (let i = 0; i < n; i++) {
    fridays.push(new Date(d))
    d.setDate(d.getDate() + 7)
  }
  return fridays
}

function buildVencimientoViernes(facturas: any[], fridays: Date[]) {
  const lastFriday = fridays[fridays.length - 1]
  const rows = facturas
    .filter(f => {
      if (f.estado !== 'pendiente' || isNC(f.tipo_documento)) return false
      const fp = f.fecha_pago ? new Date(f.fecha_pago + 'T00:00:00') : null
      return fp !== null && fp <= lastFriday
    })
    .map(f => {
      const fp = new Date(f.fecha_pago + 'T00:00:00')
      const fridayIdx = fridays.findIndex(fri => fp <= fri)
      return { ...f, fridayIdx }
    })
    .sort((a, b) => (a.fecha_pago < b.fecha_pago ? -1 : 1))

  const totals = fridays.map((_, i) =>
    rows.filter(r => r.fridayIdx === i).reduce((s, r) => s + (r.total || 0), 0)
  )
  const grandTotal = totals.reduce((s, t) => s + t, 0)
  return { rows, totals, grandTotal }
}

// ============================================================
// PIVOT SEMANAL (antiguo — mantenido para compatibilidad)
// ============================================================
function buildPivotSemanal(
  facturas: any[],
  fechaDesde: string,
  fechaHasta: string
): { clientes: string[]; semanas: string[]; data: Record<string, Record<string, number>>; factByCliente: Record<string, any[]> } {
  const desde = new Date(fechaDesde + 'T00:00:00')
  const hasta = new Date(fechaHasta + 'T00:00:00')
  const semanas: { label: string; start: Date; end: Date }[] = []
  let cur = new Date(desde)
  let semNum = 1
  while (cur <= hasta) {
    const start = new Date(cur)
    const end = new Date(cur)
    end.setDate(end.getDate() + 6)
    if (end > hasta) end.setTime(hasta.getTime())
    semanas.push({
      label: `Sem ${semNum} (${formatDateObj(start).slice(0,5)}–${formatDateObj(end).slice(0,5)})`,
      start, end,
    })
    cur.setDate(cur.getDate() + 7)
    semNum++
  }
  const pending = facturas.filter(f => {
    if (f.estado !== 'pendiente' || f.total <= 0 || isNC(f.tipo_documento)) return false
    const fp = f.fecha_pago ? new Date(f.fecha_pago + 'T00:00:00') : null
    if (!fp) return false
    return fp >= desde && fp <= hasta
  })
  const clienteSet = new Set<string>()
  const data: Record<string, Record<string, number>> = {}
  const factByCliente: Record<string, any[]> = {}
  pending.forEach(f => {
    const cliente = f.clientes?.nombre || 'N/A'
    const fp = new Date(f.fecha_pago + 'T00:00:00')
    clienteSet.add(cliente)
    if (!data[cliente]) data[cliente] = {}
    if (!factByCliente[cliente]) factByCliente[cliente] = []
    factByCliente[cliente].push(f)
    const semana = semanas.find(s => fp >= s.start && fp <= s.end)
    if (semana) {
      data[cliente][semana.label] = (data[cliente][semana.label] || 0) + (f.total - (f.monto_pagado || 0))
    }
  })
  const clientes = Array.from(clienteSet).sort()
  return { clientes, semanas: semanas.map(s => s.label), data, factByCliente }
}

// ============================================================
// PIVOT ANTIGÜEDAD
// ============================================================
const BUCKETS = [
  { key: 'corriente', label: 'Al día' },
  { key: '1-30', label: '1–30 días' },
  { key: '31-60', label: '31–60 días' },
  { key: '61-90', label: '61–90 días' },
  { key: '+120', label: '+120 días' },
]

function buildPivotAntiguedad(cartera: CarteraVencida[]): {
  clientes: string[]
  data: Record<string, Record<string, number>>
  factByCliente: Record<string, any[]>
} {
  const clienteSet = new Set<string>()
  const data: Record<string, Record<string, number>> = {}
  const factByCliente: Record<string, any[]> = {}

  cartera.forEach(c => {
    clienteSet.add(c.cliente)
    if (!data[c.cliente]) data[c.cliente] = {}
    if (!factByCliente[c.cliente]) factByCliente[c.cliente] = []
    factByCliente[c.cliente].push(c)
    data[c.cliente][c.tramo] = (data[c.cliente][c.tramo] || 0) + (c.saldo_pendiente ?? c.total)
  })

  const clientes = Array.from(clienteSet).sort()
  return { clientes, data, factByCliente }
}

// ============================================================
// PÁGINA PRINCIPAL
// ============================================================
export default function ReportesPage() {
  const [tab, setTab] = useState<ReporteTab>('ventas')
  const [ventasTab, setVentasTab] = useState<VentasSubTab>('listado')
  const [presupuestosTab, setPresupuestosTab] = useState<PresupuestosSubTab>('listado')
  const [presupuestos, setPresupuestos] = useState<any[]>([])
  const [carteraPresupuestos, setCarteraPresupuestos] = useState<any[]>([])
  const [comprasTab, setComprasTab] = useState<ComprasSubTab>('listado')
  const [ncTab, setNcTab] = useState<NcSubTab>('listado')
  const [bancoTab, setBancoTab] = useState<BancoSubTab>('movimientos')
  const [libroTab, setLibroTab] = useState<LibroSubTab>('venta')
  const [pivotTab, setPivotTab] = useState<PivotSubTab>('semanal')
  const [loading, setLoading] = useState(false)

  const [search, setSearch] = useState('')
  const [fechaDesde, setFechaDesde] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0]
  })
  const [fechaHasta, setFechaHasta] = useState(new Date().toISOString().split('T')[0])

  // Pivot semanal: default hoy + 1 mes
  const [pivotDesde, setPivotDesde] = useState(new Date().toISOString().split('T')[0])
  const [pivotHasta, setPivotHasta] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() + 1); return d.toISOString().split('T')[0]
  })
  const [pivotExpandidos, setPivotExpandidos] = useState<Record<string, boolean>>({})
  const [antExpandidos, setAntExpandidos] = useState<Record<string, boolean>>({})

  const [facturas, setFacturas] = useState<any[]>([])
  const [compras, setCompras] = useState<any[]>([])
  const [cartera, setCartera] = useState<CarteraVencida[]>([])
  const [cxp, setCxp] = useState<any[]>([])
  const [movimientos, setMovimientos] = useState<any[]>([])
  const [cuentas, setCuentas] = useState<any[]>([])
  const [cierres, setCierres] = useState<any[]>([])
  const [saldos, setSaldos] = useState<Record<string, number>>({})
  const [cuentaSeleccionada, setCuentaSeleccionada] = useState('')

  const supabase = createClient()

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [
      { data: facturasData },
      { data: comprasData },
      { data: carteraData },
      { data: cxpData },
      { data: cuentasData },
      { data: presupuestosData },
      { data: carteraPresData },
    ] = await Promise.all([
      supabase.from('facturas').select('*, clientes(nombre)').order('fecha', { ascending: false }),
      supabase.from('compras').select('*, proveedores(nombre), banco_cuentas(nombre,banco)').order('fecha', { ascending: false }),
      supabase.from('cartera_vencida').select('*').order('dias_vencida', { ascending: false }),
      supabase.from('compras_vencidas').select('*').order('dias_vencida', { ascending: false }),
      supabase.from('banco_cuentas').select('*').order('nombre'),
      supabase.from('presupuestos').select('*, clientes(nombre)').order('fecha', { ascending: false }),
      supabase.from('cartera_presupuestos').select('*').order('dias_vencida', { ascending: false }),
    ])
    setFacturas(facturasData || [])
    setCompras(comprasData || [])
    setCartera(carteraData || [])
    setCxp(cxpData || [])
    setPresupuestos(presupuestosData || [])
    setCarteraPresupuestos(carteraPresData || [])
    setCuentas(cuentasData || [])
    if (cuentasData && cuentasData.length > 0 && !cuentaSeleccionada) {
      setCuentaSeleccionada(cuentasData[0].id)
    }

    const saldosMap: Record<string, number> = {}
    for (const c of (cuentasData || [])) {
      const { data: movs } = await supabase.from('banco_movimientos').select('tipo,monto').eq('cuenta_id', c.id)
      const ing = movs?.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + m.monto, 0) || 0
      const egr = movs?.filter(m => m.tipo === 'egreso').reduce((s, m) => s + m.monto, 0) || 0
      saldosMap[c.id] = (c.saldo_inicial || 0) + ing - egr
    }
    setSaldos(saldosMap)
    setLoading(false)
  }, [])

  const loadMovimientos = useCallback(async () => {
    if (!cuentaSeleccionada) return
    const q = supabase.from('banco_movimientos').select('*').eq('cuenta_id', cuentaSeleccionada).order('fecha', { ascending: false })
    if (fechaDesde) q.gte('fecha', fechaDesde)
    if (fechaHasta) q.lte('fecha', fechaHasta)
    const { data } = await q.limit(200)
    setMovimientos(data || [])
  }, [cuentaSeleccionada, fechaDesde, fechaHasta])

  const loadCierres = useCallback(async () => {
    const { data } = await supabase.from('cierre_mes').select('*, banco_cuentas(nombre,banco)').order('periodo', { ascending: false }).limit(24)
    setCierres(data || [])
  }, [])

  useEffect(() => { loadAll() }, [loadAll])
  useEffect(() => { if (bancoTab === 'movimientos') loadMovimientos() }, [bancoTab, cuentaSeleccionada, loadMovimientos])
  useEffect(() => { if (bancoTab === 'cierres') loadCierres() }, [bancoTab, loadCierres])

  // Derivados
  const ventas = facturas.filter(f => !isNC(f.tipo_documento))
  const nc = facturas.filter(f => isNC(f.tipo_documento))

  const ventasFiltradas = ventas.filter(f => {
    const ok1 = !search || (f.clientes?.nombre || '').toLowerCase().includes(search.toLowerCase()) || String(f.numero_factura).includes(search)
    const ok2 = !fechaDesde || f.fecha >= fechaDesde
    const ok3 = !fechaHasta || f.fecha <= fechaHasta
    return ok1 && ok2 && ok3
  })

  const comprasFiltradas = compras.filter(c => {
    const ok1 = !search || (c.proveedores?.nombre || '').toLowerCase().includes(search.toLowerCase()) || (c.concepto || '').toLowerCase().includes(search.toLowerCase())
    const ok2 = !fechaDesde || c.fecha >= fechaDesde
    const ok3 = !fechaHasta || c.fecha <= fechaHasta
    return ok1 && ok2 && ok3
  })

  const ncFiltradas = nc.filter(f => {
    const ok1 = !search || (f.clientes?.nombre || '').toLowerCase().includes(search.toLowerCase())
    const ok2 = !fechaDesde || f.fecha >= fechaDesde
    const ok3 = !fechaHasta || f.fecha <= fechaHasta
    return ok1 && ok2 && ok3
  })

  // Libro de Venta: ventas + NC filtradas
  const libroVentaFiltrado = [...ventasFiltradas, ...ncFiltradas].sort((a, b) => {
    if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1
    return (a.numero_factura || 0) - (b.numero_factura || 0)
  })

  // Libro de Compra: compras filtradas
  const libroCompraFiltrado = comprasFiltradas.slice().sort((a, b) => a.fecha < b.fecha ? -1 : 1)

  const ventasPorMes = (() => {
    const map: Record<string, { ventas: number; nc: number; count: number }> = {}
    ventas.forEach(f => {
      const m = f.fecha?.substring(0, 7) || ''
      if (!map[m]) map[m] = { ventas: 0, nc: 0, count: 0 }
      map[m].ventas += f.total || 0
      map[m].count++
    })
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0])).map(([mes, v]) => ({ mes, ...v }))
  })()

  const comprasPorMes = (() => {
    const map: Record<string, { total: number; count: number }> = {}
    compras.forEach(c => {
      const m = c.fecha?.substring(0, 7) || ''
      if (!map[m]) map[m] = { total: 0, count: 0 }
      map[m].total += c.total || 0
      map[m].count++
    })
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0])).map(([mes, v]) => ({ mes, ...v }))
  })()

  const topClientesVentas = (() => {
    const map: Record<string, number> = {}
    ventas.forEach(f => { const n = f.clientes?.nombre || 'N/A'; map[n] = (map[n] || 0) + (f.total || 0) })
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 15)
  })()

  const topProveedores = (() => {
    const map: Record<string, number> = {}
    compras.forEach(c => { const n = c.proveedores?.nombre || 'N/A'; map[n] = (map[n] || 0) + (c.total || 0) })
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 15)
  })()

  const presupuestosFiltrados = presupuestos.filter(p => {
    const ok1 = !search || (p.clientes?.nombre || '').toLowerCase().includes(search.toLowerCase()) || String(p.numero_presupuesto).includes(search)
    const ok2 = !fechaDesde || p.fecha >= fechaDesde
    const ok3 = !fechaHasta || p.fecha <= fechaHasta
    return ok1 && ok2 && ok3
  })

  const presupuestosPorMes = (() => {
    const map: Record<string, { total: number; count: number }> = {}
    presupuestos.forEach(p => {
      const m = p.fecha?.substring(0, 7) || ''
      if (!map[m]) map[m] = { total: 0, count: 0 }
      map[m].total += p.total || 0
      map[m].count++
    })
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0])).map(([mes, v]) => ({ mes, ...v }))
  })()

  const topClientesPresupuestos = (() => {
    const map: Record<string, number> = {}
    presupuestos.forEach(p => { const n = p.clientes?.nombre || 'N/A'; map[n] = (map[n] || 0) + (p.total || 0) })
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 15)
  })()

  const ncPorCliente = (() => {
    const map: Record<string, number> = {}
    nc.forEach(f => { const n = f.clientes?.nombre || 'N/A'; map[n] = (map[n] || 0) + Math.abs(f.total || 0) })
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  })()

  const flujoPorMes = (() => {
    const map: Record<string, { ingresos: number; egresos: number }> = {}
    movimientos.forEach(m => {
      const mes = (m.fecha || '').substring(0, 7)
      if (!map[mes]) map[mes] = { ingresos: 0, egresos: 0 }
      if (m.tipo === 'ingreso') map[mes].ingresos += m.monto || 0
      else map[mes].egresos += m.monto || 0
    })
    return Object.entries(map).sort().map(([mes, v]) => ({ mes, ...v, neto: v.ingresos - v.egresos }))
  })()

  // Pivot semanal — 4 semanas con fechas editables
  const [weekDates, setWeekDates] = useState<string[]>(() =>
    getNextFridays(4).map(d => d.toISOString().split('T')[0])
  )
  const weekDateObjs = weekDates.map(d => new Date(d + 'T00:00:00'))
  const vencViernes = buildVencimientoViernes(facturas, weekDateObjs)
  const [viernesSearch, setViernesSearch] = useState('')
  const [semanaFilter, setSemanaFilter] = useState<string>('all')
  const [noPagaraSet, setNoPagaraSet] = useState<Set<number>>(new Set())
  const viernesRows = vencViernes.rows.filter(r => {
    const matchSearch = !viernesSearch ||
      (r.clientes?.nombre || '').toLowerCase().includes(viernesSearch.toLowerCase()) ||
      String(r.numero_factura).includes(viernesSearch)
    const matchSemana = semanaFilter === 'all' || r.fridayIdx === parseInt(semanaFilter)
    return matchSearch && matchSemana
  })
  // Totales desglosados por No Pagará
  const totProbable = weekDateObjs.map((_, i) =>
    vencViernes.rows.filter(r => r.fridayIdx === i && !noPagaraSet.has(r.id))
      .reduce((s, r) => s + (r.total || 0), 0)
  )
  const totNoPaga = weekDateObjs.map((_, i) =>
    vencViernes.rows.filter(r => r.fridayIdx === i && noPagaraSet.has(r.id))
      .reduce((s, r) => s + (r.total || 0), 0)
  )
  const grandProbable = totProbable.reduce((s, t) => s + t, 0)
  const grandNoPaga = totNoPaga.reduce((s, t) => s + t, 0)

  // Pivot semanal (antiguo)
  const pivotSemanal = buildPivotSemanal(facturas, pivotDesde, pivotHasta)
  const pivotAnt = buildPivotAntiguedad(cartera)

  const tabs: { key: ReporteTab; label: string; icon: React.ElementType }[] = [
    { key: 'ventas',        label: 'Ventas',          icon: FileText },
    { key: 'presupuestos',  label: 'Presupuestos',    icon: ClipboardList },
    { key: 'compras',       label: 'Compras',         icon: ShoppingCart },
    { key: 'nc',      label: 'Notas de crédito', icon: CreditCard },
    { key: 'banco',   label: 'Banco',            icon: Building2 },
    { key: 'libros',  label: 'Libros',           icon: BookOpen },
    { key: 'pivot',   label: 'Cartera Pivot',    icon: BarChart2 },
  ]

  const FiltrosBar = ({ showSearch = true }: { showSearch?: boolean }) => (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      {showSearch && (
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-8 text-sm py-1.5" placeholder="Buscar..." value={search}
            onChange={e => setSearch(e.target.value)} />
        </div>
      )}
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500">Desde</label>
        <input type="date" className="input text-sm py-1.5 max-w-[140px]" value={fechaDesde}
          onChange={e => setFechaDesde(e.target.value)} />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500">Hasta</label>
        <input type="date" className="input text-sm py-1.5 max-w-[140px]" value={fechaHasta}
          onChange={e => setFechaHasta(e.target.value)} />
      </div>
      {(search || fechaDesde || fechaHasta) && (
        <button className="text-xs text-brand-600 hover:text-brand-800"
          onClick={() => { setSearch(''); setFechaDesde(''); setFechaHasta('') }}>
          <X size={12} className="inline mr-1" />Limpiar
        </button>
      )}
    </div>
  )

  return (
    <AppLayout>
      <Header title="Reportes" subtitle="Análisis financiero y contable" />

      {/* Main tabs */}
      <div className="bg-white border-b border-gray-200 px-6">
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map(t => {
            const Icon = t.icon
            return (
              <button key={t.key} onClick={() => { setTab(t.key); setSearch('') }}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  tab === t.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}>
                <Icon size={14} />{t.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex-1 overflow-auto">

        {/* ================================================================
            TAB: VENTAS
            ================================================================ */}
        {tab === 'ventas' && (
          <div className="p-6 space-y-4">
            <div className="flex gap-2 flex-wrap">
              {[
                { key: 'listado',    label: 'Listado' },
                { key: 'cartera',    label: 'Cartera vencida' },
                { key: 'porcliente', label: 'Por cliente' },
                { key: 'pormes',     label: 'Por período' },
              ].map(s => (
                <button key={s.key} onClick={() => setVentasTab(s.key as VentasSubTab)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    ventasTab === s.key ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}>
                  {s.label}
                </button>
              ))}
            </div>

            {ventasTab === 'listado' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <FiltrosBar />
                  <button className="btn-secondary flex items-center gap-2 text-sm py-1.5" onClick={() =>
                    exportCSV(
                      ['#Factura','Fecha','Cliente','Tipo Doc','Monto','ITBMS','Total','Estado','Vencimiento'],
                      ventasFiltradas.map(f => [f.numero_factura, f.fecha, f.clientes?.nombre, f.tipo_documento, f.monto, f.itbms, f.total, f.estado, f.fecha_pago]),
                      `ventas_${new Date().toISOString().split('T')[0]}.csv`
                    )
                  }>
                    <Download size={14} />Exportar
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: 'Total facturado', val: ventasFiltradas.reduce((s, f) => s + (f.total||0), 0), color: 'text-brand-700' },
                    { label: 'Cobrado', val: ventasFiltradas.filter(f=>f.estado==='pagada').reduce((s, f) => s+(f.total||0), 0), color: 'text-green-600' },
                    { label: 'Pendiente', val: ventasFiltradas.filter(f=>f.estado==='pendiente').reduce((s, f) => s+(f.total||0), 0), color: 'text-orange-600' },
                    { label: '# Facturas', val: ventasFiltradas.length, color: 'text-gray-700', isCnt: true },
                  ].map(s => (
                    <div key={s.label} className="card p-3">
                      <p className="text-xs text-gray-500">{s.label}</p>
                      <p className={`text-lg font-bold ${s.color}`}>{(s as any).isCnt ? s.val : formatCurrency(s.val as number)}</p>
                    </div>
                  ))}
                </div>
                <div className="card overflow-hidden">
                  <table className="w-full">
                    <thead><tr className="border-b border-gray-200">
                      <th className="table-header">#</th>
                      <th className="table-header">Fecha</th>
                      <th className="table-header">Cliente</th>
                      <th className="table-header">Tipo</th>
                      <th className="table-header text-right">Total</th>
                      <th className="table-header">Estado</th>
                      <th className="table-header">Vencimiento</th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {ventasFiltradas.length === 0 ? (
                        <tr><td colSpan={7} className="text-center py-8 text-gray-400">Sin resultados</td></tr>
                      ) : ventasFiltradas.slice(0, 200).map(f => (
                        <tr key={f.id} className="hover:bg-gray-50">
                          <td className="table-cell font-mono text-sm text-gray-500">#{f.numero_factura}</td>
                          <td className="table-cell text-sm">{formatDate(f.fecha)}</td>
                          <td className="table-cell max-w-[200px]"><span className="truncate block">{f.clientes?.nombre}</span></td>
                          <td className="table-cell text-xs text-gray-400">{f.tipo_documento}</td>
                          <td className="table-cell text-right font-semibold">{formatCurrency(f.total)}</td>
                          <td className="table-cell">
                            <span className={`badge ${f.estado==='pagada' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                              {f.estado==='pagada' ? 'Cobrada' : 'Pendiente'}
                            </span>
                          </td>
                          <td className="table-cell text-sm text-gray-400">{formatDate(f.fecha_pago)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {ventasTab === 'cartera' && (
              <div className="space-y-4">
                <div className="grid grid-cols-5 gap-3">
                  {TRAMOS.map(tramo => {
                    const items = cartera.filter(c => c.tramo === tramo)
                    return (
                      <div key={tramo} className="card p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-3 h-3 rounded-full" style={{ background: TRAMO_COLORS_HEX[tramo] }} />
                          <span className="text-xs font-medium text-gray-600">{TRAMO_LABELS[tramo]}</span>
                        </div>
                        <p className="text-lg font-bold">{formatCurrency(items.reduce((s,c)=>s+(c.saldo_pendiente??c.total),0))}</p>
                        <p className="text-xs text-gray-400">{items.length} facturas</p>
                      </div>
                    )
                  })}
                </div>
                <div className="card p-4 bg-brand-50 border-brand-200">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-brand-700">Total cartera pendiente</span>
                    <span className="text-2xl font-bold text-brand-800">{formatCurrency(cartera.reduce((s,c)=>s+(c.saldo_pendiente??c.total),0))}</span>
                  </div>
                </div>
                <div className="card overflow-hidden">
                  <table className="w-full">
                    <thead><tr className="border-b border-gray-200">
                      <th className="table-header">#Factura</th>
                      <th className="table-header">Fecha</th>
                      <th className="table-header">Cliente</th>
                      <th className="table-header">Vencimiento</th>
                      <th className="table-header text-right">Total</th>
                      <th className="table-header text-right">Saldo</th>
                      <th className="table-header text-right">Días</th>
                      <th className="table-header">Tramo</th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {cartera.map(c => (
                        <tr key={c.id} className="hover:bg-gray-50">
                          <td className="table-cell font-mono">#{c.numero_factura}</td>
                          <td className="table-cell text-sm text-gray-500">{formatDate(c.fecha)}</td>
                          <td className="table-cell max-w-[200px]"><span className="truncate block">{c.cliente}</span></td>
                          <td className="table-cell text-sm text-gray-500">{formatDate(c.fecha_pago)}</td>
                          <td className="table-cell text-right">{formatCurrency(c.total)}</td>
                          <td className="table-cell text-right font-semibold text-orange-600">{formatCurrency(c.saldo_pendiente ?? c.total)}</td>
                          <td className="table-cell text-right">
                            <span className={c.dias_vencida > 0 ? 'text-red-600 font-medium' : 'text-green-600'}>
                              {c.dias_vencida > 0 ? `+${c.dias_vencida}` : c.dias_vencida}
                            </span>
                          </td>
                          <td className="table-cell"><span className={`badge ${tramoColor(c.tramo)}`}>{TRAMO_LABELS[c.tramo]}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {ventasTab === 'porcliente' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="card p-5">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Top clientes</h3>
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={topClientesVentas.slice(0,10).map(([n,v])=>({ name: n.substring(0,18), monto: v }))}
                        layout="vertical" margin={{ left:10, right:30 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                        <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${(v/1000).toFixed(0)}k`} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={130} />
                        <Tooltip formatter={(v: number) => formatCurrency(v)} />
                        <Bar dataKey="monto" name="Ventas" fill="#0284c7" radius={[0,4,4,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="card p-5">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Distribución</h3>
                    <ResponsiveContainer width="100%" height={320}>
                      <PieChart>
                        <Pie data={topClientesVentas.slice(0,8).map(([n,v])=>({ name:n.substring(0,20), value:v }))}
                          cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2} dataKey="value">
                          {topClientesVentas.slice(0,8).map((_,i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v: number) => formatCurrency(v)} />
                        <Legend wrapperStyle={{ fontSize:'11px' }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

            {ventasTab === 'pormes' && (
              <div className="space-y-4">
                <div className="card p-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-4">Facturación mensual</h3>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={ventasPorMes} margin={{ top:5, right:20, bottom:5, left:10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="mes" tick={{ fontSize:11 }} />
                      <YAxis tick={{ fontSize:11 }} tickFormatter={(v: number) => `$${(v/1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: number) => formatCurrency(v)} />
                      <Bar dataKey="ventas" name="Ventas" fill="#0284c7" radius={[4,4,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================================================================
            TAB: PRESUPUESTOS
            ================================================================ */}
        {tab === 'presupuestos' && (
          <div className="p-6 space-y-4">
            <div className="flex gap-2 flex-wrap">
              {[
                { key: 'listado',    label: 'Listado' },
                { key: 'cartera',    label: 'Cartera vencida' },
                { key: 'porcliente', label: 'Por cliente' },
                { key: 'pormes',     label: 'Por período' },
              ].map(s => (
                <button key={s.key} onClick={() => setPresupuestosTab(s.key as PresupuestosSubTab)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    presupuestosTab === s.key ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}>
                  {s.label}
                </button>
              ))}
            </div>

            {presupuestosTab === 'listado' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <FiltrosBar />
                  <button className="btn-secondary flex items-center gap-2 text-sm py-1.5" onClick={() =>
                    exportCSV(
                      ['#Presupuesto','Fecha','Cliente','Tipo Doc','Monto','ITBMS','Total','Estado','Vencimiento'],
                      presupuestosFiltrados.map(p => [p.numero_presupuesto, p.fecha, p.clientes?.nombre, p.tipo_documento, p.monto, p.itbms, p.total, p.estado, p.fecha_pago]),
                      `presupuestos_${new Date().toISOString().split('T')[0]}.csv`
                    )
                  }>
                    <Download size={14} />Exportar
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: 'Total presupuestado', val: presupuestosFiltrados.reduce((s, p) => s + (p.total||0), 0), color: 'text-brand-700' },
                    { label: 'Cobrado', val: presupuestosFiltrados.filter(p=>p.estado==='pagada').reduce((s, p) => s+(p.total||0), 0), color: 'text-green-600' },
                    { label: 'Pendiente', val: presupuestosFiltrados.filter(p=>p.estado==='pendiente').reduce((s, p) => s+(p.total||0), 0), color: 'text-orange-600' },
                    { label: '# Presupuestos', val: presupuestosFiltrados.length, color: 'text-gray-700', isCnt: true },
                  ].map(s => (
                    <div key={s.label} className="card p-3">
                      <p className="text-xs text-gray-500">{s.label}</p>
                      <p className={`text-lg font-bold ${s.color}`}>{(s as any).isCnt ? s.val : formatCurrency(s.val as number)}</p>
                    </div>
                  ))}
                </div>
                <div className="card overflow-hidden">
                  <table className="w-full">
                    <thead><tr className="border-b border-gray-200">
                      <th className="table-header">#</th>
                      <th className="table-header">Fecha</th>
                      <th className="table-header">Cliente</th>
                      <th className="table-header">Tipo</th>
                      <th className="table-header text-right">Total</th>
                      <th className="table-header">Estado</th>
                      <th className="table-header">Vencimiento</th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {presupuestosFiltrados.length === 0 ? (
                        <tr><td colSpan={7} className="text-center py-8 text-gray-400">Sin resultados</td></tr>
                      ) : presupuestosFiltrados.slice(0, 200).map(p => (
                        <tr key={p.id} className="hover:bg-gray-50">
                          <td className="table-cell font-mono text-sm text-gray-500">#{p.numero_presupuesto}</td>
                          <td className="table-cell text-sm">{formatDate(p.fecha)}</td>
                          <td className="table-cell max-w-[200px]"><span className="truncate block">{p.clientes?.nombre}</span></td>
                          <td className="table-cell text-xs text-gray-400">{p.tipo_documento}</td>
                          <td className="table-cell text-right font-semibold">{formatCurrency(p.total)}</td>
                          <td className="table-cell">
                            <span className={`badge ${p.estado==='pagada' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                              {p.estado==='pagada' ? 'Cobrado' : 'Pendiente'}
                            </span>
                          </td>
                          <td className="table-cell text-sm text-gray-400">{formatDate(p.fecha_pago)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {presupuestosTab === 'cartera' && (
              <div className="space-y-4">
                <div className="grid grid-cols-5 gap-3">
                  {TRAMOS.map(tramo => {
                    const items = carteraPresupuestos.filter(c => c.tramo === tramo)
                    return (
                      <div key={tramo} className="card p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-3 h-3 rounded-full" style={{ background: TRAMO_COLORS_HEX[tramo] }} />
                          <span className="text-xs font-medium text-gray-600">{TRAMO_LABELS[tramo]}</span>
                        </div>
                        <p className="text-lg font-bold">{formatCurrency(items.reduce((s,c)=>s+(c.saldo_pendiente??c.total),0))}</p>
                        <p className="text-xs text-gray-400">{items.length} presupuestos</p>
                      </div>
                    )
                  })}
                </div>
                <div className="card p-4 bg-brand-50 border-brand-200">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-brand-700">Total cartera pendiente</span>
                    <span className="text-2xl font-bold text-brand-800">{formatCurrency(carteraPresupuestos.reduce((s,c)=>s+(c.saldo_pendiente??c.total),0))}</span>
                  </div>
                </div>
                <div className="card overflow-hidden">
                  <table className="w-full">
                    <thead><tr className="border-b border-gray-200">
                      <th className="table-header">#Presupuesto</th>
                      <th className="table-header">Fecha</th>
                      <th className="table-header">Cliente</th>
                      <th className="table-header">Vencimiento</th>
                      <th className="table-header text-right">Total</th>
                      <th className="table-header text-right">Saldo</th>
                      <th className="table-header text-right">Días</th>
                      <th className="table-header">Tramo</th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {carteraPresupuestos.map(c => (
                        <tr key={c.id} className="hover:bg-gray-50">
                          <td className="table-cell font-mono">#{c.numero_presupuesto}</td>
                          <td className="table-cell text-sm text-gray-500">{formatDate(c.fecha)}</td>
                          <td className="table-cell max-w-[200px]"><span className="truncate block">{c.cliente}</span></td>
                          <td className="table-cell text-sm text-gray-500">{formatDate(c.fecha_pago)}</td>
                          <td className="table-cell text-right">{formatCurrency(c.total)}</td>
                          <td className="table-cell text-right font-semibold text-orange-600">{formatCurrency(c.saldo_pendiente ?? c.total)}</td>
                          <td className="table-cell text-right">
                            <span className={c.dias_vencida > 0 ? 'text-red-600 font-medium' : 'text-green-600'}>
                              {c.dias_vencida > 0 ? `+${c.dias_vencida}` : c.dias_vencida}
                            </span>
                          </td>
                          <td className="table-cell"><span className={`badge ${tramoColor(c.tramo)}`}>{TRAMO_LABELS[c.tramo]}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {presupuestosTab === 'porcliente' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="card p-5">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Top clientes</h3>
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={topClientesPresupuestos.slice(0,10).map(([n,v])=>({ name: n.substring(0,18), monto: v }))}
                        layout="vertical" margin={{ left:10, right:30 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                        <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${(v/1000).toFixed(0)}k`} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={130} />
                        <Tooltip formatter={(v: number) => formatCurrency(v)} />
                        <Bar dataKey="monto" name="Presupuestos" fill="#7c3aed" radius={[0,4,4,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="card p-5">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Distribución</h3>
                    <ResponsiveContainer width="100%" height={320}>
                      <PieChart>
                        <Pie data={topClientesPresupuestos.slice(0,8).map(([n,v])=>({ name:n.substring(0,20), value:v }))}
                          cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2} dataKey="value">
                          {topClientesPresupuestos.slice(0,8).map((_,i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v: number) => formatCurrency(v)} />
                        <Legend wrapperStyle={{ fontSize:'11px' }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

            {presupuestosTab === 'pormes' && (
              <div className="space-y-4">
                <div className="card p-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-4">Presupuestos por período</h3>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={presupuestosPorMes} margin={{ top:5, right:20, bottom:5, left:10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="mes" tick={{ fontSize:11 }} />
                      <YAxis tick={{ fontSize:11 }} tickFormatter={(v: number) => `$${(v/1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: number) => formatCurrency(v)} />
                      <Bar dataKey="total" name="Presupuestos" fill="#7c3aed" radius={[4,4,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================================================================
            TAB: COMPRAS
            ================================================================ */}
        {tab === 'compras' && (
          <div className="p-6 space-y-4">
            <div className="flex gap-2 flex-wrap">
              {[
                { key: 'listado',      label: 'Listado' },
                { key: 'cxp',          label: 'Cuentas por pagar' },
                { key: 'porproveedor', label: 'Por proveedor' },
                { key: 'pormes',       label: 'Por período' },
              ].map(s => (
                <button key={s.key} onClick={() => setComprasTab(s.key as ComprasSubTab)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    comprasTab === s.key ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}>
                  {s.label}
                </button>
              ))}
            </div>

            {comprasTab === 'listado' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <FiltrosBar />
                  <button className="btn-secondary flex items-center gap-2 text-sm py-1.5" onClick={() =>
                    exportCSV(
                      ['Fecha','Proveedor','Concepto','Referencia','Monto','ITBMS','Total','Estado','Vencimiento'],
                      comprasFiltradas.map(c => [c.fecha, c.proveedores?.nombre, c.concepto, c.referencia, c.monto, c.itbms, c.total, c.estado, c.vencimiento]),
                      `compras_${new Date().toISOString().split('T')[0]}.csv`
                    )
                  }>
                    <Download size={14} />Exportar
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: 'Total compras', val: comprasFiltradas.reduce((s,c)=>s+(c.total||0),0), color:'text-brand-700' },
                    { label: 'Pagado', val: comprasFiltradas.filter(c=>c.estado==='pagada').reduce((s,c)=>s+(c.total||0),0), color:'text-green-600' },
                    { label: 'Pendiente', val: comprasFiltradas.filter(c=>c.estado==='pendiente').reduce((s,c)=>s+(c.total||0),0), color:'text-orange-600' },
                    { label: '# Compras', val: comprasFiltradas.length, color:'text-gray-700', isCnt: true },
                  ].map(s => (
                    <div key={s.label} className="card p-3">
                      <p className="text-xs text-gray-500">{s.label}</p>
                      <p className={`text-lg font-bold ${s.color}`}>{(s as any).isCnt ? s.val : formatCurrency(s.val as number)}</p>
                    </div>
                  ))}
                </div>
                <div className="card overflow-hidden">
                  <table className="w-full">
                    <thead><tr className="border-b border-gray-200">
                      <th className="table-header">Fecha</th>
                      <th className="table-header">Proveedor</th>
                      <th className="table-header">Concepto</th>
                      <th className="table-header text-right">Monto</th>
                      <th className="table-header text-right">ITBMS</th>
                      <th className="table-header text-right">Total</th>
                      <th className="table-header">Estado</th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {comprasFiltradas.length === 0 ? (
                        <tr><td colSpan={7} className="text-center py-8 text-gray-400">Sin resultados</td></tr>
                      ) : comprasFiltradas.slice(0,200).map(c => (
                        <tr key={c.id} className="hover:bg-gray-50">
                          <td className="table-cell text-sm">{formatDate(c.fecha)}</td>
                          <td className="table-cell font-medium">{c.proveedores?.nombre}</td>
                          <td className="table-cell text-sm text-gray-500 max-w-[150px]"><span className="truncate block">{c.concepto || '—'}</span></td>
                          <td className="table-cell text-right">{formatCurrency(c.monto)}</td>
                          <td className="table-cell text-right text-gray-400">{formatCurrency(c.itbms)}</td>
                          <td className="table-cell text-right font-semibold">{formatCurrency(c.total)}</td>
                          <td className="table-cell">
                            <span className={`badge ${c.estado==='pagada' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                              {c.estado==='pagada' ? 'Pagada' : 'Pendiente'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {comprasTab === 'cxp' && (
              <div className="space-y-4">
                <div className="grid grid-cols-5 gap-3">
                  {TRAMOS.map(tramo => {
                    const items = cxp.filter((c: any) => c.tramo === tramo)
                    return (
                      <div key={tramo} className="card p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-3 h-3 rounded-full" style={{ background: TRAMO_COLORS_HEX[tramo] }} />
                          <span className="text-xs font-medium text-gray-600">{TRAMO_LABELS[tramo]}</span>
                        </div>
                        <p className="text-lg font-bold">{formatCurrency(items.reduce((s:number,c:any)=>s+c.total,0))}</p>
                        <p className="text-xs text-gray-400">{items.length} compras</p>
                      </div>
                    )
                  })}
                </div>
                <div className="card overflow-hidden">
                  <table className="w-full">
                    <thead><tr className="border-b border-gray-200">
                      <th className="table-header">Proveedor</th>
                      <th className="table-header">Concepto</th>
                      <th className="table-header">Vencimiento</th>
                      <th className="table-header text-right">Días</th>
                      <th className="table-header text-right">Total</th>
                      <th className="table-header">Tramo</th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {cxp.map((c: any) => (
                        <tr key={c.id} className="hover:bg-gray-50">
                          <td className="table-cell font-medium">{c.proveedor}</td>
                          <td className="table-cell text-sm text-gray-500">{c.concepto || '—'}</td>
                          <td className="table-cell text-sm text-gray-400">{formatDate(c.vencimiento)}</td>
                          <td className="table-cell text-right">
                            <span className={c.dias_vencida > 0 ? 'text-red-600 font-medium' : 'text-green-600'}>
                              {c.dias_vencida > 0 ? `+${c.dias_vencida}` : c.dias_vencida}
                            </span>
                          </td>
                          <td className="table-cell text-right font-semibold">{formatCurrency(c.total)}</td>
                          <td className="table-cell">
                            <span className="badge text-xs" style={{ backgroundColor: TRAMO_COLORS_HEX[c.tramo]+'20', color: TRAMO_COLORS_HEX[c.tramo] }}>
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

            {comprasTab === 'porproveedor' && (
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Top proveedores</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={topProveedores.slice(0,10).map(([n,v])=>({ name: n.substring(0,18), monto: v }))}
                    layout="vertical" margin={{ left:10, right:30 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                    <XAxis type="number" tick={{ fontSize:11 }} tickFormatter={(v: number) => `$${(v/1000).toFixed(0)}k`} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize:10 }} width={130} />
                    <Tooltip formatter={(v: number) => formatCurrency(v)} />
                    <Bar dataKey="monto" name="Compras" fill="#f97316" radius={[0,4,4,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {comprasTab === 'pormes' && (
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-4">Compras mensuales</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={comprasPorMes} margin={{ top:5, right:20, bottom:5, left:10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="mes" tick={{ fontSize:11 }} />
                    <YAxis tick={{ fontSize:11 }} tickFormatter={(v: number) => `$${(v/1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => formatCurrency(v)} />
                    <Bar dataKey="total" name="Compras" fill="#f97316" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* ================================================================
            TAB: NOTAS DE CRÉDITO
            ================================================================ */}
        {tab === 'nc' && (
          <div className="p-6 space-y-4">
            <div className="flex gap-2 mb-2">
              {[{ key: 'listado', label: 'Listado' }, { key: 'porcliente', label: 'Por cliente' }].map(s => (
                <button key={s.key} onClick={() => setNcTab(s.key as NcSubTab)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    ncTab === s.key ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}>
                  {s.label}
                </button>
              ))}
            </div>
            {ncTab === 'listado' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <FiltrosBar />
                  <button className="btn-secondary flex items-center gap-2 text-sm py-1.5" onClick={() =>
                    exportCSV(
                      ['#Documento','Fecha','Cliente','Tipo','Doc.Afectado','Monto','ITBMS','Total'],
                      ncFiltradas.map(f => [f.numero_factura, f.fecha, f.clientes?.nombre, f.tipo_documento, f.documento_afectado, f.monto, f.itbms, f.total]),
                      `notas_credito_${new Date().toISOString().split('T')[0]}.csv`
                    )
                  }>
                    <Download size={14} />Exportar
                  </button>
                </div>
                <div className="card overflow-hidden">
                  <table className="w-full">
                    <thead><tr className="border-b border-gray-200">
                      <th className="table-header">#Doc</th>
                      <th className="table-header">Fecha</th>
                      <th className="table-header">Cliente</th>
                      <th className="table-header">Tipo</th>
                      <th className="table-header">Doc. Afectado</th>
                      <th className="table-header text-right">Monto</th>
                      <th className="table-header text-right">Total</th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {ncFiltradas.length === 0 ? (
                        <tr><td colSpan={7} className="text-center py-8 text-gray-400">Sin notas de crédito</td></tr>
                      ) : ncFiltradas.map(f => (
                        <tr key={f.id} className="hover:bg-gray-50">
                          <td className="table-cell font-mono text-sm text-gray-500">#{f.numero_factura}</td>
                          <td className="table-cell text-sm">{formatDate(f.fecha)}</td>
                          <td className="table-cell max-w-[180px]"><span className="truncate block">{f.clientes?.nombre}</span></td>
                          <td className="table-cell text-xs text-amber-600">{f.tipo_documento}</td>
                          <td className="table-cell text-sm text-gray-400">{f.documento_afectado ? `#${f.documento_afectado}` : '—'}</td>
                          <td className="table-cell text-right">{formatCurrency(Math.abs(f.monto))}</td>
                          <td className="table-cell text-right font-semibold text-amber-700">{formatCurrency(Math.abs(f.total))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {ncTab === 'porcliente' && (
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Notas de crédito por cliente</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={ncPorCliente.slice(0,15).map(([n,v])=>({ name:n.substring(0,20), monto:v }))}
                    layout="vertical" margin={{ left:10, right:30 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                    <XAxis type="number" tick={{ fontSize:11 }} tickFormatter={(v: number) => `$${(v/1000).toFixed(0)}k`} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize:10 }} width={140} />
                    <Tooltip formatter={(v: number) => formatCurrency(v)} />
                    <Bar dataKey="monto" name="NC" fill="#d97706" radius={[0,4,4,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* ================================================================
            TAB: BANCO
            ================================================================ */}
        {tab === 'banco' && (
          <div className="p-6 space-y-4">
            <div className="flex gap-2 flex-wrap mb-2">
              {[{ key: 'movimientos', label: 'Movimientos' }, { key: 'flujo', label: 'Flujo de caja' }, { key: 'cierres', label: 'Cierres de mes' }].map(s => (
                <button key={s.key} onClick={() => setBancoTab(s.key as BancoSubTab)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    bancoTab === s.key ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}>
                  {s.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {cuentas.map(c => (
                <div key={c.id} className="card p-4">
                  <p className="text-xs text-gray-500">{c.nombre} · {c.banco}</p>
                  <p className={`text-xl font-bold mt-0.5 ${(saldos[c.id]||0) >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {formatCurrency(saldos[c.id] || 0)}
                  </p>
                </div>
              ))}
            </div>

            {bancoTab === 'movimientos' && (
              <div className="space-y-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <select className="input text-sm py-1.5 max-w-[240px]" value={cuentaSeleccionada}
                    onChange={e => setCuentaSeleccionada(e.target.value)}>
                    {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre} – {c.banco}</option>)}
                  </select>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-500">Desde</label>
                    <input type="date" className="input text-sm py-1.5 max-w-[140px]" value={fechaDesde}
                      onChange={e => setFechaDesde(e.target.value)} />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-500">Hasta</label>
                    <input type="date" className="input text-sm py-1.5 max-w-[140px]" value={fechaHasta}
                      onChange={e => setFechaHasta(e.target.value)} />
                  </div>
                  <button className="btn-secondary text-sm py-1.5 flex items-center gap-1"
                    onClick={() => exportCSV(
                      ['Fecha','Tipo','Concepto','Referencia','Monto'],
                      movimientos.map(m => [m.fecha, m.tipo, m.concepto, m.referencia, m.monto]),
                      `movimientos_${new Date().toISOString().split('T')[0]}.csv`
                    )}>
                    <Download size={14} />Exportar
                  </button>
                </div>
                <div className="card overflow-hidden">
                  <table className="w-full">
                    <thead><tr className="border-b border-gray-200">
                      <th className="table-header">Fecha</th>
                      <th className="table-header">Concepto</th>
                      <th className="table-header">Referencia</th>
                      <th className="table-header">Tipo</th>
                      <th className="table-header text-right">Monto</th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {movimientos.length === 0 ? (
                        <tr><td colSpan={5} className="text-center py-8 text-gray-400">Sin movimientos</td></tr>
                      ) : movimientos.map(m => (
                        <tr key={m.id} className="hover:bg-gray-50">
                          <td className="table-cell text-sm">{formatDate(m.fecha)}</td>
                          <td className="table-cell">{m.concepto}</td>
                          <td className="table-cell text-xs text-gray-400">{m.referencia || '—'}</td>
                          <td className="table-cell">
                            <span className={`badge flex items-center gap-1 w-fit ${m.tipo==='ingreso'?'bg-green-100 text-green-700':'bg-red-100 text-red-700'}`}>
                              {m.tipo==='ingreso' ? <TrendingUp size={11}/> : <TrendingDown size={11}/>}
                              {m.tipo}
                            </span>
                          </td>
                          <td className={`table-cell text-right font-semibold ${m.tipo==='ingreso'?'text-green-700':'text-red-600'}`}>
                            {m.tipo==='egreso'?'-':''}{formatCurrency(m.monto)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {bancoTab === 'flujo' && (
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-4">Flujo de caja mensual</h3>
                {flujoPorMes.length === 0 ? (
                  <div className="h-48 flex items-center justify-center text-gray-400 text-sm">Sin datos</div>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={flujoPorMes} margin={{ top:5, right:20, bottom:5, left:10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="mes" tick={{ fontSize:11 }} />
                      <YAxis tick={{ fontSize:11 }} tickFormatter={(v: number) => `$${(v/1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: number) => formatCurrency(v)} />
                      <Legend wrapperStyle={{ fontSize:'12px' }} />
                      <Bar dataKey="ingresos" name="Ingresos" fill="#22c55e" radius={[4,4,0,0]} />
                      <Bar dataKey="egresos" name="Egresos" fill="#ef4444" radius={[4,4,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            )}

            {bancoTab === 'cierres' && (
              <div className="card overflow-hidden">
                <table className="w-full">
                  <thead><tr className="border-b border-gray-200">
                    <th className="table-header">Período</th>
                    <th className="table-header">Cuenta</th>
                    <th className="table-header text-right">Saldo sistema</th>
                    <th className="table-header text-right">Saldo banco</th>
                    <th className="table-header text-right">Diferencia</th>
                    <th className="table-header">Estado</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {cierres.length === 0 ? (
                      <tr><td colSpan={6} className="text-center py-8 text-gray-400">Sin cierres</td></tr>
                    ) : cierres.map(c => (
                      <tr key={c.id} className="hover:bg-gray-50">
                        <td className="table-cell font-medium">{c.periodo}</td>
                        <td className="table-cell text-sm text-gray-500">{(c.banco_cuentas as any)?.nombre}</td>
                        <td className="table-cell text-right">{formatCurrency(c.saldo_sistema)}</td>
                        <td className="table-cell text-right">{formatCurrency(c.saldo_banco)}</td>
                        <td className={`table-cell text-right font-semibold ${Math.abs(c.diferencia) < 0.01 ? 'text-green-600' : 'text-red-600'}`}>
                          {c.diferencia >= 0 ? '+' : ''}{formatCurrency(c.diferencia)}
                        </td>
                        <td className="table-cell">
                          <span className={`badge ${c.cerrado ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                            {c.cerrado ? 'Cerrado' : 'Abierto'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ================================================================
            TAB: LIBROS CONTABLES (Libro de Venta y Libro de Compra)
            ================================================================ */}
        {tab === 'libros' && (
          <div className="p-6 space-y-4">
            <div className="flex gap-2 flex-wrap">
              {[{ key: 'venta', label: 'Libro de Venta' }, { key: 'compra', label: 'Libro de Compra' }].map(s => (
                <button key={s.key} onClick={() => setLibroTab(s.key as LibroSubTab)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    libroTab === s.key ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}>
                  {s.label}
                </button>
              ))}
            </div>

            {/* LIBRO DE VENTA */}
            {libroTab === 'venta' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <FiltrosBar showSearch={false} />
                  <button className="btn-secondary flex items-center gap-2 text-sm py-1.5" onClick={() =>
                    exportCSV(
                      ['N°','Fecha','Cliente','Tipo Documento','Doc. Afectado','Monto Gravable','ITBMS','Total'],
                      libroVentaFiltrado.map((f, i) => [
                        i + 1, f.fecha, f.clientes?.nombre, f.tipo_documento,
                        f.documento_afectado || '', f.monto, f.itbms, f.total
                      ]),
                      `libro_venta_${fechaDesde}_${fechaHasta}.csv`
                    )
                  }>
                    <Download size={14} />Exportar CSV
                  </button>
                </div>

                {/* Resumen del período */}
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: 'Total ventas', val: ventasFiltradas.reduce((s,f)=>s+(f.total||0),0), color:'text-brand-700' },
                    { label: 'Total NC', val: ncFiltradas.reduce((s,f)=>s+Math.abs(f.total||0),0), color:'text-amber-600' },
                    { label: 'ITBMS recaudado', val: ventasFiltradas.reduce((s,f)=>s+(f.itbms||0),0), color:'text-purple-600' },
                    { label: 'Neto (Ventas - NC)', val: ventasFiltradas.reduce((s,f)=>s+(f.total||0),0) - ncFiltradas.reduce((s,f)=>s+Math.abs(f.total||0),0), color:'text-green-700' },
                  ].map(s => (
                    <div key={s.label} className="card p-3">
                      <p className="text-xs text-gray-500">{s.label}</p>
                      <p className={`text-lg font-bold ${s.color}`}>{formatCurrency(s.val as number)}</p>
                    </div>
                  ))}
                </div>

                <div className="card overflow-hidden">
                  <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                      Libro de Ventas · {fechaDesde} al {fechaHasta}
                    </p>
                  </div>
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50">
                        <th className="table-header w-10">N°</th>
                        <th className="table-header">Fecha</th>
                        <th className="table-header">#Factura</th>
                        <th className="table-header">Cliente</th>
                        <th className="table-header">Tipo Documento</th>
                        <th className="table-header">Doc. Afectado</th>
                        <th className="table-header text-right">Monto Gravable</th>
                        <th className="table-header text-right">ITBMS (7%)</th>
                        <th className="table-header text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {libroVentaFiltrado.length === 0 ? (
                        <tr><td colSpan={9} className="text-center py-8 text-gray-400">Sin registros en el período</td></tr>
                      ) : libroVentaFiltrado.map((f, i) => {
                        const esNC = isNC(f.tipo_documento)
                        return (
                          <tr key={f.id} className={`hover:bg-gray-50 ${esNC ? 'bg-amber-50/40' : ''}`}>
                            <td className="table-cell text-gray-400 text-xs w-10">{i + 1}</td>
                            <td className="table-cell text-sm">{formatDate(f.fecha)}</td>
                            <td className="table-cell font-mono text-sm">#{f.numero_factura}</td>
                            <td className="table-cell max-w-[180px]">
                              <span className="truncate block text-sm">{f.clientes?.nombre}</span>
                            </td>
                            <td className="table-cell">
                              <span className={`badge text-xs ${esNC ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                                {f.tipo_documento}
                              </span>
                            </td>
                            <td className="table-cell text-sm text-gray-400">
                              {f.documento_afectado ? `#${f.documento_afectado}` : '—'}
                            </td>
                            <td className="table-cell text-right">
                              <span className={esNC ? 'text-amber-600' : ''}>{formatCurrency(Math.abs(f.monto))}</span>
                            </td>
                            <td className="table-cell text-right text-gray-500">{formatCurrency(Math.abs(f.itbms))}</td>
                            <td className="table-cell text-right font-semibold">
                              <span className={esNC ? 'text-amber-700' : 'text-brand-700'}>{formatCurrency(Math.abs(f.total))}</span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                        <td colSpan={6} className="table-cell text-right text-sm text-gray-600">TOTALES</td>
                        <td className="table-cell text-right text-brand-700">
                          {formatCurrency(libroVentaFiltrado.reduce((s,f)=>s+Math.abs(f.monto||0),0))}
                        </td>
                        <td className="table-cell text-right text-gray-600">
                          {formatCurrency(libroVentaFiltrado.reduce((s,f)=>s+Math.abs(f.itbms||0),0))}
                        </td>
                        <td className="table-cell text-right text-brand-800">
                          {formatCurrency(libroVentaFiltrado.reduce((s,f)=>s+Math.abs(f.total||0),0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            {/* LIBRO DE COMPRA */}
            {libroTab === 'compra' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <FiltrosBar showSearch={false} />
                  <button className="btn-secondary flex items-center gap-2 text-sm py-1.5" onClick={() =>
                    exportCSV(
                      ['N°','Fecha','Proveedor','Concepto','Referencia','Monto Gravable','ITBMS','Total','Estado'],
                      libroCompraFiltrado.map((c, i) => [
                        i + 1, c.fecha, c.proveedores?.nombre, c.concepto || '',
                        c.referencia || '', c.monto, c.itbms, c.total, c.estado
                      ]),
                      `libro_compra_${fechaDesde}_${fechaHasta}.csv`
                    )
                  }>
                    <Download size={14} />Exportar CSV
                  </button>
                </div>

                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: 'Total compras', val: libroCompraFiltrado.reduce((s,c)=>s+(c.total||0),0), color:'text-orange-600' },
                    { label: 'ITBMS acreditable', val: libroCompraFiltrado.reduce((s,c)=>s+(c.itbms||0),0), color:'text-purple-600' },
                    { label: 'Pagadas', val: libroCompraFiltrado.filter(c=>c.estado==='pagada').reduce((s,c)=>s+(c.total||0),0), color:'text-green-600' },
                    { label: 'Pendientes', val: libroCompraFiltrado.filter(c=>c.estado==='pendiente').reduce((s,c)=>s+(c.total||0),0), color:'text-red-600' },
                  ].map(s => (
                    <div key={s.label} className="card p-3">
                      <p className="text-xs text-gray-500">{s.label}</p>
                      <p className={`text-lg font-bold ${s.color}`}>{formatCurrency(s.val as number)}</p>
                    </div>
                  ))}
                </div>

                <div className="card overflow-hidden">
                  <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                      Libro de Compras · {fechaDesde} al {fechaHasta}
                    </p>
                  </div>
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50">
                        <th className="table-header w-10">N°</th>
                        <th className="table-header">Fecha</th>
                        <th className="table-header">Proveedor</th>
                        <th className="table-header">Concepto</th>
                        <th className="table-header">Referencia</th>
                        <th className="table-header text-right">Monto Gravable</th>
                        <th className="table-header text-right">ITBMS (7%)</th>
                        <th className="table-header text-right">Total</th>
                        <th className="table-header">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {libroCompraFiltrado.length === 0 ? (
                        <tr><td colSpan={9} className="text-center py-8 text-gray-400">Sin registros en el período</td></tr>
                      ) : libroCompraFiltrado.map((c, i) => (
                        <tr key={c.id} className="hover:bg-gray-50">
                          <td className="table-cell text-gray-400 text-xs">{i + 1}</td>
                          <td className="table-cell text-sm">{formatDate(c.fecha)}</td>
                          <td className="table-cell font-medium max-w-[150px]">
                            <span className="truncate block">{c.proveedores?.nombre}</span>
                          </td>
                          <td className="table-cell text-sm text-gray-500 max-w-[150px]">
                            <span className="truncate block">{c.concepto || '—'}</span>
                          </td>
                          <td className="table-cell text-sm font-mono text-gray-400">{c.referencia || '—'}</td>
                          <td className="table-cell text-right">{formatCurrency(c.monto)}</td>
                          <td className="table-cell text-right text-gray-500">{formatCurrency(c.itbms)}</td>
                          <td className="table-cell text-right font-semibold text-orange-700">{formatCurrency(c.total)}</td>
                          <td className="table-cell">
                            <span className={`badge text-xs ${c.estado==='pagada' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                              {c.estado==='pagada' ? 'Pagada' : 'Pendiente'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                        <td colSpan={5} className="table-cell text-right text-sm text-gray-600">TOTALES</td>
                        <td className="table-cell text-right text-orange-700">
                          {formatCurrency(libroCompraFiltrado.reduce((s,c)=>s+(c.monto||0),0))}
                        </td>
                        <td className="table-cell text-right text-gray-600">
                          {formatCurrency(libroCompraFiltrado.reduce((s,c)=>s+(c.itbms||0),0))}
                        </td>
                        <td className="table-cell text-right text-orange-800">
                          {formatCurrency(libroCompraFiltrado.reduce((s,c)=>s+(c.total||0),0))}
                        </td>
                        <td className="table-cell" />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================================================================
            TAB: PIVOT CARTERA
            ================================================================ */}
        {tab === 'pivot' && (
          <div className="p-6 space-y-4">
            <div className="flex gap-2 flex-wrap">
              {[{ key: 'semanal', label: 'Vencimientos por semana' }, { key: 'antigüedad', label: 'Antigüedad de cartera' }].map(s => (
                <button key={s.key} onClick={() => setPivotTab(s.key as PivotSubTab)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    pivotTab === s.key ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}>
                  {s.label}
                </button>
              ))}
            </div>

            {/* VENCIMIENTO POR VIERNES */}
            {pivotTab === 'semanal' && (
              <div className="space-y-4">
                {/* Encabezado */}
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-700">Vencimientos — próximas 4 semanas</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {vencViernes.rows.length} facturas pendientes
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative">
                      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        className="input pl-8 text-sm py-1.5 max-w-[220px]"
                        placeholder="Buscar cliente o #..."
                        value={viernesSearch}
                        onChange={e => setViernesSearch(e.target.value)}
                      />
                    </div>
                    <select
                      value={semanaFilter}
                      onChange={e => setSemanaFilter(e.target.value)}
                      className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 bg-white focus:outline-none focus:border-gray-400"
                    >
                      <option value="all">Todas las semanas</option>
                      <option value="0">Semana 1</option>
                      <option value="1">Semana 2</option>
                      <option value="2">Semana 3</option>
                      <option value="3">Semana 4</option>
                    </select>
                  </div>
                </div>

                {/* KPI Cards */}
                {(() => {
                  const colors = [
                    { bg: 'bg-red-50',    border: 'border-red-500',    text: 'text-red-700',    label: 'text-red-500' },
                    { bg: 'bg-orange-50', border: 'border-orange-400', text: 'text-orange-700', label: 'text-orange-500' },
                    { bg: 'bg-yellow-50', border: 'border-yellow-400', text: 'text-yellow-700', label: 'text-yellow-600' },
                    { bg: 'bg-green-50',  border: 'border-green-600',  text: 'text-green-700',  label: 'text-green-600' },
                  ]
                  return (
                    <div className="grid grid-cols-4 gap-3">
                      {weekDateObjs.map((_, i) => {
                        const c = colors[i]
                        const cnt = vencViernes.rows.filter(r => r.fridayIdx === i).length
                        return (
                          <div key={i} className={`card p-4 border-t-4 ${c.bg} ${c.border}`}>
                            <p className={`text-xs font-semibold uppercase tracking-wide ${c.label}`}>
                              Semana {i + 1}
                            </p>
                            <input
                              type="date"
                              value={weekDates[i]}
                              onChange={e => {
                                const nd = [...weekDates]
                                nd[i] = e.target.value
                                setWeekDates(nd)
                              }}
                              className="text-xs text-gray-600 border border-gray-200 rounded px-1.5 py-0.5 mt-0.5 mb-2 w-full bg-white focus:outline-none focus:border-gray-400"
                            />
                            <p className={`text-lg font-bold ${c.text}`}>
                              {formatCurrency(vencViernes.totals[i])}
                            </p>
                            <p className="text-xs text-gray-400 mt-1">
                              {cnt} {cnt === 1 ? 'factura' : 'facturas'}
                            </p>
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}

                {/* Total general */}
                <div className="card p-4 bg-brand-50 border border-brand-200 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-brand-700">Total general vencido</span>
                    <span className="text-2xl font-bold text-brand-900">{formatCurrency(vencViernes.grandTotal)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-green-600 font-medium">↳ Probable pago</span>
                    <span className="text-sm font-bold text-green-700">{formatCurrency(grandProbable)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-red-500 font-medium">↳ No pagará</span>
                    <span className="text-sm font-bold text-red-600">{formatCurrency(grandNoPaga)}</span>
                  </div>
                </div>

                {/* Tabla */}
                {vencViernes.rows.length === 0 ? (
                  <div className="card p-12 text-center text-gray-400">
                    No hay facturas pendientes en las próximas 4 semanas
                  </div>
                ) : (
                  <div className="card overflow-auto">
                    <table className="w-full min-w-max">
                      <thead>
                        <tr className="border-b-2 border-gray-300 bg-gray-50">
                          <th className="table-header text-left sticky left-0 bg-gray-50 z-10 min-w-[200px]">Cliente</th>
                          <th className="table-header text-center min-w-[90px]">Nº Factura</th>
                          <th className="table-header text-center min-w-[100px]">F. Factura</th>
                          <th className="table-header text-center min-w-[100px]">F. Vencimiento</th>
                          {weekDateObjs.map((fri, i) => (
                            <th key={i} className="table-header text-right min-w-[120px]">
                              Sem {i + 1}<br />
                              <span className="font-normal text-[10px] opacity-80">
                                {formatDateObj(fri).slice(0, 5)}
                              </span>
                            </th>
                          ))}
                          <th className="table-header text-center min-w-[60px] text-[11px]">No<br/>Pagará</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {viernesRows.map((f: any) => {
                          const isNoPaga = noPagaraSet.has(f.id)
                          return (
                          <tr key={f.id} className={`hover:bg-gray-50 transition-opacity ${isNoPaga ? 'opacity-50 bg-red-50/40' : ''}`}>
                            <td className={`table-cell sticky left-0 z-10 max-w-[220px] ${isNoPaga ? 'bg-red-50' : 'bg-white'}`}>
                              <span className="truncate block text-sm">{f.clientes?.nombre || '—'}</span>
                            </td>
                            <td className="table-cell text-center font-mono text-sm text-gray-500">#{f.numero_factura}</td>
                            <td className="table-cell text-center text-sm text-gray-400">{formatDate(f.fecha)}</td>
                            <td className="table-cell text-center text-sm font-semibold text-red-600">{formatDate(f.fecha_pago)}</td>
                            {weekDateObjs.map((_, i) => (
                              <td key={i} className="table-cell text-right text-sm">
                                {f.fridayIdx === i
                                  ? <span className={i === 0 ? 'font-semibold text-red-600' : 'font-medium text-gray-700'}>
                                      {formatCurrency(f.total)}
                                    </span>
                                  : <span className="text-gray-200">—</span>
                                }
                              </td>
                            ))}
                            <td className="table-cell text-center">
                              <input
                                type="checkbox"
                                checked={isNoPaga}
                                onChange={e => {
                                  setNoPagaraSet(prev => {
                                    const next = new Set(prev)
                                    if (e.target.checked) next.add(f.id)
                                    else next.delete(f.id)
                                    return next
                                  })
                                }}
                                className="w-4 h-4 accent-red-600 cursor-pointer"
                                title="Marcar como No Pagará"
                              />
                            </td>
                          </tr>
                          )
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-gray-400 bg-gray-100 font-bold">
                          <td colSpan={4} className="table-cell text-right sticky left-0 bg-gray-100 z-10 text-sm text-gray-600">
                            TOTAL VENCIDO
                          </td>
                          {vencViernes.totals.map((t, i) => (
                            <td key={i} className="table-cell text-right text-brand-800">
                              {t > 0 ? formatCurrency(t) : '—'}
                            </td>
                          ))}
                          <td className="table-cell" />
                        </tr>
                        <tr className="bg-green-50 text-xs font-semibold">
                          <td colSpan={4} className="table-cell text-right sticky left-0 bg-green-50 z-10 text-green-700">
                            ↳ Probable Pago
                          </td>
                          {totProbable.map((t, i) => (
                            <td key={i} className="table-cell text-right text-green-700">
                              {t > 0 ? formatCurrency(t) : '—'}
                            </td>
                          ))}
                          <td className="table-cell" />
                        </tr>
                        <tr className="bg-red-50 text-xs font-semibold">
                          <td colSpan={4} className="table-cell text-right sticky left-0 bg-red-50 z-10 text-red-600">
                            ↳ No Pagará
                          </td>
                          {totNoPaga.map((t, i) => (
                            <td key={i} className="table-cell text-right text-red-600">
                              {t > 0 ? formatCurrency(t) : '—'}
                            </td>
                          ))}
                          <td className="table-cell" />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}

                {viernesSearch && viernesRows.length === 0 && (
                  <p className="text-center text-gray-400 text-sm">Sin resultados para "{viernesSearch}"</p>
                )}
              </div>
            )}

            {/* PIVOT ANTIGÜEDAD */}
            {pivotTab === 'antigüedad' && (
              <div className="space-y-4">
                {/* KPIs por tramo */}
                <div className="grid grid-cols-5 gap-3">
                  {BUCKETS.map(bucket => {
                    const total = pivotAnt.clientes.reduce((s, c) => s + (pivotAnt.data[c]?.[bucket.key] || 0), 0)
                    return (
                      <div key={bucket.key} className="card p-4">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="w-3 h-3 rounded-full" style={{ background: TRAMO_COLORS_HEX[bucket.key] }} />
                          <span className="text-xs font-medium text-gray-600">{bucket.label}</span>
                        </div>
                        <p className="text-lg font-bold">{formatCurrency(total)}</p>
                      </div>
                    )
                  })}
                </div>

                <div className="card p-4 bg-brand-50 border-brand-200">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-brand-700">Total cartera pendiente</span>
                    <span className="text-2xl font-bold text-brand-800">
                      {formatCurrency(cartera.reduce((s,c)=>s+(c.saldo_pendiente??c.total),0))}
                    </span>
                  </div>
                </div>

                {pivotAnt.clientes.length === 0 ? (
                  <div className="card p-12 text-center text-gray-400">No hay cartera pendiente</div>
                ) : (
                  <div className="card overflow-auto">
                    <table className="w-full min-w-max">
                      <thead>
                        <tr className="border-b-2 border-gray-300 bg-gray-50">
                          <th className="table-header text-left sticky left-0 bg-gray-50 z-10 min-w-[220px]">
                            Cliente / Factura
                          </th>
                          {BUCKETS.map(b => (
                            <th key={b.key} className="table-header text-right min-w-[120px]">
                              <div className="flex items-center justify-end gap-1">
                                <div className="w-2 h-2 rounded-full" style={{ background: TRAMO_COLORS_HEX[b.key] }} />
                                {b.label}
                              </div>
                            </th>
                          ))}
                          <th className="table-header text-right min-w-[120px] bg-gray-100">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pivotAnt.clientes.map(cliente => {
                          const clienteTotal = BUCKETS.reduce((s, b) => s + (pivotAnt.data[cliente]?.[b.key] || 0), 0)
                          const expandido = antExpandidos[cliente] ?? false
                          return (
                            <>
                              <tr key={`c-${cliente}`}
                                className="border-b border-gray-200 bg-brand-50/30 hover:bg-brand-50 cursor-pointer"
                                onClick={() => setAntExpandidos(p => ({ ...p, [cliente]: !expandido }))}>
                                <td className="table-cell sticky left-0 bg-brand-50/30 z-10 font-semibold text-brand-800">
                                  <div className="flex items-center gap-2">
                                    <span className={`text-xs transition-transform ${expandido ? 'rotate-90' : ''}`}>▶</span>
                                    {cliente}
                                  </div>
                                </td>
                                {BUCKETS.map(b => (
                                  <td key={b.key} className="table-cell text-right font-semibold">
                                    {(pivotAnt.data[cliente]?.[b.key] || 0) > 0 ? (
                                      <span style={{ color: TRAMO_COLORS_HEX[b.key] }}>
                                        {formatCurrency(pivotAnt.data[cliente][b.key])}
                                      </span>
                                    ) : (
                                      <span className="text-gray-300">—</span>
                                    )}
                                  </td>
                                ))}
                                <td className="table-cell text-right font-bold text-brand-900 bg-brand-50">
                                  {formatCurrency(clienteTotal)}
                                </td>
                              </tr>

                              {expandido && (pivotAnt.factByCliente[cliente] || []).map((c: any) => (
                                <tr key={`f-${c.id}`} className="border-b border-gray-100 bg-white hover:bg-gray-50">
                                  <td className="table-cell sticky left-0 bg-white z-10 pl-10 text-sm">
                                    <span className="font-mono text-gray-400 mr-2">#{c.numero_factura}</span>
                                    <span className="text-gray-500">Vence: {formatDate(c.fecha_pago)}</span>
                                  </td>
                                  {BUCKETS.map(b => (
                                    <td key={b.key} className="table-cell text-right text-sm">
                                      {c.tramo === b.key ? (
                                        <span style={{ color: TRAMO_COLORS_HEX[b.key] }}>
                                          {formatCurrency(c.saldo_pendiente ?? c.total)}
                                        </span>
                                      ) : (
                                        <span className="text-gray-200">—</span>
                                      )}
                                    </td>
                                  ))}
                                  <td className="table-cell text-right text-sm font-medium bg-brand-50/30">
                                    {formatCurrency(c.saldo_pendiente ?? c.total)}
                                  </td>
                                </tr>
                              ))}
                            </>
                          )
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-gray-400 bg-gray-100 font-bold">
                          <td className="table-cell sticky left-0 bg-gray-100 z-10">TOTAL</td>
                          {BUCKETS.map(b => {
                            const total = pivotAnt.clientes.reduce((s, c) => s + (pivotAnt.data[c]?.[b.key] || 0), 0)
                            return (
                              <td key={b.key} className="table-cell text-right" style={{ color: total > 0 ? TRAMO_COLORS_HEX[b.key] : '#d1d5db' }}>
                                {total > 0 ? formatCurrency(total) : '—'}
                              </td>
                            )
                          })}
                          <td className="table-cell text-right text-brand-900 bg-gray-200">
                            {formatCurrency(cartera.reduce((s,c)=>s+(c.saldo_pendiente??c.total),0))}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  )
}
