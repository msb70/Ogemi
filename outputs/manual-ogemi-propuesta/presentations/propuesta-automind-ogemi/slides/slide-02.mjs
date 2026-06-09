import { C, bg, header, metric, txt, rect } from "./common.mjs";

export async function slide02(presentation, ctx) {
  const slide = presentation.slides.add();
  bg(slide, ctx);
  header(slide, ctx, "Resumen", "Automind propone llevar la base funcional a una versión operativa en 4 semanas.", "La revisión detectó una app avanzada en Next.js + Supabase. El proyecto propuesto se concentra en estabilizar, cerrar reglas operativas, desplegar y capacitar.", 2);
  metric(slide, ctx, "Base existente", "Dashboard, facturas, clientes, banco, compras, reportes y admin ya tienen estructura", 70, 270, 330, C.green);
  metric(slide, ctx, "Alcance cerrado", "Importación manual, 5 usuarios, una empresa y cierre mensual simple", 475, 270, 330, C.blue);
  metric(slide, ctx, "4 semanas", "Corrección técnica, QA, despliegue, documentación y capacitación", 880, 270, 330, C.amber);
  rect(slide, ctx, 70, 455, 1140, 86, C.white, "#DCE7EB", 1);
  txt(slide, ctx, "Decisión económica", 94, 477, 220, 22, { size: 14, bold: true, color: C.ink });
  txt(slide, ctx, "No se cotiza como desarrollo desde cero. Automind cotiza una terminación controlada: reglas de negocio, seguridad, cierres, reportes, despliegue y pruebas para que el sistema pueda usarse de forma confiable.", 330, 470, 805, 38, { size: 15, color: C.muted });
  return slide;
}
