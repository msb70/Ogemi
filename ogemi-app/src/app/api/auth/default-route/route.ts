import { NextResponse } from 'next/server'
import { resolveAuthorizedProfile } from '@/lib/auth-profile'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ route: '/login' }, { status: 401 })
  }

  try {
    const profile = await resolveAuthorizedProfile(user)
    if (!profile) {
      await supabase.auth.signOut()
      return NextResponse.json({ route: '/login?error=unauthorized' }, { status: 403 })
    }

    return NextResponse.json({ route: '/inicio' })
  } catch {
    return NextResponse.json({ route: '/inicio' })
  }
}
