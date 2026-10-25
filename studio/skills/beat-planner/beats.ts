// Раскадровка от звука: биты по таймингам слов (public/words.json от `studio voice`).
//   npx tsx .claude/skills/beat-planner/beats.ts suggest [--pace story|explain|hook|mixed]
//        [--target 2.2] [--min 1.4] [--max 3.5] [--lead 1] [--keep "фраза,фраза"] [--out beats.draft.json]
//   npx tsx .claude/skills/beat-planner/beats.ts check [beats.json] [--min-frames 18]
//   npx tsx .claude/skills/beat-planner/beats.ts cuts [beats.json]      → «90,153,…» для probe/review
//   npx tsx .claude/skills/beat-planner/beats.ts words [--from 2.0 --to 5.5]  → слова с кадрами
// suggest — ЧЕРНОВИК: режет речь на биты на сильных границах (конец фразы, пауза, запятая,
// граница реплики) так, чтобы длины были около target. Никогда не пишет beats.json — директор
// правит черновик (смысл, ключевые слова, план, скилл, why) и сохраняет сам.
// check — проверка beats.json: склейки на границах слов, без дыр и наложений, длина = ролик,
// нет слишком коротких битов, не больше двух склеек в секунду.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { die, jobDir, num, parseArgs, readJob, str } from "../../bin/_lib";

type Word = { text: string; start: number; end: number; line: number };
type WordsFile = { total: number; lines: Array<{ id: string; say: string; start: number; end: number }>; words: Word[] };
export type Beat = {
  id: string; from: number; to: number;
  text?: string; keywords?: string[];
  kind?: string;          // hook | setup | point | detail | turn | punch | cta | … — свои слова директора
  shot?: string;          // wide | medium | close | macro | insert | title …
  skill?: string;         // какой скилл ведёт бит
  why?: string;           // одна фраза: почему так
  transition?: { type: string; frames?: number }; // как входим в бит: cut (по умолчанию), fade, …
  cut_word?: string;      // слово, на котором склейка (заполняет suggest)
};

const a = parseArgs(process.argv.slice(2));
const cmd = a._[0] ?? "suggest";
const dir = jobDir(a);
const job = readJob(dir);
const fps = job.fps;
const wfile = join(dir, "public", "words.json");
const words: WordsFile | null = existsSync(wfile) ? JSON.parse(readFileSync(wfile, "utf8")) : null;
const totalFrames = job.durationInFrames ?? (words ? Math.ceil((words.total + (job.tailSec ?? 0.5)) * fps) : die("нет durationInFrames и нет public/words.json"));

const PACE: Record<string, { target: number; min: number; max: number }> = {
  story: { target: 3.6, min: 2.4, max: 6 },
  explain: { target: 2.3, min: 1.4, max: 3.6 },
  hook: { target: 1.4, min: 0.7, max: 2.2 },
};

const f = (s: number) => Math.round(s * fps);

