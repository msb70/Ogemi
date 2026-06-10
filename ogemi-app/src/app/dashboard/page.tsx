'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { withPagePermission } from '@/components/PermissionGuard'
import { createClient } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend
} from 'recharts'
import {
  TrendingUp, TrendingDown, FileText, ShoppingCart,
  Building2, RefreshCw, Minus
} from 'lucide-react'

type PeriodType = 'monthly' | 'quarterly' | 'yearly'

interface KPI {
  ventasMonto: number; ventasCount: number
  ncMonto: number; ncCount: number
  comprasMonto: number; comprasCount: number
}

interface PendingSummary {
  ventasMonto: number; ventasCount: number
  comprasMonto: number; comprasCount: number
}

interface BarPoint { label: string; ventas: number; nc: number; compras: number }
interface PiePoint { name: string; value: number }

const PIE_COLORS = [
  '#0284c7','#7c3aed','#059669','#d97706','#dc2626',
  '#0891b2','#4f46e5','#16a34a','#ea580c','#9333ea','#6b7280'
]
const MONTHS_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

function getQuarter(date: Date): number {
  return Math.floor(date.getMonth() / 3) + 1
}

function getPeriodRange(type: PeriodType, year: number, month: number, quarter: number) {
  let start: string, end: string, prevStart: string, prevEnd: string

  if (type === 'monthly') {
    start = `${year}-${String(month).padStart(2,'0')}-01`
    const lastDay = new Date(year, month, 0).getDate()
    end = `${year}-${String(month).padStart(2,'0')}-${lastDay}`
    const prevDate = new Date(year, month - 2, 1)
    const prevYear = prevDate.getFullYear()
    const prevMonth = prevDate.getMonth() + 1
    prevStart = `${prevYear}-${String(prevMonth).padStart(2,'0')}-01`
    const prevLast = new Date(prevYear, prevMonth, 0).getDate()
    prevEnd = `${prevYear}-${String(prevMonth).padStart(2,'0')}-${prevLast}`
  } else if (type === 'quarterly') {
    const qStart = (quarter - 1) * 3 + 1
    const qEnd = quarter * 3
    start = `${year}-${String(qStart).padStart(2,'0')}-01`
    const lastDay = new Date(year, qEnd, 0).getDate()
    end = `${year}-${String(qEnd).padStart(2,'0')}-${lastDay}`
    const prevQ = quarter === 1 ? 4 : quarter - 1
    const prevY = quarter === 1 ? year - 1 : year
    const pqStart = (prevQ - 1) * 3 + 1
    const pqEnd = prevQ * 3
    prevStart = `${prevY}-${String(pqStart).padStart(2,'0')}-01`
    const pLastDay = new Date(prevY, pqEnd, 0).getDate()
    prevEnd = `${prevY}-${String(pqEnd).padStart(2,'0')}-${pLastDay}`
  } else {
    start = `${year}-01-01`
    end = `${year}-12-31`
    prevStart = `${year - 1}-01-01`
    prevEnd = `${year - 1}-12-31`
  }
  return { start, end, prevStart, prevEnd }
}

function pct(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? null : 0
  return ((current - previous) / previous) * 100
}

function TrendBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-blue-600 font-medium">Nuevo</span>
  if (value === 0) return <span className="flex items-center gap-0.5 text-xs text-gray-500"><Minus size={10} />0%</span>
  const up = value > 0
  return (
    <span className={`flex items-center gap-0.5 text-xs font-medium ${up ? 'text-green-600' : 'text-red-600'}`}>
      {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {up ? '+' : ''}{value.toFixed(1)}%
    </span>
  )
}

function isNotaCreditо(tipoDoc: string): boolean {
  const t = String(tipoDoc || '').toUpperCase()
  return t.includes('NOTA') || t.includes('N/C') || t.includes('CREDITO')
}

function generateBarLabels(type: PeriodType, year: number, month: number, quarter: number): string[] {
  if (type === 'monthly') {
    const days = new Date(year, month, 0).getDate()
    return Array.from({ length: days }, (_, i) => String(i + 1))
  } else if (type === 'quarterly') {
    const qStart = (quarter - 1) * 3 + 1
    return [qStart, qStart + 1, qStart + 2].map(m => MONTHS_ES[m - 1])
  } else {
    return MONTHS_ES
  }
}

