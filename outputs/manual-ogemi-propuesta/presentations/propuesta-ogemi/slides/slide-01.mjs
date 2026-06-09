import { C, bg, rect, txt, metric } from "./common.mjs";

export async function slide01(presentation, ctx) {
  const slide = presentation.slides.add();
  bg(slide, ctx, C.dark);
  rect(slide, ctx, 0, 0, 1280, 720, C.dark);
  rect(slide, ctx, 0, 0, 1280, 720, "#10313B");
  rect(slide, ctx, 56, 54, 5, 88, C.teal);
  await ctx.addImage(slide, { path: `${ctx.assetDir}/logo.jpeg`, x: 1050, y: 48, w: 104, h: 104, fit: "contain", alt: "Logo Ogemi" });
  txt(slide, ctx, "OGEMI IMPRESORA", 78, 58, 380, 18, { size: 10, color: "#A8DADC", bold: true });
  txt(slide, ctx, "Propuesta económica / Sistema de gestión de cartera", 78, 88, 500, 18, { size: 11, color: "#C9DDE3" });
  txt(slide, ctx, "Sistema financiero\npara cartera, banco\ny reportes gerenciales", 74, 196, 780, 185, { size: 50, color: C.white, bold: true, display: true });
  txt(slide, ctx, "Alcance cerrado para una empresa, 5 usuarios, importación manual de Excel y cierre bancario mensual por comparación de saldos.", 78, 405, 610, 56, { size: 16, color: "#C9DDE3" });
  metric(slide, ctx, "$9,700", "Inversión de desarrollo cerrada", 78, 525, 260, C.teal);
  metric(slide, ctx, "6 semanas", "Cronograma de implementación", 368, 525, 260, C.amber);
  metric(slide, ctx, "$45/mes", "Infraestructura base estimada", 658, 525, 260, C.blue);
  txt(slide, ctx, "Preparado para Impresos Comerciales SA", 1018, 668, 200, 16, { size: 8.5, color: "#A8DADC", align: "right" });
  return slide;
}
