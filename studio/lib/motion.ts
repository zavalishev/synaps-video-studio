// Мягкие появления и уходы — стартовые точки, а не рецепт. Всё — функции кадра.
// Пружины по умолчанию без перелёта (damping 200): перелёт и «резиновость» дают «прыгает».
import { Easing, interpolate, spring } from "remotion";
import { EASE } from "./camera";

export const springIn = (frame: number, fps: number, o: { delay?: number; damping?: number; stiffness?: number; mass?: number; durationInFrames?: number } = {}) =>
  spring({ frame: frame - (o.delay ?? 0), fps, config: { damping: o.damping ?? 200, stiffness: o.stiffness ?? 100, mass: o.mass ?? 1 }, durationInFrames: o.durationInFrames });

// 0 → 1 между start и start+dur с плавностью, зажато.
export const progress = (frame: number, start: number, dur: number, ease: (t: number) => number = EASE) =>
  interpolate(frame, [start, start + Math.max(1, dur)], [0, 1], { easing: ease, extrapolateLeft: "clamp", extrapolateRight: "clamp" });

// Прозрачность «появился — побыл — ушёл».
export const fadeInOut = (frame: number, start: number, end: number, fade = 10) =>
  interpolate(frame, [start, start + fade, end - fade, end], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

export type Appear = { opacity: number; transform: string; filter?: string };
// Появление: сдвиг на distance px с направления from, лёгкий масштаб, опционально блюр.
export const appear = (frame: number, fps: number, o: { delay?: number; from?: "up" | "down" | "left" | "right" | "none"; distance?: number; scaleFrom?: number; blurFrom?: number; dur?: number } = {}): Appear => {
  const p = o.dur ? progress(frame, o.delay ?? 0, o.dur) : springIn(frame, fps, { delay: o.delay });
  const d = (o.distance ?? 40) * (1 - p);
  const [dx, dy] = { up: [0, d], down: [0, -d], left: [d, 0], right: [-d, 0], none: [0, 0] }[o.from ?? "up"];
  const s = (o.scaleFrom ?? 0.96) + (1 - (o.scaleFrom ?? 0.96)) * p;
  const blur = (o.blurFrom ?? 0) * (1 - p);
  return { opacity: Math.min(1, p * 1.2), transform: `translate(${dx}px, ${dy}px) scale(${s})`, ...(blur > 0.05 ? { filter: `blur(${blur}px)` } : {}) };
};

export { Easing, interpolate, spring };

// ---------- игра персонажа (acting) ----------
// Движение ВНУТРИ стоящего кадра: прыжок, падение, приземление, реакция. Здесь ускорение и
// упругость — ремесло мультипликации (squash & stretch, anticipation, gravity, follow-through),
// а не «прыгает». Лимиты спокойного кадра (MOTION_LIMITS) — для камеры и кадра целиком;
// слой с игрой пометьте data-acting — самопроверка не будет считать его скорость «рывком кадра».
// Падение, бросок, капля — ease-in (ускоряется к земле), а не CRUISE с торможением в воздухе.
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// Падение под силой тяжести: 0 → 1 за dur кадров, с ускорением (t²). Позиция = from + (to−from)·fall.
export const fall = (frame: number, start: number, dur: number) => { const t = clamp01((frame - start) / Math.max(1, dur)); return t * t; };

// Прыжок: высота над опорой (px, ≥ 0) по параболе — быстро вверх, зависание, быстро вниз.
export const hop = (frame: number, start: number, dur: number, height: number) => {
  const t = (frame - start) / Math.max(1, dur);
  return t <= 0 || t >= 1 ? 0 : 4 * height * t * (1 - t);
};

// Сжатие при приземлении в кадре landAt: нарастает за attack кадров, шире и ниже, затем
// 1–2 затухающих колебания.
// Объём сохраняется (sx·sy ≈ 1). transformOrigin — у опоры («50% 100%»).
export const squash = (frame: number, landAt: number, o: { amount?: number; dur?: number; attack?: number } = {}) => {
  const t = frame - landAt, dur = o.dur ?? 10, A = o.amount ?? 0.15, att = o.attack ?? 3;
  if (t < 0 || t > dur * 2) return { sx: 1, sy: 1 };
  const k = t / dur;
  // Сжатие нарастает за attack кадров (мгновенное — читается как «выскочил»), потом затухает.
  const s = A * Math.min(1, (t + 1) / (att + 1)) * Math.exp(-3 * k) * Math.cos(Math.PI * 1.5 * k);
  return { sx: 1 / Math.sqrt(Math.max(0.2, 1 - s)), sy: 1 - s };
};
export const squashOnLand = squash;

// Вытягивание по скорости (капля в падении, прыжок): sy > 1 вдоль движения. v — px/кадр.
export const stretchBySpeed = (v: number, vRef: number, amount = 0.2) => {
  const s = amount * Math.min(1, Math.abs(v) / Math.max(1e-6, vRef));
  return { sx: 1 / Math.sqrt(1 + s), sy: 1 + s };
};

// Замах перед движением: кривая 0 → 1 с маленьким откатом назад в начале (amount — глубина).
export const anticipate = (t: number, amount = 0.6) => { const x = clamp01(t); return x * x * ((amount + 1) * x - amount); };

// Затухающее покачивание после события (уши, антенна, листок после толчка): значение в px/градусах.
export const wobble = (frame: number, at: number, o: { amp?: number; periodFrames?: number; decayFrames?: number } = {}) => {
  const t = frame - at;
  if (t < 0) return 0;
  return (o.amp ?? 6) * Math.exp(-t / (o.decayFrames ?? 18)) * Math.sin((2 * Math.PI * t) / (o.periodFrames ?? 12));
};
