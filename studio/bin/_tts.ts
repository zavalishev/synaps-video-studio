// Озвучка одной реплики через провайдера из .env: VOICE_PROVIDER = openai | elevenlabs | command | none.
// Text-to-speech providers configured in .env.
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deps, fetchRetry, need, pick, ProviderError, ProviderNotConfigured, runCommand, short, templateProblem, tmp, type D, type Deps, type Env } from "./_http";
import { maskTags } from "./_voicejoin";

export type VoiceConfig = {
  provider: string; model: string; voice: string;
  ready: boolean; problem?: string;
  tag: string;            // входит в ключ кэша: другой провайдер/модель — другая озвучка
  timestamps: boolean;    // тайминги слов приходят вместе с аудио (ASR не нужен)
  style: boolean;         // понимает указания диктору (--style)
  tags: boolean;          // понимает пометки исполнения в тексте ([warmly], [sighs]) — иначе они вырезаются
};
export const OPENAI_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"];

export const VOICE_PLACEHOLDERS = ["text_file", "out_wav", "out", "voice", "lang", "style_file", "words_json"];
// Голос и язык приходят от режиссёра (lines.json, --voice/--lang): только «безопасные» символы.
// Shell их и так не разбирает (значения — переменными окружения), это вторая линия защиты.
export const VOICE_RE = /^[\p{L}\p{N}_.:@+() -]{1,128}$/u;
export const LANG_RE = /^[a-z]{2,3}(?:[-_][A-Za-z0-9]{2,4})?$/;
const checkVoiceArgs = (voice: string, lang?: string) => {
  if (voice && !VOICE_RE.test(voice)) throw new ProviderError(`озвучка: недопустимое имя голоса ${JSON.stringify(voice.slice(0, 40))} (буквы, цифры, пробел и _ . : @ + ( ) -)`);
  if (lang && !LANG_RE.test(lang)) throw new ProviderError(`озвучка: недопустимый код языка ${JSON.stringify(lang.slice(0, 20))} (например ru, en, pt-BR)`);
};

export const voiceConfig = (env: Env = process.env): VoiceConfig => {
  const p = (env.VOICE_PROVIDER ?? "").trim().toLowerCase() || "none";
  const off = { model: "", voice: "", ready: false, timestamps: false, style: false, tags: false };
  if (p === "openai") {
    const model = pick(env, "OPENAI_TTS_MODEL", "gpt-4o-mini-tts");
    const ok = Boolean(env.OPENAI_API_KEY?.trim());
    return { provider: p, model, voice: pick(env, "OPENAI_TTS_VOICE", "onyx"), ready: ok, problem: ok ? undefined : "нет OPENAI_API_KEY",
      tag: `openai:${model}`, timestamps: false, style: /gpt-4o/.test(model), tags: false };
  }
  if (p === "elevenlabs") {
    const model = pick(env, "ELEVENLABS_MODEL", "eleven_v3");
    const voice = env.ELEVENLABS_VOICE_ID?.trim() ?? "";
    const miss = [!env.ELEVENLABS_API_KEY?.trim() && "ELEVENLABS_API_KEY", !voice && "ELEVENLABS_VOICE_ID"].filter(Boolean);
    return { provider: p, model, voice, ready: miss.length === 0, problem: miss.length ? `нет ${miss.join(", ")}` : undefined,
      tag: `elevenlabs:${model}`, timestamps: true, style: false, tags: /^eleven_v3/.test(model) };
  }
  if (p === "command") {
    const tpl = env.VOICE_COMMAND?.trim() ?? "";
    const bad = tpl ? templateProblem("VOICE_COMMAND", tpl, VOICE_PLACEHOLDERS) : "нет VOICE_COMMAND";
    return { provider: p, model: "command", voice: pick(env, "VOICE_COMMAND_VOICE", "default"), ready: !bad,
      problem: bad, tag: `command:${short(tpl)}`,
      timestamps: /\{words_json\}/.test(tpl), style: /\{style(_file)?\}/.test(tpl), tags: env.VOICE_TAGS?.trim() === "1" };
  }
  if (p === "none") return { provider: "none", ...off, problem: "озвучка выключена (VOICE_PROVIDER=none)", tag: "none" };
  return { provider: p, ...off, problem: `неизвестный VOICE_PROVIDER=${p} (openai | elevenlabs | command | none)`, tag: p };
};

