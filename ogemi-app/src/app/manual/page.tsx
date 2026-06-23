'use client'

import { useMemo, useState } from 'react'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { useAuth } from '@/context/AuthContext'
import { MANUAL_MODULOS, type ManualModulo } from '@/lib/manual'
import type { Modulo } from '@/types/auth'
import {
  LayoutDashboard, FileText, ClipboardList, ShoppingCart, Users, Truck,
  Wallet, CalendarClock, BarChart3, Upload, Shield, BookOpen, Search,
  Printer, ChevronRight, AlertCircle, type LucideIcon,
} from 'lucide-react'

const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  facturas: FileText,
  presupuestos: ClipboardList,
  compras: ShoppingCart,
  clientes: Users,
  proveedores: Truck,
  banco: Wallet,
  gastos_fijos: CalendarClock,
  reportes: BarChart3,
  importar: Upload,
  usuarios: Shield,
}

function Icono({ id, size = 18, className = '' }: { id: string; size?: number; className?: string }) {
  const Cmp = ICONS[id] || BookOpen
  return <Cmp size={size} className={className} />
}

export default function ManualPage() {
  const { profile, puedeHacer } = useAuth()
  const [activo, setActivo] = useState<string>('')
  const [query, setQuery] = useState('')

  const visibles = useMemo(
    () => MANUAL_MODULOS.filter(m => (profile?.rol_id === 'admin' ? true : puedeHacer(m.id as Modulo, 'ver'))),
    [profile?.rol_id, puedeHacer]
  )

  const q = query.trim().toLowerCase()
  const moduloActivo: ManualModulo | undefined =
    visibles.find(m => m.id === activo) || visibles[0]

  const totalProcesos = useMemo(
    () => visibles.reduce((n, m) => n + m.procesos.length, 0),
    [visibles]
  )

  // Resultados de búsqueda (procesos que coinciden), agrupados por módulo
  const resultados = useMemo(() => {
    if (!q) return []
    return visibles
      .map(m => ({
        modulo: m,
        procesos: m.procesos.filter(pr =>
          pr.titulo.toLowerCase().includes(q) ||
          pr.pasos.some(p => p.toLowerCase().includes(q)) ||
          m.titulo.toLowerCase().includes(q)
        ),
      }))
      .filter(r => r.procesos.length > 0)
  }, [q, visibles])

  const Proceso = ({ pr, n }: { pr: ManualModulo['procesos'][number]; n: number }) => (
    <div className="card p-5">
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-7 h-7 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-sm font-bold">{n}</div>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-gray-900">{pr.titulo}</h4>
          <ol className="mt-2 space-y-1.5 text-sm text-gray-700">
            {pr.pasos.map((p, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-brand-500 font-semibold">{i + 1}.</span>
                <span>{p}</span>
              </li>
            ))}
          </ol>
          {pr.nota && (
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{pr.nota}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <AppLayout>
      <Header
        title="Manual del sistema"
        subtitle="Guía interactiva de los módulos y procesos disponibles para usted"
        actions={
          <button onClick={() => window.print()} className="btn-secondary flex items-center gap-2">
            <Printer size={16} /> Imprimir
          </button>
        }
      />

      <div className="p-4 md:p-6 space-y-5">
        {/* Banner */}
        <div className="rounded-2xl p-5 text-white flex items-center justify-between gap-4" style={{ background: 'linear-gradient(135deg, #0f766e 0%, #115e59 100%)' }}>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <BookOpen size={20} />
              <h2 className="text-lg font-bold">Manual de Ogemi</h2>
            </div>
            <p className="text-white/85 text-sm">
              {visibles.length} módulos · {totalProcesos} procesos disponibles para su rol{profile?.rol_id ? ` (${profile.rol_id})` : ''}.
            </p>
          </div>
          <div className="hidden md:block bg-white/10 rounded-xl px-4 py-3 text-center">
            <p className="text-2xl font-bold">{visibles.length}</p>
            <p className="text-[11px] uppercase tracking-wide text-white/80">módulos</p>
          </div>
        </div>

        {/* Buscador */}
        <div className="relative max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="input pl-9"
            placeholder="Buscar un proceso (ej. cobrar, cerrar mes, crear usuario)..."
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>

        {q ? (
          /* Resultados de búsqueda */
          <div className="space-y-5">
            {resultados.length === 0 ? (
              <p className="text-sm text-gray-400 py-8 text-center">Sin resultados para “{query}”.</p>
            ) : (
              resultados.map(({ modulo, procesos }) => (
                <div key={modulo.id} className="space-y-3">
                  <div className="flex items-center gap-2 text-brand-700">
                    <Icono id={modulo.icono} size={18} />
                    <h3 className="font-semibold">{modulo.titulo}</h3>
                  </div>
                  {procesos.map((pr, i) => <Proceso key={i} pr={pr} n={i + 1} />)}
                </div>
              ))
            )}
          </div>
        ) : (
          /* Navegación por módulos */
          <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-5">
            {/* Sidebar */}
            <nav className="card p-2 h-max lg:sticky lg:top-4">
              {visibles.map(m => {
                const sel = (moduloActivo?.id === m.id)
                return (
                  <button
                    key={m.id}
                    onClick={() => setActivo(m.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${
                      sel ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <Icono id={m.icono} size={18} className={sel ? 'text-brand-600' : 'text-gray-400'} />
                    <span className="flex-1 text-sm font-medium">{m.titulo}</span>
                    <span className="text-[11px] text-gray-400">{m.procesos.length}</span>
                    {sel && <ChevronRight size={14} className="text-brand-500" />}
                  </button>
                )
              })}
            </nav>

            {/* Contenido del módulo */}
            <div className="space-y-4">
              {moduloActivo && (
                <>
                  <div className="card p-5">
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-xl bg-brand-100 text-brand-700 flex items-center justify-center">
                        <Icono id={moduloActivo.icono} size={22} />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-gray-900">{moduloActivo.titulo}</h3>
                        <p className="text-sm text-gray-500">{moduloActivo.resumen}</p>
                      </div>
                    </div>
                  </div>
                  {moduloActivo.procesos.map((pr, i) => <Proceso key={i} pr={pr} n={i + 1} />)}
                </>
              )}
            </div>
          </div>
        )}

        <p className="text-xs text-gray-400 text-center pt-2">
          Impresos Comerciales S.A. · Sistema Ogemi de gestión de cartera.
        </p>
      </div>
    </AppLayout>
  )
}
