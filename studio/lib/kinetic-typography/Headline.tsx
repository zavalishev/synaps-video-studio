// <Headline> — заголовок/крючок из сегментов (одно начертание или с акцентом другим шрифтом/
// цветом), слова появляются по очереди. Кегль подбирается один раз так, чтобы всё влезло в
// коробку (maxLines строк); balance — строки равной длины; коробка проходит страховку кадра.
// Подача (theme.type.lockup) — решение директора: курсив-акцент — один вариант из многих.
//   <Headline id="hook" box={z.title} start={0} align="left" balance
//     segments={["Дорогая аренда —", { text: "а прибыль выше?", color: "#C9542F" }]}
//     font={{ family: heavy, weight: 800 }} color="#201A16" />
import React, { useMemo } from "react";
import { useCurrentFrame } from "remotion";
import type { Box } from "../layout";
import { Guarded, useTextCheck } from "../stage";
import { type FontSpec, measureWidth, splitWords, useFontReady, wrapWidths } from "../layout-guard/text";

export type Segment = string | { text: string; accent?: boolean; color?: string };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (t: number) => 1 - (1 - t) ** 3;

export const Headline: React.FC<{
  id: string; box: Box; segments: Segment[];
  font: FontSpec; accentFont?: FontSpec; color: string; accentColor?: string;
  start?: number;          // кадр начала появления
  stagger?: number;        // кадров между словами (3); 0 — всё сразу
  wordFrames?: number;     // длительность появления слова (10)
  rise?: number;           // подъём слова при появлении, доля кегля (0.25); 0 — только прозрачность
  exitAt?: number;         // кадр начала ухода (растворение за exitFrames)
  exitFrames?: number;
  maxSize?: number; minSize?: number; maxLines?: number; lineHeight?: number;
  align?: "left" | "center" | "right"; valign?: "top" | "middle" | "bottom";
  accentScale?: number;    // курсив обычно визуально мельче — подрастить (1.08)
  background?: string;     // для проверки контраста
  uppercase?: boolean;
  balance?: boolean;       // строки примерно равной длины (как text-wrap: balance): «Спелый / мандарин.» не висит словом
}> = (p) => {
  const frame = useCurrentFrame();
  const fonts = useMemo(() => (p.accentFont ? [p.font, p.accentFont] : [p.font]), [p.font, p.accentFont]);
  const ready = useFontReady(fonts);
  const tokens = useMemo(() => p.segments.flatMap((s) => {
    const seg = typeof s === "string" ? { text: s } : s;
    return splitWords(seg.text).map((w) => ({ text: p.uppercase ? w.toLocaleUpperCase("ru-RU") : w, accent: Boolean((seg as { accent?: boolean }).accent), color: (seg as { color?: string }).color }));
  }), [p.segments, p.uppercase]);
  const lh = p.lineHeight ?? 1.05, aS = p.accentScale ?? 1.08;
  const layout = useMemo(() => {
    if (!ready) return null;
    const fontOf = (a: boolean) => (a && p.accentFont ? p.accentFont : p.font);
    const lay = (s: number, mw = p.box.w) => wrapWidths(tokens.map((t) => t.text), tokens.map((t) => measureWidth(t.text, fontOf(t.accent), t.accent ? s * aS : s)), { maxWidth: mw, space: 0.25 * s, lineH: lh * s, align: p.align ?? "left" });
    let s = p.maxSize ?? Math.round(p.box.h / 2);
    let L = lay(s);
    while (s > (p.minSize ?? 24) && (L.lines > (p.maxLines ?? 3) || L.height > p.box.h || L.width > p.box.w)) { s = Math.floor(s * 0.96); L = lay(s); }
    // Баланс: сужаем ширину строки, пока число строк не растёт, — длины строк выравниваются.
    if (p.balance && L.lines > 1) {
      for (let mw = L.width * 0.97; mw > p.box.w * 0.3; mw *= 0.97) { const B = lay(s, mw); if (B.lines > L.lines) break; L = B; }
    }
    return { s, L };
  }, [ready, tokens, p.font, p.accentFont, p.box.w, p.box.h, p.maxSize, p.minSize, p.maxLines, p.align, p.balance, lh, aS]);
  useTextCheck(p.id, { fontSizePx: layout?.s ?? 999, color: p.color, background: p.background, minFrac: 0.03 });
  if (!layout) return null;
  const { s, L } = layout;
  const ox = (p.align ?? "left") === "left" ? 0 : p.align === "right" ? p.box.w - L.width : (p.box.w - L.width) / 2;
  const va = p.valign ?? "middle";
  const oy = va === "top" ? 0 : va === "bottom" ? p.box.h - L.height : (p.box.h - L.height) / 2;
  const start = p.start ?? 0, stagger = p.stagger ?? 3, dur = p.wordFrames ?? 10, rise = p.rise ?? 0.25;
  const out = p.exitAt === undefined ? 1 : 1 - clamp01((frame - p.exitAt) / (p.exitFrames ?? 8));
  return (
    <Guarded id={p.id} box={p.box}>
      <div data-id={p.id} style={{ position: "absolute", left: ox, top: oy, width: L.width, height: L.height, opacity: out }}>
        {L.words.map((w) => {
          const tk = tokens[w.i];
          const k = easeOut(clamp01((frame - start - w.i * stagger) / dur));
          const f = tk.accent && p.accentFont ? p.accentFont : p.font;
          const size = tk.accent ? s * aS : s;
          return (
            <span key={w.i} style={{
              position: "absolute", left: w.x, top: w.y + (lh * s - lh * size) / 2, whiteSpace: "nowrap",
              fontFamily: f.family, fontWeight: f.weight, fontStyle: f.style, fontSize: size, lineHeight: `${lh * size}px`,
              letterSpacing: f.letterSpacingEm ? `${f.letterSpacingEm}em` : undefined,
              color: tk.color ?? (tk.accent ? p.accentColor ?? p.color : p.color),
              opacity: k, transform: `translateY(${(1 - k) * rise * s}px)`,
            }}>{tk.text}</span>
          );
        })}
      </div>
    </Guarded>
  );
};