export type TtsRequest = { text: string; voice?: string; style?: string; lang?: string };
export type TimedWord = { text: string; start: number; end: number };
export type TtsResult = { audio: Buffer; ext: "mp3" | "wav" | "audio"; words?: TimedWord[] };

// Посимвольные тайминги (ElevenLabs alignment) → слова по пробелам.
export const charsToWords = (chars: string[], starts: number[], ends: number[]): TimedWord[] => {
  const out: TimedWord[] = [];
  let cur: TimedWord | null = null;
  chars.forEach((c, i) => {
    if (/\s/.test(c)) { if (cur) out.push(cur); cur = null; return; }
    if (!cur) cur = { text: c, start: starts[i] ?? 0, end: ends[i] ?? starts[i] ?? 0 };
    else { cur.text += c; cur.end = ends[i] ?? cur.end; }
  });
  if (cur) out.push(cur);
  return out;
};

const sniffAudio = (b: Buffer): TtsResult["ext"] =>
  b.subarray(0, 4).toString("latin1") === "RIFF" ? "wav" :
  b.subarray(0, 3).toString("latin1") === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) ? "mp3" : "audio";

const ttsOpenAI = async (req: TtsRequest, cfg: VoiceConfig, d: D): Promise<TtsResult> => {
  const key = need(d.env, "OPENAI_API_KEY", "озвучка OpenAI");
  const base = pick(d.env, "OPENAI_BASE_URL", "https://api.openai.com/v1").replace(/\/$/, "");
  const body: Record<string, unknown> = { model: cfg.model, voice: req.voice || cfg.voice, input: req.text, response_format: "mp3" };
  if (req.style && cfg.style) body.instructions = req.style;   // указания диктору — только у gpt-4o-*-tts
  const res = await fetchRetry("озвучка OpenAI", `${base}/audio/speech`, {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  }, d, { timeoutMs: 180_000 });
  return { audio: Buffer.from(await res.arrayBuffer()), ext: "mp3" };
};

// ElevenLabs: любой голос из библиотеки или свой клон (ELEVENLABS_VOICE_ID). Конечная точка
// with-timestamps отдаёт аудио и посимвольные тайминги — whisper не нужен.
const ttsElevenLabs = async (req: TtsRequest, cfg: VoiceConfig, d: D): Promise<TtsResult> => {
  const key = need(d.env, "ELEVENLABS_API_KEY", "озвучка ElevenLabs");
  const voice = req.voice || cfg.voice || need(d.env, "ELEVENLABS_VOICE_ID", "озвучка ElevenLabs");
  const base = pick(d.env, "ELEVENLABS_BASE_URL", "https://api.elevenlabs.io/v1").replace(/\/$/, "");
  const body: Record<string, unknown> = { text: req.text, model_id: cfg.model };
  // language_code принимают только turbo/flash v2.5 — остальные модели отвечают ошибкой.
  if (req.lang && /(turbo|flash)_v2_5/.test(cfg.model)) body.language_code = req.lang;
  const settings: Record<string, number> = {};
  for (const [k, v] of [["stability", "ELEVENLABS_STABILITY"], ["similarity_boost", "ELEVENLABS_SIMILARITY"], ["style", "ELEVENLABS_STYLE"], ["speed", "ELEVENLABS_SPEED"]] as const) {
    const n = Number(d.env[v]);
    if (d.env[v]?.trim() && Number.isFinite(n)) settings[k] = n;
  }
  if (Object.keys(settings).length) body.voice_settings = settings;
  const fmt = pick(d.env, "ELEVENLABS_OUTPUT_FORMAT", "mp3_44100_128");
  const headers = { "xi-api-key": key, "Content-Type": "application/json" };
  const url = `${base}/text-to-speech/${encodeURIComponent(voice)}`;
  try {
    const res = await fetchRetry("озвучка ElevenLabs", `${url}/with-timestamps?output_format=${fmt}`,
      { method: "POST", headers, body: JSON.stringify(body) }, d, { timeoutMs: 180_000 });
    const j = await res.json() as { audio_base64?: string; alignment?: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] } | null };
    if (!j.audio_base64) throw new ProviderError("озвучка ElevenLabs: в ответе нет audio_base64");
    const al = j.alignment;
    // Пометки исполнения не звучат словами — в тайминги не берём (и многословные, и слитные с текстом).
    const words = al ? charsToWords(maskTags(al.characters), al.character_start_times_seconds, al.character_end_times_seconds) : undefined;
    return { audio: Buffer.from(j.audio_base64, "base64"), ext: "mp3", words };
  } catch (e) {
    // Нет конечной точки с таймингами (прокси, совместимый сервер) — обычная озвучка, тайминги — ASR.
    if (!(e instanceof ProviderError) || (e.status !== 404 && e.status !== 405)) throw e;
    const res = await fetchRetry("озвучка ElevenLabs", `${url}?output_format=${fmt}`,
      { method: "POST", headers: { ...headers, Accept: "audio/mpeg" }, body: JSON.stringify(body) }, d, { timeoutMs: 180_000 });
    return { audio: Buffer.from(await res.arrayBuffer()), ext: "mp3" };
  }
};

