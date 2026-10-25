// Проверка звука глазами: модель не слышит, поэтому звук рисуется.
//   npx tsx .claude/skills/sound-design/mixcheck.ts out/final.mp4|out/x.wav [--events sfx.json] [--out out/mix.png]
// Пишет PNG: форма волны + кривая громкости (LUFS, окно 400 мс), серые полосы — где звучит
// речь (public/words.json), подписи слов, красные метки — запланированные звуки событий
// (sfx.json: [{atSec | at, id, volume?, why?}] — тот же файл, что читает <SfxTrack>; atSec —
// секунды, at — целый кадр; дробный at = секунды в поле кадров → БРАК, код выхода 1).
// Печатает: громкость и пик, уровень между репликами (подложка/тишина), попадание каждого
// звука события в кадр (по всплеску энергии рядом с меткой), ВНИМАНИЕ на дыры в звуке
// (громкость момента ниже средней на 18+ дБ дольше 0.8 с — в том числе затухание в конце)
// и на неслышные звуки событий (их место — паузы речи, или громче).
// Музыка между фразами: разница «речь − паузы» печатается числом; цель 6–10 дБ (музыка/
// атмосфера слышна на телефоне, голос главный). Больше 12 дБ — музыки почти не слышно.
// Попадание событий ищется в трёх полосах (низ < 300 Гц, всё, верх > 2.5 кГц): басовые
// удары (штамп, капля) тоже засчитываются. Провал подложки перед акцентом > 6 дБ — «дыра».
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { die, jobDir, parseArgs, readJob, str } from "../../bin/_lib";

const a = parseArgs(process.argv.slice(2));
const dir = jobDir(a);
const file = resolve(dir, a._[0] ?? "out/final.mp4");
if (!existsSync(file)) die(`нет ${file}`);
const job = readJob(dir);
const fps = job.fps;
const evFile = resolve(dir, str(a, "events", "sfx.json")!);
type RawEv = { at?: number; atSec?: number; id: string; why?: string };
const rawEvents: RawEv[] = existsSync(evFile) ? (() => { const j = JSON.parse(readFileSync(evFile, "utf8")); return Array.isArray(j) ? j : j.events ?? []; })() : [];
const unitErrors = rawEvents.filter((e) => typeof e.atSec !== "number" && typeof e.at === "number" && !Number.isInteger(e.at));
const events: Array<{ at: number; id: string; why?: string }> = rawEvents
  .map((e) => ({ id: e.id, why: e.why, at: typeof e.atSec === "number" ? Math.round(e.atSec * fps) : typeof e.at === "number" ? Math.round(e.at) : NaN }))
  .filter((e) => Number.isFinite(e.at));
let fails = 0;
const wf = resolve(dir, "public", "words.json");
const words: Array<{ text: string; start: number; end: number }> = existsSync(wf) ? JSON.parse(readFileSync(wf, "utf8")).words : [];

const SR = 16000;
const pcm = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", String(SR), "-f", "s16le", "-"], { maxBuffer: 1 << 30 }).stdout as Buffer;
if (!pcm?.length) die("в файле нет звука");
const N = pcm.length / 2;
const dur = N / SR;
const sample = (i: number) => pcm.readInt16LE(i * 2) / 32768;

// Громкость по окнам 10 мс (RMS, дБFS) и сглаженная 400 мс (≈ momentary).
const win = Math.round(SR * 0.01);
const rms: number[] = [];
for (let s = 0; s + win <= N; s += win) { let e = 0; for (let i = s; i < s + win; i++) e += sample(i) ** 2; rms.push(Math.sqrt(e / win)); }
const db = (x: number) => 20 * Math.log10(Math.max(1e-6, x));
const mom = rms.map((_, i) => { const lo = Math.max(0, i - 20), hi = Math.min(rms.length, i + 20); let e = 0; for (let k = lo; k < hi; k++) e += rms[k] ** 2; return db(Math.sqrt(e / (hi - lo))); });

