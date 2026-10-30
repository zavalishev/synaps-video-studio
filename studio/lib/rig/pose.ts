// Скелетная (перекладная) анимация: герой из частей-картинок на шарнирах и готовые движения.
// Чистая математика без React — её же использует `studio rig check` (лист поз без рендера ролика).
//
// Скелет (rig.json): части-картинки и «резиновые» конечности кодом, у каждой — родитель, точка
// крепления на родителе (at, пиксели картинки родителя) и своя точка вращения (pivot, пиксели своей
// картинки). Корень (без parent) — туловище; его pivot — бёдра. Позы считаются от кадра (чистая
// функция времени), поэтому рендер детерминирован и параллелится.
//
// Углы: градусы по часовой стрелке (как CSS rotate). Для рук и ног в действиях и в позе `pose`
// числа — «наружу от тела»: 0 — висит вниз, 90 — в сторону, 180 — вверх (знак по стороне сам).
// Имена частей, которые понимают движения: torso, head, armL, armR, legL, legR (L — слева на
// экране в исходной позе), forearmL/R, shinL/R — вторые звенья по желанию; остальные части
// двигаются через follow (уши, хвост, волосы, шарф — запаздывают за движением) и через pose.

export type Vec = [number, number];
export type Mat = [number, number, number, number, number, number];

export type RigPart = {
  /** Картинка части (путь в public/) и её размер в пикселях. */
  src?: string;
  w?: number;
  h?: number;
  /** Родитель; у корня (туловища) нет. */
  parent?: string;
  /** Точка крепления на родителе, пиксели картинки родителя (у резиновой конечности-родителя — от плеча). */
  at?: Vec;
  /** Своя точка вращения (сустав), пиксели своей картинки. */
  pivot?: Vec;
  /** Порядок отрисовки: больше — ближе к зрителю. Туловище 0. */
  z?: number;
  /** Исходный угол, градусы по часовой. */
  rest?: number;
  /** Сменные картинки того же размера и с той же точкой вращения: blink, talk, … */
  alt?: Record<string, string>;
  /** Запаздывание за движением 0..1 (уши, хвост, волосы, шарф). */
  follow?: number;
  /** Резиновая конечность, нарисованная кодом (для предметов-персонажей: зерно, круассан, зуб). */
  hose?: { len: number; width: number; color: string; outline?: string; endR?: number; endColor?: string };
};

/** view: front — герой нарисован анфас (ноги при ходьбе поочерёдно приподнимаются, тело покачивается);
 *  side — в профиль (ноги и руки шагают вразмах). По умолчанию front. */
export type RigDef = { name?: string; view?: "front" | "side"; parts: Record<string, RigPart> };

type Side = "L" | "R";
export type RigAction =
  | { do: "walk" | "run" | "move"; at: number; to: Vec; dur?: number; face?: boolean }
  | { do: "hop"; at: number; h?: number }
  | { do: "wave" | "point"; at: number; dur?: number; arm?: Side; angle?: number }
  | { do: "cheer" | "sleep" | "nod" | "shiver" | "surprise"; at: number; dur?: number }
  /** beats — слова реплики: [начало, конец (с от at), слогов]. Есть — рот открывается на слогах и закрыт
   *  в паузах; нет — рот хлопает сам по себе. */
  | { do: "talk"; at: number; dur?: number; beats?: [number, number, number][] }
  | { do: "look"; at: number; dur?: number; angle: number }
  | { do: "turn"; at: number; facing: 1 | -1 }
  | { do: "pose"; at: number; dur?: number; ease?: number; angles?: Record<string, number>; lean?: number; dy?: number; alt?: Record<string, string> }
  /** Тянуться рукой к точке кадра (x, y — пиксели кадра): взять за руку, протянуть, держать предмет.
   *  Рука поворачивается к цели, длина не меняется (дальше руки — просто указывает в ту сторону). */
  | { do: "reach"; at: number; dur?: number; ease?: number; arm?: Side; to: Vec };

export type Pose = {
  dx: number; dy: number; rot: number; sx: number; sy: number; facing: 1 | -1;
  ang: Record<string, number>; len: Record<string, number>; scale: Record<string, number>; alt: Record<string, string>;
  /** Сдвиг части от точки крепления, пиксели картинки родителя (нога поднимается при шаге, а не сплющивается). */
  off: Record<string, Vec>;
};

export type DrawItem =
  | { name: string; kind: "img"; src: string; w: number; h: number; m: Mat; z: number; order: number }
  | { name: string; kind: "hose"; d: string; len: number; width: number; color: string; outline?: string; endR?: number; endColor?: string; m: Mat; z: number; order: number };

// ── матрицы (порядок CSS matrix(a,b,c,d,e,f)) ─────────────────────────────────────────────
export const I: Mat = [1, 0, 0, 1, 0, 0];
export const mul = (p: Mat, q: Mat): Mat => [
  p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1],
  p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3],
  p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5],
];
export const T = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];
export const R = (deg: number): Mat => { const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return [c, s, -s, c, 0, 0]; };
export const S = (x: number, y = x): Mat => [x, 0, 0, y, 0, 0];
export const apply = (m: Mat, [x, y]: Vec): Vec => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const chain = (...ms: Mat[]) => ms.reduce(mul, I);
export const css = (m: Mat, dx = 0, dy = 0) => `matrix(${m.slice(0, 4).map((v) => v.toFixed(5)).join(",")},${(m[4] - dx).toFixed(2)},${(m[5] - dy).toFixed(2)})`;

// ── проверка скелета ─────────────────────────────────────────────────────────────────────
export const rootOf = (rig: RigDef): string => {
  const roots = Object.keys(rig.parts).filter((k) => !rig.parts[k].parent);
  if (roots.length !== 1) throw new Error(`rig: корень должен быть один (часть без parent), сейчас: ${roots.join(", ") || "нет"}`);
  return roots[0];
};