// Сила границы ПЕРЕД словом i: где склейка звучит естественно.
const boundary = (ws: Word[], i: number): number => {
  if (i === 0) return 0;
  const prev = ws[i - 1], w = ws[i];
  const gap = w.start - prev.end;
  let s = 0;
  if (/[.!?…]["»)]?$/.test(prev.text)) s += 3;
  else if (/[,;:—–]["»)]?$/.test(prev.text)) s += 1.2;
  if (prev.line !== w.line) s += 3;
  if (gap >= 0.25) s += 1.5 + Math.min(2, gap * 2);
  if (/^(и|а|но|или|в|на|с|к|у|о|по|за|из|до|от|не)$/i.test(prev.text.replace(/[^а-яёa-z]/gi, ""))) s -= 2; // не резать после предлога/союза
  return s > 0 ? s : -3; // посреди фразы — склейка рвёт мысль
};

// Ключевые фразы (--keep "в десять раз,прибыль выше"): внутри них не режем.
const norm = (x: string) => x.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]/g, "");
const insideKeep = (ws: Word[], i: number, keep: string[][]): boolean => keep.some((ph) => {
  for (let s0 = Math.max(0, i - ph.length + 1); s0 < i; s0++) {
    if (ph.every((p, k) => norm(ws[s0 + k]?.text ?? "") === p)) return true;
  }
  return false;
});

const suggest = () => {
  if (!words) die("нет public/words.json — сначала studio voice");
  const ws = words!.words;
  const pace = str(a, "pace", "mixed")!;
  const base = PACE[pace === "mixed" ? "explain" : pace] ?? PACE.explain;
  const target = num(a, "target", base.target)!, minS = num(a, "min", base.min)!, maxS = num(a, "max", base.max)!;
  const lead = num(a, "lead", 1)!;
  // Кандидаты склеек: начало каждого слова (с опережением lead кадров) + конец ролика.
  const keep = (str(a, "keep") ?? "").split(",").map((p) => p.split(/\s+/).map(norm).filter(Boolean)).filter((p) => p.length > 1);
  const cand = ws.map((w, i) => ({ i, t: i === 0 ? 0 : w.start, frame: i === 0 ? 0 : Math.max(1, f(w.start) - lead), score: boundary(ws, i) }))
    .filter((c) => !insideKeep(ws, c.i, keep));
  cand.push({ i: ws.length, t: totalFrames / fps, frame: totalFrames, score: 4 });
  // Динамика: лучшая нарезка [0 … конец] по сумме сил границ минус штраф за отклонение длины.
  const N = cand.length;
  const best = new Array(N).fill(-Infinity), prev = new Array(N).fill(-1);
  best[0] = 0;
  for (let j = 1; j < N; j++) {
    for (let i = 0; i < j; i++) {
      if (best[i] === -Infinity) continue;
      const len = (cand[j].frame - cand[i].frame) / fps;
      const isHook = pace === "mixed" && cand[i].t < 4;
      const tg = isHook ? PACE.hook.target : target, mn = isHook ? PACE.hook.min : minS, mx = isHook ? PACE.hook.max * 1.6 : maxS;
      if (len < mn * 0.85 || len > mx * 1.15) continue;
      const pen = Math.abs(Math.log(len / tg)) * 3 + (len < mn ? 2 : 0) + (len > mx ? 2 : 0);
      const v = best[i] + cand[j].score - pen;
      if (v > best[j]) { best[j] = v; prev[j] = i; }
    }
  }
  if (best[N - 1] === -Infinity) die("не вышло нарезать с такими --min/--max — расширьте диапазон");
  const idx: number[] = [];
  for (let j = N - 1; j >= 0; j = prev[j]) { idx.unshift(j); if (j === 0) break; }
  const beats: Beat[] = [];
  for (let k = 0; k < idx.length - 1; k++) {
    const c0 = cand[idx[k]], c1 = cand[idx[k + 1]];
    const inBeat = ws.filter((w, wi) => wi >= c0.i && wi < c1.i);
    beats.push({ id: `b${String(k + 1).padStart(2, "0")}`, from: c0.frame, to: c1.frame, text: inBeat.map((w) => w.text).join(" "), cut_word: ws[c0.i]?.text, kind: "", shot: "", skill: "", why: "", keywords: [] });
  }
  const out = resolve(dir, str(a, "out", "beats.draft.json")!);
  writeFileSync(out, JSON.stringify({ fps, totalFrames, pace, beats }, null, 2) + "\n");
  printTable(beats);
  console.log(`\nчерновик: ${out} — поправьте смысл/план/why и сохраните как beats.json`);
};

const load = (p?: string): Beat[] => {
  const file = resolve(dir, p ?? "beats.json");
  if (!existsSync(file)) die(`нет ${file}`);
  const j = JSON.parse(readFileSync(file, "utf8"));
  return (Array.isArray(j) ? j : j.beats) as Beat[];
};

const printTable = (beats: Beat[]) => {
  for (const b of beats) {
    const sec = ((b.to - b.from) / fps).toFixed(2);
    console.log(`${b.id.padEnd(5)} ${String(b.from).padStart(5)}–${String(b.to).padEnd(5)} ${sec.padStart(5)} с  ${(b.kind || "").padEnd(7)} ${(b.shot || "").padEnd(7)} «${(b.text ?? "").slice(0, 60)}»${b.why ? `  — ${b.why}` : ""}`);
  }
};

const check = () => {
  const beats = load(a._[1]);
  const minF = num(a, "min-frames", 18)!;
  const issues: Array<{ level: "FAIL" | "WARN"; msg: string }> = [];
  if (!beats.length) die("в beats.json нет битов");
  if (beats[0].from !== 0) issues.push({ level: "FAIL", msg: `первый бит начинается с ${beats[0].from}, а не с 0` });
  const ids = new Set<string>();
  beats.forEach((b, k) => {
    if (ids.has(b.id)) issues.push({ level: "FAIL", msg: `${b.id}: id повторяется` });
    ids.add(b.id);
    if (!(b.to > b.from)) issues.push({ level: "FAIL", msg: `${b.id}: to ≤ from` });
    if (k > 0 && b.from !== beats[k - 1].to) issues.push({ level: "FAIL", msg: `${beats[k - 1].id}→${b.id}: ${b.from > beats[k - 1].to ? "дыра" : "наложение"} ${beats[k - 1].to}…${b.from}` });
    const len = b.to - b.from;
    if (len < minF && !/hook|крюч|punch|удар/i.test(b.kind ?? "")) issues.push({ level: "WARN", msg: `${b.id}: ${len} кадров (< ${minF}) — короткий бит читается как мелькание; для намеренного удара kind: "punch"` });
    if (k > 0 && words) {
      // Склейка — на границе слова: в пределах 2 кадров от начала слова или в паузе между словами.
      const ok = words.words.some((w, wi) => Math.abs(f(w.start) - b.from) <= 2 || (wi > 0 && b.from >= f(words.words[wi - 1].end) - 1 && b.from <= f(w.start) + 1)) || b.from >= f(words.total);
      if (!ok) issues.push({ level: "WARN", msg: `${b.id}: склейка на кадре ${b.from} посреди слова — сдвиньте к началу слова (beats.ts words)` });
    }
    if (!b.why) issues.push({ level: "WARN", msg: `${b.id}: нет why — одна фраза, зачем этот бит и почему такой план` });
  });
  const last = beats[beats.length - 1];
  if (Math.abs(last.to - totalFrames) > 1) issues.push({ level: "FAIL", msg: `последний бит кончается на ${last.to}, ролик — ${totalFrames} кадров` });
  const cuts = beats.slice(1).map((b) => b.from);
  for (const c of cuts) {
    const inSec = cuts.filter((x) => x >= c && x < c + fps).length;
    if (inSec > 2) { issues.push({ level: "WARN", msg: `${inSec} склейки за секунду с кадра ${c} — мельтешит (probe это провалит)` }); break; }
  }
  printTable(beats);
  console.log("");
  for (const i of issues) console.log(`${i.level}: ${i.msg}`);
  console.log(issues.length ? `${issues.filter((i) => i.level === "FAIL").length} FAIL, ${issues.filter((i) => i.level === "WARN").length} WARN` : "beats.json: проверка пройдена");
  console.log(`склейки для probe/review: --cuts ${cuts.join(",")}`);
  process.exit(issues.some((i) => i.level === "FAIL") ? 1 : 0);
};

const listWords = () => {
  if (!words) die("нет public/words.json");
  const from = num(a, "from", 0)!, to = num(a, "to", 1e9)!;
  for (const w of words!.words.filter((x) => x.start >= from && x.start <= to)) console.log(`${String(f(w.start)).padStart(5)}–${String(f(w.end)).padEnd(5)} ${w.start.toFixed(2)}–${w.end.toFixed(2)} с  [${w.line}] ${w.text}`);
};

if (cmd === "suggest") suggest();
else if (cmd === "check") check();
else if (cmd === "cuts") console.log(load(a._[1]).slice(1).map((b) => b.from).join(","));
else if (cmd === "words") listWords();
else die(`неизвестная команда ${cmd}: suggest | check | cuts | words`);
