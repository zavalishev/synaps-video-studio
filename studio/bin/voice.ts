// Озвучка: реплики → public/voice.wav + public/words.json (тайминги слов).
//   studio voice lines.json [--voice onyx] [--style "указания диктору"] [--model gpt-4o-mini-tts]
//                [--pace 1.0] [--gap 0.25] [--head 0.3] [--lang ru] [--out voice.wav]
//                [--keep-duration] [--job dir] [--estimate]
// --estimate — без озвучки (бесплатно): оценка длины по тексту (≈ 11.3 знака/с у
// gpt-4o-mini-tts по прошлым роликам, цифры читаются втрое длиннее записи) — чтобы первая
// озвучка попала в нужную длину ±10 %, а не переписывать сценарий после платного прогона.
// lines.json — один из видов:
//   ["Первая реплика.", "Вторая."]
//   {"voice":"onyx","style":"…","pace":1.1,"gap":0.3,"lines":["…", {"id":"hook","say":"…","pace":1.2,"after":0.6,"style":"…","voice":"…"}]}
// Каждая реплика озвучивается отдельно (платный вызов TTS через подключённого провайдера, кэш .cache/tts по
// голосу+стилю+тексту — повтор бесплатный), тишина по краям срезается, темп pace (atempo),
// между репликами пауза gap (или after/before реплики). Тайминги слов — whisper.cpp
// (локально), выровненные по тексту сценария; без whisper — пропорционально длине слов.
// words.json: {audio, total, lang, lines:[{id,say,start,end,words}], words:[{text,start,end,line}],
//              captions:[{text,startMs,endMs,timestampMs,confidence}]} — секунды от начала voice.wav.
// По умолчанию job.json переключается на длину от аудио (audio: "voice.wav", tailSec 0.5);
// --keep-duration оставляет durationInFrames как есть.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cacheDir, ff, ffprobeDuration, sha } from "./_media";
import { tts } from "./_providers";
import { die, inJob, jobDir, num, parseArgs, readJob, str } from "./_lib";

type LineIn = string | { id?: string; say: string; voice?: string; style?: string; pace?: number; before?: number; after?: number };
type Spec = { voice?: string; style?: string; pace?: number; gap?: number; lang?: string; lines: LineIn[] };
type Word = { text: string; start: number; end: number };

const a = parseArgs(process.argv.slice(2), ["keep-duration", "estimate"]);
const dir = jobDir(a);
const file = a._[0] ?? die("нужен файл реплик: studio voice lines.json");
const raw = JSON.parse(readFileSync(inJob(dir, file), "utf8"));
const spec: Spec = Array.isArray(raw) ? { lines: raw } : raw;
if (!spec.lines?.length) die("в файле нет реплик");

const MODEL = str(a, "model") ?? process.env.TTS_MODEL ?? "gpt-4o-mini-tts";
const VOICE = str(a, "voice") ?? spec.voice ?? "onyx";
const STYLE = str(a, "style") ?? spec.style;
const PACE = num(a, "pace") ?? spec.pace ?? 1;
const GAP = num(a, "gap") ?? spec.gap ?? 0.25;
const HEAD = num(a, "head") ?? 0.3;
const LANG = str(a, "lang") ?? spec.lang ?? "ru";
const OUT = str(a, "out", "voice.wav")!;
// Модель whisper.cpp: $WHISPER_MODEL, иначе первая найденная из обычных мест (ggml-small.bin).
const WHISPER = process.env.WHISPER_MODEL ?? [
  join(homedir(), ".cache/whisper/ggml-small.bin"),
  join(homedir(), "Library/Application Support/superwhisper/ggml-small.bin"),
  "/opt/homebrew/share/whisper-cpp/ggml-small.bin",
  "/usr/local/share/whisper-cpp/ggml-small.bin",
].find((p) => existsSync(p)) ?? join(homedir(), ".cache/whisper/ggml-small.bin");

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
  process.exit(0);
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]/g, "");

