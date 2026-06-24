import * as XLSX from 'xlsx'

/**
 * Helpers compartidos para exportaciones a Excel.
 *
 * Objetivo:
 *  - Que las columnas de moneda salgan como NÚMERO PURO (sin "US$"/"USD"),
 *    para poder sumarlas en Excel.
 *  - Que las columnas tengan ancho suficiente para leerse sin ajustar a mano.
 */

/**
 * Intenta interpretar un texto como monto/número en formato es-PA
 * ("US$1,234.56", "1,234.56", "-US$10.00", "(50.00)").
 * Devuelve el número o null si el texto NO representa dinero
 * (así no convierte #factura, fechas, referencias, etc.).
 */
function parseMoney(raw: string): number | null {
  const s = raw.trim()
  if (!s) return null
  // Debe tener un marcador de moneda o un patrón dígito-separador-dígito.
  if (!/(US\$|USD|\$|\d[.,]\d)/.test(s)) return null
  // Solo se permiten dígitos, separadores, moneda, signo, paréntesis y espacios.
  if (!/^[(\-]?\s*(US\$|USD|\$)?\s*[\d.,]+\s*\)?$/.test(s)) return null
  const negative = /^\(.*\)$/.test(s) || s.replace(/^\s+/, '').startsWith('-')
  // es-PA: coma = separador de miles, punto = decimal → quitar comas.
  const digits = s.replace(/[^\d.,]/g, '').replace(/,/g, '')
  const n = parseFloat(digits)
  if (Number.isNaN(n)) return null
  return negative ? -Math.abs(n) : n
}

/**
 * Recorre una hoja y convierte las celdas de texto que representan moneda
 * a número con formato contable (#,##0.00). Los números no enteros existentes
 * también reciben formato de 2 decimales.
 */
export function numerizeMoneyCells(ws: XLSX.WorkSheet): void {
  if (!ws['!ref']) return
  const range = XLSX.utils.decode_range(ws['!ref'])
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C })
      const cell = ws[addr]
      if (!cell) continue
      if (cell.t === 'n') {
        if (cell.z == null && typeof cell.v === 'number' && !Number.isInteger(cell.v)) {
          cell.z = '#,##0.00'
        }
        continue
      }
      if (cell.t === 's' && typeof cell.v === 'string') {
        const n = parseMoney(cell.v)
        if (n !== null) {
          cell.t = 'n'
          cell.v = n
          delete cell.w
          cell.z = '#,##0.00'
        }
      }
    }
  }
}

/** Ajusta el ancho de cada columna al contenido más largo (con tope). */
export function autoFitColumns(ws: XLSX.WorkSheet, opts?: { min?: number; max?: number }): void {
  if (!ws['!ref']) return
  const min = opts?.min ?? 9
  const max = opts?.max ?? 60
  const range = XLSX.utils.decode_range(ws['!ref'])
  const cols: { wch: number }[] = []
  for (let C = range.s.c; C <= range.e.c; C++) {
    let w = min
    for (let R = range.s.r; R <= range.e.r; R++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })]
      if (!cell) continue
      let text: string
      if (cell.t === 'n' && typeof cell.v === 'number') {
        const dec = cell.z ? 2 : 0
        text = cell.v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: 2 })
      } else {
        text = cell.w ?? (cell.v != null ? String(cell.v) : '')
      }
      if (text.length + 2 > w) w = text.length + 2
    }
    cols.push({ wch: Math.min(w, max) })
  }
  ws['!cols'] = cols
}

/** Aplica numerización de moneda + auto-ancho a una hoja ya creada. */
export function finalizeSheet(ws: XLSX.WorkSheet): void {
  numerizeMoneyCells(ws)
  autoFitColumns(ws)
}
