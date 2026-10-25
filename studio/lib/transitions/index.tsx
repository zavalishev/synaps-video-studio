// Скилл transitions: мягкие мотивированные переходы и проверка монтажа до рендера.
// Импорт: import { Edit, layoutEdit, checkEdit, dissolve, push, dipTo, softWipe, softIris, settle, softTiming } from "@studio/transitions";
//
// Главное: переход — это пунктуация, а не украшение. Склейка на слове — тоже переход и часто
// лучший. Ни один пресет здесь не «вжухает»: нет блюра сильнее 6 px, нет пролёта через весь
// кадр, нет пружин с перелётом. Быстрота достигается монтажом на слове, а не размазанным кадром.
import React, { createContext, useContext } from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import type { TransitionPresentation, TransitionPresentationComponentProps, TransitionTiming } from "@remotion/transitions";

export { TransitionSeries, linearTiming };
export type { TransitionPresentation, TransitionTiming };

// Плавность переходов: мягкий старт и мягкая посадка (та же, что у камеры студии).
export const TEASE = Easing.bezier(0.45, 0, 0.2, 1);
// Пиковая скорость TEASE относительно средней (для расчёта лимитов сдвига).
export const TEASE_PEAK = 2.1;

// Для растворений: синусная плавность (пик 1.57 от средней) — без «щелчка» посередине.
// Растворение с резкой кривой на 20 кадрах между светлым и тёмным кадром probe читает как склейку.
export const SOFT = Easing.inOut(Easing.sin);
const LINEAR = (t: number) => t;

export const softTiming = (durationInFrames: number, easing: (t: number) => number = TEASE): TransitionTiming =>
  linearTiming({ durationInFrames, easing });

type P<T extends Record<string, unknown>> = TransitionPresentationComponentProps<T>;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// ---------------------------------------------------------------- растворение
// Входящий кадр проявляется поверх уходящего (уходящий не гаснет — без провала в фон).
// blur — лёгкая расфокусировка входящего (0..6 px), settle — входящий «оседает» с масштаба 1+settle.
type DissolveProps = { blur: number; settle: number };
const DissolveC: React.FC<P<DissolveProps>> = ({ presentationProgress: p, presentationDirection: dir, passedProps: o, children }) => {
  if (dir === "exiting") return <AbsoluteFill>{children}</AbsoluteFill>;
  const b = Math.min(6, o.blur) * (1 - p);
  return (
    <AbsoluteFill style={{ opacity: p, transform: o.settle ? `scale(${1 + o.settle * (1 - p)})` : undefined, filter: b > 0.05 ? `blur(${b}px)` : undefined }}>
      {children}
    </AbsoluteFill>
  );
};
export const dissolve = (o: Partial<DissolveProps> = {}): TransitionPresentation<DissolveProps> => ({ component: DissolveC, props: { blur: o.blur ?? 0, settle: o.settle ?? 0 } });

// ---------------------------------------------------------------- мягкий сдвиг
// Новый кадр въезжает на небольшое расстояние (доля ширины/высоты) и проявляется; старый
// чуть уходит в обратную сторону. Это НЕ slide через весь кадр: пролёт целиком = «вжух».
type PushProps = { direction: "left" | "right" | "up" | "down"; distance: number; parallax: number };
const PushC: React.FC<P<PushProps>> = ({ presentationProgress: p, presentationDirection: dir, passedProps: o, children }) => {
  const sx = { left: -1, right: 1, up: 0, down: 0 }[o.direction], sy = { left: 0, right: 0, up: -1, down: 1 }[o.direction];
  // direction — куда «едет» содержимое: "left" — новый приходит справа и смещается влево.
  const d = o.distance * 100;
  if (dir === "exiting") {
    const k = o.parallax * p;
    return <AbsoluteFill style={{ transform: `translate(${sx * d * k}%, ${sy * d * k}%)` }}>{children}</AbsoluteFill>;
  }
  const k = 1 - p;
  return <AbsoluteFill style={{ opacity: clamp01(p * 1.4), transform: `translate(${-sx * d * k}%, ${-sy * d * k}%)` }}>{children}</AbsoluteFill>;
};
export const push = (o: Partial<PushProps> = {}): TransitionPresentation<PushProps> => ({
  component: PushC, props: { direction: o.direction ?? "left", distance: o.distance ?? 0.06, parallax: o.parallax ?? 0.5 },
});
// Наибольший сдвиг (доля кадра), при котором переход длиной dur кадров не быстрее лимита
// 0.6 % ширины за кадр в пике.
export const pushMaxDistance = (dur: number, maxSpeedFrac = 0.006) => (maxSpeedFrac * dur) / TEASE_PEAK;

