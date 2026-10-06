'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { formatMonto, formatDate } from '@/lib/utils'
import type { Modulo } from '@/types/auth'

/**
 * Anula un anticipo (RPC anular_anticipo): registra un egreso en banco por el monto
 * en la fecha elegida (por defecto hoy; valida depósito, futuro y mes cerrado) y queda en la bitácora. La base de datos lo BLOQUEA si el anticipo
 * tiene aplicaciones vigentes: primero hay que reversarlas (botón Borrar en el cobro).
 */
interface Props {
  anticipo: { id: string; monto: number; fecha: string; estado: string; numero_recibo?: number | null; clientes?: { nombre: string } | null; banco_cuentas?: { nombre: string } | null }
  modulo: Modulo
  onChanged: (mensaje: string) => void
}

interface Aplicacion { id: string; fecha: string; monto: number; numero_recibo: number | null; documento: string }

const rec = (n?: number | null) => (n ? `REC-${String(n).padStart(5, '0')}` : '')
// Fecha local (no UTC) en formato yyyy-mm-dd
const hoyLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export default function AnularAnticipo({ anticipo, modulo, onChanged }: Props) {
  const supabase = createClient()
  const { puedeHacer } = useAuth()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [aplicaciones, setAplicaciones] = useState<Aplicacion[]>([])
  const [motivo, setMotivo] = useState('')
  const [fecha, setFecha] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  if (!puedeHacer(modulo, 'editar') || anticipo.estado === 'anulado') return null

  const abrir = async () => {
    setOpen(true); setMotivo(''); setFecha(hoyLocal()); setError(''); setAplicaciones([]); setLoading(true)
    const { data, error: e } = await supabase
      .from('pagos')
      .select('id, fecha, monto, numero_recibo, facturas(numero_factura), presupuestos(numero_presupuesto), ventas_ogemi(numero), pago_reversos(id)')
      .eq('anticipo_id', anticipo.id)
      .order('fecha')
    setLoading(false)
    if (e) { setError(e.message); return }
    const one = (x: any) => (Array.isArray(x) ? x[0] : x)
    const vigentes = (data || []).filter((p: any) => {
      const r = p.pago_reversos
      return !(Array.isArray(r) ? r.length > 0 : !!r)
    })
    setAplicaciones(vigentes.map((p: any) => {
      const f = one(p.facturas), pr = one(p.presupuestos), v = one(p.ventas_ogemi)
      const documento = f ? `Factura ${f.numero_factura}` : pr ? `Presupuesto ${pr.numero_presupuesto}` : v ? `Venta Ogemi ${v.numero}` : 'Documento'
      return { id: p.id, fecha: p.fecha, monto: Number(p.monto) || 0, numero_recibo: p.numero_recibo, documento }
    }))
  }

  const anular = async () => {
    if (!fecha) { setError('Indica la fecha de anulación.'); return }
    if (fecha < anticipo.fecha) { setError(`La fecha no puede ser anterior al depósito (${formatDate(anticipo.fecha)}).`); return }
    if (fecha > hoyLocal()) { setError('La fecha no puede ser futura.'); return }
    setSaving(true); setError('')
    const { error: e } = await supabase.rpc('anular_anticipo', { p_anticipo_id: anticipo.id, p_motivo: motivo.trim() || null, p_fecha: fecha })
    setSaving(false)
    if (e) { setError(e.message); return }
    setOpen(false)
    onChanged('Anticipo anulado')
  }

  const bloqueado = aplicaciones.length > 0
  const totalAplicado = aplicaciones.reduce((s, a) => s + a.monto, 0)

  return (
    <>
      <button onClick={abrir} className="flex items-center gap-1 text-xs text-red-400 hover:text-red-600 transition-colors" title="Anular este anticipo">
        <X size={14} /> Anular
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[80] p-4 print:hidden" onClick={() => !saving && setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 text-left" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-1">Anular anticipo {rec(anticipo.numero_recibo)}</h2>
            <p className="text-sm text-gray-500 mb-4">
              {formatDate(anticipo.fecha)} · {formatMonto(anticipo.monto)} · <span className="font-semibold text-gray-700">{anticipo.clientes?.nombre || '—'}</span>
            </p>

            {loading ? (
              <p className="text-sm text-gray-400">Revisando aplicaciones...</p>
            ) : bloqueado ? (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-3 text-sm text-amber-900">
                <p className="font-semibold mb-1">No se puede anular todavía</p>
                <p className="text-xs mb-2">
                  Este anticipo tiene {formatMonto(totalAplicado)} aplicado. Primero reversa estas aplicaciones
                  (abre cada documento y usa el botón <span className="font-semibold">Borrar</span> en el cobro con anticipo); después podrás anularlo:
                </p>
                <ul className="text-xs space-y-1">
                  {aplicaciones.map(a => (
                    <li key={a.id} className="flex justify-between gap-2 bg-white/70 rounded-lg px-2 py-1">
                      <span><span className="font-semibold">{a.documento}</span> · {formatDate(a.fecha)}{a.numero_recibo ? ` · ${rec(a.numero_recibo)}` : ''}</span>
                      <span className="font-mono">{formatMonto(a.monto)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <>
                <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3 text-xs text-red-800">
                  Se registrará un egreso de {formatMonto(anticipo.monto)} con la fecha indicada en {anticipo.banco_cuentas?.nombre || 'la cuenta del depósito'}. El anticipo queda anulado y no se puede reactivar.
                </div>
                <label className="label">Fecha de anulación *</label>
                <input type="date" className="input mb-1" value={fecha} min={anticipo.fecha} max={hoyLocal()} onChange={e => setFecha(e.target.value)} />
                <p className="text-[11px] text-gray-400 mb-3">Fecha del egreso en banco. Entre el depósito ({formatDate(anticipo.fecha)}) y hoy; no puede caer en un mes de banco ya cerrado.</p>
                <label className="label">Motivo (opcional)</label>
                <input className="input" placeholder="Ej: depósito duplicado" value={motivo} onChange={e => setMotivo(e.target.value)} />
                <p className="text-[11px] text-gray-400 mt-2">Queda registrado en la bitácora.</p>
              </>
            )}

            {error && <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
            <div className="flex gap-3 mt-5">
              <button className="btn-secondary flex-1" onClick={() => setOpen(false)} disabled={saving}>{bloqueado ? 'Cerrar' : 'Cancelar'}</button>
              {!bloqueado && !loading && (
                <button className="btn-primary flex-1 !bg-red-600 hover:!bg-red-700" onClick={anular} disabled={saving}>{saving ? 'Anulando...' : 'Anular anticipo'}</button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
