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

/** Fecha local en formato YYYY-MM-DD (no usar toISOString: corre en UTC). */
const toISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function FiltrosBar({
  search, setSearch,
  fechaDesde, setFechaDesde,
  fechaHasta, setFechaHasta,
  showSearch = true,
}: FiltrosBarProps) {
  // Atajos Hoy / Ayer: marcar pone desde=hasta con esa fecha; desmarcar limpia el rango
  const hoyISO = toISO(new Date())
  const ayerDate = new Date()
  ayerDate.setDate(ayerDate.getDate() - 1)
  const ayerISO = toISO(ayerDate)
  const hoyChecked = fechaDesde === hoyISO && fechaHasta === hoyISO
  const ayerChecked = fechaDesde === ayerISO && fechaHasta === ayerISO
  const setRango = (iso: string, checked: boolean) => {
    setFechaDesde(checked ? iso : '')
    setFechaHasta(checked ? iso : '')
  }

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
      <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
        <input type="checkbox" className="w-4 h-4 accent-brand-600 cursor-pointer"
          checked={hoyChecked} onChange={e => setRango(hoyISO, e.target.checked)} />
        Hoy
      </label>
      <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
        <input type="checkbox" className="w-4 h-4 accent-brand-600 cursor-pointer"
          checked={ayerChecked} onChange={e => setRango(ayerISO, e.target.checked)} />
        Ayer
      </label>
      {(search || fechaDesde || fechaHasta) && (
        <button className="text-xs text-brand-600 hover:text-brand-800"
          onClick={() => { setSearch(''); setFechaDesde(''); setFechaHasta('') }}>
          <X size={12} className="inline mr-1" />Limpiar
        </button>
      )}
    </div>
  )
}
