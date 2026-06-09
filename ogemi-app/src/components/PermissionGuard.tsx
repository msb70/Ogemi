'use client'

import { ReactNode } from 'react'
import { useAuth } from '@/context/AuthContext'
import type { Modulo, Accion } from '@/types/auth'
import { ShieldOff } from 'lucide-react'
import AppLayout from './AppLayout'

interface PermissionGuardProps {
  modulo: Modulo
  accion: Accion
  children: ReactNode
  /** Si true, renderiza null en vez del mensaje de acceso denegado */
  silent?: boolean
}

/**
 * Envuelve contenido que requiere un permiso específico.
 * Uso: <PermissionGuard modulo="banco" accion="borrar">
 *        <button>Eliminar</button>
 *      </PermissionGuard>
 */
export default function PermissionGuard({
  modulo,
  accion,
  children,
  silent = false,
}: PermissionGuardProps) {
  const { puedeHacer, loading } = useAuth()

  if (loading) return null
  if (puedeHacer(modulo, accion)) return <>{children}</>
  if (silent) return null

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <ShieldOff size={40} className="text-gray-300 mb-3" />
      <p className="text-sm font-medium text-gray-500">Sin acceso</p>
      <p className="text-xs text-gray-400 mt-1">
        No tienes permiso para {accion} en este módulo.
      </p>
    </div>
  )
}

/**
 * Versión HOC para proteger una página completa.
 * Mantiene el layout visible aunque no tenga acceso.
 */
export function withPagePermission(
  Component: React.ComponentType,
  modulo: Modulo,
  accion: Accion = 'ver'
) {
  return function ProtectedPage(props: object) {
    const { puedeHacer, loading } = useAuth()

    if (loading) {
      return (
        <AppLayout>
          <div className="flex-1 flex items-center justify-center">
            <div className="text-sm text-gray-400">Verificando permisos...</div>
          </div>
        </AppLayout>
      )
    }

    if (!puedeHacer(modulo, accion)) {
      return (
        <AppLayout>
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <ShieldOff size={48} className="text-gray-200 mb-4" />
            <h2 className="text-lg font-semibold text-gray-600">Acceso restringido</h2>
            <p className="text-sm text-gray-400 mt-2">
              Tu rol no tiene permiso para acceder a este módulo.
            </p>
          </div>
        </AppLayout>
      )
    }

    return <Component {...props} />
  }
}
