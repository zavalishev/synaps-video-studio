// Скилл generated-imagery: сгенерированные картинки в кадре.
//   import { STYLES, ROLES, stylePrompt, Cutout, Backdrop, PhotoLayers, GRADES } from "@studio/generated-imagery";
// Генерация — инструмент `studio image` (платно, кэш); подготовка вырезки (обрезка полей,
// снятие ореола, проверка на тёмном и светлом) — studio/skills/generated-imagery/cutout.ts;
// промпт из стиля и роли — studio/skills/generated-imagery/prompt.ts.
// Здесь — как картинка встаёт в кадр:
//   • Backdrop — фон, который ВСЕГДА покрывает кадр (CoverImage), с медленным наездом и
//     цветокором (GRADES: эпоха, ночь, тепло) — эпоху дешевле сделать цветом, чем генерацией;
//   • Cutout — вырезка, вписанная в коробку (contain), стоит на нижней кромке коробки, с
//     контактной тенью и спокойным «дыханием»; коробка и движение проверяются страховкой
//     (outside-safe, motion-*) — вырезка не уедет за край.
import React from "react";
import { Img, useCurrentFrame, useVideoConfig } from "remotion";
import { CoverImage, useGuardedBox, useStage, GuardOutline } from "../stage";
import { containRect, type Box, type KenBurnsKey } from "../layout";
import { checkMotionAt } from "../camera";
import { useImageSize } from "../media";
import { fall, progress, squash } from "../motion";

export { STYLES, ROLES, styleById, stylePrompt } from "./prompt";
export type { ImageStyle } from "./prompt";

// ---------- цветокор ----------
// CSS-фильтры для фона/вырезок (НЕОБЯЗАТЕЛЬНО, стартовые точки).
export const GRADES = {
  none: undefined,
  era: "sepia(0.85) contrast(1.08) saturate(0.85) brightness(0.98)",     // «старое фото», эпоха
  night: "brightness(0.62) saturate(0.8) hue-rotate(195deg) contrast(1.05)",
  warm: "saturate(1.08) sepia(0.15) brightness(1.02)",
  muted: "saturate(0.7) contrast(0.95) brightness(1.03)",                 // фон под текст
  mono: "grayscale(1) contrast(1.1)",
} as const;

