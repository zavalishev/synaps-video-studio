// Облик ролика как точка в пространстве, а не как «не делай как в прошлый раз».
// Пространство: светлота фона (тёмный / средний / светлый) × тон акцента (12 секторов по 30°
// в OKLCH, плюс «нейтральный») — клетки. Студия видит, какие клетки заняты последними
// роликами, и выбирает из свободных, если бренд не диктует. Подача текста — тоже не свободный
// текст, а структура (выравнивание, якорь, крупность, плашка), чтобы похожие формулировки
// «влево рваным краем» сравнивались как одно и то же.
// Чистые функции без node: их зовут board.ts, studio looks, render и тесты.
import { oklch } from "./theme";

export type Lightness = "dark" | "mid" | "light";
export const LIGHT_RU: Record<Lightness, string> = { dark: "тёмный", mid: "средний", light: "светлый" };
export const HUE_RU = ["малиновый", "красно-оранжевый", "оранжевый/охра", "жёлтый", "лайм", "зелёный", "бирюзовый", "голубой", "синий", "фиолетовый", "пурпурный", "розовый"];

const isHex = (x?: string) => Boolean(x && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(x.trim()));

export const lightnessOf = (bg: string): Lightness => { const L = oklch(bg).L; return L < 0.42 ? "dark" : L < 0.72 ? "mid" : "light"; };
// Сектор тона акцента 0…11 или -1 (нейтральный: насыщенность < 0.05 — серый не «тон»).
export const hueSector = (accent: string): number => { const c = oklch(accent); return c.C < 0.05 ? -1 : Math.floor(c.h / 30) % 12; };

export type LookCell = { light: Lightness; sector: number; key: string; label: string };
export const lookCell = (bg?: string, accent?: string): LookCell | null => {
  if (!isHex(bg) || !isHex(accent)) return null;
  const light = lightnessOf(bg!), sector = hueSector(accent!);
  return { light, sector, key: `${light}/${sector}`, label: `${LIGHT_RU[light]} фон + ${sector < 0 ? "нейтральный акцент" : `${HUE_RU[sector]} (${sector * 30}–${sector * 30 + 30}°)`}` };
};

// Занятость клеток последними роликами. FREE — клетки без единого ролика (в каждом ряду светлоты).
export type Occupancy = { counts: Map<string, number>; total: number; free: Record<Lightness, number[]>; top: Array<{ key: string; label: string; n: number }> };
export const occupancy = (looks: Array<{ bg?: string; accent?: string }>): Occupancy => {
  const counts = new Map<string, number>();
  const labels = new Map<string, string>();
  let total = 0;
  for (const l of looks) {
    const c = lookCell(l.bg, l.accent);
    if (!c) continue;
    total++;
    counts.set(c.key, (counts.get(c.key) ?? 0) + 1);
    labels.set(c.key, c.label);
  }
  const free = { dark: [] as number[], mid: [] as number[], light: [] as number[] };
  for (const light of ["dark", "mid", "light"] as Lightness[]) for (let s = 0; s < 12; s++) if (!counts.has(`${light}/${s}`)) free[light].push(s);
  const top = [...counts.entries()].sort((p, q) => q[1] - p[1]).map(([key, n]) => ({ key, label: labels.get(key) ?? key, n }));
  return { counts, total, free, top };
};

