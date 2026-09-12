'use client'

import { useEffect, useState } from 'react'
import type { Empresa } from '@/types'

export type EmpresaFiltro = 'all' | Empresa

const KEY = 'ogemi.empresa.filtro'
const OPCIONES: [EmpresaFiltro, string][] = [['all', 'Ambas'], ['ogemi', 'Ogemi'], ['impresos', 'Impresos']]

/** Filtro de empresa (compras) compartido entre Reportes, Flujo de Pago, Dashboard e Informe diario.
 *  Se recuerda en localStorage. Filas sin `empresa` se tratan como Ogemi (histórico). */
export function useEmpresaFiltro(): [EmpresaFiltro, (v: EmpresaFiltro) => void] {
  const [filtro, setFiltro] = useState<EmpresaFiltro>('all')
  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY)
      if (v === 'all' || v === 'ogemi' || v === 'impresos') setFiltro(v)
    } catch { /* noop */ }
  }, [])
  const set = (v: EmpresaFiltro) => {
    setFiltro(v)
    try { localStorage.setItem(KEY, v) } catch { /* noop */ }
  }
  return [filtro, set]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function filtrarEmpresa(rows: any[], filtro: EmpresaFiltro): any[] {
  if (filtro === 'all') return rows
  return rows.filter(r => ((r && r.empresa) || 'ogemi') === filtro)
}

export default function EmpresaFilter({ value, onChange, className = '' }: {
  value: EmpresaFiltro
  onChange: (v: EmpresaFiltro) => void
  className?: string
}) {
  return (
    <div className={`flex items-center gap-2 print:hidden ${className}`} title="Compras de qué empresa se incluyen">
      <span className="text-xs text-gray-500 whitespace-nowrap">Compras:</span>
      <div className="flex rounded-lg border border-gray-200 overflow-hidden">
        {OPCIONES.map(([val, label]) => (
          <button key={val} type="button" onClick={() => onChange(val)}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              value === val ? 'bg-brand-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}>
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
