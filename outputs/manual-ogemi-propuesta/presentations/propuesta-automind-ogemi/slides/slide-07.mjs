import { C, bg, header, txt, rect, metric } from "./common.mjs";

export async function slide07(presentation, ctx) {
  const slide = presentation.slides.add();
  bg(slide, ctx);
  header(slide, ctx, "Infraestructura", "Infraestructura inicial sin costo mensual obligatorio.", "Para el alcance confirmado, la aplicación puede iniciar en las versiones gratis de Vercel y Supabase, sin dominio propio.", 7);
  metric(slide, ctx, "0 EUR/mes", "Vercel Free: hosting, HTTPS y despliegue web", 92, 268, 310, C.dark);
  metric(slide, ctx, "0 EUR/mes", "Supabase Free: base de datos, Auth y API para arranque", 486, 268, 310, C.blue);
  metric(slide, ctx, "Sin dominio", "Uso de URL temporal y correo de OGEMI", 880, 268, 310, C.amber);
  rect(slide, ctx, 160, 475, 960, 72, C.white, "#DCE7EB", 1);
  txt(slide, ctx, "Nota de infraestructura", 194, 494, 300, 20, { size: 13, bold: true, color: C.ink });
  txt(slide, ctx, "0 EUR / mes", 690, 485, 250, 34, { size: 27, bold: true, color: C.green, align: "right", display: true });
  txt(slide, ctx, "Se puede operar inicialmente con Vercel Free y Supabase Free, sin dominio propio, usando una URL de Vercel y un correo de OGEMI para la cuenta/administración.", 194, 523, 770, 26, { size: 10.5, color: C.muted });
  return slide;
}
