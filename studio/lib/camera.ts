// Камера и движение — чистые функции кадра (детерминированный рендер, без useFrame/clock).
//   • tween — значение по ключам [кадр, значение] с плавностью и зажимом по краям;
//   • camera2D — 2D-камера над «миром» (x, y — точка мира в центре экрана, zoom, rotate),
//     с опцией containWorld: экран никогда не выходит за край мира;
//   • worldTransform / <CameraView> — CSS-трансформ мира для этой камеры. CameraView сам
//     проверяет скорость и смены направления и пишет нарушения в лог страховки;
//   • motionIssues — та же проверка для любого движения (функция кадра → точка) — для
//     заранее, в node, и для слоёв;
//   • breathe — сидированное «дыхание» камеры (малый шум, стабилен между рендерами);
//   • orbit / dolly — позиция 3D-камеры (для @remotion/three) от кадра.
// Пороги ниже — страховка от «прыгает», а не стиль: директор волен двигаться медленнее,
// стоять на месте или резать склейкой — но не дёргать.
import { Easing } from "remotion";
import { noise2D } from "@remotion/noise";
import { reportGuard } from "./layout";

export const EASE = Easing.bezier(0.45, 0, 0.2, 1);

export const MOTION_LIMITS = {
  maxSpeedFrac: 0.006,   // точка на экране движется не быстрее 0.6 % ширины кадра за кадр
  minRampFrames: 12,     // разгон/торможение не короче (ключи ближе — подозрительно резко)
  minReverseSec: 1,      // смена направления не чаще раза в секунду
  maxOrbitDegPerSec: 12, // орбита 3D-камеры
};

type Ease = (t: number) => number;
export type TweenKey = [frame: number, value: number] | { f: number; v: number; ease?: Ease };

// Кусочная интерполяция по ключам, у каждого отрезка своя плавность (по умолчанию EASE).
export const tween = (frame: number, keys: TweenKey[], ease: Ease = EASE): number => {
  const ks = keys.map((k) => (Array.isArray(k) ? { f: k[0], v: k[1], ease: undefined as Ease | undefined } : k)).sort((a, b) => a.f - b.f);
  if (!ks.length) return 0;
  if (frame <= ks[0].f) return ks[0].v;
  for (let i = 1; i < ks.length; i++) {
    if (frame <= ks[i].f) {
      const a = ks[i - 1], b = ks[i];
      const t = b.f === a.f ? 1 : (frame - a.f) / (b.f - a.f);
      return a.v + (b.v - a.v) * (b.ease ?? ease)(t);
    }
  }
  return ks[ks.length - 1].v;
};

export type Cam2D = { x: number; y: number; zoom: number; rotate: number };
export type CamKey = { f: number; x?: number; y?: number; zoom?: number; rotate?: number; ease?: Ease };

// Камера по ключам: каждое свойство интерполируется по ключам, где оно задано.
// world — размеры мира; если задан, камера зажимается так, чтобы экран не выходил за мир.
export const camera2D = (
  frame: number, keys: CamKey[],
  o: { viewport: { w: number; h: number }; world?: { w: number; h: number }; ease?: Ease },
): Cam2D => {
  const prop = (name: "x" | "y" | "zoom" | "rotate", def: number) => {
    const ks = keys.filter((k) => k[name] !== undefined).map((k) => ({ f: k.f, v: k[name] as number, ease: k.ease }));
    return ks.length ? tween(frame, ks, o.ease) : def;
  };
  const cam: Cam2D = {
    x: prop("x", (o.world?.w ?? o.viewport.w) / 2),
    y: prop("y", (o.world?.h ?? o.viewport.h) / 2),
    zoom: prop("zoom", 1),
    rotate: prop("rotate", 0),
  };
  return o.world ? containCamera(cam, o.viewport, o.world) : cam;
};

// Экран (viewport) целиком внутри мира: zoom не меньше cover, центр в допустимых пределах.
// Поворот не учитывается — при rotate ≠ 0 держите запас мира.
export const containCamera = (c: Cam2D, vp: { w: number; h: number }, world: { w: number; h: number }): Cam2D => {
  const zoom = Math.max(c.zoom, vp.w / world.w, vp.h / world.h);
  const hw = vp.w / (2 * zoom), hh = vp.h / (2 * zoom);
  return { ...c, zoom, x: Math.min(Math.max(c.x, hw), world.w - hw), y: Math.min(Math.max(c.y, hh), world.h - hh) };
};

// CSS-трансформ контейнера мира (transform-origin: 0 0).
export const worldTransform = (c: Cam2D, W: number, H: number) =>
  `translate(${W / 2}px, ${H / 2}px) rotate(${c.rotate}deg) scale(${c.zoom}) translate(${-c.x}px, ${-c.y}px)`;

// Скорость точки мира (x, y) на экране при камере c.
const screenOf = (c: Cam2D, x: number, y: number) => ({ x: (x - c.x) * c.zoom, y: (y - c.y) * c.zoom });

export type MotionSample = { x: number; y: number; zoom?: number };
export type MotionIssue = { frame: number; kind: "too-fast" | "reversal" | "abrupt-start"; value: number; limit: number };

