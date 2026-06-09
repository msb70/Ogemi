export const C = {
  ink: "#11222B",
  muted: "#58707A",
  faint: "#E8EEF1",
  paper: "#F7FAFB",
  white: "#FFFFFF",
  blue: "#0E7490",
  teal: "#18A999",
  green: "#1B8A5A",
  amber: "#D9902F",
  red: "#C44949",
  navy: "#173B4B",
  dark: "#0D242D",
};

export function bg(slide, ctx, color = C.paper) {
  ctx.addShape(slide, { x: 0, y: 0, w: 1280, h: 720, fill: color, line: { fill: color, width: 0 } });
}

export function rect(slide, ctx, x, y, w, h, fill, line = fill, width = 0) {
  return ctx.addShape(slide, { x, y, w, h, fill, line: { fill: line, width } });
}

export function txt(slide, ctx, text, x, y, w, h, opts = {}) {
  return ctx.addText(slide, {
    text,
    x, y, w, h,
    fontSize: opts.size ?? 18,
    color: opts.color ?? C.ink,
    bold: opts.bold ?? false,
    typeface: opts.face ?? (opts.display ? "Aptos Display" : "Aptos"),
    align: opts.align ?? "left",
    valign: opts.valign ?? "top",
    fill: opts.fill ?? "transparent",
    line: { fill: "transparent", width: 0 },
    insets: opts.insets ?? { left: 0, right: 0, top: 0, bottom: 0 },
  });
}

export function chip(slide, ctx, label, x, y, w, color = C.blue) {
  rect(slide, ctx, x, y, w, 28, "#E9F6F7", color, 1);
  txt(slide, ctx, label.toUpperCase(), x + 12, y + 7, w - 24, 14, { size: 8.5, color, bold: true, align: "center" });
}

export function footer(slide, ctx, n) {
  rect(slide, ctx, 58, 665, 1164, 1, "#D7E2E6");
  txt(slide, ctx, "OGEMI / Impresos Comerciales SA / Propuesta económica", 58, 681, 520, 16, { size: 8.5, color: C.muted });
  txt(slide, ctx, String(n).padStart(2, "0"), 1182, 681, 40, 16, { size: 8.5, color: C.muted, align: "right", bold: true });
}

export function header(slide, ctx, kicker, title, subtitle, n) {
  chip(slide, ctx, kicker, 58, 44, 170, C.blue);
  txt(slide, ctx, title, 58, 88, 780, 74, { size: 32, bold: true, display: true });
  if (subtitle) txt(slide, ctx, subtitle, 58, 164, 740, 42, { size: 13, color: C.muted });
  footer(slide, ctx, n);
}

export function metric(slide, ctx, value, label, x, y, w, color = C.blue) {
  rect(slide, ctx, x, y, w, 104, C.white, "#DCE7EB", 1);
  rect(slide, ctx, x, y, 5, 104, color);
  txt(slide, ctx, value, x + 20, y + 19, w - 36, 36, { size: 29, bold: true, color, display: true });
  txt(slide, ctx, label, x + 20, y + 60, w - 36, 30, { size: 11, color: C.muted, bold: true });
}

export function bar(slide, ctx, label, value, max, x, y, w, color) {
  txt(slide, ctx, label, x, y, 180, 20, { size: 11, color: C.ink, bold: true });
  rect(slide, ctx, x + 190, y + 3, w, 12, "#DFE9ED");
  rect(slide, ctx, x + 190, y + 3, Math.max(6, w * value / max), 12, color);
  txt(slide, ctx, `$${value.toLocaleString("en-US")}`, x + 205 + w, y - 2, 86, 22, { size: 11, color: C.ink, bold: true, align: "right" });
}

export function moduleBox(slide, ctx, title, text, x, y, w, h, color) {
  rect(slide, ctx, x, y, w, h, C.white, "#DCE7EB", 1);
  rect(slide, ctx, x, y, 6, h, color);
  txt(slide, ctx, title, x + 18, y + 16, w - 30, 22, { size: 13, bold: true, color: C.ink });
  txt(slide, ctx, text, x + 18, y + 44, w - 30, h - 56, { size: 9.6, color: C.muted });
}

export function row(slide, ctx, cols, y, fills = []) {
  const xs = [78, 320, 650, 950];
  const ws = [210, 290, 250, 210];
  cols.forEach((c, i) => {
    if (fills[i]) rect(slide, ctx, xs[i] - 10, y - 7, ws[i] + 20, 34, fills[i]);
    txt(slide, ctx, c, xs[i], y, ws[i], 20, { size: 10.5, color: i === 3 ? C.ink : C.muted, bold: i === 0 || i === 3, align: i === 3 ? "right" : "left" });
  });
}