/** Ошибки скелета человеческим языком (пусто — всё в порядке). */
export const validateRig = (rig: RigDef): string[] => {
  const err: string[] = [];
  const names = Object.keys(rig.parts ?? {});
  if (!names.length) return ["rig: нет частей"];
  try { rootOf(rig); } catch (e) { err.push((e as Error).message); }
  for (const n of names) {
    const p = rig.parts[n];
    if (p.parent && !rig.parts[p.parent]) err.push(`${n}: родитель ${p.parent} не найден`);
    if (p.hose) { if (!(p.hose.len > 0 && p.hose.width > 0 && p.hose.color)) err.push(`${n}: hose требует len, width, color`); }
    else if (!p.src || !(p.w! > 0) || !(p.h! > 0)) err.push(`${n}: нужна картинка src и её размер w, h`);
    let q: RigPart | undefined = p, guard = 0;
    while (q?.parent && guard++ < 50) q = rig.parts[q.parent];
    if (guard >= 50) err.push(`${n}: цикл в родителях`);
  }
  return err;
};

// ── время и шум ─────────────────────────────────────────────────────────────────────────────
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const sm = (u: number) => { const x = clamp(u, 0, 1); return x * x * (3 - 2 * x); };
const env = (t: number, a: number, b: number, fade: number) => (t < a || t > b ? 0 : Math.min(sm((t - a) / fade), sm((b - t) / fade)));
const hash = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const TAU = Math.PI * 2;
const side = (name: string) => (/L$/.test(name) ? 1 : -1);
const LIMB = /^(arm|leg)[LR]$/;

const DUR: Record<string, number> = { hop: 0.95, wave: 1.6, point: 1.5, cheer: 1.4, talk: 1.5, sleep: 2, nod: 0.8, shiver: 1.2, surprise: 0.8, look: 1.2, pose: 1.2, reach: 1.5 };
export const actionEnd = (a: RigAction): number => (a.do === "turn" ? a.at : a.at + ("dur" in a && a.dur ? a.dur : DUR[a.do] ?? 1));

/** dist — сколько пройдено от начала перехода (пиксели кадра): по нему, а не по часам, считается шаг.
 *  hx — доля пути по горизонтали (|Δx| / путь): шаг идёт по полу, вглубь кадра (по y) стопа не шагает. */
type Moving = { at: number; end: number; kind: "walk" | "run" | "move"; dir: number; dist: number; len: number; hx: number };

/** Доля пути к моменту u (0..1) при скорости-трапеции: разгон и торможение по `r` с каждой стороны,
 *  посередине — ровный ход. Ровная скорость нужна, чтобы шаг совпадал с перемещением (ноги не скользят). */
export const travel = (u: number, r: number) => {
  const x = clamp(u, 0, 1), k = 2 * r * (1 - r);
  if (r <= 0) return x;
  if (x < r) return (x * x) / k;
  if (x > 1 - r) return 1 - ((1 - x) * (1 - x)) / k;
  return (x - r / 2) / (1 - r);
};

/** Скорость по умолчанию, длин ноги в секунду: в профиль ≈1,6–1,8 шага/с при шаге ≈0,7 ноги.
 *  От ноги, а не от роста: длинноногий идёт быстрее коротконогого при том же характере шага. Снизу —
 *  предел в ростах (SPEED_FLOOR): коротконогий не должен ползти так, что сцена его не дождётся. */
const LEG_SPEED = { side: { walk: 1.1, run: 2.7 }, front: { walk: 1.1, run: 2.4 } } as const;
const SPEED_FLOOR = { walk: 0.4, run: 0.9 } as const;
/** Скорость по умолчанию, пиксели кадра в секунду. leg — длина ноги в пикселях кадра (0/нет — от роста). */
export const defaultSpeed = (kind: "walk" | "run" | "move", o: { height: number; leg?: number; view?: "front" | "side" }) =>
  kind === "move" ? 0.8 * o.height
    : o.leg ? Math.max(LEG_SPEED[o.view ?? "front"][kind] * o.leg, SPEED_FLOOR[kind] * o.height)
      : (kind === "run" ? 1.4 : 0.6) * o.height;

/** Где корень (точка на земле под героем) и куда он смотрит в момент t.
 *  leg — длина ноги в пикселях кадра (evaluate знает её по скелету); без неё скорость — от роста.
 *  Переходы идут очередью: следующий начинается не раньше, чем кончился предыдущий (а не «из
 *  прошлого» — иначе герой прыгал бы на уже пройденную часть второго пути). */
export const placeAt = (acts: RigAction[], t: number, o: { x: number; y: number; facing?: 1 | -1; height: number; leg?: number; view?: "front" | "side" }) => {
  let x = o.x, y = o.y, facing: 1 | -1 = o.facing ?? 1, moving: Moving | null = null, turnedAt = -Infinity;
  let stopped: { end: number; dir: number; kind: Moving["kind"] } | null = null;
  let free = -Infinity; // когда кончился предыдущий переход
  const face = (f: 1 | -1, at: number) => { if (f !== facing) { facing = f; turnedAt = at; } };
  for (const a of [...acts].sort((p, q) => p.at - q.at)) {
    if (t < a.at) break;
    if (a.do === "turn") { face(a.facing, a.at); continue; }
    if (a.do !== "walk" && a.do !== "run" && a.do !== "move") continue;
    const start = Math.max(a.at, free);
    if (t < start) break;
    const [tx, ty] = a.to;
    const len = Math.hypot(tx - x, ty - y);
    const dur = a.dur ?? Math.max(0.5, len / defaultSpeed(a.do, o));
    const dir = Math.sign(tx - x) || facing;
    if (a.face !== false && tx !== x) face(dir > 0 ? 1 : -1, start);
    const u = clamp((t - start) / dur, 0, 1);
    // Разгон/торможение ~0,25 с (не больше трети пути с каждой стороны).
    const e = travel(u, Math.min(0.3, 0.25 / dur));
    free = start + dur;
    if (u < 1) { moving = { at: start, end: start + dur, kind: a.do, dir, dist: len * e, len, hx: len > 0 ? Math.abs(tx - x) / len : 1 }; x += (tx - x) * e; y += (ty - y) * e; break; }
    x = tx; y = ty;
    stopped = len > 0 ? { end: start + dur, dir, kind: a.do } : stopped;
  }
  return { x, y, facing, moving, turnedAt, stopped };
};

