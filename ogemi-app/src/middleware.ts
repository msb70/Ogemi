import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { resolveAuthorizedProfile } from '@/lib/auth-profile'

async function signOutAndRedirect(
  supabase: ReturnType<typeof createServerClient>,
  request: NextRequest,
  path = '/login?error=unauthorized'
) {
  await supabase.auth.signOut()
  return NextResponse.redirect(new URL(path, request.url))
}

async function getAuthorizedProfile(user: NonNullable<Awaited<ReturnType<ReturnType<typeof createServerClient>['auth']['getUser']>>['data']['user']>) {
  try {
    return await resolveAuthorizedProfile(user)
  } catch {
    return null
  }
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Rutas públicas
  if (
    pathname.startsWith('/auth/callback') ||
    pathname.startsWith('/auth/set-password') ||
    pathname.startsWith('/auth/cambiar-password') ||
    pathname.startsWith('/api/auth/')
  ) {
    return supabaseResponse
  }

  if (pathname.startsWith('/login')) {
    if (user) {
      const profile = await getAuthorizedProfile(user)

      if (profile) {
        return NextResponse.redirect(new URL('/inicio', request.url))
      }

      await supabase.auth.signOut()
    }
    return supabaseResponse
  }

  // Redirigir a login si no hay sesión
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const profile = await getAuthorizedProfile(user)

  if (!profile) {
    return signOutAndRedirect(supabase, request)
  }

  // Primer login: forzar cambio de contraseña
  if (profile.must_change_password && !pathname.startsWith('/auth/cambiar-password')) {
    return NextResponse.redirect(new URL('/auth/cambiar-password', request.url))
  }

  // Redirigir raíz a dashboard
  if (pathname === '/') {
    return NextResponse.redirect(new URL('/inicio', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
