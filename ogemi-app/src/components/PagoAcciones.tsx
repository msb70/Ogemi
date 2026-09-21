'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Pencil, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { formatMonto as formatCurrency, formatDate } from '@/lib/utils'
import type { Modulo } from '@/types/auth'

/**
 * Editar / borrar un cobro o pago ya registrado (facturas, compras, presupuestos, ventas Ogemi).
 * - Editar actualiza el pago Y su movimiento de banco (RPC editar_pago).
 * - Borrar elimina el pago Y su movimiento de banco (RPC eliminar_pago).
 * La base de datos rechaza ambos si la transacción cae en un cierre de banco ya hecho.
 */
export interface PagoEditable {
  id: string
  monto: number
  fecha: string
  cuenta_id?: string | null
  referencia?: string | null
  lote_id?: string | null
  anticipo_id?: string | null
  nota_credito_id?: string | null
  credito_factura_id?: string | null
  credito_compra_id?: string | null
}

interface Props {
  pago: PagoEditable
  modulo: Modulo
  cuentas: { id: string; nombre: string }[]
  /** 'cobro' (ventas) o 'pago' (compras) — solo cambia los textos */
  etiqueta?: 'cobro' | 'pago'
  reversado?: boolean
  onChanged: (mensaje: string) => void
}

