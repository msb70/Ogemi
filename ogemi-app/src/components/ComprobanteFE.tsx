'use client'

import { useEffect, useState, CSSProperties } from 'react'
import QRCode from 'qrcode'
import { FeDocumento, FeDocumentoLinea, FeDocumentoPago } from '@/types'
import { FE_TIPO_DOC, FE_TIPO_CLIENTE, FE_FORMAS_PAGO } from '@/lib/fe-catalogos'

/** Datos del emisor devueltos por la RPC fe_emisor() */
export interface FeEmisor {
  nombre: string
  ruc: string
  dv: string
  direccion: string
  codigo_sucursal: string
  nro_terminal: string
}

const n2 = (v: number) => (Math.round((Number(v) + Number.EPSILON) * 100) / 100)
  .toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const n6 = (v: number) => Number(v).toFixed(6)
const fechaCorta = (s: string | null | undefined) => {
  if (!s) return ''
  const d = s.length > 10 ? new Date(s) : new Date(s + 'T00:00:00')
  if (isNaN(d.getTime())) return s
  const dd = String(d.getDate()).padStart(2, '0'), mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}
const fechaHora = (s: string | null | undefined) => {
  if (!s) return ''
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  const hh = String(d.getHours()).padStart(2, '0'), mi = String(d.getMinutes()).padStart(2, '0'), ss = String(d.getSeconds()).padStart(2, '0')
  return `${fechaCorta(s)} ${hh}:${mi}:${ss}`
}

/** Calcula los importes de una línea igual que el formulario y el payload al PAC */
export function calcLinea(l: FeDocumentoLinea) {
  const monto = n2r(Number(l.precioneto) * Number(l.cantidad))
  const itbms = n2r(monto * Number(l.prc_impuesto) / 100)
  return { monto, itbms, valorItem: n2r(monto + itbms) }
}
const n2r = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

/**
 * Comprobante Auxiliar de Factura Electrónica (CAFE) — réplica del formato
 * que entrega el PAC/DGI: emisor, receptor, CUFE, QR, detalle, desglose ITBMS y totales.
 */
