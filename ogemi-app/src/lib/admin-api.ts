import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-admin'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export async function requireAdmin() {
  const sessionClient = await createServerSupabaseClient()
  const { data: { user } } = await sessionClient.auth.getUser()

  if (!user) {
    return {
      error: NextResponse.json({ error: 'No autenticado.' }, { status: 401 }),
      admin: null,
      user: null,
    }
  }

  let admin = sessionClient
  let hasServiceRole = false
  try {
    admin = createAdminClient()
    hasServiceRole = true
  } catch {}

  const [profileResult, legacyRoleResult] = await Promise.all([
    admin.from('user_profiles').select('rol_id, activo').eq('id', user.id).maybeSingle(),
    admin.from('user_roles').select('role').eq('user_id', user.id).maybeSingle(),
  ])
  const profile = profileResult.error ? null : profileResult.data
  const legacyRole = legacyRoleResult.error ? null : legacyRoleResult.data

  const isAdmin = profile?.rol_id === 'admin' || legacyRole?.role === 'admin'
  const isActive = profile?.activo !== false

  if (!isAdmin || !isActive) {
    return {
      error: NextResponse.json({ error: 'No tienes permiso de administrador.' }, { status: 403 }),
      admin: null,
      user: null,
    }
  }

  return { error: null, admin, user, hasServiceRole }
}
