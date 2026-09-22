'use client'

import type { CSSProperties } from 'react'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { VentaOgemi } from '@/types'

/**
 * Formato imprimible (PDF vía "Guardar como PDF" del navegador) de una factura de
 * Impresora Ogemi. Mismo estilo ámbar que el recibo de anticipo de Ogemi.
 * Ogemi no emite factura electrónica: el pie lo aclara.
 */
export interface CobroImpreso {
  id: string
  numero_recibo: number | null
  fecha: string
  monto: number
  referencia: string | null
  anticipo_id: string | null
  banco_cuentas?: { nombre: string } | null
}

export const LOGO_OGEMI = '/logo-ogemi.png'

export default function FacturaOgemiPrint({ venta, cobros = [] }: { venta: VentaOgemi; cobros?: CobroImpreso[] }) {
  const exact = { WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } as CSSProperties
  const pagado = Number(venta.monto_pagado) || 0
  const ret = Number(venta.retencion_monto) || 0
  const saldo = Math.max(0, Math.round((Number(venta.total) - ret - pagado) * 100) / 100)
  const estado = venta.estado === 'pagada' ? 'PAGADA' : venta.estado === 'falta_retencion' ? 'FALTA COMPROBANTE DE RETENCIÓN' : pagado > 0 ? 'ABONO PARCIAL' : 'PENDIENTE'
  const fila = 'flex justify-between px-5 py-3'

  return (
    <div className="font-sans text-gray-900 w-full" style={{ minHeight: 'calc(100vh - 28mm)', display: 'flex', flexDirection: 'column' }}>
      <div className="overflow-hidden border-2 border-gray-200 rounded-2xl flex-1 flex flex-col">
        <div className="flex items-center text-white gap-6 px-10 py-8"
          style={{ ...exact, background: 'linear-gradient(135deg, #b45309 0%, #92400e 100%)' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_OGEMI} alt="Impresora Ogemi" className="shrink-0" style={{ width: 96, height: 96 }} />
          <div className="flex-1 min-w-0">
            <h1 className="font-bold leading-tight text-2xl">IMPRESORA OGEMI</h1>
            <p className="text-white/80 text-sm mt-1">Más que una impresión desde 1995</p>
          </div>
          <div className="text-right shrink-0">
            <p className="uppercase tracking-widest text-white/70 text-xs">Documento</p>
            <p className="font-bold text-2xl">FACTURA</p>
            <p className="font-mono font-bold mt-1 text-2xl">#{venta.numero}</p>
          </div>
        </div>

        <div className="flex-1 flex flex-col p-10">
          <div className="grid grid-cols-3 gap-4 mb-6 text-sm">
            <div>
              <span className="text-gray-400">Fecha</span>
              <p className="font-semibold text-gray-700">{formatDate(venta.fecha)}</p>
            </div>
            <div className="text-center">
              <span className="text-gray-400">Crédito</span>
              <p className="font-semibold text-gray-700">{venta.dias_credito ? `${venta.dias_credito} días` : 'Contado'}</p>
            </div>
            <div className="text-right">
              <span className="text-gray-400">Vence</span>
              <p className="font-semibold text-gray-700">{formatDate(venta.fecha_pago)}</p>
            </div>
          </div>

          <div className="rounded-xl bg-gray-50 border border-gray-100 mb-6 text-base" style={exact}>
            <div className={fila}>
              <span className="text-gray-500">Cliente</span>
              <span className="font-semibold text-right">{venta.clientes?.nombre || '—'}</span>
            </div>
          </div>

          <table className="w-full text-sm mb-6">
            <thead>
              <tr className="border-b-2 border-gray-300 text-left text-gray-500">
                <th className="py-2 font-medium">Concepto</th>
                <th className="py-2 font-medium text-right w-40">Importe</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-100 align-top">
                <td className="py-3 pr-4 whitespace-pre-wrap">{venta.concepto || '—'}</td>
                <td className="py-3 text-right">{formatCurrency(venta.monto)}</td>
              </tr>
            </tbody>
          </table>

          <div className="ml-auto w-72 text-sm">
            <div className="flex justify-between py-1.5"><span className="text-gray-500">Subtotal</span><span>{formatCurrency(venta.monto)}</span></div>
            <div className="flex justify-between py-1.5"><span className="text-gray-500">ITBMS ({venta.itbms_pct}%)</span><span>{formatCurrency(venta.itbms)}</span></div>
            <div className="flex justify-between py-2 mt-1 border-t-2 border-gray-300 text-lg font-bold" style={{ color: '#b45309' }}>
              <span>Total</span><span>{formatCurrency(venta.total)}</span>
            </div>
            {ret > 0 && (
              <div className="flex justify-between py-1.5 text-amber-700"><span>Retención ITBMS ({venta.retencion_pct}%)</span><span>− {formatCurrency(ret)}</span></div>
            )}
            {ret > 0 && (
              <div className="flex justify-between py-1.5 font-medium"><span>A cobrar</span><span>{formatCurrency(Math.round((Number(venta.total) - ret) * 100) / 100)}</span></div>
            )}
            {pagado > 0 && (
              <div className="flex justify-between py-1.5 text-gray-500"><span>Cobrado</span><span>{formatCurrency(pagado)}</span></div>
            )}
            <div className="flex justify-between py-1.5 font-semibold"><span>Saldo pendiente</span><span>{formatCurrency(saldo)}</span></div>
            <div className="text-right mt-2">
              <span className="inline-block text-xs font-bold tracking-widest px-3 py-1 rounded-full border-2"
                style={{ ...exact, borderColor: '#b45309', color: '#b45309', background: '#fffbeb' }}>{estado}</span>
            </div>
          </div>

          {cobros.length > 0 && (
            <div className="mt-8">
              <p className="text-sm font-semibold text-gray-700 mb-2">Cobros recibidos</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-gray-300 text-left text-gray-500">
                    <th className="py-1.5 font-medium">Recibo</th>
                    <th className="py-1.5 font-medium">Fecha</th>
                    <th className="py-1.5 font-medium">Forma de pago</th>
                    <th className="py-1.5 font-medium">Referencia</th>
                    <th className="py-1.5 font-medium text-right">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {cobros.map(c => (
                    <tr key={c.id} className="border-b border-gray-100">
                      <td className="py-1.5 font-mono text-xs">{c.numero_recibo ? `REC-${String(c.numero_recibo).padStart(5, '0')}` : '—'}</td>
                      <td className="py-1.5">{formatDate(c.fecha)}</td>
                      <td className="py-1.5">{c.anticipo_id ? 'Anticipo' : (c.banco_cuentas?.nombre || 'Banco')}</td>
                      <td className="py-1.5 text-gray-500">{c.referencia || '—'}</td>
                      <td className="py-1.5 text-right">{formatCurrency(c.monto)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td className="pt-2" colSpan={4}>Total cobrado</td>
                    <td className="pt-2 text-right">{formatCurrency(cobros.reduce((t, c) => t + Number(c.monto || 0), 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {venta.notas && (
            <div className="mt-6 text-sm">
              <span className="text-gray-400">Notas</span>
              <p className="text-gray-700 whitespace-pre-wrap">{venta.notas}</p>
            </div>
          )}

          <div className="flex-1" />

          <div className="text-center text-gray-400 border-t border-gray-100 pt-3 mt-10 text-xs">
            <p>Impreso el {formatDate(new Date().toISOString().split('T')[0])} · Documento interno · No constituye factura fiscal.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