export default function PagoAcciones({ pago, modulo, cuentas, etiqueta = 'cobro', reversado = false, onChanged }: Props) {
  const supabase = createClient()
  const { puedeHacer } = useAuth()
  const canEdit = puedeHacer(modulo, 'editar')
  const canDelete = puedeHacer(modulo, 'borrar')

  const [modo, setModo] = useState<'editar' | 'borrar' | null>(null)
  const [form, setForm] = useState({ monto: '', fecha: '', cuenta_id: '', referencia: '', motivo: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const esCredito = !!(pago.anticipo_id || pago.nota_credito_id || pago.credito_factura_id || pago.credito_compra_id)
  const esLote = !!pago.lote_id
  const Etq = etiqueta === 'pago' ? 'Pago' : 'Cobro'

  const abrirEditar = () => {
    setForm({ monto: String(pago.monto), fecha: pago.fecha, cuenta_id: pago.cuenta_id || '', referencia: pago.referencia || '', motivo: '' })
    setError(''); setModo('editar')
  }
  const abrirBorrar = () => { setForm(f => ({ ...f, motivo: '' })); setError(''); setModo('borrar') }
  const cerrar = () => { if (!saving) setModo(null) }

  const guardar = async () => {
    const monto = parseFloat(form.monto) || 0
    if (monto <= 0 || !form.fecha || !form.cuenta_id) { setError('Completa monto, fecha y cuenta.'); return }
    setSaving(true); setError('')
    const { error: e } = await supabase.rpc('editar_pago', {
      p_pago_id: pago.id, p_monto: monto, p_fecha: form.fecha, p_cuenta_id: form.cuenta_id,
      p_referencia: form.referencia.trim() || null, p_motivo: form.motivo.trim() || null,
    })
    setSaving(false)
    if (e) { setError(e.message); return }
    setModo(null)
    onChanged(`${Etq} actualizado (banco actualizado)`)
  }

  const borrar = async () => {
    setSaving(true); setError('')
    const { error: e } = await supabase.rpc('eliminar_pago', { p_pago_id: pago.id, p_motivo: form.motivo.trim() || null })
    setSaving(false)
    if (e) { setError(e.message); return }
    setModo(null)
    onChanged(`${Etq} borrado (también de banco)`)
  }

  if (!canEdit && !canDelete) return null

  const loteCambia = esLote && modo === 'editar' && (
    form.fecha !== pago.fecha || form.cuenta_id !== (pago.cuenta_id || '') || form.referencia.trim() !== (pago.referencia || '')
  )

  return (
    <span className="inline-flex items-center gap-2 print:hidden no-underline" style={{ textDecoration: 'none' }}>
      {canEdit && !esCredito && !reversado && (
        <button onClick={abrirEditar} className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-800 font-medium" title={`Editar este ${etiqueta}`}>
          <Pencil size={13} /> Editar
        </button>
      )}
      {canDelete && (
        <button onClick={abrirBorrar} className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 font-medium" title={`Borrar este ${etiqueta}`}>
          <Trash2 size={13} /> Borrar
        </button>
      )}

      {modo && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[80] p-4 print:hidden" onClick={cerrar}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 text-left" onClick={e => e.stopPropagation()}>
            {modo === 'editar' ? (
              <>
                <h2 className="text-lg font-semibold mb-1">Editar {etiqueta}</h2>
                <p className="text-sm text-gray-500 mb-4">El cambio se aplica también al movimiento de banco.</p>
                <div className="space-y-3">
                  <div><label className="label">Monto *</label>
                    <input type="number" step="0.01" className="input" value={form.monto}
                      onChange={e => setForm(f => ({ ...f, monto: e.target.value }))} /></div>
                  <div><label className="label">Fecha *</label>
                    <input type="date" className="input" value={form.fecha}
                      onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} /></div>
                  <div><label className="label">Cuenta de banco *</label>
                    <select className="input" value={form.cuenta_id}
                      onChange={e => setForm(f => ({ ...f, cuenta_id: e.target.value }))}>
                      <option value="">Seleccionar cuenta...</option>
                      {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                    </select></div>
                  <div><label className="label">Referencia</label>
                    <input className="input" placeholder="Nº de cheque, transferencia..." value={form.referencia}
                      onChange={e => setForm(f => ({ ...f, referencia: e.target.value }))} /></div>
                  <div><label className="label">Motivo (opcional)</label>
                    <input className="input" placeholder="Ej: cuenta equivocada" value={form.motivo}
                      onChange={e => setForm(f => ({ ...f, motivo: e.target.value }))} /></div>
                </div>
                {esLote && (
                  <div className={`mt-3 rounded-xl px-3 py-2 text-xs border ${loteCambia ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
                    Este {etiqueta} es parte de un {etiqueta} múltiple con un solo movimiento de banco.
                    El monto ajusta ese movimiento; {loteCambia ? <b>la fecha, cuenta y referencia se cambiarán en TODOS los {etiqueta}s del mismo depósito.</b> : 'si cambias fecha, cuenta o referencia se aplicará a todo el depósito.'}
                  </div>
                )}
              </>
            ) : (
              <>
                <h2 className="text-lg font-semibold mb-1 flex items-center gap-2"><Trash2 size={18} className="text-red-500" /> Borrar {etiqueta}</h2>
                <p className="text-sm text-gray-500 mb-3">
                  {formatDate(pago.fecha)} · <span className="font-semibold text-gray-700">{formatCurrency(pago.monto)}</span>
                </p>
                <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3 text-xs text-red-700">
                  {esCredito
                    ? 'Se quita esta aplicación y el anticipo / nota de crédito vuelve a quedar disponible. No afecta banco.'
                    : esLote
                    ? `Se borra el ${etiqueta} y se descuenta su monto del movimiento de banco del depósito. El saldo del documento se recalcula.`
                    : `Se borra el ${etiqueta} y su movimiento de banco. El saldo del documento se recalcula.`}
                  {reversado ? ' También se elimina su reverso y el contra-movimiento.' : ''}
                </div>
                <label className="label">Motivo (opcional)</label>
                <input className="input" placeholder="Ej: registrado en la factura equivocada" value={form.motivo}
                  onChange={e => setForm(f => ({ ...f, motivo: e.target.value }))} />
              </>
            )}
            {error && <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
            <div className="flex gap-3 mt-5">
              <button className="btn-secondary flex-1" onClick={cerrar} disabled={saving}>Cancelar</button>
              {modo === 'editar' ? (
                <button className="btn-primary flex-1" onClick={guardar} disabled={saving}>{saving ? 'Guardando...' : 'Guardar cambios'}</button>
              ) : (
                <button className="btn-primary flex-1 !bg-red-600 hover:!bg-red-700" onClick={borrar} disabled={saving}>{saving ? 'Borrando...' : 'Borrar'}</button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </span>
  )
}
