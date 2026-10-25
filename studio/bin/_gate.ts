// Ворота финала: studio render пишет out/final.mp4, только если в ролике нет открытых
// ★ ленточных WARN (крючок, кульминация, форма, факт, финал) и сделана правка №1 критика.
// Иначе рендер уходит в out/candidate.mp4, а out/status.json — {status: "needs-stage-2"}:
// «финал», который везёт заведомо слабый крючок или кульминацию, студия не выпускает.
// Раунд 5: car остановился на круге 2 из 3 с тремя открытыми ★, pizza и roses отложили правку
// критика «на этап 2», которого не было, — и всё равно отрендерили final.
//
// Как закрыть ★ без нового круга review: один вариант (правка сцены → studio still --sheet или
// --vary с любым --out — отметка out/.last-still новее review.json) и строка в notes.md
//   «★ <вид>: пробовал <что> → <что увидел>, потому что …».
// Критик: в notes.md строка «Критик #1: сделано — …» (или «Критик #1: не сделано …» — тогда
// это открытое дело и статус needs-stage-2).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const RIBBON = /^(weak-hook|slow-open|dull-open|empty-open|hero-late|offer-late|flat-climax|slideshow|list-slideshow|stale-share|fact-unreadable|payoff-small|payoff-short|payoff-freeze|end-hold|hero-small-payoff)$/;
export const isRibbon = (kind: string) => RIBBON.test(kind.replace(/\?$/, ""));

// Отметка последнего studio still (пишет still.ts). Раньше вариант искали только в out/stills/,
// и кадры с --out в другую папку (Codex сравнивал варианты в out/stage2-variant/) не засчитывались.
export const STILL_STAMP = ".last-still";

export type GateResult = { ok: boolean; open: string[]; accepted: string[]; reviewed: boolean };

type ReviewJson = { issues?: Array<{ level: string; source?: string; kind: string; msg?: string }> };

// Чистая часть (для тестов): issues review + текст notes.md + есть ли вариант новее review.
export const gateFrom = (review: ReviewJson | null, notes: string, variantAfterReview: boolean): GateResult => {
  const open: string[] = [], accepted: string[] = [];
  if (!review) return { ok: false, open: ["нет out/review/review.json — сначала review.ts (самопроверка перед финалом)"], accepted, reviewed: false };
  const issues = review.issues ?? [];
  for (const i of issues) if (i.level === "FAIL" && i.source !== "lint") open.push(`FAIL ${i.kind} — правка и review.ts (новый круг ради FAIL разрешён)`);
  const kinds = [...new Set(issues.filter((i) => i.level === "WARN" && isRibbon(i.kind)).map((i) => i.kind))];
  for (const k of kinds) {
    const re = new RegExp(`★\\s*${k.replace(/[-?]/g, (c) => `\\${c}`)}[^\\n]*пробовал`, "i");
    if (re.test(notes) && variantAfterReview) accepted.push(k);
    else open.push(`★ ${k} — исправить (review.ts покажет, что ушло) или один вариант через studio still и строка «★ ${k}: пробовал … → …, потому что …» в notes.md`);
  }
  const critic = notes.match(/критик\s*#\s*1\s*:([^\n]*)/i);
  if (!/##\s*Критик/i.test(notes) && !critic) open.push("критик не выслушан (CLAUDE.md шаг 10) — в notes.md раздел «## Критик» и строка «Критик #1: сделано — …»");
  else if (!critic) open.push("правка №1 критика: в notes.md строка «Критик #1: сделано — что именно» (не сделана — это открытое дело)");
  else if (/не\s*сдела|отлож|этап\s*2|передач|частично/i.test(critic[1]) || !/сдела/i.test(critic[1])) open.push(`правка №1 критика не сделана («${critic[1].trim().slice(0, 80)}») — сделать до финала`);
  return { ok: open.length === 0, open, accepted, reviewed: true };
};

export const finalGate = (dir: string): GateResult => {
  const rf = join(dir, "out", "review", "review.json");
  let review: ReviewJson | null = null;
  try { review = existsSync(rf) ? JSON.parse(readFileSync(rf, "utf8")) : null; } catch { review = null; }
  const nf = join(dir, "notes.md");
  const notes = existsSync(nf) ? readFileSync(nf, "utf8") : "";
  let variant = false;
  const sd = join(dir, "out", "stills"), stamp = join(dir, "out", STILL_STAMP);
  if (review) {
    const t = statSync(rf).mtimeMs;
    variant = (existsSync(stamp) && statSync(stamp).mtimeMs > t)
      || (existsSync(sd) && readdirSync(sd).some((f) => /\.png$/.test(f) && statSync(join(sd, f)).mtimeMs > t));
  }
  return gateFrom(review, notes, variant);
};