function getBarKey(type: PeriodType, dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  if (type === 'monthly') return String(d.getDate())
  return MONTHS_ES[d.getMonth()]
}

function DashboardPage() {
  const supabase = createClient()
  const now = new Date()
  const [periodType, setPeriodType] = useState<PeriodType>('monthly')
  const [selYear, setSelYear] = useState(now.getFullYear())
  const [selMonth, setSelMonth] = useState(now.getMonth() + 1)
  const [selQuarter, setSelQuarter] = useState(getQuarter(now))
  const [loading, setLoading] = useState(true)

  const [kpi, setKpi] = useState<KPI>({ ventasMonto:0, ventasCount:0, ncMonto:0, ncCount:0, comprasMonto:0, comprasCount:0 })
  const [prevKpi, setPrevKpi] = useState<KPI>({ ventasMonto:0, ventasCount:0, ncMonto:0, ncCount:0, comprasMonto:0, comprasCount:0 })
  const [pendingSummary, setPendingSummary] = useState<PendingSummary>({ ventasMonto:0, ventasCount:0, comprasMonto:0, comprasCount:0 })
  const [saldoBancos, setSaldoBancos] = useState(0)
  const [barData, setBarData] = useState<BarPoint[]>([])
  const [pieVentas, setPieVentas] = useState<PiePoint[]>([])
  const [pieCompras, setPieCompras] = useState<PiePoint[]>([])

  const { start, end, prevStart, prevEnd } = useMemo(
    () => getPeriodRange(periodType, selYear, selMonth, selQuarter),
    [periodType, selYear, selMonth, selQuarter]
  )

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    try {
      // Fetch facturas del período actual y anterior
      const [
        { data: facturasCur },
        { data: facturasPrev },
        { data: comprasCur },
        { data: comprasPrev },
        { data: cuentas },
        { data: facturasPendientes },
        { data: comprasPendientes },
      ] = await Promise.all([
        supabase.from('facturas').select('fecha,total,tipo_documento,cliente_id,clientes(nombre)').gte('fecha', start).lte('fecha', end),
        supabase.from('facturas').select('fecha,total,tipo_documento').gte('fecha', prevStart).lte('fecha', prevEnd),
        supabase.from('compras').select('fecha,total,proveedor_id,proveedores(nombre)').gte('fecha', start).lte('fecha', end),
        supabase.from('compras').select('fecha,total').gte('fecha', prevStart).lte('fecha', prevEnd),
        supabase.from('banco_cuentas').select('id,saldo_inicial').eq('activo', true),
        supabase.from('facturas').select('total,monto_pagado,tipo_documento').eq('estado', 'pendiente'),
        supabase.from('compras').select('total,monto_pagado').eq('estado', 'pendiente'),
      ])

      // KPI actual
      const ventas = (facturasCur || []).filter(f => !isNotaCreditо(f.tipo_documento))
      const nc = (facturasCur || []).filter(f => isNotaCreditо(f.tipo_documento))
      const comprasArr = comprasCur || []

      setKpi({
        ventasMonto: ventas.reduce((s, f) => s + (f.total || 0), 0),
        ventasCount: ventas.length,
        ncMonto: nc.reduce((s, f) => s + Math.abs(f.total || 0), 0),
        ncCount: nc.length,
        comprasMonto: comprasArr.reduce((s, c) => s + (c.total || 0), 0),
        comprasCount: comprasArr.length,
      })

      // KPI anterior
      const ventasPrev = (facturasPrev || []).filter(f => !isNotaCreditо(f.tipo_documento))
      const ncPrev = (facturasPrev || []).filter(f => isNotaCreditо(f.tipo_documento))
      const comprasPrevArr = comprasPrev || []
      setPrevKpi({
        ventasMonto: ventasPrev.reduce((s, f) => s + (f.total || 0), 0),
        ventasCount: ventasPrev.length,
        ncMonto: ncPrev.reduce((s, f) => s + Math.abs(f.total || 0), 0),
        ncCount: ncPrev.length,
        comprasMonto: comprasPrevArr.reduce((s, c) => s + (c.total || 0), 0),
        comprasCount: comprasPrevArr.length,
      })

      const ventasPendientes = (facturasPendientes || []).filter(f => !isNotaCreditо(f.tipo_documento))
      const comprasPendientesArr = comprasPendientes || []
      setPendingSummary({
        ventasMonto: ventasPendientes.reduce((s, f) => s + Math.max(0, (f.total || 0) - (f.monto_pagado || 0)), 0),
        ventasCount: ventasPendientes.length,
        comprasMonto: comprasPendientesArr.reduce((s, c) => s + Math.max(0, (c.total || 0) - (c.monto_pagado || 0)), 0),
        comprasCount: comprasPendientesArr.length,
      })

      // Saldo bancos
      if (cuentas && cuentas.length > 0) {
        let totalSaldo = cuentas.reduce((s, c) => s + (c.saldo_inicial || 0), 0)
        const { data: movs } = await supabase.from('banco_movimientos').select('tipo,monto')
        if (movs) {
          const ingresos = movs.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + m.monto, 0)
          const egresos = movs.filter(m => m.tipo === 'egreso').reduce((s, m) => s + m.monto, 0)
          totalSaldo += ingresos - egresos
        }
        setSaldoBancos(totalSaldo)
      } else {
        setSaldoBancos(0)
      }

      // Bar chart data
      const labels = generateBarLabels(periodType, selYear, selMonth, selQuarter)
      const barMap: Record<string, BarPoint> = {}
      labels.forEach(l => { barMap[l] = { label: l, ventas: 0, nc: 0, compras: 0 } })
      ventas.forEach(f => {
        const key = getBarKey(periodType, f.fecha)
        if (barMap[key]) barMap[key].ventas += f.total || 0
      })
      nc.forEach(f => {
        const key = getBarKey(periodType, f.fecha)
        if (barMap[key]) barMap[key].nc += Math.abs(f.total || 0)
      })
      comprasArr.forEach(c => {
        const key = getBarKey(periodType, c.fecha)
        if (barMap[key]) barMap[key].compras += c.total || 0
      })
      setBarData(labels.map(l => barMap[l]))

      // Pie ventas por cliente
      const clienteMap: Record<string, number> = {}
      ventas.forEach(f => {
        const nombre = (f.clientes as any)?.nombre || 'Sin nombre'
        clienteMap[nombre] = (clienteMap[nombre] || 0) + (f.total || 0)
      })
      const sortedClientes = Object.entries(clienteMap).sort((a, b) => b[1] - a[1])
      const top8C = sortedClientes.slice(0, 8)
      const restC = sortedClientes.slice(8).reduce((s, [, v]) => s + v, 0)
      const pieV = top8C.map(([name, value]) => ({ name: name.substring(0, 22), value: Math.round(value * 100) / 100 }))
      if (restC > 0) pieV.push({ name: 'Otros', value: Math.round(restC * 100) / 100 })
      setPieVentas(pieV)

      // Pie compras por proveedor
      const provMap: Record<string, number> = {}
      comprasArr.forEach(c => {
        const nombre = (c.proveedores as any)?.nombre || 'Sin nombre'
        provMap[nombre] = (provMap[nombre] || 0) + (c.total || 0)
      })
      const sortedProv = Object.entries(provMap).sort((a, b) => b[1] - a[1])
      const top8P = sortedProv.slice(0, 8)
      const restP = sortedProv.slice(8).reduce((s, [, v]) => s + v, 0)
      const pieC = top8P.map(([name, value]) => ({ name: name.substring(0, 22), value: Math.round(value * 100) / 100 }))
      if (restP > 0) pieC.push({ name: 'Otros', value: Math.round(restP * 100) / 100 })
      setPieCompras(pieC)

    } finally {
      setLoading(false)
    }
  }, [start, end, prevStart, prevEnd, periodType, selYear, selMonth, selQuarter])

  useEffect(() => { loadDashboard() }, [loadDashboard])

  const currentYears = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i)

  const periodLabel = useMemo(() => {
    if (periodType === 'monthly') return `${MONTHS_ES[selMonth - 1]} ${selYear}`
    if (periodType === 'quarterly') return `Q${selQuarter} ${selYear}`
    return String(selYear)
  }, [periodType, selYear, selMonth, selQuarter])

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-sm">
        <p className="font-semibold text-gray-700 mb-1">{label}</p>
        {payload.map((p: any) => (
          <p key={p.dataKey} style={{ color: p.fill }} className="text-xs">
            {p.name}: {formatCurrency(p.value)}
          </p>
        ))}
      </div>
    )
  }

  const PieTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null
    const total = payload[0].payload.total || 1
    return (
      <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-2 text-xs">
        <p className="font-medium">{payload[0].name}</p>
        <p>{formatCurrency(payload[0].value)}</p>
      </div>
    )
  }

  return (
    <AppLayout>
      <Header
        title="Dashboard"
        subtitle={periodLabel}
        actions={
          <button onClick={loadDashboard} className="btn-secondary flex items-center gap-2">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            Actualizar
          </button>
        }
      />

      {/* Period Selector */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4 flex-wrap">
        {/* Tipo de período */}
        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
          {([['monthly','Mensual'],['quarterly','Trimestral'],['yearly','Anual']] as [PeriodType, string][]).map(([val, label]) => (
            <button key={val} onClick={() => setPeriodType(val)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                periodType === val ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* Año */}
        <select className="input text-sm py-1.5 max-w-[90px]" value={selYear}
          onChange={e => setSelYear(parseInt(e.target.value))}>
          {currentYears.map(y => <option key={y} value={y}>{y}</option>)}
        </select>

        {/* Mes (solo si mensual) */}
        {periodType === 'monthly' && (
          <select className="input text-sm py-1.5 max-w-[110px]" value={selMonth}
            onChange={e => setSelMonth(parseInt(e.target.value))}>
            {MONTHS_ES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
        )}

        {/* Trimestre (solo si trimestral) */}
        {periodType === 'quarterly' && (
          <select className="input text-sm py-1.5 max-w-[90px]" value={selQuarter}
            onChange={e => setSelQuarter(parseInt(e.target.value))}>
            {[1,2,3,4].map(q => <option key={q} value={q}>Q{q}</option>)}
          </select>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-600" />
          </div>
        ) : (
          <div className="space-y-5">

            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Ventas */}
              <div className="card p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-9 h-9 bg-blue-100 rounded-xl flex items-center justify-center">
                    <FileText size={17} className="text-blue-600" />
                  </div>
                  <TrendBadge value={pct(kpi.ventasMonto, prevKpi.ventasMonto)} />
                </div>
                <p className="text-xs text-gray-500 font-medium">Ventas</p>
                <p className="text-2xl font-bold text-gray-900 mt-0.5">{formatCurrency(kpi.ventasMonto)}</p>
                <p className="text-xs text-gray-400 mt-0.5">{kpi.ventasCount} facturas</p>
              </div>

              {/* Notas de crédito */}
              <div className="card p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-9 h-9 bg-amber-100 rounded-xl flex items-center justify-center">
                    <FileText size={17} className="text-amber-600" />
                  </div>
                  <TrendBadge value={pct(kpi.ncMonto, prevKpi.ncMonto)} />
                </div>
                <p className="text-xs text-gray-500 font-medium">Notas de crédito</p>
                <p className="text-2xl font-bold text-amber-700 mt-0.5">{formatCurrency(kpi.ncMonto)}</p>
                <p className="text-xs text-gray-400 mt-0.5">{kpi.ncCount} documentos</p>
              </div>

              {/* Compras */}
              <div className="card p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-9 h-9 bg-orange-100 rounded-xl flex items-center justify-center">
                    <ShoppingCart size={17} className="text-orange-600" />
                  </div>
                  <TrendBadge value={pct(kpi.comprasMonto, prevKpi.comprasMonto)} />
                </div>
                <p className="text-xs text-gray-500 font-medium">Compras</p>
                <p className="text-2xl font-bold text-orange-700 mt-0.5">{formatCurrency(kpi.comprasMonto)}</p>
                <p className="text-xs text-gray-400 mt-0.5">{kpi.comprasCount} compras</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="card p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-9 h-9 bg-sky-100 rounded-xl flex items-center justify-center">
                    <FileText size={17} className="text-sky-700" />
                  </div>
                  <span className="badge bg-sky-100 text-sky-700">{pendingSummary.ventasCount} facturas</span>
                </div>
                <p className="text-xs text-gray-500 font-medium">Ventas pendientes por cobrar</p>
                <p className="text-2xl font-bold text-sky-800 mt-0.5">{formatCurrency(pendingSummary.ventasMonto)}</p>
              </div>

              <div className="card p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-9 h-9 bg-red-100 rounded-xl flex items-center justify-center">
                    <ShoppingCart size={17} className="text-red-600" />
                  </div>
                  <span className="badge bg-red-100 text-red-700">{pendingSummary.comprasCount} facturas</span>
                </div>
                <p className="text-xs text-gray-500 font-medium">Compras pendientes por pagar</p>
                <p className="text-2xl font-bold text-red-700 mt-0.5">{formatCurrency(pendingSummary.comprasMonto)}</p>
              </div>

              <div className="card p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-9 h-9 bg-emerald-100 rounded-xl flex items-center justify-center">
                    <Building2 size={17} className="text-emerald-700" />
                  </div>
                  <span className="badge bg-emerald-100 text-emerald-700">Bancos</span>
                </div>
                <p className="text-xs text-gray-500 font-medium">Saldo total de todos los bancos</p>
                <p className="text-2xl font-bold text-emerald-800 mt-0.5">{formatCurrency(saldoBancos)}</p>
              </div>
            </div>

            {/* Saldo Total Bancos */}
            <div className="card p-5 bg-gradient-to-r from-brand-700 to-brand-600 text-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                    <Building2 size={20} className="text-white" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-brand-100">Saldo total en bancos</p>
                    <p className="text-3xl font-bold">{formatCurrency(saldoBancos)}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-brand-200">Ventas – Compras</p>
                  <p className="text-lg font-semibold">
                    {formatCurrency(kpi.ventasMonto - kpi.comprasMonto)}
                  </p>
                  <p className="text-xs text-brand-200">Margen del período</p>
                </div>
              </div>
            </div>

            {/* Bar Chart */}
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">
                Ventas, notas de crédito y compras — {periodLabel}
              </h3>
              {barData.every(d => d.ventas === 0 && d.nc === 0 && d.compras === 0) ? (
                <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
                  Sin datos en este período
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={barData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={periodType === 'monthly' ? 2 : 0} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => v >= 1000 ? `$${(v/1000).toFixed(0)}k` : `$${v}`} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Bar dataKey="ventas" name="Ventas" fill="#0284c7" radius={[3,3,0,0]} />
                    <Bar dataKey="nc" name="Notas de crédito" fill="#d97706" radius={[3,3,0,0]} />
                    <Bar dataKey="compras" name="Compras" fill="#f97316" radius={[3,3,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Pie Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Ventas por cliente */}
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Ventas por cliente</h3>
                {pieVentas.length === 0 ? (
                  <div className="h-48 flex items-center justify-center text-gray-400 text-sm">Sin ventas en el período</div>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie
                        data={pieVentas}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={95}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {pieVentas.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => formatCurrency(v)} />
                      <Legend
                        layout="vertical"
                        align="right"
                        verticalAlign="middle"
                        iconSize={10}
                        wrapperStyle={{ fontSize: '11px', maxWidth: '140px' }}
                        formatter={(value: string, entry: any) => {
                          const total = pieVentas.reduce((s, d) => s + d.value, 0)
                          const pctVal = total > 0 ? ((entry.payload.value / total) * 100).toFixed(1) : '0'
                          return `${value} (${pctVal}%)`
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Compras por proveedor */}
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Compras por proveedor</h3>
                {pieCompras.length === 0 ? (
                  <div className="h-48 flex items-center justify-center text-gray-400 text-sm">Sin compras en el período</div>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie
                        data={pieCompras}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={95}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {pieCompras.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => formatCurrency(v)} />
                      <Legend
                        layout="vertical"
                        align="right"
                        verticalAlign="middle"
                        iconSize={10}
                        wrapperStyle={{ fontSize: '11px', maxWidth: '140px' }}
                        formatter={(value: string, entry: any) => {
                          const total = pieCompras.reduce((s, d) => s + d.value, 0)
                          const pctVal = total > 0 ? ((entry.payload.value / total) * 100).toFixed(1) : '0'
                          return `${value} (${pctVal}%)`
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

          </div>
        )}
      </div>
    </AppLayout>
  )
}

export default withPagePermission(DashboardPage, 'dashboard', 'ver')
