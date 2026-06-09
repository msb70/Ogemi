'use client'

import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { createClient } from '@/lib/supabase'
import { CarteraVencida } from '@/types'
import {
  FileText, ShoppingCart, CreditCard, Building2, BookOpen, ClipboardList,
} from 'lucide-react'
import { isNC } from './reportes.utils'

import VentasTab      from './components/VentasTab'
import PresupuestosTab from './components/PresupuestosTab'
import ComprasTab     from './components/ComprasTab'
import NcTab          from './components/NcTab'
import BancoTab       from './components/BancoTab'
import LibrosTab      from './components/LibrosTab'

type ReporteTab = 'ventas' | 'presupuestos' | 'compras' | 'nc' | 'banco' | 'libros'

export default function ReportesPage() {
  const [tab, setTab] = useState<ReporteTab>('ventas')
  const [loading, setLoading] = useState(false)

  // Filtros compartidos
  const [search, setSearch] = useState('')
  const [fechaDesde, setFechaDesde] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0]
  })
  const [fechaHasta, setFechaHasta] = useState(new Date().toISOString().split('T')[0])

  // Datos crudos
  const [facturas, setFacturas] = useState<any[]>([])
  const [compras, setCompras] = useState<any[]>([])
  const [presupuestos, setPresupuestos] = useState<any[]>([])
  const [cartera, setCartera] = useState<CarteraVencida[]>([])
  const [cxp, setCxp] = useState<any[]>([])
  const [carteraPresupuestos, setCarteraPresupuestos] = useState<any[]>([])

  // Banco
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

    // N+1 known issue — sprint 4.6 scope: no fix here
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

  const presupuestosFiltrados = presupuestos.filter(p => {
    const ok1 = !search || (p.clientes?.nombre || '').toLowerCase().includes(search.toLowerCase()) || String(p.numero_presupuesto).includes(search)
    const ok2 = !fechaDesde || p.fecha >= fechaDesde
    const ok3 = !fechaHasta || p.fecha <= fechaHasta
    return ok1 && ok2 && ok3
  })

  // Libros contables
  const libroVentaFiltrado = [...ventasFiltradas, ...ncFiltradas].sort((a, b) => {
    if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1
    return (a.numero_factura || 0) - (b.numero_factura || 0)
  })
  const libroCompraFiltrado = comprasFiltradas.slice().sort((a, b) => a.fecha < b.fecha ? -1 : 1)

  // Agregados
  const ventasPorMes = (() => {
    const map: Record<string, { ventas: number; nc: number; count: number }> = {}
    ventas.forEach(f => {
      const m = f.fecha?.substring(0, 7) || ''
      if (!map[m]) map[m] = { ventas: 0, nc: 0, count: 0 }
      map[m].ventas += f.total || 0; map[m].count++
    })
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0])).map(([mes, v]) => ({ mes, ...v }))
  })()

  const comprasPorMes = (() => {
    const map: Record<string, { total: number; count: number }> = {}
    compras.forEach(c => {
      const m = c.fecha?.substring(0, 7) || ''
      if (!map[m]) map[m] = { total: 0, count: 0 }
      map[m].total += c.total || 0; map[m].count++
    })
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0])).map(([mes, v]) => ({ mes, ...v }))
  })()

  const presupuestosPorMes = (() => {
    const map: Record<string, { total: number; count: number }> = {}
    presupuestos.forEach(p => {
      const m = p.fecha?.substring(0, 7) || ''
      if (!map[m]) map[m] = { total: 0, count: 0 }
      map[m].total += p.total || 0; map[m].count++
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

  const filtrosBarProps = { search, setSearch, fechaDesde, setFechaDesde, fechaHasta, setFechaHasta }

  const tabs: { key: ReporteTab; label: string; icon: React.ElementType }[] = [
    { key: 'ventas',       label: 'Ventas',            icon: FileText },
    { key: 'presupuestos', label: 'Presupuestos',      icon: ClipboardList },
    { key: 'compras',      label: 'Compras',           icon: ShoppingCart },
    { key: 'nc',           label: 'Notas de crédito',  icon: CreditCard },
    { key: 'banco',        label: 'Banco',             icon: Building2 },
    { key: 'libros',       label: 'Libros',            icon: BookOpen },
  ]

  return (
    <AppLayout>
      <Header title="Reportes" subtitle="Análisis financiero y contable" />

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

      {loading && (
        <div className="p-8 text-center text-sm text-gray-400">Cargando datos...</div>
      )}

      <div className="flex-1 overflow-auto">
        {tab === 'ventas' && (
          <VentasTab {...filtrosBarProps}
            ventasFiltradas={ventasFiltradas}
            facturas={facturas}
            cartera={cartera}
            topClientesVentas={topClientesVentas}
            ventasPorMes={ventasPorMes}
          />
        )}

        {tab === 'presupuestos' && (
          <PresupuestosTab {...filtrosBarProps}
            presupuestosFiltrados={presupuestosFiltrados}
            carteraPresupuestos={carteraPresupuestos}
            topClientesPresupuestos={topClientesPresupuestos}
            presupuestosPorMes={presupuestosPorMes}
            presupuestos={presupuestos}
          />
        )}

        {tab === 'compras' && (
          <ComprasTab {...filtrosBarProps}
            comprasFiltradas={comprasFiltradas}
            cxp={cxp}
            topProveedores={topProveedores}
            comprasPorMes={comprasPorMes}
            compras={compras}
          />
        )}

        {tab === 'nc' && (
          <NcTab {...filtrosBarProps}
            ncFiltradas={ncFiltradas}
            ncPorCliente={ncPorCliente}
          />
        )}

        {tab === 'banco' && (
          <BancoTab
            cuentas={cuentas}
            saldos={saldos}
            movimientos={movimientos}
            cierres={cierres}
            flujoPorMes={flujoPorMes}
            cuentaSeleccionada={cuentaSeleccionada}
            setCuentaSeleccionada={setCuentaSeleccionada}
            fechaDesde={fechaDesde}
            setFechaDesde={setFechaDesde}
            fechaHasta={fechaHasta}
            setFechaHasta={setFechaHasta}
            loadMovimientos={loadMovimientos}
            loadCierres={loadCierres}
          />
        )}

        {tab === 'libros' && (
          <LibrosTab
            fechaDesde={fechaDesde}
            setFechaDesde={setFechaDesde}
            fechaHasta={fechaHasta}
            setFechaHasta={setFechaHasta}
            libroVentaFiltrado={libroVentaFiltrado}
            libroCompraFiltrado={libroCompraFiltrado}
            ventasFiltradas={ventasFiltradas}
            ncFiltradas={ncFiltradas}
          />
        )}
      </div>
    </AppLayout>
  )
}
