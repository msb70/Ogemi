import * as XLSX from 'xlsx'

type Cell = string | number | null | undefined
export type XlsxSheet = { name: string; rows: Cell[][] }

/** Exporta un libro de Excel con una o más hojas (cada hoja = matriz de filas). */
export function exportXLSX(filename: string, sheets: XlsxSheet[]): void {
  const wb = XLSX.utils.book_new()
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows.map(r => r.map(c => (c ?? ''))))
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31))
  }
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`)
}

/** Hoja de KPIs (lista de [etiqueta, valor]) con encabezado de reporte y rango. */
export function kpiSheet(titulo: string, rango: string, kpis: [string, Cell][]): XlsxSheet {
  return {
    name: 'KPIs',
    rows: [
      ['Reporte', titulo],
      ['Rango', rango],
      ['Generado', new Date().toLocaleString('es-PA')],
      [],
      ['Indicador', 'Valor'],
      ...kpis.map(([k, v]) => [k, v] as Cell[]),
    ],
  }
}
