import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-api'

export const dynamic = 'force-dynamic'

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
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

  const tempPassword = generateTempPassword()

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: {
      full_name: nombre || email.split('@')[0],
    },
  })

  if (createError || !created.user?.id) {
    return NextResponse.json(
      { error: createError?.message || 'No se pudo crear el usuario.' },
      { status: 400 }
    )
  }

  const { data: profile, error: profileError } = await admin
    .from('user_profiles')
    .upsert({
      id: created.user.id,
      email,
      nombre: nombre || email.split('@')[0],
      avatar_url: null,
      rol_id: rolId,
      activo,
      must_change_password: true,
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single()

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 })
  }

  return NextResponse.json({ usuario: profile, tempPassword })
}

export async function PATCH(request: NextRequest) {
  const { error, admin, user, hasServiceRole } = await requireAdmin()
  if (error) return error
  if (!admin) return NextResponse.json({ error: 'No tienes permiso de administrador.' }, { status: 403 })

  const body = await request.json().catch(() => null)
  const userId = typeof body?.id === 'string' ? body.id : ''
  const rolId = typeof body?.rol_id === 'string' ? body.rol_id.trim() : undefined
  const nombre = typeof body?.nombre === 'string' ? body.nombre.trim() : undefined
  const activo = typeof body?.activo === 'boolean' ? body.activo : undefined
  const resetPassword = body?.reset_password === true

  if (!userId) {
    return NextResponse.json({ error: 'ID de usuario obligatorio.' }, { status: 400 })
  }

  if (userId === user?.id && activo === false) {
    return NextResponse.json({ error: 'No puedes desactivar tu propio usuario.' }, { status: 400 })
  }

  // Reset password: genera un nuevo password temporal
  if (resetPassword) {
    if (!hasServiceRole) {
      return NextResponse.json(
        { error: 'Falta SUPABASE_SERVICE_ROLE_KEY para resetear contraseñas.' },
        { status: 500 }
      )
    }
    const newPassword = generateTempPassword()
    const { error: pwError } = await admin.auth.admin.updateUserById(userId, { password: newPassword })
    if (pwError) {
      return NextResponse.json({ error: pwError.message }, { status: 500 })
    }
    await admin
      .from('user_profiles')
      .update({ must_change_password: true, updated_at: new Date().toISOString() })
      .eq('id', userId)
    return NextResponse.json({ ok: true, tempPassword: newPassword })
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

export async function DELETE(request: NextRequest) {
  const { error, admin, user, hasServiceRole } = await requireAdmin()
  if (error) return error
  if (!admin) return NextResponse.json({ error: 'No tienes permiso de administrador.' }, { status: 403 })
  if (!hasServiceRole) {
    return NextResponse.json(
      { error: 'Falta configurar SUPABASE_SERVICE_ROLE_KEY en Vercel para borrar usuarios Auth.' },
      { status: 500 }
    )
  }

  const userId = request.nextUrl.searchParams.get('id')?.trim() || ''

  if (!userId) {
    return NextResponse.json({ error: 'ID de usuario obligatorio.' }, { status: 400 })
  }

  if (userId === user?.id) {
    return NextResponse.json({ error: 'No puedes borrar tu propio usuario.' }, { status: 400 })
  }

  const { data: profile, error: profileLookupError } = await admin
    .from('user_profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle()

  if (profileLookupError) {
    return NextResponse.json({ error: profileLookupError.message }, { status: 500 })
  }

  if (!profile) {
    return NextResponse.json({ error: 'El usuario no existe.' }, { status: 404 })
  }

  const { error: authDeleteError } = await admin.auth.admin.deleteUser(userId)

  if (authDeleteError) {
    return NextResponse.json({ error: authDeleteError.message }, { status: 500 })
  }

  const { error: profileDeleteError } = await admin
    .from('user_profiles')
    .delete()
    .eq('id', userId)

  if (profileDeleteError) {
    return NextResponse.json({ error: profileDeleteError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
