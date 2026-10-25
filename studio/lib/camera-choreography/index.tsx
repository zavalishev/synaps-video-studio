// Скилл camera-choreography: движения камеры как данные + проверка до рендера + параллакс.
// Импорт: import { pushIn, truck, hold, shots, minMoveFrames, checkTrack, Parallax, Layer, track3D, check3D } from "@studio/camera-choreography";
// Основа — @studio (camera.ts): tween, camera2D, CameraView, motionIssues, orbit, dolly, EASE.
//
// Почему так: «прыгает» — это почти всегда движение, которое не посчитали заранее (слишком
// короткий отрезок на большой сдвиг, смена направления, пружина). Здесь движение задаётся
// ключами, длина отрезка подбирается от расстояния (minMoveFrames), а checkTrack/check3D
// прогоняют весь трек по кадрам ДО рендера — в рендере ловить уже поздно.
import React, { createContext, useContext } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import {
  type Cam2D, type CamKey, camera2D, checkMotionAt, containCamera, EASE, MOTION_LIMITS, type MotionIssue, motionIssues,
  type MotionSample, tween, type Vec3, worldTransform,
} from "../camera";
import { safeArea } from "../layout";

type Ease = (t: number) => number;
type Pt = { x: number; y: number };

// «Тележка»: плавный разгон, ровный ход, плавное торможение (трапеция скорости). Пик скорости
// всего 1/(1−ramp) от средней (у EASE ≈ 2.1), поэтому длинная панорама укладывается в лимит
// почти вдвое быстрее и выглядит как настоящий долли-ход. ramp — доля на разгон (и на торможение).
export const cruise = (ramp = 0.25): Ease => {
  const r = Math.min(0.5, Math.max(0.05, ramp));
  const v = 1 / (1 - r);
  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    if (t < r) return (v * t * t) / (2 * r);
    if (t > 1 - r) return 1 - (v * (1 - t) * (1 - t)) / (2 * r);
    return v * (r / 2 + (t - r));
  };
};
export const CRUISE = cruise(0.25);

// ---------------------------------------------------------------- движения 2D (ключи CameraView)
// Все движения — в координатах мира (x, y — точка мира в центре экрана). Возвращают CamKey[];
// склейте их shots(...) и отдайте в <CameraView keys>. Между движениями камера стоит.
export const hold = (f: number, at: Pt & { zoom?: number; rotate?: number }): CamKey[] => [{ f, ...at }];

export const move = (start: number, end: number, from: Partial<Cam2D>, to: Partial<Cam2D>, ease: Ease = EASE): CamKey[] =>
  [{ f: start, ...from }, { f: end, ...to, ease }];

// Наезд на точку: zoom from → to (по умолчанию 1 → 1.12), центр плавно смещается к точке.
export const pushIn = (start: number, end: number, o: { at: Pt; from?: Pt; zoomFrom?: number; zoomTo?: number; ease?: Ease }): CamKey[] =>
  move(start, end, { ...(o.from ?? o.at), zoom: o.zoomFrom ?? 1 }, { ...o.at, zoom: o.zoomTo ?? 1.12 }, o.ease);

// Отъезд: открыть контекст после детали (обратный наезд).
export const pullBack = (start: number, end: number, o: { at: Pt; to?: Pt; zoomFrom?: number; zoomTo?: number; ease?: Ease }): CamKey[] =>
  move(start, end, { ...o.at, zoom: o.zoomFrom ?? 1.15 }, { ...(o.to ?? o.at), zoom: o.zoomTo ?? 1 }, o.ease);

// Панорама вбок (truck) / вверх-вниз (pedestal) при постоянном zoom.
export const truck = (start: number, end: number, o: { y: number; xFrom: number; xTo: number; zoom?: number; ease?: Ease }): CamKey[] =>
  move(start, end, { x: o.xFrom, y: o.y, zoom: o.zoom ?? 1 }, { x: o.xTo, y: o.y, zoom: o.zoom ?? 1 }, o.ease);
export const pedestal = (start: number, end: number, o: { x: number; yFrom: number; yTo: number; zoom?: number; ease?: Ease }): CamKey[] =>
  move(start, end, { x: o.x, y: o.yFrom, zoom: o.zoom ?? 1 }, { x: o.x, y: o.yTo, zoom: o.zoom ?? 1 }, o.ease);

