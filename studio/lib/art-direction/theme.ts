// Стиль-библия ролика (theme.json) — тип, проверка, подключение шрифтов.
// Тема — решение директора под этот бриф, а не выбор из списка: пресеты в
// studio/skills/art-direction/presets.json — только стартовые точки.
import type React from "react";
import fontsList from "../fonts-cyrillic.json";
import { contrast } from "../paper-kit/kit/color";

export type FontRef = { module: string; weight: string; style?: "normal" | "italic"; letterSpacingEm?: number; uppercase?: boolean };

export type Theme = {
  name: string;
  why?: string;                       // одна-две фразы: почему такой стиль для этого брифа
  register?: string;                  // словесный регистр: «тёплая бумага», «ночной войлок»…
  palette: {
    bg: string; ink: string; accent: string;
    surface?: string; muted?: string; onAccent?: string; accent2?: string; dark?: string; onDark?: string;
    [k: string]: string | undefined;
  };
  fonts: { display: FontRef; text?: FontRef; accent?: FontRef; caption?: FontRef; mono?: FontRef; script?: FontRef };
  material?: string;                  // paper | felt | clay | lowpoly | toon | soft3d | watercolor | pixel | flat | photo …
  imagePromptSuffix?: string;         // общий хвост промптов studio image — один мир у всех картинок
  motion?: { temperament?: "still" | "calm" | "lively" | "punchy"; notes?: string };
  captions?: { look?: "clean" | "shadow" | "plate" | "outline"; sizeFrac?: number; highlight?: "active" | "keywords" | "both" | "none"; uppercase?: boolean };
  platform?: "reels" | "tiktok" | "shorts" | "story" | "feed45" | "square" | "landscape" | "none";
  // Язык форм: из чего сделаны плашки, карточки и подписи. Без него компоненты берут свои
  // умолчания — и все ролики студии выглядят одной «таблеткой с мягкой тенью».
  shapes?: Shapes;
  sample?: string;                    // фраза для образца шрифтов на листе стиля
  // Подача текста — решение, а не умолчание хелпера: «2 строки по центру, вторая курсивом-акцентом»
  // у студии уже стала подписью. Варианты — kinetic-typography «словарь подачи».
  // Структура подачи (по ней студия сравнивает облик роликов): anchor — где живёт текст,
  // scale — крупность главной строки.
  type?: { lockup?: string; align?: "left" | "center" | "right" | "mixed" | "free"; anchor?: "top" | "over-hero" | "bottom" | "in-world"; scale?: "giant" | "large" | "medium"; brand?: string };
  // Вторая палитра от другого предмета брифа — когда board.ts находит «семью» соседей: лист
  // стиля показывает обе, выбор глазами.
  paletteAlt?: { bg: string; ink: string; accent: string; why?: string };
  // Язык фото (generated-imagery): свет, оптика, цветокор, площадка — вместо «тёплого окна и боке».
  photo?: { light?: string; lens?: string; grade?: string; set?: string };
  // Опознавательные знаки героя (рисованного тоже): видны в каждом бите (хвост, повязка, шарф).
  hero?: { marks?: string[]; product?: string[] };
  // Форма рассказа и финала — выбор под бриф (art-direction / CLAUDE.md шаг 2).
  story?: { form?: string; endCard?: string };
  [k: string]: unknown;
};

export type Shapes = {
  corner?: "none" | "small" | "round" | "pill" | "torn" | "tape" | "stamp";
  shadow?: "none" | "hard-offset" | "soft";
  border?: "none" | "rule" | "ink-line";
  plate?: "none" | "bar" | "box" | "sticker" | "marker-highlight";
};

// CSS для своей плашки/карточки из theme.shapes (size — кегль или высота плашки, px).
export const shapeStyle = (sh: Shapes | undefined, o: { size: number; ink?: string; shadowColor?: string } ): React.CSSProperties => {
  const r = { none: 0, small: o.size * 0.12, round: o.size * 0.35, pill: o.size * 2, torn: 0, tape: 2, stamp: o.size * 0.08 }[sh?.corner ?? "small"];
  const ink = o.ink ?? "#111";
  const shadow = { none: undefined, "hard-offset": `${Math.round(o.size * 0.08)}px ${Math.round(o.size * 0.08)}px 0 ${o.shadowColor ?? ink}`, soft: `0 ${Math.round(o.size * 0.25)}px ${Math.round(o.size * 0.6)}px ${o.shadowColor ?? "rgba(0,0,0,.18)"}` }[sh?.shadow ?? "none"];
  const border = { none: undefined, rule: `${Math.max(1, Math.round(o.size * 0.03))}px solid ${ink}`, "ink-line": `${Math.max(2, Math.round(o.size * 0.06))}px solid ${ink}` }[sh?.border ?? "none"];
  return { borderRadius: r, boxShadow: shadow, border, ...(sh?.corner === "stamp" ? { transform: "rotate(-3deg)" } : {}) };
};

