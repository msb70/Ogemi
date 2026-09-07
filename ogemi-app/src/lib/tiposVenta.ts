/** Tipos de venta del Informe diario (cuentas contables 400-01 / 400-02 / 400-05) */
export type TipoVenta = 'litografico' | 'digital' | 'otras'

export const TIPOS_VENTA: { value: TipoVenta; label: string; cuenta: string; nombre: string }[] = [
  { value: 'litografico', label: '400-01 Litográficos', cuenta: '400-01', nombre: 'Impresos Litográficos' },
  { value: 'digital',     label: '400-02 Digitales',    cuenta: '400-02', nombre: 'Impresos Digitales' },
  { value: 'otras',       label: '400-05 Otras ventas', cuenta: '400-05', nombre: 'Otras ventas' },
]
