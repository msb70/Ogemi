'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import type { Modulo } from '@/types/auth'
import {
  LayoutDashboard, FileText, Users, Building2, Briefcase,
  BarChart3, Upload, ShieldCheck, LogOut, ChevronDown, X,
  ShoppingCart, Truck, Wallet, ClipboardList, CalendarClock, QrCode, CreditCard, WalletCards, Printer
} from 'lucide-react'

type NavLeaf = { kind: 'link'; href: string; label: string; icon: React.ElementType; modulo: Modulo }
type NavGroup = {
  kind: 'group'
  id: string
  label: string
  icon: React.ElementType
  accent: 'sky' | 'amber'
  children: NavLeaf[]
}
type NavEntry = NavLeaf | NavGroup

const link = (href: string, label: string, icon: React.ElementType, modulo: Modulo): NavLeaf =>
  ({ kind: 'link', href, label, icon, modulo })

const navItems: NavEntry[] = [
  link('/dashboard', 'Dashboard', LayoutDashboard, 'dashboard'),
  {
    kind: 'group', id: 'impresos', label: 'Impresos Comerciales', icon: Briefcase, accent: 'sky',
    children: [
      link('/facturas',            'Facturas',            FileText,      'facturas'),
      link('/cobros',              'Cobros',              CreditCard,    'facturas'),
      link('/factura-electronica', 'Factura Electrónica', QrCode,        'factura_electronica'),
      link('/notas-credito',       'Notas de Crédito',    FileText,      'notas_credito'),
      link('/anticipos',           'Anticipos',           Wallet,        'facturas'),
      link('/presupuestos',        'Presupuestos',        ClipboardList, 'presupuestos'),
      link('/cobros-presupuestos', 'Cobro presupuestos',  WalletCards,   'presupuestos'),
      link('/clientes',            'Clientes',            Users,         'clientes'),
    ],
  },
  {
    kind: 'group', id: 'ogemi', label: 'Ogemi', icon: Printer, accent: 'amber',
    children: [
      link('/ventas-ogemi',  'Facturas Ogemi', Printer,      'ventas_ogemi'),
      link('/compras',       'Compras',        ShoppingCart, 'compras'),
      link('/pagos-compras', 'Pago Compras',   WalletCards,  'compras'),
      link('/proveedores',   'Proveedores',    Truck,        'proveedores'),
    ],
  },
  link('/banco',        'Banco',         Building2,     'banco'),
  link('/gastos-fijos', 'Flujo de Pago', CalendarClock, 'gastos_fijos'),
  link('/reportes',     'Reportes',      BarChart3,     'reportes'),
  link('/importar',     'Importar',      Upload,        'importar'),
  link('/usuarios',     'Usuarios',      ShieldCheck,   'usuarios'),
]

const ACCENT = {
  sky: {
    header: 'text-sky-200 hover:bg-sky-900/40',
    headerOpen: 'text-white',
    iconBg: 'bg-sky-500/20 text-sky-300',
    rail: 'bg-sky-400',
    active: 'bg-sky-500 text-white shadow-sm shadow-sky-900/40',
    child: 'text-sky-100/80 hover:bg-sky-900/40 hover:text-white',
    dot: 'bg-sky-400',
  },
  amber: {
    header: 'text-amber-200 hover:bg-amber-900/30',
    headerOpen: 'text-white',
    iconBg: 'bg-amber-500/20 text-amber-300',
    rail: 'bg-amber-400',
    active: 'bg-amber-500 text-brand-900 shadow-sm shadow-amber-900/40',
    child: 'text-amber-100/80 hover:bg-amber-900/30 hover:text-white',
    dot: 'bg-amber-400',
  },
} as const

const STORAGE_KEY = 'ogemi.sidebar.open'

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + '/')
}

