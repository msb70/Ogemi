export type UserRole = 'admin' | 'operador' | 'lectura';
export type PresupuestoEstado = 'pendiente' | 'pagada';
export type FacturaEstado = 'pendiente' | 'pagada' | 'falta_retencion';
export type CompraEstado = 'pendiente' | 'pagada';
export type MovimientoTipo = 'ingreso' | 'egreso';
export type TramoCartera = 'corriente' | '1-30' | '31-60' | '61-90' | '91-120' | '+120';

export interface Cliente {
  id: string;
  nombre: string;
  dias_credito: number;
  retencion_pct: number;
  activo: boolean;
  // Datos fiscales para factura electrónica
  ruc: string | null;
  dv: string | null;
  tipo_contribuyente: number;
  tipo_cliente: string;
  direccion: string | null;
  email: string | null;
  created_at: string;
  updated_at: string;
}

export interface Proveedor {
  id: string;
  nombre: string;
  dias_credito: number;
  activo: boolean;
  created_at: string;
  updated_at: string;
}

export interface Factura {
  id: string;
  numero_factura: number;
  fecha: string;
  cliente_id: string;
  tipo_documento: string;
  documento_afectado: number | null;
  monto: number;
  itbms: number;
  total: number;
  fecha_pago: string | null;
  estado: FacturaEstado;
  fecha_cobro: string | null;
  banco_cuenta_id: string | null;
  notas: string | null;
  monto_pagado: number;
  retencion_pct: number;
  retencion_monto: number;
  retencion_comprobante_entregado: boolean;
  retencion_comprobante_fecha: string | null;
  /** Si es una nota de crédito (total negativo), id de la factura a la que se aplicó */
  factura_aplicada_id?: string | null;
  created_at: string;
  updated_at: string;
  // Joins
  clientes?: Cliente;
  banco_cuentas?: BancoCuenta;
}

export type NotaCreditoEstado = 'disponible' | 'aplicada';

export interface NotaCredito {
  id: string;
  numero: string | null;
  cliente_id: string;
  fecha: string;
  monto: number;
  itbms: number;
  total: number;
  estado: NotaCreditoEstado;
  factura_aplicada_id: string | null;
  pago_id: string | null;
  notas: string | null;
  created_at: string;
  updated_at: string;
  // Joins
  clientes?: Cliente;
  factura_aplicada?: { numero_factura: number } | null;
}

export interface Presupuesto {
  id: string;
  numero_presupuesto: number;
  fecha: string;
  cliente_id: string;
  tipo_documento: string;
  documento_afectado: number | null;
  monto: number;
  itbms: number;
  total: number;
  fecha_pago: string | null;
  estado: PresupuestoEstado;
  fecha_cobro: string | null;
  banco_cuenta_id: string | null;
  notas: string | null;
  monto_pagado: number;
  created_at: string;
  updated_at: string;
  // Joins
  clientes?: Cliente;
  banco_cuentas?: BancoCuenta;
}

export interface CarteraPresupuesto {
  id: string;
  numero_presupuesto: number;
  fecha: string;
  fecha_pago: string;
  cliente: string;
  monto: number;
  itbms: number;
  total: number;
  monto_pagado: number;
  saldo_pendiente: number;
  dias_vencida: number;
  tramo: TramoCartera;
}

export interface Compra {
  id: string;
  fecha: string;
  vencimiento: string | null;
  proveedor_id: string;
  concepto: string | null;
  referencia: string | null;
  tipo_documento: string;
  documento_afectado: string | null;
  monto: number;
  itbms: number;
  total: number;
  estado: CompraEstado;
  banco_cuenta_id: string | null;
  fecha_pago: string | null;
  notas: string | null;
  monto_pagado: number;
  created_at: string;
  updated_at: string;
  // Joins
  proveedores?: Proveedor;
  banco_cuentas?: BancoCuenta;
}

export interface BancoCuenta {
  id: string;
  nombre: string;
  banco: string;
  numero_cuenta: string | null;
  saldo_inicial: number;
  activo: boolean;
  created_at: string;
}

export interface BancoMovimiento {
  id: string;
  cuenta_id: string;
  factura_id: string | null;
  compra_id: string | null;
  tipo: MovimientoTipo;
  concepto: string;
  monto: number;
  fecha: string;
  referencia: string | null;
  created_at: string;
  // Joins
  banco_cuentas?: BancoCuenta;
  facturas?: Factura;
  compras?: Compra;
}

export interface CierreMes {
  id: string;
  cuenta_id: string;
  periodo: string;
  saldo_sistema: number;
  saldo_banco: number;
  diferencia: number;
  cerrado: boolean;
  notas: string | null;
  created_at: string;
  banco_cuentas?: BancoCuenta;
}

