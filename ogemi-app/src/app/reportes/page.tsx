'use client'

import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { createClient } from '@/lib/supabase'
import { CarteraVencida } from '@/types'
import {
  FileText, ShoppingCart, Building2, BookOpen, ClipboardList, Printer, FileSpreadsheet,
} from 'lucide-react'
import { withPagePermission } from '@/components/PermissionGuard'
import { isNC, xlsxFromReporteArea } from './reportes.utils'

import VentasTab      from './components/VentasTab'
import PresupuestosTab from './components/PresupuestosTab'
import ComprasTab     from './components/ComprasTab'
import BancoTab       from './components/BancoTab'
import LibrosTab      from './components/LibrosTab'

type ReporteTab = 'ventas' | 'presupuestos' | 'compras' | 'banco' | 'libros'

function ReportesPage() {
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
  const [notasCredito, setNotasCredito] = useState<any[]>([])
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

  // Flujo de caja (rango propio = año en curso + multi-cuenta)
  const [flujoDesde, setFlujoDesde] = useState(() => `${new Date().getFullYear()}-01-01`)
  const [flujoHasta, setFlujoHasta] = useState(new Date().toISOString().split('T')[0])
  const [flujoCuentas, setFlujoCuentas] = useState<string[]>([])
  const [flujoMovs, setFlujoMovs] = useState<any[]>([])

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
      { data: notasCreditoData },
    ] = await Promise.all([
      supabase.from('facturas').select('*, clientes(nombre)').order('fecha', { ascending: false }),
      supabase.from('compras').select('*, proveedores(nombre), banco_cuentas(nombre,banco)').order('fecha', { ascending: false }),
      supabase.from('cartera_vencida').select('*').order('dias_vencida', { ascending: false }),
      supabase.from('compras_vencidas').select('*').order('dias_vencida', { ascending: false }),
      supabase.from('banco_cuentas').select('*').order('nombre'),
      supabase.from('presupuestos').select('*, clientes(nombre)').order('fecha', { ascending: false }),
      supabase.from('cartera_presupuestos').select('*').order('dias_vencida', { ascending: false }),
      supabase.from('notas_credito').select('*, clientes(nombre), factura_aplicada:facturas!factura_aplicada_id(numero_factura)').order('fecha', { ascending: false }),
    ])
    setFacturas(facturasData || [])
    setNotasCredito(notasCreditoData || [])
    setCompras(comprasData || [])
    setCartera(carteraData || [])
    setCxp(cxpData || [])
    setPresupuestos(presupuestosData || [])
    setCarteraPresupuestos(carteraPresData || [])
    setCuentas(cuentasData || [])
    if (cuentasData && cuentasData.length > 0 && !cuentaSeleccionada) {
      setCuentaSeleccionada(cuentasData[0].id)
    }
    // Por defecto, todas las cuentas seleccionadas para el flujo
    if (cuentasData && cuentasData.length > 0) {
      setFlujoCuentas(prev => prev.length > 0 ? prev : cuentasData.map(c => c.id))
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
    const cuenta = cuentas.find(c => c.id === cuentaSeleccionada)
    const saldoInicial = cuenta?.saldo_inicial || 0
    // Base: saldo inicial + neto de movimientos anteriores a "desde"
    let base = saldoInicial
    if (fechaDesde) {
      const { data: prev } = await supabase.from('banco_movimientos')
        .select('tipo,monto').eq('cuenta_id', cuentaSeleccionada).lt('fecha', fechaDesde)
      const ing = prev?.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + m.monto, 0) || 0
      const egr = prev?.filter(m => m.tipo === 'egreso').reduce((s, m) => s + m.monto, 0) || 0
      base = saldoInicial + ing - egr
    }
    let q = supabase.from('banco_movimientos').select('*').eq('cuenta_id', cuentaSeleccionada)
    if (fechaDesde) q = q.gte('fecha', fechaDesde)
    if (fechaHasta) q = q.lte('fecha', fechaHasta)
    const { data } = await q.order('fecha', { ascending: true }).order('created_at', { ascending: true }).limit(1000)
    // Saldo corrido (ascendente), luego mostrar descendente
    let running = base
    const conSaldo = (data || []).map(m => {
      running += m.tipo === 'ingreso' ? (m.monto || 0) : -(m.monto || 0)
      return { ...m, saldo: running }
    })
    conSaldo.reverse()
    setMovimientos(conSaldo)
  }, [cuentaSeleccionada, fechaDesde, fechaHasta, cuentas])

  const loadCierres = useCallback(async () => {
    const { data } = await supabase.from('cierre_mes').select('*, banco_cuentas(nombre,banco)').order('periodo', { ascending: false }).limit(24)
    setCierres(data || [])
  }, [])

  const loadFlujo = useCallback(async () => {
    if (flujoCuentas.length === 0) { setFlujoMovs([]); return }
    let q = supabase.from('banco_movimientos').select('tipo,monto,fecha,cuenta_id')
      .in('cuenta_id', flujoCuentas)
    if (flujoDesde) q = q.gte('fecha', flujoDesde)
    if (flujoHasta) q = q.lte('fecha', flujoHasta)
    const { data } = await q.limit(5000)
    setFlujoMovs(data || [])
  }, [flujoCuentas, flujoDesde, flujoHasta])

  useEffect(() => { loadAll() }, [loadAll])
  // Refrescar movimientos al cambiar cuenta/fechas estando en banco
  useEffect(() => { if (tab === 'banco') loadMovimientos() }, [tab, loadMovimientos])
  // Refrescar flujo al cambiar rango/cuentas estando en banco
  useEffect(() => { if (tab === 'banco') loadFlujo() }, [tab, loadFlujo])

  // Derivados
  // Las ventas salen de facturas; las NC ahora viven en notas_credito.
  // Se mapean al mismo shape (montos negativos) que consumían NcTab/LibrosTab.
  const ventas = facturas.filter(f => !isNC(f.tipo_documento))
  const nc = notasCredito.map((n: any) => ({
    id: n.id,
    numero_factura: n.numero,
    fecha: n.fecha,
    clientes: n.clientes,
    tipo_documento: 'NOTA DE CREDITO',
    documento_afectado: n.factura_aplicada?.numero_factura ?? null,
    monto: -Math.abs(n.monto || 0),
    itbms: -Math.abs(n.itbms || 0),
    total: -Math.abs(n.total || 0),
  }))

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

  const filtrosBarProps = { search, setSearch, fechaDesde, setFechaDesde, fechaHasta, setFechaHasta }

  const tabs: { key: ReporteTab; label: string; icon: React.ElementType }[] = [
    { key: 'ventas',       label: 'Ventas',       icon: FileText },
    { key: 'presupuestos', label: 'Presupuestos', icon: ClipboardList },
    { key: 'compras',      label: 'Compras',      icon: ShoppingCart },
    { key: 'banco',        label: 'Banco',        icon: Building2 },
    { key: 'libros',       label: 'Libros',       icon: BookOpen },
  ]

  return (
    <AppLayout>
      <Header title="Reportes" subtitle="Análisis financiero y contable"
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => window.print()} className="btn-secondary flex items-center gap-2">
              <Printer size={16} /> Reporte PDF
            </button>
            <button
              onClick={() => {
                const ok = xlsxFromReporteArea(`reporte_${tab}_${new Date().toISOString().split('T')[0]}.xlsx`)
                if (!ok) alert('No hay tablas para exportar en esta vista.')
              }}
              className="btn-primary flex items-center gap-2">
              <FileSpreadsheet size={16} /> Reporte Excel
            </button>
          </div>
        }
      />

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

      <div className="flex-1 overflow-auto" id="reporte-print">
        {/* Encabezado solo visible al imprimir / Guardar como PDF */}
        <div className="hidden print:block px-6 pt-6 mb-2">
          <div className="flex items-center gap-3 border-b-2 pb-3" style={{ borderColor: '#0f766e' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.jpeg" alt="Ogemi" style={{ width: 48, height: 48, objectFit: 'contain' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Reporte de {tabs.find(t => t.key === tab)?.label}</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>Impresos Comerciales S.A. · Sistema Ogemi</div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 10, color: '#6b7280' }}>
              <div>Período: {fechaDesde} a {fechaHasta}</div>
              <div>Generado: {new Date().toLocaleString('es-PA')}</div>
            </div>
          </div>
        </div>
        {tab === 'ventas' && (
          <VentasTab {...filtrosBarProps}
            ventasFiltradas={ventasFiltradas}
            facturas={facturas}
            cartera={cartera}
            topClientesVentas={topClientesVentas}
            ventasPorMes={ventasPorMes}
            ncFiltradas={ncFiltradas}
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

        {tab === 'banco' && (
          <BancoTab
            cuentas={cuentas}
            saldos={saldos}
            movimientos={movimientos}
            cierres={cierres}
            flujoMovs={flujoMovs}
            flujoDesde={flujoDesde}
            setFlujoDesde={setFlujoDesde}
            flujoHasta={flujoHasta}
            setFlujoHasta={setFlujoHasta}
            flujoCuentas={flujoCuentas}
            setFlujoCuentas={setFlujoCuentas}
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

      <style>{`
        @media print {
          /* Ocultar todo lo que no es el área del reporte ni un ancestro de ella.
             display:none colapsa el layout (visibility dejaba páginas en blanco). */
          body *:not(#reporte-print):not(#reporte-print *):not(:has(#reporte-print)) { display: none !important; }
          /* Los ancestros del área pierden flex/altura/scroll para no generar espacio extra */
          body :has(#reporte-print) {
            display: block !important;
            height: auto !important;
            min-height: 0 !important;
            overflow: visible !important;
          }
          html, body { height: auto !important; overflow: visible !important; }
          #reporte-print { width: 100%; height: auto !important; overflow: visible !important; }
          /* Ocultar controles y gráficas en el PDF (solo KPIs y listados) */
          #reporte-print input,
          #reporte-print select,
          #reporte-print [class*="btn-"],
          #reporte-print .recharts-responsive-container,
          #reporte-print .recharts-wrapper { display: none !important; }
          /* ── Modo compacto: menos interlineado y totales reducidos ── */
          #reporte-print { font-size: 10px !important; }
          #reporte-print .p-6 { padding: 6px 8px !important; }
          #reporte-print [class*="space-y"] > * + * { margin-top: 4px !important; }
          #reporte-print .gap-3, #reporte-print .gap-4 { gap: 4px !important; }
          #reporte-print .card { box-shadow: none !important; border-radius: 4px !important; }
          #reporte-print .card.p-3, #reporte-print .card.p-4, #reporte-print .card.p-5 { padding: 4px 8px !important; }
          #reporte-print .text-lg, #reporte-print .text-xl, #reporte-print .text-2xl,
          #reporte-print .text-3xl { font-size: 12px !important; line-height: 1.2 !important; }
          #reporte-print table th, #reporte-print table td {
            padding: 2px 6px !important;
            font-size: 9.5px !important;
            line-height: 1.25 !important;
          }
          #reporte-print .badge { padding: 0 4px !important; font-size: 8.5px !important; }
          @page { margin: 10mm; }
        }
      `}</style>
    </AppLayout>
  )
}

export default withPagePermission(ReportesPage, 'reportes', 'ver')
