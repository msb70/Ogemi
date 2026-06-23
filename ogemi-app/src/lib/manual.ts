// Manual del sistema Ogemi — contenido por módulo, filtrable por rol.
// Se usa para el correo de bienvenida y para "Enviar instrucciones" desde Usuarios.

export type ManualModulo = {
  id: string
  titulo: string
  resumen: string
  pasos: string[]
}

// Orden de presentación (igual al menú lateral)
export const MANUAL_MODULOS: ManualModulo[] = [
  {
    id: 'dashboard',
    titulo: 'Dashboard',
    resumen: 'Vista general del negocio: indicadores, gráficos y rankings.',
    pasos: [
      'Al entrar al sistema, el Dashboard es la pantalla principal.',
      'Arriba verá los indicadores (KPIs): ventas, compras, presupuestos y margen del periodo.',
      'Use el selector de periodo (mensual / trimestral / anual) para cambiar el rango; en trimestral puede elegir "Todos" para ver Q1 a Q4 del año.',
      'El gráfico muestra la evolución del periodo seleccionado.',
      'Las tablas Top 10 muestran los principales clientes por venta, proveedores por compra y clientes por presupuesto, con su monto y porcentaje del total.',
      'El margen se calcula como ventas + presupuestos − compras − notas de crédito, con su % de ganancia.',
    ],
  },
  {
    id: 'facturas',
    titulo: 'Facturas',
    resumen: 'Registro y cobro de facturas de venta, y control de cartera.',
    pasos: [
      'Abra el módulo Facturas desde el menú lateral.',
      'Use la barra de búsqueda y los filtros (estado, rango de fechas) para encontrar facturas; los KPIs reflejan los filtros activos.',
      'Para crear una factura pulse "Nueva factura": elija cliente, fecha, tipo de documento, monto e ITBMS. El número se asigna automáticamente.',
      'La fecha de pago se calcula sola: fecha de la factura + los días de crédito del cliente.',
      'Para cobrar, pulse "Cobrar" en la fila: puede registrar uno o varios cobros (multi-línea), eligiendo la cuenta de banco o aplicando un anticipo del cliente.',
      'Al cobrar el total, la factura pasa a "pagada" y se registra el ingreso en el módulo Banco automáticamente.',
      'Use "Ver" para abrir el detalle con los pagos y poder imprimirlo con el logo de la empresa.',
      'Si necesita anular un cobro, use "Reversar" (requiere permiso de borrar): genera el egreso correspondiente en banco y deja historial.',
      'El botón "Exportar" descarga la lista filtrada en CSV.',
    ],
  },
  {
    id: 'presupuestos',
    titulo: 'Presupuestos',
    resumen: 'Presupuestos con orden de trabajo, cobro y conciliación con banco.',
    pasos: [
      'Abra el módulo Presupuestos desde el menú lateral.',
      'Para crear uno pulse "Nuevo presupuesto": el número es automático y la Orden de Trabajo se propone con el consecutivo del año (formato AA-NNN, ej. 26-407); puede cambiar el número (solo dígitos).',
      'Elija el cliente, la fecha, el monto y el ITBMS. El total es monto + ITBMS.',
      'Puede editar el monto de un presupuesto con "Editar"; el estado se recalcula según lo ya cobrado.',
      'Para borrar un presupuesto use "Borrar" (requiere permiso): elimina también sus cobros y movimientos de banco, siempre que el mes no esté cerrado.',
      'Para cobrar, pulse "Cobrar": registre el cobro contra una cuenta de banco o un anticipo del cliente.',
      'En "Ver" están los cobros registrados. Puede "Editar" un cobro (lo reversa y crea uno nuevo, dejando historial) o "Reversar"lo. Ambas acciones se bloquean si el mes ya fue cerrado.',
      'Use "Exportar" para descargar la lista en CSV.',
    ],
  },
  {
    id: 'compras',
    titulo: 'Compras',
    resumen: 'Registro de compras a proveedores, notas de crédito y pagos.',
    pasos: [
      'Abra el módulo Compras desde el menú lateral.',
      'Para registrar una compra pulse "Nueva compra": elija proveedor, fecha, concepto/referencia, monto e ITBMS.',
      'Para una nota de crédito use el tipo de documento correspondiente e indique el documento afectado; los montos van en negativo.',
      'El listado muestra columnas de Pagado y Saldo por cada compra.',
      'Para pagar una compra use la acción de pago: al pagarla se registra el egreso en Banco.',
      'Use "Ver" para el detalle con pagos e impresión. Use los filtros de fecha/estado y "Exportar" para CSV.',
    ],
  },
  {
    id: 'clientes',
    titulo: 'Clientes',
    resumen: 'Catálogo de clientes y sus días de crédito.',
    pasos: [
      'Abra el módulo Clientes desde el menú lateral.',
      'Cree o edite un cliente indicando el nombre y los días de crédito (por defecto 30).',
      'Los días de crédito determinan la fecha de pago de las facturas y presupuestos de ese cliente.',
      'Al importar el libro de ventas, los clientes que no existan se crean automáticamente con 30 días.',
    ],
  },
  {
    id: 'proveedores',
    titulo: 'Proveedores',
    resumen: 'Catálogo de proveedores y sus días de crédito.',
    pasos: [
      'Abra el módulo Proveedores desde el menú lateral.',
      'Cree o edite un proveedor indicando el nombre y los días de crédito (por defecto 30).',
      'Los días de crédito determinan el vencimiento de las compras de ese proveedor.',
    ],
  },
  {
    id: 'banco',
    titulo: 'Banco',
    resumen: 'Cuentas, movimientos, estado de cuenta y cierre de mes.',
    pasos: [
      'Abra el módulo Banco desde el menú lateral.',
      'En "Movimientos" verá ingresos y egresos por cuenta, con saldo corrido. Los cobros de facturas/presupuestos y pagos de compras llegan aquí automáticamente.',
      'Puede registrar ingresos y egresos manuales cuando haga falta.',
      'En "Estado de cuenta" consulte el resumen por mes y cuenta.',
      'En "Cierre de mes" concilie cada movimiento (marcándolos uno a uno o todos), revise el saldo conciliado y cierre el periodo; el sistema bloquea el cierre si no cuadra.',
      'Una vez cerrado un mes, no se pueden modificar ni borrar movimientos de ese periodo (solo un administrador puede reabrirlo).',
    ],
  },
  {
    id: 'gastos_fijos',
    titulo: 'Gastos fijos',
    resumen: 'Catálogo de gastos fijos y sus montos semanales.',
    pasos: [
      'Abra el módulo Gastos fijos desde el menú lateral.',
      'Mantenga el catálogo de gastos fijos (nombre y categoría).',
      'Registre los montos por semana dentro de cada periodo (mes) para el control y la proyección de egresos.',
    ],
  },
  {
    id: 'reportes',
    titulo: 'Reportes',
    resumen: 'Cartera, ventas, compras, presupuestos y flujo de caja.',
    pasos: [
      'Abra el módulo Reportes desde el menú lateral.',
      'Cartera de deuda por cliente, clasificada por tramos de vencimiento (corriente, 1-30, 31-60, 61-90, 91-120 y más de 120 días).',
      'Cuentas por pagar por mes (compras pendientes).',
      'Ventas por cliente, compras por proveedor y presupuestos por cliente, con filtros de fecha, KPIs y tabla con % y % acumulado.',
      'Reportes de banco: movimientos con saldo corrido y flujo de caja por periodo y cuenta.',
      'Todos los reportes respetan los filtros de fecha que seleccione.',
    ],
  },
  {
    id: 'importar',
    titulo: 'Importar',
    resumen: 'Carga masiva del libro de ventas desde Excel.',
    pasos: [
      'Abra el módulo Importar desde el menú lateral.',
      'Cargue el archivo Excel del libro de ventas.',
      'El sistema lee factura, fecha, cliente, tipo de documento, documento afectado, monto e ITBMS.',
      'Los clientes que no existan se crean automáticamente; cada factura recibe su fecha de pago según los días de crédito del cliente.',
      'Revise el resultado de la importación antes de continuar.',
    ],
  },
  {
    id: 'usuarios',
    titulo: 'Usuarios',
    resumen: 'Gestión de usuarios, roles y permisos por módulo.',
    pasos: [
      'Abra el módulo Usuarios desde el menú lateral (solo administradores).',
      'Para crear un usuario indique correo, nombre y rol; el sistema genera una clave temporal y envía el correo de bienvenida con este manual.',
      'En la tabla puede cambiar el rol, activar/desactivar, resetear la contraseña o borrar un usuario.',
      'Use "Enviar instrucciones" para reenviar este manual del sistema al correo del usuario cuando lo necesite.',
      'En "Roles y permisos" defina, por cada módulo, si el rol puede Ver, Agregar, Editar y Borrar. Cada usuario solo ve los módulos que su rol tiene permitidos.',
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

  const intro = `
    <div style="background:#f0f9ff; border:1px solid #bae6fd; border-radius:8px; padding:14px; margin:0 0 18px;">
      <p style="margin:0 0 6px; font-weight:bold; color:#075985;">Primeros pasos</p>
      <ol style="margin:0; padding-left:18px; color:#1f2937;">
        <li style="margin-bottom:4px;">Ingrese con su correo y la clave temporal que recibió.</li>
        <li style="margin-bottom:4px;">En el primer ingreso el sistema le pedirá cambiar la clave.</li>
        <li style="margin-bottom:4px;">Use el menú lateral para navegar entre los módulos.</li>
        <li>Solo verá los módulos que su rol tiene permitidos.</li>
      </ol>
    </div>`

  const secciones = modulos.map(m => {
    const pasos = m.pasos.map(p => `<li style="margin-bottom:5px;">${escapeHtml(p)}</li>`).join('')
    return `
      <div style="margin:0 0 18px;">
        <h3 style="font-size:16px; margin:0 0 4px; color:#0f766e;">${escapeHtml(m.titulo)}</h3>
        <p style="margin:0 0 8px; color:#6b7280; font-size:13px;">${escapeHtml(m.resumen)}</p>
        <ol style="margin:0; padding-left:18px; color:#1f2937; font-size:14px;">${pasos}</ol>
      </div>`
  }).join('')

  return `
    <div style="font-family: Arial, sans-serif; color:#1f2937; line-height:1.5; max-width:620px;">
      <h2 style="font-size:20px; margin:0 0 12px;">Manual del sistema Ogemi</h2>
      ${saludo}
      ${rolLinea}
      ${intro}
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
  lineas.push('Primeros pasos:', '- Ingrese con su correo y clave temporal.', '- Cambie la clave en el primer ingreso.', '- Navegue por el menú lateral (solo verá los módulos de su rol).', '')
  for (const m of modulos) {
    lineas.push(`== ${m.titulo} ==`, m.resumen)
    m.pasos.forEach((p, i) => lineas.push(`${i + 1}. ${p}`))
    lineas.push('')
  }
  return lineas.join('\n')
}