// Итог по EBU R128.
const eb = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"]).stderr.toString();
const I = Number(eb.match(/I:\s+(-?[\d.]+) LUFS/g)?.pop()?.match(/-?[\d.]+/)?.[0]);
const TP = Number(eb.match(/Peak:\s+(-?[\d.]+)/g)?.pop()?.match(/-?[\d.]+/)?.[0]);

// Речь / не речь.
const spans: Array<[number, number]> = [];
for (const w of words) { const l = spans[spans.length - 1]; if (l && w.start - l[1] <= 0.45) l[1] = Math.max(l[1], w.end); else spans.push([w.start, w.end]); }
const inSpeech = (t: number) => spans.some(([s, e]) => t >= s && t <= e);
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const speechDb = avg(mom.filter((_, i) => inSpeech(i * 0.01)));
const gapDb = avg(mom.filter((_, i) => { const t = i * 0.01; return !inSpeech(t) && spans.some(([s]) => s > t) && spans.some(([, e]) => e < t); }));

// Попадание звуков событий: всплеск энергии в окне [−2; +3] кадра от метки. Ищем по
// верхним частотам (> 2.5 кГц): щелчки, монеты, бумага там заметнее голоса.
const band = (af: string | null): number[] => {
  const buf = af ? spawnSync("ffmpeg", ["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", String(SR), "-af", af, "-f", "s16le", "-"], { maxBuffer: 1 << 30 }).stdout as Buffer : pcm;
  const out: number[] = [];
  for (let s = 0; s + win <= buf.length / 2; s += win) { let e = 0; for (let i = s; i < s + win; i++) e += (buf.readInt16LE(i * 2) / 32768) ** 2; out.push(Math.sqrt(e / win)); }
  return out;
};
const bands = [band("highpass=f=2500,highpass=f=2500"), band(null), band("lowpass=f=300,lowpass=f=300")];
const onsetNear = (frame: number) => {
  const t0 = frame / fps;
  let best: { dt: number; jump: number; band: string } | null = null;
  bands.forEach((hrms, bi) => {
    for (let i = Math.max(5, Math.floor((t0 - 2 / fps) * 100)); i <= Math.min(hrms.length - 1, Math.ceil((t0 + 3 / fps) * 100)); i++) {
      const before = avg(hrms.slice(i - 5, i));
      const jump = hrms[i] / Math.max(1e-5, before);
      const need = bi === 0 ? 1.8 : 1.6;
      if (jump > need && db(hrms[i]) > -55 && (!best || jump > best.jump)) best = { dt: i * 0.01 - t0, jump, band: ["верх", "всё", "низ"][bi] };
    }
  });
  return best as { dt: number; jump: number; band: string } | null;
};