/** Разворот длится столько секунд: фигура сжимается по ширине и раскрывается в другую сторону. */
export const TURN_SEC = 0.18;

// ── шаг: опорная нога стоит на земле, маховая переносится вперёд ────────────────────────────
const restCache = new WeakMap<RigDef, { h: number }>();
const restHeight = (rig: RigDef) => {
  let r = restCache.get(rig);
  if (!r) { r = { h: Math.max(1, restBounds(rig).h) }; restCache.set(rig, r); }
  return r.h;
};

/** Длина звена от сустава до низа (пиксели своей картинки). */
const segLen = (p?: RigPart) => (!p ? 0 : p.hose ? p.hose.len : Math.max(1, (p.h ?? 0) - (p.pivot?.[1] ?? 0)) * 0.94);
/** Бедро с голенью: длина — от тазобедренного сустава до колена (точки крепления голени), а не до низа
 *  картинки бедра. Картинка обычно длиннее (колено нарисовано с запасом), и тогда стопа встаёт не там,
 *  где её ставит расчёт шага, — опорная нога едет по полу, тем сильнее, чем больше сгиб (бег). */
const thighLen = (thigh: RigPart, shin?: RigPart) =>
  shin && !shin.hose && !thigh.hose && shin.at ? Math.max(1, Math.hypot(shin.at[0] - (thigh.pivot?.[0] ?? 0), shin.at[1] - (thigh.pivot?.[1] ?? 0))) : segLen(thigh);

/** Двухзвенная нога: стопа в точке (fx вперёд, fy вниз) от бедра. Углы — «вперёд положительно», градусы:
 *  бедро от вертикали, голень относительно бедра (колено вперёд, голень назад). */
export const legIK = (fx: number, fy: number, l1: number, l2: number) => {
  const d = clamp(Math.hypot(fx, fy), 1e-3, (l1 + l2) * 0.999);
  const aim = Math.atan2(fx, fy);
  const knee = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const inner = Math.acos(clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1));
  const deg = 180 / Math.PI;
  return { thigh: (aim + knee) * deg, shin: -(Math.PI - inner) * deg };
};

/** Длина ноги в долях роста (бедро + голень; у резиновой — её длина). 0 — ног нет. */
export const legShare = (rig: RigDef) => {
  const leg = rig.parts.legL ?? rig.parts.legR;
  if (!leg) return 0;
  const shin = rig.parts.legL ? rig.parts.shinL : rig.parts.shinR;
  return (thighLen(leg, shin) + segLen(shin)) / restHeight(rig);
};

/** Наклон туловища (градусы по часовой, в осях героя) — над бёдрами, а не вокруг стоп: корень-фигуру
 *  не крутим (иначе опорная стопа поедет и уйдёт под пол), ногам наклон возвращаем, голова держит
 *  горизонт наполовину. */
const leanTorso = (rig: RigDef, p: Pose, deg: number) => {
  if (!deg) return;
  const root = rootOf(rig);
  p.ang[root] = (p.ang[root] ?? 0) + deg;
  // Ноги крепятся к туловищу не в точке его вращения (бёдра шире): при наклоне точки крепления ушли бы
  // вверх-вниз и опорная стопа — под пол. Сдвигаем крепление назад: at' = pivot + R(−deg)·(at − pivot).
  const pv = rig.parts[root].pivot ?? [0, 0], r = (-deg * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r);
  for (const leg of ["legL", "legR"]) {
    const part = rig.parts[leg];
    if (part?.parent !== root) continue;
    p.ang[leg] = (p.ang[leg] ?? 0) - deg;
    const ax = (part.at?.[0] ?? 0) - pv[0], ay = (part.at?.[1] ?? 0) - pv[1];
    const o = p.off[leg] ?? [0, 0];
    p.off[leg] = [o[0] + pv[0] + c * ax - sn * ay - (part.at?.[0] ?? 0), o[1] + pv[1] + sn * ax + c * ay - (part.at?.[1] ?? 0)];
  }
  if (rig.parts.head?.parent === root) p.ang.head = (p.ang.head ?? 0) - deg * 0.5;
};

