import { C, bg, header, txt, rect } from "./common.mjs";

export async function slide04(presentation, ctx) {
  const slide = presentation.slides.add();
  bg(slide, ctx);
  header(slide, ctx, "Flujo", "El proceso mensual queda controlado de punta a punta.", "La operación se organiza alrededor del libro de ventas, la gestión de cobros, el banco y los reportes de cierre.", 4);
  const steps = [
    ["1", "Importar libro de ventas", "Carga manual del Excel y validación previa."],
    ["2", "Crear clientes y facturas", "Clientes nuevos se crean con 30 días de crédito."],
    ["3", "Registrar pagos", "Pagos parciales o completos contra facturas."],
    ["4", "Mover a banco", "Cobros y pagos generan movimientos bancarios."],
    ["5", "Cerrar el mes", "Comparación entre saldo sistema y saldo banco."],
    ["6", "Reportar", "Cartera por cliente, antigüedad, CxP y libros."],
  ];
  steps.forEach((s, i) => {
    const x = 82 + i * 186;
    const color = [C.blue, C.teal, C.green, C.navy, C.amber, C.red][i];
    rect(slide, ctx, x, 285, 122, 122, "#FFFFFF", "#DCE7EB", 1);
    rect(slide, ctx, x + 39, 244, 44, 44, color);
    txt(slide, ctx, s[0], x + 48, 254, 26, 20, { size: 17, color: C.white, bold: true, align: "center" });
    txt(slide, ctx, s[1], x + 14, 314, 94, 34, { size: 12, bold: true, color: C.ink, align: "center" });
    txt(slide, ctx, s[2], x + 13, 357, 96, 32, { size: 8.5, color: C.muted, align: "center" });
    if (i < 5) rect(slide, ctx, x + 130, 344, 42, 3, "#B8C9CF");
  });
  txt(slide, ctx, "Resultado: saldos confiables, trazabilidad de pagos y reportes exportables para la gestión mensual.", 190, 505, 900, 28, { size: 18, bold: true, color: C.ink, align: "center" });
  return slide;
}