// Своя программа: VOICE_COMMAND с подстановками {text_file} {out_wav} (= {out}) {voice} {lang}
// {style_file} {words_json}. Текст передаётся только файлом (в командную строку не попадает).
// Программа пишет аудио (wav/mp3/любой формат ffmpeg) в {out_wav}; по желанию — тайминги слов
// в {words_json}: [{"text","start","end"}] в секундах (тогда ASR не нужен).
const ttsCommand = async (req: TtsRequest, cfg: VoiceConfig, d: D): Promise<TtsResult> => {
  const tpl = need(d.env, "VOICE_COMMAND", "озвучка (command)");
  const dir = tmp("studio-tts-");
  try {
    const textFile = join(dir, "text.txt"), styleFile = join(dir, "style.txt"), out = join(dir, "out.wav"), wordsFile = join(dir, "words.json");
    writeFileSync(textFile, req.text);
    writeFileSync(styleFile, req.style ?? "");
    runCommand("озвучка (VOICE_COMMAND)", tpl, { text_file: textFile, out_wav: out, out, voice: req.voice || cfg.voice, lang: req.lang ?? "",
      style_file: styleFile, words_json: wordsFile }, d, Number(d.env.VOICE_COMMAND_TIMEOUT_SEC || 600) * 1000);
    if (!existsSync(out) || statSync(out).size === 0) throw new ProviderError("озвучка (VOICE_COMMAND): команда не записала аудио в {out_wav}");
    const audio = readFileSync(out);
    let words: TimedWord[] | undefined;
    if (existsSync(wordsFile)) {
      try {
        const j = JSON.parse(readFileSync(wordsFile, "utf8"));
        const arr = (Array.isArray(j) ? j : j.words) as Array<{ text?: string; word?: string; start: number; end: number }>;
        words = arr.map((w) => ({ text: String(w.text ?? w.word ?? "").trim(), start: Number(w.start), end: Number(w.end) }))
          .filter((w) => w.text && Number.isFinite(w.start) && Number.isFinite(w.end));
      } catch { words = undefined; }
    }
    return { audio, ext: sniffAudio(audio), words: words?.length ? words : undefined };
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

// Озвучка одной реплики. Не настроен или выключен — ProviderNotConfigured с понятным текстом.
export const tts = async (req: TtsRequest, dep: Deps = {}): Promise<TtsResult> => {
  const d = deps(dep);
  const cfg = voiceConfig(d.env);
  if (!cfg.ready) throw new ProviderNotConfigured(`озвучка: ${cfg.problem}`);
  checkVoiceArgs(req.voice || cfg.voice, req.lang);
  if (cfg.provider === "openai") return ttsOpenAI(req, cfg, d);
  if (cfg.provider === "elevenlabs") return ttsElevenLabs(req, cfg, d);
  return ttsCommand(req, cfg, d);
};