// Цифры шага — с разбора чужих мультяшных походок (маскот HeyGen, Lemo, Clawd): короткий частый шаг,
// руки с запаздыванием, кивок на каждом шаге, наклон вперёд, доигрыш корпуса после остановки.
type Gait = { stride: number; v0: number; min: number; max: number; lift: number; arms: number; lean: number; nod: number };
const GAIT: Record<"front" | "side", Record<"walk" | "run", Gait>> = {
  // stride — шаг (в длинах ноги) на обычной скорости v0 (длин ноги в секунду). Медленнее — шаг
  // короче и реже, быстрее — длиннее и чаще (как у живых: шаг ∝ √скорости), в пределах min..max.
  // lift — подъём стопы в длинах ноги; arms — размах рук, градусы; lean — наклон туловища;
  // nod — кивок головы.
  side: {
    // Нижний предел шага не ниже 0,6 ноги: медленная прогулка — редкие шаги, а не семенящие на
    // полусогнутых (у ботинка нет своего сустава: чем сильнее согнуто колено, тем сильнее носок
    // смотрит вниз — «на цыпочках»). Пружина колена поэтому мягкая.
    walk: { stride: 0.7, v0: 1.1, min: 0.6, max: 0.9, lift: 0.08, arms: 20, lean: 5, nod: 3 },
    run: { stride: 1.0, v0: 2.7, min: 0.8, max: 1.3, lift: 0.22, arms: 36, lean: 11, nod: 4 },
  },
  // Анфас при ходьбе вбок — как у мультяшных героев анфас (чашка Lemo, Clawd): ноги переступают под
  // телом поочерёдно, каждая стопа уходит от своего места лишь на полшага — ноги не расходятся
  // «циркулем». Шаг короткий и частый, стопа поднимается заметно, корпус переваливается.
  front: {
    walk: { stride: 0.3, v0: 1.1, min: 0.2, max: 0.45, lift: 0.14, arms: 10, lean: 0, nod: 2 },
    run: { stride: 0.45, v0: 2.4, min: 0.3, max: 0.6, lift: 0.2, arms: 16, lean: 0, nod: 3 },
  },
};

