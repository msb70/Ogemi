import * as XLSX from 'xlsx'
import { ExcelRow } from '@/types'

/**
 * Parsea el Libro de Ventas de IMPRESOS COMERCIALES SA
 * Estructura: headers en fila 7 (índice 6), datos desde fila 8 (índice 7)
 * Columnas relevantes:
 *   A (0): Emision (fecha)
 *   D (3): Tipo Doc
 *   G (6): No.Doc (número de factura)
 *   H (7): Doc.Afectado
 *   I (8): Nombre (cliente)
 *   L (11): Neto (monto)
 *   P (15): Impuesto 7% (ITBMS)
 *   M (12): Total Final
 */
export function parseLibroVentas(buffer: ArrayBuffer): ExcelRow[] {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]

  // Obtener rango de celdas
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:R108')

  const rows: ExcelRow[] = []

  // Datos empiezan en fila 8 (índice 7, base 0)
  const DATA_START_ROW = 7

  for (let r = DATA_START_ROW; r <= range.e.r; r++) {
    const getCell = (col: number) => {
      const addr = XLSX.utils.encode_cell({ r, c: col })
      return sheet[addr]
    }

    const cellFecha = getCell(0)   // A: Emision
    const cellTipo  = getCell(3)   // D: Tipo Doc
    const cellDoc   = getCell(6)   // G: No.Doc
    const cellAfect = getCell(7)   // H: Doc.Afectado
    const cellNomb  = getCell(8)   // I: Nombre
    const cellNeto  = getCell(11)  // L: Neto
    const cellImp   = getCell(15)  // P: Impuesto 7%
    const cellTotal = getCell(12)  // M: Total Final

    // Saltar filas vacías o filas de totales (empiezan con "TOTAL")
    if (!cellFecha || !cellNomb) continue
    const nombreVal = cellNomb.v?.toString() || ''
    if (!nombreVal || nombreVal.startsWith('TOTAL') || nombreVal.startsWith('BASE')) continue

    // Validar que la fecha sea válida
    let fecha: Date
    if (cellFecha.t === 'd') {
      fecha = cellFecha.v as Date
    } else if (cellFecha.t === 'n') {
      const parsed = XLSX.SSF.parse_date_code(cellFecha.v as number)
      fecha = new Date(parsed.y, parsed.m - 1, parsed.d)
    } else {
      continue // saltar si no es fecha válida
    }

    if (!fecha || isNaN(fecha.getTime())) continue

    const parseNumero = (cell: XLSX.CellObject | undefined): number => {
      if (!cell) return 0
      if (typeof cell.v === 'number') return cell.v
      const str = cell.v?.toString().replace(',', '.').replace(/[^\d.-]/g, '') || '0'
      return parseFloat(str) || 0
    }

    const row: ExcelRow = {
      fecha,
      tipo_documento: cellTipo?.v?.toString().trim() || 'FACTURA DE OPERACION INTERNA',
      numero_factura: Math.abs(parseNumero(cellDoc)),
      documento_afectado: cellAfect ? Math.abs(parseNumero(cellAfect)) || null : null,
      nombre_cliente: nombreVal.trim(),
      neto: parseNumero(cellNeto),
      impuesto: parseNumero(cellImp),
      total: parseNumero(cellTotal),
    }

    // Saltar filas sin número de documento
    if (!row.numero_factura) continue

    rows.push(row)
  }

  return rows
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('es-PA', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount)
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('es-PA', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
