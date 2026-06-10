import { randomBytes } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-api'
import { sendWelcomeEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function generateTempPassword(length = 14): string {
  // SEC: generación criptográficamente segura (no Math.random).
  // Alfabeto sin caracteres ambiguos (I/l/1, O/0) para facilitar transcripción.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const bytes = randomBytes(length)
  return Array.from(bytes, byte => chars[byte % chars.length]).join('')
}

async function findAuthUserByEmail(admin: ReturnType<typeof import('@/lib/supabase-admin').createAdminClient>, email: string) {
  const normalizedEmail = email.toLowerCase()
  let page = 1

  while (page <= 20) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error

    const user = (data.users || []).find(authUser => authUser.email?.toLowerCase() === normalizedEmail)
    if (user) return user
    if ((data.users || []).length < 1000) break
    page += 1
  }

  return null
}

async function deleteAuthUsersByEmail(admin: ReturnType<typeof import('@/lib/supabase-admin').createAdminClient>, email: string) {
  const normalizedEmail = email.toLowerCase()
  const ids = new Set<string>()
  let page = 1

  while (page <= 20) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error

    const users = data.users || []
    users
      .filter(authUser => authUser.email?.toLowerCase() === normalizedEmail)
      .forEach(authUser => ids.add(authUser.id))

    if (users.length < 1000) break
    page += 1
  }

  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id)
    if (error) throw error
  }
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

  const { data: existingProfile, error: existingProfileError } = await admin
    .from('user_profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  if (existingProfileError) {
    return NextResponse.json({ error: existingProfileError.message }, { status: 500 })
  }

  if (existingProfile) {
    return NextResponse.json({ error: 'Este correo ya existe en Usuarios.' }, { status: 400 })
  }

  const tempPassword = generateTempPassword()
  const now = new Date().toISOString()
  let authUserId = ''

  try {
    const existingAuthUser = await findAuthUserByEmail(admin, email)

    if (existingAuthUser) {
      authUserId = existingAuthUser.id
      const { error: updateAuthError } = await admin.auth.admin.updateUserById(authUserId, {
        password: tempPassword,
        user_metadata: {
          full_name: nombre || email.split('@')[0],
        },
      })

      if (updateAuthError) {
        return NextResponse.json({ error: updateAuthError.message }, { status: 500 })
      }
    } else {
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

      authUserId = created.user.id
    }
  } catch (authLookupError) {
    return NextResponse.json(
      { error: authLookupError instanceof Error ? authLookupError.message : 'No se pudo validar el usuario Auth.' },
      { status: 500 }
    )
  }

  const { data: profile, error: profileError } = await admin
    .from('user_profiles')
    .upsert({
      id: authUserId,
      email,
      nombre: nombre || email.split('@')[0],
      avatar_url: null,
      rol_id: rolId,
      activo,
      must_change_password: true,
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single()

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 })
  }

  const emailStatus = await sendWelcomeEmail({
    to: email,
    name: nombre || email.split('@')[0],
    tempPassword,
  })

  return NextResponse.json({ usuario: profile, tempPassword, emailStatus })
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

    const { data: profile } = await admin
      .from('user_profiles')
      .select('email,nombre')
      .eq('id', userId)
      .maybeSingle()

    const emailStatus = profile?.email
      ? await sendWelcomeEmail({
          to: normalizeEmail(profile.email),
          name: profile.nombre || normalizeEmail(profile.email).split('@')[0],
          tempPassword: newPassword,
        })
      : { sent: false, provider: 'none' as const, error: 'No se encontró el correo del usuario.' }

    return NextResponse.json({ ok: true, tempPassword: newPassword, emailStatus })
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
    .select('id, email')
    .eq('id', userId)
    .maybeSingle()

  if (profileLookupError) {
    return NextResponse.json({ error: profileLookupError.message }, { status: 500 })
  }

  if (!profile) {
    return NextResponse.json({ error: 'El usuario no existe.' }, { status: 404 })
  }

  const email = normalizeEmail(profile.email)

  const { error: authDeleteError } = await admin.auth.admin.deleteUser(userId)

  if (authDeleteError) {
    return NextResponse.json({ error: authDeleteError.message }, { status: 500 })
  }

  try {
    await deleteAuthUsersByEmail(admin, email)
  } catch (deleteByEmailError) {
    return NextResponse.json(
      { error: deleteByEmailError instanceof Error ? deleteByEmailError.message : 'No se pudo borrar el usuario Auth por correo.' },
      { status: 500 }
    )
  }

  const { error: profileDeleteError } = await admin
    .from('user_profiles')
    .delete()
    .eq('email', email)

  if (profileDeleteError) {
    return NextResponse.json({ error: profileDeleteError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
