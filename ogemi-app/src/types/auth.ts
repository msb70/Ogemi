export type RolId = string

export type Modulo =
  | 'dashboard'
  | 'facturas'
  | 'presupuestos'
  | 'compras'
  | 'clientes'
  | 'proveedores'
  | 'banco'
  | 'reportes'
  | 'importar'
  | 'usuarios'

export type Accion = 'ver' | 'agregar' | 'editar' | 'borrar'

export interface RolPermiso {
  rol_id: RolId
  modulo: Modulo
  puede_ver: boolean
  puede_agregar: boolean
  puede_editar: boolean
  puede_borrar: boolean
}

export interface UserProfile {
  id: string
  email: string
  nombre: string | null
  avatar_url: string | null
  rol_id: RolId
  activo: boolean
  created_at: string
  updated_at: string
}

export interface UserWithRole extends UserProfile {
  permisos: Record<Modulo, { ver: boolean; agregar: boolean; editar: boolean; borrar: boolean }>
}

export interface RoleRecord {
  id: RolId
  nombre: string
  descripcion: string | null
  es_sistema: boolean
  created_at: string
}