// ---------------------------------------------------------------- через цвет
// Уходящий гаснет в цвет, входящий проявляется из него. Пунктуация раздела: «светлое ↔ тёмное»,
// конец главы. hold — доля перехода, когда на экране только цвет (0..0.4).
type DipProps = { color: string; hold: number };
const DipC: React.FC<P<DipProps>> = ({ presentationProgress: p, presentationDirection: dir, passedProps: o, children }) => {
  // dipTo ждёт ЛИНЕЙНУЮ шкалу (Edit так и делает); плавность — внутри каждой половины.
  const h = Math.min(0.4, o.hold) / 2;
  const sm = (t: number) => t * t * (3 - 2 * t);
  if (dir === "exiting") {
    const a = sm(clamp01(p / (0.5 - h)));
    return <AbsoluteFill>{children}<AbsoluteFill style={{ background: o.color, opacity: a }} /></AbsoluteFill>;
  }
  const a = sm(clamp01((p - 0.5 - h) / (0.5 - h)));
  return <AbsoluteFill style={{ opacity: a }}>{children}</AbsoluteFill>;
};
export const dipTo = (o: Partial<DipProps> = {}): TransitionPresentation<DipProps> => ({ component: DipC, props: { color: o.color ?? "#000000", hold: o.hold ?? 0.1 } });

// ---------------------------------------------------------------- мягкая шторка
// Новый кадр открывается мягкой границей под углом (как свет, проходящий по кадру).
type WipeProps = { angle: number; feather: number };
const WipeC: React.FC<P<WipeProps>> = ({ presentationProgress: p, presentationDirection: dir, passedProps: o, children }) => {
  if (dir === "exiting") return <AbsoluteFill>{children}</AbsoluteFill>;
  const f = o.feather;
  const a = (p * (1 + f) - f) * 100, b = p * (1 + f) * 100;
  const mask = `linear-gradient(${o.angle}deg, #000 ${a}%, transparent ${b}%)`;
  return <AbsoluteFill style={{ WebkitMaskImage: mask, maskImage: mask }}>{children}</AbsoluteFill>;
};
export const softWipe = (o: Partial<WipeProps> = {}): TransitionPresentation<WipeProps> => ({ component: WipeC, props: { angle: o.angle ?? 100, feather: o.feather ?? 0.35 } });

// ---------------------------------------------------------------- круг из точки
// Новый кадр раскрывается кругом из точки (x, y — доли кадра): из объекта, о котором дальше
// речь (лампа → комната, кнопка → экран). Мотивированный переход.
type IrisProps = { x: number; y: number; feather: number };
const IrisC: React.FC<P<IrisProps>> = ({ presentationProgress: p, presentationDirection: dir, passedProps: o, children }) => {
  if (dir === "exiting") return <AbsoluteFill>{children}</AbsoluteFill>;
  const R = 150 * p; // % от размера (с запасом на углы)
  const F = Math.min(o.feather * 100, R * 0.15); // мягкий край, но маленький круг — не пятно
  const mask = `radial-gradient(circle at ${o.x * 100}% ${o.y * 100}%, #000 ${Math.max(0, R - F)}%, transparent ${R}%)`;
  return <AbsoluteFill style={{ WebkitMaskImage: mask, maskImage: mask }}>{children}</AbsoluteFill>;
};
export const softIris = (o: Partial<IrisProps> = {}): TransitionPresentation<IrisProps> => ({ component: IrisC, props: { x: o.x ?? 0.5, y: o.y ?? 0.5, feather: o.feather ?? 0.18 } });

// ---------------------------------------------------------------- наезд-растворение
// Уходящий слегка приближается (1 → 1+zoom) и растворяется, входящий оседает с 1−zoom/2 к 1.
// «Входим глубже» в тему. zoom ≤ 0.08, иначе это уже рывок.
type SettleProps = { zoom: number };
const SettleC: React.FC<P<SettleProps>> = ({ presentationProgress: p, presentationDirection: dir, passedProps: o, children }) => {
  const z = Math.min(0.08, o.zoom);
  if (dir === "exiting") return <AbsoluteFill style={{ transform: `scale(${1 + z * p})` }}>{children}</AbsoluteFill>;
  return <AbsoluteFill style={{ opacity: p, transform: `scale(${1 - (z / 2) * (1 - p)})` }}>{children}</AbsoluteFill>;
};
export const settle = (o: Partial<SettleProps> = {}): TransitionPresentation<SettleProps> => ({ component: SettleC, props: { zoom: o.zoom ?? 0.05 } });

