import { C, bg, header, moduleBox, txt, rect } from "./common.mjs";

export async function slide09(presentation, ctx) {
  const slide = presentation.slides.add();
  bg(slide, ctx);
  header(slide, ctx, "Equipo", "Roles implicados y responsabilidades.", "El proyecto requiere perfiles funcionales y técnicos, con validación activa del usuario clave del cliente.", 9);
  moduleBox(slide, ctx, "Analista funcional", "Confirma reglas contables, alcance, criterios de aceptación y prioridades del negocio.", 82, 260, 250, 118, C.blue);
  moduleBox(slide, ctx, "Full-stack developer", "Implementa pantallas, lógica de negocio, flujos de pagos, reportes y experiencia de usuario.", 374, 260, 250, 118, C.teal);
  moduleBox(slide, ctx, "Supabase / PostgreSQL", "Asegura migraciones, RLS, funciones, triggers, respaldo y consistencia de datos.", 666, 260, 250, 118, C.green);
  moduleBox(slide, ctx, "QA / DevOps", "Prueba escenarios críticos, despliega en producción y documenta operación básica.", 958, 260, 250, 118, C.amber);
  rect(slide, ctx, 220, 486, 840, 64, "#E9F6F7", C.teal, 1);
  txt(slide, ctx, "Rol del cliente", 250, 505, 160, 18, { size: 13, bold: true, color: C.blue });
  txt(slide, ctx, "Validar el Excel real, revisar reportes, confirmar cierres mensuales y aprobar la operación antes de producción.", 420, 501, 580, 28, { size: 12, color: C.muted });
  return slide;
}
