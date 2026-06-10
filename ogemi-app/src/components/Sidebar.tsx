'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import type { Modulo } from '@/types/auth'
import {
  LayoutDashboard, FileText, Users, Building2,
  BarChart3, Upload, ShieldCheck, LogOut, ChevronRight,
  ShoppingCart, Truck, Wallet, ClipboardList, CalendarClock
} from 'lucide-react'

const navItems: { href: string; label: string; icon: React.ElementType; modulo: Modulo }[] = [
  { href: '/dashboard',    label: 'Dashboard',     icon: LayoutDashboard, modulo: 'dashboard'    },
  { href: '/facturas',     label: 'Facturas',       icon: FileText,        modulo: 'facturas'     },
  { href: '/presupuestos', label: 'Presupuestos',   icon: ClipboardList,   modulo: 'presupuestos' },
  { href: '/clientes',     label: 'Clientes',       icon: Users,           modulo: 'clientes'     },
  { href: '/anticipos',    label: 'Anticipos',      icon: Wallet,          modulo: 'facturas'     },
  { href: '/compras',      label: 'Compras',        icon: ShoppingCart,    modulo: 'compras'      },
  { href: '/proveedores',  label: 'Proveedores',    icon: Truck,           modulo: 'proveedores'  },
  { href: '/banco',        label: 'Banco',          icon: Building2,       modulo: 'banco'        },
  { href: '/gastos-fijos', label: 'Gastos fijos',   icon: CalendarClock,   modulo: 'gastos_fijos' },
  { href: '/reportes',     label: 'Reportes',       icon: BarChart3,       modulo: 'reportes'     },
  { href: '/importar',     label: 'Importar',       icon: Upload,          modulo: 'importar'     },
  { href: '/usuarios',     label: 'Usuarios',       icon: ShieldCheck,     modulo: 'usuarios'     },
]

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  const { profile, puedeHacer, signOut } = useAuth()

  const handleLogout = async () => {
    await signOut()
  }

  const visibleItems = navItems.filter(item => puedeHacer(item.modulo, 'ver'))

  return (
    <aside className="w-64 bg-brand-900 text-white flex flex-col h-full min-h-0 md:min-h-screen">
      {/* Logo */}
      <div className="p-4 border-b border-brand-700">
        <div className="flex items-center gap-3">
          <img
            src="/logo.jpeg"
            alt="Ogemi"
            className="w-10 h-10 object-contain rounded-full bg-white flex-shrink-0"
          />
          <div>
            <p className="font-semibold text-sm leading-tight">Ogemi Impresora</p>
            <p className="text-brand-300 text-xs">Gestión de Cartera</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {visibleItems.map((item) => {
          const Icon = item.icon
          const active = pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
                active
                  ? 'bg-brand-600 text-white'
                  : 'text-brand-200 hover:bg-brand-800 hover:text-white'
              )}
            >
              <Icon size={18} />
              <span className="flex-1">{item.label}</span>
              {active && <ChevronRight size={14} />}
            </Link>
          )
        })}
      </nav>

      {/* Usuario + Logout */}
      <div className="p-3 border-t border-brand-700 space-y-1">
        {profile && (
          <div className="flex items-center gap-2 px-3 py-2">
            {profile.avatar_url ? (
              <img src={profile.avatar_url} className="w-6 h-6 rounded-full" alt="" />
            ) : (
              <div className="w-6 h-6 rounded-full bg-brand-600 flex items-center justify-center text-xs font-bold">
                {(profile.nombre || profile.email)[0].toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-white truncate">{profile.nombre || profile.email}</p>
              <p className="text-[10px] text-brand-400 capitalize">{profile.rol_id}</p>
            </div>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-brand-300 hover:bg-brand-800 hover:text-white transition-all w-full"
        >
          <LogOut size={18} />
          <span>Cerrar sesión</span>
        </button>
      </div>
    </aside>
  )
}
