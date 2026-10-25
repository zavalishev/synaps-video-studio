// Самопроверка по планам (битам): не «сломано ли», а «разнообразно ли и где сильнее всего».
// Всё — по пикселям черновика, без модели, за секунды:
//   • novelty  — средний кадр каждого бита сравнивается с остальными (структура в сером +
//                средний цвет): «уникальных планов N из M; b1≈b4 (0.93)». Три одинаковых
//                кадра из шести — это зацикленное слайд-шоу, даже если склейки есть;
//   • appeal   — насколько кадр «цепляет» плиткой в ленте: насыщенность (colorfulness
//                Хаслера–Зюсструнка) + контраст. Кадр 0 — превью: он должен быть не хуже
//                лучших кадров ролика;
//   • energy   — сколько меняется кадр в первые 10 кадров каждого бита (по probe diff):
//                кульминация (kind payoff/climax) должна быть заметно плотнее медианы (×1.3);
//   • cut grammar — на каждой склейке по плану: последний кадр бита A против первого кадра B.
//                jump-cut — склейка по плану, которую probe не видит, а кадры по обе стороны
//                почти одинаковые и чуть сдвинуты (тот же размер, герой прыгнул вбок);
//                mirror-cut — герой развернулся на склейке (кроп героя похож на зеркальный
//                кроп соседнего кадра сильнее, чем на прямой): нарушено направление взгляда.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

export type Segment = { id: string; from: number; to: number; kind?: string; hero?: string };
export type ShotIssue = { level: "FAIL" | "WARN" | "INFO"; source: "feed"; kind: string; frames?: [number, number]; id?: string; msg: string };
export type ShotMetrics = {
  segments: number; unique: number; similar: Array<{ a: string; b: string; sim: number }>; repeatShare: number;
  appeal: Array<{ id: string; f: number; score: number }>; open: { rank: number; of: number; score: number; best: { id: string; f: number; score: number } | null };
  energy: Array<{ id: string; ratio: number }>; climax: { id: string; ratio: number } | null;
  bestFrames: number[];
  cutsChecked: Array<{ f: number; sim: number; flip: number; hero: boolean }>;
};
export type Box4 = { x: number; y: number; w: number; h: number };
export type CutOpts = { planned?: number[]; detected?: number[]; heroAt?: (f: number) => Box4 | null; W?: number };
export const CLIMAX_MIN = 1.3;

const GW = 36, GH = 64;

// Отрезки: биты из beats.json → иначе куски между склейками → иначе окна по ~3 с (один дубль
// тоже получает оценку «один план весь ролик»).
export const segmentsOf = (beats: Segment[] | null, cuts: number[], frames: number, fps: number): Segment[] => {
  if (beats?.length) return beats.filter((b) => b.to > b.from);
  const cs = [...new Set(cuts.filter((c) => c > 0 && c < frames))].sort((p, q) => p - q);
  if (cs.length) return [0, ...cs].map((f, i, arr) => ({ id: `s${i + 1}`, from: f, to: arr[i + 1] ?? frames }));
  const n = Math.max(1, Math.round(frames / fps / 3));
  return Array.from({ length: n }, (_, i) => ({ id: `w${i + 1}`, from: Math.round((i * frames) / n), to: Math.round(((i + 1) * frames) / n) }));
};

type Thumb = { gray: Float32Array; rgb: [number, number, number]; appeal: number };

