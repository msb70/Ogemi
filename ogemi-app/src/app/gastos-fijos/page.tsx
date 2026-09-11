'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { createClient } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useToast } from '@/hooks/useToast'
import { Toast } from '@/components/Toast'
import PermissionGuard, { withPagePermission } from '@/components/PermissionGuard'
import { CalendarDays, Plus, Save, WalletCards, Trash2, FileText, ClipboardList, ShoppingCart, Printer } from 'lucide-react'
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
  semana: number
  monto: number
  notas: string | null
}

type BancoCuentaLite = {
  id: string
  nombre: string
  banco: string
}

type Pestana = 'gastos' | 'ventas' | 'presupuestos' | 'compras'

/** Semanas del flujo: siempre 4, arrancando en la fecha de corte (corte, +7, +14, +21). */
const SEMANAS = [1, 2, 3, 4] as const
/** Máximo de semanas de gastos fijos en un mes (5 si el mes tiene 5 viernes). */
const MAX_SEMANAS_GASTOS = 5
type Semana = number
type MontosSemana = Record<number, string>

/**
 * Las marcas "Pagarán"/"Pagará" ya no van por mes: hay un solo juego global
 * (lo que está en pantalla). Se conserva la columna periodo con un valor fijo.
 */
const PERIODO_MARCAS = '1900-01-01'
const LS_CORTE_KEY = 'ogemi.flujo.corte'

const emptyMontos = (): MontosSemana => ({})

const toISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const todayISO = () => toISO(new Date())

const parseISO = (s: string) => new Date(s + 'T00:00:00')

const addDays = (iso: string, n: number) => {
  const d = parseISO(iso)
  d.setDate(d.getDate() + n)
  return toISO(d)
}

/** 'AAAA-MM' del mes al que pertenece una fecha ISO. */
const monthOf = (iso: string) => iso.slice(0, 7)

const monthToPeriod = (month: string) => `${month}-01`

/** 'AAAA-MM' del mes siguiente. */
const nextMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Fechas de las semanas de gastos fijos: todos los viernes del mes (4 o 5).
 * Los gastos siempre van del principio al final del mes.
 */
const fridaysOfMonth = (month: string): string[] => {
  const [y, m] = month.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const offset = (5 - first.getDay() + 7) % 7 // 5 = viernes
  const out: string[] = []
  for (let day = 1 + offset; day <= 31; day += 7) {
    const d = new Date(y, m - 1, day)
    if (d.getMonth() !== m - 1) break
    out.push(toISO(d))
  }
  return out
}

/** Las 4 fechas del flujo: la fecha de corte es la semana 1, luego +7 días. */
const flujoWeekDates = (corte: string): string[] => SEMANAS.map((_, i) => addDays(corte, i * 7))

/**
 * Anchos de columna compartidos para que las semanas y Total queden alineadas
 * entre las tablas de flujo, gastos fijos y compras a pagar.
 * Estructura: [concepto flexible] [N semanas] [total] [estado/espaciador]
 */
const ColsSemana = ({ n = SEMANAS.length }: { n?: number }) => (
  <colgroup>
    <col />
    {Array.from({ length: n }, (_, i) => (
      <col key={i} className="w-36" />
    ))}
    <col className="w-32" />
    <col className="w-28" />
  </colgroup>
)

/**
 * Input de monto sin flechas (type="text"): mientras se edita muestra el valor
 * crudo; al salir, formateado con separador de miles y 2 decimales.
 */
