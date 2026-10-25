// Имена семейств бумажного набора. useFonts грузит их из public/fonts ролика (положите туда
// woff2 под OFL, если используете хук); без хука — системные запасные.
import { cancelRender, continueRender, delayRender, staticFile } from "remotion";
import { useEffect, useState } from "react";

export const MONO = "'JetBrains Mono', monospace";
export const DISPLAY = "'Oswald', 'Manrope', sans-serif";
export const HEAVY = "'Manrope', sans-serif";

const FACES: Array<[string, string, string]> = [];
for (const subset of ["cyrillic", "latin"]) {
  for (const w of ["500", "700"]) FACES.push(["JetBrains Mono", w, `fonts/jetbrains-mono-${subset}-${w}-normal.woff2`]);
  for (const w of ["600", "700"]) FACES.push(["Oswald", w, `fonts/oswald-${subset}-${w}-normal.woff2`]);
  FACES.push(["Manrope", "800", `fonts/manrope-${subset}-800-normal.woff2`]);
}

let loading: Promise<void> | undefined;
const load = (): Promise<void> => {
  if (typeof document === "undefined") return Promise.resolve();
  if (!loading) {
    loading = Promise.all(FACES.map(async ([family, weight, file]) => {
      const face = new FontFace(family, `url(${staticFile(file)}) format('woff2')`, { weight });
      await face.load();
      document.fonts.add(face);
    })).then(() => undefined);
  }
  return loading;
};

export const useFonts = (): void => {
  const [handle] = useState(() => delayRender("fonts"));
  useEffect(() => {
    // Не нашёлся шрифт — рендер падает громко, а не рисует запасным.
    load().then(() => continueRender(handle)).catch((e) => cancelRender(e));
  }, [handle]);
};
