'use client'

import { useState } from 'react'
import { Menu } from 'lucide-react'
import Sidebar from './Sidebar'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex min-h-screen">
      {/* Sidebar fijo en escritorio */}
      <div className="hidden md:flex md:w-64 md:flex-shrink-0">
        <Sidebar />
      </div>

      {/* Drawer en móvil */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 left-0 w-64 shadow-xl">
            <Sidebar onNavigate={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Barra superior solo en móvil */}
        <div className="md:hidden flex items-center gap-3 bg-brand-900 text-white px-4 py-3 sticky top-0 z-30">
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Abrir menú"
            className="p-1 -ml-1 rounded hover:bg-brand-800"
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