const thumbOf = async (png: string): Promise<Thumb> => {
  const { data } = await sharp(png).removeAlpha().resize(GW, GH, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  const n = GW * GH;
  const gray = new Float32Array(n);
  let r = 0, g = 0, b = 0, rg2 = 0, yb2 = 0, rgM = 0, ybM = 0, l = 0, l2 = 0;
  for (let i = 0; i < n; i++) {
    const R = data[i * 3], G = data[i * 3 + 1], B = data[i * 3 + 2];
    const y = 0.299 * R + 0.587 * G + 0.114 * B;
    gray[i] = y; r += R; g += G; b += B; l += y; l2 += y * y;
    const rgv = R - G, ybv = 0.5 * (R + G) - B;
    rgM += rgv; ybM += ybv; rg2 += rgv * rgv; yb2 += ybv * ybv;
  }
  rgM /= n; ybM /= n;
  const sRG = Math.sqrt(Math.max(0, rg2 / n - rgM * rgM)), sYB = Math.sqrt(Math.max(0, yb2 / n - ybM * ybM));
  const colorfulness = Math.sqrt(sRG ** 2 + sYB ** 2) + 0.3 * Math.sqrt(rgM ** 2 + ybM ** 2);
  const contrastStd = Math.sqrt(Math.max(0, l2 / n - (l / n) ** 2));
  // Обе части примерно в 0…1: colorfulness 100 — очень яркий кадр, std яркости 70 — сильный контраст.
  const appeal = Math.min(1.2, colorfulness / 100) + Math.min(1, contrastStd / 70);
  return { gray, rgb: [r / n, g / n, b / n], appeal };
};

const ncc = (p: Float32Array, q: Float32Array): number => {
  const n = p.length;
  let mp = 0, mq = 0;
  for (let i = 0; i < n; i++) { mp += p[i]; mq += q[i]; }
  mp /= n; mq /= n;
  let num = 0, dp = 0, dq = 0;
  for (let i = 0; i < n; i++) { const a = p[i] - mp, b = q[i] - mq; num += a * b; dp += a * a; dq += b * b; }
  return dp > 1e-6 && dq > 1e-6 ? num / Math.sqrt(dp * dq) : 1;
};
export const hflip = (g: Float32Array, w: number, h: number): Float32Array => {
  const o = new Float32Array(g.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o[y * w + x] = g[y * w + (w - 1 - x)];
  return o;
};
// Зеркальный разворот героя: зеркальный кроп похож заметно сильнее прямого.
export const isMirror = (direct: number, flipped: number, hero: boolean) => hero ? flipped >= 0.55 && flipped - direct >= 0.2 : flipped >= 0.7 && flipped - direct > 0.15;
// Скачок: probe склейки не видит (пиксельно кадр почти тот же), а план не сменился — герой той же
// крупности (площадь ×0.67–1.5) просто сдвинут; без героя — кадры почти одинаковые по структуре.
export const isJump = (sim: number, detected: boolean, heroRatio?: number) => !detected && sim < 0.97 && (heroRatio !== undefined ? heroRatio >= 0.67 && heroRatio <= 1.5 && sim >= 0.35 : sim >= 0.75);
const CW = 24, CH = 24;
const cropGray = async (png: string, b: Box4, k: number): Promise<Float32Array | null> => {
  const meta = await sharp(png).metadata();
  const iw = meta.width ?? 0, ih = meta.height ?? 0;
  const left = Math.max(0, Math.floor(b.x * k)), top = Math.max(0, Math.floor(b.y * k));
  const width = Math.min(iw - left, Math.ceil(b.w * k)), height = Math.min(ih - top, Math.ceil(b.h * k));
  if (width < 6 || height < 6) return null;
  const { data } = await sharp(png).removeAlpha().extract({ left, top, width, height }).resize(CW, CH, { fit: "fill" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  return Float32Array.from(data);
};

const similarity = (p: Thumb, q: Thumb): number => {
  const n = p.gray.length;
  let mp = 0, mq = 0;
  for (let i = 0; i < n; i++) { mp += p.gray[i]; mq += q.gray[i]; }
  mp /= n; mq /= n;
  let num = 0, dp = 0, dq = 0;
  for (let i = 0; i < n; i++) { const a = p.gray[i] - mp, b = q.gray[i] - mq; num += a * b; dp += a * a; dq += b * b; }
  const ncc = dp > 1e-6 && dq > 1e-6 ? num / Math.sqrt(dp * dq) : 1;
  // Только структура: смена света/цвета на том же плане — всё тот же план (диорама днём и ночью).
  return Math.max(0, ncc);
};

export const extractFrames = (video: string, frames: number[]): { dir: string; files: Map<number, string> } => {
  const dir = mkdtempSync(join(tmpdir(), "shots-"));
  const uniq = [...new Set(frames)].sort((p, q) => p - q);
  const sel = uniq.map((f) => `eq(n\\,${f})`).join("+");
  spawnSync("ffmpeg", ["-v", "error", "-i", video, "-vf", `select='${sel}',scale=180:-2`, "-fps_mode", "passthrough", join(dir, "f%04d.png")]);
  const got = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
  const files = new Map<number, string>();
  uniq.forEach((f, i) => { if (got[i]) files.set(f, join(dir, got[i])); });
  return { dir, files };
};

export const analyzeShots = async (video: string, segs: Segment[], fps: number, diffs: number[] | null, co: CutOpts = {}): Promise<{ issues: ShotIssue[]; m: ShotMetrics }> => {
  const issues: ShotIssue[] = [];
  const m: ShotMetrics = { segments: segs.length, unique: segs.length, similar: [], repeatShare: 0, appeal: [], open: { rank: 1, of: 1, score: 0, best: null }, energy: [], climax: null, bestFrames: [], cutsChecked: [] };
  if (!existsSync(video) || !segs.length) return { issues, m };
  const mids = segs.map((s) => Math.round((s.from + s.to - 1) / 2));
  const planned = (co.planned ?? []).filter((c) => c > 0);
  const { dir, files } = extractFrames(video, [0, ...mids, ...planned.flatMap((c) => [c - 1, c])]);
  try {
    const th = new Map<number, Thumb>();
    for (const [f, file] of files) th.set(f, await thumbOf(file));
    // ---- новизна: жадная кластеризация средних кадров ----
    // Порог подобран по раунду 2: одинаковый стакан с другой подписью ≈ 0.74–0.76, тот же
    // остров при другом свете ≈ 0.82–0.92, разные планы ≤ 0.3.
    const SIM = 0.72;
    const total = segs.reduce((s, b) => s + (b.to - b.from), 0) || 1;
    const rep: number[] = [];
    const inCluster = new Set<number>();
    segs.forEach((s, i) => {
      const t = th.get(mids[i]);
      if (!t) return;
      let dup = -1, best = 0;
      for (const j of rep) { const v = similarity(t, th.get(mids[j])!); if (v > best) { best = v; dup = j; } }
      if (dup >= 0 && best >= SIM) { m.similar.push({ a: segs[dup].id, b: s.id, sim: +best.toFixed(2) }); inCluster.add(i); inCluster.add(dup); }
      else rep.push(i);
    });
    // Доля ролика на почти одинаковых планах (вместе с первым показом).
    const repeatFrames = [...inCluster].reduce((n, i) => n + segs[i].to - segs[i].from, 0);
    m.unique = rep.length;
    m.repeatShare = +(repeatFrames / total).toFixed(2);
    if (segs.length >= 3 && m.repeatShare > 0.33) {
      const pairs = m.similar.slice(0, 4).map((x) => `${x.a}≈${x.b} (${x.sim})`).join(", ");
      issues.push({ level: "WARN", source: "feed", kind: "same-shot", frames: [0, segs[segs.length - 1].to - 1], msg: `уникальных планов ${m.unique} из ${segs.length}: ${Math.round(m.repeatShare * 100)} % ролика — почти один и тот же кадр (${pairs}). Сквозной образ остаётся, но меняет крупность или угол (деталь, сверху, в руке, общий); --ref держит предмет, а не кадр. Тот же мир нарочно (герой играет на том же фоне) — одна фраза в notes.md` });
    }
    // ---- привлекательность: кадр 0 против лучших кадров ролика ----
    m.appeal = segs.map((s, i) => ({ id: s.id, f: mids[i], score: +(th.get(mids[i])?.appeal ?? 0).toFixed(2) }));
    const open = th.get(0);
    if (open) {
      const sorted = [...m.appeal].sort((p, q) => q.score - p.score);
      const rank = 1 + sorted.filter((x) => x.score > open.appeal + 0.02).length;
      m.open = { rank, of: sorted.length + 1, score: +open.appeal.toFixed(2), best: sorted[0] ?? null };
      m.bestFrames = sorted.slice(0, 3).map((x) => x.f);
      if (sorted.length >= 3 && sorted[0] && open.appeal < 0.75 * sorted[0].score && rank > Math.ceil((sorted.length + 1) * 0.66)) {
        issues.push({ level: "WARN", source: "feed", kind: "dull-open", frames: [0, 0], msg: `кадр 0 (превью в ленте) — среди самых блёклых: место ${rank} из ${sorted.length + 1} по цвету и контрасту (${open.appeal.toFixed(2)} против ${sorted[0].score} у ${sorted[0].id}, кадр ${sorted[0].f}). Откройтесь своим лучшим изображением (или сделайте кадр 0 ярче) и верните к нему петлёй — новая сцена не нужна` });
      }
    }
    // ---- энергия входа в бит; кульминация — плотнее медианы ----
    if (diffs?.length) {
      const e = segs.map((s) => {
        let sum = 0, n = 0;
        for (let f = s.from + 1; f < Math.min(s.to, s.from + 11); f++) { if (diffs[f] === undefined) continue; sum += Math.min(diffs[f], 0.08); n++; }
        // склейка на входе — сама по себе событие
        const cut = (diffs[s.from] ?? 0) > 0.07 ? 0.02 : 0;
        return n ? sum / n + cut / 10 : 0;
      });
      const sorted = [...e].sort((p, q) => p - q);
      const med = sorted[Math.floor(sorted.length / 2)] || 1e-6;
      m.energy = segs.map((s, i) => ({ id: s.id, ratio: +(e[i] / med).toFixed(2) }));
      // Меряется бит kind payoff (развязка), а не первый «похожий» (цена перед развязкой — не она).
      const pay = segs.findIndex((s) => /payoff|развяз/i.test(s.kind ?? ""));
      const ci = pay >= 0 ? pay : segs.findIndex((s) => /climax|punch|кульм/i.test(s.kind ?? ""));
      if (ci >= 0) {
        m.climax = { id: segs[ci].id, ratio: m.energy[ci].ratio };
        // Кульминация «как все» (×1–1.2) — тот же дефект, что тише: главный момент не выделен.
        if (segs.length >= 3 && m.energy[ci].ratio < CLIMAX_MIN) issues.push({ level: "WARN", source: "feed", kind: "flat-climax", frames: [segs[ci].from, Math.min(segs[ci].to - 1, segs[ci].from + 10)], msg: `кульминация ${segs[ci].id} входит ${m.energy[ci].ratio < 0.9 ? "тише остальных битов" : "с той же силой, что остальные биты"} (энергия первых 10 кадров ×${m.energy[ci].ratio} от медианы, ориентир ≥ ×${CLIMAX_MIN}): удар без прыжка — смена крупности на число, вспышка/засветка 2–3 кадра (data-accent), наезд-ступенька, шаг цифры, маска-шторка, пауза перед ударом (kinetic-typography: «удар без прыжка»)` });
      }
    }
    // ---- грамматика склеек: скачок и зеркальный разворот героя ----
    const jumps: number[] = [], mirrors: number[] = [];
    const k = co.W ? 180 / co.W : 0;
    for (const c of planned) {
      const fa = files.get(c - 1), fb = files.get(c);
      if (!fa || !fb) continue;
      const A = th.get(c - 1) ?? await thumbOf(fa), B = th.get(c) ?? await thumbOf(fb);
      th.set(c - 1, A); th.set(c, B);
      const sim = Math.max(0, ncc(A.gray, B.gray));
      let flip = Math.max(0, ncc(A.gray, hflip(B.gray, GW, GH))), direct = sim, hero = false;
      const ha = co.heroAt?.(c - 1), hb = co.heroAt?.(c);
      if (ha && hb && k) {
        const ga = await cropGray(fa, ha, k), gb = await cropGray(fb, hb, k);
        if (ga && gb) { hero = true; direct = ncc(ga, gb); flip = ncc(ga, hflip(gb, CW, CH)); }
      }
      m.cutsChecked.push({ f: c, sim: +sim.toFixed(2), flip: +flip.toFixed(2), hero });
      const detected = !co.detected || co.detected.some((d) => Math.abs(d - c) <= 1);
      const ratio = ha && hb ? (hb.w * hb.h) / Math.max(1, ha.w * ha.h) : undefined;
      if (isJump(sim, detected, ratio)) jumps.push(c);
      if (isMirror(direct, flip, hero)) mirrors.push(c);
    }
    if (jumps.length) issues.push({ level: "WARN", source: "feed", kind: "jump-cut", frames: [jumps[0], jumps[0]], msg: `склейки по плану без видимой смены (кадры ${jumps.slice(0, 6).join(", ")}): по обе стороны почти тот же кадр, предмет лишь сдвинут — это скачок, а не новый план. Смени крупность (≥ ×1.5) или угол, либо убери склейку и веди одно непрерывное движение камеры (граница бита без склейки — "cut": "none" в beats.json)` });
    if (mirrors.length) issues.push({ level: "WARN", source: "feed", kind: "mirror-cut", frames: [mirrors[0], mirrors[0]], msg: `герой развернулся на склейке (кадры ${mirrors.slice(0, 6).join(", ")}): смотрел в одну сторону — в следующем кадре в другую. Направление взгляда и движения держится через склейку; разворот — действие внутри бита (camera-choreography: «направление»)` });
  } finally { rmSync(dir, { recursive: true, force: true }); }
  return { issues, m };
};

// Сколько секунд в конце ролика стоит один и тот же мир (шаг 0.5 с): меняется только текст или
// камера медленно едет — это не событие (раунд 5: гараж 11.6 с из 31 с).
export const endHoldSec = async (video: string, frames: number, fps: number): Promise<number | null> => {
  if (!existsSync(video) || frames < fps * 2) return null;
  const step = Math.max(1, Math.round(fps / 2)), last = frames - 1;
  const fl: number[] = [];
  for (let f = last; f >= Math.max(0, last - fps * 20); f -= step) fl.push(f);
  const { dir, files } = extractFrames(video, fl);
  try {
    const lastT = files.get(last);
    if (!lastT) return null;
    // Один и тот же мир: соседние пробы (0.5 с) почти одинаковы (≥ 0.9 — медленный наезд не
    // событие) и кадр не ушёл далеко от последнего (≥ 0.6 — дрейф камеры, а не новый план).
    const ref = await thumbOf(lastT);
    let prev = ref, held = 0;
    for (const f of fl.slice(1)) {
      const file = files.get(f);
      if (!file) break;
      const cur = await thumbOf(file);
      if (similarity(prev, cur) < 0.9 || similarity(ref, cur) < 0.6) break;
      held = last - f;
      prev = cur;
    }
    return +(held / fps).toFixed(1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
};
