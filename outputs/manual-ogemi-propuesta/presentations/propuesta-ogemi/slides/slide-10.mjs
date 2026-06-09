import { C, bg, rect, txt, metric } from "./common.mjs";

export async function slide10(presentation, ctx) {
  const slide = presentation.slides.add();
  bg(slide, ctx, C.dark);
  rect(slide, ctx, 0, 0, 1280, 720, C.dark);
  await ctx.addImage(slide, { path: `${ctx.assetDir}/logo.jpeg`, x: 70, y: 58, w: 76, h: 76, fit: "contain", alt: "Logo Ogemi" });
  txt(slide, ctx, "CIERRE DE PROPUESTA", 170, 72, 260, 18, { size: 10, color: "#A8DADC", bold: true });
  txt(slide, ctx, "Una implementación acotada,\ncon costo cerrado y salida\na producción en 6 semanas.", 70, 190, 740, 160, { size: 43, color: C.white, bold: true, display: true });
  txt(slide, ctx, "Condición sugerida de pago: 40% al inicio, 30% al avance de semana 3 y 30% contra entrega.", 74, 386, 630, 42, { size: 16, color: "#C9DDE3" });
  metric(slide, ctx, "$9,700", "Desarrollo cerrado", 760, 210, 290, C.teal);
  metric(slide, ctx, "$45/mes", "Infraestructura base", 760, 345, 290, C.amber);
  metric(slide, ctx, "6 semanas", "Implementación", 760, 480, 290, C.blue);
  txt(slide, ctx, "Alcance confirmado: importación manual, 5 usuarios, una empresa, cierre mensual simple y recibo de anticipo.", 70, 620, 940, 22, { size: 12.5, color: "#A8DADC" });
  return slide;
}
