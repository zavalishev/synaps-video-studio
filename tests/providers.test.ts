// Провайдеры студии без сети: fetch подменён, команды — безопасные cp/printf во временной папке.
// Проверяем запросы (адрес, заголовки, тело), разбор ответов, повторы, маскировку ключей,
// порядок источников таймингов и .env.
import { describe, expect, it } from "vitest";
import { parseDotenv, loadDotenv } from "../studio/bin/_env";
import {
  asrPlan, charsToWords, image, imageConfig, ProviderError, ProviderNotConfigured, redact, retime,
  transcribeOpenAI, tts, voiceConfig,
} from "../studio/bin/_providers";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Call = { url: string; init: RequestInit };
const mockFetch = (...responses: Array<() => Response>) => {
  const calls: Call[] = [];
  let i = 0;
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = responses[Math.min(i++, responses.length - 1)];
    return r();
  }) as typeof fetch;
  return { f, calls };
};
const json = (o: unknown, status = 200) => () => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const bytes = (b: Buffer, status = 200) => () => new Response(new Uint8Array(b), { status });
const text = (s: string, status: number, headers: Record<string, string> = {}) => () => new Response(s, { status, headers });
const noSleep = { waits: [] as number[], sleep: async function (ms: number) { noSleep.waits.push(ms); } };
const hdr = (c: Call, k: string) => new Headers(c.init.headers).get(k);
const body = (c: Call) => JSON.parse(String(c.init.body));
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe(".env", () => {
  it("разбирает KEY=VALUE, кавычки, export и комментарии", () => {
    const v = parseDotenv([
      "# comment", "VOICE_PROVIDER=elevenlabs   # инлайн-комментарий", "export A='x # y'", 'B="line\\nnext"',
      "EMPTY=", "BAD LINE", "URL=https://example.com/#frag",
    ].join("\n"));
    expect(v).toEqual({ VOICE_PROVIDER: "elevenlabs", A: "x # y", B: "line\nnext", EMPTY: "", URL: "https://example.com/#frag" });
  });
  it("не перезаписывает заданные переменные", () => {
    const dir = mkdtempSync(join(tmpdir(), "env-"));
    writeFileSync(join(dir, ".env"), "X=from-file\nY=from-file\n");
    const env: Record<string, string | undefined> = { X: "shell" };
    expect(loadDotenv(join(dir, ".env"), env)).toEqual(["Y"]);
    expect(env).toEqual({ X: "shell", Y: "from-file" });
  });
});

describe("конфигурация", () => {
  it("без VOICE_PROVIDER/IMAGE_PROVIDER — выключено", () => {
    expect(voiceConfig({}).provider).toBe("none");
    expect(voiceConfig({}).ready).toBe(false);
    expect(imageConfig({}).provider).toBe("none");
  });
  it("называет, чего не хватает", () => {
    expect(voiceConfig({ VOICE_PROVIDER: "elevenlabs", ELEVENLABS_API_KEY: "k" }).problem).toContain("ELEVENLABS_VOICE_ID");
    expect(voiceConfig({ VOICE_PROVIDER: "openai" }).problem).toContain("OPENAI_API_KEY");
    expect(voiceConfig({ VOICE_PROVIDER: "kimi" }).problem).toContain("неизвестный");
    expect(imageConfig({ IMAGE_PROVIDER: "gemini" }).problem).toContain("GEMINI_API_KEY");
  });
  it("тег кэша различает провайдера и модель", () => {
    const a = voiceConfig({ VOICE_PROVIDER: "openai", OPENAI_API_KEY: "k" }).tag;
    const b = voiceConfig({ VOICE_PROVIDER: "openai", OPENAI_API_KEY: "k", OPENAI_TTS_MODEL: "tts-1" }).tag;
    const c = voiceConfig({ VOICE_PROVIDER: "command", VOICE_COMMAND: "a {out_wav}" }).tag;
    const d = voiceConfig({ VOICE_PROVIDER: "command", VOICE_COMMAND: "b {out_wav}" }).tag;
    expect(new Set([a, b, c, d]).size).toBe(4);
  });
  it("возможности: прозрачность и референсы", () => {
    expect(imageConfig({ IMAGE_PROVIDER: "openai", OPENAI_API_KEY: "k" })).toMatchObject({ transparency: true, refs: true });
    expect(imageConfig({ IMAGE_PROVIDER: "openai", OPENAI_API_KEY: "k", OPENAI_IMAGE_MODEL: "dall-e-3" })).toMatchObject({ transparency: false, refs: false });
    expect(imageConfig({ IMAGE_PROVIDER: "gemini", GEMINI_API_KEY: "k" })).toMatchObject({ transparency: false, refs: true });
  });
  it("не настроен — ProviderNotConfigured, без сети", async () => {
    const { f, calls } = mockFetch(json({}));
    await expect(tts({ text: "привет" }, { env: {}, fetch: f })).rejects.toBeInstanceOf(ProviderNotConfigured);
    await expect(image("cat", {}, [], { env: { IMAGE_PROVIDER: "none" }, fetch: f })).rejects.toBeInstanceOf(ProviderNotConfigured);
    expect(calls).toHaveLength(0);
  });
});