// ---- подача текста: структура вместо свободной строки ----
export type Layout = { align?: string; anchor?: string; scale?: string; plate?: string };
// Поля theme.type: align (left|center|right|free), anchor (top|over-hero|bottom|in-world),
// scale (giant|large|medium); plate — из shapes.plate (none → «без плашки»).
// Нет структурных полей — грубое чтение свободной строки lockup (на старых темах).
export const layoutOf = (t: { type?: { align?: string; anchor?: string; scale?: string; lockup?: string }; shapes?: { plate?: string } }): Layout => {
  const lk = (t.type?.lockup ?? "").toLowerCase();
  const align = t.type?.align ?? (/влево|слева|рваным|left/.test(lk) ? "left" : /центр|center/.test(lk) ? "center" : /вправо|right/.test(lk) ? "right" : undefined);
  const anchor = t.type?.anchor ?? (/поверх|на герое|over/.test(lk) ? "over-hero" : /в мире|на стакане|на бирке|на клетке|in-world/.test(lk) ? "in-world" : /снизу|bottom/.test(lk) ? "bottom" : /сверху|top/.test(lk) ? "top" : undefined);
  const scale = t.type?.scale ?? (/во весь (экран|кадр)|гигант|огромн|giant/.test(lk) ? "giant" : undefined);
  const plate = t.shapes?.plate ? (t.shapes.plate === "none" ? "none" : "plate") : undefined;
  return { align, anchor, scale, plate };
};
// Та же подача: совпали выравнивание и хотя бы ещё одно известное поле из (якорь, крупность, плашка).
export const sameLayout = (a: Layout, b: Layout): boolean => {
  if (!a.align || !b.align || a.align !== b.align) return false;
  let both = 0, eq = 0;
  for (const k of ["anchor", "scale", "plate"] as const) if (a[k] && b[k]) { both++; if (a[k] === b[k]) eq++; }
  return both > 0 && eq === both;
};
export const layoutLabel = (l: Layout) => [l.align ?? "?", l.anchor ?? "?", l.scale ?? "?", l.plate ?? "?"].join(" · ");

// ---- акцент «из предмета»: проверка по пикселям ассетов ----
// ΔE в OKLab (×100): < 6 и тон в пределах 25° — тот же цвет на глаз в кадре (с поправкой на
// свет и печать). Кремовый #dcc28d и лайм #a9cf3c — ΔE 12.6: «акцент = кожица груши» не прошёл бы.
const toLin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export const rgbToOklab = (r: number, g: number, b: number): [number, number, number] => {
  const R = toLin(r), G = toLin(g), B = toLin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B), m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B), s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};
const hexRgb = (h: string): [number, number, number] => { let x = h.replace("#", ""); if (x.length === 3) x = x.split("").map((c) => c + c).join(""); return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)) as [number, number, number]; };
export const deltaE = (a: string, b: string): number => { const p = rgbToOklab(...hexRgb(a)), q = rgbToOklab(...hexRgb(b)); return 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
export const GROUND_DE = 6;

// Доминантные цвета из сырых пикселей RGBA (картинка, уменьшенная до ~48 px): ячейки OKLab,
// доля ≥ minShare; прозрачные пиксели (вырезка) не считаются.
export const dominantColors = (rgba: Uint8Array | Buffer, channels: number, minShare = 0.02): Array<{ hex: string; share: number }> => {
  const cells = new Map<string, { n: number; r: number; g: number; b: number }>();
  let n = 0;
  for (let i = 0; i + channels - 1 < rgba.length; i += channels) {
    if (channels === 4 && rgba[i + 3] < 128) continue;
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    const [L, A, B] = rgbToOklab(r, g, b);
    const k = `${Math.round(L * 12)}|${Math.round(A * 25)}|${Math.round(B * 25)}`;
    const c = cells.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
    c.n++; c.r += r; c.g += g; c.b += b;
    cells.set(k, c);
    n++;
  }
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return [...cells.values()].filter((c) => c.n / Math.max(1, n) >= minShare).sort((p, q) => q.n - p.n)
    .map((c) => ({ hex: `#${hex(c.r / c.n)}${hex(c.g / c.n)}${hex(c.b / c.n)}`, share: +(c.n / n).toFixed(3) }));
};
// Акцент взят из картинки, если он в пределах GROUND_DE от одного из её заметных цветов.
export const nearestColor = (accent: string, colors: Array<{ hex: string; file?: string }>): { hex: string; de: number; file?: string } | null => {
  let best: { hex: string; de: number; file?: string } | null = null;
  for (const c of colors) { const de = deltaE(accent, c.hex); if (!best || de < best.de) best = { hex: c.hex, de: +de.toFixed(1), file: c.file }; }
  return best;
};
export const groundedIn = (accent: string, colors: Array<{ hex: string; file?: string }>): { hex: string; de: number; file?: string } | null => {
  const best = nearestColor(accent, colors);
  if (!best || best.de >= GROUND_DE) return null;
  const p = oklch(accent), q = oklch(best.hex);
  const dh = Math.min(Math.abs(p.h - q.h), 360 - Math.abs(p.h - q.h));
  return p.C < 0.05 || dh < 25 ? best : null;
};
