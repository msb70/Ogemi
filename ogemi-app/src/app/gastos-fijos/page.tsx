'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { createClient } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useToast } from '@/hooks/useToast'
import { Toast } from '@/components/Toast'
import PermissionGuard, { withPagePermission } from '@/components/PermissionGuard'
import { CalendarDays, Plus, Save, WalletCards, Trash2, FileText, ClipboardList, ShoppingCart } from 'lucide-react'
import VencimientoSemanalVentas from '@/app/reportes/components/VencimientoSemanalVentas'
import VencimientoSemanalPresupuestos from '@/app/reportes/components/VencimientoSemanalPresupuestos'
import VencimientoSemanalCompras from '@/app/reportes/components/VencimientoSemanalCompras'
import { buildVencimientoViernes, buildVencimientoSemanal } from '@/app/reportes/reportes.utils'

type TipoMarca = 'venta' | 'presupuesto' | 'compra'

type GastoFijo = {
  id: string
  nombre: string
  activo: boolean
  orden: number
}

type GastoMonto = {
  id: string
  gasto_fijo_id: string
  periodo: string
  semana: 1 | 2 | 3 | 4
  monto: number
  notas: string | null
}

type BancoCuentaLite = {
  id: string
  nombre: string
  banco: string
}

type Pestana = 'gastos' | 'ventas' | 'presupuestos' | 'compras'

const SEMANAS = [1, 2, 3, 4] as const
type Semana = (typeof SEMANAS)[number]
type MontosSemana = Record<Semana, string>

const emptyMontos = (): MontosSemana => ({ 1: '', 2: '', 3: '', 4: '' })

const currentMonth = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

const monthToPeriod = (month: string) => `${month}-01`

const toISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Fechas por defecto: el viernes de cada una de las 4 semanas del mes. */
const defaultWeekDates = (month: string): string[] => {
  const [y, m] = month.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const offset = (5 - first.getDay() + 7) % 7 // 5 = viernes
  const firstFriday = 1 + offset
  return [0, 1, 2, 3].map(i => toISO(new Date(y, m - 1, firstFriday + i * 7)))
}

