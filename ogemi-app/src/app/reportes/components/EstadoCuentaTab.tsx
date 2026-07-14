'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { formatMonto, formatDate } from '@/lib/utils'
import { Download } from 'lucide-react'
import { isNC, exportXLSX, buildKpiSheet } from '../reportes.utils'
import FiltrosBar from './FiltrosBar'

/**
 * Estado de cuenta por cliente.
 *
 * Movimiento cronológico con saldo corrido dentro del rango de fechas:
 *  - Cargos: facturas del cliente (sin NC).
 *  - Abonos: pagos no reversados (incluye anticipos y NC aplicadas, que se
 *    registran como líneas de pago) y la retención de ITBMS cuando la factura
 *    ya fue cobrada al neto (estado pagada o falta_retencion).
 *  - "Saldo anterior": neto de todo el movimiento previo a la fecha Desde.
 */

interface EstadoCuentaTabProps {
  facturas: any[]
  fechaDesde: string
  setFechaDesde: (v: string) => void
  fechaHasta: string
  setFechaHasta: (v: string) => void
}

type Evento = {
  fecha: string
  orden: number // 0 = cargo, 1 = abono (mismo día: el cargo primero)
  documento: string
  descripcion: string
  cargo: number
  abono: number
}

export default function EstadoCuentaTab({
  facturas, fechaDesde, setFechaDesde, fechaHasta, setFechaHasta,
}: EstadoCuentaTabProps) {
  const supabase = createClient()
  const [clienteId, setClienteId] = useState('')
  const [pagos, setPagos] = useState<any[]>([])
  const [reversados, setReversados] = useState<Set<string>>(new Set())
  const [loadingPagos, setLoadingPagos] = useState(false)

  // FiltrosBar sin búsqueda — dummies para satisfacer la interfaz
  const noopSearch = ''
  const noopSetSearch = (_v: string) => {}

  // Clientes con movimiento (derivados de las facturas ya cargadas)
  const clientes = useMemo(() => {
    const map: Record<string, string> = {}
    facturas.forEach(f => {
      if (f.cliente_id && f.clientes?.nombre) map[f.cliente_id] = f.clientes.nombre
    })
    return Object.entries(map)
      .map(([id, nombre]) => ({ id, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [facturas])

  const clienteNombre = clientes.find(c => c.id === clienteId)?.nombre || ''

  const facturasCliente = useMemo(
    () => facturas.filter(f => f.cliente_id === clienteId && !isNC(f.tipo_documento)),
    [facturas, clienteId],
  )

  // Carga pagos + reversos del cliente seleccionado
  useEffect(() => {
    if (!clienteId) { setPagos([]); setReversados(new Set()); return }
    const ids = facturasCliente.map(f => f.id)
    if (ids.length === 0) { setPagos([]); setReversados(new Set()); return }
    let cancel = false
    ;(async () => {
      setLoadingPagos(true)
      const pagosAcc: any[] = []
      const revAcc: string[] = []
      // Chunks para no exceder el límite del filtro .in()
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200)
        const [{ data: p }, { data: r }] = await Promise.all([
          supabase.from('pagos')
            .select('id, factura_id, fecha, monto, referencia, anticipo_id, nota_credito_id, credito_factura_id')
            .in('factura_id', chunk),
          supabase.from('pago_reversos').select('pago_id').in('factura_id', chunk),
        ])
        pagosAcc.push(...(p || []))
        revAcc.push(...(r || []).map(x => x.pago_id))
      }
      if (!cancel) {
        setPagos(pagosAcc)
        setReversados(new Set(revAcc))
        setLoadingPagos(false)
      }
    })()
    return () => { cancel = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteId, facturasCliente.length])

  // Construcción del movimiento completo (sin filtrar por fecha todavía)
  const eventos = useMemo<Evento[]>(() => {
    if (!clienteId) return []
    const numeroPorFactura: Record<string, number> = {}
    facturasCliente.forEach(f => { numeroPorFactura[f.id] = f.numero_factura })

    const evs: Evento[] = []
    facturasCliente.forEach(f => {
      evs.push({
        fecha: f.fecha, orden: 0,
        documento: `Factura #${f.numero_factura}`,
        descripcion: f.tipo_documento || 'Factura',
        cargo: f.total || 0, abono: 0,
      })
      // Retención de ITBMS: abono cuando la factura ya se cobró al neto
      if ((f.retencion_monto || 0) > 0 && f.estado !== 'pendiente') {
        evs.push({
          fecha: f.retencion_comprobante_fecha || f.fecha_cobro || f.fecha, orden: 1,
          documento: `Factura #${f.numero_factura}`,
          descripcion: 'Retención ITBMS',
          cargo: 0, abono: f.retencion_monto || 0,
        })
      }
    })
    pagos.forEach(p => {
      if (reversados.has(p.id)) return
      const num = numeroPorFactura[p.factura_id]
      const desc = (p.nota_credito_id || p.credito_factura_id)
        ? 'Nota de crédito aplicada'
        : p.anticipo_id
          ? 'Anticipo aplicado'
          : `Pago${p.referencia ? ` · ${p.referencia}` : ''}`
      evs.push({
        fecha: p.fecha, orden: 1,
        documento: num != null ? `Factura #${num}` : '—',
        descripcion: desc,
        cargo: 0, abono: p.monto || 0,
      })
    })
    return evs.sort((a, b) => {
      if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1
      if (a.orden !== b.orden) return a.orden - b.orden
      return a.documento.localeCompare(b.documento)
    })
  }, [clienteId, facturasCliente, pagos, reversados])

  // Saldo anterior + movimiento del período con saldo corrido
  const saldoAnterior = eventos
    .filter(e => fechaDesde && e.fecha < fechaDesde)
    .reduce((s, e) => s + e.cargo - e.abono, 0)

  const enRango = eventos.filter(e =>
    (!fechaDesde || e.fecha >= fechaDesde) && (!fechaHasta || e.fecha <= fechaHasta)
  )

  let running = saldoAnterior
  const rows = enRango.map(e => {
    running += e.cargo - e.abono
    return { ...e, saldo: running }
  })

  const totCargos = enRango.reduce((s, e) => s + e.cargo, 0)
  const totAbonos = enRango.reduce((s, e) => s + e.abono, 0)
  const saldoFinal = saldoAnterior + totCargos - totAbonos

  const exportExcel = () => {
    exportXLSX(`estado_cuenta_${clienteNombre.replace(/\s+/g, '_')}_${fechaDesde}_${fechaHasta}.xlsx`, [
      buildKpiSheet(`Estado de cuenta — ${clienteNombre}`, `${fechaDesde} a ${fechaHasta}`, [
        ['Saldo anterior', saldoAnterior],
        ['Cargos del período', totCargos],
        ['Abonos del período', totAbonos],
        ['Saldo al corte', saldoFinal],
      ]),
      { name: 'Movimiento', rows: [
        ['Fecha', 'Documento', 'Descripción', 'Cargo', 'Abono', 'Saldo'],
        ['', '', 'Saldo anterior', '', '', saldoAnterior],
        ...rows.map(r => [
          r.fecha, r.documento, r.descripcion,
          r.cargo || '', r.abono || '', r.saldo,
        ]),
      ] },
    ])
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <select className="input w-72" value={clienteId} onChange={e => setClienteId(e.target.value)}>
            <option value="">Seleccionar cliente...</option>
            {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          <FiltrosBar
            search={noopSearch} setSearch={noopSetSearch}
            fechaDesde={fechaDesde} setFechaDesde={setFechaDesde}
            fechaHasta={fechaHasta} setFechaHasta={setFechaHasta}
            showSearch={false}
          />
        </div>
        {clienteId && (
          <button className="btn-secondary flex items-center gap-2 text-sm py-1.5" onClick={exportExcel}>
            <Download size={14} />Exportar Excel
          </button>
        )}
      </div>

      {!clienteId ? (
        <div className="card p-10 text-center text-gray-400 text-sm">
          Seleccione un cliente para generar su estado de cuenta.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Saldo anterior',      val: saldoAnterior, color: 'text-gray-700' },
              { label: 'Cargos del período',  val: totCargos,     color: 'text-brand-700' },
              { label: 'Abonos del período',  val: totAbonos,     color: 'text-green-700' },
              { label: 'Saldo al corte',      val: saldoFinal,    color: saldoFinal > 0 ? 'text-red-600' : 'text-green-700' },
            ].map(s => (
              <div key={s.label} className="card p-3">
                <p className="text-xs text-gray-500">{s.label}</p>
                <p className={`text-lg font-bold ${s.color}`}>{formatMonto(s.val)}</p>
              </div>
            ))}
          </div>

          <div className="card overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Estado de cuenta · {clienteNombre} · {fechaDesde} al {fechaHasta}
              </p>
            </div>
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="table-header">Fecha</th>
                  <th className="table-header">Documento</th>
                  <th className="table-header">Descripción</th>
                  <th className="table-header text-right">Cargo</th>
                  <th className="table-header text-right">Abono</th>
                  <th className="table-header text-right">Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                <tr className="bg-gray-50/60">
                  <td className="table-cell text-sm text-gray-500" colSpan={5}>Saldo anterior al {fechaDesde}</td>
                  <td className="table-cell text-right font-semibold">{formatMonto(saldoAnterior)}</td>
                </tr>
                {loadingPagos ? (
                  <tr><td colSpan={6} className="text-center py-8 text-gray-400">Cargando movimiento...</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-gray-400">Sin movimiento en el período</td></tr>
                ) : rows.map((r, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="table-cell text-sm">{formatDate(r.fecha)}</td>
                    <td className="table-cell text-sm font-mono">{r.documento}</td>
                    <td className="table-cell text-sm">{r.descripcion}</td>
                    <td className="table-cell text-right">{r.cargo ? formatMonto(r.cargo) : ''}</td>
                    <td className="table-cell text-right text-green-700">{r.abono ? formatMonto(r.abono) : ''}</td>
                    <td className="table-cell text-right font-semibold">{formatMonto(r.saldo)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                  <td colSpan={3} className="table-cell text-right text-sm text-gray-600">TOTALES DEL PERÍODO</td>
                  <td className="table-cell text-right text-brand-700">{formatMonto(totCargos)}</td>
                  <td className="table-cell text-right text-green-700">{formatMonto(totAbonos)}</td>
                  <td className="table-cell text-right text-brand-800">{formatMonto(saldoFinal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
