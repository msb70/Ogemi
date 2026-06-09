'use client'

import { Search, X } from 'lucide-react'

export interface FiltrosBarProps {
  search: string
  setSearch: (v: string) => void
  fechaDesde: string
  setFechaDesde: (v: string) => void
  fechaHasta: string
  setFechaHasta: (v: string) => void
  showSearch?: boolean
}

export default function FiltrosBar({
  search, setSearch,
  fechaDesde, setFechaDesde,
  fechaHasta, setFechaHasta,
  showSearch = true,
}: FiltrosBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      {showSearch && (
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-8 text-sm py-1.5" placeholder="Buscar..." value={search}
            onChange={e => setSearch(e.target.value)} />
        </div>
      )}
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500">Desde</label>
        <input type="date" className="input text-sm py-1.5 max-w-[140px]" value={fechaDesde}
          onChange={e => setFechaDesde(e.target.value)} />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500">Hasta</label>
        <input type="date" className="input text-sm py-1.5 max-w-[140px]" value={fechaHasta}
          onChange={e => setFechaHasta(e.target.value)} />
      </div>
      {(search || fechaDesde || fechaHasta) && (
        <button className="text-xs text-brand-600 hover:text-brand-800"
          onClick={() => { setSearch(''); setFechaDesde(''); setFechaHasta('') }}>
          <X size={12} className="inline mr-1" />Limpiar
        </button>
      )}
    </div>
  )
}