const take = (text: string, voice: string, style: string | undefined, pace: number): string => {
  const key = sha([MODEL, voice, style, text].join("|"));
  const mp3 = join(cacheDir("tts"), `${key}.mp3`);
  if (!existsSync(mp3)) {
    console.error(`TTS (${voice}): ${text.slice(0, 60)}${text.length > 60 ? "…" : ""}`);
    writeFileSync(mp3 + ".tmp", tts({ model: MODEL, voice, input: text, response_format: "mp3", ...(style ? { instructions: style } : {}) }));
    renameSync(mp3 + ".tmp", mp3);
  }
  const wav = join(cacheDir("tts"), `${key}-st${pace.toFixed(3)}.wav`);
  if (!existsSync(wav)) {
    ff(["-i", mp3, "-af",
      `silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.04,areverse,atempo=${pace}`,
      "-ar", "48000", "-ac", "1", wav + ".tmp.wav"]);
    renameSync(wav + ".tmp.wav", wav);
  }
  return wav;
};

const whisper = (wav: string): Word[] | null => {
  if (!existsSync(WHISPER)) return null;
  const base = wav.replace(/\.wav$/, `.${LANG}.w`);
  if (!existsSync(base + ".json")) {
    const r = spawnSync("whisper-cli", ["-m", WHISPER, "-l", LANG, "-ml", "1", "-sow", "-oj", "-of", base, "-f", wav, "-np"]);
    if (r.status !== 0) return null;
  }
  try {
    const j = JSON.parse(readFileSync(base + ".json", "utf8"));
    return (j.transcription as Array<{ text: string; offsets: { from: number; to: number } }>)
      .map((s) => ({ text: s.text.trim(), start: s.offsets.from / 1000, end: s.offsets.to / 1000 }))
      .filter((w) => norm(w.text).length > 0);
  } catch { return null; }
};

// Слова сценария по времени: совпадения с whisper — якоря, между ними — по длине слов.
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

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const parts: string[] = [];
const lines: Array<{ id: string; say: string; start: number; end: number; words: Array<Word & { line: number }> }> = [];
let t = 0;
if (HEAD > 0) { parts.push(silence(HEAD)); t += HEAD; }
spec.lines.forEach((l0, i) => {
  const l = typeof l0 === "string" ? { say: l0 } : l0;
  if (!l.say?.trim()) die(`реплика ${i}: пустой текст`);
  const before = l.before ?? 0;
  if (before > 0) { parts.push(silence(before)); t += before; }
  const wav = take(l.say.trim(), l.voice ?? VOICE, l.style ?? STYLE, l.pace ?? PACE);
  const d = ffprobeDuration(wav);
  const words = align(l.say.trim(), d, whisper(wav)).map((w) => ({ text: w.text, start: r3(t + w.start), end: r3(t + w.end), line: i }));
  lines.push({ id: l.id ?? `l${i + 1}`, say: l.say.trim(), start: r3(t), end: r3(t + d), words });
  parts.push(wav);
  t += d;
  const after = l.after ?? (i < spec.lines.length - 1 ? GAP : 0);
  if (after > 0) { parts.push(silence(after)); t += after; }
});

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
const wordsFile = OUT.replace(/\.wav$/, "") === "voice" ? "words.json" : OUT.replace(/\.wav$/, ".words.json");
writeFileSync(inJob(dir, join("public", wordsFile)), JSON.stringify({ audio: OUT, total, lang: LANG, lines, words, captions }, null, 1));

if (!a["keep-duration"]) {
  const job = readJob(dir) as unknown as Record<string, unknown>;
  delete job.durationInFrames;
  job.audio = OUT;
  job.tailSec = job.tailSec ?? 0.5;
  writeFileSync(join(dir, "job.json"), JSON.stringify(job, null, 2) + "\n");
}
console.log(`public/${OUT}: ${total} с, ${lines.length} реплик, ${words.length} слов${existsSync(WHISPER) ? "" : " (без whisper — тайминги по длине слов)"}`);
for (const l of lines) console.log(`  ${l.id}: ${l.start.toFixed(2)}–${l.end.toFixed(2)} с  ${l.say.slice(0, 70)}`);
console.log(`public/${wordsFile}`);
