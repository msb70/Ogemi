import { C, bg, header, txt, rect } from "./common.mjs";

export async function slide08(presentation, ctx) {
  const slide = presentation.slides.add();
  bg(slide, ctx);
  header(slide, ctx, "Cronograma", "Cronograma de trabajo: 4 semanas.", "La secuencia prioriza primero estabilidad y datos, luego operación financiera, reportes y entrega.", 8);
  const weeks = [
    ["1", "Base y datos", "Corrección de build, Supabase, seguridad e importación Excel"],
    ["2", "Operación", "Clientes, facturas, pagos, anticipos y banco"],
    ["3", "Compras y reportes", "Proveedores, CxP, dashboard, cartera, libros y cierre mensual"],
    ["4", "Entrega", "QA, ajustes, despliegue, documentación y capacitación"],
  ];
  weeks.forEach((w, i) => {
    const x = 178 + i * 235;
    const color = [C.blue, C.teal, C.green, C.amber, C.navy, C.red][i];
    rect(slide, ctx, x, 288, 170, 220, C.white, "#DCE7EB", 1);
    rect(slide, ctx, x, 288, 170, 42, color);
    txt(slide, ctx, `SEMANA ${w[0]}`, x + 20, 301, 130, 14, { size: 9, color: C.white, bold: true, align: "center" });
    txt(slide, ctx, w[1], x + 18, 358, 134, 26, { size: 15, color: C.ink, bold: true, align: "center" });
    txt(slide, ctx, w[2], x + 18, 408, 134, 58, { size: 9.5, color: C.muted, align: "center" });
  });
  txt(slide, ctx, "Hitos de validación: revisión funcional al final de semana 2 y revisión completa del sistema al final de semana 3.", 170, 570, 940, 22, { size: 13, color: C.muted, align: "center" });
  return slide;
}
