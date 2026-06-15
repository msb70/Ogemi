import { NextResponse } from 'next/server'
import { resolveAuthorizedProfile } from '@/lib/auth-profile'
import { createAdminClient } from '@/lib/supabase-admin'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import type { User } from '@supabase/supabase-js'
import type { RolPermiso } from '@/types/auth'

export const dynamic = 'force-dynamic'

const AUTH_ME_CACHE_TTL_MS = 10_000

type CachedAuthPayload = {
  user: User
  profile: Awaited<ReturnType<typeof resolveAuthorizedProfile>>
  permisos: Record<string, RolPermiso>
}

const profileCache = new Map<string, { expiresAt: number; payload: CachedAuthPayload }>()

export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
  }

  try {
    const cached = profileCache.get(user.id)
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.payload, {
        headers: { 'Cache-Control': 'private, no-store' },
      })
    }

    const profile = await resolveAuthorizedProfile(user)
    if (!profile) {
      await supabase.auth.signOut()
      return NextResponse.json({ error: 'Este correo no está inscrito como usuario del sistema.' }, { status: 403 })
    }

    const admin = createAdminClient()
    const { data: permisos, error } = await admin
      .from('rol_permisos')
      .select('*')
      .eq('rol_id', profile.rol_id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const permisosMap: Record<string, RolPermiso> = {}
    ;(permisos || []).forEach((permiso: RolPermiso) => {
      permisosMap[permiso.modulo] = permiso
    })

    const payload = { user, profile, permisos: permisosMap }
    profileCache.set(user.id, {
      expiresAt: Date.now() + AUTH_ME_CACHE_TTL_MS,
      payload,
    })

    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch {
    return NextResponse.json({ error: 'No se pudo cargar tu perfil de usuario.' }, { status: 500 })
  }
}