/** Ноги и руки при ходьбе/беге от пройденного пути: стопа опорной ноги неподвижна относительно земли. */
const gait = (rig: RigDef, p: Pose, mv: Moving, w: number, H: number, localDir: number, wIn = w) => {
  const view = rig.view === "side" ? "side" : "front", run = mv.kind === "run";
  const g = GAIT[view][run ? "run" : "walk"];
  const restH = restHeight(rig), k = H / restH; // пиксели скелета → пиксели кадра
  // Шаг — по полу: считается от горизонтальной доли пути (по диагонали корень по x идёт на cos θ, и
  // шаг по всему пути обгонял бы тело — опорная стопа ехала бы). Совсем вертикальный путь (к зрителю/
  // от зрителя) всё равно шагает, хоть и мельче, — иначе герой «плыл» бы.
  const hx = Math.max(0.35, mv.hx);
  const dist = (mv.dist / k) * hx, len = (mv.len / k) * hx;
  // Длина ноги, пиксели скелета. Нет ног (призрак, рыба, бюст) — условная нога от роста, иначе шаг
  // в доли пикселя и руки дёргаются хаотично.
  const share = legShare(rig), Lg = (share > 0 ? share : 0.45) * restH;
  // Средняя скорость перехода (пиксели скелета в секунду) — от неё длина шага (∝ √скорости).
  const v = len / Math.max(0.05, mv.end - mv.at);
  let want = Lg * (g.v0 > 0 ? clamp(g.stride * Math.sqrt(v / (g.v0 * Lg)), g.min, g.max) : g.stride);
  // Анфас стопы ходят рядом: шаг не больше 0,7 расстояния между ногами — иначе одна стопа заходит
  // за другую (ноги перекрещиваются). Близко поставленные ноги семенят мелко и часто.
  const gap = Math.abs((rig.parts.legR?.at?.[0] ?? 0) - (rig.parts.legL?.at?.[0] ?? 0));
  if (view === "front" && gap > 0) want = Math.min(want, 0.7 * gap);
  // Шаг подгоняется под путь: стопы стоят на своих местах через каждые stride пути. Целое число шагов =
  // герой трогается и останавливается со стопами как в покое, без доводки ноги «по полу» в конце.
  const stride = len > 1e-6 ? len / Math.max(1, Math.round(len / want)) : want;
  const cssDeg = (forward: number) => -forward * localDir; // «вперёд» → угол CSS (по часовой)
  type LegState = { leg: "legL" | "legR"; shinName: string; shin?: RigPart; l1: number; l2: number; L: number; fx: number; up: number; planted: boolean; c: number; hip: number };
  const legs: LegState[] = [];
  for (const [leg, ph0] of [["legL", 0], ["legR", 0.5]] as const) {
    const thigh = rig.parts[leg];
    if (!thigh) continue;
    const shinName = leg === "legL" ? "shinL" : "shinR", shin = rig.parts[shinName];
    const l1 = thighLen(thigh, shin), l2 = shin ? segLen(shin) : 0, L = l1 + l2;
    let fx: number, up = 0, planted: boolean, c: number;
    // Профиль и анфас шагают одинаково: ноги поочерёдно, у каждой стопы своё место (в профиль — под
    // бедром, анфас — на ширине бёдер). +0,25: в начале пути стопы на своих местах.
    c = (((dist / (2 * stride) + ph0 + 0.25) % 1) + 1) % 1;
    planted = c < 0.5;
    if (planted) fx = stride / 2 - (c / 0.5) * stride; // опора: стопа на месте, тело уходит вперёд
    else {
      // Перенос: кривая Эрмита со скоростью −1 по краям — в момент отрыва и постановки стопа
      // неподвижна относительно земли (иначе нога «приземляется на ходу» и скользит).
      const u = (c - 0.5) / 0.5;
      fx = -stride / 2 + stride * (-4 * u * u * u + 6 * u * u - u);
      up = g.lift * L * Math.sin(Math.PI * u) ** (view === "side" ? 1.5 : 1);
    }
    // Положение стопы НЕ умножаем на плавный вход w: иначе опорная стопа едет по полу на старте
    // и на остановке. Вход/выход сглаживают только подъём ноги и сгиб колена.
    up *= w;
    const reach = Math.min(Math.abs(fx), 0.85 * L);
    const bent = Math.sqrt(Math.max(0, (0.985 * L) ** 2 - reach * reach)); // высота бедра над опорной стопой
    const hip = bent + (1 - w) * (Math.sqrt(Math.max(0, (0.999 * L) ** 2 - reach * reach)) - bent);
    legs.push({ leg, shinName, shin, l1, l2, L, fx, up, planted, c, hip });
  }
  // Высота бёдер — по опорной ноге (ниже всего на постановке, выше над стопой); с коленом обе ноги
  // считаются от этой общей высоты — маховая стопа идёт ровно на up над полом. Пружину колена (бёдра
  // проседают после постановки) не делаем: у голени с ботинком нет голеностопа, и согнутое колено
  // опускает носок — герой идёт «на цыпочках».
  const planted = legs.filter((s) => s.planted);
  // Колено сгибается только в профиль. Анфас колено гнётся к зрителю — на картинке нога прямая;
  // изгиб вбок читается как перелом, поэтому анфас нога с голенью ведёт себя как одна прямая часть.
  const knees = view === "side" && legs.length > 0 && legs.every((s) => s.shin);
  const hipA = planted.length ? Math.min(...planted.map((s) => s.hip)) : Math.max(0, ...legs.map((s) => s.hip));
  let drop = 0;
  for (const s of legs) {
    if (s.planted) drop = Math.max(drop, s.L - (knees ? hipA : s.hip));
    if (s.shin && knees) {
      const ik = legIK(s.fx, (knees ? hipA : s.hip) - s.up, s.l1, s.l2);
      p.ang[s.leg] = (p.ang[s.leg] ?? 0) + cssDeg(ik.thigh);
      p.ang[s.shinName] = (p.ang[s.shinName] ?? 0) + cssDeg(ik.shin);
    } else {
      const a = (Math.asin(clamp(s.fx / s.L, -0.85, 0.85)) * 180) / Math.PI;
      p.ang[s.leg] = (p.ang[s.leg] ?? 0) + cssDeg(a);
      if (s.up > 0) p.off[s.leg] = [0, -s.up]; // нога поднимается целиком, без сплющивания картинки
    }
  }
  // Бёдра идут по опорной ноге: ниже в момент постановки стопы, выше над ней.
  p.dy += drop * k - (run ? 0.03 * H * w * Math.abs(Math.sin((Math.PI * dist) / stride)) : 0);
  // Руки и голова — от фазы стопы. Видимый ход ноги (угол бедра) опережает фазу стопы на ~2,5 кадра,
  // так что рука отстаёт от бедра на 2–3 кадра сама: «догоняет» шаг, а не машет в такт.
  const lagged = dist;
  if (view === "side") {
    // Рука идёт с противоположной ногой: вперёд, когда своя нога сзади.
    // Ход ноги ≈ cos(2π·c) (c — фаза ноги, см. выше), рука — со знаком минус.
    for (const [arm, ph0] of [["armL", 0], ["armR", 0.5]] as const) {
      if (!rig.parts[arm]) continue;
      const c = lagged / (2 * stride) + ph0 + 0.25;
      p.ang[arm] = (p.ang[arm] ?? 0) + cssDeg(-w * g.arms * Math.cos(TAU * c));
    }
    // Кивок: голова клонится вперёд на постановке каждой стопы (шаг = полцикла), с тем же запаздыванием.
    if (rig.parts.head) p.ang.head = (p.ang.head ?? 0) - cssDeg(w * g.nod * Math.cos(TAU * (lagged / stride - 0.5)));
    // Наклон вперёд по ходу — туловищем над бёдрами. Входит плавно, а к концу пути не гаснет: после
    // остановки его подхватывает доигрыш (settle) с той же величины — иначе корпус «нырял» бы туда-обратно.
    leanTorso(rig, p, -cssDeg(wIn * g.lean));
  } else {
    const sway = Math.sin((Math.PI * dist) / stride), swayArm = Math.sin((Math.PI * lagged) / stride);
    if (rig.parts.armL) p.ang.armL = (p.ang.armL ?? 0) + w * g.arms * Math.max(0, swayArm);
    if (rig.parts.armR) p.ang.armR = (p.ang.armR ?? 0) - w * g.arms * Math.max(0, -swayArm);
    if (rig.parts.head) p.ang.head = (p.ang.head ?? 0) + w * g.nod * Math.sin((Math.PI * lagged) / stride);
    // Переваливание с ноги на ногу — туловищем над бёдрами.
    leanTorso(rig, p, w * 3 * sway);
  }
};

/** Наклон корпуса после остановки (градусы «вперёд»), u — секунды от остановки. Ноги встали, а корпус
 *  по инерции продолжает: с наклона на ходу (lean) чуть вперёд, затем откат назад за вертикаль и
 *  покой к ~0,65 с. Непрерывен с наклоном на ходу (settle(0) = lean). */
export const settle = (u: number, lean: number, run: boolean) => {
  if (u < 0 || u >= 0.65) return 0;
  const top = lean + (run ? 3 : 2), back = -0.25 * top;
  const ease = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(x, 0, 1));
  if (u < 0.12) return lean + (top - lean) * Math.sin((Math.PI / 2) * (u / 0.12));
  if (u < 0.45) return top + (back - top) * ease((u - 0.12) / 0.33);
  return back * (1 - ease((u - 0.45) / 0.2));
};

/** Поза в момент t: покой (дыхание, моргание, лёгкое покачивание) + действия + запаздывание. */
/** Число из строки (имя героя) — чтобы у разных героев было своё расписание моргания и дыхания. */
const seedOf = (s: string) => { let h = 7; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 1000003; return h; };

