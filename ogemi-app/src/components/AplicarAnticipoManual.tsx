'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { formatMonto } from '@/lib/utils'
import type { Modulo } from '@/types/auth'

/**
 * Aplica el saldo de un anticipo SIN documento (casos excepcionales), con una descripción
 * obligatoria (RPC aplicar_anticipo_manual). No mueve banco: el dinero ya entró con el depósito.
 * Se ve luego en "Aplicaciones" y se puede borrar desde ahí. Queda en la bitácora.
 */
interface Props {
  anticipo: { id: string; fecha: string; estado: string }
  modulo: Modulo
  saldo: number
  onChanged: (mensaje: string) => void
}

const hoyLocal = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function AplicarAnticipoManual({ anticipo, modulo, saldo, onChanged }: Props) {
  const supabase = createClient()
  const { puedeHacer } = useAuth()
  const [open, setOpen] = useState(false)
  const [monto, setMonto] = useState('')
  const [fecha, setFecha] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  if (!puedeHacer(modulo, 'editar') || anticipo.estado === 'anulado' || saldo <= 0) return null

  const abrir = () => {
    setMonto(saldo.toFixed(2)); setFecha(hoyLocal()); setDescripcion(''); setError(''); setOpen(true)
  }

  const guardar = async () => {
    const m = Number(monto)
    if (!descripcion.trim()) { setError('Escribe la descripción.'); return }
    if (!m || m <= 0) { setError('El monto debe ser mayor que cero.'); return }
    if (Math.round(m * 100) > Math.round(saldo * 100)) { setError(`El monto no puede superar el saldo (${formatMonto(saldo)}).`); return }
    if (!fecha) { setError('Indica la fecha.'); return }
    setSaving(true); setError('')
    const { error: e } = await supabase.rpc('aplicar_anticipo_manual', {
      p_anticipo_id: anticipo.id, p_monto: m, p_fecha: fecha, p_descripcion: descripcion.trim(),
    })
    setSaving(false)
    if (e) { setError(e.message); return }
    setOpen(false)
    onChanged('Anticipo aplicado')
  }

  return (
    <>
      <button onClick={abrir} className="flex items-center gap-1 text-xs text-green-700 hover:text-green-900 transition-colors" title="Aplicar el saldo sin factura, con una descripción">
        <CheckCircle size={14} /> Aplicar
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[80] p-4 print:hidden" onClick={() => !saving && setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 text-left max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-1">Aplicar anticipo</h2>
            <p className="text-sm text-gray-500 mb-4">
              Aplica el saldo sin factura. No mueve banco. Saldo disponible: <b>{formatMonto(saldo)}</b>
            </p>
            <label className="label">Descripción *</label>
            <textarea className="input" rows={3} placeholder="Ej: aplicado contra servicio sin factura acordado con el cliente"
              value={descripcion} onChange={e => setDescripcion(e.target.value)} autoFocus />
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className="label">Monto *</label>
                <input type="number" step="0.01" min="0" className="input" value={monto} onChange={e => setMonto(e.target.value)} />
              </div>
              <div>
                <label className="label">Fecha *</label>
                <input type="date" className="input" value={fecha} onChange={e => setFecha(e.target.value)} />
              </div>
            </div>
            <p className="text-[11px] text-gray-400 mt-2">Se verá en &quot;Aplicaciones&quot; y queda en la bitácora. Si el monto es todo el saldo, el anticipo pasa a aplicado.</p>
            {error && <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
            <div className="flex gap-3 mt-5">
              <button className="btn-secondary flex-1" onClick={() => setOpen(false)} disabled={saving}>Cancelar</button>
              <button className="btn-primary flex-1" onClick={guardar} disabled={saving}>{saving ? 'Aplicando...' : 'Aplicar'}</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
