'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Lock } from 'lucide-react'
import { createClient } from '@/lib/supabase'

type PageState = 'ready' | 'saving' | 'done'

export default function CambiarPasswordPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [pageState, setPageState] = useState<PageState>('ready')
  const [error, setError] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.')
      return
    }

    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.')
      return
    }

    setPageState('saving')

    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      setError(updateError.message || 'No se pudo actualizar la contraseña.')
      setPageState('ready')
      return
    }

    // Marcar must_change_password = false via API
    await fetch('/api/auth/clear-must-change-password', { method: 'POST' })

    setPageState('done')
    router.replace('/inicio')
    router.refresh()
  }

  const isBusy = pageState === 'saving' || pageState === 'done'

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-700 to-brand-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <img
              src="/logo.jpeg"
              alt="Ogemi Impresora"
              className="w-24 h-24 object-contain rounded-full"
            />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Cambiar contraseña</h1>
          <p className="text-sm text-gray-500 mt-1">
            Por seguridad debes cambiar tu contraseña temporal antes de continuar.
          </p>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block">
            <span className="label">Nueva contraseña</span>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                className="input w-full pl-9"
                disabled={isBusy}
              />
            </div>
          </label>

          <label className="block">
            <span className="label">Confirmar contraseña</span>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Repite la contraseña"
                className="input w-full pl-9"
                disabled={isBusy}
              />
            </div>
          </label>

          <button
            type="submit"
            disabled={isBusy}
            className="w-full rounded-lg bg-brand-700 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isBusy ? 'Guardando...' : 'Guardar contraseña'}
          </button>
        </form>
      </div>
    </div>
  )
}
