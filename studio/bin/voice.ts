// Озвучка: реплики → public/voice.wav + public/words.json (тайминги слов).
//   studio voice lines.json [--voice <голос>] [--style "указания диктору"] [--pace 1.0] [--gap 0.25]
//                [--head 0.3] [--lang ru] [--out voice.wav] [--keep-duration] [--job dir] [--estimate]
// Провайдер — VOICE_PROVIDER в .env (openai | elevenlabs | command | none; см. .env.example и
// `studio doctor`). none — озвучки нет: ролик без голоса (музыка + текст на экране).
// --estimate — без озвучки (бесплатно, работает и при none): оценка длины по тексту (≈ 11.3 знака/с —
// средний темп диктора; цифры читаются втрое длиннее записи) — чтобы первая озвучка попала в
// нужную длину ±10 %, а не переписывать сценарий после платного прогона.
// lines.json — один из видов:
//   ["Первая реплика.", "Вторая."]
//   {"voice":"…","style":"…","pace":1.1,"gap":0.3,"lines":["…", {"id":"hook","say":"…","pace":1.2,"after":0.6,"style":"…","voice":"…"}]}
// Голос: --voice, иначе "voice" из lines.json, иначе голос из .env (OPENAI_TTS_VOICE,
// ELEVENLABS_VOICE_ID — в том числе свой клон, VOICE_COMMAND_VOICE). --style понимают не все
// провайдеры (studio doctor) — без него подача задаётся текстом и пунктуацией.
// Реплики подряд с одним голосом и подачей озвучиваются ОДНИМ заходом (до 900 знаков) — интонация
// идёт связной речью, а не набором объявлений; запись режется на реплики по таймингам слов.
// Без таймингов в ответе (или "joint": false в lines.json, VOICE_JOINT=0) — по одной реплике.
// Пометки исполнения в тексте реплики — [warmly], [softly], [sad], [sighs], [laughs]… (по-английски,
// в квадратных скобках): их понимает eleven_v3 (studio doctor: «пометки исполнения работают»),
// вслух они не читаются и в субтитры не попадают; модель, которая их не понимает, получает текст без них.
// Платный вызов кэшируется в .cache/tts по провайдеру+модели+голосу+стилю+тексту — повтор бесплатный;
// правка одной реплики переозвучивает её заход целиком. Темп pace (atempo растягивает запись:
// ниже 0.92 звучит механически), между репликами пауза gap (или after/before). Тайминги слов: из ответа озвучки
// (ElevenLabs, своя команда), иначе whisper.cpp локально, иначе OpenAI transcription (если
// есть ключ), иначе пропорционально длине слов; всё выравнивается по тексту сценария.
// words.json: {audio, total, lang, timing, lines:[{id,say,start,end,words}], words:[{text,start,end,line}],
//              captions:[{text,startMs,endMs,timestampMs,confidence}]} — секунды от начала voice.wav.
// По умолчанию job.json переключается на длину от аудио (audio: "voice.wav", tailSec 0.5);
// --keep-duration оставляет durationInFrames как есть.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cacheDir, ff, ffprobeDuration, sha } from "./_media";
import { asrPlan, OPENAI_VOICES, retime, transcribeOpenAI, tts, voiceConfig, whisperLocal, type TimedWord } from "./_providers";
import { whisperBin, whisperModel } from "./_tools";
import { die, inJobStrict, jobDir, num, parseArgs, readJob, str } from "./_lib";
import { groupLines, norm, splitJoint, stripTags, type Segment } from "./_voicejoin";

type LineIn = string | { id?: string; say: string; voice?: string; style?: string; pace?: number; before?: number; after?: number };
type Spec = { voice?: string; style?: string; pace?: number; gap?: number; lang?: string; joint?: boolean; lines: LineIn[] };
type Word = TimedWord;

const a = parseArgs(process.argv.slice(2), ["keep-duration", "estimate"]);
const dir = jobDir(a);
const file = a._[0] ?? die("нужен файл реплик: studio voice lines.json");
const raw = JSON.parse(readFileSync(inJobStrict(dir, file, "файл реплик"), "utf8"));
const spec: Spec = Array.isArray(raw) ? { lines: raw } : raw;
if (!spec.lines?.length) die("в файле нет реплик");

