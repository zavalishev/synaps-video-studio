// Цвет бумажного набора: всё берётся из палитры серии (style.palette), своих цветов у кита нет.
// Здесь только арифметика цвета и страховка читаемости (контраст WCAG AA), без вкуса:
//   contrast / readableOn — страховка читаемости (ими же пользуется @studio/layout);
//   fgOn(bg, pal) — текст на заливке bg: чернила или бумага палитры, что контрастнее, а если
//     ни то ни другое не читается — чёрный или белый;
//   mix(a, b, t) — смесь двух цветов палитры (для оттенков встроенных декораций и значков).
import type { Palette } from "../timeline/types";

// Контраст текста (WCAG AA для обычного текста) — страховка, а не вкус.
export const CONTRAST_MIN = 4.5;

// Любой CSS-цвет в RGBA: #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() (запятые или пробелы,
// альфа числом или %), hsl()/hsla(), transparent и основные имена. Неизвестное — чёрный.
const NAMED: Record<string, string> = { black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00", orange: "#ffa500", gray: "#808080", grey: "#808080", transparent: "#00000000" };
export const parseCss = (css: string): [number, number, number, number] => {
  const c = (NAMED[css.trim().toLowerCase()] ?? css).trim();
  if (c.startsWith("#")) {
    let h = c.slice(1);
    if (h.length === 3 || h.length === 4) h = h.split("").map((x) => x + x).join("");
    const v = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    const al = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return v.some((x) => Number.isNaN(x)) ? [0, 0, 0, 1] : [v[0], v[1], v[2], Number.isNaN(al) ? 1 : al];
  }
  const m = c.match(/^(rgba?|hsla?)\(([^)]*)\)$/i);
  if (!m) return [0, 0, 0, 1];
  const parts = m[2].split(/[\s,/]+/).filter(Boolean);
  const num = (t: string | undefined, max: number) => (t === undefined ? NaN : t.endsWith("%") ? (parseFloat(t) / 100) * max : parseFloat(t));
  const al = parts[3] === undefined ? 1 : num(parts[3], 1);
  if (m[1].toLowerCase().startsWith("rgb")) {
    const v = [0, 1, 2].map((i) => num(parts[i], 255));
    return v.some((x) => Number.isNaN(x)) ? [0, 0, 0, 1] : [v[0], v[1], v[2], Number.isNaN(al) ? 1 : al];
  }
  const hh = ((parseFloat(parts[0]) % 360) + 360) % 360, ss = num(parts[1], 1), ll = num(parts[2], 1);
  if ([hh, ss, ll].some((x) => Number.isNaN(x))) return [0, 0, 0, 1];
  const k = (n: number) => (n + hh / 30) % 12, a2 = ss * Math.min(ll, 1 - ll);
  const f = (n: number) => 255 * (ll - a2 * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))));
  return [f(0), f(8), f(4), Number.isNaN(al) ? 1 : al];
};
const parse = (css: string): [number, number, number] => { const [r, g, b] = parseCss(css); return [r, g, b]; };
// Полупрозрачный цвет поверх подложки (по умолчанию — непрозрачный как есть) → #rrggbb.
export const flatten = (css: string, over = "#000000"): string => {
  const [r, g, b, al] = parseCss(css);
  const [R, G, B] = parse(over);
  return `#${[[r, R], [g, G], [b, B]].map(([x, y]) => hex2(x * al + y * (1 - al))).join("")}`;
};
const hex2 = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");

export const lum = (hex: string): number => {
  const ch = parse(hex).map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};
export const contrast = (a: string, b: string): number => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
// Контраст текста на ПОЛУПРОЗРАЧНОЙ плашке/фоне: что под ней — неизвестно (или backdrop),
// поэтому худший из вариантов «плашка поверх чёрного» и «поверх белого».
export const contrastOver = (fg: string, bg: string, backdrop?: string): number => {
  const one = (under: string) => { const b = flatten(bg, under); return contrast(flatten(fg, b), b); };
  if (parseCss(bg)[3] >= 0.999 || backdrop) return one(backdrop ?? "#000000");
  return Math.min(one("#000000"), one("#ffffff"));
};
// Цвет текста на фоне bg: свой, если читается; иначе чёрный или белый — что контрастнее.
export const readableOn = (fg: string, bg: string): string =>
  contrast(fg, bg) >= CONTRAST_MIN ? fg : contrast("#000000", bg) >= contrast("#ffffff", bg) ? "#000000" : "#ffffff";

// Текст на заливке bg: чернила или бумага палитры (что контрастнее), страховка — чёрный/белый.
export const fgOn = (bg: string, pal: Pick<Palette, "ink" | "paper">): string => {
  const best = contrast(pal.ink, bg) >= contrast(pal.paper, bg) ? pal.ink : pal.paper;
  return readableOn(best, bg);
};

// Смесь: t = 0 — a, t = 1 — b.
export const mix = (a: string, b: string, t: number): string => {
  const x = parse(a), y = parse(b);
  return `#${[0, 1, 2].map((i) => hex2(x[i] + (y[i] - x[i]) * t)).join("")}`;
};