// ================================================================ монтаж как данные
export type CutKind = "cut" | "dissolve" | "push" | "dip" | "wipe" | "iris" | "settle";
export type Into = { kind: CutKind; dur?: number; blur?: number; settle?: number; direction?: PushProps["direction"]; distance?: number; color?: string; hold?: number; angle?: number; feather?: number; x?: number; y?: number; zoom?: number };
export type Shot = { id: string; dur: number; el: React.ReactNode; into?: Into; hook?: boolean };

const presentationOf = (i: Into): TransitionPresentation<Record<string, unknown>> | null => {
  switch (i.kind) {
    case "dissolve": return dissolve({ blur: i.blur, settle: i.settle }) as never;
    case "push": return push({ direction: i.direction, distance: i.distance }) as never;
    case "dip": return dipTo({ color: i.color, hold: i.hold }) as never;
    case "wipe": return softWipe({ angle: i.angle, feather: i.feather }) as never;
    case "iris": return softIris({ x: i.x, y: i.y, feather: i.feather }) as never;
    case "settle": return settle({ zoom: i.zoom }) as never;
    default: return null;
  }
};
const DEFAULT_DUR: Record<CutKind, number> = { cut: 0, dissolve: 24, push: 26, dip: 46, wipe: 26, iris: 28, settle: 24 };
const EASE_OF: Record<CutKind, (t: number) => number> = { cut: LINEAR, dissolve: SOFT, push: TEASE, dip: LINEAR, wipe: SOFT, iris: SOFT, settle: SOFT };
const durOf = (i?: Into) => (!i || i.kind === "cut" ? 0 : i.dur ?? DEFAULT_DUR[i.kind]);

// Кадр внутри Edit знает свои переходы: длину входа и выхода. Нужен, чтобы текст не
// накладывался на текст соседнего кадра («двойная экспозиция» подписей при растворении).
export type ShotInfo = { id: string; dur: number; inDur: number; outDur: number };
const ShotCtx = createContext<ShotInfo | null>(null);
export const useShot = (): ShotInfo | null => useContext(ShotCtx);

