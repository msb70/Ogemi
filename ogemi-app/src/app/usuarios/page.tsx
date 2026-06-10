'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { useAuth } from '@/context/AuthContext'
import { withPagePermission } from '@/components/PermissionGuard'
import { formatDate } from '@/lib/utils'
import { useToast } from '@/hooks/useToast'
import { Toast } from '@/components/Toast'
import {
  Check,
  Copy,
  KeyRound,
  Lock,
  Plus,
  Save,
  Shield,
  Trash2,
  UserCheck,
  UserPlus,
  UserX,
  X,
} from 'lucide-react'
import type { Modulo, RoleRecord, RolPermiso, UserProfile } from '@/types/auth'

interface TempPasswordModal {
  email: string
  password: string
  emailStatus?: {
    sent: boolean
    error?: string
  }
}

function TempPasswordDialog({ email, password, emailStatus, onClose }: TempPasswordModal & { onClose: () => void }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(password).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2 text-brand-700">
            <KeyRound size={18} />
            <h2 className="font-semibold text-sm">Contraseña temporal</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <X size={16} className="text-gray-400" />
          </button>
        </div>

        <p className="text-sm text-gray-500 mb-4">
          Comparte esta contraseña con <span className="font-medium text-gray-700">{email}</span>.
          El usuario deberá cambiarla en su primer inicio de sesión.
        </p>

        <div
          className={`mb-4 rounded-lg border px-3 py-2 text-xs ${
            emailStatus?.sent
              ? 'border-green-200 bg-green-50 text-green-700'
              : 'border-amber-200 bg-amber-50 text-amber-700'
          }`}
        >
          {emailStatus?.sent
            ? 'El correo de bienvenida fue enviado.'
            : emailStatus?.error || 'El correo no fue enviado porque falta configurar el proveedor de email.'}
        </div>

        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mb-4">
          <span className="flex-1 font-mono text-lg font-bold tracking-widest text-gray-800 select-all">
            {password}
          </span>
          <button
            onClick={handleCopy}
            className="p-1.5 rounded hover:bg-gray-200 transition-colors"
            title="Copiar"
          >
            {copied ? <Check size={16} className="text-green-600" /> : <Copy size={16} className="text-gray-500" />}
          </button>
        </div>

        <button
          onClick={onClose}
          className="w-full rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-800 transition-colors"
        >
          Entendido
        </button>
      </div>
    </div>
  )
}

const MODULES: { id: Modulo; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'facturas', label: 'Facturas' },
  { id: 'presupuestos', label: 'Presupuestos' },
  { id: 'compras', label: 'Compras' },
  { id: 'clientes', label: 'Clientes' },
  { id: 'proveedores', label: 'Proveedores' },
  { id: 'banco', label: 'Banco' },
  { id: 'gastos_fijos', label: 'Gastos fijos' },
  { id: 'reportes', label: 'Reportes' },
  { id: 'importar', label: 'Importar' },
  { id: 'usuarios', label: 'Usuarios' },
]

type PermissionDraft = Record<Modulo, {
  puede_ver: boolean
  puede_agregar: boolean
  puede_editar: boolean
  puede_borrar: boolean
}>

const emptyPermissions = (): PermissionDraft =>
  MODULES.reduce((acc, module) => {
    acc[module.id] = {
      puede_ver: false,
      puede_agregar: false,
      puede_editar: false,
      puede_borrar: false,
    }
    return acc
  }, {} as PermissionDraft)

const roleColor = (roleId: string) => {
  if (roleId === 'admin') return 'bg-red-100 text-red-700'
  if (roleId === 'contador') return 'bg-blue-100 text-blue-700'
  if (roleId === 'visor') return 'bg-gray-100 text-gray-600'
  return 'bg-brand-100 text-brand-700'
}

