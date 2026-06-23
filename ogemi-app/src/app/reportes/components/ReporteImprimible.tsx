'use client'

import { formatCurrency, formatDate } from '@/lib/utils'
import { CarteraVencida } from '@/types'
import { TRAMOS, TRAMO_LABELS } from '../reportes.utils'

interface Props {
  fechaDesde: string
  fechaHasta: string
  ventasFiltradas: any[]
  ncFiltradas: any[]
  comprasFiltradas: any[]
  presupuestosFiltrados: any[]
  cartera: CarteraVencida[]
  cxp: any[]
  carteraPresupuestos: any[]
  cuentas: any[]
  saldos: Record<string, number>
  ventasPorMes: { mes: string; ventas: number; count: number }[]
  comprasPorMes: { mes: string; total: number; count: number }[]
  presupuestosPorMes: { mes: string; total: number; count: number }[]
  topClientesVentas: [string, number][]
  topProveedores: [string, number][]
  topClientesPresupuestos: [string, number][]
  ncPorCliente: [string, number][]
}

const sum = (arr: any[], f: (x: any) => number) => arr.reduce((s, x) => s + (f(x) || 0), 0)

function Kpi({ label, value, color = '#111827' }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 10px' }}>
      <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color }}>{value}</div>
    </div>
  )
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 18, breakInside: 'avoid' }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: '#0f766e', borderBottom: '2px solid #0f766e', paddingBottom: 4, marginBottom: 10 }}>{titulo}</h2>
      {children}
    </section>
  )
}

const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 10 }
const grid6: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6, marginBottom: 10 }
const th: React.CSSProperties = { textAlign: 'left', fontSize: 10, color: '#6b7280', textTransform: 'uppercase', padding: '4px 6px', borderBottom: '1px solid #e5e7eb' }
const td: React.CSSProperties = { fontSize: 11, padding: '3px 6px', borderBottom: '1px solid #f3f4f6' }
const tdR: React.CSSProperties = { ...td, textAlign: 'right' }

function TramoCards({ items }: { items: any[] }) {
  return (
    <div style={grid6}>
      {TRAMOS.map(t => {
        const xs = items.filter(c => c.tramo === t)
        return (
          <div key={t} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 8px' }}>
            <div style={{ fontSize: 9, color: '#6b7280' }}>{TRAMO_LABELS[t]}</div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>{formatCurrency(sum(xs, c => c.saldo_pendiente ?? c.total))}</div>
            <div style={{ fontSize: 9, color: '#9ca3af' }}>{xs.length}</div>
          </div>
        )
      })}
    </div>
  )
}

function TopTabla({ titulo, rows }: { titulo: string; rows: [string, number][] }) {
  const total = rows.reduce((s, [, v]) => s + v, 0)
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 6 }}>
      <thead><tr><th style={th}>{titulo}</th><th style={{ ...th, textAlign: 'right' }}>Monto</th><th style={{ ...th, textAlign: 'right' }}>%</th></tr></thead>
      <tbody>
        {rows.slice(0, 10).map(([n, v]) => (
          <tr key={n}><td style={td}>{n}</td><td style={tdR}>{formatCurrency(v)}</td><td style={tdR}>{total > 0 ? ((v / total) * 100).toFixed(1) : '0.0'}%</td></tr>
        ))}
      </tbody>
    </table>
  )
}

