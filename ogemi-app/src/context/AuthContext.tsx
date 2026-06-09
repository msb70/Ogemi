'use client'

import { createContext, useContext, useCallback, useEffect, useMemo, useState, ReactNode } from 'react'
import { createClient } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'
import type { UserProfile, RolPermiso, Modulo, Accion } from '@/types/auth'

interface AuthContextValue {
  user: User | null
  profile: UserProfile | null
  permisos: Record<string, RolPermiso>
  loading: boolean
  puedeHacer: (modulo: Modulo, accion: Accion) => boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [permisos, setPermisos] = useState<Record<string, RolPermiso>>({})
  const [loading, setLoading] = useState(true)

  const supabase = useMemo(() => createClient(), [])

  const rejectUnauthorizedSession = useCallback(async (message = 'Este correo no está inscrito como usuario del sistema.') => {
    setUser(null)
    setProfile(null)
    setPermisos({})
    await supabase.auth.signOut()
    if (typeof window !== 'undefined') {
      window.location.replace(`/login?error=unauthorized&message=${encodeURIComponent(message)}`)
    }
  }, [supabase])

  const loadProfile = useCallback(async () => {
    const response = await fetch('/api/auth/me', { cache: 'no-store' })
    const payload = await response.json().catch(() => ({}))

    if (!response.ok) {
      await rejectUnauthorizedSession(payload.error || 'Tu correo no tiene un usuario activo en Ogemi.')
      return
    }

    setUser(payload.user as User)
    setProfile(payload.profile as UserProfile)
    setPermisos((payload.permisos || {}) as Record<string, RolPermiso>)
  }, [rejectUnauthorizedSession])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        await loadProfile()
      } else {
        setUser(null)
        setProfile(null)
        setPermisos({})
      }
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        setLoading(true)
        await loadProfile()
        setLoading(false)
      } else {
        setUser(null)
        setProfile(null)
        setPermisos({})
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [loadProfile, supabase.auth])

  function puedeHacer(modulo: Modulo, accion: Accion): boolean {
    if (!profile) return false
    if (!profile.activo) return false
    if (profile.rol_id === 'admin') return true
    const p = permisos[modulo]
    if (!p) return false
    if (accion === 'ver')     return p.puede_ver
    if (accion === 'agregar') return p.puede_agregar
    if (accion === 'editar')  return p.puede_editar
    if (accion === 'borrar')  return p.puede_borrar
    return false
  }

  async function signOut() {
    setUser(null)
    setProfile(null)
    setPermisos({})
    await supabase.auth.signOut()
    await fetch('/api/auth/signout', { method: 'POST' }).catch(() => null)
    if (typeof window !== 'undefined') {
      window.location.replace('/login')
    }
  }

  return (
    <AuthContext.Provider value={{ user, profile, permisos, loading, puedeHacer, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}
