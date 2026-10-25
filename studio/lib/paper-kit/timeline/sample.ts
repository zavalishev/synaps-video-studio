// Кадр плана: что видно в кадре frame — положение камеры и каждой детали.
//
// Это единственное место, где план превращается в числа конкретного кадра: рендер и
// страховка читают одни и те же функции, поэтому то, что проверено, и то, что нарисовано,
// не расходятся. Модуль чистый: тот же план и тот же кадр —
// те же числа (шум только из сида, никаких Math.random/Date).
//
// Порядок сборки детали: поза дорожки (ключи модели) → реакция / покачивание / дрожание →
// зажим страховки (кадр, подпись) → смещение входа/ухода (ему можно за кадр: так входят
// из-за края) → прозрачность.
// Порядок сборки камеры: ключ (склейка или переезд) → дрейф → тряска → зажим страховки
// (окно каждого слоя внутри задника с запасом overscan).
import { DEPTH, gestureArms, H, RIG, rig, rotateRect, scaleRect, shift, union, W } from "../kit/geometry";
import type * as T from "./types";

// ---------- ШУМ ----------
// FNV-1a + mulberry32: число 0..1 от сида и «адреса» (сцена, элемент, номер).
export const hashStr = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
export const noise = (seed: number, ...parts: Array<string | number>): number => {
  let a = hashStr(`${seed}|${parts.join("|")}`);
  a = (a + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ---------- КРИВЫЕ ----------
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, q: number) => a + (b - a) * q;

// cubic-bezier(x1, y1, x2, y2) — как в CSS: x(s) решается Ньютоном с подстраховкой делением.
const bezier = (x1: number, y1: number, x2: number, y2: number) => {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const xs = (s: number) => ((ax * s + bx) * s + cx) * s;
  const ys = (s: number) => ((ay * s + by) * s + cy) * s;
  const dxs = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  return (x: number): number => {
    let s = x;
    for (let i = 0; i < 8; i++) {
      const e = xs(s) - x;
      if (Math.abs(e) < 1e-7) return ys(s);
      const d = dxs(s);
      if (Math.abs(d) < 1e-6) break;
      s -= e / d;
    }
    let lo = 0, hi = 1;
    s = x;
    for (let i = 0; i < 40; i++) {
      const v = xs(s);
      if (Math.abs(v - x) < 1e-7) break;
      if (v < x) lo = s; else hi = s;
      s = (lo + hi) / 2;
    }
    return ys(s);
  };
};
// Именованные кривые — стандартные кривые CSS (ease-in / ease-out / ease-in-out): это
// условность записи, а не вкус движка.
const NAMED = { in: bezier(0.42, 0, 1, 1), out: bezier(0, 0, 0.58, 1), inOut: bezier(0.42, 0, 0.58, 1) } as const;
const bezierMemo = new Map<string, (x: number) => number>();

// Пружина: bounce 0 — без отскока (критическое затухание), 0.9 — почти без затухания.
// Период — spring.dur (или длина самого движения). Невязка в конце движения убирается
// линейно, чтобы движение закончилось ровно в позе покоя без скачка.
const springAt = (bounce: number, period: number, tSec: number): number => {
  const w0 = (2 * Math.PI) / Math.max(1e-3, period);
  const zeta = 1 - Math.min(0.9, Math.max(0, bounce));
  if (zeta >= 1 - 1e-9) return 1 - Math.exp(-w0 * tSec) * (1 + w0 * tSec);
  const wd = w0 * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * w0 * tSec) * (Math.cos(wd * tSec) + ((zeta * w0) / wd) * Math.sin(wd * tSec));
};

// Доля пути 0..1 (у пружины и кривой Безье бывает больше 1 и меньше 0) в момент t (0..1)
// движения длиной durSec.
export const easeAt = (e: T.Ease | undefined, t: number, durSec = 1): number => {
  const x = clamp01(t);
  if (e === undefined || e === "linear") return x;
  if (e === "hold") return x < 1 ? 0 : 1;
  if (typeof e === "string") return NAMED[e](x);
  if ("bezier" in e) {
    const k = e.bezier.join(",");
    let f = bezierMemo.get(k);
    if (!f) { f = bezier(...e.bezier); bezierMemo.set(k, f); }
    return x <= 0 ? 0 : x >= 1 ? 1 : f(x);
  }
  const period = e.spring.dur ?? durSec;
  const end = springAt(e.spring.bounce, period, durSec);
  return springAt(e.spring.bounce, period, x * durSec) + (1 - end) * x;
};