export const evaluate = (rig: RigDef, acts: RigAction[], t: number, o0: { x: number; y: number; facing?: 1 | -1; height: number; seed?: string }) => {
  const share = legShare(rig);
  const o = { ...o0, leg: share > 0 ? share * o0.height : undefined, view: rig.view === "side" ? "side" as const : "front" as const };
  const at = placeAt(acts, t, o);
  const p: Pose = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, facing: at.facing, ang: {}, len: {}, scale: {}, alt: {}, off: {} };
  const has = (n: string) => Boolean(rig.parts[n]);
  const add = (n: string, v: number) => { if (has(n)) p.ang[n] = (p.ang[n] ?? 0) + v; };
  const out = (n: string, v: number) => add(n, side(n) * v); // наружу от тела
  const alt = (n: string, k: string) => { if (rig.parts[n]?.alt?.[k]) p.alt[n] = k; };
  const H = o.height;
  const face = has("head") ? "head" : rootOf(rig);
  // В профиль ближняя к зрителю рука — та, что рисуется поверх (больше z); дальняя уходит за спину.
  const nearArm: "L" | "R" = rig.view === "side" && (rig.parts.armL?.z ?? 0) > (rig.parts.armR?.z ?? 0) ? "L" : "R";

  // Разворот: не мгновенное зеркало, а мультяшный «переворот» по ширине (−1 → 0 → 1 за TURN_SEC).
  if (t >= at.turnedAt && t < at.turnedAt + TURN_SEC) p.sx *= -Math.cos(Math.PI * sm((t - at.turnedAt) / TURN_SEC));

  // Покой: дыхание, голова, руки чуть отведены. Фаза — своя у каждого героя (по имени),
  // иначе два героя в кадре дышат и моргают синхронно, как один.
  const seed = seedOf(o.seed ?? rig.name ?? ""), ph = TAU * hash(seed);
  const br = Math.sin((TAU * t) / 2.4 + ph);
  p.sy *= 1 + 0.012 * br;
  add("head", 2 * Math.sin((TAU * t) / 3.3 + 0.7 + ph));
  out("armL", 4 + 2 * br); out("armR", 4 + 2 * Math.sin((TAU * t) / 2.4 + 0.5 + ph));
  // Моргание по своему расписанию (детерминированно, своё у каждого героя).
  for (let k = 0, tt = 0.5 + 1.6 * hash(seed + 0.5); tt < t + 0.2 && k < 400; tt += 2.2 + 2.6 * hash(seed + k++)) if (t >= tt && t < tt + 0.13) alt(face, "blink");

  // Ходьба / бег: шаг от пройденного пути — опорная стопа стоит, маховая переносится (см. gait).
  const mv = at.moving;
  // Ноги встали — корпус доигрывает по инерции (в профиль; анфас качнуться «вперёд» некуда). Если
  // следующий переход начался, пока доигрыш не кончился, он гаснет за вход нового шага, а не обрывается.
  if (at.stopped && at.stopped.kind !== "move" && rig.view === "side") {
    const fade = mv ? 1 - sm((t - mv.at) / 0.3) : 1;
    const run = at.stopped.kind === "run", s = settle(t - at.stopped.end, GAIT.side[run ? "run" : "walk"].lean, run) * fade;
    if (s) leanTorso(rig, p, s * at.stopped.dir * at.facing);
  }
  if (mv && mv.kind !== "move") {
    gait(rig, p, mv, env(t, mv.at, mv.end, 0.15), H, mv.dir * at.facing, sm((t - mv.at) / 0.3));
  } else if (mv) {
    const w = env(t, mv.at, mv.end, 0.2);
    p.rot += w * 4 * mv.dir; p.dy -= w * 0.04 * H * Math.sin(Math.PI * clamp((t - mv.at) / (mv.end - mv.at), 0, 1));
  }

  for (const a of acts) {
    const lt = t - a.at, end = actionEnd(a);
    if (lt < 0 || t > end + 0.4) continue;
    const dur = end - a.at;
    switch (a.do) {
      case "hop": {
        const h = a.h ?? 0.22 * H;
        if (lt < 0.15) { const k = sm(lt / 0.15); p.sy *= 1 - 0.14 * k; p.sx *= 1 + 0.1 * k; out("armL", 10 * k); out("armR", 10 * k); }
        else if (lt < 0.6) { const u = (lt - 0.15) / 0.45, k = (1 - u) ** 2; p.dy -= h * 4 * u * (1 - u); p.sy *= 1 + 0.1 * k; p.sx *= 1 - 0.06 * k; const up = 35 * Math.sin(Math.PI * u); out("armL", up); out("armR", up); }
        else if (lt < 0.95) { const k = (1 - (lt - 0.6) / 0.35) ** 2; p.sy *= 1 - 0.12 * k; p.sx *= 1 + 0.09 * k; }
        break;
      }
      case "wave": case "point": {
        const arm = `arm${a.arm ?? nearArm}`, w = env(t, a.at, end, 0.25);
        if (a.do === "wave") { out(arm, w * ((a.angle ?? 150) + 18 * Math.sin(TAU * 2.6 * lt))); add("head", -side(arm) * w * 4); }
        else out(arm, w * (a.angle ?? 80));
        break;
      }
      case "cheer": {
        const w = env(t, a.at, end, 0.2), up = 155 + 10 * Math.sin(TAU * 3.2 * lt);
        out("armL", w * up); out("armR", w * up);
        p.dy -= w * 0.03 * H * Math.abs(Math.sin(TAU * 1.6 * lt));
        if (w > 0.5) alt(face, "talk");
        break;
      }
      case "talk": {
        const w = env(t, a.at, end, 0.05);
        if (a.beats?.length) { if (mouthOpen(a.beats, lt)) alt(face, "talk"); }
        else if (w > 0.5 && hash(Math.floor(lt * 9) + 17) > 0.4) alt(face, "talk");
        add("head", w * 2.5 * Math.sin(TAU * 2.2 * lt));
        break;
      }
      case "surprise": {
        const k = sm(lt / 0.08) * (1 - sm((lt - 0.4) / 0.4));
        if (face === "head") p.scale.head = (p.scale.head ?? 1) * (1 + 0.1 * k); else { p.sy *= 1 + 0.08 * k; p.sx *= 1 - 0.04 * k; }
        out("armL", 55 * k); out("armR", 55 * k);
        if (lt < 0.35) p.dy -= 0.06 * H * Math.sin((Math.PI * lt) / 0.35);
        if (lt < 0.6) alt(face, "talk");
        break;
      }
      case "sleep": {
        const w = env(t, a.at, end, 0.4);
        p.rot += w * 5 * at.facing; add("head", w * 14 * at.facing);
        p.sy *= 1 + w * 0.02 * Math.sin((TAU * lt) / 3.2);
        if (w > 0.5) alt(face, "blink");
        break;
      }
      case "look": add("head", env(t, a.at, end, 0.25) * a.angle); break;
      case "nod": add("head", env(t, a.at, end, 0.1) * 9 * Math.sin(TAU * 2.2 * lt)); break;
      case "shiver": {
        const w = env(t, a.at, end, 0.15);
        p.dx += w * 0.006 * H * Math.sin(TAU * 17 * lt); out("armL", -8 * w); out("armR", -8 * w); p.sy *= 1 - 0.03 * w;
        break;
      }
      case "pose": {
        const w = env(t, a.at, end, a.ease ?? Math.min(0.3, dur / 3));
        for (const [n, v] of Object.entries(a.angles ?? {})) (LIMB.test(n) ? out : add)(n, w * v);
        p.rot += w * (a.lean ?? 0); p.dy += w * (a.dy ?? 0);
        if (w > 0.5) for (const [n, k] of Object.entries(a.alt ?? {})) alt(n, k);
        break;
      }
    }
  }

  // Запаздывание: уши, хвост, волосы отстают от движения корня и покачиваются. Углы частей — в осях
  // героя, а он при ходьбе влево отражён: скорость по экрану переводим в его оси (× facing), иначе
  // при ходьбе влево уши клонятся вперёд, а не отстают.
  const prev = placeAt(acts, t - 0.1, o);
  const vx = ((at.x - prev.x) / 0.1 / Math.max(1, H)) * at.facing;
  Object.entries(rig.parts).forEach(([n, part], i) => {
    if (!part.follow) return;
    add(n, clamp(-vx * 22 * part.follow, -30, 30) + part.follow * 5 * Math.sin((TAU * t) / 1.6 + i));
  });
  // Тянуться к точке: после всех остальных движений — рука поворачивается к цели вокруг своего плеча
  // (в осях родителя: учтены наклон, отражение и рост героя), длина руки не меняется.
  const reaches = acts.filter((a): a is Extract<RigAction, { do: "reach" }> => a.do === "reach" && t >= a.at && t <= actionEnd(a) + 0.4);
  if (reaches.length) {
    const rest = restBounds(rig);
    for (const a of reaches) {
      const arm = `arm${a.arm ?? nearArm}`, part = rig.parts[arm];
      const w = env(t, a.at, actionEnd(a), a.ease ?? 0.5);
      if (!part || !part.parent || w <= 0) continue;
      const items = drawList(rig, p, rootMatrix(rig, rest, at.x, at.y, H, p));
      const parent = items.find((i) => i.name === part.parent);
      if (!parent) continue;
      const pm = parent.kind === "hose" ? mul(parent.m, T(0, parent.len)) : parent.m;
      const off = p.off[arm] ?? [0, 0];
      const sh = apply(pm, [(part.at?.[0] ?? 0) + off[0], (part.at?.[1] ?? 0) + off[1]]);
      const dx = a.to[0] - sh[0], dy = a.to[1] - sh[1];
      if (Math.hypot(dx, dy) < 1) continue;
      // Вектор к цели — в оси родителя (обратная линейная часть его матрицы).
      const det = pm[0] * pm[3] - pm[1] * pm[2];
      if (Math.abs(det) < 1e-9) continue;
      const vx = (pm[3] * dx - pm[2] * dy) / det, vy = (-pm[1] * dx + pm[0] * dy) / det;
      // Рука висит вниз (+y своей картинки); R(θ)·(0,1) = (−sin θ, cos θ) → θ = atan2(−vx, vy).
      const want = (Math.atan2(-vx, vy) * 180) / Math.PI - (part.rest ?? 0);
      const cur = p.ang[arm] ?? 0;
      const diff = ((((want - cur) % 360) + 540) % 360) - 180; // кратчайший поворот
      p.ang[arm] = cur + w * diff;
    }
  }
  return { x: at.x, y: at.y, pose: p, moving: at.moving };
};