// Смесь цветов в OKLCH: синий + оранжевый дают тёплый бирюзовый/золотой, а не грязно-серый
// (sRGB-смесь `mix` гасит насыщенность посередине — «нагретая вода» становится хаки).
const toLin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const toSrgb = (c: number) => { const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055; return Math.round(Math.min(1, Math.max(0, v)) * 255); };
const oklab = (h: string): [number, number, number] => {
  const [r, g, b] = rgb(h).map(toLin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};
const fromOklab = ([L, A, B]: [number, number, number]) => {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3, m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3, s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const r = toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), g = toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), b = toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
};
// OKLCH цвета: светлота L (0…1), насыщенность C, тон h (градусы).
export const oklch = (hex: string): { L: number; C: number; h: number } => {
  const [L, A, B] = oklab(hex);
  return { L, C: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
};
// «Та же семья палитры»: фон одной светлоты (оба тёмные или оба светлые) и акцент того же
// тона (Δh < 25°) и близкой насыщенности. Так четыре разных ролика сошлись в «тёмное + лайм».
export const samePaletteFamily = (a: { bg?: string; accent?: string }, b: { bg?: string; accent?: string }): boolean => {
  const ok = (x?: string) => Boolean(x && /^#[0-9a-f]{3,8}$/i.test(x));
  if (!ok(a.bg) || !ok(b.bg) || !ok(a.accent) || !ok(b.accent)) return false;
  const ba = oklch(a.bg!), bb = oklch(b.bg!), aa = oklch(a.accent!), ab = oklch(b.accent!);
  if ((ba.L < 0.5) !== (bb.L < 0.5)) return false;
  if (aa.C < 0.05 || ab.C < 0.05) return false; // серый акцент — не «тон»
  const dh = Math.min(Math.abs(aa.h - ab.h), 360 - Math.abs(aa.h - ab.h));
  return dh < 25 && Math.abs(aa.C - ab.C) < 0.1;
};
// Почти противоположные оттенки (синий ↔ оранжевый) по умолчанию идут через тёплый
// бирюзовый/золотой (как свет и вода в природе), а не через пурпур; via — выбрать путь явно.
export const mixOk = (a: string, b: string, t: number, o: { via?: "auto" | "short" | "long" } = {}): string => {
  const [L1, A1, B1] = oklab(a), [L2, A2, B2] = oklab(b);
  const C1 = Math.hypot(A1, B1), C2 = Math.hypot(A2, B2);
  let h1 = Math.atan2(B1, A1), h2 = Math.atan2(B2, A2);
  if (h2 - h1 > Math.PI) h2 -= 2 * Math.PI; else if (h1 - h2 > Math.PI) h1 -= 2 * Math.PI;
  const via = o.via ?? "auto";
  const longPath = () => { if (h2 > h1) h2 -= 2 * Math.PI; else h2 += 2 * Math.PI; };
  if (via === "long") longPath();
  else if (via === "auto" && Math.abs(h2 - h1) > (150 * Math.PI) / 180) {
    const deg = (x: number) => (((x * 180) / Math.PI) % 360 + 360) % 360;
    const midShort = deg((h1 + h2) / 2);
    if (!(midShort >= 60 && midShort <= 200)) longPath();
  }
  const L = L1 + (L2 - L1) * t, C = C1 + (C2 - C1) * t, h = h1 + (h2 - h1) * t;
  return fromOklab([L, C * Math.cos(h), C * Math.sin(h)]);
};

export type ThemeIssue = { level: "FAIL" | "WARN"; msg: string };

type FontEntry = { family: string; module: string; styles: Record<string, string[]> };
const FONTS = fontsList as FontEntry[];
export const fontEntry = (module: string) => FONTS.find((f) => f.module === module);

const hex = (s?: string) => typeof s === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s.trim());
const rgb = (h: string) => { let x = h.replace("#", ""); if (x.length === 3) x = x.split("").map((c) => c + c).join(""); return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)); };
// Грубое цветовое расстояние (redmean), 0…~765: < 60 — почти один цвет.
export const colorDistance = (a: string, b: string) => {
  const [r1, g1, b1] = rgb(a), [r2, g2, b2] = rgb(b);
  const rm = (r1 + r2) / 2;
  return Math.sqrt((2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2);
};

// Проверка темы: кириллица во всех шрифтах, контраст пар «текст/фон», различимость акцента.
export const checkTheme = (t: Theme): ThemeIssue[] => {
  const out: ThemeIssue[] = [];
  const p = t.palette ?? ({} as Theme["palette"]);
  for (const k of ["bg", "ink", "accent"] as const) if (!hex(p[k])) out.push({ level: "FAIL", msg: `palette.${k}: нужен цвет #rrggbb` });
  for (const [k, v] of Object.entries(p)) if (v !== undefined && !hex(v)) out.push({ level: "FAIL", msg: `palette.${k}: «${v}» — не #rrggbb` });
  const pair = (fg: string | undefined, bg: string | undefined, name: string, min: number, level: ThemeIssue["level"] = "FAIL") => {
    if (!hex(fg) || !hex(bg)) return;
    const c = contrast(fg!, bg!);
    if (c < min) out.push({ level, msg: `${name}: контраст ${c.toFixed(2)} < ${min}` });
  };
  pair(p.ink, p.bg, "ink на bg", 4.5);
  pair(p.ink, p.surface, "ink на surface", 4.5);
  // Плашки с крупным жирным текстом: 3 — минимум (WCAG для крупного), 4.5 — спокойно читается.
  pair(p.onAccent, p.accent, "onAccent на accent (плашки крупным жирным)", 3);
  if (hex(p.onAccent) && hex(p.accent) && contrast(p.onAccent!, p.accent) >= 3 && contrast(p.onAccent!, p.accent) < 4.5) out.push({ level: "WARN", msg: `onAccent на accent: контраст ${contrast(p.onAccent!, p.accent).toFixed(2)} — только крупный жирный текст (≥ 3.5 % высоты), мелкое на плашке не пишите` });
  pair(p.onDark, p.dark, "onDark на dark", 4.5);
  pair(p.muted, p.bg, "muted на bg", 3, "WARN");
  pair(p.accent, p.bg, "accent на bg (крупный текст/акцент)", 3, "WARN");
  if (hex(p.accent) && hex(p.accent2) && colorDistance(p.accent, p.accent2!) < 90) out.push({ level: "WARN", msg: "accent и accent2 почти одного цвета — второй акцент не нужен" });
  if (hex(p.accent) && hex(p.bg) && colorDistance(p.accent, p.bg) < 120) out.push({ level: "WARN", msg: "accent сливается с bg" });
  for (const [role, f] of Object.entries(t.fonts ?? {})) {
    if (!f) continue;
    const e = fontEntry(f.module);
    if (!e) { out.push({ level: "FAIL", msg: `fonts.${role}: модуля ${f.module} нет среди шрифтов с кириллицей (studio fonts)` }); continue; }
    const st = e.styles[f.style ?? "normal"];
    if (!st) out.push({ level: "FAIL", msg: `fonts.${role}: у ${e.family} нет начертания ${f.style}` });
    else if (!st.includes(String(f.weight))) out.push({ level: "FAIL", msg: `fonts.${role}: у ${e.family} ${f.style ?? "normal"} нет веса ${f.weight} (есть ${st.join(",")})` });
  }
  if (!t.fonts?.display) out.push({ level: "FAIL", msg: "fonts.display обязателен" });
  if (!t.shapes) out.push({ level: "WARN", msg: "shapes не задан (corner, shadow, border, plate): без него карточки и подписи берут умолчания компонентов — у всех роликов студии одна «таблетка с мягкой тенью». Форма — из материала мира (рваный край, скотч, штамп, брусок, без плашки)" });
  const families = new Set(Object.values(t.fonts ?? {}).filter(Boolean).map((f) => f!.module));
  if (families.size > 3) out.push({ level: "WARN", msg: `${families.size} семейства шрифтов — обычно хватает двух-трёх` });
  return out;
};
