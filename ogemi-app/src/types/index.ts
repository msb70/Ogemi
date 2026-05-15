export type UserRole = 'admin' | 'operador' | 'lectura';
export type FacturaEstado = 'pendiente' | 'pagada';
export type CompraEstado = 'pendiente' | 'pagada';
export type MovimientoTipo = 'ingreso' | 'egreso';
export type TramoCartera = 'corriente' | '1-30' | '31-60' | '61-90' | '+120';

export interface Cliente {
  id: string;
  nombre: string;
  dias_credito: number;
  activo: boolean;
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
  created_at: string;
  updated_at: string;
  // Joins
  clientes?: Cliente;
  banco_cuentas?: BancoCuenta;
}

export interface Compra {
  id: string;
  fecha: string;
  vencimiento: string | null;
  proveedor_id: string;
  concepto: string | null;
  referencia: string | null;
  monto: number;
  itbms: number;
  total: number;
  estado: CompraEstado;
  banco_cuenta_id: string | null;
  fecha_pago: string | null;
  notas: string | null;
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

export interface CarteraVencida {
  id: string;
  numero_factura: number;
  fecha: string;
  fecha_pago: string;
  cliente: string;
  monto: number;
  itbms: number;
  total: number;
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
  dias_vencida: number;
  tramo: TramoCartera;
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
}