/** Где кисть и плечо руки героя в момент t (пиксели кадра) и длина руки — чтобы положить в руку
 *  предмет (покебол, чашку) или выбрать точку, до которой герой дотянется (reach). */
export const handAt = (rig: RigDef, acts: RigAction[], t: number, o: { x: number; y: number; facing?: 1 | -1; height: number; seed?: string }, arm: Side) => {
  const st = evaluate(rig, acts, t, o);
  const items = drawList(rig, st.pose, rootMatrix(rig, restBounds(rig), st.x, st.y, o.height, st.pose));
  const name = `arm${arm}`, it = items.find((i) => i.name === name), part = rig.parts[name];
  if (!it || !part) return null;
  const sh = it.kind === "img" ? apply(it.m, part.pivot ?? [0, 0]) : apply(it.m, [0, 0]);
  const hand = it.kind === "img" ? apply(it.m, [part.pivot?.[0] ?? (part.w ?? 0) / 2, (part.h ?? 0) * 0.94]) : apply(it.m, [0, it.len]);
  return { shoulder: sh, hand, length: Math.hypot(hand[0] - sh[0], hand[1] - sh[1]) };
};

const restPose = (): Pose => ({ dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, facing: 1, ang: {}, len: {}, scale: {}, alt: {}, off: {} });