describe("озвучка OpenAI", () => {
  const env = { VOICE_PROVIDER: "openai", OPENAI_API_KEY: "sk-test-1234567890abcdef", OPENAI_TTS_VOICE: "nova" };
  it("POST /audio/speech с голосом, моделью и указаниями диктору", async () => {
    const { f, calls } = mockFetch(bytes(Buffer.from("ID3audio")));
    const r = await tts({ text: "Привет", style: "тепло, с улыбкой" }, { env, fetch: f });
    expect(r.ext).toBe("mp3");
    expect(r.audio.toString()).toBe("ID3audio");
    expect(calls[0].url).toBe("https://api.openai.com/v1/audio/speech");
    expect(hdr(calls[0], "authorization")).toBe(`Bearer ${env.OPENAI_API_KEY}`);
    expect(body(calls[0])).toEqual({ model: "gpt-4o-mini-tts", voice: "nova", input: "Привет", response_format: "mp3", instructions: "тепло, с улыбкой" });
  });
  it("tts-1 не получает instructions; --voice важнее .env", async () => {
    const { f, calls } = mockFetch(bytes(Buffer.from("x")));
    await tts({ text: "a", style: "s", voice: "onyx" }, { env: { ...env, OPENAI_TTS_MODEL: "tts-1" }, fetch: f });
    expect(body(calls[0]).instructions).toBeUndefined();
    expect(body(calls[0]).voice).toBe("onyx");
  });
  it("повторяет 503 с паузой и не повторяет 401; ключ в ошибке замаскирован", async () => {
    noSleep.waits = [];
    const ok = mockFetch(text("busy", 503), text("busy", 503), bytes(Buffer.from("ok")));
    await tts({ text: "a" }, { env, fetch: ok.f, sleep: noSleep.sleep });
    expect(ok.calls).toHaveLength(3);
    expect(noSleep.waits).toEqual([1000, 3000]);
    const bad = mockFetch(text(`invalid key ${env.OPENAI_API_KEY}`, 401));
    const err = await tts({ text: "a" }, { env, fetch: bad.f, sleep: noSleep.sleep }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(bad.calls).toHaveLength(1);
    expect(err.message).toContain("ключ не принят");
    expect(err.message).not.toContain(env.OPENAI_API_KEY);
  });
  it("429 из-за квоты — без повторов; обычный 429 — Retry-After", async () => {
    const q = mockFetch(text('{"error":{"code":"insufficient_quota"}}', 429));
    await expect(tts({ text: "a" }, { env, fetch: q.f, sleep: noSleep.sleep })).rejects.toThrow(/квота/);
    expect(q.calls).toHaveLength(1);
    noSleep.waits = [];
    const r = mockFetch(text("slow down", 429, { "retry-after": "2" }), bytes(Buffer.from("ok")));
    await tts({ text: "a" }, { env, fetch: r.f, sleep: noSleep.sleep });
    expect(noSleep.waits).toEqual([2000]);
  });
  it("сетевая ошибка — повтор, потом понятная ошибка", async () => {
    const f = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
    await expect(tts({ text: "a" }, { env, fetch: f, sleep: noSleep.sleep })).rejects.toThrow(/сеть — fetch failed/);
  });
});

describe("озвучка ElevenLabs", () => {
  const env = { VOICE_PROVIDER: "elevenlabs", ELEVENLABS_API_KEY: "el-key-123456", ELEVENLABS_VOICE_ID: "myClonedVoice" };
  const alignment = { characters: [..."Да нет"], character_start_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6], character_end_times_seconds: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7] };
  it("with-timestamps: аудио + слова, ключ в xi-api-key", async () => {
    const { f, calls } = mockFetch(json({ audio_base64: Buffer.from("ID3x").toString("base64"), alignment }));
    const r = await tts({ text: "Да нет", lang: "ru" }, { env: { ...env, ELEVENLABS_STABILITY: "0.4" }, fetch: f });
    expect(calls[0].url).toBe("https://api.elevenlabs.io/v1/text-to-speech/myClonedVoice/with-timestamps?output_format=mp3_44100_128");
    expect(hdr(calls[0], "xi-api-key")).toBe(env.ELEVENLABS_API_KEY);
    expect(body(calls[0])).toEqual({ text: "Да нет", model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.4 } });
    expect(r.audio.toString()).toBe("ID3x");
    expect(r.words).toEqual([{ text: "Да", start: 0.1, end: 0.3 }, { text: "нет", start: 0.4, end: 0.7 }]);
    expect(voiceConfig(env).timestamps).toBe(true);
  });
  it("language_code — только для turbo/flash v2.5", async () => {
    const { f, calls } = mockFetch(json({ audio_base64: "QQ==", alignment }));
    await tts({ text: "Да нет", lang: "ru" }, { env: { ...env, ELEVENLABS_MODEL: "eleven_flash_v2_5" }, fetch: f });
    expect(body(calls[0]).language_code).toBe("ru");
  });
  it("нет конечной точки с таймингами (404) — обычная озвучка", async () => {
    const { f, calls } = mockFetch(text("not found", 404), bytes(Buffer.from("ID3plain")));
    const r = await tts({ text: "a" }, { env, fetch: f });
    expect(calls[1].url).toBe("https://api.elevenlabs.io/v1/text-to-speech/myClonedVoice?output_format=mp3_44100_128");
    expect(r.audio.toString()).toBe("ID3plain");
    expect(r.words).toBeUndefined();
  });
});

