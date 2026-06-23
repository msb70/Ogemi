'use client'

import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { useAuth } from '@/context/AuthContext'
import { MANUAL_MODULOS } from '@/lib/manual'
import type { Modulo } from '@/types/auth'
import { BookOpen, Printer } from 'lucide-react'

export default function ManualPage() {
  const { profile, puedeHacer } = useAuth()

  const visibles = MANUAL_MODULOS.filter(m =>
    profile?.rol_id === 'admin' ? true : puedeHacer(m.id as Modulo, 'ver')
  )

  return (
    <AppLayout>
      <Header
        title="Manual del sistema"
        subtitle="Guía paso a paso de los módulos disponibles para usted"
        actions={
          <button onClick={() => window.print()} className="btn-secondary flex items-center gap-2">
            <Printer size={16} /> Imprimir
          </button>
        }
      />

      <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
        <div className="rounded-2xl p-5 text-white" style={{ background: 'linear-gradient(135deg, #0f766e 0%, #115e59 100%)' }}>
          <div className="flex items-center gap-2 mb-1">
            <BookOpen size={20} />
            <h2 className="text-lg font-bold">Bienvenido al manual de Ogemi</h2>
          </div>
          <p className="text-white/85 text-sm">
            Solo verá los módulos que su rol tiene permitidos. Si necesita acceso a otro módulo, contacte al administrador.
          </p>
        </div>

        <div className="card p-5">
          <h3 className="font-semibold text-gray-900 mb-2">Primeros pasos</h3>
          <ol className="list-decimal pl-5 text-sm text-gray-700 space-y-1">
            <li>Ingrese con su correo y la clave temporal que recibió.</li>
            <li>En el primer ingreso el sistema le pedirá cambiar la clave.</li>
            <li>Use el menú lateral para navegar entre los módulos.</li>
          </ol>
        </div>

        {visibles.map(m => (
          <div key={m.id} className="card p-5">
            <h3 className="text-base font-bold text-brand-700 mb-1">{m.titulo}</h3>
            <p className="text-sm text-gray-500 mb-3">{m.resumen}</p>
            <ol className="list-decimal pl-5 text-sm text-gray-800 space-y-1.5">
              {m.pasos.map((p, i) => <li key={i}>{p}</li>)}
            </ol>
          </div>
        ))}

        <p className="text-xs text-gray-400 text-center pt-2">
          Impresos Comerciales S.A. · Sistema Ogemi de gestión de cartera.
        </p>
      </div>
    </AppLayout>
  )
}
