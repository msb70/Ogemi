'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { createClient } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'
import type { UserProfile, RolPermiso, Modulo, Accion, RolId } from '@/types/auth'

interface AuthContextValue {
  user: User | null
  profile: UserProfile | null
  permisos: Record<string, RolPermiso>
  loading: boolean
  puedeHacer: (modulo: Modulo, accion: Accion) => boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

type LegacyRole = {
  role: 'admin' | 'operador' | 'lectura'
  puede_ver: boolean
  puede_editar: boolean
  puede_borrar: boolean
}

function mapLegacyRole(role?: LegacyRole['role'] | null): RolId | null {
  if (role === 'admin') return 'admin'
  if (role === 'operador') return 'contador'
  if (role === 'lectura') return 'visor'
  return null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [permisos, setPermisos] = useState<Record<string, RolPermiso>>({})
  const [loading, setLoading] = useState(true)

  const supabase = createClient()

  async function loadProfile(authUser: User) {
    const { data: prof, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', authUser.id)
      .maybeSingle()

    const { data: legacyRole } = await supabase
      .from('user_roles')
      .select('role, puede_ver, puede_editar, puede_borrar')
      .eq('user_id', authUser.id)
      .maybeSingle()

    const legacyRolId = mapLegacyRole((legacyRole as LegacyRole | null)?.role)
    const metadata = authUser.user_metadata || {}
    const fallbackProfile: UserProfile = {
      id: authUser.id,
      email: authUser.email || '',
      nombre: (metadata.full_name as string | undefined) || authUser.email?.split('@')[0] || null,
      avatar_url: (metadata.avatar_url as string | undefined) || null,
      rol_id: legacyRolId || 'visor',
      activo: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    const storedProfile = profileError ? null : (prof as UserProfile | null)

    const normalizedProfile: UserProfile = {
      ...fallbackProfile,
      ...storedProfile,
      rol_id: legacyRolId === 'admin' ? 'admin' : (storedProfile?.rol_id || fallbackProfile.rol_id),
    }

    if (!storedProfile && !profileError) {
      await supabase.from('user_profiles').insert({
        id: normalizedProfile.id,
        email: normalizedProfile.email,
        nombre: normalizedProfile.nombre,
        avatar_url: normalizedProfile.avatar_url,
        rol_id: normalizedProfile.rol_id,
        activo: normalizedProfile.activo,
      })
    }

    setProfile(normalizedProfile)

    const { data: perms } = await supabase
      .from('rol_permisos')
      .select('*')
      .eq('rol_id', normalizedProfile.rol_id)

    if (perms) {
      const map: Record<string, RolPermiso> = {}
      perms.forEach((p: RolPermiso) => { map[p.modulo] = p })
      setPermisos(map)
    } else {
      setPermisos({})
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        loadProfile(session.user).finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        loadProfile(session.user)
      } else {
        setProfile(null)
        setPermisos({})
      }
    })

    return () => subscription.unsubscribe()
  }, [])

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
