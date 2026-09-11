'use client'

import { useEffect, useState } from 'react'
import { Menu } from 'lucide-react'
import Sidebar from './Sidebar'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Bloquea el scroll del fondo y cierra con Escape mientras el drawer está abierto
  useEffect(() => {
    if (!sidebarOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSidebarOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [sidebarOpen])

  const close = () => setSidebarOpen(false)

  return (
    <div className="flex min-h-screen">
      {/* Sidebar fijo en escritorio */}
      <div className="hidden md:flex md:w-64 md:flex-shrink-0">
        <Sidebar />
      </div>

      {/* Drawer en móvil: siempre montado para poder animar entrada/salida */}
      <div
        className={`fixed inset-0 z-40 md:hidden ${sidebarOpen ? '' : 'pointer-events-none'}`}
        aria-hidden={!sidebarOpen}
      >
        <div
          className={`absolute inset-0 bg-black/50 transition-opacity duration-300 ${sidebarOpen ? 'opacity-100' : 'opacity-0'}`}
          onClick={close}
        />
        <div
          className={`absolute inset-y-0 left-0 shadow-2xl transition-transform duration-300 ease-out will-change-transform ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
        >
          <Sidebar onNavigate={close} onClose={close} />
        </div>
      </div>

      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Barra superior solo en móvil */}
        <div className="md:hidden flex items-center gap-3 bg-brand-900 text-white px-4 py-3 sticky top-0 z-30">
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Abrir menú"
            className="p-2 -ml-2 rounded-lg hover:bg-brand-800 active:bg-brand-700 transition-colors"
          >
            <Menu size={22} />
          </button>
          <img src="/logo.jpeg" alt="" className="w-7 h-7 rounded-full bg-white object-contain" />
          <span className="font-semibold text-sm">Ogemi Impresora</span>
        </div>
        {children}
      </main>
    </div>
  )
}