// Перелёт: путь проходит позу покоя на долю overshoot и возвращается:
// q = p + A·p²·(1 − p), A подобрано так, что max q = 1 + overshoot.
const overshootMemo = new Map<number, number>();
const overshootA = (o: number): number => {
  const hit = overshootMemo.get(o);
  if (hit !== undefined) return hit;
  const peak = (A: number) => {
    let m = 1;
    for (let i = 1; i < 200; i++) { const p = i / 200; m = Math.max(m, p + A * p * p * (1 - p)); }
    return m;
  };
  let lo = 0, hi = 100;
  for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (peak(mid) < 1 + o) lo = mid; else hi = mid; }
  overshootMemo.set(o, lo);
  return lo;
};
export const withOvershoot = (p: number, o: number): number => (o > 0 ? p + overshootA(o) * p * p * (1 - p) : p);

// ---------- ВХОД И УХОД ----------
// Смещение позы входа/ухода в кадре f. k — доля позы входа/ухода (1 — целиком, 0 — покой;
// null — движение уже/ещё не идёт), fade — множитель прозрачности от нарастания (null — нет).
// Порядок применения: сдвиг, масштаб, поворот, прозрачность позы, затем нарастание.
export type MotionOffset = { k: number | null; dx: number; dy: number; scale: number; rotate: number; opacity: number; fade: number | null };
export const motionAt = (m: T.ResolvedMotion, f: number, fps: number, phase: "enter" | "exit"): MotionOffset => {
  let k: number | null = null;
  let fade: number | null = null;
  if (phase === "enter") {
    if (m.durF > 0 && f < m.frame + m.durF) {
      k = 1 - withOvershoot(easeAt(m.ease, (f - m.frame) / m.durF, m.durF / fps), m.overshoot);
    }
    if (m.fadeF > 0) fade = clamp01((f - m.frame) / m.fadeF);
  } else {
    k = m.durF > 0 ? easeAt(m.ease, (f - m.frame) / m.durF, m.durF / fps) : 1;
    if (m.fadeF > 0) fade = clamp01((m.frame + Math.max(m.durF, m.fadeF) - f) / m.fadeF);
  }
  const q = k ?? 0;
  return { k, dx: m.dx * q, dy: m.dy * q, scale: lerp(1, m.scale, q), rotate: m.rotate * q, opacity: lerp(1, m.opacity, q), fade };
};

// ---------- КАМЕРА ----------
export type CamState = { cx: number; cy: number; z: number; tilt: number; parallax: number };
export const Z_MAX = 4;
export type LayerName = keyof typeof DEPTH;
export const LAYERS: LayerName[] = ["far", "mid", "near"];
export const layerFactor = (layer: LayerName, parallax: number) => Math.max(0, 1 - (1 - DEPTH[layer]) * parallax);

// Окно слоя: какую часть сцены (в координатах слоя) видит экран.
export const layerView = (c: CamState, f: number) => {
  const zf = 1 + (c.z - 1) * f;
  const th = (c.tilt * Math.PI) / 180;
  const cs = Math.abs(Math.cos(th)), sn = Math.abs(Math.sin(th));
  return {
    zf,
    cx: W / 2 + (c.cx - W / 2) * f,
    cy: H / 2 + (c.cy - H / 2) * f,
    hx: (W / 2 * cs + H / 2 * sn) / zf,
    hy: (W / 2 * sn + H / 2 * cs) / zf,
  };
};
// SVG-преобразование слоя (рендер): экран = центр экрана + поворот·zf·(точка − центр окна).
export const layerTransform = (c: CamState, f: number): string => {
  const v = layerView(c, f);
  return `translate(${W / 2},${H / 2}) rotate(${c.tilt}) scale(${v.zf}) translate(${-v.cx},${-v.cy})`;
};
// Насколько окно слоя вылезает за задник с запасом os (0 — не вылезает), px.
export const camExcess = (c: CamState, os = 0): number => {
  let m = 0;
  for (const l of LAYERS) {
    const v = layerView(c, layerFactor(l, c.parallax));
    m = Math.max(m, -os - (v.cx - v.hx), v.cx + v.hx - (W + os), -os - (v.cy - v.hy), v.cy + v.hy - (H + os));
  }
  return Math.max(0, m);
};