export interface UserRoleRecord {
  id: string;
  user_id: string;
  role: UserRole;
  puede_ver: boolean;
  puede_editar: boolean;
  puede_borrar: boolean;
  created_at: string;
}

export interface Anticipo {
  id: string;
  numero_recibo: number;
  cliente_id: string;
  cuenta_id: string;
  fecha: string;
  monto: number;
  numero_deposito: string | null;
  notas: string | null;
  estado: 'activo' | 'aplicado' | 'anulado';
  created_at: string;
  updated_at: string;
  // Joins
  clientes?: Cliente;
  banco_cuentas?: BancoCuenta;
}

export interface Pago {
  id: string;
  factura_id: string | null;
  compra_id: string | null;
  cuenta_id: string;
  monto: number;
  fecha: string;
  referencia: string | null;
  notas: string | null;
  created_at: string;
  // Joins
  banco_cuentas?: BancoCuenta;
}

export interface CarteraVencida {
  id: string;
  numero_factura: number;
  fecha: string;
  fecha_pago: string;
  cliente: string;
  monto: number;
  itbms: number;
  total: number;
  monto_pagado: number;
  saldo_pendiente: number;
  dias_vencida: number;
  tramo: TramoCartera;
}

export interface CompraVencida {
  id: string;
  fecha: string;
  vencimiento: string;
  proveedor: string;
  concepto: string | null;
  monto: number;
  itbms: number;
  total: number;
  monto_pagado: number;
  saldo_pendiente: number;
  dias_vencida: number;
  tramo: TramoCartera;
}

// ============ Factura Electrónica (PAC TheFactory Panamá) ============

export type FeEstado = 'borrador' | 'enviando' | 'aceptado' | 'rechazado';

export interface FeConfig {
  id: boolean;
  pin: string | null;
  usuario: string | null;
  clave: string | null;
  codigo_sucursal: string;
  nro_terminal: string;
  endpoint_url: string;
  activo: boolean;
  updated_at: string;
}

export interface FeArticulo {
  id: string;
  codigo: string;
  nombre: string;
  precio: number;
  prc_impuesto: number;
  unidad: string;
  grupo_inv: string;
  subgr_inv: string;
  activo: boolean;
  created_at: string;
  updated_at: string;
}

export interface FeDocumentoLinea {
  id?: string;
  documento_id?: string;
  orden: number;
  articulo_id: string | null;
  codigo_articulo: string;
  nombre_articulo: string;
  precioneto: number;
  prc_impuesto: number;
  cantidad: number;
  unidad: string;
  grupo_inv: string;
  subgr_inv: string;
}

export interface FeDocumentoPago {
  id?: string;
  documento_id?: string;
  codigo: string;
  nombre: string;
  monto: number;
}

export interface FeDocumento {
  id: string;
  tipo_doc: string;
  documento: string;
  fecha: string;
  cliente_id: string;
  nombre_cliente: string;
  tipo_contribuyente: number;
  tipo_cliente: string;
  ruc: string | null;
  dv: string | null;
  direccion_cliente: string;
  email_cliente: string | null;
  totneto: number;
  totimpuest: number;
  totalfinal: number;
  total_pagado: number;
  codigo_retencion: string | null;
  prc_retencion: number;
  retencion: number;
  cufe_devol: string | null;
  fecha_cufe_devol: string | null;
  fe_referencia_id: string | null;
  notas: string | null;
  estado: FeEstado;
  cufe: string | null;
  fecha_cufe: string | null;
  url_dgi: string | null;
  respuesta_pac: string | null;
  factura_id: string | null;
  nota_credito_id: string | null;
  created_at: string;
  updated_at: string;
  // Joins
  clientes?: Cliente;
  fe_documento_lineas?: FeDocumentoLinea[];
  fe_documento_pagos?: FeDocumentoPago[];
}

export interface ExcelRow {
  fecha: Date;
  tipo_documento: string;
  numero_factura: number;
  documento_afectado: number | null;
  nombre_cliente: string;
  neto: number;
  impuesto: number;
  total: number;
}

export interface ImportResult {
  total: number;
  importadas: number;
  duplicadas: number;
  errores: string[];
  clientes_creados: number;
  /** Suma de totales de facturas (documentos que NO son nota de crédito) */
  monto_ventas: number;
  /** Suma de totales de notas de crédito (valor negativo) */
  monto_notas_credito: number;
  /** Ventas netas = ventas + notas de crédito (NC son negativas) */
  monto_neto: number;
  /** NC importadas aplicadas automáticamente a su factura afectada en esta corrida */
  ncs_aplicadas?: number;
}
