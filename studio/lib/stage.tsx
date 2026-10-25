// React-обёртки страховки кадра. Всё опционально: директор может рисовать как хочет, но
// подвижные слои и фоны удобнее вести через эти компоненты — они сами проверяют себя и
// в режиме проверки (inputProps.probe = true, флаг --probe у still/render) рисуют рамки:
// зелёная — в порядке, красная — нарушение.
import React, { createContext, useContext, useMemo } from "react";
import { AbsoluteFill, getInputProps, Img, useCurrentFrame, useVideoConfig } from "remotion";
import {
  type Box, coverRect, defaultMargins, guardBox, type GuardMode, kenBurns, type KenBurnsKey, type Margins, reportGuard, safeArea, textCheck,
} from "./layout";
import { type Cam2D, type CamKey, camera2D, cameraSample, checkMotionAt, MOTION_LIMITS, worldTransform } from "./camera";
import { useImageSize } from "./media";

type StageCtx = { W: number; H: number; margins: Margins; safe: Box; probe: boolean };
const Ctx = createContext<StageCtx | null>(null);

export const isProbe = (): boolean => {
  try { return Boolean((getInputProps() as { probe?: unknown }).probe); } catch { return false; }
};

// Корень кадра: фон, поля безопасной зоны, режим проверки. Кладётся в Video.tsx один раз
// (или в каждую сцену, если у сцен разные поля).
export const Stage: React.FC<{ bg?: string; margins?: Partial<Margins>; probe?: boolean; children?: React.ReactNode; style?: React.CSSProperties }> = ({ bg, margins, probe, children, style }) => {
  const { width: W, height: H } = useVideoConfig();
  const value = useMemo(() => {
    const m = { ...defaultMargins(W, H), ...margins };
    return { W, H, margins: m, safe: safeArea(W, H, m), probe: probe ?? isProbe() };
  }, [W, H, margins, probe]);
  return (
    <Ctx.Provider value={value}>
      <AbsoluteFill style={{ background: bg, overflow: "hidden", ...style }}>
        {children}
        {value.probe ? <SafeOutline box={value.safe} /> : null}
      </AbsoluteFill>
    </Ctx.Provider>
  );
};

export const useStage = (): StageCtx => {
  const c = useContext(Ctx);
  const { width: W, height: H } = useVideoConfig();
  if (c) return c;
  const m = defaultMargins(W, H);
  return { W, H, margins: m, safe: safeArea(W, H, m), probe: isProbe() };
};

const SafeOutline: React.FC<{ box: Box }> = ({ box }) => (
  <div data-audit-skip style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, outline: "2px dashed rgba(0,160,255,.7)", pointerEvents: "none" }} />
);

export const GuardOutline: React.FC<{ box: Box; ok: boolean; label?: string }> = ({ box, ok, label }) => (
  <div data-audit-skip style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, outline: `3px solid ${ok ? "rgba(0,200,80,.9)" : "rgba(255,0,0,.95)"}`, pointerEvents: "none", zIndex: 9999 }}>
    {label ? <span style={{ position: "absolute", top: 2, left: 4, font: "600 20px monospace", color: ok ? "#0a5" : "#f00", background: "rgba(255,255,255,.75)", padding: "0 4px" }}>{label}</span> : null}
  </div>
);

// Хук: проверить коробку слоя на этом кадре. mode "inside" — внутри безопасной зоны
// (или area), "cover" — покрывает весь кадр. fix (по умолчанию true) — вернуть исправленную.
export const useGuardedBox = (id: string, box: Box, o: { mode?: GuardMode; area?: Box; fix?: boolean; tolerancePx?: number } = {}) => {
  const frame = useCurrentFrame();
  const st = useStage();
  return guardBox(id, frame, box, { mode: o.mode, area: o.area ?? st.safe, W: st.W, H: st.H, fix: o.fix, tolerancePx: o.tolerancePx });
};

// Слой в абсолютной коробке (px кадра), проверенный страховкой. Содержимое растягивается
// на коробку. Для поворота/масштаба передайте style.transform (коробка — до трансформа).
export const Guarded: React.FC<{
  id: string; box: Box; mode?: GuardMode; area?: Box; fix?: boolean; style?: React.CSSProperties; children?: React.ReactNode;
}> = ({ id, box, mode, area, fix, style, children }) => {
  const st = useStage();
  const r = useGuardedBox(id, box, { mode, area, fix });
  return (
    <>
      <div style={{ position: "absolute", left: r.box.x, top: r.box.y, width: r.box.w, height: r.box.h, ...style }}>{children}</div>
      {st.probe ? <GuardOutline box={r.box} ok={r.ok} label={id} /> : null}
    </>
  );
};