// СТРАХОВКА «край декорации не виден»: окно каждого слоя (с дрейфом, тряской и наклоном)
// зажимается внутрь задника W×H с запасом os по каждому краю. Сначала хватает ли
// увеличения (наклон требует приблизить), потом сдвиг центра. Слои выпуклы по f, но
// проверяются все три — так проще и надёжнее.
export const containCam = (c0: CamState, os: number): CamState => {
  let c = { ...c0, z: Math.min(Z_MAX, Math.max(1, c0.z)) };
  const fits = (s: CamState) => LAYERS.every((l) => {
    const v = layerView(s, layerFactor(l, s.parallax));
    return v.hx <= W / 2 + os + 1e-6 && v.hy <= H / 2 + os + 1e-6;
  });
  if (!fits(c)) {
    // Приблизить, насколько нужно слоям с f > 0.
    for (const l of LAYERS) {
      const f = layerFactor(l, c.parallax);
      if (f <= 0) continue;
      const th = (c.tilt * Math.PI) / 180;
      const cs = Math.abs(Math.cos(th)), sn = Math.abs(Math.sin(th));
      const need = Math.max((W / 2 * cs + H / 2 * sn) / (W / 2 + os), (W / 2 * sn + H / 2 * cs) / (H / 2 + os));
      if (1 + (c.z - 1) * f < need) c.z = Math.min(Z_MAX, Math.max(c.z, 1 + (need - 1) / f));
    }
    // Не хватило (слой без параллакса или потолок увеличения) — меньше наклон.
    if (!fits(c)) {
      let lo = 0, hi = 1;
      for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (fits({ ...c, tilt: c0.tilt * m })) lo = m; else hi = m; }
      c = { ...c, tilt: c0.tilt * lo };
    }
  }
  let dx = c.cx - W / 2, dy = c.cy - H / 2;
  for (const l of LAYERS) {
    const f = layerFactor(l, c.parallax);
    if (f <= 0) continue;
    const v = layerView(c, f);
    const lx = Math.max(0, (W / 2 + os - v.hx) / f), ly = Math.max(0, (H / 2 + os - v.hy) / f);
    dx = Math.min(lx, Math.max(-lx, dx));
    dy = Math.min(ly, Math.max(-ly, dy));
  }
  return { ...c, cx: W / 2 + dx, cy: H / 2 + dy };
};

// ---------- ПОЗА ЭЛЕМЕНТА ----------
// Пределы сустава руки (страховка, как в схеме ArmKey: −30..180 градусов).
export const ARM_MIN = -30, ARM_MAX = 180;
export type Pose = { x: number; y: number; scale: number; rotate: number; opacity: number };
type Rest = Pose & { facing: 1 | -1 | 0; arms: [number, number] };

export type SceneSampler = {
  camRaw: (frame: number) => CamState;     // до страховки
  cam: (frame: number) => CamState;        // что видит экран
  rest: (id: string, frame: number) => Rest | null;        // поза дорожки без страховки и без входа/ухода
  pose: (id: string, frame: number) => (Rest & { cl: number }) | null;  // null — не видно; cl — сдвиг страховки, px
  box: (id: string, frame: number, part?: "face" | "body" | "hands" | "feet" | "all") => T.Rect | null;   // рамка на сцене
  restBox: (id: string, frame: number) => T.Rect | null;   // рамка позы дорожки (без страховки)
  visible: (id: string, frame: number) => boolean;
  arms: (id: string, frame: number) => [number, number];
  target: (t: unknown, frame: number) => { x: number; y: number } | null;   // точка цели взгляда/жеста (id или точка)
  clampRest: (el: T.PlanElement, r: Rest, frame: number) => Rest;
};

