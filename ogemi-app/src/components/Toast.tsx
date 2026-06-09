'use client'

import { useEffect } from 'react'
import { X, CheckCircle, AlertCircle } from 'lucide-react'

export type ToastType = 'success' | 'error'

interface ToastProps {
  message: string
  type: ToastType
  onClose: () => void
}

/**
 * Toast de notificación — aparece abajo a la derecha, se cierra solo en 4s.
 * Uso: <Toast message="..." type="success|error" onClose={() => setToast(null)} />
 */
export function Toast({ message, type, onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000)
    return () => clearTimeout(timer)
  }, [onClose])

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`fixed bottom-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg text-sm font-medium max-w-sm animate-in fade-in slide-in-from-bottom-2 ${
        type === 'success'
          ? 'bg-green-600 text-white'
          : 'bg-red-600 text-white'
      }`}
    >
      {type === 'success'
        ? <CheckCircle size={16} className="shrink-0" />
        : <AlertCircle size={16} className="shrink-0" />
      }
      <span className="flex-1">{message}</span>
      <button
        onClick={onClose}
        className="ml-1 hover:opacity-75 transition-opacity"
        aria-label="Cerrar notificación"
      >
        <X size={14} />
      </button>
    </div>
  )
}
