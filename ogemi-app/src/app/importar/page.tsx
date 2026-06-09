'use client'

import { useState, useRef } from 'react'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { createClient } from '@/lib/supabase'
import { parseLibroVentas } from '@/lib/excel-parser'
import { formatDateObj } from '@/lib/utils'
import { importarLibroVentas } from '@/lib/services/importar.service'
import { ImportResult, ExcelRow } from '@/types'
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, X, Eye } from 'lucide-react'

export default function ImportarPage() {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ExcelRow[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const supabase = createClient()

  const handleFile = async (f: File) => {
    if (!f.name.endsWith('.xlsx') && !f.name.endsWith('.xls')) {
      setError('Solo se aceptan archivos Excel (.xlsx, .xls)')
      return
    }
    setFile(f)
    setError('')
    setResult(null)

    const buffer = await f.arrayBuffer()
    try {
      const rows = parseLibroVentas(buffer)
      setPreview(rows)
    } catch (e) {
      setError('Error al leer el archivo. Verifica que sea el Libro de Ventas correcto.')
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  const handleImport = async () => {
    if (!preview.length) return
    setImporting(true)
    setError('')

    try {
      const { result: res, dbError } = await importarLibroVentas(supabase, preview)
      if (dbError) {
        setError(dbError)
        setImporting(false)
        return
      }
      setResult(res)
    } catch (e: any) {
      setError('Error durante la importación: ' + e.message)
    }

    setImporting(false)
  }

  const fmt = (n: number) => new Intl.NumberFormat('es-PA', { style: 'currency', currency: 'USD' }).format(n)

  return (
    <AppLayout>
      <Header
        title="Importar Libro de Ventas"
        subtitle="Carga el Excel del libro de ventas para registrar facturas"
      />

      <div className="flex-1 overflow-auto p-6 space-y-5">
        {/* Upload zone */}
        {!file ? (
          <div
            className={`card border-2 border-dashed transition-all p-12 text-center cursor-pointer ${
              dragOver ? 'border-brand-500 bg-brand-50' : 'border-gray-300 hover:border-brand-400 hover:bg-gray-50'
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
          >
            <FileSpreadsheet size={48} className="mx-auto text-gray-300 mb-4" />
            <p className="text-lg font-medium text-gray-700">Arrastra el Libro de Ventas aquí</p>
            <p className="text-sm text-gray-400 mt-1">o haz clic para seleccionar el archivo</p>
            <p className="text-xs text-gray-300 mt-3">Formatos aceptados: .xlsx, .xls</p>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
          </div>
        ) : (
          <div className="card p-4 flex items-center gap-3">
            <FileSpreadsheet size={24} className="text-green-600" />
            <div className="flex-1">
              <p className="font-medium text-gray-900">{file.name}</p>
              <p className="text-sm text-gray-500">
                {preview.length} registros detectados · {(file.size / 1024).toFixed(0)} KB
              </p>
            </div>
            <button onClick={() => { setFile(null); setPreview([]); setResult(null) }}
              className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
            <AlertCircle size={18} className="text-red-600 flex-shrink-0" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Preview */}
        {preview.length > 0 && !result && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Eye size={16} className="text-gray-500" />
                <h3 className="font-medium text-gray-700">Vista previa ({preview.length} registros)</h3>
              </div>
              <button
                className="btn-primary flex items-center gap-2"
                onClick={handleImport}
                disabled={importing}
              >
                {importing ? (
                  <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />Importando...</>
                ) : (
                  <><Upload size={16} />Importar al sistema</>
                )}
              </button>
            </div>

            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="table-header">#</th>
                      <th className="table-header">Fecha</th>
                      <th className="table-header">Tipo</th>
                      <th className="table-header">Doc.</th>
                      <th className="table-header">Doc. Afectado</th>
                      <th className="table-header">Cliente</th>
                      <th className="table-header text-right">Neto</th>
                      <th className="table-header text-right">ITBMS</th>
                      <th className="table-header text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {preview.slice(0, 20).map((row, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="table-cell text-gray-400">{i + 1}</td>
                        <td className="table-cell text-gray-500">
                          {formatDateObj(row.fecha)}
                        </td>
                        <td className="table-cell">
                          <span className={`badge text-xs ${row.tipo_documento.includes('CREDITO') ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                            {row.tipo_documento.includes('CREDITO') ? 'N. CRÉDITO' : 'FACTURA'}
                          </span>
                        </td>
                        <td className="table-cell font-mono">#{row.numero_factura}</td>
                        <td className="table-cell text-gray-400">{row.documento_afectado || '—'}</td>
                        <td className="table-cell max-w-[200px]">
                          <span className="truncate block" title={row.nombre_cliente}>{row.nombre_cliente}</span>
                        </td>
                        <td className="table-cell text-right">{fmt(row.neto)}</td>
                        <td className="table-cell text-right">{fmt(row.impuesto)}</td>
                        <td className="table-cell text-right font-semibold">{fmt(row.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.length > 20 && (
                <div className="px-4 py-2 bg-gray-50 border-t text-center text-xs text-gray-400">
                  Mostrando primeros 20 de {preview.length} registros
                </div>
              )}
            </div>
          </div>
        )}

        {/* Resultado */}
        {result && (
          <div className="card p-6">
            <div className="flex items-center gap-3 mb-5">
              <CheckCircle size={24} className="text-green-600" />
              <h3 className="text-lg font-semibold">Importación completada</h3>
            </div>

            <div className="grid grid-cols-4 gap-4 mb-5">
              {[
                { label: 'Total procesadas', value: result.total, color: 'text-gray-900' },
                { label: 'Importadas', value: result.importadas, color: 'text-green-700' },
                { label: 'Duplicadas (omitidas)', value: result.duplicadas, color: 'text-yellow-700' },
                { label: 'Clientes creados', value: result.clientes_creados, color: 'text-brand-700' },
              ].map(s => (
                <div key={s.label} className="bg-gray-50 rounded-xl p-4 text-center">
                  <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-gray-500 mt-1">{s.label}</p>
                </div>
              ))}
            </div>

            {result.errores.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                <p className="text-sm font-medium text-red-700 mb-2">Errores ({result.errores.length}):</p>
                <ul className="space-y-1">
                  {result.errores.map((e, i) => (
                    <li key={i} className="text-xs text-red-600">• {e}</li>
                  ))}
                </ul>
              </div>
            )}

            <button
              className="btn-secondary mt-4"
              onClick={() => { setFile(null); setPreview([]); setResult(null) }}
            >
              Importar otro archivo
            </button>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
