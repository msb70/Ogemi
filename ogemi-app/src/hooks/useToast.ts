import { useState, useCallback } from 'react'
import { ToastType } from '@/components/Toast'

interface ToastState {
  message: string
  type: ToastType
}

/**
 * Hook para manejar notificaciones toast dentro de un componente.
 *
 * Uso:
 *   const { toast, showToast, hideToast } = useToast()
 *   // En JSX: {toast && <Toast {...toast} onClose={hideToast} />}
 *   // En handlers: showToast('Factura guardada', 'success')
 *                   showToast('Error al guardar: ' + error.message, 'error')
 */
export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null)

  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    setToast({ message, type })
  }, [])

  const hideToast = useCallback(() => setToast(null), [])

  return { toast, showToast, hideToast }
}
