import { createServerSupabaseClient } from '@/lib/supabase-server'
import { resolveAuthorizedProfile } from '@/lib/auth-profile'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next')

  if (code) {
    const supabase = await createServerSupabaseClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        try {
          const profile = await resolveAuthorizedProfile(user)
          if (profile) {
            // Validación pasada: redirigir (respetando `next` solo si el perfil existe)
            const destination = next ? `${origin}${next}` : `${origin}/inicio`
            return NextResponse.redirect(destination)
          }
        } catch {}
      }

      await supabase.auth.signOut()
      return NextResponse.redirect(
        `${origin}/login?error=unauthorized&message=${encodeURIComponent('Este correo no está inscrito como usuario del sistema.')}`
      )
    }
  }

  return NextResponse.redirect(`${origin}/login?error=oauth`)
}
