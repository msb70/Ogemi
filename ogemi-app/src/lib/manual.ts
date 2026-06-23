// Manual del sistema Ogemi — contenido por módulo y por proceso, filtrable por rol.
// Lo consume la página interactiva /manual y los correos (bienvenida / enviar instrucciones).

export type ManualProceso = {
  titulo: string
  pasos: string[]
  nota?: string
}

export type ManualModulo = {
  id: string
  titulo: string
  icono: string // clave del set de iconos en la página /manual
  resumen: string
  procesos: ManualProceso[]
}

export const MANUAL_MODULOS: ManualModulo[] = [
  {
    id: 'dashboard',
    titulo: 'Dashboard',
    icono: 'dashboard',
    resumen: 'Vista general del negocio: indicadores, gráficos y rankings del periodo.',
    procesos: [
      {
        titulo: 'Leer los indicadores (KPIs)',
        pasos: [
          'Al ingresar, el Dashboard es la pantalla inicial.',
          'En la parte superior verá las tarjetas con ventas, compras, presupuestos y margen del periodo.',
          'Cada tarjeta resume el total acumulado del rango seleccionado.',
        ],
      },
      {
        titulo: 'Cambiar el periodo de análisis',
        pasos: [
          'Use el selector de periodo: mensual, trimestral o anual.',
          'En trimestral puede elegir "Todos" para ver Q1 a Q4 del año en el gráfico.',
          'Todos los indicadores y gráficos se recalculan según el periodo elegido.',
        ],
      },
      {
        titulo: 'Interpretar los Top 10',
        pasos: [
          'Las tablas Top 10 muestran los principales clientes por venta, proveedores por compra y clientes por presupuesto.',
          'Cada fila trae el conteo, el monto y el porcentaje del total del periodo.',
        ],
      },
      {
        titulo: 'Entender el margen',
        pasos: [
          'El margen se calcula como: ventas + presupuestos − compras − notas de crédito.',
          'Junto al margen verá el porcentaje de ganancia del periodo.',
        ],
      },
    ],
  },
  {
    id: 'facturas',
    titulo: 'Facturas',
    icono: 'facturas',
    resumen: 'Registro y cobro de facturas de venta, y control de la cartera por cobrar.',
    procesos: [
      {
        titulo: 'Buscar y filtrar facturas',
        pasos: [
          'Abra el módulo Facturas desde el menú lateral.',
          'Use la barra de búsqueda por número o cliente.',
          'Filtre por estado (pendiente/pagada) y por rango de fechas (desde/hasta).',
          'Los KPIs del módulo reflejan los filtros que tenga activos.',
        ],
      },
      {
        titulo: 'Crear una factura',
        pasos: [
          'Pulse "Nueva factura".',
          'Seleccione el cliente, la fecha y el tipo de documento.',
          'Escriba el monto y el ITBMS; el total se calcula solo.',
          'Guarde: el número de factura se asigna automáticamente.',
        ],
        nota: 'La fecha de pago se calcula sola: fecha de la factura + los días de crédito del cliente.',
      },
      {
        titulo: 'Cobrar una factura (total o por abonos)',
        pasos: [
          'En la fila de la factura pulse "Cobrar".',
          'Indique la fecha de cobro.',
          'Agregue una o varias líneas de cobro (puede combinar cuenta de banco y anticipo).',
          'Confirme: si el cobro completa el total, la factura pasa a "pagada".',
        ],
        nota: 'Cada cobro contra una cuenta de banco genera automáticamente el ingreso en el módulo Banco.',
      },
      {
        titulo: 'Aplicar un anticipo del cliente',
        pasos: [
          'Al cobrar, en la línea elija el origen "anticipo".',
          'Seleccione el anticipo disponible del cliente; el sistema valida que no supere el saldo.',
          'Ese cobro no duplica el ingreso en banco (el anticipo ya entró cuando se registró).',
        ],
      },
      {
        titulo: 'Ver e imprimir una factura',
        pasos: [
          'Pulse "Ver" para abrir el detalle con los pagos registrados.',
          'Use "Imprimir" para generar el documento a página completa con el logo de la empresa.',
        ],
      },
      {
        titulo: 'Reversar un cobro',
        pasos: [
          'Abra el detalle/cobro de la factura.',
          'Pulse "Reversar" e indique el motivo (mínimo 3 caracteres).',
          'Se registra el egreso correspondiente en banco y la factura vuelve a pendiente.',
        ],
        nota: 'Requiere permiso de borrar. Se bloquea si el cobro pertenece a un mes ya cerrado.',
      },
      {
        titulo: 'Exportar a CSV',
        pasos: ['Pulse "Exportar" para descargar la lista filtrada en formato CSV.'],
      },
    ],
  },
  {
    id: 'presupuestos',
    titulo: 'Presupuestos',
    icono: 'presupuestos',
    resumen: 'Presupuestos con orden de trabajo, cobro, edición de cobro y conciliación con banco.',
    procesos: [
      {
        titulo: 'Crear un presupuesto (con Orden de Trabajo)',
        pasos: [
          'Pulse "Nuevo presupuesto".',
          'La Orden de Trabajo se propone con el consecutivo del año (formato AA-NNN, ej. 26-407); puede cambiar el número (solo dígitos).',
          'Seleccione cliente y fecha; escriba monto e ITBMS (el total es la suma).',
          'Guarde: el número de presupuesto es automático.',
        ],
      },
      {
        titulo: 'Editar el monto de un presupuesto',
        pasos: [
          'Pulse "Editar" en la fila del presupuesto.',
          'Cambie el monto u otros datos y guarde.',
          'El estado (pendiente/pagada) se recalcula según lo ya cobrado.',
        ],
      },
      {
        titulo: 'Cobrar un presupuesto',
        pasos: [
          'Pulse "Cobrar".',
          'Registre el cobro contra una cuenta de banco o aplicando un anticipo del cliente.',
          'Al completar el total pasa a "pagada" y se registra el ingreso en banco.',
        ],
      },
      {
        titulo: 'Editar un cobro ya registrado',
        pasos: [
          'Abra "Ver" para listar los cobros.',
          'Pulse "Editar" en el cobro; cambie monto, fecha o cuenta e indique un motivo.',
          'El sistema reversa el cobro anterior y crea el nuevo, dejando historial.',
        ],
        nota: 'Se bloquea si el mes ya fue cerrado.',
      },
      {
        titulo: 'Reversar un cobro',
        pasos: [
          'En "Ver", pulse "Reversar" en el cobro e indique el motivo.',
          'Se genera el egreso en banco y el presupuesto vuelve a pendiente.',
        ],
        nota: 'Se bloquea si el mes ya fue cerrado.',
      },
      {
        titulo: 'Borrar un presupuesto',
        pasos: [
          'Pulse "Borrar" en la fila (requiere permiso).',
          'Confirme: se eliminan también sus cobros y movimientos de banco asociados.',
        ],
        nota: 'No se permite si algún movimiento cae en un mes cerrado.',
      },
      {
        titulo: 'Ver, imprimir y exportar',
        pasos: [
          'Use "Ver" para el detalle imprimible con logo.',
          'Use "Exportar" para descargar la lista en CSV.',
        ],
      },
    ],
  },
  {
    id: 'anticipos',
    titulo: 'Anticipos',
    icono: 'anticipos',
    resumen: 'Depósitos anticipados de clientes y su aplicación a facturas o presupuestos.',
    procesos: [
      {
        titulo: 'Registrar un anticipo',
        pasos: [
          'Abra Anticipos y pulse "Nuevo anticipo".',
          'Seleccione el cliente y la cuenta de banco donde entró el depósito.',
          'Indique el monto y el número de depósito.',
          'Guarde: el anticipo entra automáticamente como ingreso en Banco.',
        ],
      },
      {
        titulo: 'Aplicar un anticipo a una factura o presupuesto',
        pasos: [
          'Al cobrar una factura o presupuesto, en la línea elija el origen "anticipo".',
          'Seleccione el anticipo del cliente; el sistema descuenta del saldo disponible.',
          'No se duplica el ingreso en banco (ya entró al registrar el anticipo).',
        ],
      },
      {
        titulo: 'Ver saldo, aplicaciones e imprimir recibo',
        pasos: [
          'En la lista verá monto, aplicado y saldo de cada anticipo.',
          'Use "Aplicaciones" para ver a qué documentos se aplicó.',
          'Use "Recibo" para imprimir el comprobante con logo.',
        ],
      },
      {
        titulo: 'Anular un anticipo',
        pasos: [
          'Pulse "Anular" en el anticipo.',
          'Se genera el egreso correspondiente en Banco y el anticipo queda anulado.',
        ],
      },
    ],
  },
  {
    id: 'compras',
    titulo: 'Compras',
    icono: 'compras',
    resumen: 'Registro de compras a proveedores, notas de crédito, pagos y control de saldos.',
    procesos: [
      {
        titulo: 'Registrar una compra',
        pasos: [
          'Abra Compras y pulse "Nueva compra".',
          'Seleccione el proveedor y la fecha.',
          'Indique concepto/referencia, monto e ITBMS.',
          'Guarde; el vencimiento se calcula con los días de crédito del proveedor.',
        ],
      },
      {
        titulo: 'Registrar una nota de crédito',
        pasos: [
          'Cree el registro eligiendo el tipo de documento de nota de crédito.',
          'Indique el documento afectado.',
          'Los montos se registran en negativo (espejo de la compra).',
        ],
      },
      {
        titulo: 'Pagar una compra',
        pasos: [
          'Use la acción de pago en la compra.',
          'Indique la cuenta de banco y el monto (total o abono).',
          'Al pagar se genera el egreso en el módulo Banco.',
        ],
      },
      {
        titulo: 'Ver detalle y control de saldos',
        pasos: [
          'El listado muestra columnas de Pagado y Saldo por compra.',
          'Use "Ver" para el detalle con pagos e impresión.',
          'Filtre por fecha/estado y use "Exportar" para CSV.',
        ],
      },
    ],
  },
  {
    id: 'clientes',
    titulo: 'Clientes',
    icono: 'clientes',
    resumen: 'Catálogo de clientes y sus días de crédito.',
    procesos: [
      {
        titulo: 'Crear o editar un cliente',
        pasos: [
          'Abra Clientes.',
          'Cree o edite indicando el nombre y los días de crédito (por defecto 30).',
          'Guarde.',
        ],
      },
      {
        titulo: 'Cómo influyen los días de crédito',
        pasos: [
          'Los días de crédito determinan la fecha de pago de las facturas y presupuestos del cliente.',
          'Cámbielos cuando el acuerdo comercial con el cliente cambie.',
        ],
      },
      {
        titulo: 'Alta automática al importar',
        pasos: [
          'Al importar el libro de ventas, los clientes que no existan se crean automáticamente con 30 días.',
          'Revise luego que no haya nombres duplicados por variantes de escritura.',
        ],
      },
    ],
  },
  {
    id: 'proveedores',
    titulo: 'Proveedores',
    icono: 'proveedores',
    resumen: 'Catálogo de proveedores y sus días de crédito.',
    procesos: [
      {
        titulo: 'Crear o editar un proveedor',
        pasos: [
          'Abra Proveedores.',
          'Cree o edite indicando el nombre y los días de crédito (por defecto 30).',
          'Guarde.',
        ],
      },
      {
        titulo: 'Días de crédito y vencimientos',
        pasos: ['Los días de crédito determinan el vencimiento de las compras de ese proveedor.'],
      },
    ],
  },
  {
    id: 'banco',
    titulo: 'Banco',
    icono: 'banco',
    resumen: 'Cuentas, movimientos, estado de cuenta y cierre de mes con conciliación.',
    procesos: [
      {
        titulo: 'Revisar movimientos y saldo',
        pasos: [
          'Abra Banco y entre a "Movimientos".',
          'Verá ingresos y egresos por cuenta, con saldo corrido.',
          'Los cobros de facturas/presupuestos y pagos de compras llegan aquí automáticamente.',
        ],
      },
      {
        titulo: 'Registrar un ingreso o egreso manual',
        pasos: [
          'En "Movimientos" agregue un movimiento manual.',
          'Elija la cuenta, el tipo (ingreso/egreso), el concepto, el monto y la fecha.',
          'Guarde; el saldo se actualiza.',
        ],
      },
      {
        titulo: 'Consultar el estado de cuenta',
        pasos: [
          'Entre a "Estado de cuenta".',
          'Seleccione la cuenta y el mes para ver el resumen del periodo.',
        ],
      },
      {
        titulo: 'Hacer el cierre de mes',
        pasos: [
          'Entre a "Cierre de mes".',
          'Concilie cada movimiento (uno a uno o "marcar todos").',
          'Revise el saldo conciliado contra el del banco.',
          'Cierre el periodo; el sistema no deja cerrar si no cuadra.',
        ],
        nota: 'Tras cerrar un mes, no se pueden modificar ni borrar movimientos de ese periodo.',
      },
      {
        titulo: 'Reabrir un cierre',
        pasos: [
          'Solo un administrador puede reabrir un mes cerrado.',
          'Hágalo únicamente para corregir errores; queda registrado el evento.',
        ],
      },
    ],
  },
  {
    id: 'gastos_fijos',
    titulo: 'Gastos fijos',
    icono: 'gastos_fijos',
    resumen: 'Catálogo de gastos fijos y sus montos semanales por periodo.',
    procesos: [
      {
        titulo: 'Mantener el catálogo',
        pasos: ['Abra Gastos fijos.', 'Cree o edite los gastos con su nombre y categoría.'],
      },
      {
        titulo: 'Cargar montos por semana',
        pasos: [
          'Para cada periodo (mes), registre el monto de cada gasto por semana.',
          'Esto alimenta el control y la proyección de egresos.',
        ],
      },
    ],
  },
  {
    id: 'reportes',
    titulo: 'Reportes',
    icono: 'reportes',
    resumen: 'Cartera por antigüedad, cuentas por pagar, ventas/compras/presupuestos y flujo de caja.',
    procesos: [
      {
        titulo: 'Cartera por antigüedad',
        pasos: [
          'Abra Reportes y seleccione la cartera de deuda pendiente por cliente.',
          'Verá la deuda clasificada por tramos: corriente, 1-30, 31-60, 61-90, 91-120 y más de 120 días.',
        ],
      },
      {
        titulo: 'Cuentas por pagar por mes',
        pasos: ['Consulte el reporte de compras pendientes agrupadas por mes de vencimiento.'],
      },
      {
        titulo: 'Ventas, compras y presupuestos por contraparte',
        pasos: [
          'Elija el reporte (ventas por cliente, compras por proveedor o presupuestos por cliente).',
          'Aplique el filtro de fechas; verá KPIs y una tabla con % y % acumulado.',
        ],
      },
      {
        titulo: 'Flujo de caja',
        pasos: [
          'Abra el reporte de banco / flujo de caja.',
          'Seleccione rango y cuentas para ver ingresos, egresos y saldo por periodo.',
        ],
      },
    ],
  },
  {
    id: 'importar',
    titulo: 'Importar',
    icono: 'importar',
    resumen: 'Carga masiva del libro de ventas desde Excel.',
    procesos: [
      {
        titulo: 'Preparar el archivo',
        pasos: [
          'Tenga el Excel del libro de ventas con: factura, fecha, cliente, tipo de documento, documento afectado, monto e ITBMS.',
        ],
      },
      {
        titulo: 'Importar el libro de ventas',
        pasos: [
          'Abra Importar y cargue el archivo.',
          'El sistema lee cada fila y crea las facturas.',
          'Los clientes que no existan se crean automáticamente; cada factura recibe su fecha de pago.',
        ],
      },
      {
        titulo: 'Verificar resultados',
        pasos: ['Revise el resumen de la importación antes de continuar y valide totales.'],
      },
    ],
  },
  {
    id: 'usuarios',
    titulo: 'Usuarios',
    icono: 'usuarios',
    resumen: 'Gestión de usuarios, roles y permisos por módulo (solo administradores).',
    procesos: [
      {
        titulo: 'Crear un usuario',
        pasos: [
          'Abra Usuarios e indique correo, nombre y rol.',
          'Pulse "Crear": el sistema genera una clave temporal y envía el correo de bienvenida.',
          'El usuario deberá cambiar la clave en su primer ingreso.',
        ],
      },
      {
        titulo: 'Enviar instrucciones (manual)',
        pasos: [
          'En la fila del usuario pulse el botón de "Enviar instrucciones".',
          'Le llega un correo con el manual del sistema según su rol.',
        ],
      },
      {
        titulo: 'Resetear la contraseña',
        pasos: [
          'Pulse el botón de la llave en la fila del usuario.',
          'Se genera una nueva clave temporal y se envía por correo con el paso a paso para cambiarla.',
        ],
      },
      {
        titulo: 'Activar, desactivar o borrar',
        pasos: [
          'Use los botones de la fila para activar/desactivar o borrar un usuario.',
          'No puede desactivar ni borrar su propio usuario.',
        ],
      },
      {
        titulo: 'Definir roles y permisos',
        pasos: [
          'En "Roles y permisos" elija un rol o cree uno nuevo.',
          'Marque por módulo si puede Ver, Agregar, Editar y Borrar.',
          'Guarde; cada usuario solo verá los módulos permitidos a su rol.',
        ],
      },
    ],
  },
]

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function filtrarModulos(modulosVisibles?: string[]): ManualModulo[] {
  if (!modulosVisibles || modulosVisibles.length === 0) return MANUAL_MODULOS
  const set = new Set(modulosVisibles)
  return MANUAL_MODULOS.filter(m => set.has(m.id))
}