// Рамка элемента в позе (x, y, scale, rotate), без входа/ухода.
export const placedBox = (box: T.Rect, p: { x: number; y: number; scale: number; rotate: number }): T.Rect =>
  shift(rotateRect(scaleRect(box, p.scale), p.rotate), p.x, p.y);

// Минимальный сдвиг рамки b из прямоугольника r, не выходя из bounds. null — не пересекаются.
export const pushOut = (b: T.Rect, r: T.Rect, bounds: T.Rect): { dx: number; dy: number } | null => {
  if (!(b.x < r.x + r.w && r.x < b.x + b.w && b.y < r.y + r.h && r.y < b.y + b.h)) return null;
  const cands = [
    { dx: 0, dy: r.y + r.h - b.y }, { dx: 0, dy: r.y - (b.y + b.h) },
    { dx: r.x + r.w - b.x, dy: 0 }, { dx: r.x - (b.x + b.w), dy: 0 },
  ];
  const inside = (c: { dx: number; dy: number }) =>
    b.x + c.dx >= bounds.x - 1e-6 && b.y + c.dy >= bounds.y - 1e-6
    && b.x + b.w + c.dx <= bounds.x + bounds.w + 1e-6 && b.y + b.h + c.dy <= bounds.y + bounds.h + 1e-6;
  const ok = cands.filter(inside);
  const pool = ok.length ? ok : cands;
  return pool.reduce((a, c) => (Math.hypot(c.dx, c.dy) < Math.hypot(a.dx, a.dy) ? c : a));
};
// Сдвиг рамки внутрь bounds (если рамка больше — по центру).
export const pushIn = (b: T.Rect, bounds: T.Rect): { dx: number; dy: number } => {
  const one = (x: number, w: number, lo: number, len: number) =>
    w > len ? lo + len / 2 - (x + w / 2) : x < lo ? lo - x : x + w > lo + len ? lo + len - (x + w) : 0;
  return { dx: one(b.x, b.w, bounds.x, bounds.w), dy: one(b.y, b.h, bounds.y, bounds.h) };
};
export const FRAME_RECT: T.Rect = { x: 0, y: 0, w: W, h: H };
// Где на экране свободно от подписи: полоса над или под ней (какая больше).
export const freeArea = (caption: T.Rect | null): T.Rect => {
  if (!caption) return FRAME_RECT;
  const above = Math.max(0, caption.y), below = Math.max(0, H - (caption.y + caption.h));
  return below >= above ? { x: 0, y: H - below, w: W, h: below } : { x: 0, y: 0, w: W, h: above };
};

