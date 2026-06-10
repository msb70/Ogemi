import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('es-PA', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount)
}

/** Formatea un objeto Date a DD/MM/YYYY */
export function formatDateObj(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}

/** Formatea un string de fecha (YYYY-MM-DD) a DD/MM/YYYY */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const normalized = dateStr.includes('T') ? dateStr : `${dateStr}T00:00:00`
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return '—'
  return formatDateObj(date)
}

export function classifyTramo(diasVencida: number): string {
  if (diasVencida <= 0) return 'corriente'
  if (diasVencida <= 30) return '1-30'
  if (diasVencida <= 60) return '31-60'
  if (diasVencida <= 90) return '61-90'
  if (diasVencida <= 120) return '91-120'
  return '+120'
}

export function tramoColor(tramo: string): string {
  switch (tramo) {
    case 'corriente': return 'bg-green-100 text-green-800'
    case '1-30': return 'bg-yellow-100 text-yellow-800'
    case '31-60': return 'bg-orange-100 text-orange-800'
    case '61-90': return 'bg-red-100 text-red-800'
    case '91-120': return 'bg-red-200 text-red-900'
    case '+120': return 'bg-rose-300 text-rose-950'
    default: return 'bg-gray-100 text-gray-800'
  }
}