type ManualOpts = { nombre?: string; rolNombre?: string; modulosVisibles?: string[] }

// Bloque HTML del manual para incrustar dentro de un correo.
export function buildManualHtml({ nombre, rolNombre, modulosVisibles }: ManualOpts = {}): string {
  const modulos = filtrarModulos(modulosVisibles)
  const saludo = nombre ? `<p style="margin:0 0 12px;">Hola ${escapeHtml(nombre)}, este es el manual del sistema Ogemi.</p>` : ''
  const rolLinea = rolNombre
    ? `<p style="margin:0 0 12px; color:#374151;">Su rol es <strong>${escapeHtml(rolNombre)}</strong>. A continuación se describen los módulos disponibles para usted.</p>`
    : ''

  const secciones = modulos.map(m => {
    const procesos = m.procesos.map(pr => {
      const pasos = pr.pasos.map(p => `<li style="margin-bottom:4px;">${escapeHtml(p)}</li>`).join('')
      const nota = pr.nota ? `<p style="margin:4px 0 0; font-size:12px; color:#0f766e;">Nota: ${escapeHtml(pr.nota)}</p>` : ''
      return `<div style="margin:0 0 10px;"><p style="margin:0 0 4px; font-weight:bold; color:#374151;">${escapeHtml(pr.titulo)}</p><ol style="margin:0; padding-left:18px; color:#1f2937; font-size:14px;">${pasos}</ol>${nota}</div>`
    }).join('')
    return `
      <div style="margin:0 0 20px;">
        <h3 style="font-size:16px; margin:0 0 4px; color:#0f766e;">${escapeHtml(m.titulo)}</h3>
        <p style="margin:0 0 8px; color:#6b7280; font-size:13px;">${escapeHtml(m.resumen)}</p>
        ${procesos}
      </div>`
  }).join('')

  return `
    <div style="font-family: Arial, sans-serif; color:#1f2937; line-height:1.5; max-width:620px;">
      <h2 style="font-size:20px; margin:0 0 12px;">Manual del sistema Ogemi</h2>
      ${saludo}
      ${rolLinea}
      ${secciones}
      <p style="font-size:12px; color:#6b7280; margin-top:18px;">Impresos Comerciales S.A. · Sistema Ogemi de gestión de cartera.</p>
    </div>`
}

// Versión texto plano (fallback del correo).
export function buildManualText({ nombre, rolNombre, modulosVisibles }: ManualOpts = {}): string {
  const modulos = filtrarModulos(modulosVisibles)
  const lineas: string[] = ['MANUAL DEL SISTEMA OGEMI', '']
  if (nombre) lineas.push(`Hola ${nombre},`, '')
  if (rolNombre) lineas.push(`Su rol: ${rolNombre}`, '')
  for (const m of modulos) {
    lineas.push(`== ${m.titulo} ==`, m.resumen)
    for (const pr of m.procesos) {
      lineas.push(`- ${pr.titulo}`)
      pr.pasos.forEach((p, i) => lineas.push(`   ${i + 1}. ${p}`))
      if (pr.nota) lineas.push(`   Nota: ${pr.nota}`)
    }
    lineas.push('')
  }
  return lineas.join('\n')
}
