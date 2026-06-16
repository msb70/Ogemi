'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { createClient } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import { useToast } from '@/hooks/useToast'
import { Toast } from '@/components/Toast'
import { withPagePermission } from '@/components/PermissionGuard'
import { CalendarDays, Plus, Save, WalletCards } from 'lucide-react'

type GastoFijo = {
  id: string
  nombre: string
  categoria: string | null
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
  const [periodoMes, setPeriodoMes] = useState(currentMonth)
  const [fechaResumen, setFechaResumen] = useState(new Date().toISOString().split('T')[0])
  const [gastos, setGastos] = useState<GastoFijo[]>([])
  const [montos, setMontos] = useState<Record<string, MontosSemana>>({})
  const [semanaFechas, setSemanaFechas] = useState<string[]>(() => defaultWeekDates(currentMonth()))
  const [cuentas, setCuentas] = useState<BancoCuentaLite[]>([])
  const [saldoBancos, setSaldoBancos] = useState(0)
  const [cuentasPorCobrar, setCuentasPorCobrar] = useState(0)
  const [facturasPendientes, setFacturasPendientes] = useState(0)
  const [loading, setLoading] = useState(true)
  const [savingMontos, setSavingMontos] = useState(false)
  const [nuevoGasto, setNuevoGasto] = useState({ nombre: '', categoria: '' })

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

  const loadAll = useCallback(async () => {
    setLoading(true)
    await Promise.all([loadGastos(), loadMontos(), loadSemanas(), loadResumen()])
    setLoading(false)
  }, [loadGastos, loadMontos, loadSemanas, loadResumen])

  useEffect(() => { loadAll() }, [loadAll])

  const crearGasto = async () => {
    const nombre = nuevoGasto.nombre.trim()
    if (!nombre) return

    const { error } = await supabase.from('gastos_fijos').insert({
      nombre,
      categoria: nuevoGasto.categoria.trim() || null,
      orden: gastos.length + 1,
    })

    if (error) {
      showToast(`Error al crear gasto fijo: ${error.message}`, 'error')
      return
    }

    setNuevoGasto({ nombre: '', categoria: '' })
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

    setSavingMontos(true)

    const [montosRes, fechasRes] = await Promise.all([
      rows.length > 0
        ? supabase.from('gastos_fijos_montos').upsert(rows, { onConflict: 'gasto_fijo_id,periodo,semana' })
        : Promise.resolve({ error: null }),
      supabase.from('gastos_fijos_semanas').upsert(fechasRows, { onConflict: 'periodo,semana' }),
    ])

    setSavingMontos(false)

    const err = montosRes.error || fechasRes.error
    if (err) {
      showToast(`Error al guardar: ${err.message}`, 'error')
      return
    }

    showToast('Montos y fechas guardados.')
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

  return (
    <AppLayout>
      {toast && <Toast {...toast} onClose={hideToast} />}
      <Header
        title="Gastos fijos"
        subtitle="Planificacion semanal, cuentas por cobrar y saldos bancarios"
      />

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

        <section className="card p-4">
          <div className="flex items-center gap-2 mb-4">
            <Plus size={16} className="text-brand-600" />
            <h2 className="text-sm font-semibold text-gray-800">Crear gasto fijo</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
            <label>
              <span className="label">Nombre</span>
              <input
                className="input"
                value={nuevoGasto.nombre}
                onChange={event => setNuevoGasto(prev => ({ ...prev, nombre: event.target.value }))}
                placeholder="Ej. Alquiler, planilla, internet"
              />
            </label>
            <label>
              <span className="label">Categoria</span>
              <input
                className="input"
                value={nuevoGasto.categoria}
                onChange={event => setNuevoGasto(prev => ({ ...prev, categoria: event.target.value }))}
                placeholder="Administrativo, operativo..."
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
                  <th className="table-header">Categoria</th>
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
                  <tr><td colSpan={8} className="text-center py-10 text-gray-400">Cargando...</td></tr>
                ) : gastos.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-10 text-gray-400">No hay gastos fijos creados.</td></tr>
                ) : (
                  gastos.map(gasto => {
                    const fila = montos[gasto.id] || emptyMontos()
                    const totalFila = SEMANAS.reduce((sum, s) => sum + (parseFloat(fila[s] || '0') || 0), 0)
                    return (
                      <tr key={gasto.id} className={!gasto.activo ? 'opacity-50' : ''}>
                        <td className="table-cell font-medium">{gasto.nombre}</td>
                        <td className="table-cell text-gray-500">{gasto.categoria || '-'}</td>
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
                          <button
                            className={`badge ${gasto.activo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                            onClick={() => toggleActivo(gasto)}
                          >
                            {gasto.activo ? 'Activo' : 'Inactivo'}
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
              {gastos.length > 0 && (
                <tfoot>
                  <tr className="border-t border-gray-200 bg-gray-50">
                    <td className="table-cell font-bold" colSpan={2}>Total</td>
                    {totalesSemana.map((total, i) => (
                      <td key={i} className="table-cell text-right font-bold">{formatCurrency(total)}</td>
                    ))}
                    <td className="table-cell text-right font-bold text-brand-700">{formatCurrency(totalGastos)}</td>
                    <td className="table-cell"></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>
      </div>
    </AppLayout>
  )
}

export default withPagePermission(GastosFijosPage, 'gastos_fijos', 'ver')