const cfg = voiceConfig();
const STYLE = str(a, "style") ?? spec.style;
const PACE = num(a, "pace") ?? spec.pace ?? 1;
const GAP = num(a, "gap") ?? spec.gap ?? 0.25;
const HEAD = num(a, "head") ?? 0.3;
const LANG = str(a, "lang") ?? spec.lang ?? "ru";
const OUT = str(a, "out", "voice.wav")!;

// Знаки речи: цифра читается как слово («12» → «двенадцать»), поэтому идёт за три знака.
// Пометки исполнения не звучат и не считаются.
const spoken = (text: string) => stripTags(text).replace(/\d/g, "ddd").length;
// Темп, от которого считает --estimate (знаков в секунду): спокойный диктор прошлых прогонов студии.
const EST_CPS = 11.3;

if (a.estimate) {
  const est = (text: string, pace: number) => spoken(text) / EST_CPS / Math.pow(Math.max(0.5, pace), 0.3);
  let tot = HEAD;
  spec.lines.forEach((l0, i) => {
    const l = typeof l0 === "string" ? { say: l0 } : l0;
    const d = est(l.say, l.pace ?? PACE);
    const after = l.after ?? (i < spec.lines.length - 1 ? GAP : 0);
    tot += (l.before ?? 0) + d + after;
    console.log(`  ${String(i + 1).padStart(2)} ${d.toFixed(1)} с — ${stripTags(l.say).slice(0, 70)}`);
  });
  const words = spec.lines.reduce((n, l0) => n + stripTags(typeof l0 === "string" ? l0 : l0.say).split(/\s+/).filter(Boolean).length, 0);
  console.log(`оценка: ≈ ${tot.toFixed(1)} с голоса (±10 %), ${words} слов, ${(words / tot).toFixed(2)} слова/с; темп ${PACE}. Это без озвучки — правьте текст до платного прогона.`);
  if (!cfg.ready) console.log(`внимание: ${cfg.problem} — озвучить не получится (studio doctor).`);
  process.exit(0);
}

if (cfg.provider === "none") die("озвучка выключена (VOICE_PROVIDER=none): этот ролик — без голоса. Ритм задают музыка и текст на экране; биты — по долям музыки и событиям (beat-planner «Без речи»). Голос нужен — владелец студии подключает провайдера в .env (studio doctor).");
if (!cfg.ready) die(`озвучка: ${cfg.problem} — см. .env.example и studio doctor`);

// Голос из lines.json мог быть написан под другого провайдера (имя голоса OpenAI у ElevenLabs).
const voiceFor = (v?: string) => {
  if (v && cfg.provider === "elevenlabs" && OPENAI_VOICES.includes(v)) {
    console.error(`голос «${v}» — имя голоса OpenAI, у ElevenLabs его нет: беру ELEVENLABS_VOICE_ID`);
    return cfg.voice;
  }
  return v || cfg.voice;
};
const VOICE = voiceFor(str(a, "voice") ?? spec.voice);
if (STYLE && !cfg.style) console.error(`провайдер ${cfg.provider} (${cfg.model}) не понимает --style — подачу задают текст и пунктуация`);

const wBin = whisperBin(), wModel = whisperModel();
const plan = asrPlan(process.env, { voiceTimestamps: cfg.timestamps, whisper: Boolean(wBin && wModel) });

// Что уходит провайдеру: пометки исполнения — только модели, которая их понимает.
const sendText = (say: string) => cfg.tags ? say.trim().replace(/\s+/g, " ") : stripTags(say);
const JOINT = cfg.timestamps && spec.joint !== false && process.env.VOICE_JOINT?.trim() !== "0";
const JOINT_MAX = 900;

