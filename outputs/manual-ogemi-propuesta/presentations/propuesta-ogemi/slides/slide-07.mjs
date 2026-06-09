import { C, bg, header, txt, rect, metric } from "./common.mjs";

export async function slide07(presentation, ctx) {
  const slide = presentation.slides.add();
  bg(slide, ctx);
  header(slide, ctx, "Infraestructura", "Infraestructura liviana para producción.", "La arquitectura propuesta aprovecha servicios administrados para reducir mantenimiento y acelerar la puesta en marcha.", 7);
  metric(slide, ctx, "$20/mes", "Vercel Pro: hosting, HTTPS, despliegues y CI/CD", 92, 268, 310, C.dark);
  metric(slide, ctx, "$25/mes", "Supabase Pro: Postgres, Auth, RLS, backups y API", 486, 268, 310, C.blue);
  metric(slide, ctx, "$15-$25/año", "Dominio si aún no existe", 880, 268, 310, C.amber);
  rect(slide, ctx, 160, 475, 960, 72, C.white, "#DCE7EB", 1);
  txt(slide, ctx, "Costo operativo base estimado", 194, 494, 300, 20, { size: 13, bold: true, color: C.ink });
  txt(slide, ctx, "$45 USD / mes", 690, 485, 250, 34, { size: 27, bold: true, color: C.green, align: "right", display: true });
  txt(slide, ctx, "No incluye correo corporativo adicional ni servicios opcionales de monitoreo avanzado.", 194, 523, 680, 16, { size: 10.5, color: C.muted });
  return slide;
}
