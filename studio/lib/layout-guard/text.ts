// Текст без «дыхания»: шрифт загружен до первого замера, ширина считается один раз
// (на страницу подписи, на заголовок), а не на каждый кадр.
//   • useFontReady(css, weight, style) — кадр ждёт, пока начертание реально загружено;
//     до этого замеры дали бы ширину запасного шрифта (и прыжок раскладки потом);
//   • measureWidth(text, font) — ширина строки через canvas (кэш по шрифту и тексту);
//   • wrapWords(words, maxWidth, font) — раскладка слов по строкам с абсолютными x
//     (слова потом рисуются по этим x: смена цвета/прозрачности не двигает соседей);
//   • fitFontSize(lines, maxWidth, font, {max, min}) — кегль, при котором самая длинная
//     строка входит в ширину.
import { useEffect, useState } from "react";
import { cancelRender, continueRender, delayRender } from "remotion";

export type FontSpec = { family: string; weight?: string | number; style?: "normal" | "italic"; letterSpacingEm?: number };

const fontString = (f: FontSpec, sizePx: number) => `${f.style ?? "normal"} ${f.weight ?? 400} ${sizePx}px ${f.family}`;

const fontReady = new Set<string>();
const readyKey = (f: FontSpec) => `${f.family}|${f.weight ?? 400}|${f.style ?? "normal"}`;

