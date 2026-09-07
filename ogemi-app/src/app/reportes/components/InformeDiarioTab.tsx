'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { formatMonto, formatDate } from '@/lib/utils'
import { TIPOS_VENTA } from '@/lib/tiposVenta'
import { isNC } from '../reportes.utils'

/**
 * INFORME DIARIO — réplica del "Movimiento diario" que se hacía a mano:
 *   BANCOS (saldo de cada cuenta a la fecha)
 * + CUENTAS POR COBRAR (Impresora Ogemi + Impresos Comerciales)
 * − CUENTAS POR PAGAR (proveedores + tarjetas de crédito)
 * = SALDO EFECTIVO
 * + INGRESOS por tipo de venta (mes y acumulado del año)
 *
 * Todo se calcula "a la fecha": bancos con saldo_cuenta(p_hasta); CxC/CxP =
 * documentos emitidos hasta la fecha menos cobros/pagos hasta la fecha
 * (reversos posteriores a la fecha no se descuentan).
 */

type Cuenta = { id: string; nombre: string; banco: string; tipo: string | null; orden: number }
type Doc = { id: string; fecha: string; total: number; monto: number; itbms: number; retencion_pct?: number | null; tipo_documento?: string | null; tipo_venta?: string | null }
type Pago = { factura_id: string | null; compra_id: string | null; venta_ogemi_id: string | null; monto: number; fecha: string }

const hoy = () => new Date().toISOString().split('T')[0]

const FECHA_LARGA = (iso: string) => {
  const d = new Date(iso + 'T00:00:00')
  const s = d.toLocaleDateString('es-PA', { day: '2-digit', month: 'long', year: 'numeric' })
  return s.toUpperCase()
}

