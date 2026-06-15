import * as XLSX from 'xlsx'
import { ExcelRow } from '@/types'

/**
 * =============================================================================
 * FORMATO DE DOCUMENTO ESPERADO EN EL MÓDULO DE IMPORTAR
 * =============================================================================
 * Origen:  Sistema Premium Soft (adm.premium-soft.com)
 * Ruta:    Reportes → Libro de Ventas → Exportar como Excel
 * Archivo: LibroVentas_MMAAAA.xls  (en realidad es HTML con extensión .xls)
 *
 * El archivo NO es un Excel binario real — es HTML exportado por Premium Soft
 * con Content-Type "application/vnd.ms-excel". SheetJS lo puede leer pero
 * hay tres particularidades importantes documentadas abajo.
 * =============================================================================
 *
 * Parsea el Libro de Ventas de IMPRESOS COMERCIALES SA
 * El archivo es HTML disfrazado de .xls (exportado por Premium Soft).
 * SheetJS lo lee correctamente pero la estructura real es:
 *   Fila 0: Encabezado empresa
 *   Fila 1: Headers de grupos (IMPUESTO 7%, IMPUESTO EXENTO)
 *   Fila 2: Headers de columnas
 *   Fila 3+: Datos
 *
 * Columnas reales (0-indexed):
 *   0:  Emision (fecha)
 *   1:  Tipo Doc
 *   2:  No.Doc (número de factura)
 *   3:  Doc.Afectado
 *   4:  Nombre (cliente)
 *   5:  Recargos
 *   6:  Propinas
 *   7:  Neto
 *   8:  Total Final
 *   9:  Retenido
 *   10: Base ITBMS 7%
 *   11: Impuesto ITBMS 7%
 *   12: Base Exento
 *   13: Impuesto Exento
 *
 * PARTICULARIDADES DEL FORMATO (no cambiar sin validar contra el archivo real):
 *   1. DATA_START_ROW = 3: el archivo tiene exactamente 3 filas de encabezado
 *      antes de los datos. Si Premium Soft cambia el layout, este valor cambia.
 *   2. Fechas mixtas: SheetJS parsea las primeras fechas del mes como tipo Date
 *      y el resto como strings "DD/MM/YYYY". Se manejan ambos casos.
 *   3. Números × 100: SheetJS lee "373,10" (decimal europeo con coma) como el
 *      entero 37310. Todos los campos monetarios se dividen entre 100.
 */
/**
 * Parsea un número con formato europeo (punto=miles, coma=decimal) desde una celda SheetJS.
 *
 * Exportada para tests unitarios. La fuente de verdad es cell.w (texto formateado),
 * no cell.v (valor numérico), porque SheetJS introduce ambigüedades:
 *   "1.000,00" → cell.v = 1.0 → Number.isInteger(1.0) === true → BUG si se divide ÷100
 *   "1.000,00" → cell.w = "1.000,00" → normalizar → 1000.00 ✓
 */
export function parseNumeroExcel(cell: XLSX.CellObject | undefined): number {
  if (!cell) return 0
  const rawText = cell.w ?? cell.v?.toString() ?? '0'
  const normalized = rawText
    .replace(/\./g, '')      // quitar puntos de miles: "1.836" → "1836"
    .replace(',', '.')       // coma decimal → punto: "1836,52" → "1836.52"
    .replace(/[^\d.-]/g, '') // limpiar símbolo residual ($, espacios, etc.)
  const result = parseFloat(normalized)
  return isNaN(result) ? 0 : result
}