function MontoInput({ value, onChange, onCommit, disabled }: {
  value: string
  onChange: (v: string) => void
  /** Se dispara al salir del campo, con el valor crudo actual (para autoguardar). */
  onCommit?: (v: string) => void
  disabled?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const num = parseFloat(value)
  const display = editing
    ? value
    : value && !isNaN(num)
      ? num.toLocaleString('es-PA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : ''
  return (
    <input
      type="text"
      inputMode="decimal"
      className="input max-w-[120px] text-right"
      value={display}
      disabled={disabled}
      onFocus={e => {
        setEditing(true)
        // Seleccionar el valor al enfocar: al escribir se reemplaza (no hay que borrar el 0)
        const t = e.target
        requestAnimationFrame(() => t.select())
      }}
      onBlur={() => { setEditing(false); onCommit?.(value) }}
      onChange={e => onChange(e.target.value.replace(/,/g, ''))}
    />
  )
}

function GastosFijosPage() {
  const supabase = useMemo(() => createClient(), [])
  const { toast, showToast, hideToast } = useToast()
  const [pestana, setPestana] = useState<Pestana>('gastos')
  // Fecha de corte = semana 1 del flujo. Se recuerda en el navegador.
  const [fechaResumen, setFechaResumen] = useState<string>(() => {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem(LS_CORTE_KEY) : null
      if (saved && /^\d{4}-\d{2}-\d{2}$/.test(saved)) return saved
    } catch { /* sin storage */ }
    return todayISO()
  })
  const [gastos, setGastos] = useState<GastoFijo[]>([])
  // Montos del mes del corte (editable) y del mes siguiente (solo para el flujo)
  const [montos, setMontos] = useState<Record<string, MontosSemana>>({})
  const [montosSig, setMontosSig] = useState<Record<string, MontosSemana> | null>(null)
  // Fechas de las semanas de gastos del mes del corte (viernes, editables) y del mes siguiente
  const [semanaFechas, setSemanaFechas] = useState<string[]>(() => fridaysOfMonth(monthOf(todayISO())))
  const [semanaFechasSig, setSemanaFechasSig] = useState<string[]>([])
  const [cxcSemana, setCxcSemana] = useState<number[]>([])
  const [cuentas, setCuentas] = useState<BancoCuentaLite[]>([])
  const [saldoBancos, setSaldoBancos] = useState(0)
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

  // Marcas persistidas por período: venta/presupuesto = "Pagarán" (solo lo marcado suma); compra = "Pagará"
  const [marcasVentas, setMarcasVentas] = useState<Set<string>>(new Set())
  const [marcasPresupuestos, setMarcasPresupuestos] = useState<Set<string>>(new Set())
  const [marcasCompras, setMarcasCompras] = useState<Set<string>>(new Set())
  // Montos parciales proyectados por compra marcada "Pagará" (doc_id → monto).
  // Solo hay entrada si el usuario fijó un monto menor al saldo; ausente = saldo completo.
  const [montosPagaraCompras, setMontosPagaraCompras] = useState<Record<string, number>>({})
  // Semana elegida a mano para pagar una compra (0-3). Ausente = la del vencimiento.
  const [semanasPagaraCompras, setSemanasPagaraCompras] = useState<Record<string, number>>({})

  // Mes de gastos fijos = mes de la fecha de corte
  const periodoMes = useMemo(() => monthOf(fechaResumen), [fechaResumen])
  const periodo = useMemo(() => monthToPeriod(periodoMes), [periodoMes])
  const periodoMesSig = useMemo(() => nextMonth(periodoMes), [periodoMes])
  const periodoSig = useMemo(() => monthToPeriod(periodoMesSig), [periodoMesSig])
  // Semanas de gastos del mes (1..4 o 1..5)
  const semanasGastos = useMemo(() => semanaFechas.map((_, i) => i + 1), [semanaFechas])
  // Semanas del flujo: corte + 7 días
  const flujoFechas = useMemo(() => flujoWeekDates(fechaResumen), [fechaResumen])

  useEffect(() => {
    try { localStorage.setItem(LS_CORTE_KEY, fechaResumen) } catch { /* sin storage */ }
  }, [fechaResumen])

  // Totales de la tabla de gastos fijos del mes (por semana del mes)
  const totalesSemana = useMemo(
    () =>
      semanasGastos.map(s =>
        gastos.filter(g => g.activo).reduce((sum, gasto) => sum + (parseFloat(montos[gasto.id]?.[s] || '0') || 0), 0)
      ),
    [gastos, montos, semanasGastos]
  )

  /**
   * Gastos fijos que caen en cada semana del flujo.
   * Regla: la semana de gastos que "coincide" con la semana del flujo es la
   * primera fecha de gastos >= fecha de la semana del flujo (y a menos de 7
   * días). Ej.: corte 11-09 → gastos de la semana del 11-09; flujo semana 4
   * (02-10) → gastos de la semana 1 de octubre. Si el mes siguiente no tiene
   * montos cargados, se reutilizan los del mes actual por número de semana.
   */
  const gastosFlujoSemana = useMemo(() => {
    const activos = gastos.filter(g => g.activo)
    const sumSemana = (src: Record<string, MontosSemana>, s: number) =>
      activos.reduce((sum, g) => sum + (parseFloat(src[g.id]?.[s] || '0') || 0), 0)
    const candidatos: { fecha: string; monto: number }[] = [
      ...semanaFechas.map((fecha, i) => ({ fecha, monto: sumSemana(montos, i + 1) })),
      ...semanaFechasSig.map((fecha, i) => ({ fecha, monto: sumSemana(montosSig ?? montos, i + 1) })),
    ].filter(c => !!c.fecha).sort((a, b) => (a.fecha < b.fecha ? -1 : 1))
    return flujoFechas.map(f => {
      const fin = addDays(f, 7)
      const c = candidatos.find(x => x.fecha >= f && x.fecha < fin)
      return c ? c.monto : 0
    })
  }, [gastos, montos, montosSig, semanaFechas, semanaFechasSig, flujoFechas])
  const totalGastos = useMemo(() => gastosFlujoSemana.reduce((a, b) => a + b, 0), [gastosFlujoSemana])

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

    let rows: Pick<GastoMonto, 'gasto_fijo_id' | 'semana' | 'monto'>[] = (data || []) as GastoMonto[]

    // Período sin montos: se arrastran los del último período que sí tenga
    // (el usuario solo ajusta lo que cambie mes a mes). Se persisten para que
    // el flujo y los KPIs los tomen igual que si se hubieran escrito a mano.
    // Solo para el mes en curso o futuros: no se inventan montos en períodos históricos.
    if (rows.length === 0 && periodo >= monthToPeriod(monthOf(todayISO()))) {
      const { data: prev } = await supabase
        .from('gastos_fijos_montos')
        .select('periodo')
        .lt('periodo', periodo)
        .order('periodo', { ascending: false })
        .limit(1)
      const periodoPrev = prev?.[0]?.periodo as string | undefined
      if (periodoPrev) {
        const { data: prevRows } = await supabase
          .from('gastos_fijos_montos')
          .select('*')
          .eq('periodo', periodoPrev)
        const copia = ((prevRows || []) as GastoMonto[])
          .filter(r => r.semana >= 1 && r.semana <= MAX_SEMANAS_GASTOS)
          .map(r => ({ gasto_fijo_id: r.gasto_fijo_id, periodo, semana: r.semana, monto: r.monto }))
        if (copia.length > 0) {
          const { error: copyError } = await supabase
            .from('gastos_fijos_montos')
            .upsert(copia, { onConflict: 'gasto_fijo_id,periodo,semana' })
          if (copyError) {
            // Sin permiso de edición: se muestran igual, pero no quedan guardados
            showToast(`Montos del período anterior mostrados sin guardar: ${copyError.message}`, 'error')
          } else {
            showToast(`Gastos fijos copiados de ${periodoPrev.slice(0, 7)}. Ajusta solo lo que cambie.`, 'success')
          }
          rows = copia
        }
      }
    }

    const next: Record<string, MontosSemana> = {}
    rows.forEach(row => {
      if (!next[row.gasto_fijo_id]) next[row.gasto_fijo_id] = emptyMontos()
      if (row.semana >= 1 && row.semana <= MAX_SEMANAS_GASTOS) {
        next[row.gasto_fijo_id][row.semana] = String(row.monto ?? '')
      }
    })
    setMontos(next)
  }, [periodo, showToast, supabase])

  // Montos del mes siguiente (solo lectura): el flujo puede cruzar de mes.
  // Si no hay filas, null → se reutilizan los del mes actual.
  const loadMontosSig = useCallback(async () => {
    const { data, error } = await supabase
      .from('gastos_fijos_montos')
      .select('gasto_fijo_id, semana, monto')
      .eq('periodo', periodoSig)
    if (error || !data || data.length === 0) { setMontosSig(null); return }
    const next: Record<string, MontosSemana> = {}
    ;(data as GastoMonto[]).forEach(row => {
      if (!next[row.gasto_fijo_id]) next[row.gasto_fijo_id] = emptyMontos()
      if (row.semana >= 1 && row.semana <= MAX_SEMANAS_GASTOS) next[row.gasto_fijo_id][row.semana] = String(row.monto ?? '')
    })
    setMontosSig(next)
  }, [periodoSig, supabase])

  /** Fechas de semanas de un mes: viernes por defecto, sobreescritas por lo guardado. */
  const fetchSemanas = useCallback(async (mes: string, per: string) => {
    const fechas = fridaysOfMonth(mes)
    const { data, error } = await supabase
      .from('gastos_fijos_semanas')
      .select('semana, fecha')
      .eq('periodo', per)
    if (error) return { fechas, error }
    ;((data || []) as { semana: number; fecha: string }[]).forEach(row => {
      if (row.semana >= 1 && row.semana <= fechas.length) fechas[row.semana - 1] = row.fecha
    })
    return { fechas, error: null }
  }, [supabase])

  const loadSemanas = useCallback(async () => {
    const [act, sig] = await Promise.all([
      fetchSemanas(periodoMes, periodo),
      fetchSemanas(periodoMesSig, periodoSig),
    ])
    if (act.error) showToast(`Error al cargar fechas de semanas: ${act.error.message}`, 'error')
    setSemanaFechas(act.fechas)
    setSemanaFechasSig(sig.fechas)
  }, [fetchSemanas, periodo, periodoMes, periodoSig, periodoMesSig, showToast])

  const loadResumen = useCallback(async () => {
    const { data: cuentasData, error: cuentasError } = await supabase
      .from('banco_cuentas')
      .select('id,nombre,banco,tipo,dia_corte,dia_pago,saldo_inicial')
      .eq('activo', true)
      .order('orden')
      .order('nombre')

    if (cuentasError) {
      showToast(`Error al cargar bancos: ${cuentasError.message}`, 'error')
      return
    }

    // Las tarjetas de crédito no son efectivo: se excluyen del saldo de bancos
    // (evita contar la deuda dos veces). Su pago se maneja en Banco -> Tarjetas.
    const cuentasBanco = (cuentasData || []).filter((c: any) => c.tipo !== 'tarjeta_credito')
    setCuentas(cuentasBanco)
    const saldos = await Promise.all(
      cuentasBanco.map(cuenta => supabase.rpc('saldo_cuenta', {
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
    await Promise.all([loadGastos(), loadMontos(), loadMontosSig(), loadSemanas(), loadResumen()])
    setLoading(false)
  }, [loadGastos, loadMontos, loadMontosSig, loadSemanas, loadResumen])

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

  // Cargar marcas (juego global, sin mes)
  const loadMarcas = useCallback(async () => {
    const { data, error } = await supabase
      .from('flujo_pago_marcas')
      .select('tipo, doc_id, monto, semana_idx')
      .eq('periodo', PERIODO_MARCAS)
    if (error) {
      showToast(`Error al cargar marcas del flujo: ${error.message}`, 'error')
      return
    }
    const v = new Set<string>(), p = new Set<string>(), c = new Set<string>()
    const montos: Record<string, number> = {}
    const semanas: Record<string, number> = {}
    ;(data || []).forEach((m: { tipo: TipoMarca; doc_id: string; monto: number | null; semana_idx: number | null }) => {
      if (m.tipo === 'venta') v.add(m.doc_id)
      else if (m.tipo === 'presupuesto') p.add(m.doc_id)
      else if (m.tipo === 'compra') {
        c.add(m.doc_id)
        if (m.monto != null) montos[m.doc_id] = Number(m.monto)
        if (m.semana_idx != null) semanas[m.doc_id] = Number(m.semana_idx)
      }
    })
    setMarcasVentas(v)
    setMarcasPresupuestos(p)
    setMarcasCompras(c)
    setMontosPagaraCompras(montos)
    setSemanasPagaraCompras(semanas)
  }, [showToast, supabase])

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
    // Al desmarcar una compra se descartan su monto parcial y su semana elegida
    if (tipo === 'compra' && !marked) {
      setMontosPagaraCompras(prev => {
        if (!(id in prev)) return prev
        const next = { ...prev }; delete next[id]; return next
      })
      setSemanasPagaraCompras(prev => {
        if (!(id in prev)) return prev
        const next = { ...prev }; delete next[id]; return next
      })
    }
    const { error } = marked
      ? await supabase.from('flujo_pago_marcas')
          .upsert({ periodo: PERIODO_MARCAS, tipo, doc_id: id }, { onConflict: 'periodo,tipo,doc_id', ignoreDuplicates: true })
      : await supabase.from('flujo_pago_marcas')
          .delete().eq('periodo', PERIODO_MARCAS).eq('tipo', tipo).eq('doc_id', id)
    if (error) {
      apply(!marked) // revertir
      showToast(`Error al guardar la marca: ${error.message}`, 'error')
    }
  }, [showToast, supabase])

  // Marcar/desmarcar TODAS las filas visibles de una pestaña (persistido en lote)
  const toggleMarcaMany = useCallback(async (tipo: TipoMarca, ids: string[], marked: boolean) => {
    if (ids.length === 0) return
    const setter = tipo === 'venta' ? setMarcasVentas : tipo === 'presupuesto' ? setMarcasPresupuestos : setMarcasCompras
    setter(prev => {
      const next = new Set(prev)
      ids.forEach(id => marked ? next.add(id) : next.delete(id))
      return next
    })
    if (tipo === 'compra' && !marked) {
      setMontosPagaraCompras(prev => {
        const next = { ...prev }
        ids.forEach(id => { delete next[id] })
        return next
      })
      setSemanasPagaraCompras(prev => {
        const next = { ...prev }
        ids.forEach(id => { delete next[id] })
        return next
      })
    }
    const { error } = marked
      ? await supabase.from('flujo_pago_marcas')
          .upsert(ids.map(id => ({ periodo: PERIODO_MARCAS, tipo, doc_id: id })), { onConflict: 'periodo,tipo,doc_id', ignoreDuplicates: true })
      : await supabase.from('flujo_pago_marcas')
          .delete().eq('periodo', PERIODO_MARCAS).eq('tipo', tipo).in('doc_id', ids)
    if (error) {
      await loadMarcas() // resincronizar con la BD
      showToast(`Error al guardar las marcas: ${error.message}`, 'error')
    }
  }, [loadMarcas, showToast, supabase])

  // Fijar el monto parcial proyectado de una compra marcada "Pagará".
  // null = volver al saldo completo. Se persiste en flujo_pago_marcas.monto.
  const setMontoPagaraCompra = useCallback(async (id: string, monto: number | null) => {
    setMontosPagaraCompras(prev => {
      const next = { ...prev }
      if (monto == null) delete next[id]; else next[id] = monto
      return next
    })
    const { error } = await supabase.from('flujo_pago_marcas')
      .upsert({ periodo: PERIODO_MARCAS, tipo: 'compra', doc_id: id, monto }, { onConflict: 'periodo,tipo,doc_id' })
    if (error) {
      await loadMarcas() // resincronizar con la BD
      showToast(`Error al guardar el monto a pagar: ${error.message}`, 'error')
    }
  }, [loadMarcas, showToast, supabase])

  // Adelantar o atrasar el pago proyectado de una compra a otra semana del período.
  // null = volver a la semana que corresponda por su fecha de vencimiento.
  const setSemanaPagaraCompra = useCallback(async (id: string, semana: number | null) => {
    setSemanasPagaraCompras(prev => {
      const next = { ...prev }
      if (semana == null) delete next[id]; else next[id] = semana
      return next
    })
    const { error } = await supabase.from('flujo_pago_marcas')
      .upsert({ periodo: PERIODO_MARCAS, tipo: 'compra', doc_id: id, semana_idx: semana }, { onConflict: 'periodo,tipo,doc_id' })
    if (error) {
      await loadMarcas()
      showToast(`Error al guardar la semana de pago: ${error.message}`, 'error')
    }
  }, [loadMarcas, showToast, supabase])

  // ── Resumen del flujo de pago por semana ────────────────────────────────────
  const flujo = useMemo(() => {
    const dateObjs = flujoFechas.map(parseISO)
    // Lo vencido antes de la fecha de corte cae en la semana 1 (= corte)
    const cutoff = parseISO(fechaResumen)
    const vencVentas = buildVencimientoViernes(facturasAll, dateObjs, cutoff)
    const vencPres = buildVencimientoSemanal(presupuestosAll, dateObjs, 'fecha_pago', cutoff)
    const vencComp = buildVencimientoSemanal(comprasAll, dateObjs, 'vencimiento', cutoff)

    const cobrosVentas = dateObjs.map((_, i) =>
      vencVentas.rows.filter((r: any) => r.fridayIdx === i && marcasVentas.has(r.id))
        .reduce((s: number, r: any) => s + ((r.saldo as number) || 0), 0))
    const cobrosPres = dateObjs.map((_, i) =>
      vencPres.rows.filter((r: any) => r.fridayIdx === i && marcasPresupuestos.has(r.id))
        .reduce((s: number, r: any) => s + (r.saldo || 0), 0))
    // Compras marcadas "Pagará": el monto proyectado es el parcial fijado por el
    // usuario (si existe) o el saldo completo. El flujo usa ese monto proyectado.
    const comprasPagar = vencComp.rows
      .filter((r: any) => marcasCompras.has(r.id))
      .map((r: any) => {
        const saldo = (r.saldo as number) || 0
        const m = montosPagaraCompras[r.id]
        // Semana elegida a mano (adelantar/atrasar) o la que toca por vencimiento
        const ov = semanasPagaraCompras[r.id]
        const fridayIdx = ov != null && ov >= 0 && ov < dateObjs.length ? ov : r.fridayIdx
        return { ...r, fridayIdx, pagoProyectado: m != null ? Math.min(m, saldo) : saldo }
      })
    const pagosCompras = dateObjs.map((_, i) =>
      comprasPagar.filter((r: any) => r.fridayIdx === i)
        .reduce((s: number, r: any) => s + (r.pagoProyectado || 0), 0))

    // Semana de corte: la primera semana cuya fecha es >= la fecha de corte.
    // Es donde arranca el saldo de bancos que se arrastra semana a semana.
    // Si el corte queda después de las 4 semanas (períodos históricos), semana 1.
    const idxCorte = dateObjs.findIndex(d => d >= cutoff)
    const semanaCorteIdx = idxCorte === -1 ? 0 : idxCorte

    return { cobrosVentas, cobrosPres, pagosCompras, comprasPagar, semanaCorteIdx }
  }, [flujoFechas, fechaResumen, facturasAll, presupuestosAll, comprasAll, marcasVentas, marcasPresupuestos, marcasCompras, montosPagaraCompras, semanasPagaraCompras])

  // Detalle de compras a pagar agrupado por proveedor: N facturas, monto por semana y total
  const comprasPagarPorProveedor = useMemo(() => {
    const m = new Map<string, { nombre: string; count: number; semanas: number[]; countSemanas: number[]; total: number }>()
    flujo.comprasPagar.forEach((c: any) => {
      const nombre = c.proveedores?.nombre || '—'
      if (!m.has(nombre)) m.set(nombre, { nombre, count: 0, semanas: SEMANAS.map(() => 0), countSemanas: SEMANAS.map(() => 0), total: 0 })
      const g = m.get(nombre)!
      const monto = c.pagoProyectado || 0
      g.count += 1
      g.total += monto
      if (c.fridayIdx >= 0 && c.fridayIdx < SEMANAS.length) {
        g.semanas[c.fridayIdx] += monto
        g.countSemanas[c.fridayIdx] += 1
      }
    })
    return Array.from(m.values()).sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [flujo.comprasPagar])

  const flujoNetoSemana = SEMANAS.map((_, i) =>
    flujo.cobrosVentas[i] + flujo.cobrosPres[i] - flujo.pagosCompras[i] - gastosFlujoSemana[i])
  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0)

  // Saldo de bancos proyectado: arranca en la semana de corte con el saldo real
  // y se arrastra con el flujo neto de cada semana. Las semanas anteriores al
  // corte quedan vacías (ya pasaron).
  const semanaCorteIdx = flujo.semanaCorteIdx
  const saldoInicialSemana: (number | null)[] = SEMANAS.map((_, i) =>
    i < semanaCorteIdx ? null : saldoBancos + sum(flujoNetoSemana.slice(semanaCorteIdx, i)))
  const saldoFinalSemana: (number | null)[] = SEMANAS.map((_, i) => {
    const ini = saldoInicialSemana[i]
    return ini == null ? null : ini + flujoNetoSemana[i]
  })
  const saldoFinalPeriodo = saldoBancos + sum(flujoNetoSemana.slice(semanaCorteIdx))

  // KPIs del flujo de pago
  const cobrosVentasTotal = sum(flujo.cobrosVentas)
  const cobrosPresTotal = sum(flujo.cobrosPres)
  const cxcProbable = cobrosVentasTotal + cobrosPresTotal           // ventas + presupuestos marcados "Pagarán"
  const comprasAPagarTotal = sum(flujo.pagosCompras)                // compras marcadas "Pagará"
  const totalCxCBancos = cxcProbable + saldoBancos
  const disponibleFlujo = totalCxCBancos - totalGastos - comprasAPagarTotal

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
        return semanasGastos.map(semana => ({
          gasto_fijo_id: gasto.id,
          periodo,
          semana,
          monto: parseFloat(valores[semana] || '0') || 0,
        }))
      })

    const fechasRows = semanasGastos.map(semana => ({
      periodo,
      semana,
      fecha: semanaFechas[semana - 1] || fridaysOfMonth(periodoMes)[semana - 1],
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

  // ── Autoguardado: montos, fechas y nombres se graban al editarlos ──────────
  const saveMonto = useCallback(async (gastoId: string, semana: Semana, raw: string) => {
    const monto = parseFloat(raw || '0') || 0
    const { error } = await supabase
      .from('gastos_fijos_montos')
      .upsert({ gasto_fijo_id: gastoId, periodo, semana, monto }, { onConflict: 'gasto_fijo_id,periodo,semana' })
    if (error) showToast(`Error al guardar el monto: ${error.message}`, 'error')
  }, [periodo, showToast, supabase])

  const persistFecha = useCallback(async (semana: number, fecha: string) => {
    const { error } = await supabase
      .from('gastos_fijos_semanas')
      .upsert({ periodo, semana, fecha }, { onConflict: 'periodo,semana' })
    if (error) showToast(`Error al guardar la fecha: ${error.message}`, 'error')
  }, [periodo, showToast, supabase])

  const saveNombre = useCallback(async (gasto: GastoFijo) => {
    const nombre = gasto.nombre.trim()
    if (!nombre) return
    const { error } = await supabase
      .from('gastos_fijos')
      .upsert({ id: gasto.id, nombre }, { onConflict: 'id' })
    if (error) showToast(`Error al guardar el nombre: ${error.message}`, 'error')
  }, [showToast, supabase])

  const updateFecha = (semanaIndex: number, value: string) => {
    setSemanaFechas(prev => prev.map((f, i) => (i === semanaIndex ? value : f)))
    if (value) persistFecha(semanaIndex + 1, value)
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
        actions={
          <button onClick={() => window.print()} className="btn-secondary flex items-center gap-2">
            <Printer size={16} /> Reporte PDF
          </button>
        }
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

      <div id="flujo-print">
      {/* Encabezado solo visible al imprimir / Guardar como PDF */}
      <div className="hidden print:block px-6 pt-6 mb-2">
        <div className="flex items-center gap-3 border-b-2 pb-3" style={{ borderColor: '#0f766e' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.jpeg" alt="Ogemi" style={{ width: 48, height: 48, objectFit: 'contain' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Flujo de Pago</div>
            <div style={{ fontSize: 11, color: '#6b7280' }}>Impresos Comerciales S.A. · Sistema Ogemi</div>
          </div>
          <div style={{ textAlign: 'right', fontSize: 10, color: '#6b7280' }}>
            <div>Corte: {formatDate(fechaResumen)} · Gastos: {periodoMes}</div>
            <div>Generado: {new Date().toLocaleString('es-PA')}</div>
          </div>
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
                  weekDates={flujoFechas}
                  datesReadOnly
                  pagaraSet={marcasVentas}
                  onTogglePagara={(id, marked) => toggleMarca('venta', id, marked)}
                  onToggleManyPagara={(ids, marked) => toggleMarcaMany('venta', ids, marked)}
                  cutoffDate={fechaResumen}
                />
              )}
              {pestana === 'presupuestos' && (
                <VencimientoSemanalPresupuestos
                  presupuestos={presupuestosAll}
                  weekDates={flujoFechas}
                  datesReadOnly
                  pagaraSet={marcasPresupuestos}
                  onTogglePagara={(id, marked) => toggleMarca('presupuesto', id, marked)}
                  onToggleManyPagara={(ids, marked) => toggleMarcaMany('presupuesto', ids, marked)}
                  cutoffDate={fechaResumen}
                />
              )}
              {pestana === 'compras' && (
                <VencimientoSemanalCompras
                  compras={comprasAll}
                  weekDates={flujoFechas}
                  datesReadOnly
                  pagaraSet={marcasCompras}
                  onTogglePagara={(id, marked) => toggleMarca('compra', id, marked)}
                  onToggleManyPagara={(ids, marked) => toggleMarcaMany('compra', ids, marked)}
                  pagaraMontos={montosPagaraCompras}
                  onChangeMontoPagara={setMontoPagaraCompra}
                  pagaraSemanas={semanasPagaraCompras}
                  onChangeSemanaPagara={setSemanaPagaraCompra}
                  cutoffDate={fechaResumen}
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
              <WalletCards size={16} className="text-brand-600" />
              <h2 className="text-sm font-semibold text-gray-800">Fecha de corte</h2>
            </div>
            <label>
              <span className="label">La fecha de corte es la semana 1 del flujo; las siguientes van cada 7 días</span>
              <input
                type="date"
                className="input"
                value={fechaResumen}
                onChange={event => { if (event.target.value) setFechaResumen(event.target.value) }}
              />
            </label>
            <p className="mt-2 text-xs text-gray-500">
              Semanas: {flujoFechas.map(f => formatDate(f)).join(' · ')}
            </p>
          </div>

          <div className="card p-4">
            <div className="flex items-center gap-2 mb-3">
              <CalendarDays size={16} className="text-brand-600" />
              <h2 className="text-sm font-semibold text-gray-800">Gastos fijos del mes</h2>
            </div>
            <p className="text-lg font-semibold text-gray-900">{periodoMes}</p>
            <p className="mt-1 text-xs text-gray-500">
              {semanaFechas.length} semanas (viernes del mes). El flujo toma la semana de gastos que coincide con cada
              semana del corte; si cruza de mes usa {periodoMesSig}{montosSig ? '' : ' (sin montos: se repiten los de este mes)'}.
            </p>
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-4">
          <div className="card p-4">
            <p className="text-xs font-semibold uppercase text-gray-500">CxC marcada Pagarán</p>
            <p className="mt-2 text-lg font-bold text-green-700">{formatCurrency(cxcProbable)}</p>
            <p className="text-xs text-gray-400">
              Ventas {formatCurrency(cobrosVentasTotal)} · Presup. {formatCurrency(cobrosPresTotal)}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-xs font-semibold uppercase text-gray-500">Saldo total bancos</p>
            <p className="mt-2 text-lg font-bold text-brand-700">{formatCurrency(saldoBancos)}</p>
            <p className="text-xs text-gray-400">{cuentas.length} cuentas activas (sin tarjetas)</p>
          </div>
          <div className="card p-4">
            <p className="text-xs font-semibold uppercase text-gray-500">CxC + bancos</p>
            <p className="mt-2 text-lg font-bold text-gray-900">{formatCurrency(totalCxCBancos)}</p>
            <p className="text-xs text-gray-400">Disponible antes de gastos y compras</p>
          </div>
          <div className="card p-4">
            <p className="text-xs font-semibold uppercase text-gray-500">Total gastos</p>
            <p className="mt-2 text-lg font-bold text-red-600">{formatCurrency(totalGastos)}</p>
            <p className="text-xs text-gray-400">4 semanas desde el corte</p>
          </div>
          <div className="card p-4">
            <p className="text-xs font-semibold uppercase text-gray-500">Compras a pagar</p>
            <p className="mt-2 text-lg font-bold text-red-600">{formatCurrency(comprasAPagarTotal)}</p>
            <p className="text-xs text-gray-400">Marcadas &quot;Pagará&quot;</p>
          </div>
          <div
            className={`card p-4 ${
              disponibleFlujo >= 0
                ? 'bg-green-50 border-green-200'
                : 'bg-red-50 border-red-200'
            }`}
          >
            <p
              className={`text-xs font-semibold uppercase ${
                disponibleFlujo >= 0 ? 'text-green-700' : 'text-red-700'
              }`}
            >
              Disponible
            </p>
            <p
              className={`mt-2 text-lg font-bold ${
                disponibleFlujo >= 0 ? 'text-green-800' : 'text-red-800'
              }`}
            >
              {formatCurrency(disponibleFlujo)}
            </p>
            <p className={disponibleFlujo >= 0 ? 'text-xs text-green-700' : 'text-xs text-red-700'}>
              CxC + bancos − gastos − compras
            </p>
          </div>
        </section>

        {/* Flujo de pago por semana: cobros probables − compras a pagar − gastos fijos */}
        <section className="card overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Flujo de pago por semana · corte {formatDate(fechaResumen)}
            </p>
          </div>
          {vencLoading || !vencLoaded ? (
            <div className="p-6 text-center text-sm text-gray-400">Cargando datos...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] table-fixed">
                <ColsSemana />
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="table-header">Concepto</th>
                    {SEMANAS.map((semana, i) => (
                      <th key={semana} className="table-header text-right">
                        Semana {semana}
                        <span className="block font-normal text-[10px] text-gray-400">
                          {formatDate(flujoFechas[i])}
                        </span>
                      </th>
                    ))}
                    <th className="table-header text-right">Total</th>
                    <th className="table-header"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  <tr className="bg-brand-50">
                    <td className="table-cell text-sm font-semibold">Saldo bancos (inicial)</td>
                    {saldoInicialSemana.map((v, i) => (
                      <td key={i} className={`table-cell text-right text-sm font-semibold ${
                        v == null ? 'text-gray-300' : v >= 0 ? 'text-brand-700' : 'text-red-600'
                      }`}>
                        {v == null ? '—' : formatCurrency(v)}
                      </td>
                    ))}
                    <td className="table-cell text-right font-semibold text-brand-700">{formatCurrency(saldoBancos)}</td>
                    <td className="table-cell"></td>
                  </tr>
                  {[
                    { label: 'Cobros ventas (marcadas Pagarán)',       vals: flujo.cobrosVentas,  neg: false },
                    { label: 'Cobros presupuestos (marcadas Pagarán)', vals: flujo.cobrosPres,    neg: false },
                    { label: 'Compras a pagar (marcadas)',     vals: flujo.pagosCompras,  neg: true },
                    { label: 'Gastos fijos',                   vals: gastosFlujoSemana,   neg: true },
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
                      <td className="table-cell"></td>
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
                    <td className="table-cell"></td>
                  </tr>
                  <tr className="border-t border-gray-200 bg-brand-50 font-bold">
                    <td className="table-cell">Saldo bancos proyectado</td>
                    {saldoFinalSemana.map((v, i) => (
                      <td key={i} className={`table-cell text-right ${
                        v == null ? 'text-gray-300' : v >= 0 ? 'text-brand-700' : 'text-red-600'
                      }`}>
                        {v == null ? '—' : formatCurrency(v)}
                      </td>
                    ))}
                    <td className={`table-cell text-right ${saldoFinalPeriodo >= 0 ? 'text-brand-700' : 'text-red-600'}`}>
                      {formatCurrency(saldoFinalPeriodo)}
                    </td>
                    <td className="table-cell"></td>
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
            <table className="w-full min-w-[980px] table-fixed">
              <ColsSemana n={semanasGastos.length} />
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="table-header">Gasto fijo</th>
                  {semanasGastos.map((semana, i) => (
                    <th key={semana} className="table-header">
                      <div className="flex flex-col items-start gap-1">
                        <span>Semana {semana}</span>
                        <input
                          type="date"
                          className="input py-1 text-xs max-w-[130px]"
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
                  <tr><td colSpan={semanasGastos.length + 3} className="text-center py-10 text-gray-400">Cargando...</td></tr>
                ) : gastos.length === 0 ? (
                  <tr><td colSpan={semanasGastos.length + 3} className="text-center py-10 text-gray-400">No hay gastos fijos creados.</td></tr>
                ) : (
                  gastos.map(gasto => {
                    const fila = montos[gasto.id] || emptyMontos()
                    const totalFila = semanasGastos.reduce((sum, s) => sum + (parseFloat(fila[s] || '0') || 0), 0)
                    return (
                      <tr key={gasto.id} className={!gasto.activo ? 'opacity-50' : ''}>
                        <td className="table-cell">
                          <input
                            className="input min-w-[160px]"
                            value={gasto.nombre}
                            onChange={event => updateGasto(gasto.id, event.target.value)}
                            onBlur={() => saveNombre(gasto)}
                            disabled={!gasto.activo}
                          />
                        </td>
                        {semanasGastos.map(semana => (
                          <td key={semana} className="table-cell">
                            <MontoInput
                              value={fila[semana] || ''}
                              onChange={v => updateMonto(gasto.id, semana, v)}
                              onCommit={v => saveMonto(gasto.id, semana, v)}
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
                    <td className="table-cell text-right font-bold text-brand-700">{formatCurrency(totalesSemana.reduce((a, b) => a + b, 0))}</td>
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
              Compras a pagar (marcadas &quot;Pagará&quot;) · corte {formatDate(fechaResumen)}
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
              <table className="w-full min-w-[980px] table-fixed">
                <ColsSemana />
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="table-header">Proveedor</th>
                    {SEMANAS.map((semana, i) => (
                      <th key={semana} className="table-header text-right">
                        Semana {semana}
                        <span className="block font-normal text-[10px] text-gray-400">
                          {formatDate(flujoFechas[i])}
                        </span>
                      </th>
                    ))}
                    <th className="table-header text-right">Total</th>
                    <th className="table-header"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {comprasPagarPorProveedor.map(g => (
                    <tr key={g.nombre} className="hover:bg-gray-50">
                      <td className="table-cell text-sm font-medium">
                        {g.nombre}
                        <span className="block text-[10px] font-normal text-gray-400">
                          {g.count} {g.count === 1 ? 'factura' : 'facturas'}
                        </span>
                      </td>
                      {SEMANAS.map((_, i) => (
                        <td key={i} className="table-cell text-right text-sm">
                          {g.semanas[i] > 0
                            ? (
                              <span className="font-medium text-red-600">
                                −{formatCurrency(g.semanas[i])}
                                {g.countSemanas[i] > 1 && (
                                  <span className="block text-[10px] font-normal text-gray-400">{g.countSemanas[i]} facturas</span>
                                )}
                              </span>
                            )
                            : <span className="text-gray-200">—</span>}
                        </td>
                      ))}
                      <td className="table-cell text-right font-semibold text-red-600">−{formatCurrency(g.total)}</td>
                      <td className="table-cell"></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                    <td className="table-cell text-right text-sm text-gray-600">TOTAL A PAGAR</td>
                    {flujo.pagosCompras.map((v, i) => (
                      <td key={i} className="table-cell text-right text-red-600">{v > 0 ? `−${formatCurrency(v)}` : '—'}</td>
                    ))}
                    <td className="table-cell text-right text-red-600">−{formatCurrency(sum(flujo.pagosCompras))}</td>
                    <td className="table-cell"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>
      </div>
      )}
      </div>

      <style>{`
        @media print {
          /* Ocultar todo lo que no es el área del flujo ni un ancestro de ella */
          body *:not(#flujo-print):not(#flujo-print *):not(:has(#flujo-print)) { display: none !important; }
          body :has(#flujo-print) {
            display: block !important;
            height: auto !important;
            min-height: 0 !important;
            overflow: visible !important;
          }
          html, body { height: auto !important; overflow: visible !important; }
          #flujo-print { width: 100%; height: auto !important; overflow: visible !important; font-size: 10px !important; }
          /* Inputs como texto plano (la tabla de gastos usa inputs para los montos) */
          #flujo-print input {
            border: none !important;
            background: transparent !important;
            box-shadow: none !important;
            padding: 0 !important;
          }
          #flujo-print select,
          #flujo-print button,
          #flujo-print [class*="btn-"] { display: none !important; }
          /* Modo compacto */
          #flujo-print .p-6 { padding: 6px 8px !important; }
          #flujo-print [class*="space-y"] > * + * { margin-top: 4px !important; }
          #flujo-print .gap-3, #flujo-print .gap-4 { gap: 4px !important; }
          #flujo-print .card { box-shadow: none !important; border-radius: 4px !important; }
          #flujo-print .card.p-3, #flujo-print .card.p-4 { padding: 4px 8px !important; }
          #flujo-print .text-lg, #flujo-print .text-xl, #flujo-print .text-2xl { font-size: 12px !important; line-height: 1.2 !important; }
          #flujo-print table th, #flujo-print table td {
            padding: 2px 6px !important;
            font-size: 9.5px !important;
            line-height: 1.25 !important;
          }
          #flujo-print .badge { padding: 0 4px !important; font-size: 8.5px !important; }
          @page { margin: 10mm; }
        }
      `}</style>

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