// Прозрачность текста кадра: проявляется ПОСЛЕ входного перехода (с запасом lead кадров
// до его конца) и гаснет ДО выходного. Вне Edit — всегда 1.
export const useShotTextOpacity = (o: { lead?: number; fade?: number } = {}): number => {
  const frame = useCurrentFrame();
  const s = useShot();
  if (!s) return 1;
  const fade = o.fade ?? 8;
  const inEnd = Math.max(0, s.inDur - (o.lead ?? Math.round(s.inDur * 0.3)));
  const outStart = s.dur - s.outDur;
  const a = s.inDur ? interpolate(frame, [inEnd, inEnd + fade], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  const b = s.outDur ? interpolate(frame, [outStart - 2, outStart + Math.min(fade, s.outDur * 0.5)], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  return Math.min(a, b);
};

// Монтаж по плану: shots[i].into — как приходим в кадр i (у первого не нужен).
export const Edit: React.FC<{ shots: Shot[] }> = ({ shots }) => (
  <TransitionSeries>
    {shots.flatMap((s, i) => {
      const out: React.ReactNode[] = [];
      const pres = i > 0 && s.into ? presentationOf(s.into) : null;
      if (pres) out.push(<TransitionSeries.Transition key={`t${i}`} presentation={pres} timing={softTiming(durOf(s.into), EASE_OF[s.into!.kind])} />);
      const info: ShotInfo = { id: s.id, dur: s.dur, inDur: i > 0 ? durOf(s.into) : 0, outDur: i < shots.length - 1 ? durOf(shots[i + 1].into) : 0 };
      out.push(<TransitionSeries.Sequence key={s.id} durationInFrames={s.dur}><ShotCtx.Provider value={info}>{s.el}</ShotCtx.Provider></TransitionSeries.Sequence>);
      return out;
    })}
  </TransitionSeries>
);

export type EditLayout = {
  total: number;                                   // длина монтажа (переходы перекрывают кадры)
  shots: { id: string; from: number; to: number }[];   // [from, to) — где кадр на таймлайне
  cuts: number[];                                  // кадры жёстких склеек → studio probe --cuts
  transitions: { into: string; kind: CutKind; from: number; to: number }[];
};

// Где что окажется на таймлайне — до рендера (для --cuts у probe, звуков на склейках, субтитров).
export const layoutEdit = (shots: Pick<Shot, "id" | "dur" | "into">[]): EditLayout => {
  let t = 0;
  const L: EditLayout = { total: 0, shots: [], cuts: [], transitions: [] };
  shots.forEach((s, i) => {
    const d = i === 0 ? 0 : durOf(s.into);
    const from = t - d;
    if (i > 0) {
      if (d === 0) L.cuts.push(from);
      else L.transitions.push({ into: s.id, kind: s.into!.kind, from, to: from + d });
    }
    L.shots.push({ id: s.id, from, to: from + s.dur });
    t = from + s.dur;
  });
  L.total = t;
  return L;
};

export type EditIssue = { at: number; kind: string; detail: string };

// Проверка монтажа до рендера. Это страховка от «прыгает», а не вкус:
//   • не больше maxCutsPerSec жёстких склеек в любой секунде (по умолчанию 2);
//   • кадр не короче minShotSec (0.6 с), кроме помеченных hook;
//   • переход не длиннее 30 % любого из соседних кадров (иначе кадр «съеден»);
//   • не больше maxKinds разных видов переходов на ролик (склейка не считается);
//   • push: сдвиг не быстрее лимита скорости; blur ≤ 6 px; переход короче 8 кадров — уже рывок.
export const checkEdit = (shots: Pick<Shot, "id" | "dur" | "into" | "hook">[], o: { fps: number; maxCutsPerSec?: number; minShotSec?: number; maxKinds?: number; maxShare?: number }): EditIssue[] => {
  const L = layoutEdit(shots);
  const out: EditIssue[] = [];
  const maxCuts = o.maxCutsPerSec ?? 2;
  const minShot = (o.minShotSec ?? 0.6) * o.fps;
  const share = o.maxShare ?? 0.3;
  const changes = [...L.cuts, ...L.transitions.map((t) => t.from)].sort((a, b) => a - b);
  for (let i = 0; i < changes.length; i++) {
    const inWin = changes.filter((c) => c >= changes[i] && c < changes[i] + o.fps).length;
    if (inWin > maxCuts) { out.push({ at: changes[i], kind: "cut-rate", detail: `${inWin} смены за секунду (≤ ${maxCuts})` }); break; }
  }
  shots.forEach((s, i) => {
    if (s.dur < minShot && !s.hook) out.push({ at: L.shots[i].from, kind: "short-shot", detail: `${s.id}: ${s.dur} кадров < ${Math.round(minShot)}` });
    if (i === 0 || !s.into || s.into.kind === "cut") return;
    const d = durOf(s.into);
    const prev = shots[i - 1];
    // dip: каждая половина закрывает только свой кадр — считаем половину длины.
    const eaten = s.into.kind === "dip" ? d / 2 : d;
    if (eaten > share * Math.min(prev.dur, s.dur)) out.push({ at: L.shots[i].from, kind: "long-transition", detail: `${s.id}: переход ${d} > ${Math.round(share * 100)} % соседнего кадра (${Math.min(prev.dur, s.dur)})` });
    if (d < 8) out.push({ at: L.shots[i].from, kind: "abrupt-transition", detail: `${s.id}: ${s.into.kind} за ${d} кадров — это рывок; либо склейка, либо ≥ 12 кадров` });
    else if (s.into.kind === "dip" && d < 40) out.push({ at: L.shots[i].from, kind: "abrupt-transition", detail: `${s.id}: dip за ${d} кадров — половины по ${Math.round(d / 2)} кадров мигают (светлое → тёмное быстрее ~20 кадров probe читает как склейку); ≥ 44` });
    else if (d < 16) out.push({ at: L.shots[i].from, kind: "abrupt-transition", detail: `${s.id}: ${s.into.kind} за ${d} кадров между разными кадрами читается как склейка; ≥ 20` });
    if ((s.into.blur ?? 0) > 6) out.push({ at: L.shots[i].from, kind: "blur", detail: `${s.id}: blur ${s.into.blur} > 6 — блюр-вжух` });
    if (s.into.kind === "push" && (s.into.distance ?? 0.06) > pushMaxDistance(d) * 1.05) out.push({ at: L.shots[i].from, kind: "push-fast", detail: `${s.id}: сдвиг ${s.into.distance} за ${d} кадров быстрее лимита (≤ ${pushMaxDistance(d).toFixed(3)})` });
  });
  const kinds = new Set(shots.slice(1).map((s) => s.into?.kind ?? "cut").filter((k) => k !== "cut"));
  if (kinds.size > (o.maxKinds ?? 2)) out.push({ at: 0, kind: "too-many-kinds", detail: `${kinds.size} видов переходов: ${[...kinds].join(", ")} (≤ ${o.maxKinds ?? 2})` });
  return out;
};