export default function Sidebar({ onNavigate, onClose }: { onNavigate?: () => void; onClose?: () => void }) {
  const pathname = usePathname()
  const { profile, puedeHacer, signOut } = useAuth()

  // Filtra por permisos; un grupo se muestra solo si tiene al menos un hijo visible
  const visible = useMemo<NavEntry[]>(() => {
    const out: NavEntry[] = []
    for (const item of navItems) {
      if (item.kind === 'link') {
        if (puedeHacer(item.modulo, 'ver')) out.push(item)
      } else {
        const children = item.children.filter(c => puedeHacer(c.modulo, 'ver'))
        if (children.length) out.push({ ...item, children })
      }
    }
    return out
  }, [puedeHacer])

  // Grupo activo según la ruta
  const activeGroupId = useMemo(() => {
    for (const item of navItems) {
      if (item.kind === 'group' && item.children.some(c => isActive(pathname, c.href))) return item.id
    }
    return null
  }, [pathname])

  const [open, setOpen] = useState<Record<string, boolean>>({})

  // Estado inicial: lo guardado en el navegador + siempre abrir el grupo de la ruta actual
  useEffect(() => {
    let saved: Record<string, boolean> = {}
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) saved = JSON.parse(raw)
    } catch { /* sin storage */ }
    setOpen(prev => ({ ...saved, ...prev, ...(activeGroupId ? { [activeGroupId]: true } : {}) }))
  }, [activeGroupId])

  const toggle = (id: string) => {
    setOpen(prev => {
      const next = { ...prev, [id]: !prev[id] }
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* sin storage */ }
      return next
    })
  }

  const handleLogout = async () => {
    await signOut()
  }

  const leafClass = (active: boolean) => cn(
    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150',
    active ? 'bg-brand-600 text-white' : 'text-brand-200 hover:bg-brand-800 hover:text-white'
  )

  return (
    <aside className="w-72 md:w-64 bg-brand-900 text-white flex flex-col h-full min-h-0 md:min-h-screen">
      {/* Logo */}
      <div className="p-4 border-b border-brand-700 flex items-center gap-3">
        <img
          src="/logo.jpeg"
          alt="Ogemi"
          className="w-10 h-10 object-contain rounded-full bg-white flex-shrink-0"
        />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm leading-tight truncate">Ogemi Impresora</p>
          <p className="text-brand-300 text-xs">Gestión de Cartera</p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Cerrar menú"
            className="md:hidden p-2 -mr-2 rounded-lg text-brand-300 hover:bg-brand-800 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto overscroll-contain">
        {visible.map(item => {
          if (item.kind === 'link') {
            const Icon = item.icon
            const active = isActive(pathname, item.href)
            return (
              <Link key={item.href} href={item.href} onClick={onNavigate} className={leafClass(active)}>
                <Icon size={18} className="flex-shrink-0" />
                <span className="flex-1 truncate">{item.label}</span>
              </Link>
            )
          }

          const a = ACCENT[item.accent as keyof typeof ACCENT]
          const Icon = item.icon
          const isOpen = !!open[item.id]
          const groupActive = activeGroupId === item.id

          return (
            <div key={item.id} className="pt-1">
              <button
                type="button"
                onClick={() => toggle(item.id)}
                aria-expanded={isOpen}
                aria-controls={`nav-group-${item.id}`}
                className={cn(
                  'w-full flex items-center gap-3 px-2 py-2 rounded-lg text-sm font-semibold transition-colors duration-150 select-none',
                  a.header, (isOpen || groupActive) && a.headerOpen
                )}
              >
                <span className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', a.iconBg)}>
                  <Icon size={17} />
                </span>
                <span className="flex-1 text-left truncate">{item.label}</span>
                {!isOpen && groupActive && <span className={cn('w-1.5 h-1.5 rounded-full', a.dot)} />}
                <ChevronDown
                  size={16}
                  className={cn('flex-shrink-0 transition-transform duration-300 ease-out', isOpen && 'rotate-180')}
                />
              </button>

              {/* Panel colapsable: grid-rows 0fr -> 1fr da animación de altura sin medir el DOM */}
              <div
                id={`nav-group-${item.id}`}
                className={cn(
                  'grid transition-[grid-template-rows,opacity] duration-300 ease-out',
                  isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                )}
              >
                <div className="overflow-hidden">
                  <ul className="relative ml-6 mt-1 mb-1 pl-3 space-y-0.5">
                    <span className={cn('absolute left-0 top-1 bottom-1 w-0.5 rounded-full opacity-60', a.rail)} aria-hidden="true" />
                    {item.children.map(child => {
                      const CIcon = child.icon
                      const active = isActive(pathname, child.href)
                      return (
                        <li key={child.href}>
                          <Link
                            href={child.href}
                            onClick={onNavigate}
                            tabIndex={isOpen ? 0 : -1}
                            className={cn(
                              'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150',
                              active ? a.active : cn(a.child, 'hover:translate-x-0.5')
                            )}
                          >
                            <CIcon size={16} className="flex-shrink-0" />
                            <span className="flex-1 truncate">{child.label}</span>
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              </div>
            </div>
          )
        })}
      </nav>

      {/* Usuario + Logout */}
      <div className="p-3 border-t border-brand-700 space-y-1 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
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
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-brand-300 hover:bg-brand-800 hover:text-white transition-colors w-full"
        >
          <LogOut size={18} />
          <span>Cerrar sesión</span>
        </button>
      </div>
    </aside>
  )
}
