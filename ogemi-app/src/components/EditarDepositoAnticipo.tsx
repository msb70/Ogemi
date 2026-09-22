'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Pencil } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { formatMonto } from '@/lib/utils'
import type { Modulo } from '@/types/auth'

/**
 * Modifica el depósito de banco de un anticipo ya grabado (RPC editar_deposito_anticipo):
 * monto, fecha, cuenta, número de depósito y notas. Actualiza también el ingreso en banco.
 * La BD rechaza: anticipos anulados, monto menor que lo ya aplicado, y fechas/cuentas
 * dentro de un cierre de banco ya hecho. Queda en la bitácora.
 */
interface Props {
  anticipo: {
    id: string; monto: number; fecha: string; cuenta_id: string; estado: string
    numero_deposito: string | null; notas: string | null
    banco_cuentas?: { nombre: string; banco: string } | null
  }
  cuentas: { id: string; nombre: string; banco: string }[]
  modulo: Modulo
  aplicado: number
  onChanged: (mensaje: string) => void
}

export default function EditarDepositoAnticipo({ anticipo, cuentas, modulo, aplicado, onChanged }: Props) {
  const supabase = createClient()
  const { puedeHacer } = useAuth()
  const [open, setOpen] = useState(false)
  const [monto, setMonto] = useState('')
  const [fecha, setFecha] = useState('')
  const [cuentaId, setCuentaId] = useState('')
  const [deposito, setDeposito] = useState('')
  const [notas, setNotas] = useState('')
  const [motivo, setMotivo] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  if (!puedeHacer(modulo, 'editar') || anticipo.estado === 'anulado') return null

  // Si la cuenta actual está inactiva no viene en la lista: se añade para no perderla
  const opciones = cuentas.some(c => c.id === anticipo.cuenta_id)
    ? cuentas
    : [{ id: anticipo.cuenta_id, nombre: anticipo.banco_cuentas?.nombre || 'Cuenta actual', banco: anticipo.banco_cuentas?.banco || '' }, ...cuentas]

  const abrir = () => {
    setMonto(String(anticipo.monto)); setFecha(anticipo.fecha); setCuentaId(anticipo.cuenta_id)
    setDeposito(anticipo.numero_deposito || ''); setNotas(anticipo.notas || ''); setMotivo('')
    setError(''); setOpen(true)
  }

  const guardar = async () => {
    const m = Number(monto)
    if (!m || m <= 0) { setError('El monto debe ser mayor que cero.'); return }
    if (Math.round(m * 100) < Math.round(aplicado * 100)) {
      setError(`El monto no puede ser menor que lo ya aplicado (${formatMonto(aplicado)}). Borra primero esas aplicaciones.`); return
    }
    if (!fecha) { setError('Indica la fecha.'); return }
    if (!cuentaId) { setError('Selecciona la cuenta.'); return }
    setSaving(true); setError('')
    const { error: e } = await supabase.rpc('editar_deposito_anticipo', {
      p_anticipo_id: anticipo.id, p_monto: m, p_fecha: fecha, p_cuenta_id: cuentaId,
      p_numero_deposito: deposito.trim() || null, p_notas: notas.trim() || null, p_motivo: motivo.trim() || null,
    })
    setSaving(false)
    if (e) { setError(e.message); return }
    setOpen(false)
    onChanged('Depósito del anticipo actualizado')
  }

  return (
    <>
      <button onClick={abrir} className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-800 transition-colors" title="Modificar el depósito de banco de este anticipo">
        <Pencil size={14} /> Depósito
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[80] p-4 print:hidden" onClick={() => !saving && setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 text-left max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-1">Modificar depósito del anticipo</h2>
            <p className="text-sm text-gray-500 mb-4">Actualiza el anticipo y su ingreso en banco.</p>
            {aplicado > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3 text-xs text-amber-800">
                Ya hay {formatMonto(aplicado)} aplicado a documentos: el monto no puede bajar de esa cifra.
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Monto *</label>
                <input type="number" step="0.01" min="0" className="input" value={monto} onChange={e => setMonto(e.target.value)} />
              </div>
              <div>
                <label className="label">Fecha *</label>
                <input type="date" className="input" value={fecha} onChange={e => setFecha(e.target.value)} />
              </div>
            </div>
            <label className="label mt-3">Cuenta de banco *</label>
            <select className="input" value={cuentaId} onChange={e => setCuentaId(e.target.value)}>
              {opciones.map(c => <option key={c.id} value={c.id}>{c.nombre}{c.banco ? ` – ${c.banco}` : ''}</option>)}
            </select>
            <label className="label mt-3">N° de depósito</label>
            <input className="input" value={deposito} onChange={e => setDeposito(e.target.value)} />
            <label className="label mt-3">Notas</label>
            <input className="input" value={notas} onChange={e => setNotas(e.target.value)} />
            <label className="label mt-3">Motivo del cambio (opcional)</label>
            <input className="input" placeholder="Ej: monto mal digitado" value={motivo} onChange={e => setMotivo(e.target.value)} />
            <p className="text-[11px] text-gray-400 mt-2">No se permite si la fecha o la cuenta caen en un cierre de banco ya hecho. Queda en la bitácora.</p>
            {error && <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
            <div className="flex gap-3 mt-5">
              <button className="btn-secondary flex-1" onClick={() => setOpen(false)} disabled={saving}>Cancelar</button>
              <button className="btn-primary flex-1" onClick={guardar} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