type Take = { wav: string; words?: Word[] };
type Raw = { src: string; key: string; words?: Word[] };
// Платный вызов (или кэш): исходная запись провайдера и тайминги слов в ней.
const fetchRaw = async (text: string, voice: string, style: string | undefined): Promise<Raw> => {
  const key = sha([cfg.tag, voice, cfg.style ? style ?? "" : "", LANG, text].join("|"));
  const metaFile = join(cacheDir("tts"), `${key}.json`);
  let meta: { file: string; words?: Word[] } | null = null;
  try { meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, "utf8")) : null; } catch { meta = null; }
  if (!meta || !existsSync(join(cacheDir("tts"), meta.file))) {
    console.error(`озвучка (${cfg.provider}, ${voice}): ${text.slice(0, 60)}${text.length > 60 ? "…" : ""}`);
    const r = await tts({ text, voice, style, lang: LANG });
    const f = `${key}.${r.ext}`;
    writeFileSync(join(cacheDir("tts"), f + ".tmp"), r.audio);
    renameSync(join(cacheDir("tts"), f + ".tmp"), join(cacheDir("tts"), f));
    meta = { file: f, ...(r.words?.length ? { words: r.words } : {}) };
    writeFileSync(metaFile, JSON.stringify(meta));
  }
  return { src: join(cacheDir("tts"), meta.file), key, words: meta.words };
};

// Реплика отдельным вызовом: тишина по краям срезается, темп — atempo.
const take = async (text: string, voice: string, style: string | undefined, pace: number): Promise<Take> => {
  const { src, key, words } = await fetchRaw(text, voice, style);
  const wav = join(cacheDir("tts"), `${key}-st${pace.toFixed(3)}.wav`);
  if (!existsSync(wav)) {
    ff(["-i", src, "-af",
      `silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.04,areverse,atempo=${pace}`,
      "-ar", "48000", "-ac", "1", wav + ".tmp.wav"]);
    renameSync(wav + ".tmp.wav", wav);
  }
  return { wav, words: words ? retime(words, pace, ffprobeDuration(wav)) : undefined };
};

// Кусок общей записи — одна реплика: края с короткой подтяжкой громкости (без щелчков), темп — atempo.
const cut = (r: Raw, seg: Segment, pace: number): Take => {
  const len = seg.end - seg.start;
  const wav = join(cacheDir("tts"), `${r.key}-j${seg.start.toFixed(3)}-${seg.end.toFixed(3)}-st${pace.toFixed(3)}.wav`);
  if (!existsSync(wav)) {
    ff(["-ss", seg.start.toFixed(3), "-t", len.toFixed(3), "-i", r.src, "-af",
      `afade=t=in:d=0.01,afade=t=out:st=${Math.max(0, len - 0.03).toFixed(3)}:d=0.03,atempo=${pace}`,
      "-ar", "48000", "-ac", "1", wav + ".tmp.wav"]);
    renameSync(wav + ".tmp.wav", wav);
  }
  const p = Math.max(0.25, pace);
  return { wav, words: seg.words.map((w) => ({ text: w.text, start: w.start / p, end: w.end / p })) };
};

type Line = { send: string; voice: string; style?: string; pace: number };
let jointLines = 0;
// Реплики подряд с тем же голосом и подачей — одним заходом; не разрезалось по словам — по одной.
const takesFor = async (ls: Line[]): Promise<Take[]> => {
  const out: Take[] = new Array(ls.length);
  const groups = JOINT ? groupLines(ls.map((l) => ({ text: l.send, key: `${l.voice}\u0000${l.style ?? ""}` })), JOINT_MAX) : ls.map((_, i) => [i]);
  for (const g of groups) {
    if (g.length > 1) {
      const r = await fetchRaw(g.map((i) => ls[i].send).join(" "), ls[g[0]].voice, ls[g[0]].style);
      const segs = r.words?.length ? splitJoint(g.map((i) => ls[i].send), r.words, ffprobeDuration(r.src)) : null;
      if (segs) { g.forEach((i, j) => { out[i] = cut(r, segs[j], ls[i].pace); }); jointLines += g.length; continue; }
      console.error(`озвучка одним заходом не разрезалась по словам (реплики ${g[0] + 1}–${g[g.length - 1] + 1}) — озвучиваю их по одной`);
    }
    for (const i of g) out[i] = await take(ls[i].send, ls[i].voice, ls[i].style, ls[i].pace);
  }
  return out;
};