export default function ReporteImprimible(p: Props) {
  const vTotal = sum(p.ventasFiltradas, f => f.total)
  const vCobrado = sum(p.ventasFiltradas.filter(f => f.estado === 'pagada'), f => f.total)
  const vPend = sum(p.ventasFiltradas.filter(f => f.estado === 'pendiente'), f => f.total)
  const carteraTotal = sum(p.cartera, c => c.saldo_pendiente ?? c.total)

  const prTotal = sum(p.presupuestosFiltrados, x => x.total)
  const prCobrado = sum(p.presupuestosFiltrados.filter(x => x.estado === 'pagada'), x => x.total)
  const prPend = sum(p.presupuestosFiltrados.filter(x => x.estado === 'pendiente'), x => x.total)
  const carteraPresTotal = sum(p.carteraPresupuestos, c => c.saldo_pendiente ?? c.total)

  const cTotal = sum(p.comprasFiltradas, x => x.total)
  const cPagado = sum(p.comprasFiltradas.filter(x => x.estado === 'pagada'), x => x.total)
  const cPend = sum(p.comprasFiltradas.filter(x => x.estado === 'pendiente'), x => x.total)
  const cxpTotal = sum(p.cxp, c => c.saldo_pendiente ?? c.total)

  const ncMonto = sum(p.ncFiltradas, f => Math.abs(f.total))
  const itbmsVentas = sum(p.ventasFiltradas, f => f.itbms)
  const saldoBancos = p.cuentas.reduce((s, c) => s + (p.saldos[c.id] || 0), 0)

  return (
    <div id="reporte-print" style={{ fontFamily: 'Arial, sans-serif', color: '#1f2937' }}>
      {/* Encabezado */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, borderBottom: '2px solid #0f766e', paddingBottom: 10 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.jpeg" alt="Ogemi" style={{ width: 56, height: 56, objectFit: 'contain' }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Reporte general — Ogemi</div>
          <div style={{ fontSize: 11, color: '#6b7280' }}>Impresos Comerciales S.A. · Análisis financiero y contable</div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 10, color: '#6b7280' }}>
          <div>Período: {p.fechaDesde} a {p.fechaHasta}</div>
          <div>Generado: {new Date().toLocaleString('es-PA')}</div>
        </div>
      </div>

      <Seccion titulo="Ventas">
        <div style={grid4}>
          <Kpi label="Total facturado" value={formatCurrency(vTotal)} color="#0f766e" />
          <Kpi label="Cobrado" value={formatCurrency(vCobrado)} color="#16a34a" />
          <Kpi label="Pendiente" value={formatCurrency(vPend)} color="#ea580c" />
          <Kpi label="# Facturas" value={String(p.ventasFiltradas.length)} />
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, margin: '6px 0 4px' }}>Cartera vencida — Total: {formatCurrency(carteraTotal)}</div>
        <TramoCards items={p.cartera} />
        <TopTabla titulo="Top clientes (ventas)" rows={p.topClientesVentas} />
      </Seccion>

      <Seccion titulo="Presupuestos">
        <div style={grid4}>
          <Kpi label="Total presupuestado" value={formatCurrency(prTotal)} color="#0f766e" />
          <Kpi label="Cobrado" value={formatCurrency(prCobrado)} color="#16a34a" />
          <Kpi label="Pendiente" value={formatCurrency(prPend)} color="#ea580c" />
          <Kpi label="# Presupuestos" value={String(p.presupuestosFiltrados.length)} />
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, margin: '6px 0 4px' }}>Cartera presupuestos — Total: {formatCurrency(carteraPresTotal)}</div>
        <TramoCards items={p.carteraPresupuestos} />
        <TopTabla titulo="Top clientes (presupuestos)" rows={p.topClientesPresupuestos} />
      </Seccion>

      <Seccion titulo="Compras">
        <div style={grid4}>
          <Kpi label="Total compras" value={formatCurrency(cTotal)} color="#0f766e" />
          <Kpi label="Pagado" value={formatCurrency(cPagado)} color="#16a34a" />
          <Kpi label="Pendiente" value={formatCurrency(cPend)} color="#ea580c" />
          <Kpi label="# Compras" value={String(p.comprasFiltradas.length)} />
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, margin: '6px 0 4px' }}>Cuentas por pagar — Total: {formatCurrency(cxpTotal)}</div>
        <TramoCards items={p.cxp} />
        <TopTabla titulo="Top proveedores" rows={p.topProveedores} />
      </Seccion>

      <Seccion titulo="Notas de crédito">
        <div style={grid4}>
          <Kpi label="# Notas de crédito" value={String(p.ncFiltradas.length)} />
          <Kpi label="Monto total" value={formatCurrency(ncMonto)} color="#d97706" />
        </div>
        <TopTabla titulo="NC por cliente" rows={p.ncPorCliente} />
      </Seccion>

      <Seccion titulo="Banco">
        <div style={grid4}>
          <Kpi label="Saldo total bancos" value={formatCurrency(saldoBancos)} color="#0f766e" />
          <Kpi label="# Cuentas" value={String(p.cuentas.length)} />
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Cuenta</th><th style={th}>Banco</th><th style={{ ...th, textAlign: 'right' }}>Saldo</th></tr></thead>
          <tbody>
            {p.cuentas.map(c => (
              <tr key={c.id}><td style={td}>{c.nombre}</td><td style={td}>{c.banco}</td><td style={tdR}>{formatCurrency(p.saldos[c.id] || 0)}</td></tr>
            ))}
          </tbody>
        </table>
      </Seccion>

      <Seccion titulo="Libros contables (período)">
        <div style={grid4}>
          <Kpi label="Total ventas" value={formatCurrency(vTotal)} color="#0f766e" />
          <Kpi label="Total NC" value={formatCurrency(ncMonto)} color="#d97706" />
          <Kpi label="ITBMS recaudado" value={formatCurrency(itbmsVentas)} color="#7c3aed" />
          <Kpi label="Neto (Ventas - NC)" value={formatCurrency(vTotal - ncMonto)} color="#16a34a" />
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Mes</th><th style={{ ...th, textAlign: 'right' }}>Ventas</th><th style={{ ...th, textAlign: 'right' }}>Compras</th><th style={{ ...th, textAlign: 'right' }}>Presupuestos</th></tr></thead>
          <tbody>
            {(() => {
              const meses = Array.from(new Set([
                ...p.ventasPorMes.map(m => m.mes),
                ...p.comprasPorMes.map(m => m.mes),
                ...p.presupuestosPorMes.map(m => m.mes),
              ])).sort()
              return meses.map(mes => {
                const v = p.ventasPorMes.find(m => m.mes === mes)?.ventas || 0
                const c = p.comprasPorMes.find(m => m.mes === mes)?.total || 0
                const pr = p.presupuestosPorMes.find(m => m.mes === mes)?.total || 0
                return <tr key={mes}><td style={td}>{mes}</td><td style={tdR}>{formatCurrency(v)}</td><td style={tdR}>{formatCurrency(c)}</td><td style={tdR}>{formatCurrency(pr)}</td></tr>
              })
            })()}
          </tbody>
        </table>
      </Seccion>

      <div style={{ fontSize: 9, color: '#9ca3af', textAlign: 'center', marginTop: 10 }}>
        Impresos Comerciales S.A. · Sistema Ogemi · {formatDate(new Date().toISOString().split('T')[0])}
      </div>
    </div>
  )
}