// Картинка-фон, всегда покрывающая кадр, с необязательным медленным наездом/панорамой
// (Ken Burns). Размер исходника берётся из файла, если не передан.
// minZoom (1.04) — запас по краям: при zoom 1.0 край картинки ложится ровно в край кадра и
// страховка видит «обрезано краем». hero — картинка и есть главный предмет (фото товара во
// весь кадр): ставит data-hero, самопроверка меряет героя по ней, без обходных вырезок.
export const CoverImage: React.FC<{
  src: string; imgW?: number; imgH?: number; start?: number; end?: number; from?: KenBurnsKey; to?: KenBurnsKey;
  ease?: (t: number) => number; style?: React.CSSProperties; id?: string; minZoom?: number; hero?: boolean;
}> = ({ src, imgW, imgH, start = 0, end, from: from0, to: to0, ease, style, id = "cover", minZoom = 1.04, hero }) => {
  const zClamp = (k?: KenBurnsKey): KenBurnsKey | undefined => (k ? { ...k, zoom: Math.max(minZoom, k.zoom ?? 1.06) } : k);
  const from = zClamp(from0), to = zClamp(to0);
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const st = useStage();
  const size = useImageSize(imgW && imgH ? null : src);
  const w = imgW ?? size?.w, h = imgH ?? size?.h;
  if (!w || !h) return null;
  const sample = (f: number) => kenBurns(f, { imgW: w, imgH: h, W: st.W, H: st.H, start, end: end ?? durationInFrames, from, to: to ?? from, ease });
  const box = sample(frame);
  const g = guardBox(id, frame, box, { mode: "cover", area: st.safe, W: st.W, H: st.H });
  // Растяжение исходника (с наездом): больше ×1.5 на телефоне читается как мыло. Обычная
  // причина — фон не той ориентации (горизонтальный в 9:16) или сильный наезд.
  const up = g.box.w / w;
  if (up > 1.5) reportGuard({ id, kind: "cover-upscale", frame, amount: Math.round(up * 100) / 100, detail: { src: [w, h], shown: [Math.round(g.box.w), Math.round(g.box.h)] } });
  checkMotionAt(id, frame, (f) => { const b = sample(f); return { x: b.x + b.w / 2, y: b.y + b.h / 2, zoom: b.w / w }; }, { fps, W: st.W, H: st.H });
  return <Img src={src} data-id={id} {...(hero ? { "data-hero": "" } : {})} style={{ position: "absolute", left: g.box.x, top: g.box.y, width: g.box.w, height: g.box.h, maxWidth: "none", ...style }} />;
};

// 2D-камера над миром worldW×worldH: дети рисуются в координатах мира. Ключи камеры —
// [{f, x, y, zoom, rotate}] (x, y — точка мира в центре экрана). contain (по умолчанию да) —
// экран не выходит за мир. Скорость и смены направления проверяются на каждом кадре.
export const CameraView: React.FC<{
  keys: CamKey[]; worldW: number; worldH: number; contain?: boolean; id?: string;
  limits?: Partial<typeof MOTION_LIMITS>; children?: React.ReactNode; style?: React.CSSProperties;
}> = ({ keys, worldW, worldH, contain = true, id = "camera", limits, children, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const st = useStage();
  const camAt = (f: number): Cam2D => camera2D(f, keys, { viewport: { w: st.W, h: st.H }, world: contain ? { w: worldW, h: worldH } : undefined });
  const cam = camAt(frame);
  checkMotionAt(id, frame, cameraSample(camAt), { fps, W: st.W, H: st.H, limits });
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: worldW, height: worldH, transformOrigin: "0 0", transform: worldTransform(cam, st.W, st.H), ...style }}>
        {children}
      </div>
    </AbsoluteFill>
  );
};

// Проверка подписи на этом кадре (кегль, контраст, число слов). Ничего не рисует.
export const useTextCheck = (id: string, o: { fontSizePx: number; color?: string; background?: string; backdrop?: string; words?: number; minFrac?: number; maxWords?: number }) => {
  const frame = useCurrentFrame();
  const st = useStage();
  return textCheck(id, frame, { ...o, H: st.H });
};
