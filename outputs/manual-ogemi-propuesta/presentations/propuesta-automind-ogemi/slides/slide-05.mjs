import { C, bg, header, row, rect, txt } from "./common.mjs";

export async function slide05(presentation, ctx) {
  const slide = presentation.slides.add();
  bg(slide, ctx);
  header(slide, ctx, "Alcance", "Alcance funcional confirmado.", "Con las respuestas recibidas, el alcance queda cerrado y reduce incertidumbre en tiempo y costo.", 5);
  rect(slide, ctx, 58, 244, 1164, 40, C.dark);
  txt(slide, ctx, "Decisión", 78, 257, 210, 18, { size: 10, color: C.white, bold: true });
  txt(slide, ctx, "Confirmado", 320, 257, 290, 18, { size: 10, color: C.white, bold: true });
  txt(slide, ctx, "Implicación", 650, 257, 250, 18, { size: 10, color: C.white, bold: true });
  txt(slide, ctx, "Impacto", 950, 257, 210, 18, { size: 10, color: C.white, bold: true, align: "right" });
  const rows = [
    ["Importación", "Manual desde Excel", "No requiere automatización con Drive, correo o SFTP", "Menor costo"],
    ["Usuarios", "5 usuarios iniciales", "Permisos por rol y operación controlada", "Suficiente"],
    ["Cierre banco", "Comparación mensual", "No incluye conciliación movimiento por movimiento", "Simple"],
    ["Documentos", "Recibo de anticipo", "No incluye factura PDF ni facturación electrónica", "Acotado"],
    ["Empresa", "Una sola empresa", "No se requiere multiempresa ni sucursales", "Directo"],
  ];
  rows.forEach((r, i) => {
    rect(slide, ctx, 58, 302 + i * 52, 1164, 1, "#DCE7EB");
    row(slide, ctx, r, 320 + i * 52);
  });
  txt(slide, ctx, "Fuera de alcance inicial: conciliación bancaria detallada, multiempresa, facturación fiscal/PDF, importaciones automáticas y workflows de aprobación.", 92, 590, 1030, 24, { size: 12.5, color: C.muted });
  return slide;
}
