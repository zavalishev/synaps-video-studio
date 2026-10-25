// Шрифты с кириллицей. Список всех 293 семейств Google с кириллицей — `studio fonts [поиск]`
// (studio/lib/fonts-cyrillic.json). Директор импортирует модуль нужного семейства сам:
//
//   import * as Manrope from "@remotion/google-fonts/Manrope";
//   import * as Playfair from "@remotion/google-fonts/PlayfairDisplay";
//   const heavy = useCyrillicFont(Manrope, { weights: ["800"] });
//   const accent = useCyrillicFont(Playfair, { style: "italic", weights: ["700"] });
//   <div style={{ fontFamily: heavy }}>…</div>
//
// Проверка: у запрошенного начертания нет кириллицы — рендер падает громко (а не рисует
// «квадратики» или запасным шрифтом). Загрузка ждёт файлы шрифта (delayRender внутри
// @remotion/google-fonts), поэтому первые кадры не уходят с запасным шрифтом — это тоже
// источник «прыжка» ширины текста.
//
// Локальный шрифт (файл в public/fonts/…): useLocalFont("Имя", "fonts/x.woff2", "700").
import { useState } from "react";
import { cancelRender, continueRender, delayRender, staticFile } from "remotion";

type FontMeta = { fontFamily: string; fonts: Record<string, Record<string, Record<string, string>>> };
export type GoogleFontModule = {
  getInfo: () => unknown;
  loadFont: (style?: any, options?: any) => { fontFamily: string; waitUntilDone: () => Promise<unknown> }; // eslint-disable-line @typescript-eslint/no-explicit-any
};

const loaded = new Map<string, string>();

// Без интернета (сервер, закрытая сеть): файлы шрифтов лежат в public/fonts-offline/<семейство>/
// — их кладёт сборка (bundleJob при STUDIO_FONTS_DIR), а флаг подставляет DefinePlugin.
declare const __STUDIO_FONTS_OFFLINE__: boolean | undefined;
const OFFLINE = typeof __STUDIO_FONTS_OFFLINE__ !== "undefined" && __STUDIO_FONTS_OFFLINE__ === true;
// Имя файла в зеркале — то же правило, что в scripts/fonts-offline.mjs.
const offlineName = (url: string) => { const n = url.split("/").pop() ?? url; return n.length > 200 ? n.slice(-120) : n; };
type FontInfo = FontMeta & { importName: string; unicodeRanges: Record<string, string> };
const loadOffline = (info: FontInfo, style: string, weights: string[], subsets: string[]) => {
  if (typeof document === "undefined") return;
  const h = delayRender(`font ${info.fontFamily} (offline)`);
  const faces = weights.flatMap((w) => subsets.map((s) => {
    const url = info.fonts[style][w][s];
    const file = staticFile(`fonts-offline/${info.importName}/${offlineName(url)}`);
    return new FontFace(info.fontFamily, `url(${file}) format("woff2")`, { weight: w, style, unicodeRange: info.unicodeRanges[s] })
      .load().then((f) => { document.fonts.add(f); });
  }));
  Promise.all(faces).then(() => continueRender(h)).catch((e) => cancelRender(new Error(`шрифт ${info.fontFamily}: нет локального файла (STUDIO_FONTS_DIR) — ${e}`)));
};

// Не хук: можно звать на уровне модуля. Возвращает CSS font-family (с запасным).
export const loadCyrillicFont = (mod: GoogleFontModule, o: { style?: "normal" | "italic"; weights: string[]; extraSubsets?: string[] }): string => {
  const info = mod.getInfo() as FontMeta;
  const style = o.style ?? "normal";
  const key = `${info.fontFamily}|${style}|${o.weights.join(",")}`;
  const hit = loaded.get(key);
  if (hit) return hit;
  const st = info.fonts[style];
  if (!st) throw new Error(`шрифт ${info.fontFamily}: нет начертания ${style}`);
  for (const w of o.weights) {
    if (!st[w]) throw new Error(`шрифт ${info.fontFamily}: нет веса ${w} (${style}); есть ${Object.keys(st).join(",")}`);
    if (!("cyrillic" in st[w])) throw new Error(`шрифт ${info.fontFamily} ${w} ${style}: нет кириллицы — возьмите другой (studio fonts)`);
  }
  const subsets = ["cyrillic", "latin", ...(o.extraSubsets ?? [])].filter((s) => o.weights.every((w) => s in st[w]));
  let fontFamily: string;
  if (OFFLINE) { loadOffline(info as FontInfo, style, o.weights, subsets); fontFamily = info.fontFamily; }
  else fontFamily = mod.loadFont(style, { weights: o.weights, subsets }).fontFamily;
  const css = `${fontFamily}, sans-serif`;
  loaded.set(key, css);
  return css;
};

export const useCyrillicFont = (mod: GoogleFontModule, o: { style?: "normal" | "italic"; weights: string[]; extraSubsets?: string[] }): string => {
  const [css] = useState(() => {
    try { return loadCyrillicFont(mod, o); } catch (e) { cancelRender(e as Error); return "sans-serif"; }
  });
  return css;
};

const localLoaded = new Map<string, Promise<void>>();
export const useLocalFont = (family: string, file: string, weight = "400", style: "normal" | "italic" = "normal"): string => {
  const [handle] = useState(() => {
    const key = `${family}|${file}|${weight}|${style}`;
    if (typeof document === "undefined" || localLoaded.has(key)) return null;
    const h = delayRender(`font ${family}`);
    const p = new FontFace(family, `url(${staticFile(file)})`, { weight, style }).load().then((f) => { document.fonts.add(f); });
    localLoaded.set(key, p);
    p.then(() => continueRender(h)).catch((e) => cancelRender(e));
    return h;
  });
  void handle;
  return `'${family}', sans-serif`;
};

// Подбор кегля под ширину (один раз на текст, не на каждый кадр — иначе ширина «дышит»).
// Шрифт должен быть уже загружен (useCyrillicFont выше по дереву).
export { fitText, fitTextOnNLines, measureText, fillTextBox } from "@remotion/layout-utils";