// Раскрытие: от детали (крупно) к общему плану мира.
export const reveal = (start: number, end: number, o: { detail: Pt; wide: Pt; zoomDetail?: number; zoomWide?: number; ease?: Ease }): CamKey[] =>
  move(start, end, { ...o.detail, zoom: o.zoomDetail ?? 1.6 }, { ...o.wide, zoom: o.zoomWide ?? 1 }, o.ease);

// Склеить движения в один трек (сортировка по кадру; одинаковые кадры — последний побеждает).
export const shots = (...parts: CamKey[][]): CamKey[] => {
  const m = new Map<number, CamKey>();
  for (const k of parts.flat().sort((a, b) => a.f - b.f)) m.set(k.f, { ...m.get(k.f), ...k });
  return [...m.values()];
};

// ---------------------------------------------------------------- расчёт длины движения
const peakSlope = (ease: Ease) => {
  let m = 0;
  for (let i = 0; i < 200; i++) m = Math.max(m, (ease((i + 1) / 200) - ease(i / 200)) * 200);
  return m;
};
const PEAK_CACHE = new Map<Ease, number>();
export const easePeak = (ease: Ease = EASE) => { let v = PEAK_CACHE.get(ease); if (v === undefined) { v = peakSlope(ease); PEAK_CACHE.set(ease, v); } return v; };

// Сколько кадров нужно, чтобы движение from → to (в мире) не превысило лимит скорости на экране.
// Учитывает и сдвиг центра, и «расползание» края кадра при смене zoom. Запас 10 %.
export const minMoveFrames = (from: Partial<Cam2D> & Pt, to: Partial<Cam2D> & Pt, o: { W: number; H: number; ease?: Ease; maxSpeedFrac?: number }): number => {
  const z0 = from.zoom ?? 1, z1 = to.zoom ?? 1;
  const zAvg = (z0 + z1) / 2;
  const dist = Math.hypot(to.x - from.x, to.y - from.y) * zAvg + (Math.abs(z1 - z0) / Math.min(z0, z1)) * (Math.max(o.W, o.H) / 2);
  const v = (o.maxSpeedFrac ?? MOTION_LIMITS.maxSpeedFrac) * o.W;
  return Math.max(MOTION_LIMITS.minRampFrames * 2, Math.ceil((dist * easePeak(o.ease)) / v * 1.1));
};

export type TrackReport = { ok: boolean; peakSpeedFrac: number; issues: MotionIssue[]; keyIssues: string[] };

// Проверка трека 2D-камеры по всем кадрам ДО рендера (в node или в рендере один раз).
// Кроме motionIssues — ключи ближе minRampFrames и смена направления между соседними
// движениями без остановки.
export const checkTrack = (keys: CamKey[], o: { W: number; H: number; fps: number; from?: number; to?: number; world?: { w: number; h: number } }): TrackReport => {
  const ks = [...keys].sort((a, b) => a.f - b.f);
  const from = o.from ?? ks[0]?.f ?? 0, to = o.to ?? ks[ks.length - 1]?.f ?? 0;
  const cam = (f: number) => camera2D(f, keys, { viewport: { w: o.W, h: o.H }, world: o.world });
  // Скорость меряется у точки мира в центре экрана (+ расползание края при zoom), а не у начала
  // координат мира: иначе наезд далеко от (0, 0) выглядит «быстрым», хотя на экране спокоен.
  const issues: MotionIssue[] = [];
  let peak = 0;
  for (let f = from + 1; f <= to; f++) {
    const ref = cam(f);
    const found = motionIssues(centeredSample(cam, ref), { from: Math.max(from, f - Math.ceil(MOTION_LIMITS.minReverseSec * o.fps)), to: f, fps: o.fps, W: o.W, H: o.H }).filter((i) => i.frame === f);
    issues.push(...found);
    const a = cam(f - 1);
    const dz = Math.abs(ref.zoom - a.zoom) / Math.min(a.zoom, ref.zoom) * Math.max(o.W, o.H) / 2;
    peak = Math.max(peak, (Math.hypot(ref.x - a.x, ref.y - a.y) * ref.zoom + dz) / o.W);
  }
  const keyIssues: string[] = [];
  for (let i = 1; i < ks.length; i++) {
    const gap = ks[i].f - ks[i - 1].f;
    const moved = (["x", "y", "zoom", "rotate"] as const).some((p) => ks[i][p] !== undefined && ks[i - 1][p] !== undefined && ks[i][p] !== ks[i - 1][p]);
    if (moved && gap < MOTION_LIMITS.minRampFrames) keyIssues.push(`ключи ${ks[i - 1].f}→${ks[i].f}: ${gap} кадров на движение — рывок (≥ ${MOTION_LIMITS.minRampFrames * 2})`);
  }
  return { ok: !issues.length && !keyIssues.length, peakSpeedFrac: +(peak * 100).toFixed(3), issues, keyIssues };
};

