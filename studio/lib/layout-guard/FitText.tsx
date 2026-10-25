// <FitText> — текст в коробке: кегль подбирается ОДИН раз (после загрузки шрифта) так,
// чтобы строки влезли по ширине и высоте, коробка проходит страховку (внутри безопасной
// зоны), подпись проверяется на кегль/контраст/число слов. Перенос — по словам, без
// висячих предлогов; ширина не меняется от кадра к кадру.
import React, { useMemo } from "react";
import type { Box } from "../layout";
import { Guarded, useStage, useTextCheck } from "../stage";
import { type FontSpec, fitFontSize, splitWords, useFontReady, wrapWords } from "./text";

export const FitText: React.FC<{
  id: string; text: string; box: Box; font: FontSpec; color: string;
  /** фон под текстом — для проверки контраста (цвет плашки или средний цвет картинки) */
  background?: string;
  maxSize?: number; minSize?: number; lineHeight?: number; maxLines?: number;
  align?: "left" | "center" | "right"; valign?: "top" | "middle" | "bottom";
  style?: React.CSSProperties; textStyle?: React.CSSProperties;
  /** проверять как подпись (кегль ≥ 3.5 % высоты, ≤ 7 слов) */
  caption?: boolean;
}> = ({ id, text, box, font, color, background, maxSize, minSize, lineHeight = 1.1, maxLines = 3, align = "center", valign = "middle", style, textStyle, caption }) => {
  const st = useStage();
  const ready = useFontReady(font);
  const words = useMemo(() => splitWords(text), [text]);
  const layout = useMemo(() => {
    if (!ready) return null;
    // От большего кегля к меньшему: первый, при котором раскладка влезает в коробку.
    let size = fitFontSize([words.reduce((a, b) => (a.length > b.length ? a : b), "")], font, { maxWidth: box.w, max: maxSize ?? box.h, min: minSize ?? 8 });
    for (; size > (minSize ?? 8); size = Math.floor(size * 0.95)) {
      const w = wrapWords(words, font, size, { maxWidth: box.w, lineHeight, align });
      if (w.lines <= maxLines && w.height <= box.h) return { size, w };
    }
    return { size, w: wrapWords(words, font, size, { maxWidth: box.w, lineHeight, align }) };
  }, [ready, words, font, box.w, box.h, maxSize, minSize, lineHeight, maxLines, align]);
  useTextCheck(id, caption ? { fontSizePx: layout?.size ?? 999, color, background, words: words.length } : { fontSizePx: layout?.size ?? 999, color, background, minFrac: 0.02 });
  if (!layout) return null;
  const { size, w } = layout;
  const ox = align === "left" ? 0 : align === "right" ? box.w - w.width : (box.w - w.width) / 2;
  const oy = valign === "top" ? 0 : valign === "bottom" ? box.h - w.height : (box.h - w.height) / 2;
  void st;
  return (
    <Guarded id={id} box={box} style={style}>
      <div data-id={id} style={{ position: "absolute", left: ox, top: oy, width: w.width, height: w.height }}>
        {w.words.map((p) => (
          <span key={p.i} style={{ position: "absolute", left: p.x, top: p.y, whiteSpace: "nowrap", fontFamily: font.family, fontWeight: font.weight, fontStyle: font.style, fontSize: size, lineHeight: `${lineHeight * size}px`, letterSpacing: font.letterSpacingEm ? `${font.letterSpacingEm}em` : undefined, color, ...textStyle }}>{p.text}</span>
        ))}
      </div>
    </Guarded>
  );
};