describe("своя программа (command)", () => {
  it("VOICE_COMMAND: текст файлом, аудио и тайминги из файлов; кавычки в тексте не ломают команду", async () => {
    const env = {
      VOICE_PROVIDER: "command", VOICE_COMMAND_VOICE: "anna",
      VOICE_COMMAND: `cat {text_file} > {out_wav} && printf %s {voice} >> {out_wav} && printf '[{"text":"a","start":0,"end":0.5}]' > {words_json}`,
    };
    const r = await tts({ text: "it's \"$HOME\"; echo hacked" }, { env });
    expect(r.audio.toString()).toBe("it's \"$HOME\"; echo hackedanna");
    expect(r.words).toEqual([{ text: "a", start: 0, end: 0.5 }]);
    expect(voiceConfig(env).timestamps).toBe(true);
  });
  it("ненулевой код — ошибка с хвостом stderr", async () => {
    await expect(tts({ text: "a" }, { env: { VOICE_PROVIDER: "command", VOICE_COMMAND: "echo boom >&2; exit 3" } })).rejects.toThrow(/кодом 3[\s\S]*boom/);
  });
  it("IMAGE_COMMAND: промпт файлом, размер и референсы подставлены", async () => {
    const env = { IMAGE_PROVIDER: "command", IMAGE_COMMAND: "{ cat {prompt_file}; printf ' %s %s %s' {width} {height} {background}; [ -n {refs} ] && printf ' refs'; } > {out_png}" };
    const r = await image("a fox", { size: "1024x1536", background: "opaque" }, [Buffer.from("jpg")], { env });
    expect(r.data.toString()).toBe("a fox 1024 1536 opaque refs");
  });
});

