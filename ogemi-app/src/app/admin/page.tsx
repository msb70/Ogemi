'use client'

import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { createClient } from '@/lib/supabase'
import { UserRoleRecord, UserRole } from '@/types'
import { ShieldCheck, UserPlus, Check, X, Pencil } from 'lucide-react'

interface UserWithRole {
  user_id: string
  email: string
  role: UserRole
  puede_ver: boolean
  puede_editar: boolean
  puede_borrar: boolean
  role_id: string
}

const ROLE_LABELS: Record<UserRole, string> = {
  admin:    'Administrador',
  operador: 'Operador',
  lectura:  'Solo lectura',
}

const ROLE_COLORS: Record<UserRole, string> = {
  admin:    'bg-red-100 text-red-700',
  operador: 'bg-brand-100 text-brand-700',
  lectura:  'bg-gray-100 text-gray-600',
}

export default function AdminPage() {
  const [users, setUsers] = useState<UserWithRole[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<{
    role: UserRole; puede_ver: boolean; puede_editar: boolean; puede_borrar: boolean
  }>({ role: 'lectura', puede_ver: true, puede_editar: false, puede_borrar: false })
  const [saving, setSaving] = useState(false)
  const [currentUserRole, setCurrentUserRole] = useState<UserRole | null>(null)

  const supabase = createClient()

  const loadData = useCallback(async () => {
    setLoading(true)

    // Obtener usuario actual
    const { data: { user } } = await supabase.auth.getUser()

    // Obtener roles
    const { data: roles } = await supabase
      .from('user_roles')
      .select('*')
      .order('created_at')

    if (!roles) { setLoading(false); return }

    // Buscar rol del usuario actual
    const myRole = roles.find(r => r.user_id === user?.id)
    setCurrentUserRole(myRole?.role || null)

    // Para obtener emails necesitamos hacer lookup de usuarios
    // En Supabase, los emails de auth.users no son accesibles directamente desde el cliente
    // Se almacena una referencia. Mostraremos el user_id truncado
    const usersWithRole: UserWithRole[] = roles.map(r => ({
      user_id: r.user_id,
      email: r.user_id === user?.id ? (user?.email || r.user_id) : `Usuario ${r.user_id.substring(0, 8)}...`,
      role: r.role as UserRole,
      puede_ver: r.puede_ver,
      puede_editar: r.puede_editar,
      puede_borrar: r.puede_borrar,
      role_id: r.id,
    }))

    setUsers(usersWithRole)
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const startEdit = (u: UserWithRole) => {
    setEditingId(u.role_id)
    setEditForm({ role: u.role, puede_ver: u.puede_ver, puede_editar: u.puede_editar, puede_borrar: u.puede_borrar })
  }

  const handleRoleChange = (role: UserRole) => {
    // Defaults por rol
    const defaults: Record<UserRole, { puede_ver: boolean; puede_editar: boolean; puede_borrar: boolean }> = {
      admin:    { puede_ver: true, puede_editar: true, puede_borrar: true },
      operador: { puede_ver: true, puede_editar: true, puede_borrar: false },
      lectura:  { puede_ver: true, puede_editar: false, puede_borrar: false },
    }
    setEditForm({ role, ...defaults[role] })
  }

  const handleSave = async (roleId: string) => {
    setSaving(true)
    await supabase.from('user_roles').update({
      role: editForm.role,
      puede_ver: editForm.puede_ver,
      puede_editar: editForm.puede_editar,
      puede_borrar: editForm.puede_borrar,
    }).eq('id', roleId)
    setEditingId(null)
    setSaving(false)
    loadData()
  }

  const Checkbox = ({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) => (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <div
        onClick={() => onChange(!checked)}
        className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
          checked ? 'bg-brand-600 border-brand-600' : 'border-gray-300 bg-white'
        }`}
      >
        {checked && <Check size={12} className="text-white" />}
      </div>
      <span className="text-sm text-gray-600">{label}</span>
    </label>
  )

  if (currentUserRole !== 'admin') {
    return (
      <AppLayout>
        <Header title="Administración" />
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center">
            <ShieldCheck size={48} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500">Solo los administradores pueden acceder a esta sección</p>
          </div>
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <Header
        title="Administración"
        subtitle="Gestión de usuarios y permisos"
      />

      <div className="flex-1 overflow-auto p-6 space-y-5">
        {/* Info cómo agregar usuarios */}
        <div className="card p-4 bg-brand-50 border-brand-200">
          <div className="flex items-start gap-3">
            <UserPlus size={18} className="text-brand-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-brand-800">¿Cómo agregar un nuevo usuario?</p>
              <p className="text-sm text-brand-600 mt-0.5">
                1. El usuario debe registrarse en <strong>Supabase Authentication</strong> (o usa la función "Invite user" en el dashboard de Supabase).
                2. Luego ejecuta en Supabase SQL:
              </p>
              <code className="block mt-2 bg-brand-100 rounded-lg px-3 py-2 text-xs text-brand-800 font-mono">
                INSERT INTO user_roles (user_id, role, puede_ver, puede_editar, puede_borrar){'\n'}
                VALUES (&apos;&lt;UUID-DEL-USUARIO&gt;&apos;, &apos;operador&apos;, true, true, false);
              </code>
            </div>
          </div>
        </div>

        {/* Tabla de usuarios */}
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">Usuarios y permisos</h2>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="table-header">Usuario</th>
                <th className="table-header">Rol</th>
                <th className="table-header text-center">Ver</th>
                <th className="table-header text-center">Editar</th>
                <th className="table-header text-center">Borrar</th>
                <th className="table-header">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={6} className="text-center py-10 text-gray-400">Cargando...</td></tr>
              ) : users.map(u => (
                <tr key={u.role_id} className="hover:bg-gray-50">
                  <td className="table-cell">
                    <div>
                      <p className="font-medium text-gray-900">{u.email}</p>
                      <p className="text-xs text-gray-400 font-mono">{u.user_id.substring(0,16)}...</p>
                    </div>
                  </td>

                  {editingId === u.role_id ? (
                    <>
                      <td className="table-cell">
                        <select
                          className="input py-1 text-sm"
                          value={editForm.role}
                          onChange={e => handleRoleChange(e.target.value as UserRole)}
                        >
                          <option value="admin">Administrador</option>
                          <option value="operador">Operador</option>
                          <option value="lectura">Solo lectura</option>
                        </select>
                      </td>
                      <td className="table-cell text-center">
                        <input type="checkbox" checked={editForm.puede_ver}
                          onChange={e => setEditForm(p => ({ ...p, puede_ver: e.target.checked }))}
                          className="w-4 h-4 accent-brand-600" />
                      </td>
                      <td className="table-cell text-center">
                        <input type="checkbox" checked={editForm.puede_editar}
                          onChange={e => setEditForm(p => ({ ...p, puede_editar: e.target.checked }))}
                          className="w-4 h-4 accent-brand-600" />
                      </td>
                      <td className="table-cell text-center">
                        <input type="checkbox" checked={editForm.puede_borrar}
                          onChange={e => setEditForm(p => ({ ...p, puede_borrar: e.target.checked }))}
                          className="w-4 h-4 accent-brand-600" />
                      </td>
                      <td className="table-cell">
                        <div className="flex items-center gap-2">
                          <button onClick={() => handleSave(u.role_id)} disabled={saving}
                            className="text-green-600 hover:text-green-800">
                            <Check size={18} />
                          </button>
                          <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-600">
                            <X size={18} />
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="table-cell">
                        <span className={`badge ${ROLE_COLORS[u.role]}`}>{ROLE_LABELS[u.role]}</span>
                      </td>
                      <td className="table-cell text-center">
                        {u.puede_ver ? <Check size={16} className="text-green-500 mx-auto" /> : <X size={16} className="text-gray-300 mx-auto" />}
                      </td>
                      <td className="table-cell text-center">
                        {u.puede_editar ? <Check size={16} className="text-green-500 mx-auto" /> : <X size={16} className="text-gray-300 mx-auto" />}
                      </td>
                      <td className="table-cell text-center">
                        {u.puede_borrar ? <Check size={16} className="text-green-500 mx-auto" /> : <X size={16} className="text-gray-300 mx-auto" />}
                      </td>
                      <td className="table-cell">
                        <button onClick={() => startEdit(u)}
                          className="text-gray-400 hover:text-brand-600 transition-colors">
                          <Pencil size={15} />
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Resumen de roles */}
        <div className="card p-5">
          <h3 className="font-semibold text-gray-900 mb-3">Descripción de roles</h3>
          <div className="space-y-3">
            {(Object.entries(ROLE_LABELS) as [UserRole, string][]).map(([role, label]) => (
              <div key={role} className="flex items-start gap-3">
                <span className={`badge ${ROLE_COLORS[role]} flex-shrink-0`}>{label}</span>
                <p className="text-sm text-gray-500">
                  {role === 'admin' && 'Acceso total. Puede ver, editar, eliminar y gestionar usuarios y configuración.'}
                  {role === 'operador' && 'Puede ver e importar facturas, gestionar clientes, registrar cobros y movimientos bancarios. No puede eliminar ni administrar usuarios.'}
                  {role === 'lectura' && 'Solo puede consultar información. No puede crear, modificar ni eliminar ningún registro.'}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