// Есть ли в document.fonts загруженное начертание, покрывающее кириллицу и латиницу.
// (@remotion/google-fonts добавляет FontFace в document.fonts только ПОСЛЕ загрузки, так что
// document.fonts.load() до этого молча меряет запасной шрифт — ждём сами.)
const covers = (range: string, cp: number) => range.split(",").some((r) => {
  const m = r.trim().replace(/^U\+/i, "");
  if (m.includes("?")) { const lo = parseInt(m.replace(/\?/g, "0"), 16), hi = parseInt(m.replace(/\?/g, "F"), 16); return cp >= lo && cp <= hi; }
  const [a, b] = m.split("-").map((x) => parseInt(x, 16));
  return cp >= a && cp <= (Number.isFinite(b) ? b : a);
});
const familyName = (css: string) => css.split(",")[0].trim().replace(/^['"]|['"]$/g, "");
export const fontFaceReady = (f: FontSpec): boolean => {
  const fam = familyName(f.family), w = String(f.weight ?? 400), st = f.style ?? "normal";
  const faces = Array.from(document.fonts as unknown as Iterable<FontFace>).filter((x) => familyName(x.family) === fam && x.style === st && x.status === "loaded" && (x.weight === w || x.weight.split(" ").length === 2));
  return faces.some((x) => covers(x.unicodeRange, 0x0416)) && faces.some((x) => covers(x.unicodeRange, 0x0041));
};

// Кадр ждёт загрузку начертания (delayRender). Возвращает true, когда можно мерить.
// При размонтировании до загрузки ручка отпускается (иначе рендер ждёт её вечно).
export const useFontReady = (f: FontSpec | FontSpec[]): boolean => {
  const list = Array.isArray(f) ? f : [f];
  const key = list.map(readyKey).join("+");
  const [ready, setReady] = useState(() => typeof document !== "undefined" && list.every((x) => fontReady.has(readyKey(x)) || fontFaceReady(x)));
  const [handle] = useState(() => (ready ? null : delayRender(`font ${key}`, { timeoutInMilliseconds: 60000 })));
  useEffect(() => {
    if (handle === null) return;
    let n = 0, released = false, timer: ReturnType<typeof setTimeout> | undefined;
    const release = () => { if (!released) { released = true; continueRender(handle); } };
    const poll = () => {
      if (list.every(fontFaceReady)) {
        list.forEach((x) => fontReady.add(readyKey(x)));
        setReady(true);
        release();
        return;
      }
      if (++n > 1500) { cancelRender(new Error(`шрифт не загрузился: ${key} (useCyrillicFont для этого начертания вызван?)`)); return; }
      timer = setTimeout(poll, 20);
    };
    poll();
    return () => { if (timer) clearTimeout(timer); release(); };
  }, [handle]); // eslint-disable-line react-hooks/exhaustive-deps
  return ready;
};

let ctx: CanvasRenderingContext2D | null = null;
const cache = new Map<string, number>();

// Ширина строки в px при кегле sizePx. Шрифт должен быть загружен (useFontReady).
export const measureWidth = (text: string, f: FontSpec, sizePx: number, o: { tabular?: boolean } = {}): number => {
  const k = `${fontString(f, sizePx)}|${f.letterSpacingEm ?? 0}|${o.tabular ? 1 : 0}|${text}`;
  const hit = cache.get(k);
  if (hit !== undefined) return hit;
  if (!ctx) ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return text.length * sizePx * 0.55;
  ctx.font = fontString(f, sizePx);
  (ctx as unknown as { fontVariantNumeric?: string }).fontVariantNumeric = o.tabular ? "tabular-nums" : "normal";
  const w = ctx.measureText(text).width + Math.max(0, text.length - 1) * (f.letterSpacingEm ?? 0) * sizePx;
  cache.set(k, w);
  return w;
};

export type PlacedWord = { i: number; text: string; x: number; y: number; w: number; line: number };
export type WrapResult = { words: PlacedWord[]; lines: number; width: number; height: number; lineWidths: number[] };

// Раскладка по строкам готовых ширин (слова могут быть разными шрифтами и кеглями).
// space — пробел в px, lineH — высота строки в px. Висячие короткие предлоги/союзы
// переносятся вместе со следующим словом.
export const wrapWidths = (
  texts: string[], ws: number[],
  o: { maxWidth: number; space: number; lineH: number; align?: "left" | "center" | "right" },
): WrapResult => {
  const lines: number[][] = [[]];
  let lw = 0;
  texts.forEach((_, i) => {
    const cur = lines[lines.length - 1];
    const add = (cur.length ? o.space : 0) + ws[i];
    if (cur.length && lw + add > o.maxWidth) {
      const last = cur[cur.length - 1];
      const carry = cur.length > 1 && isHanging(texts[last]) ? [cur.pop() as number] : [];
      lines.push([...carry, i]);
      lw = carry.reduce((s, j) => s + ws[j] + o.space, 0) + ws[i];
    } else { cur.push(i); lw += add; }
  });
  const lineWidths = lines.map((l) => l.reduce((s, j, k) => s + ws[j] + (k ? o.space : 0), 0));
  const width = Math.max(...lineWidths);
  const out: PlacedWord[] = [];
  lines.forEach((l, li) => {
    const lw2 = lineWidths[li];
    let x = o.align === "left" ? 0 : o.align === "right" ? width - lw2 : (width - lw2) / 2;
    for (const j of l) { out.push({ i: j, text: texts[j], x, y: li * o.lineH, w: ws[j], line: li }); x += ws[j] + o.space; }
  });
  return { words: out.sort((p, q) => p.i - q.i), lines: lines.length, width, height: lines.length * o.lineH, lineWidths };
};

// Раскладка слов одним шрифтом (ширина maxWidth, межстрочный lineHeight·size).
export const wrapWords = (
  texts: string[], f: FontSpec, sizePx: number,
  o: { maxWidth: number; lineHeight?: number; align?: "left" | "center" | "right"; spaceEm?: number },
): WrapResult => wrapWidths(texts, texts.map((t) => measureWidth(t, f, sizePx)), {
  maxWidth: o.maxWidth, space: (o.spaceEm ?? 0.28) * sizePx, lineH: (o.lineHeight ?? 1.12) * sizePx, align: o.align,
});

// Слова для раскладки: тире и одиночная пунктуация приклеиваются к предыдущему слову
// неразрывным пробелом (строка не начинается с «—»).
export const splitWords = (text: string): string[] => {
  const out: string[] = [];
  for (const t of text.split(/\s+/).filter(Boolean)) {
    if (out.length && /^[—–\-:;!?…»)]+$/.test(t)) out[out.length - 1] += "\u00a0" + t;
    else out.push(t);
  }
  return out;
};

const HANGING = new Set(["в", "во", "и", "а", "но", "на", "с", "со", "к", "ко", "у", "о", "об", "от", "до", "за", "по", "из", "не", "ни", "же", "the", "a", "an", "of", "to"]);
export const isHanging = (w: string) => HANGING.has(w.toLowerCase().replace(/[^a-zа-яё]/g, ""));

// Кегль, при котором каждая строка входит в maxWidth (не больше max, не меньше min).
export const fitFontSize = (lines: string[], f: FontSpec, o: { maxWidth: number; max: number; min?: number }): number => {
  const w100 = Math.max(...lines.map((l) => measureWidth(l, f, 100)));
  const s = w100 > 0 ? (o.maxWidth / w100) * 100 : o.max;
  return Math.max(o.min ?? 0, Math.min(o.max, Math.floor(s)));
};