export default function InformeDiarioTab() {
  const supabase = useMemo(() => createClient(), [])
  const [fecha, setFecha] = useState(hoy())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [cuentas, setCuentas] = useState<Cuenta[]>([])
  const [saldos, setSaldos] = useState<Record<string, number>>({})
  const [facturas, setFacturas] = useState<Doc[]>([])
  const [ventasOgemi, setVentasOgemi] = useState<Doc[]>([])
  const [compras, setCompras] = useState<Doc[]>([])
  const [notasCredito, setNotasCredito] = useState<{ fecha: string; monto: number }[]>([])
  const [pagos, setPagos] = useState<Pago[]>([])
  const [reversos, setReversos] = useState<Pago[]>([])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const [
      { data: ctas, error: e1 },
      { data: fac, error: e2 },
      { data: vo, error: e3 },
      { data: cmp, error: e4 },
      { data: pg, error: e5 },
      { data: rv, error: e6 },
      { data: nc, error: e7 },
    ] = await Promise.all([
      supabase.from('banco_cuentas').select('id,nombre,banco,tipo,orden').eq('activo', true).order('orden').order('nombre'),
      supabase.from('facturas').select('id,fecha,total,monto,itbms,retencion_pct,tipo_documento,tipo_venta').lte('fecha', fecha),
      supabase.from('ventas_ogemi').select('id,fecha,total,monto,itbms').lte('fecha', fecha),
      supabase.from('compras').select('id,fecha,total,monto,itbms,tipo_documento').lte('fecha', fecha),
      supabase.from('pagos').select('factura_id,compra_id,venta_ogemi_id,monto,fecha').lte('fecha', fecha),
      supabase.from('pago_reversos').select('factura_id,compra_id,venta_ogemi_id,monto,fecha').lte('fecha', fecha),
      supabase.from('notas_credito').select('fecha,monto').lte('fecha', fecha),
    ])
    const err = e1 || e2 || e3 || e4 || e5 || e6 || e7
    if (err) setError(err.message)
    const cts = (ctas || []) as Cuenta[]
    setCuentas(cts)
    setFacturas((fac || []) as Doc[])
    setVentasOgemi((vo || []) as Doc[])
    setCompras((cmp || []) as Doc[])
    setPagos((pg || []) as Pago[])
    setReversos((rv || []) as Pago[])
    setNotasCredito((nc || []) as { fecha: string; monto: number }[])

    // Saldo de cada cuenta a la fecha (misma función que usa Banco)
    const res = await Promise.all(cts.map(c => supabase.rpc('saldo_cuenta', { p_cuenta_id: c.id, p_hasta: fecha })))
    const map: Record<string, number> = {}
    cts.forEach((c, i) => { map[c.id] = Number(res[i].data ?? 0) })
    setSaldos(map)
    setLoading(false)
  }, [supabase, fecha])

  useEffect(() => { load() }, [load])

  // ── Cálculo ────────────────────────────────────────────────────────────────
  const inf = useMemo(() => {
    const pagadoPor = (key: 'factura_id' | 'compra_id' | 'venta_ogemi_id') => {
      const m: Record<string, number> = {}
      pagos.forEach(p => { const k = p[key]; if (k) m[k] = (m[k] || 0) + Number(p.monto || 0) })
      reversos.forEach(r => { const k = r[key]; if (k) m[k] = (m[k] || 0) - Number(r.monto || 0) })
      return m
    }
    const pagFact = pagadoPor('factura_id')
    const pagComp = pagadoPor('compra_id')
    const pagVo = pagadoPor('venta_ogemi_id')

    // Bancos (cuentas tipo banco) y tarjetas (deuda = saldo negativo)
    const bancos = cuentas.filter(c => c.tipo !== 'tarjeta_credito').map(c => ({ ...c, saldo: saldos[c.id] || 0 }))
    const tarjetas = cuentas.filter(c => c.tipo === 'tarjeta_credito').map(c => ({ ...c, deuda: Math.max(0, -(saldos[c.id] || 0)) }))
    const totalBancos = bancos.reduce((s, c) => s + c.saldo, 0)
    const totalTarjetas = tarjetas.reduce((s, c) => s + c.deuda, 0)

    // CxC Impresos Comerciales: cobrable (total − retención) − cobrado hasta la fecha
    const cxcImpresos = facturas
      .filter(f => !isNC(f.tipo_documento || '') && Number(f.total) > 0)
      .reduce((s, f) => {
        const ret = Number(f.retencion_pct || 0) > 0 ? Math.round(Number(f.retencion_pct) / 100 * Number(f.itbms || 0) * 100) / 100 : 0
        const cobrable = Number(f.total) - ret
        return s + Math.max(0, cobrable - (pagFact[f.id] || 0))
      }, 0)
    // CxC Impresora Ogemi
    const cxcOgemi = ventasOgemi.reduce((s, v) => s + Math.max(0, Number(v.total) - (pagVo[v.id] || 0)), 0)
    const totalCxC = cxcImpresos + cxcOgemi

    // CxP proveedores
    const cxpProveedores = compras
      .filter(c => !isNC(c.tipo_documento || '') && Number(c.total) > 0)
      .reduce((s, c) => s + Math.max(0, Number(c.total) - (pagComp[c.id] || 0)), 0)
    const totalCxP = cxpProveedores + totalTarjetas

    const saldoEfectivo = totalBancos + totalCxC - totalCxP

    // Ingresos (monto neto, sin ITBMS) por tipo de venta: mes de la fecha y acumulado del año
    const mes = fecha.slice(0, 7)
    const anio = fecha.slice(0, 4)
    const enMes = (f: string) => f.slice(0, 7) === mes
    const enAnio = (f: string) => f.slice(0, 4) === anio
    const ventasImp = facturas.filter(f => !isNC(f.tipo_documento || '') && Number(f.total) > 0)
    const porTipo = TIPOS_VENTA.map(t => ({
      cuenta: t.cuenta, nombre: t.nombre,
      mes: ventasImp.filter(f => f.tipo_venta === t.value && enMes(f.fecha)).reduce((s, f) => s + Number(f.monto || 0), 0),
      anio: ventasImp.filter(f => f.tipo_venta === t.value && enAnio(f.fecha)).reduce((s, f) => s + Number(f.monto || 0), 0),
    }))
    const sinClasificar = {
      mes: ventasImp.filter(f => !f.tipo_venta && enMes(f.fecha)).reduce((s, f) => s + Number(f.monto || 0), 0),
      anio: ventasImp.filter(f => !f.tipo_venta && enAnio(f.fecha)).reduce((s, f) => s + Number(f.monto || 0), 0),
      n: ventasImp.filter(f => !f.tipo_venta && enAnio(f.fecha)).length,
    }
    const ncs = {
      mes: notasCredito.filter(n => enMes(n.fecha)).reduce((s, n) => s + Number(n.monto || 0), 0),
      anio: notasCredito.filter(n => enAnio(n.fecha)).reduce((s, n) => s + Number(n.monto || 0), 0),
    }
    const ogemiIng = {
      mes: ventasOgemi.filter(v => enMes(v.fecha)).reduce((s, v) => s + Number(v.monto || 0), 0),
      anio: ventasOgemi.filter(v => enAnio(v.fecha)).reduce((s, v) => s + Number(v.monto || 0), 0),
    }
    const totalIng = {
      mes: porTipo.reduce((s, t) => s + t.mes, 0) + sinClasificar.mes - ncs.mes + ogemiIng.mes,
      anio: porTipo.reduce((s, t) => s + t.anio, 0) + sinClasificar.anio - ncs.anio + ogemiIng.anio,
    }

    return { bancos, tarjetas, totalBancos, totalTarjetas, cxcImpresos, cxcOgemi, totalCxC, cxpProveedores, totalCxP, saldoEfectivo, porTipo, sinClasificar, ncs, ogemiIng, totalIng }
  }, [cuentas, saldos, facturas, ventasOgemi, compras, pagos, reversos, notasCredito, fecha])

  const Fila = ({ label, valor, indent = false, muted = false }: { label: string; valor: number; indent?: boolean; muted?: boolean }) => (
    <div className={`flex items-center justify-between py-0.5 ${indent ? 'pl-4' : ''} ${muted ? 'text-gray-400' : 'text-gray-700'}`}>
      <span className="text-sm">{label}</span>
      <span className="text-sm tabular-nums">{formatMonto(valor)}</span>
    </div>
  )
  const Total = ({ label, valor, big = false }: { label: string; valor: number; big?: boolean }) => (
    <div className={`flex items-center justify-between mt-1 pt-1 border-t border-gray-300 ${big ? 'informe-saldo' : ''}`}>
      <span className={`font-bold ${big ? 'text-base text-brand-800' : 'text-sm text-gray-800'}`}>{label}</span>
      <span className={`font-bold tabular-nums ${big ? 'text-xl text-brand-800' : 'text-sm text-gray-900'} border-b-4 border-double border-gray-400 px-2`}>{formatMonto(valor)}</span>
    </div>
  )
  const Seccion = ({ titulo, children }: { titulo: string; children: React.ReactNode }) => (
    <div className="informe-seccion">
      <h3 className="text-sm font-bold text-gray-800 tracking-wide border-b-2 border-sky-300 pb-0.5 mb-1.5">{titulo}</h3>
      {children}
    </div>
  )

  return (
    <div className="p-6 space-y-4 informe-diario">
      <div className="flex items-center justify-between flex-wrap gap-3 print:hidden">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-500">Fecha del informe</label>
          <input type="date" className="input max-w-[170px]" value={fecha} max={hoy()} onChange={e => setFecha(e.target.value)} />
          <button className="btn-secondary text-sm" onClick={() => setFecha(hoy())}>Hoy</button>
        </div>
        {inf.sinClasificar.n > 0 && (
          <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
            {inf.sinClasificar.n} factura{inf.sinClasificar.n === 1 ? '' : 's'} del año sin tipo de venta — clasifícalas en Facturas para que el desglose de Ingresos sea correcto.
          </span>
        )}
      </div>

      {error && <div className="text-sm text-red-600">Error al cargar: {error}</div>}

      <div className="card p-6 max-w-3xl mx-auto space-y-5 informe-hoja">
        <div className="text-center">
          <h2 className="text-xl font-bold text-gray-900 tracking-wide">INFORME DIARIO</h2>
          <p className="text-sm font-semibold text-gray-600">{FECHA_LARGA(fecha)}</p>
          {loading && <p className="text-xs text-gray-400 mt-1">Calculando...</p>}
        </div>

        <Seccion titulo="BANCOS">
          {inf.bancos.map(c => <Fila key={c.id} label={`${c.nombre.trim()} · ${c.banco.trim()}`} valor={c.saldo} />)}
          {inf.bancos.length === 0 && <p className="text-xs text-gray-400">Sin cuentas de banco activas</p>}
          <Total label="SUB - TOTAL BANCOS" valor={inf.totalBancos} />
        </Seccion>

        <Seccion titulo="CUENTAS POR COBRAR">
          <Fila label="CUENTAS X COBRAR - IMPRESORA OGEMI" valor={inf.cxcOgemi} />
          <Fila label="CUENTAS X COBRAR - IMP. COMERCIALES" valor={inf.cxcImpresos} />
          <Total label="TOTAL CUENTAS POR COBRAR" valor={inf.totalCxC} />
        </Seccion>

        <Seccion titulo="CUENTAS POR PAGAR">
          <Fila label="CUENTAS POR PAGAR - PROVEEDORES" valor={inf.cxpProveedores} />
          <Fila label="TARJETAS DE CRÉDITO" valor={inf.totalTarjetas} />
          {inf.tarjetas.map(t => <Fila key={t.id} label={t.nombre.trim()} valor={t.deuda} indent muted />)}
          <Total label="TOTAL CUENTAS POR PAGAR" valor={inf.totalCxP} />
        </Seccion>

        <div className="pt-1">
          <Total label="SALDOS EFECTIVO" valor={inf.saldoEfectivo} big />
          <p className="text-[11px] text-gray-400 mt-1 print:hidden">Bancos + Cuentas por cobrar − Cuentas por pagar</p>
        </div>

        <Seccion titulo="INGRESOS">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500">
                <th className="text-left font-semibold pb-1 w-16"></th>
                <th className="text-left font-semibold pb-1"></th>
                <th className="text-right font-semibold pb-1 w-36">Ingresos netos<br />del mes</th>
                <th className="text-right font-semibold pb-1 w-40">Ingresos acumulados<br />del año</th>
              </tr>
            </thead>
            <tbody>
              {inf.porTipo.map(t => (
                <tr key={t.cuenta}>
                  <td className="py-0.5 text-gray-500 font-mono text-xs">{t.cuenta}</td>
                  <td className="py-0.5 text-gray-700">{t.nombre}</td>
                  <td className="py-0.5 text-right tabular-nums">{formatMonto(t.mes)}</td>
                  <td className="py-0.5 text-right tabular-nums">{formatMonto(t.anio)}</td>
                </tr>
              ))}
              {(inf.sinClasificar.mes !== 0 || inf.sinClasificar.anio !== 0) && (
                <tr className="text-amber-700">
                  <td className="py-0.5 font-mono text-xs">—</td>
                  <td className="py-0.5">Sin clasificar</td>
                  <td className="py-0.5 text-right tabular-nums">{formatMonto(inf.sinClasificar.mes)}</td>
                  <td className="py-0.5 text-right tabular-nums">{formatMonto(inf.sinClasificar.anio)}</td>
                </tr>
              )}
              {(inf.ncs.mes !== 0 || inf.ncs.anio !== 0) && (
                <tr className="text-red-600">
                  <td className="py-0.5 font-mono text-xs">NC</td>
                  <td className="py-0.5">Notas de crédito</td>
                  <td className="py-0.5 text-right tabular-nums">−{formatMonto(inf.ncs.mes)}</td>
                  <td className="py-0.5 text-right tabular-nums">−{formatMonto(inf.ncs.anio)}</td>
                </tr>
              )}
              <tr>
                <td className="py-0.5 text-gray-500 font-mono text-xs">OGEMI</td>
                <td className="py-0.5 text-gray-700">Ventas Impresora Ogemi</td>
                <td className="py-0.5 text-right tabular-nums">{formatMonto(inf.ogemiIng.mes)}</td>
                <td className="py-0.5 text-right tabular-nums">{formatMonto(inf.ogemiIng.anio)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr className="bg-green-100 font-bold">
                <td className="py-1 pl-1" colSpan={2}>Ingresos del Mes</td>
                <td className="py-1 text-right tabular-nums">{formatMonto(inf.totalIng.mes)}</td>
                <td className="py-1 pr-1 text-right tabular-nums">{formatMonto(inf.totalIng.anio)}</td>
              </tr>
            </tfoot>
          </table>
          <p className="text-[11px] text-gray-400 mt-1 print:hidden">Montos netos (sin ITBMS). Mes = {formatDate(fecha).slice(3)} · Año = {fecha.slice(0, 4)} hasta la fecha.</p>
        </Seccion>
      </div>
    </div>
  )
}