// Проба для motionIssues: положение на экране точки мира, которая в кадре ref — в центре.
export const centeredSample = (cam: (f: number) => Cam2D, ref: Cam2D) => (f: number): MotionSample => {
  const c = cam(f);
  return { x: (ref.x - c.x) * c.zoom, y: (ref.y - c.y) * c.zoom, zoom: c.zoom };
};

// ---------------------------------------------------------------- параллакс (2.5D)
// Слои мира на разной глубине под одной камерой. depth 1 — «плоскость камеры» (как CameraView),
// 0 — бесконечно далеко (не движется), > 1 — передний план (движется быстрее; ≤ 1.5).
// Каждый слой зажат так, что его край не входит в кадр (слой — размером с мир). Скорость
// проверяется по самому быстрому слою.
type ParallaxCtx = { cam: (f: number) => Cam2D; worldW: number; worldH: number; W: number; H: number };
const PCtx = createContext<ParallaxCtx | null>(null);

export const Parallax: React.FC<{ keys: CamKey[]; worldW: number; worldH: number; maxDepth?: number; id?: string; children?: React.ReactNode }> = ({ keys, worldW, worldH, maxDepth = 1, id = "parallax", children }) => {
  const frame = useCurrentFrame();
  const { width: W, height: H, fps } = useVideoConfig();
  const cam = (f: number) => camera2D(f, keys, { viewport: { w: W, h: H }, world: { w: worldW, h: worldH } });
  const fastestCam = (f: number) => layerCam(cam(f), maxDepth, worldW, worldH, W, H);
  checkMotionAt(id, frame, centeredSample(fastestCam, fastestCam(frame)), { fps, W, H });
  return <PCtx.Provider value={{ cam, worldW, worldH, W, H }}><AbsoluteFill style={{ overflow: "hidden" }}>{children}</AbsoluteFill></PCtx.Provider>;
};

const layerCam = (c: Cam2D, depth: number, ww: number, wh: number, W: number, H: number): Cam2D => {
  const cx = ww / 2, cy = wh / 2;
  const lc = { x: cx + (c.x - cx) * depth, y: cy + (c.y - cy) * depth, zoom: 1 + (c.zoom - 1) * depth, rotate: c.rotate * depth };
  return containCamera(lc, { w: W, h: H }, { w: ww, h: wh });
};

export const Layer: React.FC<{ depth: number; children?: React.ReactNode; style?: React.CSSProperties }> = ({ depth, children, style }) => {
  const frame = useCurrentFrame();
  const p = useContext(PCtx);
  if (!p) throw new Error("<Layer> только внутри <Parallax>");
  const c = layerCam(p.cam(frame), depth, p.worldW, p.worldH, p.W, p.H);
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: p.worldW, height: p.worldH, transformOrigin: "0 0", transform: worldTransform(c, p.W, p.H), ...style }}>
      {children}
    </div>
  );
};

// ---------------------------------------------------------------- проверка любого слоя
// Подвижный слой (карточка, герой): sample(f) → центр на экране, px. Пишет нарушения в guard.json.
export const useMotionCheck = (id: string, sample: (f: number) => MotionSample) => {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  return checkMotionAt(id, frame, sample, { fps, W, H });
};

// Мягкое следование за движущейся целью: среднее положения за окно кадров назад (без
// перелёта, детерминированно). window 12–24 кадра — «оператор догоняет».
export const smoothFollow = (frame: number, target: (f: number) => Pt, window = 18): Pt => {
  let x = 0, y = 0, w = 0;
  for (let i = 0; i < window; i++) {
    const k = 1 - i / window; // треугольное окно: свежие кадры весят больше
    const p = target(Math.max(0, frame - i));
    x += p.x * k; y += p.y * k; w += k;
  }
  return { x: x / w, y: y / w };
};