function UsuariosPage() {
  const { profile: myProfile, puedeHacer } = useAuth()
  const { toast, showToast, hideToast } = useToast()
  const [usuarios, setUsuarios] = useState<UserProfile[]>([])
  const [roles, setRoles] = useState<RoleRecord[]>([])
  const [permisos, setPermisos] = useState<RolPermiso[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [deletingUser, setDeletingUser] = useState<string | null>(null)
  const [creatingUser, setCreatingUser] = useState(false)
  const [resettingPassword, setResettingPassword] = useState<string | null>(null)
  const [tempPasswordModal, setTempPasswordModal] = useState<TempPasswordModal | null>(null)
  const [savingRole, setSavingRole] = useState(false)
  const [deletingRole, setDeletingRole] = useState(false)
  const [selectedRoleId, setSelectedRoleId] = useState('')
  const [roleForm, setRoleForm] = useState({ nombre: '', descripcion: '' })
  const [permissionDraft, setPermissionDraft] = useState<PermissionDraft>(emptyPermissions)
  const [newUser, setNewUser] = useState({
    email: '',
    nombre: '',
    rol_id: 'visor',
    activo: true,
  })

  const canAddUsers = puedeHacer('usuarios', 'agregar')
  const canEditUsers = puedeHacer('usuarios', 'editar')
  const canDeleteUsers = puedeHacer('usuarios', 'borrar')

  const roleById = useMemo(() => {
    const map: Record<string, RoleRecord> = {}
    roles.forEach(role => { map[role.id] = role })
    return map
  }, [roles])

  const selectedRole = roleById[selectedRoleId]
  const selectedRoleUserCount = useMemo(
    () => usuarios.filter(user => user.rol_id === selectedRoleId).length,
    [usuarios, selectedRoleId]
  )

  async function fetchJson(url: string, options?: RequestInit) {
    const response = await fetch(url, options)
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(payload.error || 'No se pudo completar la operacion.')
    }
    return payload
  }

  async function loadAll() {
    setLoading(true)
    try {
      const [usersPayload, rolesPayload] = await Promise.all([
        fetchJson('/api/admin/users'),
        fetchJson('/api/admin/roles'),
      ])
      setUsuarios(usersPayload.usuarios || [])
      setRoles(rolesPayload.roles || [])
      setPermisos(rolesPayload.permisos || [])
      const firstRole = rolesPayload.roles?.[0]?.id || ''
      if (!selectedRoleId && firstRole) setSelectedRoleId(firstRole)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudieron cargar usuarios y roles.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAll() }, [])

  useEffect(() => {
    if (!selectedRoleId) return
    if (selectedRoleId === '__new__') {
      setRoleForm({ nombre: '', descripcion: '' })
      setPermissionDraft(emptyPermissions())
      return
    }

    const role = roleById[selectedRoleId]
    setRoleForm({
      nombre: role?.nombre || '',
      descripcion: role?.descripcion || '',
    })

    const next = emptyPermissions()
    permisos
      .filter(permission => permission.rol_id === selectedRoleId)
      .forEach(permission => {
        next[permission.modulo] = {
          puede_ver: permission.puede_ver,
          puede_agregar: permission.puede_agregar,
          puede_editar: permission.puede_editar,
          puede_borrar: permission.puede_borrar,
        }
      })
    setPermissionDraft(next)
  }, [selectedRoleId, roleById, permisos])

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCreatingUser(true)
    try {
      const result = await fetchJson('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser),
      })
      const createdEmail = newUser.email
      setNewUser({ email: '', nombre: '', rol_id: 'visor', activo: true })
      showToast('Usuario creado correctamente.')
      if (result.tempPassword) {
        setTempPasswordModal({
          email: createdEmail,
          password: result.tempPassword,
          emailStatus: result.emailStatus,
        })
      }
      if (result.emailStatus?.sent) {
        showToast('Usuario creado y correo enviado.')
      } else if (result.emailStatus?.error) {
        showToast(`Usuario creado. No se envió el correo: ${result.emailStatus.error}`, 'error')
      }
      await loadAll()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudo crear el usuario.', 'error')
    } finally {
      setCreatingUser(false)
    }
  }

  async function resetPassword(user: UserProfile) {
    setResettingPassword(user.id)
    try {
      const result = await fetchJson('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user.id, reset_password: true }),
      })
      if (result.tempPassword) {
        setTempPasswordModal({
          email: user.email,
          password: result.tempPassword,
          emailStatus: result.emailStatus,
        })
      }
      showToast(result.emailStatus?.sent ? 'Contraseña reseteada y correo enviado.' : 'Contraseña reseteada.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudo resetear la contraseña.', 'error')
    } finally {
      setResettingPassword(null)
    }
  }

  async function updateUser(userId: string, updates: Partial<UserProfile>) {
    setSaving(userId)
    try {
      await fetchJson('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: userId, ...updates }),
      })
      await loadAll()
      showToast('Usuario actualizado.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudo actualizar el usuario.', 'error')
    } finally {
      setSaving(null)
    }
  }

  async function deleteUser(user: UserProfile) {
    if (user.id === myProfile?.id) return
    const ok = window.confirm(`¿Borrar definitivamente el usuario ${user.email}?`)
    if (!ok) return

    setDeletingUser(user.id)
    try {
      await fetchJson(`/api/admin/users?id=${encodeURIComponent(user.id)}`, {
        method: 'DELETE',
      })
      showToast('Usuario borrado.')
      await loadAll()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudo borrar el usuario.', 'error')
    } finally {
      setDeletingUser(null)
    }
  }

  async function saveRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSavingRole(true)
    const isNew = selectedRoleId === '__new__' || !selectedRoleId || !roleById[selectedRoleId]
    const payload = {
      id: isNew ? undefined : selectedRoleId,
      nombre: roleForm.nombre,
      descripcion: roleForm.descripcion,
      permisos: MODULES.map(module => ({ modulo: module.id, ...permissionDraft[module.id] })),
    }

    try {
      const result = await fetchJson('/api/admin/roles', {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      showToast(isNew ? 'Rol creado.' : 'Rol actualizado.')
      await loadAll()
      if (isNew && result.role?.id) setSelectedRoleId(result.role.id)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudo guardar el rol.', 'error')
    } finally {
      setSavingRole(false)
    }
  }

  async function deleteRole() {
    if (!selectedRole || selectedRole.es_sistema) return
    if (selectedRoleUserCount > 0) {
      showToast('No se puede borrar un rol asignado a usuarios.', 'error')
      return
    }

    const ok = window.confirm(`¿Borrar el rol "${selectedRole.nombre}"?`)
    if (!ok) return

    setDeletingRole(true)
    try {
      await fetchJson(`/api/admin/roles?id=${encodeURIComponent(selectedRole.id)}`, {
        method: 'DELETE',
      })
      showToast('Rol borrado.')
      setSelectedRoleId('')
      await loadAll()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No se pudo borrar el rol.', 'error')
    } finally {
      setDeletingRole(false)
    }
  }

  function setPermission(moduleId: Modulo, key: keyof PermissionDraft[Modulo], value: boolean) {
    setPermissionDraft(prev => ({
      ...prev,
      [moduleId]: {
        ...prev[moduleId],
        [key]: value,
      },
    }))
  }

  const getRoleName = (roleId: string) => roleById[roleId]?.nombre || roleId

  return (
    <AppLayout>
      <Header
        title="Usuarios"
        subtitle="Gestión de usuarios, roles y permisos por módulo"
      />

      <div className="p-6 space-y-6">
        <section className="card p-4">
          <div className="flex items-center gap-2 mb-4">
            <UserPlus size={16} className="text-brand-600" />
            <h2 className="text-sm font-semibold text-gray-800">Crear usuario</h2>
          </div>

          <form onSubmit={createUser} className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
            <label>
              <span className="label">Email</span>
              <input
                type="email"
                required
                className="input"
                value={newUser.email}
                onChange={event => setNewUser(prev => ({ ...prev, email: event.target.value }))}
              />
            </label>
            <label>
              <span className="label">Nombre</span>
              <input
                className="input"
                value={newUser.nombre}
                onChange={event => setNewUser(prev => ({ ...prev, nombre: event.target.value }))}
              />
            </label>
            <label>
              <span className="label">Rol</span>
              <select
                className="input"
                value={newUser.rol_id}
                onChange={event => setNewUser(prev => ({ ...prev, rol_id: event.target.value }))}
              >
                {roles.map(role => (
                  <option key={role.id} value={role.id}>{role.nombre}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">Estado</span>
              <select
                className="input"
                value={newUser.activo ? 'activo' : 'inactivo'}
                onChange={event => setNewUser(prev => ({ ...prev, activo: event.target.value === 'activo' }))}
              >
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
              </select>
            </label>
            <button
              type="submit"
              disabled={!canAddUsers || creatingUser}
              className="btn-primary inline-flex items-center justify-center gap-2"
            >
              <Plus size={16} />
              {creatingUser ? 'Creando...' : 'Crear'}
            </button>
          </form>
        </section>

        <section className="card overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
            <Shield size={14} className="text-brand-600" />
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Usuarios registrados - {usuarios.length}
            </p>
          </div>

          {loading ? (
            <div className="p-8 text-center text-sm text-gray-400">Cargando usuarios...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="table-header">Usuario</th>
                    <th className="table-header">Email</th>
                    <th className="table-header">Rol</th>
                    <th className="table-header">Estado</th>
                    <th className="table-header">Registrado</th>
                    <th className="table-header">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {usuarios.map(user => {
                    const isMe = user.id === myProfile?.id
                    const isBusy = saving === user.id || deletingUser === user.id || resettingPassword === user.id
                    return (
                      <tr key={user.id} className={`hover:bg-gray-50 ${!user.activo ? 'opacity-50' : ''}`}>
                        <td className="table-cell">
                          <div className="flex items-center gap-2">
                            {user.avatar_url ? (
                              <img src={user.avatar_url} className="w-7 h-7 rounded-full" alt="" />
                            ) : (
                              <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center text-xs font-bold text-brand-700">
                                {(user.nombre || user.email)[0].toUpperCase()}
                              </div>
                            )}
                            <span className="text-sm font-medium">
                              {user.nombre || '-'}
                              {isMe && <span className="ml-1 text-xs text-gray-400">(tu)</span>}
                            </span>
                          </div>
                        </td>
                        <td className="table-cell text-sm text-gray-500">{user.email}</td>
                        <td className="table-cell">
                          <span className={`badge text-xs font-medium ${roleColor(user.rol_id)}`}>
                            {getRoleName(user.rol_id)}
                          </span>
                        </td>
                        <td className="table-cell">
                          <span className={`badge text-xs ${user.activo ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                            {user.activo ? 'Activo' : 'Inactivo'}
                          </span>
                        </td>
                        <td className="table-cell text-sm text-gray-400">{formatDate(user.created_at)}</td>
                        <td className="table-cell">
                          <div className="flex items-center gap-2">
                            {!isMe && (
                              <select
                                className="input text-xs py-1 max-w-[160px]"
                                value={user.rol_id}
                                disabled={isBusy || !canEditUsers}
                                onChange={event => updateUser(user.id, { rol_id: event.target.value })}
                              >
                                {roles.map(role => (
                                  <option key={role.id} value={role.id}>{role.nombre}</option>
                                ))}
                              </select>
                            )}

                            {!isMe && (
                              <button
                                onClick={() => updateUser(user.id, { activo: !user.activo })}
                                disabled={isBusy || !canDeleteUsers}
                                title={user.activo ? 'Desactivar usuario' : 'Activar usuario'}
                                className={`p-1.5 rounded-lg transition-colors ${
                                  user.activo
                                    ? 'text-red-400 hover:bg-red-50'
                                    : 'text-green-600 hover:bg-green-50'
                                } disabled:opacity-40`}
                              >
                                {user.activo ? <UserX size={15} /> : <UserCheck size={15} />}
                              </button>
                            )}

                            {!isMe && (
                              <button
                                onClick={() => deleteUser(user)}
                                disabled={isBusy || !canDeleteUsers}
                                title="Borrar usuario"
                                className="p-1.5 rounded-lg text-red-600 transition-colors hover:bg-red-50 disabled:opacity-40"
                              >
                                <Trash2 size={15} />
                              </button>
                            )}

                            {!isMe && (
                              <button
                                onClick={() => resetPassword(user)}
                                disabled={isBusy || !canEditUsers}
                                title="Resetear contraseña"
                                className="p-1.5 rounded-lg text-amber-600 transition-colors hover:bg-amber-50 disabled:opacity-40"
                              >
                                <KeyRound size={15} />
                              </button>
                            )}

                            {isMe && (
                              <a
                                href="/auth/cambiar-password"
                                title="Cambiar mi contraseña"
                                className="p-1.5 rounded-lg text-brand-600 transition-colors hover:bg-brand-50"
                              >
                                <Lock size={15} />
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card p-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <Shield size={16} className="text-brand-600" />
              <h2 className="text-sm font-semibold text-gray-800">Roles y permisos por módulo</h2>
            </div>
            <div className="flex items-center gap-2">
              <select
                className="input w-56"
                value={selectedRoleId}
                onChange={event => setSelectedRoleId(event.target.value)}
              >
                {roles.map(role => (
                  <option key={role.id} value={role.id}>{role.nombre}</option>
                ))}
                <option value="__new__">Nuevo rol</option>
              </select>
            </div>
          </div>

          <form onSubmit={saveRole} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label>
                <span className="label">Nombre del rol</span>
                <input
                  required
                  className="input"
                  value={roleForm.nombre}
                  onChange={event => setRoleForm(prev => ({ ...prev, nombre: event.target.value }))}
                />
              </label>
              <label>
                <span className="label">Descripcion</span>
                <input
                  className="input"
                  value={roleForm.descripcion}
                  onChange={event => setRoleForm(prev => ({ ...prev, descripcion: event.target.value }))}
                />
              </label>
            </div>

            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="table-header">Modulo</th>
                    <th className="table-header text-center">Ver</th>
                    <th className="table-header text-center">Agregar</th>
                    <th className="table-header text-center">Editar</th>
                    <th className="table-header text-center">Borrar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {MODULES.map(module => (
                    <tr key={module.id} className="hover:bg-gray-50">
                      <td className="table-cell font-medium">{module.label}</td>
                      {(['puede_ver', 'puede_agregar', 'puede_editar', 'puede_borrar'] as const).map(key => (
                        <td key={key} className="table-cell text-center">
                          <input
                            type="checkbox"
                            checked={permissionDraft[module.id][key]}
                            onChange={event => setPermission(module.id, key, event.target.checked)}
                            className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="submit"
                disabled={!canEditUsers || savingRole || deletingRole}
                className="btn-primary inline-flex items-center justify-center gap-2"
              >
                <Save size={16} />
                {savingRole ? 'Guardando...' : 'Guardar rol'}
              </button>

              {selectedRole && !selectedRole.es_sistema && (
                <button
                  type="button"
                  onClick={deleteRole}
                  disabled={!canDeleteUsers || deletingRole || selectedRoleUserCount > 0}
                  title={selectedRoleUserCount > 0 ? 'No se puede borrar un rol asignado a usuarios' : 'Borrar rol'}
                  className="btn-danger inline-flex items-center justify-center gap-2"
                >
                  <Trash2 size={16} />
                  {deletingRole ? 'Borrando...' : 'Borrar rol'}
                </button>
              )}
            </div>
          </form>
        </section>
      </div>

      {toast && <Toast {...toast} onClose={hideToast} />}

      {tempPasswordModal && (
        <TempPasswordDialog
          email={tempPasswordModal.email}
          password={tempPasswordModal.password}
          onClose={() => setTempPasswordModal(null)}
        />
      )}
    </AppLayout>
  )
}

export default withPagePermission(UsuariosPage, 'usuarios', 'ver')
