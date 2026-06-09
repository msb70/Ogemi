import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-api'

export const dynamic = 'force-dynamic'

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export async function GET() {
  const { error, admin } = await requireAdmin()
  if (error) return error
  if (!admin) return NextResponse.json({ error: 'No tienes permiso de administrador.' }, { status: 403 })

  const { data, error: queryError } = await admin
    .from('user_profiles')
    .select('*')
    .order('created_at', { ascending: true })

  if (queryError) {
    return NextResponse.json({ error: queryError.message }, { status: 500 })
  }

  return NextResponse.json({ usuarios: data || [] })
}

export async function POST(request: NextRequest) {
  const { error, admin, hasServiceRole } = await requireAdmin()
  if (error) return error
  if (!admin) return NextResponse.json({ error: 'No tienes permiso de administrador.' }, { status: 403 })
  if (!hasServiceRole) {
    return NextResponse.json(
      { error: 'Falta configurar SUPABASE_SERVICE_ROLE_KEY en Vercel para crear usuarios Auth.' },
      { status: 500 }
    )
  }

  const body = await request.json().catch(() => null)
  const email = normalizeEmail(body?.email)
  const nombre = typeof body?.nombre === 'string' ? body.nombre.trim() : ''
  const rolId = typeof body?.rol_id === 'string' ? body.rol_id.trim() : ''
  const activo = body?.activo !== false

  if (!email || !email.includes('@') || !rolId) {
    return NextResponse.json({ error: 'Email y rol son obligatorios.' }, { status: 400 })
  }

  const { data: roleExists } = await admin
    .from('roles')
    .select('id')
    .eq('id', rolId)
    .maybeSingle()

  if (!roleExists) {
    return NextResponse.json({ error: 'El rol seleccionado no existe.' }, { status: 400 })
  }

  const origin = request.nextUrl.origin
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/auth/callback`,
    data: {
      full_name: nombre || email.split('@')[0],
    },
  })

  if (inviteError || !invited.user?.id) {
    return NextResponse.json(
      { error: inviteError?.message || 'No se pudo crear/invitar el usuario.' },
      { status: 400 }
    )
  }

  const { data: profile, error: profileError } = await admin
    .from('user_profiles')
    .upsert({
      id: invited.user.id,
      email,
      nombre: nombre || email.split('@')[0],
      avatar_url: null,
      rol_id: rolId,
      activo,
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single()

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 })
  }

  return NextResponse.json({ usuario: profile })
}

export async function PATCH(request: NextRequest) {
  const { error, admin } = await requireAdmin()
  if (error) return error
  if (!admin) return NextResponse.json({ error: 'No tienes permiso de administrador.' }, { status: 403 })

  const body = await request.json().catch(() => null)
  const userId = typeof body?.id === 'string' ? body.id : ''
  const rolId = typeof body?.rol_id === 'string' ? body.rol_id.trim() : undefined
  const nombre = typeof body?.nombre === 'string' ? body.nombre.trim() : undefined
  const activo = typeof body?.activo === 'boolean' ? body.activo : undefined

  if (!userId) {
    return NextResponse.json({ error: 'ID de usuario obligatorio.' }, { status: 400 })
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (rolId) updates.rol_id = rolId
  if (nombre !== undefined) updates.nombre = nombre || null
  if (activo !== undefined) updates.activo = activo

  const { data, error: updateError } = await admin
    .from('user_profiles')
    .update(updates)
    .eq('id', userId)
    .select('*')
    .single()

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ usuario: data })
}
