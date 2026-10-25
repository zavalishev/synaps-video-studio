// <Captions> — субтитры по словам озвучки (public/words.json от `studio voice`).
// Раскладка страницы считается один раз (после загрузки шрифта) и не меняется, пока
// страница на экране: слова только меняют прозрачность/цвет — соседи не сдвигаются, ширина
// не «дышит». Кегль один на весь ролик (подбирается так, чтобы каждая страница влезла в
// maxLines строк полосы). Всё — функции кадра.
//
//   const words = useWords();                       // из @studio
//   <Captions words={words?.words ?? []} font={{ family: heavy, weight: 800 }}
//             color="#fff" accent="#E0632F" keywords={["прибыль выше"]} look="plate" />
import React, { useMemo } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { Box } from "../layout";
import { useStage, useTextCheck } from "../stage";
import { type FontSpec, measureWidth, useFontReady, wrapWidths } from "../layout-guard/text";
import { zones } from "../layout-guard/zones";
import { type CapPage, type CapWord, keywordIndices, keywordRanges, type PaginateOpts, pageAt, paginate } from "./paginate";

export type CaptionLook = "clean" | "shadow" | "plate" | "outline";

export type CaptionsProps = {
  words: CapWord[];
  font: FontSpec;
  color: string;                 // цвет произнесённого слова
  accent?: string;               // цвет активного слова / плашки ключевого слова
  onAccent?: string;             // текст на плашке ключевого слова
  keywords?: string[];           // ключевые фразы (плашка), подбираются по словам подряд
  highlight?: "active" | "keywords" | "both" | "none"; // что выделять (по умолчанию both)
  ghost?: number;                // прозрачность ещё не сказанных слов страницы (0 — скрыты)
  look?: CaptionLook;            // clean — без подложки, shadow — мягкая тень, plate — плашка, outline — обводка
  plateColor?: string;           // цвет плашки (look="plate"), любой CSS-цвет, можно с альфой
  plateRadius?: number;          // радиус плашки, px (по умолчанию 0.42 кегля — «таблетка»; 0 — брусок, как в газете)
  outlineColor?: string;
  zone?: Box;                    // полоса субтитров (по умолчанию zones().caption)
  sizeFrac?: number;             // желаемый кегль, доля высоты кадра (0.052)
  minSizeFrac?: number;          // не меньше (0.036)
  maxLines?: number;             // строк на странице (2)
  lineHeight?: number;           // 1.08
  uppercase?: boolean;
  pages?: PaginateOpts;          // как резать на страницы
  wordInFrames?: number;         // появление слова (4 кадра)
  leadFrames?: number;           // слово загорается на N кадров раньше звука (1)
  background?: string;           // фон под подписью — для проверки контраста (с плашкой — что под плашкой)
  id?: string;
  startFrame?: number;           // кадр, с которого идёт words.json (если ролик со вступлением)
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (t: number) => 1 - (1 - t) ** 3;

export const Captions: React.FC<CaptionsProps> = (p) => {
  const frame = useCurrentFrame() - (p.startFrame ?? 0);
  const { fps } = useVideoConfig();
  const st = useStage();
  const zone = p.zone ?? zones(st.W, st.H).caption;
  const ready = useFontReady(p.font);
  const up = p.uppercase ?? false;
  const shown = (t: string) => (up ? t.toLocaleUpperCase("ru-RU") : t);
  const words = useMemo(() => p.words.map((w, gi) => ({ ...w, gi })), [p.words]);
  const ranges = useMemo(() => keywordRanges(words, p.keywords), [words, p.keywords]);
  const keys = useMemo(() => keywordIndices(words, p.keywords), [words, p.keywords]);
  const pages = useMemo(() => paginate(words, { ...p.pages, keepTogether: ranges }), [words, p.pages, ranges]);
  const hl = p.highlight ?? "both";
  const look = p.look ?? "shadow";
  const lineHeight = p.lineHeight ?? 1.08;
  const padX = look === "plate" ? 0.42 : 0, padY = look === "plate" ? 0.26 : 0;

  // Кегль на весь ролик + раскладка каждой страницы — один раз.
  const layout = useMemo(() => {
    if (!ready || !pages.length) return null;
    const maxLines = p.maxLines ?? 2;
    let size = Math.round(st.H * (p.sizeFrac ?? 0.052));
    const min = Math.round(st.H * (p.minSizeFrac ?? 0.036));
    const lay = (s: number) => pages.map((pg) => {
      const texts = pg.words.map((w) => shown(w.text));
      const pad = 0.18 * s; // поля плашки ключевой фразы — только по её внешним краям
      const isK = (k: number) => k >= 0 && k < pg.words.length && keys.has(pg.words[k].gi!);
      const ws = texts.map((t, k) => measureWidth(t, p.font, s) + (isK(k) && !isK(k - 1) ? pad : 0) + (isK(k) && !isK(k + 1) ? pad : 0));
      return wrapWidths(texts, ws, { maxWidth: zone.w - 2 * padX * s, space: 0.26 * s, lineH: lineHeight * s, align: "center" });
    });
    let L = lay(size);
    while (size > min && L.some((w) => w.lines > maxLines || w.width > zone.w - 2 * padX * size)) { size = Math.floor(size * 0.95); L = lay(size); }
    return { size, pages: L };
  }, [ready, pages, keys, p.font, p.sizeFrac, p.minSizeFrac, p.maxLines, zone.w, lineHeight, up, padX]); // eslint-disable-line react-hooks/exhaustive-deps

  const t = frame / fps;
  const lead = (p.leadFrames ?? 1) / fps;
  const page: CapPage | null = pageAt(pages, t, lead);
  const size = layout?.size ?? 0;
  const maxOnPage = Math.max(1, ...pages.map((pg) => pg.words.length));
  useTextCheck(p.id ?? "captions", { fontSizePx: size || 999, color: p.color, background: look === "plate" ? (p.plateColor ?? "rgba(17,17,17,.78)") : p.background, backdrop: look === "plate" ? p.background : undefined, words: maxOnPage });
  if (!layout || !page) return null;

  const L = layout.pages[page.i];
  const pf = (page.start - lead) * fps;
  const enter = easeOut(clamp01((frame - pf) / 4));
  const exit = page.i === pages.length - 1 || pages[page.i + 1].start > page.showUntil + 0.01
    ? clamp01((page.showUntil * fps - frame) / 6) : 1;
  const blockW = L.width + 2 * padX * size, blockH = L.height + 2 * padY * size;
  const left = zone.x + (zone.w - blockW) / 2, top = zone.y + (zone.h - blockH) / 2;
  const accent = p.accent ?? p.color;
  const wordIn = p.wordInFrames ?? 4;
  const textShadow = look === "shadow" ? "0 2px 3px rgba(0,0,0,.35), 0 6px 24px rgba(0,0,0,.45)" : undefined;
  const stroke = look === "outline" ? { WebkitTextStroke: `${Math.max(2, size * 0.12)}px ${p.outlineColor ?? "#111"}`, paintOrder: "stroke fill" } : {};

  return (
    <div data-id={p.id ?? "captions"} style={{ position: "absolute", left, top, width: blockW, height: blockH, opacity: enter * exit, transform: `translateY(${(1 - enter) * size * 0.18}px)` }}>
      {look === "plate" ? <div style={{ position: "absolute", inset: 0, borderRadius: p.plateRadius ?? size * 0.42, background: p.plateColor ?? "rgba(17,17,17,.78)" }} /> : null}
      {L.words.map((pw) => {
        const w = page.words[pw.i];
        const wf = (w.start - lead) * fps;
        const k = easeOut(clamp01((frame - wf) / wordIn));
        const spoken = frame >= wf;
        const active = spoken && t < (w.end ?? w.start) + 0.02;
        const isKey = keys.has(w.gi!) && (hl === "keywords" || hl === "both");
        const ghost = p.ghost ?? 0.3;
        const op = ghost + (1 - ghost) * k;
        const sameLine = (j: number) => j >= 0 && j < L.words.length && L.words[j].line === pw.line && keys.has(page.words[j].gi!);
        const joinL = isKey && sameLine(pw.i - 1), joinR = isKey && sameLine(pw.i + 1);
        const pillPad = isKey && !keys.has(page.words[pw.i - 1]?.gi ?? -1) ? 0.18 * size : 0;
        const space = 0.26 * size;
        const r = size * 0.2;
        const col = isKey && spoken ? (p.onAccent ?? "#fff") : active && (hl === "active" || hl === "both") ? accent : p.color;
        return (
          <div key={pw.i} style={{ position: "absolute", left: padX * size + pw.x, top: padY * size + pw.y, width: pw.w, height: lineHeight * size }}>
            {isKey ? (
              <div style={{
                position: "absolute", left: joinL ? -space / 2 - 0.5 : 0, top: size * 0.06, width: pw.w + (joinL ? space / 2 + 0.5 : 0) + (joinR ? space / 2 + 0.5 : 0), height: lineHeight * size - size * 0.08,
                borderRadius: `${joinL ? 0 : r}px ${joinR ? 0 : r}px ${joinR ? 0 : r}px ${joinL ? 0 : r}px`, background: accent,
                clipPath: `inset(0 ${(1 - k) * 100}% 0 0)`, opacity: spoken ? 1 : 0,
              }} />
            ) : null}
            <span style={{
              position: "absolute", left: pillPad, top: 0, whiteSpace: "nowrap",
              fontFamily: p.font.family, fontWeight: p.font.weight, fontStyle: p.font.style, fontSize: size, lineHeight: `${lineHeight * size}px`,
              letterSpacing: p.font.letterSpacingEm ? `${p.font.letterSpacingEm}em` : undefined,
              color: col, opacity: op, transform: `translateY(${(1 - k) * size * 0.08}px)`, textShadow, ...stroke,
            }}>{shown(w.text)}</span>
          </div>
        );
      })}
    </div>
  );
};