// Что услышано в реплике — по плану источников; null — только пропорция.
const used = new Set<string>();
const hear = async (t: Take): Promise<Word[] | null> => {
  for (const step of plan) {
    if (step === "voice" && t.words?.length) { used.add("озвучка"); return t.words; }
    if (step === "whisper") {
      const w = whisperLocal(t.wav, LANG, wBin!, wModel!);
      if (w?.length) { used.add("whisper.cpp"); return w; }
    }
    if (step === "openai") {
      const cache = t.wav.replace(/\.wav$/, `.${LANG}.openai.json`);
      try {
        const w: Word[] = existsSync(cache) ? JSON.parse(readFileSync(cache, "utf8")) : await transcribeOpenAI(readFileSync(t.wav), LANG);
        if (!existsSync(cache)) writeFileSync(cache, JSON.stringify(w));
        if (w.length) { used.add("OpenAI transcription"); return w; }
      } catch (e) { console.error(`тайминги OpenAI не вышли: ${(e as Error).message}`); }
    }
  }
  used.add("пропорция");
  return null;
};

// Слова сценария по времени: совпадения с услышанным — якоря, между ними — по длине слов.
const align = (text: string, dur: number, heard: Word[] | null): Word[] => {
  const tokens = text.split(/\s+/).filter((t) => norm(t).length > 0);
  const weights = tokens.map((t) => norm(t).length + 1);
  const anchors: Array<number | null> = tokens.map(() => null);
  if (heard?.length) {
    let h = 0;
    tokens.forEach((t, i) => {
      const n = norm(t);
      for (let k = h; k < Math.min(heard.length, h + 3); k++) {
        const m = norm(heard[k].text);
        if (m === n || (m.length > 3 && n.startsWith(m.slice(0, 4)))) { anchors[i] = heard[k].start; h = k + 1; break; }
      }
    });
  }
  const pts: Array<[number, number]> = [[0, 0]];
  anchors.forEach((x, i) => { if (i > 0 && x !== null && x > pts[pts.length - 1][1] && x < dur) pts.push([i, x]); });
  pts.push([tokens.length, dur]);
  const starts = new Array(tokens.length).fill(0);
  for (let p = 0; p < pts.length - 1; p++) {
    const [i0, t0] = pts[p], [i1, t1] = pts[p + 1];
    const total = weights.slice(i0, i1).reduce((s, w) => s + w, 0);
    let acc = 0;
    for (let i = i0; i < i1; i++) { starts[i] = t0 + ((t1 - t0) * acc) / Math.max(1, total); acc += weights[i]; }
  }
  return tokens.map((t, i) => ({ text: t, start: starts[i], end: i + 1 < tokens.length ? starts[i + 1] : dur }));
};

