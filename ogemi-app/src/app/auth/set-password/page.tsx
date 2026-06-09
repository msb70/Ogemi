'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Lock } from 'lucide-react'
import { createClient } from '@/lib/supabase'

type PageState = 'checking' | 'ready' | 'invalid' | 'saving' | 'done'

function getAuthLinkState() {
  if (typeof window === 'undefined') {
    return { hasAuthLink: false, errorMessage: '' }
  }

  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const queryParams = new URLSearchParams(window.location.search)
  const errorCode = hashParams.get('error_code') || queryParams.get('error_code')
  const errorDescription = hashParams.get('error_description') || queryParams.get('error_description')
  const hasAuthLink =
    hashParams.has('access_token') ||
    hashParams.has('refresh_token') ||
    queryParams.has('code') ||
    queryParams.has('token_hash')

  if (errorCode === 'otp_expired') {
    return {
      hasAuthLink: false,
      errorMessage: 'El enlace de invitación expiró o ya fue usado. Pide al administrador reenviar la invitación.',
    }
  }

  if (errorDescription) {
    return {
      hasAuthLink: false,
      errorMessage: errorDescription.replace(/\+/g, ' '),
    }
  }

  return { hasAuthLink, errorMessage: '' }
}

async function establishInvitationSession(supabase: ReturnType<typeof createClient>) {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const queryParams = new URLSearchParams(window.location.search)
  const code = queryParams.get('code')
  const tokenHash = queryParams.get('token_hash')
  const type = queryParams.get('type')
  const accessToken = hashParams.get('access_token')
  const refreshToken = hashParams.get('refresh_token')

  if (code) {
    return supabase.auth.exchangeCodeForSession(code)
  }

  if (tokenHash && type) {
    return supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as Parameters<typeof supabase.auth.verifyOtp>[0]['type'],
    })
  }

  if (accessToken && refreshToken) {
    return supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    })
  }

  return supabase.auth.getSession()
}

export default function SetPasswordPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [pageState, setPageState] = useState<PageState>('checking')
  const [error, setError] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  useEffect(() => {
    const { hasAuthLink, errorMessage } = getAuthLinkState()

    if (errorMessage) {
      setError(errorMessage)
      setPageState('invalid')
      return
    }

    if (!hasAuthLink) {
      setError('Abre esta página desde el correo de invitación para definir tu contraseña.')
      setPageState('invalid')
      return
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        window.history.replaceState({}, document.title, '/auth/set-password')
        setPageState('ready')
      }
    })

    establishInvitationSession(supabase).then(({ data, error: sessionError }) => {
      const session = 'session' in data ? data.session : null
      if (session) {
        window.history.replaceState({}, document.title, '/auth/set-password')
        setPageState('ready')
        return
      }

      if (sessionError) {
        setError(sessionError.message)
      } else {
        setError('El enlace de invitación no es válido o ya expiró. Pide al administrador reenviar la invitación.')
      }
      setPageState('invalid')
    })

    return () => subscription.unsubscribe()
  }, [supabase])

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
      setError(updateError.message || 'No se pudo guardar la contraseña.')
      setPageState('ready')
      return
    }

    setPageState('done')
    const response = await fetch('/api/auth/default-route')
    const payload = await response.json().catch(() => ({}))
    router.replace(typeof payload.route === 'string' ? payload.route : '/inicio')
    router.refresh()
  }

  const isBusy = pageState === 'checking' || pageState === 'saving' || pageState === 'done'

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
          <h1 className="text-2xl font-bold text-gray-900">Crear contraseña</h1>
          <p className="text-sm text-gray-500 mt-1">Ogemi Impresora</p>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
            {error}
          </div>
        )}

        {pageState === 'checking' && (
          <div className="text-center text-sm text-gray-500">Validando invitación...</div>
        )}

        {pageState === 'invalid' && (
          <button
            type="button"
            onClick={() => router.replace('/login')}
            className="w-full rounded-lg bg-brand-700 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-800"
          >
            Volver al login
          </button>
        )}

        {(pageState === 'ready' || pageState === 'saving' || pageState === 'done') && (
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
                  onChange={event => setPassword(event.target.value)}
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
                  onChange={event => setConfirmPassword(event.target.value)}
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
              {pageState === 'saving' || pageState === 'done' ? 'Guardando...' : 'Guardar contraseña'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
