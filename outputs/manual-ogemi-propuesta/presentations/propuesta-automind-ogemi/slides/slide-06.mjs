import { C, bg, header, bar, txt, rect } from "./common.mjs";

export async function slide06(presentation, ctx) {
  const slide = presentation.slides.add();
  bg(slide, ctx);
  header(slide, ctx, "Inversión", "Inversión de desarrollo: 2.000 EUR.", "El desglose refleja estabilización técnica, cierre de reglas de negocio, reportes, QA, despliegue y capacitación.", 6);
  const items = [
    ["Estabilización, build y despliegue", 250, C.blue],
    ["Supabase, migraciones, seguridad y usuarios", 250, C.teal],
    ["Importación manual Excel y validaciones", 200, C.green],
    ["Clientes, facturas, pagos y cartera", 300, C.amber],
    ["Anticipos con recibo imprimible", 150, "#7C3AED"],
    ["Banco, movimientos y cierre mensual", 250, C.navy],
    ["Compras, proveedores y CxP", 200, C.red],
    ["Reportes, exportaciones y dashboard", 250, "#0F766E"],
    ["QA, documentación y capacitación", 150, "#475569"],
  ];
  const max = 300;
  items.forEach((it, i) => bar(slide, ctx, it[0], it[1], max, 96, 238 + i * 38, 475, it[2]));
  rect(slide, ctx, 930, 250, 240, 218, C.dark);
  txt(slide, ctx, "2.000 EUR", 948, 298, 204, 52, { size: 35, bold: true, display: true, color: C.white, align: "center" });
  txt(slide, ctx, "TOTAL DESARROLLO", 960, 362, 180, 18, { size: 10, bold: true, color: "#A8DADC", align: "center" });
  txt(slide, ctx, "Propuesta cerrada para el alcance confirmado. Cambios como multiempresa, conciliación detallada o importación automática se cotizan aparte.", 958, 402, 184, 52, { size: 9.5, color: "#D8E7EB", align: "center" });
  return slide;
}