export default function ComprobanteFE({ doc, emisor, lineas, pagos, preview = false }: {
  doc: FeDocumento
  emisor: FeEmisor | null
  lineas: FeDocumentoLinea[]
  pagos: FeDocumentoPago[]
  preview?: boolean
}) {
  const [qr, setQr] = useState<string | null>(null)
  const exact = { WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } as CSSProperties

  useEffect(() => {
    let vivo = true
    const data = doc.url_dgi || doc.cufe || ''
    if (!data) { setQr(null); return }
    QRCode.toDataURL(data, { errorCorrectionLevel: 'M', margin: 1, width: 220 })
      .then(u => { if (vivo) setQr(u) })
      .catch(() => { if (vivo) setQr(null) })
    return () => { vivo = false }
  }, [doc.url_dgi, doc.cufe])

  const tipoNombre = FE_TIPO_DOC.find(t => t.codigo === doc.tipo_doc)?.nombre || `Tipo ${doc.tipo_doc}`
  const tipoReceptor = FE_TIPO_CLIENTE.find(t => t.codigo === doc.tipo_cliente)?.nombre || doc.tipo_cliente
  const esNC = ['04', '06'].includes(doc.tipo_doc)
  const numero = String(doc.documento).padStart(10, '0')
  const punto = (emisor?.nro_terminal || '1').padStart(3, '0')

  const filas = [...lineas].sort((a, b) => a.orden - b.orden).map(l => ({ l, ...calcLinea(l) }))
  // Desglose por tasa (Exento, 7, 10, 15) como en el comprobante oficial
  const tasas = [0, 7, 10, 15]
  const desglose = tasas.map(t => {
    const fs = filas.filter(f => Number(f.l.prc_impuesto) === t)
    return { t, base: n2r(fs.reduce((s, f) => s + f.monto, 0)), imp: n2r(fs.reduce((s, f) => s + f.itbms, 0)) }
  })
  const exento = desglose[0].base
  const gravado = n2r(desglose.slice(1).reduce((s, d) => s + d.base, 0))

  // Formas de pago: en venta a crédito el PAC recibe una sola forma "Crédito" por el total
  const formas: { nombre: string; monto: number }[] = doc.es_credito
    ? [{ nombre: 'Crédito', monto: Number(doc.totalfinal) }]
    : pagos.map(p => ({ nombre: FE_FORMAS_PAGO.find(f => f.codigo === p.codigo)?.nombre || p.nombre || p.codigo, monto: Number(p.monto) }))
  const totalPagado = n2r(formas.reduce((s, f) => s + f.monto, 0))
  const vuelto = Math.max(0, n2r(totalPagado - Number(doc.totalfinal)))

  const th = 'border border-gray-700 px-1.5 py-1 text-center font-bold'
  const td = 'border border-gray-700 px-1.5 py-1 align-top'
  const box = 'border border-gray-700 px-2 py-0.5 text-right min-w-[80px] inline-block'

  return (
    <div className={`font-sans text-gray-900 bg-white ${preview ? 'text-[11px]' : 'text-[11px]'} leading-tight w-full`} style={exact}>
      {/* Encabezado */}
      <div className="flex justify-between gap-4">
        <div className="flex-1 pt-3">
          <h1 className="text-[17px] font-bold text-center">Comprobante Auxiliar de Factura Electrónica</h1>
          <h2 className="text-[13px] font-bold text-center mt-2 mb-3">{tipoNombre}</h2>
          {/* Logo a color del emisor (public/logo.jpeg); printColorAdjust exact lo mantiene en el PDF */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.jpeg" alt="Impresos Comerciales" className="h-[46px] w-auto mb-3" style={exact} />
          <p><b>Emisor:</b> {emisor?.nombre || '—'}</p>
          <p><b>RUC:</b> {emisor?.ruc || '—'}</p>
          <p><b>DV:</b> {emisor?.dv || '—'}</p>
          <p><b>Dirección:</b> {emisor?.direccion || '—'}</p>
          <div className="mt-3">
            <p><b>Tipo de Receptor:</b> {tipoReceptor}</p>
            <p><b>Cliente:</b> {doc.nombre_cliente}</p>
            {doc.ruc && <p><b>RUC/Cédula/Pasaporte:</b> {doc.ruc}</p>}
            {doc.dv && <p><b>DV:</b> {doc.dv}</p>}
            <p><b>Dirección:</b> {doc.direccion_cliente}</p>
          </div>
        </div>
        <div className="w-[170px] h-[170px] flex-shrink-0 flex items-center justify-center border border-gray-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {qr ? <img src={qr} alt="QR DGI" className="w-[165px] h-[165px]" /> : <span className="text-gray-400 text-[10px]">Sin QR</span>}
        </div>
      </div>

      {/* Datos del documento */}
      <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-6 gap-y-0.5">
        <p><b>Número:</b> {numero}</p>
        <p><b>Consulte por la clave de acceso en:</b> <span className="break-all">https://dgi-fep.mef.gob.pa/Consultas/FacturasPorCUFE</span></p>
        <p><b>Fecha de Emisión:</b> {fechaCorta(doc.fecha)}</p>
        <p className="break-all"><b>CUFE:</b> {doc.cufe || '—'}</p>
        <p><b>Punto de Facturación:</b> {punto}</p>
        <p><b>Fecha de autorización:</b> {fechaHora(doc.fecha_cufe)}</p>
      </div>
      {esNC && doc.cufe_devol && (
        <p className="mt-1 break-all"><b>Documento afectado (CUFE):</b> {doc.cufe_devol} {doc.fecha_cufe_devol ? `— ${fechaCorta(doc.fecha_cufe_devol)}` : ''}</p>
      )}

      {/* Detalle */}
      <table className="w-full mt-2 border-collapse">
        <thead>
          <tr>
            <th className={`${th} w-8`}>No.</th>
            <th className={th}>Descripción</th>
            <th className={`${th} w-16`}>Cantidad</th>
            <th className={`${th} w-14`}>Unidad</th>
            <th className={`${th} w-16`}>Valor<br />Unitario</th>
            <th className={`${th} w-16`}>Descuento<br />Unitario</th>
            <th className={`${th} w-16`}>Monto</th>
            <th className={`${th} w-14`}>ITBMS</th>
            <th className={`${th} w-16`}>Valor Item</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={f.l.id || i}>
              <td className={`${td} text-center`}>{String(i + 1).padStart(3, '0')}</td>
              <td className={`${td} uppercase`}>{f.l.nombre_articulo}</td>
              <td className={`${td} text-right`}>{n6(Number(f.l.cantidad))}</td>
              <td className={td}>{f.l.unidad}</td>
              <td className={`${td} text-right`}>{n2(Number(f.l.precioneto))}</td>
              <td className={td}></td>
              <td className={`${td} text-right`}>{n2(f.monto)}</td>
              <td className={`${td} text-right`}>{n2(f.itbms)}</td>
              <td className={`${td} text-right`}>{n2(f.valorItem)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex justify-end items-center gap-2 mt-1.5">
        <b>Valor Total</b><span className={box}>{n2(Number(doc.totalfinal))}</span>
      </div>

      {/* Desglose ITBMS + Totales */}
      <div className="flex justify-between gap-6 mt-3">
        <table className="border-collapse w-[46%]">
          <thead>
            <tr><th colSpan={3} className={th}>Desglose ITBMS</th></tr>
            <tr><th className={th}>Monto Base</th><th className={`${th} w-16`}>%</th><th className={th}>Impuesto</th></tr>
          </thead>
          <tbody>
            {desglose.map(d => (
              <tr key={d.t}>
                <td className={`${td} text-right`}>{n2(d.base)}</td>
                <td className={`${td} text-center font-bold`}>{d.t === 0 ? 'Exento' : d.t}</td>
                <td className={`${td} text-right`}>{n2(d.imp)}</td>
              </tr>
            ))}
            <tr>
              <td className={`${td} text-right font-bold`} colSpan={2}>Total</td>
              <td className={`${td} text-right font-bold`}>{n2(Number(doc.totimpuest))}</td>
            </tr>
          </tbody>
        </table>

        <div className="w-[48%] space-y-0.5">
          {[
            ['Total Neto', Number(doc.totneto)],
            ['Monto Exento ITBMS', exento],
            ['Monto Gravado ITBMS', gravado],
            ['ITBMS', Number(doc.totimpuest)],
            ['Total Impuesto', Number(doc.totimpuest)],
          ].map(([k, v]) => (
            <div key={k as string} className="flex justify-end items-center gap-2">
              <b>{k as string}</b><span className={box}>{n2(v as number)}</span>
            </div>
          ))}
          <div className="flex justify-end items-center gap-2">
            <b>Total</b><span className={`${box} font-bold`}>{n2(Number(doc.totalfinal))}</span>
          </div>
          {Number(doc.retencion) > 0 && (
            <div className="flex justify-end items-center gap-2 text-gray-700">
              <span>Retención ITBMS {doc.prc_retencion}%</span><span className={box}>{n2(Number(doc.retencion))}</span>
            </div>
          )}

          <div className="pt-3">
            <p className="text-right font-bold pr-[88px]">Forma de Pago</p>
            {formas.map((f, i) => (
              <div key={i} className="flex justify-end items-center gap-2">
                <span>{f.nombre}</span><span className={box}>{n2(f.monto)}</span>
              </div>
            ))}
            <div className="flex justify-end items-center gap-2">
              <b>TOTAL PAGADO</b><span className={`${box} font-bold`}>{n2(totalPagado)}</span>
            </div>
            <div className="flex justify-end items-center gap-2">
              <b>Vuelto</b><span className={box}>{n2(vuelto)}</span>
            </div>
          </div>
        </div>
      </div>

      {doc.notas && <p className="mt-3"><b>Observaciones:</b> {doc.notas}</p>}
      {doc.ambiente === 'pruebas' && (
        <p className="mt-4 text-center text-red-700 font-bold text-[12px]">DOCUMENTO DE PRUEBA — SIN VALIDEZ FISCAL</p>
      )}
    </div>
  )
}