const main = async () => {
  const Wpx = 1800, Hw = 220, Hl = 140, top = 30, labelH = 70;
  const Htot = top + Hw + Hl + labelH;
  const wave = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-filter_complex", `aformat=channel_layouts=mono,showwavespic=s=${Wpx}x${Hw}:colors=#4a5a78`, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"], { maxBuffer: 1 << 28 }).stdout as Buffer;
  const x = (t: number) => (t / dur) * Wpx;
  const svg: string[] = [];
  for (const [s, e] of spans) svg.push(`<rect x="${x(s)}" y="${top}" width="${x(e) - x(s)}" height="${Hw + Hl}" fill="#000" fill-opacity="0.06"/>`);
  // Кривая громкости: от −60 до 0 дБ.
  const yL = (d: number) => top + Hw + Hl - ((Math.max(-60, Math.min(0, d)) + 60) / 60) * Hl;
  const pts = mom.filter((_, i) => i % 2 === 0).map((d, k) => `${x(k * 0.02).toFixed(1)},${yL(d).toFixed(1)}`).join(" ");
  svg.push(`<polyline points="${pts}" fill="none" stroke="#c9542f" stroke-width="2"/>`);
  for (const d of [-14, -30]) svg.push(`<line x1="0" x2="${Wpx}" y1="${yL(d)}" y2="${yL(d)}" stroke="#999" stroke-dasharray="4 4"/><text x="4" y="${yL(d) - 4}" font-family="Menlo" font-size="14" fill="#777">${d} дБ</text>`);
  words.forEach((w, i) => {
    svg.push(`<line x1="${x(w.start)}" x2="${x(w.start)}" y1="${top + Hw + Hl}" y2="${top + Hw + Hl + 10}" stroke="#555"/>`);
    svg.push(`<text x="${x(w.start) + 2}" y="${top + Hw + Hl + 26 + (i % 2) * 18}" font-family="Helvetica" font-size="15" fill="#333">${w.text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`);
  });
  const sync: string[] = [];
  for (const e of events) {
    const t = e.at / fps, o = onsetNear(e.at);
    svg.push(`<line x1="${x(t)}" x2="${x(t)}" y1="${top - 6}" y2="${top + Hw + Hl}" stroke="${o ? "#d62828" : "#ff00aa"}" stroke-width="2"/>`);
    svg.push(`<text x="${x(t) + 3}" y="${top - 10}" font-family="Menlo" font-size="14" fill="#d62828">${e.id}</text>`);
    sync.push(`  ${e.id} @${e.at} (${t.toFixed(2)} с): ${o ? `всплеск ${o.dt >= 0 ? "+" : ""}${Math.round(o.dt * 1000)} мс (${(o.dt * fps).toFixed(1)} кадра, полоса «${o.band}»)` : "НЕТ всплеска рядом — звук не слышен или не на месте"}${e.why ? ` — ${e.why}` : ""}`);
  }
  for (let s = 0; s <= dur; s += 1) svg.push(`<text x="${x(s) + 2}" y="18" font-family="Menlo" font-size="13" fill="#888">${s}s</text>`);
  const overlay = `<svg width="${Wpx}" height="${Htot}" xmlns="http://www.w3.org/2000/svg">${svg.join("")}</svg>`;
  const out = resolve(dir, str(a, "out", file.replace(/\.[^.]+$/, ".mix.png"))!);
  await sharp({ create: { width: Wpx, height: Htot, channels: 3, background: "#f7f4ee" } })
    .composite([{ input: wave, left: 0, top }, { input: Buffer.from(overlay), left: 0, top: 0 }]).png().toFile(out);
  console.log(`громкость ${I} LUFS (цель −14 ±1), пик ${TP} дБFS (≤ −1.5)`);
  if (Number.isFinite(speechDb)) console.log(`речь ≈ ${speechDb.toFixed(1)} дБ, между репликами ≈ ${Number.isFinite(gapDb) ? gapDb.toFixed(1) : "—"} дБ${Number.isFinite(gapDb) ? ` (разница ${(speechDb - gapDb).toFixed(1)} дБ; цель 6–10: музыка слышна на телефоне, голос главный)` : ""}`);
  const lastEnd = spans.length ? spans[spans.length - 1][1] : NaN;
  const tailDb = Number.isFinite(lastEnd) && dur - lastEnd > 0.6 ? avg(mom.filter((_, i) => i * 0.01 > lastEnd + 0.15)) : NaN;
  if (Number.isFinite(lastEnd) && dur - lastEnd < 1.0) console.log(`ВНИМАНИЕ: после последнего слова только ${(dur - lastEnd).toFixed(1)} с — финал обрывается; держите кадр и музыку ≥ 1 с (tailSec в job.json)`);
  if (Number.isFinite(tailDb) && Number.isFinite(speechDb)) console.log(`хвост после речи (${(dur - lastEnd).toFixed(1)} с) ≈ ${tailDb.toFixed(1)} дБ (на ${(speechDb - tailDb).toFixed(1)} дБ ниже речи; в хвосте музыке можно почти до уровня речи — до ~4 дБ ниже)${speechDb - tailDb > 12 ? " — ВНИМАНИЕ: финал звучит пусто, музыку в хвосте громче" : ""}`);
  if (unitErrors.length) { fails++; console.log(`БРАК: дробное at у ${unitErrors.map((e) => `${e.id} (${e.at})`).join(", ")} — at это номер кадра, а не секунды; звуки ушли в первые кадры. Секунды — поле atSec.`); }
  if (events.length >= 3 && dur > 6 && events.every((e) => e.at < fps)) { fails++; console.log(`БРАК: все ${events.length} звуков событий в первую секунду — время в секундах в поле at? Сверь таблицу ниже с планом (слово/склейка каждого звука).`); }
  if (Number.isFinite(speechDb) && Number.isFinite(gapDb)) {
    const d = speechDb - gapDb;
    if (d > 12 && gapDb > -45) { fails++; console.log(`БРАК: музыка/подложка между фразами на ${d.toFixed(0)} дБ ниже речи — на динамике телефона её не слышно («голос поверх тихого гула»). Поднимите base (в паузах) и under (под речью ≈ 0.3–0.35 для соцсетей), ступенька приглушения ≤ 6 дБ; цель 6–10 дБ.`); }
    else if (d < 4) console.log(`ВНИМАНИЕ: подложка между фразами почти как речь (разница ${d.toFixed(1)} дБ) — проверьте разборчивость, под речью приглушите сильнее.`);
  }
  if (events.length) console.log(`звуки событий (${events.length}):\n${sync.join("\n")}`);
  const missed = events.filter((e) => !onsetNear(e.at));
  if (missed.length) {
    const inSp = missed.filter((e) => inSpeech(e.at / fps)).length;
    console.log(`ВНИМАНИЕ: ${missed.length} из ${events.length} звуков событий не слышны${inSp ? ` (${inSp} — под речью)` : ""} — переставьте в паузы речи, сделайте громче или уберите; неслышный звук — лишний.`);
  }
  // Провал подложки перед акцентом: приглушение под звук события глубже 6 дБ — слышна «дыра».
  const dips: string[] = [];
  for (const e of events) {
    const t = e.at / fps, i1 = Math.round(t * 100), i0 = Math.max(0, i1 - 80), ib = Math.max(0, i0 - 120);
    if (ib >= i0 || inSpeech(t) || inSpeech(t - 0.4)) continue;
    const pre = [...mom.slice(ib, i0)].sort((p, q) => p - q);
    const ref0 = pre[Math.floor(pre.length / 2)];
    const low = Math.min(...mom.slice(i0, i1));
    if (Number.isFinite(ref0) && ref0 > -45 && ref0 - low > 6) dips.push(`${e.id} @${e.at} (−${(ref0 - low).toFixed(0)} дБ)`);
  }
  if (dips.length) console.log(`ВНИМАНИЕ: подложка проваливается перед акцентами: ${dips.join(", ")} — слышна дыра; приглушайте ≤ 6 дБ или ставьте акцент без приглушения (он и так громче в паузе).`);
  // Дыры: окна по 100 мс, громкость ниже средней речи/звука на 18+ дБ дольше 0.8 с.
  const ref = Number.isFinite(speechDb) ? speechDb : avg(mom.filter((d) => d > -60));
  const startI = mom.findIndex((d) => d > ref - 10);
  const holes: Array<[number, number]> = [];
  let hs = -1;
  for (let i = Math.max(0, startI); ; i += 10) {
    const end = i >= mom.length;
    const low = !end && mom[i] < ref - 18;
    if (low && hs < 0) hs = i;
    if (!low && hs >= 0) { const e = Math.min(i, mom.length); if ((e - hs) * 0.01 >= 0.8) holes.push([hs * 0.01, e * 0.01]); hs = -1; }
    if (end) break;
  }
  for (const [p0, q0] of holes) console.log(`ВНИМАНИЕ: ${q0 >= dur - 0.15 ? "звук затухает в пустоту в конце" : "дыра в звуке"} ${p0.toFixed(1)}–${q0.toFixed(1)} с — ${q0 >= dur - 0.15 ? "держите подложку/акцент до последнего кадра (или петлю к началу)" : "подложка или атмосфера места, звук события в паузе"}`);
  if (!holes.length && Number.isFinite(gapDb) && gapDb < -45) console.log("ВНИМАНИЕ: между репликами тишина (ниже −45 дБ) — в ленте это звучит пусто.");
  console.log(out);
  if (fails) { console.log(`mixcheck: БРАК ×${fails} — поправь звук (studio render --audio-only) и проверь снова`); process.exitCode = 1; }
};
main().catch((e) => { console.error("ошибка: " + (e?.stack ?? e)); process.exit(1); });