// ---------------------------------------------------------------- 3D: камера на сфере по ключам
// Ключ: азимут/высота (°), радиус, цель, fov. Каждый параметр — tween по своим ключам: орбита,
// наезд (radius), подъём (elevation, target.y) и смена фокуса — одним треком без склеек.
export type Cam3DKey = { f: number; azimuth?: number; elevation?: number; radius?: number; target?: Vec3; fov?: number; ease?: Ease };
export type Cam3D = { position: Vec3; target: Vec3; fov: number; azimuth: number; elevation: number; radius: number };

export const track3D = (frame: number, keys: Cam3DKey[], def: { azimuth?: number; elevation?: number; radius?: number; target?: Vec3; fov?: number } = {}): Cam3D => {
  const prop = (name: "azimuth" | "elevation" | "radius" | "fov", d: number) => {
    const ks = keys.filter((k) => k[name] !== undefined).map((k) => ({ f: k.f, v: k[name] as number, ease: k.ease }));
    return ks.length ? tween(frame, ks) : d;
  };
  const tks = keys.filter((k) => k.target);
  const target: Vec3 = tks.length
    ? ([0, 1, 2].map((i) => tween(frame, tks.map((k) => ({ f: k.f, v: k.target![i], ease: k.ease })))) as Vec3)
    : def.target ?? [0, 0, 0];
  const azimuth = prop("azimuth", def.azimuth ?? 0), elevation = prop("elevation", def.elevation ?? 20), radius = prop("radius", def.radius ?? 10);
  const az = (azimuth * Math.PI) / 180, el = (elevation * Math.PI) / 180;
  return {
    position: [target[0] + radius * Math.cos(el) * Math.sin(az), target[1] + radius * Math.sin(el), target[2] + radius * Math.cos(el) * Math.cos(az)],
    target, fov: prop("fov", def.fov ?? 35), azimuth, elevation, radius,
  };
};

// Проверка 3D-трека: угловая скорость (азимут+высота) ≤ 12°/с, наезд (радиус) ≤ 0.6 %/кадр
// как «zoom», fov ≤ 0.4°/кадр, разворот направления орбиты не чаще раза в секунду.
export const check3D = (keys: Cam3DKey[], o: { fps: number; from?: number; to?: number; maxDegPerSec?: number }): { ok: boolean; peakDegPerSec: number; issues: string[] } => {
  const ks = [...keys].sort((a, b) => a.f - b.f);
  const from = o.from ?? ks[0]?.f ?? 0, to = o.to ?? ks[ks.length - 1]?.f ?? 0;
  const maxDeg = o.maxDegPerSec ?? MOTION_LIMITS.maxOrbitDegPerSec;
  const issues: string[] = [];
  let peak = 0, lastSign = 0, lastFlip = -1e9;
  for (let f = from + 1; f <= to; f++) {
    const a = track3D(f - 1, keys), b = track3D(f, keys);
    const deg = Math.hypot(b.azimuth - a.azimuth, b.elevation - a.elevation) * o.fps;
    peak = Math.max(peak, deg);
    if (deg > maxDeg) issues.push(`кадр ${f}: орбита ${deg.toFixed(1)}°/с > ${maxDeg}`);
    const zoomRate = Math.abs(b.radius - a.radius) / Math.min(a.radius, b.radius);
    if (zoomRate > MOTION_LIMITS.maxSpeedFrac) issues.push(`кадр ${f}: наезд ${(zoomRate * 100).toFixed(2)} %/кадр > 0.6`);
    if (Math.abs(b.fov - a.fov) > 0.4) issues.push(`кадр ${f}: fov меняется на ${Math.abs(b.fov - a.fov).toFixed(2)}°/кадр`);
    const s = Math.sign(b.azimuth - a.azimuth);
    if (s && lastSign && s !== lastSign) { if ((f - lastFlip) / o.fps < MOTION_LIMITS.minReverseSec) issues.push(`кадр ${f}: орбита разворачивается чаще раза в секунду`); lastFlip = f; }
    if (s) lastSign = s;
  }
  // Сжать одинаковые сообщения в диапазоны
  const uniq = [...new Set(issues.map((m) => m.replace(/^кадр \d+: /, "")))].map((m) => {
    const fs = issues.filter((x) => x.endsWith(m)).map((x) => Number(x.match(/^кадр (\d+)/)?.[1]));
    return `кадры ${fs[0]}–${fs[fs.length - 1]}: ${m}`;
  });
  return { ok: !issues.length, peakDegPerSec: +peak.toFixed(2), issues: uniq.slice(0, 12) };
};

