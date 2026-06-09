import { C, bg, rect, txt, metric } from "./common.mjs";

export async function slide10(presentation, ctx) {
  const slide = presentation.slides.add();
  bg(slide, ctx, C.dark);
  rect(slide, ctx, 0, 0, 1280, 720, C.dark);
  await ctx.addImage(slide, { path: `${ctx.assetDir}/automind.png`, x: 62, y: 44, w: 120, h: 90, fit: "contain", alt: "Logo Automind" });
  txt(slide, ctx, "CIERRE DE PROPUESTA", 170, 72, 260, 18, { size: 10, color: "#A8DADC", bold: true });
  txt(slide, ctx, "Una implementación acotada,\ncon costo cerrado y salida\na producción en 4 semanas.", 70, 190, 740, 160, { size: 43, color: C.white, bold: true, display: true });
  txt(slide, ctx, "Condición sugerida de pago: 50% al inicio y 50% contra entrega.", 74, 386, 630, 42, { size: 16, color: "#C9DDE3" });
  metric(slide, ctx, "2.000 EUR", "Desarrollo cerrado", 760, 210, 290, C.teal);
  metric(slide, ctx, "0 EUR/mes", "Infraestructura inicial posible", 760, 345, 290, C.amber);
  metric(slide, ctx, "4 semanas", "Implementación", 760, 480, 290, C.blue);
  txt(slide, ctx, "Propuesta emitida por Automind Group. Alcance confirmado: importación manual, 5 usuarios, una empresa, cierre mensual simple y recibo de anticipo.", 70, 620, 980, 22, { size: 12.5, color: "#A8DADC" });
  return slide;
}
