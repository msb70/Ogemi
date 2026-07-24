'use client'

import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/AppLayout'
import Header from '@/components/Header'
import { createClient } from '@/lib/supabase'
import { formatCurrency, formatDate, formatDateObj } from '@/lib/utils'
import { BancoCuenta, BancoMovimiento } from '@/types'
import { Plus, Building2, TrendingUp, TrendingDown, Printer, RefreshCw } from 'lucide-react'
import { Toast } from '@/components/Toast'
import { useToast } from '@/hooks/useToast'
import { withPagePermission } from '@/components/PermissionGuard'
import { useAuth } from '@/context/AuthContext'
import EstadoCuentaTab from './EstadoCuentaTab'
import CierreMesTab from './CierreMesTab'

type Tab = 'cuentas' | 'movimientos' | 'estado' | 'cierre'

function BancoPage() {
  const [tab, setTab] = useState<Tab>('cuentas')
  const [cuentas, setCuentas] = useState<BancoCuenta[]>([])
  const [movimientos, setMovimientos] = useState<BancoMovimiento[]>([])
  const [cuentaSelected, setCuentaSelected] = useState<string>('')
  const [saldos, setSaldos] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

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

  // Reverso de movimiento
  const [reversar, setReversar] = useState<BancoMovimiento | null>(null)
  const [motivoReverso, setMotivoReverso] = useState('')
  const [reversando, setReversando] = useState(false)
  // ids de movimientos originales que ya tienen un contra-movimiento (reversados)
  const [reversados, setReversados] = useState<Set<string>>(new Set())

  const supabase = createClient()
  const { toast, showToast, hideToast } = useToast()
  const { puedeHacer } = useAuth()

  const loadData = useCallback(async () => {
    setLoading(true)
    const { data: cuentasData } = await supabase.from('banco_cuentas').select('*').eq('activo', true).order('nombre')
    setCuentas(cuentasData || [])

    if (cuentasData && cuentasData.length > 0 && !cuentaSelected) {
      setCuentaSelected(cuentasData[0].id)
    }

    // Calcular saldos en paralelo usando la función saldo_cuenta de la DB
    // Promise.all dispara todas las queries simultáneamente en vez de secuencialmente (N+1 → N paralelas)
    const cuentasArr = cuentasData || []
    const saldoResults = await Promise.all(
      cuentasArr.map(c => supabase.rpc('saldo_cuenta', { p_cuenta_id: c.id }))
    )
    const saldosMap: Record<string, number> = {}
    cuentasArr.forEach((c, i) => {
      saldosMap[c.id] = saldoResults[i].data ?? 0
    })
    setSaldos(saldosMap)
    setLoading(false)
  }, [cuentaSelected])

  const loadMovimientos = useCallback(async () => {
    if (!cuentaSelected) return
    const { data } = await supabase
      .from('banco_movimientos')
      .select('*, facturas(numero_factura, clientes(nombre)), compras(proveedores(nombre))')
      .eq('cuenta_id', cuentaSelected)
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100)
    setMovimientos(data || [])

    // Conjunto de movimientos originales que ya fueron reversados (tienen un contra).
    // Se consulta aparte para no depender de que el contra caiga en las 100 filas visibles.
    const { data: revs } = await supabase
      .from('banco_movimientos')
      .select('reverso_de_id')
      .eq('cuenta_id', cuentaSelected)
      .not('reverso_de_id', 'is', null)
    setReversados(new Set((revs || []).map((r: { reverso_de_id: string }) => r.reverso_de_id)))
  }, [cuentaSelected])

  // Un movimiento es "manual" si no proviene de ningún documento/cobro/pago.
  // Solo esos se pueden reversar desde Banco.
  const esManual = (m: BancoMovimiento) =>
    !m.factura_id && !m.compra_id && !m.presupuesto_id && !m.pago_id &&
    !m.pago_reverso_id && !m.anticipo_id && !m.lote_id

  const puedeReversar = puedeHacer('banco', 'editar')

  const handleReversar = async () => {
    if (!reversar || motivoReverso.trim().length < 3) return
    setReversando(true)
    const { error } = await supabase.rpc('reversar_movimiento_banco', {
      p_movimiento_id: reversar.id,
      p_motivo: motivoReverso.trim(),
    })
    setReversando(false)
    if (error) {
      showToast(`No se pudo reversar: ${error.message}`, 'error')
      return
    }
    setReversar(null)
    setMotivoReverso('')
    showToast('Movimiento reversado', 'success')
    loadData()
    loadMovimientos()
  }

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

    if (error) {
      showToast(`Error al guardar movimiento: ${error.message}`, 'error')
      return
    }
    setShowNuevo(false)
    setNuevoForm({ tipo: 'ingreso', concepto: '', monto: '', fecha: new Date().toISOString().split('T')[0], referencia: '', cuenta_id: '' })
    showToast('Movimiento registrado', 'success')
    loadData()
    loadMovimientos()
    if (data) setReciboMovimiento(data)
  }

  const handleCrearCuenta = async () => {
    if (!nuevaCuenta.nombre || !nuevaCuenta.banco) return
    const { error } = await supabase.from('banco_cuentas').insert({
      ...nuevaCuenta,
      saldo_inicial: parseFloat(nuevaCuenta.saldo_inicial) || 0,
    })
    if (error) {
      showToast(`Error al crear cuenta: ${error.message}`, 'error')
    } else {
      setShowNuevaCuenta(false)
      setNuevaCuenta({ nombre: '', banco: '', numero_cuenta: '', saldo_inicial: '0' })
      showToast('Cuenta creada', 'success')
      loadData()
    }
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'cuentas', label: 'Cuentas' },
    { key: 'movimientos', label: 'Movimientos' },
    { key: 'estado', label: 'Estado de cuenta' },
    { key: 'cierre', label: 'Cierre de mes' },
  ]

  // Saldo corrido (acumulado tras cada movimiento). Se ancla en el saldo actual
  // de la cuenta: el movimiento más reciente (primero en la lista, orden desc)
  // queda con el saldo total y, hacia atrás, se descuenta el efecto de cada
  // movimiento más nuevo. Así el resultado es correcto aunque la lista esté
  // truncada a 100 filas.
  const saldosCorridos: number[] = []
  {
    let acc = saldos[cuentaSelected] || 0
    for (let i = 0; i < movimientos.length; i++) {
      saldosCorridos[i] = acc
      const signed = movimientos[i].tipo === 'ingreso' ? Number(movimientos[i].monto) : -Number(movimientos[i].monto)
      acc = acc - signed
    }
  }

  return (
    <AppLayout>
      {toast && <Toast {...toast} onClose={hideToast} />}
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

      <div className="flex-1 overflow-auto p-4 md:p-6">

        {/* TAB: CUENTAS */}
        {tab === 'cuentas' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button className="btn-secondary flex items-center gap-2" onClick={() => setShowNuevaCuenta(true)}>
                <Plus size={16} />Nueva cuenta
              </button>
            </div>

            {showNuevaCuenta && (
              <div className="card p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className="label">Nombre</label><input className="input" value={nuevaCuenta.nombre} onChange={e => setNuevaCuenta(p => ({ ...p, nombre: e.target.value }))} /></div>
                <div><label className="label">Banco</label><input className="input" value={nuevaCuenta.banco} onChange={e => setNuevaCuenta(p => ({ ...p, banco: e.target.value }))} /></div>
                <div><label className="label">N° de cuenta</label><input className="input" value={nuevaCuenta.numero_cuenta} onChange={e => setNuevaCuenta(p => ({ ...p, numero_cuenta: e.target.value }))} /></div>
                <div><label className="label">Saldo inicial</label><input type="number" className="input" value={nuevaCuenta.saldo_inicial} onChange={e => setNuevaCuenta(p => ({ ...p, saldo_inicial: e.target.value }))} /></div>
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
                    <th className="table-header text-right">Saldo</th>
                    <th className="table-header"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {movimientos.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-10 text-gray-400">Sin movimientos</td></tr>
                  ) : movimientos.map((m, i) => (
                    <tr key={m.id} className="hover:bg-gray-50">
                      <td className="table-cell text-gray-500">{formatDate(m.fecha)}</td>
                      <td className="table-cell">
                        <span className="inline-flex items-center gap-1.5">
                          {m.concepto}
                          {m.reverso_de_id && (
                            <span className="badge bg-amber-100 text-amber-700 text-[10px]">Reverso</span>
                          )}
                          {reversados.has(m.id) && (
                            <span className="badge bg-gray-200 text-gray-600 text-[10px]">Reversado</span>
                          )}
                        </span>
                        {(m as any).compras?.proveedores?.nombre && !(m.concepto || '').includes((m as any).compras.proveedores.nombre) && (
                          <span className="block text-xs text-gray-400">Proveedor: {(m as any).compras.proveedores.nombre}</span>
                        )}
                      </td>
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
                      <td className="table-cell text-right font-semibold text-gray-800">
                        {formatCurrency(saldosCorridos[i] ?? 0)}
                      </td>
                      <td className="table-cell">
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => setReciboMovimiento({ ...m, banco_cuentas: cuentas.find(c => c.id === m.cuenta_id) })}
                            className="text-gray-400 hover:text-brand-600 transition-colors"
                            title="Imprimir recibo"
                          >
                            <Printer size={14} />
                          </button>
                          {puedeReversar && esManual(m) && !m.reverso_de_id && !reversados.has(m.id) && (
                            <button
                              onClick={() => { setReversar(m); setMotivoReverso('') }}
                              className="text-gray-400 hover:text-red-600 transition-colors"
                              title="Reversar movimiento"
                            >
                              <RefreshCw size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB: ESTADO DE CUENTA */}
        {tab === 'estado' && (
          <EstadoCuentaTab
            cuentas={cuentas}
            cuentaInicial={cuentaSelected}
            showToast={showToast}
          />
        )}

        {/* TAB: CIERRE DE MES */}
        {tab === 'cierre' && (
          <CierreMesTab
            cuentas={cuentas}
            cuentaInicial={cuentaSelected}
            showToast={showToast}
            onSaved={() => { loadData(); loadMovimientos() }}
          />
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

      {/* Modal: Reversar movimiento */}
      {reversar && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-9 h-9 bg-red-100 rounded-xl flex items-center justify-center">
                <RefreshCw size={18} className="text-red-600" />
              </div>
              <h2 className="text-lg font-semibold">Reversar movimiento</h2>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Se creará un movimiento opuesto por el mismo monto que anula el original. El
              original no se borra: queda el rastro de ambos.
            </p>

            <div className="border border-gray-200 rounded-lg p-3 mb-4 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-500">Concepto</span>
                <span className="font-medium text-right max-w-[240px]">{reversar.concepto}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Tipo</span>
                <span className={`font-semibold ${reversar.tipo === 'ingreso' ? 'text-green-700' : 'text-red-600'}`}>
                  {reversar.tipo}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Monto</span>
                <span className="font-semibold">{formatCurrency(reversar.monto)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Se generará</span>
                <span className="font-semibold">
                  {reversar.tipo === 'ingreso' ? 'un egreso' : 'un ingreso'} de {formatCurrency(reversar.monto)}
                </span>
              </div>
            </div>

            <div>
              <label className="label">Motivo del reverso</label>
              <input
                className="input"
                placeholder="Ej: monto equivocado, cuenta incorrecta..."
                value={motivoReverso}
                onChange={e => setMotivoReverso(e.target.value)}
                autoFocus
              />
            </div>

            <div className="flex gap-3 mt-5">
              <button className="btn-secondary flex-1" onClick={() => { setReversar(null); setMotivoReverso('') }} disabled={reversando}>
                Cancelar
              </button>
              <button
                className="btn-primary flex-1"
                onClick={handleReversar}
                disabled={reversando || motivoReverso.trim().length < 3}
              >
                {reversando ? 'Reversando...' : 'Confirmar reverso'}
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">Monto</label>
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

export default withPagePermission(BancoPage, 'banco', 'ver')

// ============================================================
// Componente: Recibo de movimiento bancario
// ============================================================
function ReciboMovimiento({ movimiento }: { movimiento: any }) {
  const hoy = formatDateObj(new Date())
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
            {formatDate(movimiento.fecha)}
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
          {new Intl.NumberFormat('es-PA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(movimiento.monto)}
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