describe("картинки OpenAI", () => {
  const env = { IMAGE_PROVIDER: "openai", OPENAI_API_KEY: "sk-img-abcdefghijklmnop" };
  it("generations: размер, качество, прозрачный фон, PNG", async () => {
    const { f, calls } = mockFetch(json({ data: [{ b64_json: PNG.toString("base64") }] }));
    const r = await image("a cup", { size: "1024x1536", quality: "low", background: "transparent" }, [], { env, fetch: f });
    expect(calls[0].url).toBe("https://api.openai.com/v1/images/generations");
    expect(body(calls[0])).toEqual({ model: "gpt-image-1", prompt: "a cup", n: 1, size: "1024x1536", quality: "low", background: "transparent", output_format: "png" });
    expect(r.data.equals(PNG)).toBe(true);
    expect(r.notes).toEqual([]);
  });
  it("с референсами — /images/edits, multipart с image[]", async () => {
    const { f, calls } = mockFetch(json({ data: [{ b64_json: PNG.toString("base64") }] }));
    await image("same fox", { size: "1024x1024" }, [Buffer.from("a"), Buffer.from("b")], { env, fetch: f });
    expect(calls[0].url).toBe("https://api.openai.com/v1/images/edits");
    const fd = calls[0].init.body as FormData;
    expect(fd.get("model")).toBe("gpt-image-1");
    expect(fd.get("prompt")).toBe("same fox");
    expect(fd.getAll("image[]")).toHaveLength(2);
  });
  it("dall-e-3: свои размеры, без прозрачности — белый фон и заметка", async () => {
    const { f, calls } = mockFetch(json({ data: [{ b64_json: PNG.toString("base64") }] }));
    const r = await image("a cup", { size: "1024x1536", quality: "high", background: "transparent" }, [], { env: { ...env, OPENAI_IMAGE_MODEL: "dall-e-3" }, fetch: f });
    const b = body(calls[0]);
    expect(b).toMatchObject({ model: "dall-e-3", size: "1024x1792", quality: "hd", response_format: "b64_json" });
    expect(b.prompt).toContain("white");
    expect(r.notes.join(" ")).toMatch(/прозрачн/);
  });
  it("ответ без картинки — понятная ошибка", async () => {
    const { f } = mockFetch(json({ data: [] }));
    await expect(image("x", {}, [], { env, fetch: f })).rejects.toThrow(/нет картинки/);
  });
});

describe("картинки Gemini", () => {
  const env = { IMAGE_PROVIDER: "gemini", GEMINI_API_KEY: "AIzaSyTestKey000000000000000" };
  it("generateContent: ключ в заголовке, соотношение сторон, референсы inline, разбор inlineData", async () => {
    const { f, calls } = mockFetch(json({ candidates: [{ content: { parts: [{ text: "here" }, { inlineData: { mimeType: "image/png", data: PNG.toString("base64") } }] } }] }));
    const r = await image("a fox", { size: "1024x1536", background: "transparent" }, [Buffer.from("ref")], { env, fetch: f });
    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent");
    expect(calls[0].url).not.toContain(env.GEMINI_API_KEY);
    expect(hdr(calls[0], "x-goog-api-key")).toBe(env.GEMINI_API_KEY);
    const b = body(calls[0]);
    expect(b.generationConfig).toEqual({ responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "2:3" } });
    expect(b.contents[0].parts[0]).toEqual({ inline_data: { mime_type: "image/jpeg", data: Buffer.from("ref").toString("base64") } });
    expect(b.contents[0].parts[1].text).toMatch(/^a fox[\s\S]*white/);
    expect(r.data.equals(PNG)).toBe(true);
    expect(r.notes.join(" ")).toMatch(/белый фон/);
  });
  it("без прозрачности + IMAGE_BG_COMMAND — фон убирает своя программа", async () => {
    const { f } = mockFetch(json({ candidates: [{ content: { parts: [{ inlineData: { data: PNG.toString("base64") } }] } }] }));
    const r = await image("a fox", { background: "transparent" }, [], { env: { ...env, IMAGE_BG_COMMAND: "{ cat {in_png}; printf CUT; } > {out_png}" }, fetch: f });
    expect(r.data.subarray(-3).toString()).toBe("CUT");
    expect(r.notes.join(" ")).toMatch(/IMAGE_BG_COMMAND/);
  });
  it("отказ модели — ошибка с причиной", async () => {
    const { f } = mockFetch(json({ candidates: [{ finishReason: "IMAGE_SAFETY", content: { parts: [{ text: "cannot" }] } }] }));
    await expect(image("x", {}, [], { env, fetch: f })).rejects.toThrow(/IMAGE_SAFETY/);
  });
});