const hosePath = (len: number, ang: number) => {
  const bx = -clamp(ang, -120, 120) / 120 * len * 0.22;
  return `M0,0 C${bx.toFixed(1)},${(len * 0.35).toFixed(1)} ${bx.toFixed(1)},${(len * 0.65).toFixed(1)} 0,${len.toFixed(1)}`;
};

/** Части в мировых координатах для позы и матрицы корня (корень = точка вращения туловища). */
export const drawList = (rig: RigDef, pose: Pose, rootM: Mat): DrawItem[] => {
  const root = rootOf(rig);
  const items: DrawItem[] = [];
  const kids = (n: string) => Object.keys(rig.parts).filter((k) => rig.parts[k].parent === n);
  let order = 0;
  const visit = (n: string, parentM: Mat, parentZ: number) => {
    const p = rig.parts[n];
    const ang = (p.rest ?? 0) + (pose.ang[n] ?? 0);
    const sc = pose.scale[n] ?? 1, ln = pose.len[n] ?? 1;
    const off = pose.off?.[n] ?? [0, 0];
    const base = n === root ? chain(rootM, R(ang)) : chain(parentM, T((p.at?.[0] ?? 0) + off[0], (p.at?.[1] ?? 0) + off[1]), R(ang), S(sc, sc * ln));
    const z = p.z ?? parentZ;
    if (p.hose) {
      items.push({ name: n, kind: "hose", d: hosePath(p.hose.len, pose.ang[n] ?? 0), len: p.hose.len, width: p.hose.width, color: p.hose.color, outline: p.hose.outline, endR: p.hose.endR, endColor: p.hose.endColor, m: base, z, order: order++ });
      // Дети резиновой конечности (кисть, ботинок) крепятся к её концу; их at — сдвиг от конца.
      for (const k of kids(n)) visit(k, chain(base, T(0, p.hose.len)), z);
      return;
    }
    const m = chain(base, T(...(p.pivot ?? [0, 0]).map((v) => -v) as Vec));
    const k = pose.alt[n];
    items.push({ name: n, kind: "img", src: (k && p.alt?.[k]) || p.src!, w: p.w!, h: p.h!, m, z, order: order++ });
    for (const c of kids(n)) visit(c, m, z);
  };
  visit(root, I, 0);
  return items.sort((a, b) => a.z - b.z || a.order - b.order);
};

/** Рамка частей (мировые координаты). */
export const bounds = (items: DrawItem[]) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const it of items) {
    const pts: Vec[] = it.kind === "img" ? [[0, 0], [it.w, 0], [0, it.h], [it.w, it.h]] : [[-it.width, 0], [it.width, 0], [-it.width, it.len], [it.width, it.len]];
    for (const q of pts) { const [x, y] = apply(it.m, q); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

/** Рамка скелета в исходной позе (корень в 0,0): высота героя и где у него земля. */
export const restBounds = (rig: RigDef) => bounds(drawList(rig, restPose(), I));

/** Матрица корня: точка на земле (x, y) — середина низа героя в исходной позе, высота height px. */
export const rootMatrix = (rig: RigDef, rest: ReturnType<typeof restBounds>, x: number, y: number, height: number, pose: Pose): Mat => {
  const k = height / rest.h;
  return chain(T(x + pose.dx, y + pose.dy), R(pose.rot), S(pose.facing * pose.sx * k, pose.sy * k), T(-(rest.x + rest.w / 2), -(rest.y + rest.h)));
};

/** Слогов в слове — по гласным (русские и латиница); цифры и сокращения — хотя бы один. */
export const syllables = (word: string) => Math.max(1, (word.toLowerCase().match(/[аеёиоуыэюяaeiouy]/g) ?? []).length);

/** Открыт ли рот в момент lt (с от начала реплики): каждый слог слова — «открыл и прикрыл»,
 *  в паузах между словами рот закрыт. Слог короче ~3 кадров глаз не различит — такие сливаются. */
export const mouthOpen = (beats: [number, number, number][], lt: number) => {
  for (const [s, e, n] of beats) {
    if (lt < s || lt >= e) continue;
    const k = Math.max(1, Math.min(n, Math.floor((e - s) / 0.1)));
    const u = (((lt - s) / (e - s)) * k) % 1;
    return u < 0.65;
  }
  return false;
};

type WordsJson = { lines?: { start: number; end: number; id?: string; words?: { text: string; start: number; end: number }[] }[] };

/** Реплики героя из words.json → действия talk: рот открывается на слогах слов и закрыт в паузах. */
export const talkFromWords = (words: WordsJson, opt: { from?: number; to?: number; ids?: string[]; offset?: number } = {}): RigAction[] =>
  (words.lines ?? [])
    .filter((l) => (!opt.ids || (l.id && opt.ids.includes(l.id))) && l.end > (opt.from ?? -Infinity) && l.start < (opt.to ?? Infinity))
    .map((l) => {
      const beats = (l.words ?? []).filter((w) => w.end > w.start)
        .map((w): [number, number, number] => [w.start - l.start, w.end - l.start, syllables(w.text)]);
      return { do: "talk" as const, at: l.start - (opt.offset ?? 0), dur: l.end - l.start, ...(beats.length ? { beats } : {}) };
    });
