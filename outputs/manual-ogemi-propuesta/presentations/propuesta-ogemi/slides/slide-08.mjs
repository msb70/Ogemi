import { C, bg, header, txt, rect } from "./common.mjs";

export async function slide08(presentation, ctx) {
  const slide = presentation.slides.add();
  bg(slide, ctx);
  header(slide, ctx, "Cronograma", "Cronograma de trabajo: 6 semanas.", "La secuencia prioriza primero estabilidad y datos, luego operación financiera, reportes y entrega.", 8);
  const weeks = [
    ["1", "Base técnica", "Corrección de build, revisión final, Supabase y seguridad"],
    ["2", "Ventas", "Importación Excel, clientes y facturas"],
    ["3", "Cobros", "Pagos, anticipos y movimientos bancarios"],
    ["4", "Compras", "Proveedores, CxP y pagos a compras"],
    ["5", "Reportes", "Dashboard, cartera, libros, banco y cierre mensual"],
    ["6", "Entrega", "QA, despliegue, documentación y capacitación"],
  ];
  weeks.forEach((w, i) => {
    const x = 86 + i * 184;
    const color = [C.blue, C.teal, C.green, C.amber, C.navy, C.red][i];
    rect(slide, ctx, x, 288, 138, 220, C.white, "#DCE7EB", 1);
    rect(slide, ctx, x, 288, 138, 42, color);
    txt(slide, ctx, `SEMANA ${w[0]}`, x + 13, 301, 112, 14, { size: 9, color: C.white, bold: true, align: "center" });
    txt(slide, ctx, w[1], x + 14, 358, 110, 26, { size: 15, color: C.ink, bold: true, align: "center" });
    txt(slide, ctx, w[2], x + 16, 408, 106, 58, { size: 9.5, color: C.muted, align: "center" });
  });
  txt(slide, ctx, "Hitos de validación: cierre funcional al final de semana 3 y revisión completa del sistema al final de semana 5.", 170, 570, 940, 22, { size: 13, color: C.muted, align: "center" });
  return slide;
}
