'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
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

  const supabase = createClient()

  async function loadProfile(userId: string) {
    const { data: prof } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (!prof) return

    setProfile(prof as UserProfile)

    const { data: perms } = await supabase
      .from('rol_permisos')
      .select('*')
      .eq('rol_id', prof.rol_id)

    if (perms) {
      const map: Record<string, RolPermiso> = {}
      perms.forEach((p: RolPermiso) => { map[p.modulo] = p })
      setPermisos(map)
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        loadProfile(session.user.id).finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        loadProfile(session.user.id)
      } else {
        setProfile(null)
        setPermisos({})
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  function puedeHacer(modulo: Modulo, accion: Accion): boolean {
    if (!profile) return false
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
    await supabase.auth.signOut()
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