// Проверка движения: sample(f) → положение на экране (px) и масштаб. Возвращает нарушения:
// скорость > maxSpeedFrac·W за кадр (с учётом zoom — край кадра тоже «едет»), смена
// направления чаще minReverseSec, резкий старт (скорость с нуля до >50 % лимита за 1 кадр).
export const motionIssues = (
  sample: (f: number) => MotionSample,
  o: { from: number; to: number; fps: number; W: number; H?: number; limits?: Partial<typeof MOTION_LIMITS> },
): MotionIssue[] => {
  const L = { ...MOTION_LIMITS, ...o.limits };
  const maxV = L.maxSpeedFrac * o.W;
  const H = o.H ?? o.W;
  const out: MotionIssue[] = [];
  let lastDir: { f: number; sx: number; sy: number } | null = null;
  let prevV = 0;
  for (let f = o.from + 1; f <= o.to; f++) {
    const a = sample(f - 1), b = sample(f);
    const za = a.zoom ?? 1, zb = b.zoom ?? 1;
    // Смещение точки + смещение края кадра от смены масштаба (край в W/2 от центра).
    const dz = Math.abs(zb - za) / Math.max(1e-6, Math.min(za, zb)) * Math.max(o.W, H) / 2;
    const v = Math.hypot(b.x - a.x, b.y - a.y) + dz;
    if (v > maxV) out.push({ frame: f, kind: "too-fast", value: +v.toFixed(1), limit: +maxV.toFixed(1) });
    if (prevV < 0.05 * maxV && v > 0.5 * maxV) out.push({ frame: f, kind: "abrupt-start", value: +v.toFixed(1), limit: +(0.5 * maxV).toFixed(1) });
    prevV = v;
    const dx = b.x - a.x, dy = b.y - a.y;
    if (Math.hypot(dx, dy) > 0.1 * maxV) {
      const sx = Math.sign(dx), sy = Math.sign(dy);
      if (lastDir && ((sx && lastDir.sx && sx !== lastDir.sx) || (sy && lastDir.sy && sy !== lastDir.sy))) {
        const gap = (f - lastDir.f) / o.fps;
        if (gap < L.minReverseSec) out.push({ frame: f, kind: "reversal", value: +gap.toFixed(2), limit: L.minReverseSec });
      }
      if (!lastDir || sx !== lastDir.sx || sy !== lastDir.sy) lastDir = { f, sx, sy };
    }
  }
  return out;
};

// Проверка движения в рендере: на кадре frame смотрит отрезок [frame-1, frame] (и окно
// назад на minReverseSec для смены направления) и пишет нарушения в лог страховки.
export const checkMotionAt = (id: string, frame: number, sample: (f: number) => MotionSample, o: { fps: number; W: number; H?: number; limits?: Partial<typeof MOTION_LIMITS> }) => {
  if (frame < 1) return [];
  const back = Math.ceil((o.limits?.minReverseSec ?? MOTION_LIMITS.minReverseSec) * o.fps);
  const issues = motionIssues(sample, { ...o, from: Math.max(0, frame - back), to: frame }).filter((i) => i.frame === frame);
  for (const i of issues) reportGuard({ id, kind: `motion-${i.kind}`, frame, amount: i.value, detail: { limit: i.limit } });
  return issues;
};

// Камера как функция кадра → проба для motionIssues: как движется центр экрана по миру.
export const cameraSample = (cam: (f: number) => Cam2D) => (f: number): MotionSample => {
  const c = cam(f);
  const s = screenOf(c, 0, 0);
  return { x: s.x, y: s.y, zoom: c.zoom };
};

// «Дыхание»: медленный сидированный шум, амплитуда в px (держите ≤ 0.3 % ширины).
export const breathe = (frame: number, o: { seed?: string; ampPx: number; speed?: number }) => {
  const s = o.seed ?? "breathe";
  const t = frame * (o.speed ?? 0.01);
  return { dx: noise2D(s + "x", t, 0) * o.ampPx, dy: noise2D(s + "y", t, 0.5) * o.ampPx };
};

// ---------- 3D (для @remotion/three: камера ставится из этих чисел каждый кадр) ----------
export type Vec3 = [number, number, number];

export const orbit = (
  frame: number,
  o: { start: number; end: number; azimuth0: number; dAzimuth: number; radius: number; elevation: number; target?: Vec3; ease?: Ease },
): { position: Vec3; target: Vec3 } => {
  const t = o.end > o.start ? Math.min(1, Math.max(0, (frame - o.start) / (o.end - o.start))) : 1;
  const az = ((o.azimuth0 + o.dAzimuth * (o.ease ?? EASE)(t)) * Math.PI) / 180;
  const el = (o.elevation * Math.PI) / 180;
  const tg = o.target ?? [0, 0, 0];
  return {
    position: [tg[0] + o.radius * Math.cos(el) * Math.sin(az), tg[1] + o.radius * Math.sin(el), tg[2] + o.radius * Math.cos(el) * Math.cos(az)],
    target: tg,
  };
};

export const dolly = (frame: number, o: { start: number; end: number; from: Vec3; to: Vec3; target?: Vec3; ease?: Ease }): { position: Vec3; target: Vec3 } => {
  const t = (o.ease ?? EASE)(o.end > o.start ? Math.min(1, Math.max(0, (frame - o.start) / (o.end - o.start))) : 1);
  return { position: [0, 1, 2].map((i) => o.from[i] + (o.to[i] - o.from[i]) * t) as Vec3, target: o.target ?? [0, 0, 0] };
};

// Угловая скорость орбиты, °/с — проверка до рендера.
export const orbitDegPerSec = (o: { start: number; end: number; dAzimuth: number }, fps: number) =>
  Math.abs(o.dAzimuth) / Math.max(1e-6, (o.end - o.start) / fps);
