import type { User } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase-admin'
import type { UserProfile } from '@/types/auth'

function normalizeEmail(email?: string | null) {
  return (email || '').trim().toLowerCase()
}

export async function resolveAuthorizedProfile(user: User): Promise<UserProfile | null> {
  const admin = createAdminClient()
  const email = normalizeEmail(user.email)

  const { data: profileById, error: byIdError } = await admin
    .from('user_profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle()

  if (byIdError) throw byIdError
  if (profileById) return profileById.activo ? (profileById as UserProfile) : null
  if (!email) return null

  const { data: profileByEmail, error: byEmailError } = await admin
    .from('user_profiles')
    .select('*')
    .eq('email', email)
    .maybeSingle()

  if (byEmailError) throw byEmailError
  if (!profileByEmail || !profileByEmail.activo) return null

  const { data: linkedProfile, error: linkError } = await admin
    .from('user_profiles')
    .update({
      id: user.id,
      email,
      avatar_url: profileByEmail.avatar_url || (user.user_metadata?.avatar_url as string | undefined) || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', profileByEmail.id)
    .select('*')
    .single()

  if (linkError) throw linkError
  return linkedProfile as UserProfile
}
