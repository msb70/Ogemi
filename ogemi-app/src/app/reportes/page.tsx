'use client'

import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { createClient } from '@/lib/supabase'
import { formatCurrency, formatDate, tramoColor } from '@/lib/utils'
import { CarteraVencida } from '@/types'
import { Download, Filter, Search, X, TrendingUp, TrendingDown, FileText, ShoppingCart, CreditCard, Building2 } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend
} from 'recharts'

type ReporteTab = 'ventas' | 'compras' | 'nc' | 'banco'
type VentasSubTab = 'listado' | 'cartera' | 'porcliente' | 'pormes'
type ComprasSubTab = 'listado' | 'cxp' | 'porproveedor' | 'pormes'
type NcSubTab = 'listado' | 'porcliente'
type BancoSubTab = 'movimientos' | 'flujo' | 'cierres'

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

export default function ReportesPage() {
  const [tab, setTab] = useState<ReporteTab>('ventas')
  const [ventasTab, setVentasTab] = useState<VentasSubTab>('listado')
  const [comprasTab, setComprasTab] = useState<ComprasSubTab>('listado')
  const [ncTab, setNcTab] = useState<NcSubTab>('listado')
  const [bancoTab, setBancoTab] = useState<BancoSubTab>('movimientos')
  const [loading, setLoading] = useState(false)

  // Filtros comunes
  const [search, setSearch] = useState('')
  const [fechaDesde, setFechaDesde] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0]
  })
  const [fechaHasta, setFechaHasta] = useState(new Date().toISOString().split('T')[0])

  // Datos
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
    ] = await Promise.all([
      supabase.from('facturas').select('*, clientes(nombre)').order('fecha', { ascending: false }),
      supabase.from('compras').select('*, proveedores(nombre), banco_cuentas(nombre,banco)').order('fecha', { ascending: false }),
      supabase.from('cartera_vencida').select('*').order('dias_vencida', { ascending: false }),
      supabase.from('compras_vencidas').select('*').order('dias_vencida', { ascending: false }),
      supabase.from('banco_cuentas').select('*').order('nombre'),
    ])
    setFacturas(facturasData || [])
    setCompras(comprasData || [])
    setCartera(carteraData || [])
    setCxp(cxpData || [])
    setCuentas(cuentasData || [])
    if (cuentasData && cuentasData.length > 0 && !cuentaSeleccionada) {
      setCuentaSeleccionada(cuentasData[0].id)
    }

    // Saldos bancarios
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

  // Derivados ventas
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

  // Agrupaciones por mes
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

  // Top clientes por ventas
  const topClientesVentas = (() => {
    const map: Record<string, number> = {}
    ventas.forEach(f => {
      const n = f.clientes?.nombre || 'N/A'
      map[n] = (map[n] || 0) + (f.total || 0)
    })
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 15)
  })()

  // Top proveedores por compras
  const topProveedores = (() => {
    const map: Record<string, number> = {}
    compras.forEach(c => {
      const n = c.proveedores?.nombre || 'N/A'
      map[n] = (map[n] || 0) + (c.total || 0)
    })
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 15)
  })()

  // NC por cliente
  const ncPorCliente = (() => {
    const map: Record<string, number> = {}
    nc.forEach(f => {
      const n = f.clientes?.nombre || 'N/A'
      map[n] = (map[n] || 0) + Math.abs(f.total || 0)
    })
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  })()

  // Flujo de caja por mes (banco)
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

  const tabs: { key: ReporteTab; label: string; icon: React.ElementType }[] = [
    { key: 'ventas',  label: 'Ventas',          icon: FileText },
    { key: 'compras', label: 'Compras',          icon: ShoppingCart },
    { key: 'nc',      label: 'Notas de crédito', icon: CreditCard },
    { key: 'banco',   label: 'Banco',            icon: Building2 },
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
      <Header title="Reportes" subtitle="Análisis financiero" />

      {/* Main tabs */}
      <div className="bg-white border-b border-gray-200 px-6">
        <div className="flex gap-1">
          {tabs.map(t => {
            const Icon = t.icon
            return (
              <button key={t.key} onClick={() => { setTab(t.key); setSearch('') }}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
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
            {/* Sub-tabs */}
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

            {/* Sub-tab: Listado */}
            {ventasTab === 'listado' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
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
                {/* Totales rápidos */}
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

            {/* Sub-tab: Cartera vencida */}
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
                        <p className="text-lg font-bold">{formatCurrency(items.reduce((s,c)=>s+c.total,0))}</p>
                        <p className="text-xs text-gray-400">{items.length} facturas</p>
                      </div>
                    )
                  })}
                </div>
                <div className="card p-4 bg-brand-50 border-brand-200">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-brand-700">Total cartera pendiente</span>
                    <span className="text-2xl font-bold text-brand-800">{formatCurrency(cartera.reduce((s,c)=>s+c.total,0))}</span>
                  </div>
                </div>
                <div className="card overflow-hidden">
                  <table className="w-full">
                    <thead><tr className="border-b border-gray-200">
                      <th className="table-header">#Factura</th>
                      <th className="table-header">Fecha</th>
                      <th className="table-header">Cliente</th>
                      <th className="table-header">Vencimiento</th>
                      <th className="table-header text-right">Días</th>
                      <th className="table-header text-right">Total</th>
                      <th className="table-header">Tramo</th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {cartera.map(c => (
                        <tr key={c.id} className="hover:bg-gray-50">
                          <td className="table-cell font-mono">#{c.numero_factura}</td>
                          <td className="table-cell text-sm text-gray-500">{formatDate(c.fecha)}</td>
                          <td className="table-cell max-w-[200px]"><span className="truncate block">{c.cliente}</span></td>
                          <td className="table-cell text-sm text-gray-500">{formatDate(c.fecha_pago)}</td>
                          <td className="table-cell text-right">
                            <span className={c.dias_vencida > 0 ? 'text-red-600 font-medium' : 'text-green-600'}>
                              {c.dias_vencida > 0 ? `+${c.dias_vencida}` : c.dias_vencida}
                            </span>
                          </td>
                          <td className="table-cell text-right font-semibold">{formatCurrency(c.total)}</td>
                          <td className="table-cell"><span className={`badge ${tramoColor(c.tramo)}`}>{TRAMO_LABELS[c.tramo]}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Sub-tab: Por cliente */}
            {ventasTab === 'porcliente' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="card p-5">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Top clientes por ventas totales</h3>
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
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Distribución de ventas</h3>
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
                <div className="card overflow-hidden">
                  <table className="w-full">
                    <thead><tr className="border-b border-gray-200">
                      <th className="table-header">#</th>
                      <th className="table-header">Cliente</th>
                      <th className="table-header text-right">Total ventas</th>
                      <th className="table-header text-right">% del total</th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {topClientesVentas.map(([nombre, monto], i) => {
                        const totalV = topClientesVentas.reduce((s, [, v]) => s + v, 0)
                        const p = totalV > 0 ? ((monto / totalV) * 100).toFixed(1) : '0'
                        return (
                          <tr key={nombre} className="hover:bg-gray-50">
                            <td className="table-cell text-gray-400 font-mono">{i+1}</td>
                            <td className="table-cell font-medium">{nombre}</td>
                            <td className="table-cell text-right font-semibold text-brand-700">{formatCurrency(monto)}</td>
                            <td className="table-cell text-right">
                              <div className="flex items-center justify-end gap-2">
                                <div className="w-24 bg-gray-100 rounded-full h-2">
                                  <div className="bg-brand-500 h-2 rounded-full" style={{ width: `${p}%` }} />
                                </div>
                                <span className="text-xs text-gray-500 w-10 text-right">{p}%</span>
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

            {/* Sub-tab: Por período */}
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
                <div className="card overflow-hidden">
                  <table className="w-full">
                    <thead><tr className="border-b border-gray-200">
                      <th className="table-header">Mes</th>
                      <th className="table-header text-right"># Facturas</th>
                      <th className="table-header text-right">Total ventas</th>
                      <th className="table-header text-right">Promedio por factura</th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {ventasPorMes.map(m => (
                        <tr key={m.mes} className="hover:bg-gray-50">
                          <td className="table-cell font-medium">{m.mes}</td>
                          <td className="table-cell text-right text-gray-600">{m.count}</td>
                          <td className="table-cell text-right font-semibold text-brand-700">{formatCurrency(m.ventas)}</td>
                          <td className="table-cell text-right text-gray-500">{formatCurrency(m.count > 0 ? m.ventas / m.count : 0)}</td>
                        </tr>
                      ))}
                      <tr className="bg-gray-50 font-semibold">
                        <td className="table-cell">Total</td>
                        <td className="table-cell text-right">{ventasPorMes.reduce((s,m)=>s+m.count,0)}</td>
                        <td className="table-cell text-right text-brand-700">{formatCurrency(ventasPorMes.reduce((s,m)=>s+m.ventas,0))}</td>
                        <td className="table-cell" />
                      </tr>
                    </tbody>
                  </table>
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
                      <th className="table-header">Vencimiento</th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {comprasFiltradas.length === 0 ? (
                        <tr><td colSpan={8} className="text-center py-8 text-gray-400">Sin resultados</td></tr>
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
                          <td className="table-cell text-sm text-gray-400">{formatDate(c.vencimiento)}</td>
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
                <div className="card p-4 bg-orange-50 border-orange-200">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-orange-700">Total cuentas por pagar</span>
                    <span className="text-2xl font-bold text-orange-800">{formatCurrency(cxp.reduce((s:number,c:any)=>s+c.total,0))}</span>
                  </div>
                </div>
                <div className="card overflow-hidden">
                  <table className="w-full">
                    <thead><tr className="border-b border-gray-200">
                      <th className="table-header">Fecha</th>
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
                          <td className="table-cell text-sm">{formatDate(c.fecha)}</td>
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
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
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
                  <div className="card p-5">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Distribución</h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie data={topProveedores.slice(0,8).map(([n,v])=>({ name:n.substring(0,20), value:v }))}
                          cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={2} dataKey="value">
                          {topProveedores.slice(0,8).map((_,i)=><Cell key={i} fill={PIE_COLORS[i%PIE_COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v: number) => formatCurrency(v)} />
                        <Legend wrapperStyle={{ fontSize:'11px' }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="card overflow-hidden">
                  <table className="w-full">
                    <thead><tr className="border-b border-gray-200">
                      <th className="table-header">#</th>
                      <th className="table-header">Proveedor</th>
                      <th className="table-header text-right">Total compras</th>
                      <th className="table-header text-right">% del total</th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {topProveedores.map(([nombre, monto], i) => {
                        const totalC = topProveedores.reduce((s,[,v])=>s+v, 0)
                        const p = totalC > 0 ? ((monto/totalC)*100).toFixed(1) : '0'
                        return (
                          <tr key={nombre} className="hover:bg-gray-50">
                            <td className="table-cell text-gray-400 font-mono">{i+1}</td>
                            <td className="table-cell font-medium">{nombre}</td>
                            <td className="table-cell text-right font-semibold text-orange-600">{formatCurrency(monto)}</td>
                            <td className="table-cell text-right">
                              <div className="flex items-center justify-end gap-2">
                                <div className="w-24 bg-gray-100 rounded-full h-2">
                                  <div className="bg-orange-500 h-2 rounded-full" style={{ width:`${p}%` }} />
                                </div>
                                <span className="text-xs text-gray-500 w-10 text-right">{p}%</span>
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

            {comprasTab === 'pormes' && (
              <div className="space-y-4">
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
                <div className="card overflow-hidden">
                  <table className="w-full">
                    <thead><tr className="border-b border-gray-200">
                      <th className="table-header">Mes</th>
                      <th className="table-header text-right"># Compras</th>
                      <th className="table-header text-right">Total</th>
                      <th className="table-header text-right">Promedio</th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {comprasPorMes.map(m => (
                        <tr key={m.mes} className="hover:bg-gray-50">
                          <td className="table-cell font-medium">{m.mes}</td>
                          <td className="table-cell text-right text-gray-500">{m.count}</td>
                          <td className="table-cell text-right font-semibold text-orange-600">{formatCurrency(m.total)}</td>
                          <td className="table-cell text-right text-gray-500">{formatCurrency(m.count>0?m.total/m.count:0)}</td>
                        </tr>
                      ))}
                      <tr className="bg-gray-50 font-semibold">
                        <td className="table-cell">Total</td>
                        <td className="table-cell text-right">{comprasPorMes.reduce((s,m)=>s+m.count,0)}</td>
                        <td className="table-cell text-right text-orange-600">{formatCurrency(comprasPorMes.reduce((s,m)=>s+m.total,0))}</td>
                        <td className="table-cell" />
                      </tr>
                    </tbody>
                  </table>
                </div>
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
              {[
                { key: 'listado',    label: 'Listado' },
                { key: 'porcliente', label: 'Por cliente' },
              ].map(s => (
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
                <div className="grid grid-cols-3 gap-3">
                  <div className="card p-3">
                    <p className="text-xs text-gray-500">Total notas de crédito</p>
                    <p className="text-xl font-bold text-amber-700">{formatCurrency(ncFiltradas.reduce((s,f)=>s+Math.abs(f.total||0),0))}</p>
                  </div>
                  <div className="card p-3">
                    <p className="text-xs text-gray-500"># Documentos</p>
                    <p className="text-xl font-bold text-gray-700">{ncFiltradas.length}</p>
                  </div>
                  <div className="card p-3">
                    <p className="text-xs text-gray-500">Promedio por NC</p>
                    <p className="text-xl font-bold text-gray-700">
                      {formatCurrency(ncFiltradas.length > 0 ? ncFiltradas.reduce((s,f)=>s+Math.abs(f.total||0),0)/ncFiltradas.length : 0)}
                    </p>
                  </div>
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
              <div className="space-y-4">
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
                <div className="card overflow-hidden">
                  <table className="w-full">
                    <thead><tr className="border-b border-gray-200">
                      <th className="table-header">#</th>
                      <th className="table-header">Cliente</th>
                      <th className="table-header text-right">Total NC</th>
                      <th className="table-header text-right">% del total</th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {ncPorCliente.map(([nombre, monto], i) => {
                        const totalNC = ncPorCliente.reduce((s,[,v])=>s+v,0)
                        const p = totalNC > 0 ? ((monto/totalNC)*100).toFixed(1) : '0'
                        return (
                          <tr key={nombre} className="hover:bg-gray-50">
                            <td className="table-cell text-gray-400 font-mono">{i+1}</td>
                            <td className="table-cell font-medium">{nombre}</td>
                            <td className="table-cell text-right font-semibold text-amber-700">{formatCurrency(monto)}</td>
                            <td className="table-cell text-right">
                              <div className="flex items-center justify-end gap-2">
                                <div className="w-24 bg-gray-100 rounded-full h-2">
                                  <div className="bg-amber-400 h-2 rounded-full" style={{ width:`${p}%` }} />
                                </div>
                                <span className="text-xs text-gray-500 w-10 text-right">{p}%</span>
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
          </div>
        )}

        {/* ================================================================
            TAB: BANCO
            ================================================================ */}
        {tab === 'banco' && (
          <div className="p-6 space-y-4">
            <div className="flex gap-2 flex-wrap mb-2">
              {[
                { key: 'movimientos', label: 'Movimientos' },
                { key: 'flujo',       label: 'Flujo de caja' },
                { key: 'cierres',     label: 'Cierres de mes' },
              ].map(s => (
                <button key={s.key} onClick={() => setBancoTab(s.key as BancoSubTab)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    bancoTab === s.key ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}>
                  {s.label}
                </button>
              ))}
            </div>

            {/* Saldos por cuenta */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {cuentas.map(c => (
                <div key={c.id} className="card p-4">
                  <p className="text-xs text-gray-500">{c.nombre} · {c.banco}</p>
                  <p className={`text-xl font-bold mt-0.5 ${(saldos[c.id]||0) >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {formatCurrency(saldos[c.id] || 0)}
                  </p>
                </div>
              ))}
              {cuentas.length > 1 && (
                <div className="card p-4 bg-brand-50">
                  <p className="text-xs text-brand-600">Saldo total bancos</p>
                  <p className="text-xl font-bold text-brand-800 mt-0.5">
                    {formatCurrency(Object.values(saldos).reduce((s, v) => s + v, 0))}
                  </p>
                </div>
              )}
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
                <div className="grid grid-cols-3 gap-3">
                  <div className="card p-3">
                    <p className="text-xs text-gray-500">Ingresos en período</p>
                    <p className="text-lg font-bold text-green-600">
                      {formatCurrency(movimientos.filter(m=>m.tipo==='ingreso').reduce((s,m)=>s+m.monto,0))}
                    </p>
                  </div>
                  <div className="card p-3">
                    <p className="text-xs text-gray-500">Egresos en período</p>
                    <p className="text-lg font-bold text-red-600">
                      {formatCurrency(movimientos.filter(m=>m.tipo==='egreso').reduce((s,m)=>s+m.monto,0))}
                    </p>
                  </div>
                  <div className="card p-3">
                    <p className="text-xs text-gray-500">Neto en período</p>
                    <p className="text-lg font-bold text-brand-700">
                      {formatCurrency(
                        movimientos.filter(m=>m.tipo==='ingreso').reduce((s,m)=>s+m.monto,0) -
                        movimientos.filter(m=>m.tipo==='egreso').reduce((s,m)=>s+m.monto,0)
                      )}
                    </p>
                  </div>
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
              <div className="space-y-4">
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
                <div className="card overflow-hidden">
                  <table className="w-full">
                    <thead><tr className="border-b border-gray-200">
                      <th className="table-header">Mes</th>
                      <th className="table-header text-right">Ingresos</th>
                      <th className="table-header text-right">Egresos</th>
                      <th className="table-header text-right">Neto</th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {flujoPorMes.map(m => (
                        <tr key={m.mes} className="hover:bg-gray-50">
                          <td className="table-cell font-medium">{m.mes}</td>
                          <td className="table-cell text-right text-green-600 font-medium">{formatCurrency(m.ingresos)}</td>
                          <td className="table-cell text-right text-red-600 font-medium">{formatCurrency(m.egresos)}</td>
                          <td className={`table-cell text-right font-bold ${m.neto>=0?'text-green-700':'text-red-700'}`}>
                            {m.neto >= 0 ? '+' : ''}{formatCurrency(m.neto)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {bancoTab === 'cierres' && (
              <div className="space-y-3">
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
                        <tr><td colSpan={6} className="text-center py-8 text-gray-400">Sin cierres registrados</td></tr>
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
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  )
}