function GastosFijosPage() {
  const supabase = useMemo(() => createClient(), [])
  const { toast, showToast, hideToast } = useToast()
  const [pestana, setPestana] = useState<Pestana>('gastos')
  const [periodoMes, setPeriodoMes] = useState(currentMonth)
  const [fechaResumen, setFechaResumen] = useState(new Date().toISOString().split('T')[0])
  const [gastos, setGastos] = useState<GastoFijo[]>([])
  const [montos, setMontos] = useState<Record<string, MontosSemana>>({})
  const [semanaFechas, setSemanaFechas] = useState<string[]>(() => defaultWeekDates(currentMonth()))
  const [cxcSemana, setCxcSemana] = useState<number[]>([0, 0, 0, 0])
  const [cuentas, setCuentas] = useState<BancoCuentaLite[]>([])
  const [saldoBancos, setSaldoBancos] = useState(0)
  const [cuentasPorCobrar, setCuentasPorCobrar] = useState(0)
  const [facturasPendientes, setFacturasPendientes] = useState(0)
  const [loading, setLoading] = useState(true)
  const [savingMontos, setSavingMontos] = useState(false)
  const [nuevoGastoNombre, setNuevoGastoNombre] = useState('')
  const [gastoAEliminar, setGastoAEliminar] = useState<GastoFijo | null>(null)
  const [eliminando, setEliminando] = useState(false)

  // Datos para las pestañas de vencimiento semanal y el resumen del flujo
  const [vencLoaded, setVencLoaded] = useState(false)
  const [vencLoading, setVencLoading] = useState(false)
  const [facturasAll, setFacturasAll] = useState<any[]>([])
  const [presupuestosAll, setPresupuestosAll] = useState<any[]>([])
  const [comprasAll, setComprasAll] = useState<any[]>([])

  // Marcas persistidas por período: venta/presupuesto = "No pagará"; compra = "Pagará"
  const [marcasVentas, setMarcasVentas] = useState<Set<string>>(new Set())
  const [marcasPresupuestos, setMarcasPresupuestos] = useState<Set<string>>(new Set())
  const [marcasCompras, setMarcasCompras] = useState<Set<string>>(new Set())

  const periodo = useMemo(() => monthToPeriod(periodoMes), [periodoMes])

  const totalesSemana = useMemo(
    () =>
      SEMANAS.map(s =>
        gastos.reduce((sum, gasto) => sum + (parseFloat(montos[gasto.id]?.[s] || '0') || 0), 0)
      ),
    [gastos, montos]
  )
  const totalGastos = useMemo(() => totalesSemana.reduce((a, b) => a + b, 0), [totalesSemana])
  const totalCxCBancos = cuentasPorCobrar + saldoBancos
  const disponibleDespuesGastos = totalCxCBancos - totalGastos

  const loadGastos = useCallback(async () => {
    const { data, error } = await supabase
      .from('gastos_fijos')
      .select('*')
      .order('orden', { ascending: true })
      .order('nombre', { ascending: true })

    if (error) {
      showToast(`Error al cargar gastos fijos: ${error.message}`, 'error')
      return
    }

    setGastos(data || [])
  }, [supabase, showToast])

  const loadMontos = useCallback(async () => {
    const { data, error } = await supabase
      .from('gastos_fijos_montos')
      .select('*')
      .eq('periodo', periodo)

    if (error) {
      showToast(`Error al cargar montos: ${error.message}`, 'error')
      return
    }

    const next: Record<string, MontosSemana> = {}
    ;((data || []) as GastoMonto[]).forEach(row => {
      if (!next[row.gasto_fijo_id]) next[row.gasto_fijo_id] = emptyMontos()
      if (row.semana >= 1 && row.semana <= 4) {
        next[row.gasto_fijo_id][row.semana as Semana] = String(row.monto ?? '')
      }
    })
    setMontos(next)
  }, [periodo, showToast, supabase])

  const loadSemanas = useCallback(async () => {
    const defaults = defaultWeekDates(periodoMes)
    const { data, error } = await supabase
      .from('gastos_fijos_semanas')
      .select('semana, fecha')
      .eq('periodo', periodo)

    if (error) {
      showToast(`Error al cargar fechas de semanas: ${error.message}`, 'error')
      setSemanaFechas(defaults)
      return
    }

    const fechas = [...defaults]
    ;((data || []) as { semana: number; fecha: string }[]).forEach(row => {
      if (row.semana >= 1 && row.semana <= 4) fechas[row.semana - 1] = row.fecha
    })
    setSemanaFechas(fechas)
  }, [periodo, periodoMes, showToast, supabase])

  const loadResumen = useCallback(async () => {
    const { data: facturasData, error: facturasError } = await supabase
      .from('facturas')
      .select('total,monto_pagado')
      .eq('estado', 'pendiente')
      .lte('fecha_pago', fechaResumen)

    if (facturasError) {
      showToast(`Error al calcular cuentas por cobrar: ${facturasError.message}`, 'error')
    } else {
      const facturas = facturasData || []
      setFacturasPendientes(facturas.length)
      setCuentasPorCobrar(
        facturas.reduce((sum, factura) =>
          sum + Math.max(0, (factura.total || 0) - (factura.monto_pagado || 0)), 0
        )
      )
    }

    const { data: cuentasData, error: cuentasError } = await supabase
      .from('banco_cuentas')
      .select('id,nombre,banco')
      .eq('activo', true)
      .order('nombre')

    if (cuentasError) {
      showToast(`Error al cargar bancos: ${cuentasError.message}`, 'error')
      return
    }

    const cuentasActivas = cuentasData || []
    setCuentas(cuentasActivas)
    const saldos = await Promise.all(
      cuentasActivas.map(cuenta => supabase.rpc('saldo_cuenta', {
        p_cuenta_id: cuenta.id,
        p_hasta: fechaResumen,
      }))
    )
    setSaldoBancos(saldos.reduce((sum, result) => sum + (result.data || 0), 0))
  }, [fechaResumen, showToast, supabase])

  const loadCxcSemana = useCallback(async (fechas: string[]) => {
    const results = await Promise.all(
      fechas.map(async fecha => {
        if (!fecha) return 0
        const { data } = await supabase
          .from('facturas')
          .select('total,monto_pagado')
          .eq('estado', 'pendiente')
          .lte('fecha_pago', fecha)
        return (data || []).reduce(
          (sum, f) => sum + Math.max(0, (f.total || 0) - (f.monto_pagado || 0)),
          0
        )
      })
    )
    setCxcSemana(results)
  }, [supabase])

  const loadAll = useCallback(async () => {
    setLoading(true)
    await Promise.all([loadGastos(), loadMontos(), loadSemanas(), loadResumen()])
    setLoading(false)
  }, [loadGastos, loadMontos, loadSemanas, loadResumen])

  useEffect(() => { loadAll() }, [loadAll])

  // Recalcular CxC vencida a la fecha de cada semana cuando cambian las fechas
  useEffect(() => { loadCxcSemana(semanaFechas) }, [semanaFechas, loadCxcSemana])

  // Cargar facturas/presupuestos/compras (alimentan las pestañas y el resumen del flujo)
  const loadVencimientos = useCallback(async () => {
    setVencLoading(true)
    const [
      { data: facturasData, error: e1 },
      { data: presupuestosData, error: e2 },
      { data: comprasData, error: e3 },
    ] = await Promise.all([
      supabase.from('facturas').select('*, clientes(nombre)').order('fecha', { ascending: false }),
      supabase.from('presupuestos').select('*, clientes(nombre)').order('fecha', { ascending: false }),
      supabase.from('compras').select('*, proveedores(nombre)').order('fecha', { ascending: false }),
    ])
    const err = e1 || e2 || e3
    if (err) {
      showToast(`Error al cargar vencimientos: ${err.message}`, 'error')
    }
    setFacturasAll(facturasData || [])
    setPresupuestosAll(presupuestosData || [])
    setComprasAll(comprasData || [])
    setVencLoading(false)
    setVencLoaded(true)
  }, [showToast, supabase])

  useEffect(() => { loadVencimientos() }, [loadVencimientos])

  // Cargar marcas del período
  const loadMarcas = useCallback(async () => {
    const { data, error } = await supabase
      .from('flujo_pago_marcas')
      .select('tipo, doc_id')
      .eq('periodo', periodo)
    if (error) {
      showToast(`Error al cargar marcas del flujo: ${error.message}`, 'error')
      return
    }
    const v = new Set<string>(), p = new Set<string>(), c = new Set<string>()
    ;(data || []).forEach((m: { tipo: TipoMarca; doc_id: string }) => {
      if (m.tipo === 'venta') v.add(m.doc_id)
      else if (m.tipo === 'presupuesto') p.add(m.doc_id)
      else if (m.tipo === 'compra') c.add(m.doc_id)
    })
    setMarcasVentas(v)
    setMarcasPresupuestos(p)
    setMarcasCompras(c)
  }, [periodo, showToast, supabase])

  useEffect(() => { loadMarcas() }, [loadMarcas])

  // Marcar/desmarcar con actualización optimista + persistencia
  const toggleMarca = useCallback(async (tipo: TipoMarca, id: string, marked: boolean) => {
    const setter = tipo === 'venta' ? setMarcasVentas : tipo === 'presupuesto' ? setMarcasPresupuestos : setMarcasCompras
    const apply = (add: boolean) => setter(prev => {
      const next = new Set(prev)
      add ? next.add(id) : next.delete(id)
      return next
    })
    apply(marked)
    const { error } = marked
      ? await supabase.from('flujo_pago_marcas')
          .upsert({ periodo, tipo, doc_id: id }, { onConflict: 'periodo,tipo,doc_id', ignoreDuplicates: true })
      : await supabase.from('flujo_pago_marcas')
          .delete().eq('periodo', periodo).eq('tipo', tipo).eq('doc_id', id)
    if (error) {
      apply(!marked) // revertir
      showToast(`Error al guardar la marca: ${error.message}`, 'error')
    }
  }, [periodo, showToast, supabase])

  // ── Resumen del flujo de pago por semana ────────────────────────────────────
  const flujo = useMemo(() => {
    const dateObjs = semanaFechas.map(d => new Date(d + 'T00:00:00'))
    const vencVentas = buildVencimientoViernes(facturasAll, dateObjs)
    const vencPres = buildVencimientoSemanal(presupuestosAll, dateObjs, 'fecha_pago')
    const vencComp = buildVencimientoSemanal(comprasAll, dateObjs, 'vencimiento')

    const cobrosVentas = dateObjs.map((_, i) =>
      vencVentas.rows.filter((r: any) => r.fridayIdx === i && !marcasVentas.has(r.id))
        .reduce((s: number, r: any) => s + ((r.total as number) || 0), 0))
    const cobrosPres = dateObjs.map((_, i) =>
      vencPres.rows.filter((r: any) => r.fridayIdx === i && !marcasPresupuestos.has(r.id))
        .reduce((s: number, r: any) => s + (r.saldo || 0), 0))
    const comprasPagar = vencComp.rows.filter((r: any) => marcasCompras.has(r.id))
    const pagosCompras = dateObjs.map((_, i) =>
      comprasPagar.filter((r: any) => r.fridayIdx === i)
        .reduce((s: number, r: any) => s + (r.saldo || 0), 0))
    return { cobrosVentas, cobrosPres, pagosCompras, comprasPagar }
  }, [semanaFechas, facturasAll, presupuestosAll, comprasAll, marcasVentas, marcasPresupuestos, marcasCompras])

  const flujoNetoSemana = SEMANAS.map((_, i) =>
    flujo.cobrosVentas[i] + flujo.cobrosPres[i] - flujo.pagosCompras[i] - totalesSemana[i])
  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0)

  const crearGasto = async () => {
    const nombre = nuevoGastoNombre.trim()
    if (!nombre) return

    const { error } = await supabase.from('gastos_fijos').insert({
      nombre,
      orden: gastos.length + 1,
    })

    if (error) {
      showToast(`Error al crear gasto fijo: ${error.message}`, 'error')
      return
    }

    setNuevoGastoNombre('')
    showToast('Gasto fijo creado.')
    loadGastos()
  }

  const guardarMontos = async () => {
    const rows = gastos
      .filter(gasto => gasto.activo)
      .flatMap(gasto => {
        const valores = montos[gasto.id] || emptyMontos()
        return SEMANAS.map(semana => ({
          gasto_fijo_id: gasto.id,
          periodo,
          semana,
          monto: parseFloat(valores[semana] || '0') || 0,
        }))
      })

    const fechasRows = SEMANAS.map(semana => ({
      periodo,
      semana,
      fecha: semanaFechas[semana - 1] || defaultWeekDates(periodoMes)[semana - 1],
    }))

    // Persistir nombres editados (solo filas con nombre no vacío)
    const gastoRows = gastos
      .filter(g => g.nombre.trim())
      .map(g => ({ id: g.id, nombre: g.nombre.trim() }))

    setSavingMontos(true)

    const [montosRes, fechasRes, gastosRes] = await Promise.all([
      rows.length > 0
        ? supabase.from('gastos_fijos_montos').upsert(rows, { onConflict: 'gasto_fijo_id,periodo,semana' })
        : Promise.resolve({ error: null }),
      supabase.from('gastos_fijos_semanas').upsert(fechasRows, { onConflict: 'periodo,semana' }),
      gastoRows.length > 0
        ? supabase.from('gastos_fijos').upsert(gastoRows, { onConflict: 'id' })
        : Promise.resolve({ error: null }),
    ])

    setSavingMontos(false)

    const err = montosRes.error || fechasRes.error || gastosRes.error
    if (err) {
      showToast(`Error al guardar: ${err.message}`, 'error')
      return
    }

    showToast('Cambios guardados.')
    loadGastos()
  }

  const updateGasto = (id: string, value: string) => {
    setGastos(prev => prev.map(g => (g.id === id ? { ...g, nombre: value } : g)))
  }

  const eliminarGasto = async () => {
    if (!gastoAEliminar) return
    setEliminando(true)
    const { error } = await supabase.from('gastos_fijos').delete().eq('id', gastoAEliminar.id)
    setEliminando(false)
    if (error) {
      showToast(`Error al eliminar: ${error.message}`, 'error')
      return
    }
    showToast('Gasto fijo eliminado.')
    setGastoAEliminar(null)
    loadGastos()
  }

  const updateMonto = (gastoId: string, semana: Semana, value: string) => {
    setMontos(prev => ({
      ...prev,
      [gastoId]: { ...emptyMontos(), ...prev[gastoId], [semana]: value },
    }))
  }

  const updateFecha = (semanaIndex: number, value: string) => {
    setSemanaFechas(prev => prev.map((f, i) => (i === semanaIndex ? value : f)))
  }

  const toggleActivo = async (gasto: GastoFijo) => {
    const { error } = await supabase
      .from('gastos_fijos')
      .update({ activo: !gasto.activo })
      .eq('id', gasto.id)

    if (error) {
      showToast(`Error al actualizar gasto fijo: ${error.message}`, 'error')
      return
    }

    loadGastos()
  }

  const pestanas: { key: Pestana; label: string; icon: React.ElementType }[] = [
    { key: 'gastos',       label: 'Flujo de pago',         icon: WalletCards },
    { key: 'ventas',       label: 'Ventas x semana',       icon: FileText },
    { key: 'presupuestos', label: 'Presupuestos x semana', icon: ClipboardList },
    { key: 'compras',      label: 'Compras x semana',      icon: ShoppingCart },
  ]

  return (
    <AppLayout>
      {toast && <Toast {...toast} onClose={hideToast} />}
      <Header
        title="Flujo de Pago"
        subtitle="Cobros probables, pagos y gastos fijos por semana"
      />

      <div className="bg-white border-b border-gray-200 px-6">
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

      {pestana !== 'gastos' && (
        <div className="p-6">
          {vencLoading || !vencLoaded ? (
            <div className="p-8 text-center text-sm text-gray-400">Cargando datos...</div>
          ) : (
            <>
              {pestana === 'ventas' && (
                <VencimientoSemanalVentas
                  facturas={facturasAll}
                  weekDates={semanaFechas}
                  setWeekDates={setSemanaFechas}
                  noPagaraSet={marcasVentas}
                  onToggleNoPagara={(id, marked) => toggleMarca('venta', id, marked)}
                />
              )}
              {pestana === 'presupuestos' && (
                <VencimientoSemanalPresupuestos
                  presupuestos={presupuestosAll}
                  weekDates={semanaFechas}
                  setWeekDates={setSemanaFechas}
                  noPagaraSet={marcasPresupuestos}
                  onToggleNoPagara={(id, marked) => toggleMarca('presupuesto', id, marked)}
                />
              )}
              {pestana === 'compras' && (
                <VencimientoSemanalCompras
                  compras={comprasAll}
                  weekDates={semanaFechas}
                  setWeekDates={setSemanaFechas}
                  pagaraSet={marcasCompras}
                  onTogglePagara={(id, marked) => toggleMarca('compra', id, marked)}
                />
              )}
            </>
          )}
        </div>
      )}

      {pestana === 'gastos' && (
      <div className="p-6 space-y-6">
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-3">
              <CalendarDays size={16} className="text-brand-600" />
              <h2 className="text-sm font-semibold text-gray-800">Periodo de gastos</h2>
            </div>
            <label>
              <span className="label">Mes y año</span>
              <input
                type="month"
                className="input"
                value={periodoMes}
                onChange={event => setPeriodoMes(event.target.value)}
              />
            </label>
          </div>

          <div className="card p-4">
            <div className="flex items-center gap-2 mb-3">
              <WalletCards size={16} className="text-brand-600" />
              <h2 className="text-sm font-semibold text-gray-800">Resumen a fecha</h2>
            </div>
            <label>
              <span className="label">Fecha de corte</span>
              <input
                type="date"
                className="input"
                value={fechaResumen}
                onChange={event => setFechaResumen(event.target.value)}
              />
            </label>
          </div>

        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
          <div className="card p-4">
            <p className="text-xs font-semibold uppercase text-gray-500">CxC vencida al corte</p>
            <p className="mt-2 text-2xl font-bold text-orange-600">{formatCurrency(cuentasPorCobrar)}</p>
            <p className="text-xs text-gray-400">{facturasPendientes} facturas pendientes</p>
          </div>
          <div className="card p-4">
            <p className="text-xs font-semibold uppercase text-gray-500">Saldo total bancos</p>
            <p className="mt-2 text-2xl font-bold text-brand-700">{formatCurrency(saldoBancos)}</p>
            <p className="text-xs text-gray-400">{cuentas.length} cuentas activas</p>
          </div>
          <div className="card p-4">
            <p className="text-xs font-semibold uppercase text-gray-500">CxC + bancos</p>
            <p className="mt-2 text-2xl font-bold text-gray-900">{formatCurrency(totalCxCBancos)}</p>
            <p className="text-xs text-gray-400">Disponible antes de gastos</p>
          </div>
          <div className="card p-4">
            <p className="text-xs font-semibold uppercase text-gray-500">Total gastos</p>
            <p className="mt-2 text-2xl font-bold text-gray-900">{formatCurrency(totalGastos)}</p>
            <p className="text-xs text-gray-400">4 semanas</p>
          </div>
          <div
            className={`card p-4 ${
              disponibleDespuesGastos >= 0
                ? 'bg-green-50 border-green-200'
                : 'bg-red-50 border-red-200'
            }`}
          >
            <p
              className={`text-xs font-semibold uppercase ${
                disponibleDespuesGastos >= 0 ? 'text-green-700' : 'text-red-700'
              }`}
            >
              Despues de gastos
            </p>
            <p
              className={`mt-2 text-2xl font-bold ${
                disponibleDespuesGastos >= 0 ? 'text-green-800' : 'text-red-800'
              }`}
            >
              {formatCurrency(disponibleDespuesGastos)}
            </p>
            <p className={disponibleDespuesGastos >= 0 ? 'text-xs text-green-700' : 'text-xs text-red-700'}>
              CxC + bancos - gastos
            </p>
          </div>
        </section>

        {/* Flujo de pago por semana: cobros probables − compras a pagar − gastos fijos */}
        <section className="card overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Flujo de pago por semana - {periodoMes}
            </p>
          </div>
          {vencLoading || !vencLoaded ? (
            <div className="p-6 text-center text-sm text-gray-400">Cargando datos...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="table-header">Concepto</th>
                    {SEMANAS.map((semana, i) => (
                      <th key={semana} className="table-header text-right">
                        Semana {semana}
                        <span className="block font-normal text-[10px] text-gray-400">
                          {semanaFechas[i] ? formatDate(semanaFechas[i]) : ''}
                        </span>
                      </th>
                    ))}
                    <th className="table-header text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {[
                    { label: 'Cobros ventas (probable)',       vals: flujo.cobrosVentas, neg: false },
                    { label: 'Cobros presupuestos (probable)', vals: flujo.cobrosPres,   neg: false },
                    { label: 'Compras a pagar (marcadas)',     vals: flujo.pagosCompras, neg: true },
                    { label: 'Gastos fijos',                   vals: totalesSemana,      neg: true },
                  ].map(r => (
                    <tr key={r.label}>
                      <td className="table-cell text-sm font-medium">{r.label}</td>
                      {r.vals.map((v, i) => (
                        <td key={i} className={`table-cell text-right text-sm ${r.neg ? 'text-red-600' : 'text-green-700'}`}>
                          {v !== 0 ? `${r.neg ? '−' : ''}${formatCurrency(v)}` : '—'}
                        </td>
                      ))}
                      <td className={`table-cell text-right font-semibold ${r.neg ? 'text-red-600' : 'text-green-700'}`}>
                        {r.neg ? '−' : ''}{formatCurrency(sum(r.vals))}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                    <td className="table-cell">Flujo neto</td>
                    {flujoNetoSemana.map((v, i) => (
                      <td key={i} className={`table-cell text-right ${v >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                        {formatCurrency(v)}
                      </td>
                    ))}
                    <td className={`table-cell text-right ${sum(flujoNetoSemana) >= 0 ? 'text-green-800' : 'text-red-700'}`}>
                      {formatCurrency(sum(flujoNetoSemana))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

        <section className="card p-4">
          <div className="flex items-center gap-2 mb-4">
            <Plus size={16} className="text-brand-600" />
            <h2 className="text-sm font-semibold text-gray-800">Crear gasto fijo</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
            <label>
              <span className="label">Nombre</span>
              <input
                className="input"
                value={nuevoGastoNombre}
                onChange={event => setNuevoGastoNombre(event.target.value)}
                placeholder="Ej. Alquiler, planilla, internet"
              />
            </label>
            <button className="btn-primary inline-flex items-center gap-2" onClick={crearGasto}>
              <Plus size={16} />
              Crear
            </button>
          </div>
        </section>

        <section className="card overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Montos de gastos fijos - {periodoMes}
            </p>
            <button
              className="btn-secondary inline-flex items-center gap-2 py-1.5 text-xs"
              onClick={guardarMontos}
              disabled={savingMontos || loading || gastos.every(gasto => !gasto.activo)}
            >
              <Save size={14} />
              {savingMontos ? 'Guardando' : 'Guardar'}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="table-header">Gasto fijo</th>
                  {SEMANAS.map((semana, i) => (
                    <th key={semana} className="table-header text-right">
                      <div className="flex flex-col items-end gap-1">
                        <span>Semana {semana}</span>
                        <input
                          type="date"
                          className="input py-1 text-xs max-w-[150px]"
                          value={semanaFechas[i] || ''}
                          onChange={event => updateFecha(i, event.target.value)}
                          title="Fecha de la semana (editable)"
                        />
                      </div>
                    </th>
                  ))}
                  <th className="table-header text-right">Total</th>
                  <th className="table-header">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={7} className="text-center py-10 text-gray-400">Cargando...</td></tr>
                ) : gastos.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-10 text-gray-400">No hay gastos fijos creados.</td></tr>
                ) : (
                  gastos.map(gasto => {
                    const fila = montos[gasto.id] || emptyMontos()
                    const totalFila = SEMANAS.reduce((sum, s) => sum + (parseFloat(fila[s] || '0') || 0), 0)
                    return (
                      <tr key={gasto.id} className={!gasto.activo ? 'opacity-50' : ''}>
                        <td className="table-cell">
                          <input
                            className="input min-w-[160px]"
                            value={gasto.nombre}
                            onChange={event => updateGasto(gasto.id, event.target.value)}
                            disabled={!gasto.activo}
                          />
                        </td>
                        {SEMANAS.map(semana => (
                          <td key={semana} className="table-cell">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              className="input max-w-[120px] text-right ml-auto"
                              value={fila[semana] || ''}
                              onChange={event => updateMonto(gasto.id, semana, event.target.value)}
                              disabled={!gasto.activo}
                            />
                          </td>
                        ))}
                        <td className="table-cell text-right font-semibold">{formatCurrency(totalFila)}</td>
                        <td className="table-cell">
                          <div className="flex items-center gap-2">
                            <button
                              className={`badge ${gasto.activo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                              onClick={() => toggleActivo(gasto)}
                            >
                              {gasto.activo ? 'Activo' : 'Inactivo'}
                            </button>
                            <PermissionGuard modulo="gastos_fijos" accion="borrar" silent>
                              <button
                                className="text-red-400 hover:text-red-600"
                                onClick={() => setGastoAEliminar(gasto)}
                                title="Eliminar gasto fijo"
                              >
                                <Trash2 size={15} />
                              </button>
                            </PermissionGuard>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
              {gastos.length > 0 && (
                <tfoot>
                  <tr className="border-t border-gray-200 bg-gray-50">
                    <td className="table-cell font-bold">Total semana</td>
                    {totalesSemana.map((total, i) => (
                      <td key={i} className="table-cell text-right font-bold">{formatCurrency(total)}</td>
                    ))}
                    <td className="table-cell text-right font-bold text-brand-700">{formatCurrency(totalGastos)}</td>
                    <td className="table-cell"></td>
                  </tr>
                  <tr className="bg-gray-50">
                    <td className="table-cell text-xs text-gray-500">CxC vencida a la fecha</td>
                    {cxcSemana.map((v, i) => (
                      <td key={i} className="table-cell text-right text-xs font-semibold text-orange-600">
                        {formatCurrency(v)}
                      </td>
                    ))}
                    <td className="table-cell"></td>
                    <td className="table-cell"></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>

        {/* Detalle: compras marcadas como "Pagará" */}
        <section className="card overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Compras a pagar (marcadas &quot;Pagará&quot;) - {periodoMes}
            </p>
          </div>
          {vencLoading || !vencLoaded ? (
            <div className="p-6 text-center text-sm text-gray-400">Cargando datos...</div>
          ) : flujo.comprasPagar.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400">
              No hay compras marcadas como &quot;Pagará&quot;. Márcalas en la pestaña Compras x semana.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="table-header">Proveedor</th>
                    <th className="table-header">Concepto</th>
                    <th className="table-header">Vencimiento</th>
                    {SEMANAS.map(semana => (
                      <th key={semana} className="table-header text-right">Semana {semana}</th>
                    ))}
                    <th className="table-header text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {flujo.comprasPagar.map((c: any) => (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="table-cell text-sm font-medium">{c.proveedores?.nombre || '—'}</td>
                      <td className="table-cell text-sm text-gray-500 max-w-[200px]">
                        <span className="truncate block">{c.concepto || c.referencia || '—'}</span>
                      </td>
                      <td className="table-cell text-sm text-gray-500">{formatDate(c.vencimiento)}</td>
                      {SEMANAS.map((_, i) => (
                        <td key={i} className="table-cell text-right text-sm">
                          {c.fridayIdx === i
                            ? <span className="font-medium text-red-600">−{formatCurrency(c.saldo)}</span>
                            : <span className="text-gray-200">—</span>}
                        </td>
                      ))}
                      <td className="table-cell text-right font-semibold text-red-600">−{formatCurrency(c.saldo)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                    <td colSpan={3} className="table-cell text-right text-sm text-gray-600">TOTAL A PAGAR</td>
                    {flujo.pagosCompras.map((v, i) => (
                      <td key={i} className="table-cell text-right text-red-600">{v > 0 ? `−${formatCurrency(v)}` : '—'}</td>
                    ))}
                    <td className="table-cell text-right text-red-600">−{formatCurrency(sum(flujo.pagosCompras))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>
      </div>
      )}

      {/* Modal: confirmar eliminación */}
      {gastoAEliminar && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
              <Trash2 size={18} className="text-red-500" /> Eliminar gasto fijo
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              ¿Seguro que quieres eliminar <span className="font-semibold">{gastoAEliminar.nombre}</span>?
              Se borrarán también sus montos registrados en todos los periodos. Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-3">
              <button
                className="btn-secondary flex-1"
                onClick={() => setGastoAEliminar(null)}
                disabled={eliminando}
              >
                Cancelar
              </button>
              <button
                className="btn-primary flex-1 !bg-red-600 hover:!bg-red-700"
                onClick={eliminarGasto}
                disabled={eliminando}
              >
                {eliminando ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}

export default withPagePermission(GastosFijosPage, 'gastos_fijos', 'ver')
