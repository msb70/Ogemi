'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, FileText, Users, Building2,
  BarChart3, Upload, ShieldCheck, LogOut, ChevronRight,
  ShoppingCart, Truck
} from 'lucide-react'

const navItems = [
  { href: '/dashboard',   label: 'Dashboard',      icon: LayoutDashboard },
  { href: '/facturas',    label: 'Facturas',        icon: FileText },
  { href: '/clientes',    label: 'Clientes',        icon: Users },
  { href: '/compras',     label: 'Compras',         icon: ShoppingCart },
  { href: '/proveedores', label: 'Proveedores',     icon: Truck },
  { href: '/banco',       label: 'Banco',           icon: Building2 },
  { href: '/reportes',    label: 'Reportes',        icon: BarChart3 },
  { href: '/importar',    label: 'Importar',        icon: Upload },
  { href: '/admin',       label: 'Administración',  icon: ShieldCheck },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className="w-64 bg-brand-900 text-white flex flex-col min-h-screen">
      {/* Logo */}
      <div className="p-5 border-b border-brand-700">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-brand-500 rounded-lg flex items-center justify-center flex-shrink-0">
            <FileText size={18} className="text-white" />
          </div>
          <div>
            <p className="font-semibold text-sm leading-tight">Impresos</p>
            <p className="text-brand-300 text-xs">Comerciales SA</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon
          const active = pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <Link
              key={item.href}
              href={item.href}
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

      {/* Logout */}
      <div className="p-3 border-t border-brand-700">
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
