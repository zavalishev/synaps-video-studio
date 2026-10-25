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
// Каждая реплика озвучивается отдельно (платный вызов, кэш .cache/tts по провайдеру+модели+
// голосу+стилю+тексту — повтор бесплатный), тишина по краям срезается, темп pace (atempo),
// между репликами пауза gap (или after/before реплики). Тайминги слов: из ответа озвучки
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
import { die, inJob, jobDir, num, parseArgs, readJob, str } from "./_lib";

type LineIn = string | { id?: string; say: string; voice?: string; style?: string; pace?: number; before?: number; after?: number };
type Spec = { voice?: string; style?: string; pace?: number; gap?: number; lang?: string; lines: LineIn[] };
type Word = TimedWord;

const a = parseArgs(process.argv.slice(2), ["keep-duration", "estimate"]);
const dir = jobDir(a);
const file = a._[0] ?? die("нужен файл реплик: studio voice lines.json");
const raw = JSON.parse(readFileSync(inJob(dir, file), "utf8"));
const spec: Spec = Array.isArray(raw) ? { lines: raw } : raw;
if (!spec.lines?.length) die("в файле нет реплик");

const cfg = voiceConfig();
const STYLE = str(a, "style") ?? spec.style;
const PACE = num(a, "pace") ?? spec.pace ?? 1;
const GAP = num(a, "gap") ?? spec.gap ?? 0.25;
const HEAD = num(a, "head") ?? 0.3;
const LANG = str(a, "lang") ?? spec.lang ?? "ru";
const OUT = str(a, "out", "voice.wav")!;

if (a.estimate) {
  const est = (text: string, pace: number) => {
    const chars = text.replace(/\d/g, "ddd").length;
    return chars / 11.3 / Math.pow(Math.max(0.5, pace), 0.3);
  };
  let tot = HEAD;
  spec.lines.forEach((l0, i) => {
    const l = typeof l0 === "string" ? { say: l0 } : l0;
    const d = est(l.say, l.pace ?? PACE);
    const after = l.after ?? (i < spec.lines.length - 1 ? GAP : 0);
    tot += (l.before ?? 0) + d + after;
    console.log(`  ${String(i + 1).padStart(2)} ${d.toFixed(1)} с — ${l.say.slice(0, 70)}`);
  });
  const words = spec.lines.reduce((n, l0) => n + (typeof l0 === "string" ? l0 : l0.say).split(/\s+/).filter(Boolean).length, 0);
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

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]/gu, "");

type Take = { wav: string; words?: Word[] };
const take = async (text: string, voice: string, style: string | undefined, pace: number): Promise<Take> => {
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
  const src = join(cacheDir("tts"), meta.file);
  const wav = join(cacheDir("tts"), `${key}-st${pace.toFixed(3)}.wav`);
  if (!existsSync(wav)) {
    ff(["-i", src, "-af",
      `silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.04,areverse,atempo=${pace}`,
      "-ar", "48000", "-ac", "1", wav + ".tmp.wav"]);
    renameSync(wav + ".tmp.wav", wav);
  }
  return { wav, words: meta.words ? retime(meta.words, pace, ffprobeDuration(wav)) : undefined };
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
  let t = 0;
  if (HEAD > 0) { parts.push(silence(HEAD)); t += HEAD; }
  for (let i = 0; i < spec.lines.length; i++) {
    const l0 = spec.lines[i];
    const l = typeof l0 === "string" ? { say: l0 } : l0;
    if (!l.say?.trim()) die(`реплика ${i}: пустой текст`);
    const before = l.before ?? 0;
    if (before > 0) { parts.push(silence(before)); t += before; }
    const tk = await take(l.say.trim(), l.voice ? voiceFor(l.voice) : VOICE, l.style ?? STYLE, l.pace ?? PACE);
    const d = ffprobeDuration(tk.wav);
    const words = align(l.say.trim(), d, await hear(tk)).map((w) => ({ text: w.text, start: r3(t + w.start), end: r3(t + w.end), line: i }));
    lines.push({ id: l.id ?? `l${i + 1}`, say: l.say.trim(), start: r3(t), end: r3(t + d), words });
    parts.push(tk.wav);
    t += d;
    const after = l.after ?? (i < spec.lines.length - 1 ? GAP : 0);
    if (after > 0) { parts.push(silence(after)); t += after; }
  }

  const outWav = inJob(dir, join("public", OUT));
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
  writeFileSync(inJob(dir, join("public", wordsFile)), JSON.stringify({ audio: OUT, total, lang: LANG, timing, lines, words, captions }, null, 1));

  if (!a["keep-duration"]) {
    const job = readJob(dir) as unknown as Record<string, unknown>;
    delete job.durationInFrames;
    job.audio = OUT;
    job.tailSec = job.tailSec ?? 0.5;
    writeFileSync(join(dir, "job.json"), JSON.stringify(job, null, 2) + "\n");
  }
  const rough = used.has("пропорция");
  console.log(`public/${OUT}: ${total} с, ${lines.length} реплик, ${words.length} слов; тайминги слов: ${timing}${rough ? " (ВНИМАНИЕ: где пропорция — склейки по словам приблизительны, проверьте на слух/кадрах)" : ""}`);
  for (const l of lines) console.log(`  ${l.id}: ${l.start.toFixed(2)}–${l.end.toFixed(2)} с  ${l.say.slice(0, 70)}`);
  console.log(`public/${wordsFile}`);
};
main().catch((e) => { console.error("ошибка: " + (e?.message ?? e)); process.exit(1); });
