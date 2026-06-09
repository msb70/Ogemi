import { C, bg, header, moduleBox, rect, txt } from "./common.mjs";

export async function slide03(presentation, ctx) {
  const slide = presentation.slides.add();
  bg(slide, ctx);
  header(slide, ctx, "Mapa", "Mapa general de módulos incluidos en el sistema.", "Cada módulo responde a un flujo financiero concreto: importar, cobrar, pagar, conciliar y reportar.", 3);
  const mods = [
    ["Importar Excel", "Carga manual del libro de ventas, vista previa, clientes automáticos y control de duplicados.", C.blue],
    ["Clientes", "Días de crédito, estado activo y saldos por cliente.", C.teal],
    ["Facturas / CxC", "Fecha de pago, estado pendiente/pagada, pagos parciales y saldo pendiente.", C.green],
    ["Anticipos", "Depósitos anticipados, estado, cuenta bancaria y recibo imprimible.", C.amber],
    ["Banco", "Cuentas, ingresos, egresos, movimientos automáticos y cierre mensual.", C.navy],
    ["Compras / CxP", "Proveedores, vencimientos, pagos y egresos bancarios.", C.red],
    ["Reportes", "Cartera, CxP, libros, flujo de caja, CSV y pivots por antigüedad.", "#7C3AED"],
    ["Administración", "Usuarios, roles, permisos de ver/editar/borrar y seguridad Supabase.", "#475569"],
  ];
  mods.forEach((m, i) => moduleBox(slide, ctx, m[0], m[1], 68 + (i % 4) * 298, 252 + Math.floor(i / 4) * 150, 260, 112, m[2]));
  rect(slide, ctx, 220, 565, 840, 38, "#E9F6F7", C.teal, 1);
  txt(slide, ctx, "Flujo operativo: Excel -> facturas/clientes -> cobros/pagos -> banco -> cierre mensual -> reportes", 250, 576, 780, 16, { size: 12, bold: true, color: C.blue, align: "center" });
  return slide;
}
