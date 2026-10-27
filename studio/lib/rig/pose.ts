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
  | { do: "cheer" | "talk" | "sleep" | "nod" | "shiver" | "surprise"; at: number; dur?: number }
  | { do: "look"; at: number; dur?: number; angle: number }
  | { do: "turn"; at: number; facing: 1 | -1 }
  | { do: "pose"; at: number; dur?: number; ease?: number; angles?: Record<string, number>; lean?: number; dy?: number; alt?: Record<string, string> };

export type Pose = {
  dx: number; dy: number; rot: number; sx: number; sy: number; facing: 1 | -1;
  ang: Record<string, number>; len: Record<string, number>; scale: Record<string, number>; alt: Record<string, string>;
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

const DUR: Record<string, number> = { hop: 0.95, wave: 1.6, point: 1.5, cheer: 1.4, talk: 1.5, sleep: 2, nod: 0.8, shiver: 1.2, surprise: 0.8, look: 1.2, pose: 1.2 };
export const actionEnd = (a: RigAction): number => (a.do === "turn" ? a.at : a.at + ("dur" in a && a.dur ? a.dur : DUR[a.do] ?? 1));

type Moving = { at: number; end: number; kind: "walk" | "run" | "move"; dir: number };

/** Где корень (точка на земле под героем) и куда он смотрит в момент t. */
export const placeAt = (acts: RigAction[], t: number, o: { x: number; y: number; facing?: 1 | -1; height: number }) => {
  let x = o.x, y = o.y, facing: 1 | -1 = o.facing ?? 1, moving: Moving | null = null;
  for (const a of [...acts].sort((p, q) => p.at - q.at)) {
    if (t < a.at) break;
    if (a.do === "turn") { facing = a.facing; continue; }
    if (a.do !== "walk" && a.do !== "run" && a.do !== "move") continue;
    const [tx, ty] = a.to;
    const speed = (a.do === "run" ? 1.4 : a.do === "move" ? 0.8 : 0.6) * o.height;
    const dur = a.dur ?? Math.max(0.5, Math.hypot(tx - x, ty - y) / speed);
    const dir = Math.sign(tx - x) || facing;
    if (a.face !== false && tx !== x) facing = dir > 0 ? 1 : -1;
    const u = clamp((t - a.at) / dur, 0, 1);
    const e = 0.5 * u + 0.5 * sm(u);
    if (u < 1) { moving = { at: a.at, end: a.at + dur, kind: a.do, dir }; x += (tx - x) * e; y += (ty - y) * e; break; }
    x = tx; y = ty;
  }
  return { x, y, facing, moving };
};

/** Поза в момент t: покой (дыхание, моргание, лёгкое покачивание) + действия + запаздывание. */
export const evaluate = (rig: RigDef, acts: RigAction[], t: number, o: { x: number; y: number; facing?: 1 | -1; height: number }) => {
  const at = placeAt(acts, t, o);
  const p: Pose = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, facing: at.facing, ang: {}, len: {}, scale: {}, alt: {} };
  const has = (n: string) => Boolean(rig.parts[n]);
  const add = (n: string, v: number) => { if (has(n)) p.ang[n] = (p.ang[n] ?? 0) + v; };
  const out = (n: string, v: number) => add(n, side(n) * v); // наружу от тела
  const alt = (n: string, k: string) => { if (rig.parts[n]?.alt?.[k]) p.alt[n] = k; };
  const H = o.height;
  const face = has("head") ? "head" : rootOf(rig);

  // Покой: дыхание, голова, руки чуть отведены.
  const br = Math.sin((TAU * t) / 2.4);
  p.sy *= 1 + 0.012 * br;
  add("head", 2 * Math.sin((TAU * t) / 3.3 + 0.7));
  out("armL", 4 + 2 * br); out("armR", 4 + 2 * Math.sin((TAU * t) / 2.4 + 0.5));
  // Моргание по своему расписанию (детерминированно).
  for (let k = 0, tt = 0.9; tt < t + 0.2 && k < 400; tt += 2.2 + 2.6 * hash(k++)) if (t >= tt && t < tt + 0.13) alt(face, "blink");

  // Ходьба / бег: ноги и руки вразмах, подскок, наклон по ходу.
  const mv = at.moving;
  if (mv && mv.kind !== "move") {
    const run = mv.kind === "run";
    const w = env(t, mv.at, mv.end, 0.15), ph = (t - mv.at) * (run ? 2.6 : 1.8) * TAU, s = Math.sin(ph);
    if (rig.view === "side") {
      add("legL", w * (run ? 26 : 16) * s); add("legR", -w * (run ? 26 : 16) * s);
      add("shinL", w * 12 * Math.max(0, -s)); add("shinR", w * 12 * Math.max(0, s));
      if (has("legL")) p.len.legL = 1 - 0.1 * w * Math.max(0, s);
      if (has("legR")) p.len.legR = 1 - 0.1 * w * Math.max(0, -s);
      add("armL", -w * (run ? 30 : 18) * s); add("armR", -w * (run ? 30 : 18) * s);
    } else {
      // Анфас: шаг — нога приподнимается (короче) и чуть уходит наружу, тело переваливается.
      if (has("legL")) p.len.legL = 1 - (run ? 0.22 : 0.16) * w * Math.max(0, s);
      if (has("legR")) p.len.legR = 1 - (run ? 0.22 : 0.16) * w * Math.max(0, -s);
      out("legL", w * 6 * Math.max(0, s)); out("legR", w * 6 * Math.max(0, -s));
      out("armL", w * (run ? 22 : 12) * Math.max(0, -s)); out("armR", w * (run ? 22 : 12) * Math.max(0, s));
      add("torso", w * 3 * s);
    }
    p.dy -= w * (run ? 0.05 : 0.03) * H * Math.abs(s);
    p.rot += w * (run ? 7 : 3) * mv.dir;
    add("head", -w * 2 * s);
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
        const arm = `arm${a.arm ?? "R"}`, w = env(t, a.at, end, 0.25);
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
        if (w > 0.5 && hash(Math.floor(lt * 9) + 17) > 0.4) alt(face, "talk");
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

  // Запаздывание: уши, хвост, волосы отстают от движения корня и покачиваются.
  const prev = placeAt(acts, t - 0.1, o);
  const vx = (at.x - prev.x) / 0.1 / Math.max(1, H);
  Object.entries(rig.parts).forEach(([n, part], i) => {
    if (!part.follow) return;
    add(n, clamp(-vx * 22 * part.follow, -30, 30) + part.follow * 5 * Math.sin((TAU * t) / 1.6 + i));
  });
  return { x: at.x, y: at.y, pose: p };
};

const restPose = (): Pose => ({ dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, facing: 1, ang: {}, len: {}, scale: {}, alt: {} });

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
    const base = n === root ? chain(rootM, R(ang)) : chain(parentM, T(...(p.at ?? [0, 0])), R(ang), S(sc, sc * ln));
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

/** Реплики героя из words.json → действия talk (рот открывается на словах). */
export const talkFromWords = (words: { lines?: { start: number; end: number; id?: string }[] }, opt: { from?: number; to?: number; ids?: string[]; offset?: number } = {}): RigAction[] =>
  (words.lines ?? [])
    .filter((l) => (!opt.ids || (l.id && opt.ids.includes(l.id))) && l.end > (opt.from ?? -Infinity) && l.start < (opt.to ?? Infinity))
    .map((l) => ({ do: "talk" as const, at: l.start - (opt.offset ?? 0), dur: l.end - l.start }));
