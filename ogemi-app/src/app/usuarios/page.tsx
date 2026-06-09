'use client'

import { useEffect, useState } from 'react'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { createClient } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { withPagePermission } from '@/components/PermissionGuard'
import { formatDate } from '@/lib/utils'
import { UserCheck, UserX, Shield } from 'lucide-react'
import type { UserProfile } from '@/types/auth'

const ROLES = [
  { id: 'admin',    label: 'Administrador', color: 'bg-red-100 text-red-700' },
  { id: 'contador', label: 'Contador',      color: 'bg-blue-100 text-blue-700' },
  { id: 'visor',    label: 'Solo lectura',  color: 'bg-gray-100 text-gray-600' },
]

function UsuariosPage() {
  const { profile: myProfile } = useAuth()
  const [usuarios, setUsuarios] = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const supabase = createClient()

  async function loadUsuarios() {
    const { data } = await supabase
      .from('user_profiles')
      .select('*')
      .order('created_at', { ascending: true })
    setUsuarios((data as UserProfile[]) || [])
    setLoading(false)
  }

  useEffect(() => { loadUsuarios() }, [])

  async function cambiarRol(userId: string, nuevoRol: string) {
    setSaving(userId)
    await supabase
      .from('user_profiles')
      .update({ rol_id: nuevoRol, updated_at: new Date().toISOString() })
      .eq('id', userId)
    await loadUsuarios()
    setSaving(null)
  }

  async function toggleActivo(userId: string, activo: boolean) {
    setSaving(userId)
    await supabase
      .from('user_profiles')
      .update({ activo: !activo, updated_at: new Date().toISOString() })
      .eq('id', userId)
    await loadUsuarios()
    setSaving(null)
  }

  const getRolMeta = (rolId: string) => ROLES.find(r => r.id === rolId) ?? ROLES[2]

  return (
    <AppLayout>
      <Header
        title="Usuarios"
        subtitle="Gestión de acceso y roles del sistema"
      />

      <div className="p-6">
        <div className="card overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
            <Shield size={14} className="text-brand-600" />
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Usuarios registrados — {usuarios.length}
            </p>
          </div>

          {loading ? (
            <div className="p-8 text-center text-sm text-gray-400">Cargando usuarios...</div>
          ) : (
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
                {usuarios.map(u => {
                  const rolMeta = getRolMeta(u.rol_id)
                  const isMe = u.id === myProfile?.id
                  const isBusy = saving === u.id
                  return (
                    <tr key={u.id} className={`hover:bg-gray-50 ${!u.activo ? 'opacity-50' : ''}`}>
                      <td className="table-cell">
                        <div className="flex items-center gap-2">
                          {u.avatar_url ? (
                            <img src={u.avatar_url} className="w-7 h-7 rounded-full" alt="" />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center text-xs font-bold text-brand-700">
                              {(u.nombre || u.email)[0].toUpperCase()}
                            </div>
                          )}
                          <span className="text-sm font-medium">
                            {u.nombre || '—'}
                            {isMe && <span className="ml-1 text-xs text-gray-400">(tú)</span>}
                          </span>
                        </div>
                      </td>
                      <td className="table-cell text-sm text-gray-500">{u.email}</td>
                      <td className="table-cell">
                        <span className={`badge text-xs font-medium ${rolMeta.color}`}>
                          {rolMeta.label}
                        </span>
                      </td>
                      <td className="table-cell">
                        <span className={`badge text-xs ${u.activo ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                          {u.activo ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td className="table-cell text-sm text-gray-400">{formatDate(u.created_at)}</td>
                      <td className="table-cell">
                        <div className="flex items-center gap-2">
                          {/* Cambiar rol */}
                          {!isMe && (
                            <select
                              className="input text-xs py-1 max-w-[130px]"
                              value={u.rol_id}
                              disabled={isBusy}
                              onChange={e => cambiarRol(u.id, e.target.value)}
                            >
                              {ROLES.map(r => (
                                <option key={r.id} value={r.id}>{r.label}</option>
                              ))}
                            </select>
                          )}

                          {/* Activar / desactivar */}
                          {!isMe && (
                            <button
                              onClick={() => toggleActivo(u.id, u.activo)}
                              disabled={isBusy}
                              title={u.activo ? 'Desactivar usuario' : 'Activar usuario'}
                              className={`p-1.5 rounded-lg transition-colors ${
                                u.activo
                                  ? 'text-red-400 hover:bg-red-50'
                                  : 'text-green-600 hover:bg-green-50'
                              }`}
                            >
                              {u.activo ? <UserX size={15} /> : <UserCheck size={15} />}
                            </button>
                          )}

                          {isMe && (
                            <span className="text-xs text-gray-300 italic">Tu cuenta</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Info de roles */}
        <div className="mt-6 grid grid-cols-3 gap-4">
          {[
            { rol: 'Administrador', desc: 'Acceso total. Ver, agregar, editar y borrar en todos los módulos, incluida la gestión de usuarios.' },
            { rol: 'Contador',      desc: 'Puede ver, agregar y editar en todos los módulos operativos. No puede eliminar registros ni gestionar usuarios.' },
            { rol: 'Solo lectura',  desc: 'Solo puede visualizar datos. Sin acceso a importar ni gestión de usuarios.' },
          ].map(r => (
            <div key={r.rol} className="card p-4">
              <p className="text-sm font-semibold text-gray-700 mb-1">{r.rol}</p>
              <p className="text-xs text-gray-500 leading-relaxed">{r.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  )
}

export default withPagePermission(UsuariosPage, 'usuarios', 'ver')
