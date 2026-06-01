'use client'

import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { createClient } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { BancoCuenta, BancoMovimiento } from '@/types'
import { Plus, Building2, TrendingUp, TrendingDown, Calendar, Printer } from 'lucide-react'

type Tab = 'cuentas' | 'movimientos' | 'cierre'

export default function BancoPage() {
  const [tab, setTab] = useState<Tab>('cuentas')
  const [cuentas, setCuentas] = useState<BancoCuenta[]>([])
  const [movimientos, setMovimientos] = useState<BancoMovimiento[]>([])
  const [cuentaSelected, setCuentaSelected] = useState<string>('')
  const [saldos, setSaldos] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  // Cierre de mes
  const [periodoMes, setPeriodoMes] = useState(() => {
    const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [saldoBanco, setSaldoBanco] = useState('')
  const [notasCierre, setNotasCierre] = useState('')

  // Nuevo movimiento
  const [showNuevo, setShowNuevo] = useState(false)
  const [nuevoForm, setNuevoForm] = useState({
    tipo: 'ingreso', concepto: '', monto: '', fecha: new Date().toISOString().split('T')[0],
    referencia: '', cuenta_id: ''
  })

  // Nueva cuenta
  const [showNuevaCuenta, setShowNuevaCuenta] = useState(false)
  const [nuevaCuenta, setNuevaCuenta] = useState({ nombre: '', banco: '', numero_cuenta: '', saldo_inicial: '0' })

  // Recibo de movimiento
  const [reciboMovimiento, setReciboMovimiento] = useState<any | null>(null)

  const supabase = createClient()

  const loadData = useCallback(async () => {
    setLoading(true)
    const { data: cuentasData } = await supabase.from('banco_cuentas').select('*').order('nombre')
    setCuentas(cuentasData || [])

    if (cuentasData && cuentasData.length > 0 && !cuentaSelected) {
      setCuentaSelected(cuentasData[0].id)
    }

    // Calcular saldos via función de DB o manualmente
    const saldosMap: Record<string, number> = {}
    for (const c of (cuentasData || [])) {
      const { data: movs } = await supabase
        .from('banco_movimientos')
        .select('tipo, monto')
        .eq('cuenta_id', c.id)
      const ingresos = movs?.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + m.monto, 0) || 0
      const egresos = movs?.filter(m => m.tipo === 'egreso').reduce((s, m) => s + m.monto, 0) || 0
      saldosMap[c.id] = (c.saldo_inicial || 0) + ingresos - egresos
    }
    setSaldos(saldosMap)
    setLoading(false)
  }, [cuentaSelected])

  const loadMovimientos = useCallback(async () => {
    if (!cuentaSelected) return
    const { data } = await supabase
      .from('banco_movimientos')
      .select('*, facturas(numero_factura, clientes(nombre))')
      .eq('cuenta_id', cuentaSelected)
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100)
    setMovimientos(data || [])
  }, [cuentaSelected])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => { loadMovimientos() }, [loadMovimientos])

  const handleGuardarMovimiento = async () => {
    const cId = nuevoForm.cuenta_id || cuentaSelected
    if (!cId || !nuevoForm.concepto || !nuevoForm.monto) return
    const { data, error } = await supabase.from('banco_movimientos').insert({
      cuenta_id: cId,
      tipo: nuevoForm.tipo,
      concepto: nuevoForm.concepto,
      monto: parseFloat(nuevoForm.monto),
      fecha: nuevoForm.fecha,
      referencia: nuevoForm.referencia || null,
    }).select('*, banco_cuentas(nombre, banco, numero_cuenta)').single()

    setShowNuevo(false)
    const payload = nuevoForm
    setNuevoForm({ tipo: 'ingreso', concepto: '', monto: '', fecha: new Date().toISOString().split('T')[0], referencia: '', cuenta_id: '' })
    loadData()
    loadMovimientos()

    // Mostrar recibo
    if (!error && data) {
      setReciboMovimiento(data)
    }
  }

  const handleCrearCuenta = async () => {
    if (!nuevaCuenta.nombre || !nuevaCuenta.banco) return
    await supabase.from('banco_cuentas').insert({
      ...nuevaCuenta,
      saldo_inicial: parseFloat(nuevaCuenta.saldo_inicial) || 0,
    })
    setShowNuevaCuenta(false)
    setNuevaCuenta({ nombre: '', banco: '', numero_cuenta: '', saldo_inicial: '0' })
    loadData()
  }

  const handleCierreMes = async () => {
    if (!cuentaSelected || !saldoBanco) return
    const saldoSistema = saldos[cuentaSelected] || 0
    await supabase.from('cierre_mes').upsert({
      cuenta_id: cuentaSelected,
      periodo: periodoMes,
      saldo_sistema: saldoSistema,
      saldo_banco: parseFloat(saldoBanco),
      notas: notasCierre || null,
      cerrado: true,
    }, { onConflict: 'cuenta_id,periodo' })
    alert(`Cierre guardado. Diferencia: ${formatCurrency(parseFloat(saldoBanco) - saldoSistema)}`)
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'cuentas', label: 'Cuentas' },
    { key: 'movimientos', label: 'Movimientos' },
    { key: 'cierre', label: 'Cierre de mes' },
  ]

  return (
    <AppLayout>
      <Header
        title="Banco"
        subtitle="Gestión de cuentas bancarias"
        actions={
          <button className="btn-primary flex items-center gap-2" onClick={() => setShowNuevo(true)}>
            <Plus size={16} />
            Nuevo movimiento
          </button>
        }
      />

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 px-6">
        <div className="flex gap-1">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">

        {/* TAB: CUENTAS */}
        {tab === 'cuentas' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button className="btn-secondary flex items-center gap-2" onClick={() => setShowNuevaCuenta(true)}>
                <Plus size={16} />Nueva cuenta
              </button>
            </div>

            {showNuevaCuenta && (
              <div className="card p-4 grid grid-cols-2 gap-3">
                <div><label className="label">Nombre</label><input className="input" value={nuevaCuenta.nombre} onChange={e => setNuevaCuenta(p => ({ ...p, nombre: e.target.value }))} /></div>
                <div><label className="label">Banco</label><input className="input" value={nuevaCuenta.banco} onChange={e => setNuevaCuenta(p => ({ ...p, banco: e.target.value }))} /></div>
                <div><label className="label">N° de cuenta</label><input className="input" value={nuevaCuenta.numero_cuenta} onChange={e => setNuevaCuenta(p => ({ ...p, numero_cuenta: e.target.value }))} /></div>
                <div><label className="label">Saldo inicial (USD)</label><input type="number" className="input" value={nuevaCuenta.saldo_inicial} onChange={e => setNuevaCuenta(p => ({ ...p, saldo_inicial: e.target.value }))} /></div>
                <div className="col-span-2 flex gap-2">
                  <button className="btn-primary" onClick={handleCrearCuenta}>Guardar</button>
                  <button className="btn-secondary" onClick={() => setShowNuevaCuenta(false)}>Cancelar</button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {cuentas.map(c => (
                <div key={c.id} className="card p-5 cursor-pointer hover:border-brand-300 transition-colors"
                  onClick={() => { setCuentaSelected(c.id); setTab('movimientos') }}>
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-10 h-10 bg-brand-100 rounded-xl flex items-center justify-center">
                      <Building2 size={20} className="text-brand-600" />
                    </div>
                    <span className={`badge ${c.activo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {c.activo ? 'Activa' : 'Inactiva'}
                    </span>
                  </div>
                  <h3 className="font-semibold text-gray-900">{c.nombre}</h3>
                  <p className="text-sm text-gray-500">{c.banco}</p>
                  {c.numero_cuenta && <p className="text-xs text-gray-400 mt-0.5">{c.numero_cuenta}</p>}
                  <div className="mt-4 pt-3 border-t border-gray-100">
                    <p className="text-xs text-gray-500">Saldo disponible</p>
                    <p className="text-xl font-bold text-brand-700">{formatCurrency(saldos[c.id] || 0)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB: MOVIMIENTOS */}
        {tab === 'movimientos' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <select
                className="input max-w-xs"
                value={cuentaSelected}
                onChange={e => setCuentaSelected(e.target.value)}
              >
                {cuentas.map(c => (
                  <option key={c.id} value={c.id}>{c.nombre} – {c.banco}</option>
                ))}
              </select>
              {cuentaSelected && (
                <span className="text-sm font-semibold text-brand-700">
                  Saldo: {formatCurrency(saldos[cuentaSelected] || 0)}
                </span>
              )}
            </div>

            <div className="card overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="table-header">Fecha</th>
                    <th className="table-header">Concepto</th>
                    <th className="table-header">Referencia</th>
                    <th className="table-header">Tipo</th>
                    <th className="table-header text-right">Monto</th>
                    <th className="table-header"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {movimientos.length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-10 text-gray-400">Sin movimientos</td></tr>
                  ) : movimientos.map(m => (
                    <tr key={m.id} className="hover:bg-gray-50">
                      <td className="table-cell text-gray-500">{formatDate(m.fecha)}</td>
                      <td className="table-cell">{m.concepto}</td>
                      <td className="table-cell text-gray-400 text-xs">{m.referencia || '—'}</td>
                      <td className="table-cell">
                        <span className={`badge flex items-center gap-1 w-fit ${m.tipo === 'ingreso' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {m.tipo === 'ingreso' ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                          {m.tipo}
                        </span>
                      </td>
                      <td className={`table-cell text-right font-semibold ${m.tipo === 'ingreso' ? 'text-green-700' : 'text-red-600'}`}>
                        {m.tipo === 'egreso' ? '-' : ''}{formatCurrency(m.monto)}
                      </td>
                      <td className="table-cell">
                        <button
                          onClick={() => setReciboMovimiento({ ...m, banco_cuentas: cuentas.find(c => c.id === m.cuenta_id) })}
                          className="text-gray-400 hover:text-brand-600 transition-colors"
                          title="Imprimir recibo"
                        >
                          <Printer size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB: CIERRE DE MES */}
        {tab === 'cierre' && (
          <div className="max-w-lg">
            <div className="card p-6 space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <Calendar size={20} className="text-brand-600" />
                <h2 className="text-base font-semibold">Cierre de mes</h2>
              </div>

              <div>
                <label className="label">Cuenta bancaria</label>
                <select className="input" value={cuentaSelected} onChange={e => setCuentaSelected(e.target.value)}>
                  {cuentas.map(c => (
                    <option key={c.id} value={c.id}>{c.nombre} – {c.banco}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">Período (AAAA-MM)</label>
                <input type="month" className="input" value={periodoMes} onChange={e => setPeriodoMes(e.target.value)} />
              </div>

              {cuentaSelected && (
                <div className="bg-blue-50 rounded-xl p-4">
                  <p className="text-sm text-blue-600 font-medium">Saldo en sistema</p>
                  <p className="text-2xl font-bold text-blue-800">{formatCurrency(saldos[cuentaSelected] || 0)}</p>
                </div>
              )}

              <div>
                <label className="label">Saldo según estado de cuenta del banco (USD)</label>
                <input
                  type="number"
                  step="0.01"
                  className="input"
                  placeholder="0.00"
                  value={saldoBanco}
                  onChange={e => setSaldoBanco(e.target.value)}
                />
              </div>

              {saldoBanco && cuentaSelected && (
                <div className={`rounded-xl p-3 text-sm font-medium ${
                  Math.abs(parseFloat(saldoBanco) - (saldos[cuentaSelected] || 0)) < 0.01
                    ? 'bg-green-50 text-green-700'
                    : 'bg-orange-50 text-orange-700'
                }`}>
                  Diferencia: {formatCurrency(parseFloat(saldoBanco) - (saldos[cuentaSelected] || 0))}
                </div>
              )}

              <div>
                <label className="label">Notas</label>
                <textarea
                  className="input min-h-[80px] resize-y"
                  placeholder="Observaciones del cierre..."
                  value={notasCierre}
                  onChange={e => setNotasCierre(e.target.value)}
                />
              </div>

              <button className="btn-primary w-full" onClick={handleCierreMes} disabled={!saldoBanco || !cuentaSelected}>
                Guardar cierre de mes
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal: Recibo de movimiento bancario */}
      {reciboMovimiento && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 print:hidden">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-base font-semibold">Recibo de movimiento bancario</h2>
            </div>
            <div className="p-6">
              <ReciboMovimiento movimiento={reciboMovimiento} />
            </div>
            <div className="flex gap-3 p-6 pt-0">
              <button className="btn-secondary flex-1" onClick={() => setReciboMovimiento(null)}>Cerrar</button>
              <button className="btn-primary flex-1 flex items-center justify-center gap-2" onClick={() => window.print()}>
                <Printer size={16} />Imprimir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Nuevo movimiento */}
      {showNuevo && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold mb-4">Nuevo movimiento</h2>
            <div className="space-y-3">
              <div>
                <label className="label">Cuenta</label>
                <select className="input" value={nuevoForm.cuenta_id || cuentaSelected} onChange={e => setNuevoForm(p => ({ ...p, cuenta_id: e.target.value }))}>
                  {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre} – {c.banco}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Tipo</label>
                  <select className="input" value={nuevoForm.tipo} onChange={e => setNuevoForm(p => ({ ...p, tipo: e.target.value }))}>
                    <option value="ingreso">Ingreso</option>
                    <option value="egreso">Egreso</option>
                  </select>
                </div>
                <div>
                  <label className="label">Fecha</label>
                  <input type="date" className="input" value={nuevoForm.fecha} onChange={e => setNuevoForm(p => ({ ...p, fecha: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="label">Concepto</label>
                <input className="input" placeholder="Descripción del movimiento" value={nuevoForm.concepto} onChange={e => setNuevoForm(p => ({ ...p, concepto: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Monto (USD)</label>
                  <input type="number" step="0.01" className="input" placeholder="0.00" value={nuevoForm.monto} onChange={e => setNuevoForm(p => ({ ...p, monto: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Referencia</label>
                  <input className="input" placeholder="Cheque, transferencia..." value={nuevoForm.referencia} onChange={e => setNuevoForm(p => ({ ...p, referencia: e.target.value }))} />
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button className="btn-secondary flex-1" onClick={() => setShowNuevo(false)}>Cancelar</button>
              <button className="btn-primary flex-1" onClick={handleGuardarMovimiento} disabled={!nuevoForm.concepto || !nuevoForm.monto}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}

// ============================================================
// Componente: Recibo de movimiento bancario
// ============================================================
function ReciboMovimiento({ movimiento }: { movimiento: any }) {
  const hoy = new Date().toLocaleDateString('es-PA', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const esIngreso = movimiento.tipo === 'ingreso'

  return (
    <div className="font-sans text-gray-900 text-sm">
      <div className="text-center border-b-2 border-gray-900 pb-3 mb-4">
        <h1 className="text-base font-bold uppercase">Ogemi · Impresoras Comerciales</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          Comprobante de {esIngreso ? 'Ingreso' : 'Egreso'} Bancario
        </p>
      </div>

      <div className="flex justify-between text-xs mb-4">
        <div>
          <span className="text-gray-500">Fecha emisión:</span>
          <span className="ml-1 font-medium">{hoy}</span>
        </div>
        <div>
          <span className="text-gray-500">Fecha movimiento:</span>
          <span className="ml-1 font-medium">
            {new Date(movimiento.fecha + 'T00:00:00').toLocaleDateString('es-PA', { day: '2-digit', month: '2-digit', year: 'numeric' })}
          </span>
        </div>
      </div>

      <div className="border border-gray-200 rounded-lg p-3 mb-4 space-y-1.5">
        <div className="flex justify-between">
          <span className="text-gray-500">Cuenta:</span>
          <span className="font-medium">{movimiento.banco_cuentas?.nombre} · {movimiento.banco_cuentas?.banco}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Concepto:</span>
          <span className="font-medium text-right max-w-[220px]">{movimiento.concepto}</span>
        </div>
        {movimiento.referencia && (
          <div className="flex justify-between">
            <span className="text-gray-500">Referencia:</span>
            <span className="font-mono">{movimiento.referencia}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-gray-500">Tipo:</span>
          <span className={`font-semibold ${esIngreso ? 'text-green-700' : 'text-red-600'}`}>
            {esIngreso ? 'INGRESO' : 'EGRESO'}
          </span>
        </div>
      </div>

      <div className={`border-2 rounded-lg p-4 text-center mb-4 ${esIngreso ? 'border-green-600 bg-green-50' : 'border-red-500 bg-red-50'}`}>
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Monto</p>
        <p className={`text-3xl font-bold ${esIngreso ? 'text-green-800' : 'text-red-700'}`}>
          {esIngreso ? '+' : '-'}
          {new Intl.NumberFormat('es-PA', { style: 'currency', currency: 'USD' }).format(movimiento.monto)}
        </p>
      </div>

      <div className="text-center text-xs text-gray-400 border-t border-gray-200 pt-3">
        <p>Comprobante generado por el sistema Ogemi.</p>
      </div>

      <div className="flex justify-between mt-8 pt-4">
        <div className="text-center">
          <div className="border-t border-gray-400 pt-1 w-32 text-xs text-gray-500">Elaborado por</div>
        </div>
        <div className="text-center">
          <div className="border-t border-gray-400 pt-1 w-32 text-xs text-gray-500">Autorizado por</div>
        </div>
      </div>
    </div>
  )
}