// Фон: покрывает кадр при любом наезде (coverRect), опционально цветокор и затемнение-
// подложка под подписи (scrim: доля 0..1 снизу/сверху).
export const Backdrop: React.FC<{
  src: string; start?: number; end?: number; from?: KenBurnsKey; to?: KenBurnsKey; grade?: keyof typeof GRADES | string;
  scrim?: { bottom?: number; top?: number; color?: string }; id?: string;
}> = ({ src, start, end, from, to, grade, scrim, id = "backdrop" }) => {
  const filter = grade ? (grade in GRADES ? GRADES[grade as keyof typeof GRADES] : grade) : undefined;
  const c = scrim?.color ?? "0,0,0";
  return (
    <>
      <CoverImage src={src} start={start} end={end} from={from} to={to} id={id} style={filter ? { filter } : undefined} />
      {scrim ? (
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(180deg, rgba(${c},${(scrim.top ?? 0) * 0.85}) 0%, rgba(${c},0) 32%, rgba(${c},0) 58%, rgba(${c},${(scrim.bottom ?? 0) * 0.85}) 100%)` }} />
      ) : null}
    </>
  );
};

// Вырезка в коробке box (px кадра): вписана целиком (contain), прижата вниз (align 1) —
// «стоит» на нижней кромке. shadow — контактная тень-эллипс под ней (opacity 0..1).
// enter — вход за dur кадров:
//   kind "land" (по умолчанию) — предмет с весом: опускается на dy px с ускорением, на
//        опоре — короткое сжатие, тень растёт по мере приближения; прозрачен только первые
//        3 кадра (нет «призрака» — полупрозрачного стекла поверх стола);
//   kind "mask" — открывается шторкой снизу вверх, сразу непрозрачный;
//   kind "fade" — проявление со сдвигом (старое поведение): для света, дыма, бликов, а не
//        для твёрдых предметов — стекло и полупрозрачное в «fade» читается двойной экспозицией.
// float — «дыхание» ±amp px с периодом period с. Страховка: итоговая коробка в кадре
// проверяется (inside safe area или area), скорость — checkMotionAt.
export const Cutout: React.FC<{
  src: string; box: Box; alignX?: number; alignY?: number; shadow?: number; shadowColor?: string;
  enter?: { at: number; dur?: number; dy?: number; kind?: "land" | "mask" | "fade" }; float?: { amp: number; period: number; phase?: number };
  flip?: boolean; rotate?: number; filter?: string; area?: Box; id?: string; style?: React.CSSProperties;
}> = ({ src, box, alignX = 0, alignY = 1, shadow = 0.25, shadowColor = "0,0,0", enter, float, flip, rotate = 0, filter, area, id = "cutout", style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const st = useStage();
  const size = useImageSize(src);
  const kind = enter?.kind ?? "land";
  const dur = enter?.dur ?? 18;
  const offsetAt = (f: number) => {
    const fl = float ? float.amp * Math.sin((2 * Math.PI * f) / (fps * float.period) + (float.phase ?? 0)) : 0;
    if (!enter) return { dy: fl, opacity: 1, reveal: 1 };
    if (kind === "fade") { const e = progress(f, enter.at, dur); return { dy: (1 - e) * (enter.dy ?? 30) + fl, opacity: e, reveal: 1 }; }
    if (kind === "mask") { const e = progress(f, enter.at, dur); return { dy: fl, opacity: f < enter.at ? 0 : 1, reveal: e }; }
    const e = fall(f, enter.at, dur);
    return { dy: -(1 - e) * (enter.dy ?? 40) + fl, opacity: f < enter.at ? 0 : Math.min(1, (f - enter.at + 1) / 3), reveal: 1 };
  };
  const r = size ? containRect(size.w, size.h, box, alignX, alignY) : box;
  const o = offsetAt(frame);
  const sq = enter && kind === "land" ? squash(frame, enter.at + dur, { amount: 0.05, dur: 8 }) : { sx: 1, sy: 1 };
  // Приземление — игра предмета: на время входа слой помечен data-acting (самопроверка не
  // считает сжатие «рывком кадра»).
  const acting = Boolean(enter && kind === "land" && frame >= enter.at && frame <= enter.at + dur + 16);
  const shown = { ...r, y: r.y + o.dy };
  const g = useGuardedBox(id, shown, { area: area ?? st.safe, fix: false });
  checkMotionAt(id, frame, (f) => { const q = offsetAt(f); return { x: r.x + r.w / 2, y: r.y + r.h / 2 + q.dy }; }, { fps, W: st.W, H: st.H });
  if (!size) return null;
  return (
    <>
      {shadow > 0 ? (
        <div style={{ position: "absolute", left: r.x + r.w * 0.18, width: r.w * 0.64, top: r.y + r.h - r.h * 0.025, height: r.h * 0.05, borderRadius: "50%", background: `radial-gradient(closest-side, rgba(${shadowColor},${shadow}), rgba(${shadowColor},0))`, opacity: o.opacity * (1 - Math.min(0.6, Math.abs(o.dy) / (r.h * 0.2))) }} />
      ) : null}
      <Img src={src} data-acting={acting ? "" : undefined} style={{ position: "absolute", left: shown.x, top: shown.y, width: shown.w, height: shown.h, opacity: o.opacity, transform: `${flip ? "scaleX(-1) " : ""}rotate(${rotate}deg) scale(${sq.sx.toFixed(4)}, ${sq.sy.toFixed(4)})`, transformOrigin: "50% 100%", clipPath: o.reveal < 1 ? `inset(${((1 - o.reveal) * 100).toFixed(2)}% 0 0 0)` : undefined, filter, maxWidth: "none", ...style }} />
      {st.probe ? <GuardOutline box={g.box} ok={g.ok} label={id} /> : null}
    </>
  );
};

// ---------- 2.5D из фото: слои на разной глубине под одним наездом ----------
// Фото-материал без глубины — это слайд с Ken Burns. Здесь фон и вырезки (тот же предмет,
// вырезанный cutout.ts, пар, листья, рука) едут с разной скоростью: передний план — сильнее,
// фон — слабее (параллакс 1.5–3 % ширины). Слой hero получает data-hero сам — самопроверка
// меряет героя по нему, без обходных вырезок «ради проверки».
//   <PhotoLayers bg={staticFile("img/cafe.png")} start={0} end={120} push={0.06} drift={{ x: -0.02 }}
//     layers={[{ src: staticFile("img/cup.cut.png"), box: { x: 160, y: 620, w: 760, h: 900 }, depth: 1, hero: true, shadow: 0.3 }]} />
// depth 0 — стоит, 1 — полный наезд/сдвиг; фон всегда покрывает кадр (CoverImage, depth bgDepth).
export const PhotoLayers: React.FC<{
  bg: string; start?: number; end?: number; push?: number; drift?: { x?: number; y?: number }; bgDepth?: number; grade?: string;
  layers: Array<{ src: string; box: Box; depth?: number; hero?: boolean; shadow?: number; id?: string; style?: React.CSSProperties }>;
}> = ({ bg, start = 0, end, push = 0.06, drift, bgDepth = 0.35, grade, layers }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const st = useStage();
  const e = end ?? durationInFrames;
  const dx = (drift?.x ?? 0) * st.W, dy = (drift?.y ?? 0) * st.H;
  const filter = grade ? (grade in GRADES ? GRADES[grade as keyof typeof GRADES] : grade) : undefined;
  const at = (f: number, depth: number) => { const k = progress(f, start, Math.max(1, e - start)); return { s: 1 + push * depth * k, x: dx * depth * k, y: dy * depth * k }; };
  const fast = layers.reduce((m, l) => Math.max(m, l.depth ?? 1), 0);
  checkMotionAt("photo-layers", frame, (f) => { const p = at(f, fast); return { x: st.W / 2 + p.x, y: st.H / 2 + p.y, zoom: p.s }; }, { fps, W: st.W, H: st.H });
  return (
    <>
      <CoverImage src={bg} start={start} end={e} from={{ zoom: 1.04, panX: 0 }} to={{ zoom: 1.04 + push * bgDepth, panX: drift?.x ? -Math.sign(drift.x) * bgDepth * 0.5 : 0 }} id="photo-bg" style={filter ? { filter } : undefined} />
      {layers.map((l, i) => {
        const p = at(frame, l.depth ?? 1);
        const cx = st.W / 2, cy = st.H / 2;
        return (
          <div key={i} data-id={l.id ?? (l.hero ? "hero" : `layer-${i}`)} {...(l.hero ? { "data-hero": "" } : {})}
            style={{ position: "absolute", left: 0, top: 0, width: st.W, height: st.H, transformOrigin: `${cx}px ${cy}px`, transform: `translate(${p.x}px, ${p.y}px) scale(${p.s})`, pointerEvents: "none" }}>
            {l.shadow ? <div style={{ position: "absolute", left: l.box.x + l.box.w * 0.15, top: l.box.y + l.box.h * 0.94, width: l.box.w * 0.7, height: l.box.h * 0.08, borderRadius: "50%", background: `radial-gradient(closest-side, rgba(0,0,0,${l.shadow}), rgba(0,0,0,0))` }} /> : null}
            <Img src={l.src} style={{ position: "absolute", left: l.box.x, top: l.box.y, width: l.box.w, height: l.box.h, objectFit: "contain", objectPosition: "50% 100%", filter, ...l.style }} />
          </div>
        );
      })}
    </>
  );
};