describe("тайминги слов", () => {
  it("порядок: озвучка → whisper.cpp → OpenAI → пропорция", () => {
    expect(asrPlan({ OPENAI_API_KEY: "k" }, { voiceTimestamps: true, whisper: true })).toEqual(["voice", "whisper", "openai", "proportional"]);
    expect(asrPlan({}, { voiceTimestamps: false, whisper: false })).toEqual(["proportional"]);
    expect(asrPlan({ ASR_PROVIDER: "openai", OPENAI_API_KEY: "k" }, { voiceTimestamps: false, whisper: true })).toEqual(["openai", "proportional"]);
    expect(asrPlan({ ASR_PROVIDER: "none", OPENAI_API_KEY: "k" }, { voiceTimestamps: true, whisper: true })).toEqual(["voice", "proportional"]);
  });
  it("OpenAI transcription: multipart с таймингами слов", async () => {
    const { f, calls } = mockFetch(json({ words: [{ word: " Привет", start: 0.1, end: 0.5 }] }));
    const w = await transcribeOpenAI(Buffer.from("RIFF"), "ru", { env: { OPENAI_API_KEY: "k" }, fetch: f });
    expect(calls[0].url).toBe("https://api.openai.com/v1/audio/transcriptions");
    const fd = calls[0].init.body as FormData;
    expect(fd.get("model")).toBe("whisper-1");
    expect(fd.get("timestamp_granularities[]")).toBe("word");
    expect(fd.get("language")).toBe("ru");
    expect(w).toEqual([{ text: "Привет", start: 0.1, end: 0.5 }]);
  });
  it("символы → слова; перевод во время обработанной реплики", () => {
    expect(charsToWords([..." ab  c"], [0, 1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6])).toEqual([{ text: "ab", start: 1, end: 3 }, { text: "c", start: 5, end: 6 }]);
    // сырой старт речи 0.52 с, срезано до 20 мс, темп ×2, реплика после обработки длится 1 с
    const r = retime([{ text: "a", start: 0.52, end: 1 }, { text: "b", start: 1, end: 2.5 }], 2, 1)
      .map((w) => ({ ...w, start: +w.start.toFixed(3), end: +w.end.toFixed(3) }));
    expect(r).toEqual([{ text: "a", start: 0.01, end: 0.25 }, { text: "b", start: 0.25, end: 1 }]);
  });
});

describe("маскировка ключей", () => {
  it("значения ключей и похожие на ключи строки", () => {
    const env = { OPENAI_API_KEY: "sk-proj-SECRETSECRETSECRET", ELEVENLABS_API_KEY: "elevenSECRET" };
    const s = redact("a sk-proj-SECRETSECRETSECRET b elevenSECRET c sk-otherkeyotherkeyother d AIzaSyAAAAAAAAAAAAAAAAAAAAAA", env);
    expect(s).not.toMatch(/SECRET|otherkeyotherkey|AIzaSyAAAA/);
  });
});