/**
 * Parsea la celda de fecha del Libro de Ventas a un objeto Date.
 *
 * BUG CRÍTICO QUE RESUELVE (swap día/mes):
 *   El archivo de Premium Soft trae las fechas como texto "DD/MM/YYYY" (europeo).
 *   SheetJS, al leer el HTML, interpreta las fechas ambiguas (día ≤ 12) como
 *   formato gringo MM/DD/YYYY y deja `cell.v` como un Date swapeado:
 *     texto "12/05/2026" (12-may) → cell.v = 2026-12-05 (5-dic)  ❌
 *   PERO `cell.w` SIEMPRE conserva el texto original "12/05/2026".  ✓ (verificado)
 *
 * Por eso parseamos SIEMPRE el texto DD/MM/YYYY desde `cell.w` (o desde `cell.v`
 * si es string). Solo si no hay texto DD/MM/YYYY usable caemos a la
 * interpretación de SheetJS (date serial / Date) como último recurso.
 *
 * Exportada para tests unitarios de regresión.
 */
export function parseFechaCell(cell: XLSX.CellObject | undefined): Date | null {
  if (!cell) return null

  // Fuente de verdad: el texto formateado conserva el orden DD/MM/YYYY original.
  const rawText = (typeof cell.w === 'string'
    ? cell.w
    : (cell.t === 's' && cell.v != null ? String(cell.v) : '')
  ).trim()

  const m = rawText.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) {
    const dd = parseInt(m[1], 10)
    const mm = parseInt(m[2], 10)
    const yyyy = parseInt(m[3], 10)
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      const d = new Date(yyyy, mm - 1, dd)
      return isNaN(d.getTime()) ? null : d
    }
  }

  // Último recurso (no debería ocurrir con este origen): confiar en SheetJS.
  if (cell.t === 'd' && cell.v instanceof Date) {
    return isNaN(cell.v.getTime()) ? null : cell.v
  }
  if (cell.t === 'n') {
    const parsed = XLSX.SSF.parse_date_code(cell.v as number)
    if (parsed) {
      const d = new Date(parsed.y, parsed.m - 1, parsed.d)
      return isNaN(d.getTime()) ? null : d
    }
  }
  return null
}

export function parseLibroVentas(buffer: ArrayBuffer): ExcelRow[] {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]

  // Obtener rango de celdas
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:N100')

  const rows: ExcelRow[] = []

  // Datos empiezan en fila índice 3 (filas 0-2 son encabezados)
  const DATA_START_ROW = 3

  for (let r = DATA_START_ROW; r <= range.e.r; r++) {
    const getCell = (col: number) => {
      const addr = XLSX.utils.encode_cell({ r, c: col })
      return sheet[addr]
    }

    const cellFecha = getCell(0)   // Emision
    const cellTipo  = getCell(1)   // Tipo Doc
    const cellDoc   = getCell(2)   // No.Doc
    const cellAfect = getCell(3)   // Doc.Afectado
    const cellNomb  = getCell(4)   // Nombre
    const cellNeto  = getCell(7)   // Neto
    const cellTotal = getCell(8)   // Total Final
    const cellImp   = getCell(11)  // Impuesto 7% (ITBMS)

    // Saltar filas vacías o filas de totales
    if (!cellFecha || !cellNomb) continue
    const nombreVal = cellNomb.v?.toString() || ''
    if (!nombreVal || nombreVal.startsWith('TOTAL') || nombreVal.startsWith('BASE')) continue

    // Parsear fecha (siempre desde texto DD/MM/YYYY — ver parseFechaCell).
    const fecha = parseFechaCell(cellFecha)
    if (!fecha) continue

    const row: ExcelRow = {
      fecha,
      tipo_documento: cellTipo?.v?.toString().trim() || 'FACTURA DE OPERACION INTERNA',
      numero_factura: cellDoc?.t === 'n' ? Math.abs(cellDoc.v as number) : Math.abs(parseNumeroExcel(cellDoc)),
      documento_afectado: cellAfect && cellAfect.v
        ? Math.abs(cellAfect.t === 'n' ? (cellAfect.v as number) : parseInt(cellAfect.v?.toString() || '0')) || null
        : null,
      nombre_cliente: nombreVal.trim(),
      neto: parseNumeroExcel(cellNeto),
      impuesto: parseNumeroExcel(cellImp),
      total: parseNumeroExcel(cellTotal),
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
