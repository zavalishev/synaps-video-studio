// Тайминги слов (для субтитров, битов, звука). Порядок источников:
//   1) тайминги из ответа озвучки (ElevenLabs with-timestamps, своя команда с {words_json}) —
//      бесплатно и точно;
//   2) whisper.cpp локально (WHISPER_CPP_MODEL, программа whisper-cli) — бесплатно;
//   3) OpenAI transcription (whisper-1, слова с таймингами) — если есть OPENAI_API_KEY, платно, копейки;
//   4) пропорционально длине слов — с предупреждением.
// ASR_PROVIDER: auto (по порядку) | whisper | openai | none (только 1 и 4).
// Word timings: voice-provider timestamps → local whisper.cpp → OpenAI transcription → proportional.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { deps, fetchRetry, need, pick, type Deps, type Env } from "./_http";
import type { TimedWord } from "./_tts";

export type AsrStep = "voice" | "whisper" | "openai" | "proportional";
export const asrPlan = (env: Env, o: { voiceTimestamps: boolean; whisper: boolean }): AsrStep[] => {
  const mode = (env.ASR_PROVIDER ?? "auto").trim().toLowerCase() || "auto";
  const steps: AsrStep[] = o.voiceTimestamps ? ["voice"] : [];
  if ((mode === "auto" || mode === "whisper") && o.whisper) steps.push("whisper");
  if ((mode === "auto" || mode === "openai") && env.OPENAI_API_KEY?.trim()) steps.push("openai");
  steps.push("proportional");
  return steps;
};

// whisper.cpp: слова по одному (-ml 1 -sow), JSON рядом с wav (кэш).
export const whisperLocal = (wav: string, lang: string, bin: string, model: string): TimedWord[] | null => {
  const base = wav.replace(/\.wav$/, `.${lang}.w`);
  if (!existsSync(base + ".json")) {
    const r = spawnSync(bin, ["-m", model, "-l", lang, "-ml", "1", "-sow", "-oj", "-of", base, "-f", wav, "-np"]);
    if (r.status !== 0) return null;
  }
  try {
    const j = JSON.parse(readFileSync(base + ".json", "utf8"));
    return (j.transcription as Array<{ text: string; offsets: { from: number; to: number } }>)
      .map((s) => ({ text: s.text.trim(), start: s.offsets.from / 1000, end: s.offsets.to / 1000 }))
      .filter((w) => /[\p{L}\p{N}]/u.test(w.text));
  } catch { return null; }
};

// OpenAI transcription с таймингами слов (verbose_json + timestamp_granularities[]=word).
export const transcribeOpenAI = async (wav: Buffer, lang: string | undefined, dep: Deps = {}): Promise<TimedWord[]> => {
  const d = deps(dep);
  const key = need(d.env, "OPENAI_API_KEY", "распознавание OpenAI");
  const base = pick(d.env, "OPENAI_BASE_URL", "https://api.openai.com/v1").replace(/\/$/, "");
  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "line.wav");
  fd.append("model", pick(d.env, "OPENAI_ASR_MODEL", "whisper-1"));
  fd.append("response_format", "verbose_json");
  fd.append("timestamp_granularities[]", "word");
  if (lang) fd.append("language", lang);
  const res = await fetchRetry("распознавание OpenAI", `${base}/audio/transcriptions`,
    { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: fd }, d, { timeoutMs: 120_000 });
  const j = await res.json() as { words?: Array<{ word: string; start: number; end: number }> };
  return (j.words ?? []).map((w) => ({ text: String(w.word).trim(), start: Number(w.start), end: Number(w.end) })).filter((w) => w.text);
};

// Тайминги из ответа озвучки относятся к сырому аудио; студия срезает тишину в начале (оставляя
// ~20 мс) и меняет темп (atempo = pace). Переводим во время обработанной реплики длиной dur.
export const retime = (words: TimedWord[], pace: number, dur: number, keptLead = 0.02): TimedWord[] => {
  if (!words.length) return words;
  const shift = Math.max(0, words[0].start - keptLead);
  const f = (t: number) => Math.min(dur, Math.max(0, (t - shift) / Math.max(0.25, pace)));
  return words.map((w) => ({ text: w.text, start: f(w.start), end: f(w.end) }));
};
