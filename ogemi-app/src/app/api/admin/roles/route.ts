import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-api'
import type { Modulo } from '@/types/auth'

export const dynamic = 'force-dynamic'

const MODULES: Modulo[] = [
  'dashboard',
  'facturas',
  'presupuestos',
  'compras',
  'clientes',
  'proveedores',
  'banco',
  'gastos_fijos',
  'reportes',
  'importar',
  'usuarios',
]

type PermissionInput = {
  modulo: Modulo
  puede_ver?: boolean
  puede_agregar?: boolean
  puede_editar?: boolean
  puede_borrar?: boolean
}

function slugRoleId(nombre: string) {
  return nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function normalizePermissions(raw: unknown): PermissionInput[] {
  const input = Array.isArray(raw) ? raw : []
  return MODULES.map(modulo => {
    const found = input.find(p => p?.modulo === modulo) || {}
    return {
      modulo,
      puede_ver: found.puede_ver === true,
      puede_agregar: found.puede_agregar === true,
      puede_editar: found.puede_editar === true,
      puede_borrar: found.puede_borrar === true,
    }
  })
}

export async function GET() {
  const { error, admin } = await requireAdmin()
  if (error) return error
  if (!admin) return NextResponse.json({ error: 'No tienes permiso de administrador.' }, { status: 403 })

  const [{ data: roles, error: rolesError }, { data: permisos, error: permisosError }] = await Promise.all([
    admin.from('roles').select('*').order('created_at', { ascending: true }),
    admin.from('rol_permisos').select('*').order('modulo', { ascending: true }),
  ])

  if (rolesError || permisosError) {
    return NextResponse.json(
      { error: rolesError?.message || permisosError?.message || 'No se pudieron cargar los roles.' },
      { status: 500 }
    )
  }

  return NextResponse.json({ roles: roles || [], permisos: permisos || [], modules: MODULES })
}

export async function POST(request: NextRequest) {
  const { error, admin } = await requireAdmin()
  if (error) return error
  if (!admin) return NextResponse.json({ error: 'No tienes permiso de administrador.' }, { status: 403 })

  const body = await request.json().catch(() => null)
  const nombre = typeof body?.nombre === 'string' ? body.nombre.trim() : ''
  const descripcion = typeof body?.descripcion === 'string' ? body.descripcion.trim() : null
  const id = typeof body?.id === 'string' && body.id.trim() ? slugRoleId(body.id) : slugRoleId(nombre)
  const permissions = normalizePermissions(body?.permisos)

  if (!id || !nombre) {
    return NextResponse.json({ error: 'Nombre de rol obligatorio.' }, { status: 400 })
  }

  const { data: role, error: roleError } = await admin
    .from('roles')
    .insert({ id, nombre, descripcion, es_sistema: false })
    .select('*')
    .single()

  if (roleError) {
    return NextResponse.json({ error: roleError.message }, { status: 400 })
  }

  const { error: permsError } = await admin
    .from('rol_permisos')
    .upsert(permissions.map(permission => ({ rol_id: id, ...permission })), {
      onConflict: 'rol_id,modulo',
    })

  if (permsError) {
    return NextResponse.json({ error: permsError.message }, { status: 500 })
  }

  return NextResponse.json({ role })
}

export async function PATCH(request: NextRequest) {
  const { error, admin } = await requireAdmin()
  if (error) return error
  if (!admin) return NextResponse.json({ error: 'No tienes permiso de administrador.' }, { status: 403 })

  const body = await request.json().catch(() => null)
  const id = typeof body?.id === 'string' ? body.id.trim() : ''
  const nombre = typeof body?.nombre === 'string' ? body.nombre.trim() : ''
  const descripcion = typeof body?.descripcion === 'string' ? body.descripcion.trim() : null
  const permissions = normalizePermissions(body?.permisos)

  if (!id || !nombre) {
    return NextResponse.json({ error: 'ID y nombre de rol son obligatorios.' }, { status: 400 })
  }

  const { error: roleError } = await admin
    .from('roles')
    .update({ nombre, descripcion })
    .eq('id', id)

  if (roleError) {
    return NextResponse.json({ error: roleError.message }, { status: 500 })
  }

  const { error: permsError } = await admin
    .from('rol_permisos')
    .upsert(permissions.map(permission => ({ rol_id: id, ...permission })), {
      onConflict: 'rol_id,modulo',
    })

  if (permsError) {
    return NextResponse.json({ error: permsError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest) {
  const { error, admin } = await requireAdmin()
  if (error) return error
  if (!admin) return NextResponse.json({ error: 'No tienes permiso de administrador.' }, { status: 403 })

  const id = request.nextUrl.searchParams.get('id')?.trim() || ''

  if (!id) {
    return NextResponse.json({ error: 'ID de rol obligatorio.' }, { status: 400 })
  }

  const { data: role, error: roleError } = await admin
    .from('roles')
    .select('id, es_sistema')
    .eq('id', id)
    .maybeSingle()

  if (roleError) {
    return NextResponse.json({ error: roleError.message }, { status: 500 })
  }

  if (!role) {
    return NextResponse.json({ error: 'El rol no existe.' }, { status: 404 })
  }

  if (role.es_sistema) {
    return NextResponse.json({ error: 'No se pueden borrar roles del sistema.' }, { status: 400 })
  }

  const { count, error: usersError } = await admin
    .from('user_profiles')
    .select('id', { count: 'exact', head: true })
    .eq('rol_id', id)

  if (usersError) {
    return NextResponse.json({ error: usersError.message }, { status: 500 })
  }

  if ((count || 0) > 0) {
    return NextResponse.json(
      { error: 'No se puede borrar un rol asignado a usuarios.' },
      { status: 400 }
    )
  }

  const { error: deleteError } = await admin
    .from('roles')
    .delete()
    .eq('id', id)

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
