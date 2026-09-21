'use client'

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Users } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { formatMonto, formatDate } from '@/lib/utils'
import type { Modulo } from '@/types/auth'

/**
 * Cambia el cliente de un anticipo ya grabado (RPC cambiar_cliente_anticipo).
 * La base de datos lo rechaza si el anticipo ya está aplicado a documentos del cliente actual:
 * primero hay que borrar esas aplicaciones. Queda registrado en la bitácora.
 */
interface Props {
  anticipo: { id: string; cliente_id: string; monto: number; fecha: string; estado: string; clientes?: { nombre: string } | null }
  clientes: { id: string; nombre: string }[]
  modulo: Modulo
  aplicado: number
  onChanged: (mensaje: string) => void
}

export default function CambiarClienteAnticipo({ anticipo, clientes, modulo, aplicado, onChanged }: Props) {
  const supabase = createClient()
  const { puedeHacer } = useAuth()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [clienteId, setClienteId] = useState('')
  const [motivo, setMotivo] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const opciones = useMemo(() => {
    const s = q.trim().toLowerCase()
    return clientes.filter(c => c.id !== anticipo.cliente_id && (!s || c.nombre.toLowerCase().includes(s))).slice(0, 50)
  }, [clientes, q, anticipo.cliente_id])

  if (!puedeHacer(modulo, 'editar') || anticipo.estado === 'anulado') return null

  const abrir = () => { setQ(''); setClienteId(''); setMotivo(''); setError(''); setOpen(true) }
  const guardar = async () => {
    if (!clienteId) { setError('Selecciona el cliente correcto.'); return }
    setSaving(true); setError('')
    const { error: e } = await supabase.rpc('cambiar_cliente_anticipo', {
      p_anticipo_id: anticipo.id, p_cliente_id: clienteId, p_motivo: motivo.trim() || null,
    })
    setSaving(false)
    if (e) { setError(e.message); return }
    setOpen(false)
    onChanged('Cliente del anticipo actualizado')
  }

  return (
    <>
      <button onClick={abrir} className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-800 transition-colors" title="Cambiar el cliente de este anticipo">
        <Users size={14} /> Cliente
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[80] p-4 print:hidden" onClick={() => !saving && setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 text-left" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-1">Cambiar cliente del anticipo</h2>
            <p className="text-sm text-gray-500 mb-4">
              {formatDate(anticipo.fecha)} · {formatMonto(anticipo.monto)} · actual: <span className="font-semibold text-gray-700">{anticipo.clientes?.nombre || '—'}</span>
            </p>
            {aplicado > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3 text-xs text-amber-800">
                Este anticipo tiene {formatMonto(aplicado)} aplicado a documentos del cliente actual. Hay que borrar esas aplicaciones antes de cambiar el cliente.
              </div>
            )}
            <label className="label">Cliente correcto *</label>
            <input className="input mb-2" placeholder="Buscar cliente..." value={q} onChange={e => setQ(e.target.value)} autoFocus />
            <div className="border border-gray-200 rounded-lg max-h-48 overflow-auto divide-y divide-gray-100">
              {opciones.length === 0 ? (
                <p className="text-sm text-gray-400 px-3 py-2">Sin resultados</p>
              ) : opciones.map(c => (
                <button key={c.id} type="button" onClick={() => setClienteId(c.id)}
                  className={`w-full text-left px-3 py-2 text-sm ${clienteId === c.id ? 'bg-brand-50 text-brand-800 font-semibold' : 'hover:bg-gray-50 text-gray-700'}`}>
                  {c.nombre}
                </button>
              ))}
            </div>
            <label className="label mt-3">Motivo (opcional)</label>
            <input className="input" placeholder="Ej: se registró al cliente equivocado" value={motivo} onChange={e => setMotivo(e.target.value)} />
            <p className="text-[11px] text-gray-400 mt-2">No cambia montos ni banco; solo el cliente (y el texto del movimiento de banco). Queda en la bitácora.</p>
            {error && <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
            <div className="flex gap-3 mt-5">
              <button className="btn-secondary flex-1" onClick={() => setOpen(false)} disabled={saving}>Cancelar</button>
              <button className="btn-primary flex-1" onClick={guardar} disabled={saving || !clienteId}>{saving ? 'Guardando...' : 'Cambiar cliente'}</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