// ---------- кадрирование по предмету и вертикальная раскладка ----------
// План по предмету, а не «весь мир в кадре»: крупность — решение, а не то, что получилось.
// 2D: ключ камеры (для CameraView/Parallax), при котором бокс предмета (в координатах мира)
// занимает fill безопасной зоны и стоит в точке anchor (доли безопасной зоны; 0.55 по высоте —
// чуть ниже центра: над ним место заголовку, низ кадра не пустует). fill по умолчанию 0.85:
// «герой занимает большую часть безопасной зоны» (0.6 давал ~30 % площади — «наклейка»).
export const frameSubject2D = (box: { x: number; y: number; w: number; h: number }, o: { W: number; H: number; fill?: number; anchor?: Pt; safe?: { x: number; y: number; w: number; h: number } }): { x: number; y: number; zoom: number } => {
  const S = o.safe ?? safeArea(o.W, o.H);
  const fill = o.fill ?? 0.85;
  const zoom = Math.min((S.w * fill) / Math.max(1, box.w), (S.h * fill) / Math.max(1, box.h));
  const an = o.anchor ?? { x: 0.5, y: 0.55 };
  const sx = S.x + an.x * S.w, sy = S.y + an.y * S.h;
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  return { x: cx - (sx - o.W / 2) / zoom, y: cy - (sy - o.H / 2) / zoom, zoom };
};

// 3D: цель и радиус орбиты, при которых бокс части мира (башня, окно, вывеска — из паспорта
// GLB или на глаз) занимает fill безопасной зоны. Деталь в одном дубле: наезд track3D к этим
// числам и обратно — мир продолжается за краем кадра (холст помечен data-world), это не вылет.
export const frameSubject3D = (box: { min: number[]; max: number[] }, o: { fov: number; W: number; H: number; fill?: number }): { target: Vec3; radius: number } => {
  const S = safeArea(o.W, o.H);
  const fill = o.fill ?? 0.85;
  const hw = (box.max[0] - box.min[0]) / 2, hh = (box.max[1] - box.min[1]) / 2, hd = (box.max[2] - box.min[2]) / 2;
  const tv = Math.tan(((o.fov * Math.PI) / 180) / 2), th = tv * (o.W / o.H);
  const radius = Math.max(hw / (th * (S.w / o.W) * fill), hh / (tv * (S.h / o.H) * fill)) + hd;
  return { target: [0, 1, 2].map((k) => (box.min[k] + box.max[k]) / 2) as Vec3, radius };
};

// Вертикальная раскладка «заголовок / герой / подпись» по безопасной зоне: центр героя на
// heroCenter (0.55) её высоты, герой — heroFill (0.75) высоты. Не обязательна — но без неё
// сцены по привычке верстаются «как веб-страница сверху вниз», и низ кадра пустует.
export const composeV = (safe: { x: number; y: number; w: number; h: number }, o: { titleH?: number; captionH?: number; heroCenter?: number; heroFill?: number; gap?: number } = {}) => {
  const gap = (o.gap ?? 0.02) * safe.h;
  const titleH = (o.titleH ?? 0.16) * safe.h, capH = (o.captionH ?? 0.12) * safe.h;
  const title = { x: safe.x, y: safe.y, w: safe.w, h: titleH };
  const caption = { x: safe.x, y: safe.y + safe.h - capH, w: safe.w, h: capH };
  let h = (o.heroFill ?? 0.75) * safe.h;
  let cy = safe.y + (o.heroCenter ?? 0.55) * safe.h;
  const top = title.y + (o.titleH === 0 ? 0 : titleH + gap), bottom = caption.y - (o.captionH === 0 ? 0 : gap);
  h = Math.min(h, bottom - top);
  cy = Math.min(Math.max(cy, top + h / 2), bottom - h / 2);
  return { title, hero: { x: safe.x, y: cy - h / 2, w: safe.w, h }, caption };
};
