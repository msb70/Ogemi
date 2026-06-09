import { NextResponse } from 'next/server'
import { resolveAuthorizedProfile } from '@/lib/auth-profile'
import { createAdminClient } from '@/lib/supabase-admin'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import type { RolPermiso } from '@/types/auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
  }

  try {
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

    return NextResponse.json({ user, profile, permisos: permisosMap })
  } catch {
    return NextResponse.json({ error: 'No se pudo cargar tu perfil de usuario.' }, { status: 500 })
  }
}
