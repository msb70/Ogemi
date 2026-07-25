// ============================================================
// Tarjetas de crédito: cálculo de corte, fecha de pago y monto a pagar.
//
// Convención de una cuenta tipo 'tarjeta_credito' en banco_movimientos:
//   egreso  = consumo con la tarjeta (aumenta la deuda)
//   ingreso = pago/abono a la tarjeta (reduce la deuda)
// Deuda = egresos − ingresos − saldo_inicial
// (el saldo "bancario" de la cuenta queda negativo mientras se debe).
// ============================================================

export interface MovTarjeta {
  tipo: string
  monto: number
  fecha: string // YYYY-MM-DD
}

export interface CuentaTarjeta {
  id: string
  nombre: string
  banco: string
  saldo_inicial: number | null
  dia_corte: number | null
  dia_pago: number | null
}

export interface ResumenTarjeta {
  cuentaId: string
  nombre: string
  banco: string
  fechaCorte: string        // último corte ocurrido (≤ hoy)
  fechaPago: string         // próxima fecha de pago (posterior al corte)
  saldoAlCorte: number      // deuda del estado de cuenta al corte
  pagosDespuesCorte: number // abonos aplicados después del corte
  aPagar: number            // max(0, saldoAlCorte − pagosDespuesCorte)
  consumosPostCorte: number // consumos después del corte (próximo estado)
  deudaActual: number       // deuda total a hoy
  vencido: boolean          // la fecha de pago ya pasó y aún se debe
}

const toISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Fecha de un mes con el día pedido, ajustado al último día si el mes es más corto (ej. 31 → 28/29 feb). */
function fechaConDia(year: number, monthIdx0: number, dia: number): Date {
  const ultimoDia = new Date(year, monthIdx0 + 1, 0).getDate()
  return new Date(year, monthIdx0, Math.min(dia, ultimoDia))
}

/** Último corte ocurrido: la fecha más reciente con día = diaCorte que sea ≤ hoy. */
export function ultimaFechaCorte(diaCorte: number, hoy: Date = new Date()): string {
  const ref = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())
  let corte = fechaConDia(ref.getFullYear(), ref.getMonth(), diaCorte)
  if (corte.getTime() > ref.getTime()) {
    corte = fechaConDia(ref.getFullYear(), ref.getMonth() - 1, diaCorte)
  }
  return toISO(corte)
}

/** Próxima fecha de pago: la primera fecha con día = diaPago estrictamente posterior al corte. */
export function proximaFechaPago(diaPago: number, fechaCorteISO: string): string {
  const [y, m, d] = fechaCorteISO.split('-').map(Number)
  const corte = new Date(y, m - 1, d)
  let pago = fechaConDia(corte.getFullYear(), corte.getMonth(), diaPago)
  if (pago.getTime() <= corte.getTime()) {
    pago = fechaConDia(corte.getFullYear(), corte.getMonth() + 1, diaPago)
  }
  return toISO(pago)
}

/** Resumen de una tarjeta a partir de sus movimientos (comparación de fechas ISO como texto). */
export function resumenTarjeta(
  cuenta: CuentaTarjeta,
  movimientos: MovTarjeta[],
  hoy: Date = new Date()
): ResumenTarjeta | null {
  if (!cuenta.dia_corte || !cuenta.dia_pago) return null

  const fechaCorte = ultimaFechaCorte(cuenta.dia_corte, hoy)
  const fechaPago = proximaFechaPago(cuenta.dia_pago, fechaCorte)
  const hoyISO = toISO(hoy)

  let egrHastaCorte = 0, ingHastaCorte = 0
  let egrPostCorte = 0, ingPostCorte = 0
  for (const m of movimientos) {
    const monto = Number(m.monto) || 0
    const esEgreso = m.tipo === 'egreso'
    if (m.fecha <= fechaCorte) {
      if (esEgreso) egrHastaCorte += monto
      else ingHastaCorte += monto
    } else {
      if (esEgreso) egrPostCorte += monto
      else ingPostCorte += monto
    }
  }

  const saldoInicial = Number(cuenta.saldo_inicial) || 0
  const saldoAlCorte = egrHastaCorte - ingHastaCorte - saldoInicial
  const pagosDespuesCorte = ingPostCorte
  const aPagar = Math.max(0, saldoAlCorte - pagosDespuesCorte)
  const deudaActual = saldoAlCorte + egrPostCorte - ingPostCorte

  return {
    cuentaId: cuenta.id,
    nombre: cuenta.nombre,
    banco: cuenta.banco,
    fechaCorte,
    fechaPago,
    saldoAlCorte,
    pagosDespuesCorte,
    aPagar,
    consumosPostCorte: egrPostCorte,
    deudaActual,
    vencido: aPagar > 0 && fechaPago < hoyISO,
  }
}