export const sampler = (scene: T.PlanScene, opts: { overscan: number; fps: number }): SceneSampler => {
  const byId = new Map(scene.elements.map((e) => [e.id, e] as const));
  const keys = scene.cam;

  // --- камера ---
  const keyState = (k: T.PlanCamKey): CamState => ({ cx: k.cx, cy: k.cy, z: k.z, tilt: k.tilt, parallax: k.parallax });
  const driftAt = (k: T.PlanCamKey, f: number): { x: number; y: number } => {
    if (!k.drift || k.drift.amp <= 0) return { x: 0, y: 0 };
    const a = (2 * Math.PI * (f - k.frame)) / Math.max(1, k.drift.periodF);
    return {
      x: k.drift.amp * (Math.sin(a + k.drift.phase) - Math.sin(k.drift.phase)),
      y: k.drift.amp * (Math.sin(a + k.drift.phaseY) - Math.sin(k.drift.phaseY)),
    };
  };
  // Состояние ключа k в кадре f с его дрейфом (экранные px -> px сцены делением на z).
  const withDrift = (s: CamState, k: T.PlanCamKey, f: number): CamState => {
    const d = driftAt(k, f);
    return { ...s, cx: s.cx + d.x / s.z, cy: s.cy + d.y / s.z };
  };
  const camBase = (f: number): CamState => {
    if (!keys.length) return { cx: W / 2, cy: H / 2, z: 1, tilt: 0, parallax: 1 };
    let k = 0;
    for (let j = 0; j < keys.length; j++) if (keys[j].frame <= f) k = j;
    const key = keys[k];
    if (f < key.frame) return keyState(key);   // до первого ключа камера держит его
    const target = keyState(key);
    if (k === 0 || key.mode === "cut" || key.durF <= 0 || f >= key.frame + key.durF) return withDrift(target, key, f);
    const from = withDrift(keyState(keys[k - 1]), keys[k - 1], key.frame);
    const q = easeAt(key.ease, (f - key.frame) / key.durF, key.durF / opts.fps);
    const s: CamState = {
      cx: lerp(from.cx, target.cx, q), cy: lerp(from.cy, target.cy, q),
      z: Math.max(1, lerp(from.z, target.z, q)), tilt: lerp(from.tilt, target.tilt, q),
      parallax: lerp(from.parallax, target.parallax, clamp01(q)),
    };
    return withDrift(s, key, f);
  };
  const camRaw = (f: number): CamState => {
    const s = camBase(f);
    let ox = 0, oy = 0;
    for (const sh of scene.shakes) {
      const d = f - sh.frame;
      if (d < 0 || d >= sh.durF || sh.amp <= 0) continue;
      const env = 1 - easeAt(sh.decay, d / Math.max(1, sh.durF), sh.durF / opts.fps);
      ox += sh.amp * env * (2 * noise(sh.seed, d, "x") - 1);
      oy += sh.amp * env * (2 * noise(sh.seed, d, "y") - 1);
    }
    return { ...s, cx: s.cx + ox / s.z, cy: s.cy + oy / s.z };
  };
  const cam = (f: number) => containCam(camRaw(f), opts.overscan);

  // --- элементы ---
  const busy = new Set<string>();
  // x дорожки без привязок (у привязанного ключа — его записанная точка): для «лицом к» —
  // так взгляд не зависит от порядка, в котором считаются элементы.
  const trackX = (el: T.PlanElement, f: number): number => {
    const tr = el.track;
    let k = 0;
    for (let j = 0; j < tr.length; j++) if (tr[j].frame <= f) k = j;
    const key = tr[k];
    if (k === 0 || key.durF <= 0 || f >= key.frame + key.durF || f < key.frame) return key.x;
    return lerp(tr[k - 1].x, key.x, easeAt(key.ease, (f - key.frame) / key.durF, key.durF / opts.fps));
  };
  const facingOf = (el: T.PlanElement, x: number, f: number): 1 | -1 | 0 => {
    const fc = el.data.facing as "left" | "right" | "camera" | { toward: string } | undefined;
    if (fc === "left") return -1;
    if (fc === "right") return 1;
    if (fc === "camera") return 0;
    let tx = W / 2;
    const t = fc && typeof fc === "object" ? byId.get(fc.toward) : undefined;
    if (t && t.track.length) tx = trackX(t, f);
    return tx >= x ? 1 : -1;
  };
  // Точка дорожки без привязок (у привязанного ключа — его записанная точка) и центр рамки:
  // куда показывает рука героя (pointAt) и куда смотрят глаза (gaze).
  const trackCenter = (el: T.PlanElement, f: number): { x: number; y: number } => {
    const tr = el.track;
    let k = 0;
    for (let j = 0; j < tr.length; j++) if (tr[j].frame <= f) k = j;
    const key = tr[k];
    let x = key.x, y = key.y, s = key.scale;
    if (k > 0 && key.durF > 0 && f >= key.frame && f < key.frame + key.durF) {
      const q = easeAt(key.ease, (f - key.frame) / key.durF, key.durF / opts.fps);
      x = lerp(tr[k - 1].x, key.x, q); y = lerp(tr[k - 1].y, key.y, q); s = lerp(tr[k - 1].scale, key.scale, q);
    }
    return { x: x + (el.box.x + el.box.w / 2) * s, y: y + (el.box.y + el.box.h / 2) * s };
  };
  // Цель взгляда или жеста: id элемента сцены или точка кадра (px). Нет цели — null.
  const targetPoint = (t: unknown, f: number): { x: number; y: number } | null => {
    if (typeof t === "string") { const e = byId.get(t); return e && e.track.length ? trackCenter(e, f) : null; }
    if (t && typeof t === "object" && "x" in t && "y" in t) return t as { x: number; y: number };
    return null;
  };
  // Рука, показывающая на точку: угол от вертикали вниз (наружу плюс) по линии плечо → точка,
  // в пределах сустава (страховка −30..180).
  const pointArm = (x: number, y: number, scale: number, tp: { x: number; y: number }): { side: -1 | 1; deg: number } => {
    const side: -1 | 1 = tp.x >= x ? 1 : -1;
    const sx = x + side * RIG.shoulder.x * scale, sy = y + RIG.shoulder.y * scale;
    const deg = (Math.atan2(side * (tp.x - sx), tp.y - sy) * 180) / Math.PI;
    return { side, deg: Math.min(ARM_MAX, Math.max(ARM_MIN, deg)) };
  };
  const armsOf = (el: T.PlanElement, facing: 1 | -1 | 0, f: number, at?: { x: number; y: number; scale: number }): [number, number] => {
    let [l, r] = gestureArms(el.data.gesture as Parameters<typeof gestureArms>[0], facing);
    // Страховка «рука держит» (compile.ts): пока в руке предмет — рука той стороны, к которой
    // привязка (см. anchorPos), в позе «держит».
    const holds = el.data.holds as Array<[number, number]> | undefined;
    if (holds?.some(([a, b]) => f >= a && f < b)) {
      const h = gestureArms("hold", facing);
      if (facing === -1) l = h[0]; else r = h[1];
    }
    const tp = at ? targetPoint(el.data.pointAt, f) : null;
    if (at && tp) {
      const p = pointArm(at.x, at.y, at.scale, tp);
      if (p.side === 1) r = p.deg; else l = p.deg;
    }
    const ks = (el.data.arms as Array<{ frame: number; left?: number; right?: number; durF: number; ease: T.Ease }> | undefined) ?? [];
    for (const k of ks) {
      if (k.frame > f) break;
      const q = k.durF > 0 ? easeAt(k.ease, (f - k.frame) / k.durF, k.durF / opts.fps) : 1;
      if (k.left !== undefined) l = lerp(l, k.left, q);
      if (k.right !== undefined) r = lerp(r, k.right, q);
    }
    return [l, r];
  };
  // Живая точка цели привязки: рука, макушка, ступни, лицо (у героя — по ригу; у детали —
  // по её рамке). Возвращает точку, куда встаёт точка привязанного элемента.
  const anchorPos = (a: T.PlanAnchor, self: T.PlanElement, selfScale: number, f: number): { x: number; y: number } | null => {
    const tgt = byId.get(a.to);
    if (!tgt || busy.has(a.to)) return null;
    const r = rest(a.to, f);
    if (!r) return null;
    const sb = scaleRect(self.box, selfScale);
    let x = r.x, y = r.y;
    if (tgt.kind === "actor") {
      const R = rig(r.scale);
      if (a.part === "hand") {
        const side: 1 | -1 = r.facing === -1 ? -1 : 1;
        const h = R.handPos(side === 1 ? r.arms[1] : r.arms[0], side);
        x += h.x; y += h.y;
      } else if (a.part === "head") { x += R.faceBox.x + R.faceBox.w / 2; y += R.faceBox.y + R.faceBox.h / 2; }
      else if (a.part === "above") y += R.headTop - (sb.y + sb.h);
      else y -= sb.y + sb.h;   // feet: стоит на полу у ног
    } else {
      const tb = placedBox(tgt.box, r);
      if (a.part === "above") y = tb.y - (sb.y + sb.h);
      else if (a.part === "feet") y = tb.y + tb.h - (sb.y + sb.h);
      else { x = tb.x + tb.w / 2; y = tb.y + tb.h / 2; }
    }
    return { x: x + a.dx, y: y + a.dy };
  };
  const keyPos = (el: T.PlanElement, k: T.PlanTrackKey, f: number) =>
    (k.anchor ? anchorPos(k.anchor, el, k.scale, f) : null) ?? { x: k.x, y: k.y };

  const reactOffset = (el: T.PlanElement, facing: 1 | -1 | 0, f: number) => {
    let dx = 0, dy = 0, ds = 1;
    const rs = (el.data.react as Array<{ kind: string; frame: number; durF: number; amp: number }> | undefined) ?? [];
    for (const r of rs) {
      const d = f - r.frame;
      if (d < 0 || d >= Math.max(1, r.durF) || r.amp === 0) continue;
      const t = d / Math.max(1, r.durF);
      const s = Math.sin(Math.PI * t);
      if (r.kind === "hop") dy -= r.amp * s;
      else if (r.kind === "sink") dy += r.amp * s;
      else if (r.kind === "flinch") dx -= (facing || 1) * r.amp * s;
      else if (r.kind === "tremble") dx += r.amp * (2 * noise(r.frame, el.id, d) - 1) * (1 - t);
      else if (r.kind === "swell") ds *= 1 + (r.amp / H) * s;
    }
    return { dx, dy, ds };
  };

  const restMemo = new Map<string, Rest | null>();
  const rest = (id: string, f: number): Rest | null => {
    const mk = `${id}@${f}`;
    if (restMemo.has(mk)) return restMemo.get(mk)!;
    const el = byId.get(id);
    if (!el || !el.track.length) return null;
    busy.add(id);
    const tr = el.track;
    let k = 0;
    for (let j = 0; j < tr.length; j++) if (tr[j].frame <= f) k = j;
    const key = tr[k];
    let x: number, y: number, scale: number, rotate: number, opacity: number;
    const to = keyPos(el, key, f);
    if (k === 0 || key.durF <= 0 || f >= key.frame + key.durF || f < key.frame) {
      ({ x, y } = to); scale = key.scale; rotate = key.rotate; opacity = key.opacity;
    } else {
      const prev = tr[k - 1];
      const from = keyPos(el, prev, key.frame);
      const lin = (f - key.frame) / key.durF;
      const q = easeAt(key.ease, lin, key.durF / opts.fps);
      x = lerp(from.x, to.x, q); y = lerp(from.y, to.y, q) - key.arc * Math.sin(Math.PI * clamp01(lin));
      scale = lerp(prev.scale, key.scale, q); rotate = lerp(prev.rotate, key.rotate, q); opacity = lerp(prev.opacity, key.opacity, q);
    }
    let facing: 1 | -1 | 0 = 0;
    let arms: [number, number] = [0, 0];
    if (el.kind === "actor") {
      facing = facingOf(el, x, f);
      arms = armsOf(el, facing, f, { x, y, scale });
    }
    busy.delete(id);
    const out: Rest = { x, y, scale, rotate, opacity, facing, arms };
    restMemo.set(mk, out);
    return out;
  };

  const elementBox = (el: T.PlanElement, p: { x: number; y: number; scale: number; rotate: number; arms: [number, number] }): T.Rect =>
    el.kind === "actor"
      ? placedBox(rig(1).allBox(p.arms[0], p.arms[1]), p)
      : placedBox(el.box, p);

  // СТРАХОВКА позы (каждый кадр): рамка не больше места, где её видно целиком (кадр, а
  // если подпись — полоса над или под ней); рамка в кадре; рамка не заходит в подпись
  // (если не overCaption). Масштаб — вокруг точки элемента (у героя — между ступнями).
  const cap = scene.caption?.rect ?? null;
  const clampRest = (el: T.PlanElement, r: Rest, f: number): Rest => {
    void f;
    const guard = cap && !el.overCaption ? cap : null;
    const room = freeArea(guard);
    let out = r;
    let b = elementBox(el, out);
    const k = Math.min(1, room.w / Math.max(1e-6, b.w), room.h / Math.max(1e-6, b.h));
    if (k < 1 - 1e-9) { out = { ...out, scale: out.scale * k }; b = elementBox(el, out); }
    let { x, y } = out;
    const step = (d: { dx: number; dy: number } | null) => { if (d) { x += d.dx; y += d.dy; b = shift(b, d.dx, d.dy); } };
    step(pushIn(b, FRAME_RECT));
    if (guard) step(pushOut(b, guard, FRAME_RECT));
    step(pushIn(b, FRAME_RECT));
    return x === out.x && y === out.y ? out : { ...out, x, y };
  };

  const hidden = (el: T.PlanElement, f: number) => el.hide.some(([a, b]) => f >= a && f < b);
  const visible = (id: string, f: number): boolean => {
    const el = byId.get(id);
    if (!el || f < el.inF || hidden(el, f)) return false;
    if (el.outF === null) return true;
    const gone = el.outF + (el.exit?.durF ?? 0);
    return f < gone;
  };

  const pose = (id: string, f: number) => {
    const el = byId.get(id);
    if (!el || !visible(id, f)) return null;
    const r0 = rest(id, f);
    if (!r0) return null;
    let r: Rest = { ...r0 };
    if (el.kind === "actor") {
      const o = reactOffset(el, r.facing, f);
      r = { ...r, x: r.x + o.dx, y: r.y + o.dy, scale: r.scale * o.ds };
      const ghost = el.data.ghost as number | undefined;
      if (ghost !== undefined) r.opacity *= ghost;
    }
    if (el.idle) {
      const s = Math.sin((2 * Math.PI * f) / Math.max(1, el.idle.periodF) + el.idle.phase);
      if (el.idle.kind === "sway") r.rotate += el.idle.amp * s;
      else if (el.idle.kind === "bob") r.y += el.idle.amp * s;
      else r.scale *= 1 + (el.idle.amp / 100) * s;
    }
    if (el.jitter && el.jitter.amp > 0) {
      const k = Math.floor(f / Math.max(1, el.jitter.stepF));
      r.x += (2 * noise(el.jitter.seed, k, "x") - 1) * el.jitter.amp;
      r.y += (2 * noise(el.jitter.seed, k, "y") - 1) * el.jitter.amp;
      r.rotate += (2 * noise(el.jitter.seed, k, "r") - 1) * el.jitter.rot;
    }
    const pre = r;
    r = { ...clampRest(el, r, f) };
    // Насколько сдвинула страховка, px (уменьшение — как сдвиг края рамки).
    const cl = Math.hypot(r.x - pre.x, r.y - pre.y) + Math.abs(1 - r.scale / pre.scale) * Math.max(el.box.w, el.box.h);
    // Вход и уход.
    const apply = (o: MotionOffset) => {
      if (o.k !== null) {
        r.x += o.dx; r.y += o.dy;
        r.scale *= o.scale;
        r.rotate += o.rotate;
        r.opacity *= o.opacity;
      }
      if (o.fade !== null) r.opacity *= o.fade;
    };
    // Ступенчатое движение (stagger) детали применяют её единицы (kit/Items.tsx Unit), а
    // не вся деталь — иначе оно сложилось бы дважды.
    const whole = (m: T.ResolvedMotion) => el.kind === "actor" || m.staggerF <= 0;
    if (el.enter && whole(el.enter) && f < el.enter.frame + Math.max(el.enter.durF, el.enter.fadeF)) apply(motionAt(el.enter, f, opts.fps, "enter"));
    if (el.exit && whole(el.exit) && el.outF !== null && f >= el.outF) apply(motionAt(el.exit, f, opts.fps, "exit"));
    return { ...r, cl };
  };

  const box = (id: string, f: number, part: "face" | "body" | "hands" | "feet" | "all" = "all"): T.Rect | null => {
    const el = byId.get(id);
    const p = pose(id, f) ?? (el ? rest(id, f) : null);
    if (!el || !p) return null;
    if (el.kind !== "actor") return placedBox(el.box, p);
    const R = rig(1);
    const local = part === "face" ? R.faceBox : part === "body" ? R.bodyBox : part === "feet" ? R.feetBox
      : part === "hands" ? R.handsBox(p.arms[0], p.arms[1]) : R.allBox(p.arms[0], p.arms[1]);
    return placedBox(local, p);
  };
  const restBox = (id: string, f: number) => {
    const el = byId.get(id);
    const r = rest(id, f);
    return el && r ? elementBox(el, r) : null;
  };
  const arms = (id: string, f: number): [number, number] => rest(id, f)?.arms ?? [0, 0];

  return { camRaw, cam, rest, pose, box, restBox, visible, arms, target: targetPoint, clampRest };
};

// Объединение рамок (для цели камеры {ids}).
export const unionBoxes = (rs: Array<T.Rect | null>): T.Rect | null => {
  const ok = rs.filter((r): r is T.Rect => !!r);
  return ok.length ? union(...ok) : null;
};