const silence = (d: number) => {
  const ms = Math.max(0, Math.round(d * 1000));
  const p = join(cacheDir("tts"), `sil4-${ms}ms.wav`);
  if (!existsSync(p)) { ff(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", (ms / 1000).toFixed(3), p + ".tmp.wav"]); renameSync(p + ".tmp.wav", p); }
  return p;
};

const main = async () => {
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const parts: string[] = [];
  const lines: Array<{ id: string; say: string; start: number; end: number; words: Array<Word & { line: number }> }> = [];
  const specLines = spec.lines.map((l0, i) => {
    const l = typeof l0 === "string" ? { say: l0 } : l0;
    if (typeof l.say !== "string" || !stripTags(l.say)) die(`реплика ${i}: пустой текст`);
    return l;
  });
  const takes = await takesFor(specLines.map((l) => ({
    send: sendText(l.say), voice: l.voice ? voiceFor(l.voice) : VOICE, style: l.style ?? STYLE, pace: l.pace ?? PACE,
  })));
  let t = 0;
  if (HEAD > 0) { parts.push(silence(HEAD)); t += HEAD; }
  for (let i = 0; i < specLines.length; i++) {
    const l = specLines[i];
    const say = stripTags(l.say);
    const before = l.before ?? 0;
    if (before > 0) { parts.push(silence(before)); t += before; }
    const tk = takes[i];
    const d = ffprobeDuration(tk.wav);
    const words = align(say, d, await hear(tk)).map((w) => ({ text: w.text, start: r3(t + w.start), end: r3(t + w.end), line: i }));
    lines.push({ id: l.id ?? `l${i + 1}`, say, start: r3(t), end: r3(t + d), words });
    parts.push(tk.wav);
    t += d;
    const after = l.after ?? (i < specLines.length - 1 ? GAP : 0);
    if (after > 0) { parts.push(silence(after)); t += after; }
  }

  const outWav = inJobStrict(dir, join("public", OUT), "--out");
  const list = outWav.replace(/\.wav$/, ".concat.txt");
  writeFileSync(list, parts.map((p) => `file '${p.replace(/'/g, `'\\''`)}'`).join("\n"));
  ff(["-f", "concat", "-safe", "0", "-i", list, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "48000", "-c:a", "pcm_s16le", outWav]);
  const total = r3(ffprobeDuration(outWav));
  const words = lines.flatMap((l) => l.words);
  const captions = words.map((w, k) => ({
    text: (k === 0 ? "" : " ") + w.text, startMs: Math.round(w.start * 1000), endMs: Math.round(w.end * 1000),
    timestampMs: Math.round(((w.start + w.end) / 2) * 1000), confidence: null,
  }));
  const timing = [...used].join(" + ");
  const wordsFile = OUT.replace(/\.wav$/, "") === "voice" ? "words.json" : OUT.replace(/\.wav$/, ".words.json");
  const charsPerSec = r3(lines.reduce((s0, l) => s0 + spoken(l.say), 0) / Math.max(0.1, lines.reduce((s0, l) => s0 + (l.end - l.start), 0)));
  writeFileSync(inJobStrict(dir, join("public", wordsFile), "тайминги"), JSON.stringify({ audio: OUT, total, lang: LANG, timing, charsPerSec, lines, words, captions }, null, 1));

  if (!a["keep-duration"]) {
    const job = readJob(dir) as unknown as Record<string, unknown>;
    delete job.durationInFrames;
    job.audio = OUT;
    job.tailSec = job.tailSec ?? 0.5;
    writeFileSync(join(dir, "job.json"), JSON.stringify(job, null, 2) + "\n");
  }
  const rough = used.has("пропорция");
  console.log(`public/${OUT}: ${total} с, ${lines.length} реплик, ${words.length} слов; тайминги слов: ${timing}${rough ? " (ВНИМАНИЕ: где пропорция — склейки по словам приблизительны, проверьте на слух/кадрах)" : ""}`);
  console.log(`одним заходом (связная речь): ${jointLines} из ${lines.length} реплик${cfg.tags ? "; пометки исполнения [..] работают" : "; пометки [..] этой модели не передаются"}`);
  // Темп речи по факту (знаков в секунду звучания, без пауз между репликами): голоса сильно
  // разнятся (системный голос macOS ≈ 14–15 зн/с против ≈ 11 у спокойного диктора), а зритель в
  // ленте не перемотает назад. Это данные для режиссёра, решение — его: --pace, текст, паузы.
  const cps = (l: { say: string; start: number; end: number }) => spoken(l.say) / Math.max(0.1, l.end - l.start);
  const speech = lines.reduce((s0, l) => s0 + (l.end - l.start), 0);
  const avg = lines.reduce((s0, l) => s0 + spoken(l.say), 0) / Math.max(0.1, speech);
  for (const l of lines) console.log(`  ${l.id}: ${l.start.toFixed(2)}–${l.end.toFixed(2)} с  ${cps(l).toFixed(1)} зн/с  ${l.say.slice(0, 70)}`);
  console.log(`темп речи: ${avg.toFixed(1)} зн/с в среднем, самая быстрая реплика ${Math.max(...lines.map(cps)).toFixed(1)} зн/с; оценка --estimate считала ${EST_CPS} зн/с. Быстрее, чем задумано, — короче текст, паузы (gap, after) там, где зрителю нужно успеть понять, многоточие и тире в тексте${cfg.tags ? ", пометки [slowly]/[softly]" : ""}; --pace растягивает готовую запись — ниже 0.92 голос звучит механически.`);
  console.log(`public/${wordsFile}`);
};
main().catch((e) => { console.error("ошибка: " + (e?.message ?? e)); process.exit(1); });
