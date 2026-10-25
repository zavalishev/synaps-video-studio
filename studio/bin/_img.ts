// Картинки через провайдера из .env: IMAGE_PROVIDER = openai | gemini | codex | command | none.
// codex — встроенная генерация картинок Codex CLI по подписке ChatGPT (без ключа API).
// Image generation providers configured in .env.
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { codexBin, codexHome, codexLogin } from "./_tools";
import { deps, fetchRetry, need, pick, ProviderError, ProviderNotConfigured, runCommand, short, templateProblem, tmp, type D, type Deps, type Env } from "./_http";

export type ImageConfig = {
  provider: string; model: string; ready: boolean; problem?: string;
  tag: string;            // входит в ключ кэша: другой провайдер/модель — другие картинки
  transparency: boolean;  // умеет прозрачный фон сам
  refs: boolean;          // принимает референсы (--ref)
  bgRemover: boolean;     // задан IMAGE_BG_COMMAND (убрать фон своей программой)
};
export type ImageOptions = { size?: string; quality?: string; background?: string };
export type ImageResult = { data: Buffer; notes: string[] };

export const IMAGE_PLACEHOLDERS = ["prompt_file", "out_png", "out", "size", "width", "height", "quality", "background", "refs"];
export const imageConfig = (env: Env = process.env): ImageConfig => {
  const p = (env.IMAGE_PROVIDER ?? "").trim().toLowerCase() || "none";
  const bgRemover = Boolean(env.IMAGE_BG_COMMAND?.trim());
  const off = { model: "", ready: false, transparency: false, refs: false, bgRemover };
  if (p === "openai") {
    const model = pick(env, "OPENAI_IMAGE_MODEL", "gpt-image-1");
    const ok = Boolean(env.OPENAI_API_KEY?.trim());
    const gptImage = /^gpt-image/.test(model);
    return { provider: p, model, ready: ok, problem: ok ? undefined : "нет OPENAI_API_KEY", tag: `openai:${model}`, transparency: gptImage, refs: gptImage, bgRemover };
  }
  if (p === "gemini") {
    const model = pick(env, "GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image");
    const ok = Boolean(env.GEMINI_API_KEY?.trim());
    return { provider: p, model, ready: ok, problem: ok ? undefined : "нет GEMINI_API_KEY", tag: `gemini:${model}`, transparency: false, refs: true, bgRemover };
  }
  if (p === "codex") {
    // Встроенный генератор Codex: прозрачность и референсы (-i) умеет, ключ не нужен — вход
    // codex login по подписке ChatGPT. Расход — лимит подписки, не деньги.
    const bin = codexBin(env);
    const problem = !bin ? "нет Codex CLI (npm i -g @openai/codex, затем codex login)" : !codexLogin(env) ? "Codex CLI не вошёл — выполните codex login" : undefined;
    return { provider: p, model: "codex image_gen", ready: !problem, problem, tag: "codex:image_gen", transparency: true, refs: true, bgRemover };
  }
  if (p === "command") {
    const tpl = env.IMAGE_COMMAND?.trim() ?? "";
    const bad = tpl ? templateProblem("IMAGE_COMMAND", tpl, IMAGE_PLACEHOLDERS) : "нет IMAGE_COMMAND";
    return { provider: p, model: "command", ready: !bad, problem: bad, tag: `command:${short(tpl)}`,
      transparency: env.IMAGE_COMMAND_TRANSPARENT === "1", refs: /\{refs\}/.test(tpl), bgRemover };
  }
  if (p === "none") return { provider: "none", ...off, problem: "картинки выключены (IMAGE_PROVIDER=none)", tag: "none" };
  return { provider: p, ...off, problem: `неизвестный IMAGE_PROVIDER=${p} (openai | gemini | codex | command | none)`, tag: p };
};

const SIZES: Record<string, [number, number]> = { "1024x1024": [1024, 1024], "1024x1536": [1024, 1536], "1536x1024": [1536, 1024] };
const ASPECT: Record<string, string> = { "1024x1024": "1:1", "1024x1536": "2:3", "1536x1024": "3:2" };
export const WHITE_BG = "\n\nIsolated subject on a plain, solid pure white (#FFFFFF) background, no scenery, no cast shadow on the background, generous empty margin around the subject.";
const timeout = (d: D) => Number(d.env.IMAGE_TIMEOUT_SEC || 600) * 1000;

const b64Of = (j: { data?: Array<{ b64_json?: string }> }, what: string) => {
  const b = j.data?.[0]?.b64_json;
  if (!b) throw new ProviderError(`${what}: в ответе нет картинки (data[0].b64_json)`);
  return Buffer.from(b, "base64");
};

// OpenAI: gpt-image-* (прозрачность, референсы через /images/edits) или dall-e-3/2 (без них).
const imageOpenAI = async (prompt: string, o: ImageOptions, refs: Buffer[], cfg: ImageConfig, d: D): Promise<ImageResult> => {
  const key = need(d.env, "OPENAI_API_KEY", "картинки OpenAI");
  const base = pick(d.env, "OPENAI_BASE_URL", "https://api.openai.com/v1").replace(/\/$/, "");
  const notes: string[] = [];
  const auth = { Authorization: `Bearer ${key}` };
  const http = { timeoutMs: timeout(d), tries: 3 };
  const size = o.size ?? "1024x1024", quality = o.quality ?? "medium", bg = o.background ?? "auto";
  if (/^gpt-image/.test(cfg.model)) {
    if (refs.length) {
      const fd = new FormData();
      for (const [k, v] of Object.entries({ model: cfg.model, prompt, size, quality, background: bg, n: "1" })) fd.append(k, v);
      refs.forEach((b, i) => fd.append("image[]", new Blob([new Uint8Array(b)], { type: "image/jpeg" }), `ref${i + 1}.jpg`));
      const res = await fetchRetry("картинки OpenAI (по референсам)", `${base}/images/edits`, { method: "POST", headers: auth, body: fd }, d, http);
      return { data: b64Of(await res.json(), "картинки OpenAI"), notes };
    }
    const body = { model: cfg.model, prompt, n: 1, size, quality, background: bg, output_format: "png" };
    const res = await fetchRetry("картинки OpenAI", `${base}/images/generations`, {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body) }, d, http);
    return { data: b64Of(await res.json(), "картинки OpenAI"), notes };
  }
  const dalleSize = cfg.model === "dall-e-3"
    ? ({ "1024x1536": "1024x1792", "1536x1024": "1792x1024" } as Record<string, string>)[size] ?? "1024x1024" : "1024x1024";
  if (refs.length) notes.push(`${cfg.model} не принимает референсы — --ref пропущен`);
  let p = prompt;
  if (bg === "transparent") { notes.push(`${cfg.model} не умеет прозрачный фон — попросил белый фон`); p += WHITE_BG; }
  const body: Record<string, unknown> = { model: cfg.model, prompt: p, n: 1, size: dalleSize, response_format: "b64_json" };
  if (cfg.model === "dall-e-3") body.quality = quality === "high" ? "hd" : "standard";
  const res = await fetchRetry("картинки OpenAI", `${base}/images/generations`, {
    method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body) }, d, http);
  return { data: b64Of(await res.json(), "картинки OpenAI"), notes };
};

// Google Gemini (Generative Language API, generateContent с IMAGE в responseModalities).
// Ограничения: прозрачности нет (для вырезок просим белый фон — дальше IMAGE_BG_COMMAND),
// размер задаётся только соотношением сторон, --quality не влияет.
const imageGemini = async (prompt: string, o: ImageOptions, refs: Buffer[], cfg: ImageConfig, d: D): Promise<ImageResult> => {
  const key = need(d.env, "GEMINI_API_KEY", "картинки Gemini");
  const base = pick(d.env, "GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  const notes: string[] = [];
  let p = prompt;
  if (o.background === "transparent") { p += WHITE_BG; notes.push("Gemini не умеет прозрачный фон — попросил белый фон"); }
  const aspect = ASPECT[o.size ?? ""];
  const parts: unknown[] = [...refs.map((b) => ({ inline_data: { mime_type: "image/jpeg", data: b.toString("base64") } })), { text: p }];
  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"], ...(aspect ? { imageConfig: { aspectRatio: aspect } } : {}) },
  };
  const res = await fetchRetry("картинки Gemini", `${base}/models/${encodeURIComponent(cfg.model)}:generateContent`, {
    method: "POST", headers: { "x-goog-api-key": key, "Content-Type": "application/json" }, body: JSON.stringify(body),
  }, d, { timeoutMs: timeout(d), tries: 3 });
  type Part = { text?: string; inlineData?: { data: string }; inline_data?: { data: string } };
  const j = await res.json() as { candidates?: Array<{ content?: { parts?: Part[] }; finishReason?: string }>; promptFeedback?: { blockReason?: string } };
  const cand = j.candidates?.[0];
  const img = cand?.content?.parts?.find((x) => x.inlineData?.data || x.inline_data?.data);
  if (!img) {
    const text = cand?.content?.parts?.map((x) => x.text).filter(Boolean).join(" ").slice(0, 300);
    throw new ProviderError(`картинки Gemini: картинки нет в ответе (${j.promptFeedback?.blockReason ?? cand?.finishReason ?? "причина не указана"})${text ? `: ${text}` : ""}`);
  }
  return { data: Buffer.from((img.inlineData ?? img.inline_data)!.data, "base64"), notes };
};

// Codex CLI: одна сессия codex exec без песочницы на запись (read-only) просит встроенный
// генератор сделать одну картинку; файл Codex сам кладёт в $CODEX_HOME/generated_images/<сессия>/.
// Промпт идёт файлом через stdin, референсы — -i, пути — через окружение (шаблон команды).
export const codexImagePrompt = (prompt: string, o: ImageOptions, nRefs: number) => {
  const size = o.size && o.size !== "auto" ? o.size : null;
  const [w, h] = size ? (SIZES[size] ?? size.split("x").map(Number)) : [0, 0];
  const orient = size ? (w > h ? "landscape" : w < h ? "portrait" : "square") : null;
  const bg = o.background === "transparent" ? "transparent (real alpha channel), isolated subject with clean edges"
    : o.background === "opaque" ? "opaque, the scene fills the whole frame" : null;
  return [
    "Generate exactly one image with your built-in image generation tool, then stop.",
    "Do not read files, do not run shell commands, do not copy, move or describe the result: the image is collected automatically.",
    nRefs ? `Use the ${nRefs} attached image${nRefs > 1 ? "s" : ""} as visual reference (same character, object or style), not as content to copy verbatim.` : "",
    size ? `Size: ${size} (${orient}).` : "",
    bg ? `Background: ${bg}.` : "",
    o.quality ? `Quality: ${o.quality}.` : "",
    "Image prompt:",
    prompt,
  ].filter(Boolean).join("\n");
};
const imageCodex = async (prompt: string, o: ImageOptions, refs: Buffer[], _cfg: ImageConfig, d: D): Promise<ImageResult> => {
  const bin = codexBin(d.env);
  if (!bin) throw new ProviderNotConfigured("картинки Codex: нет Codex CLI (npm i -g @openai/codex, затем codex login)");
  const dir = tmp("studio-codex-img-");
  try {
    const pf = join(dir, "prompt.txt"), events = join(dir, "events.jsonl");
    writeFileSync(pf, codexImagePrompt(prompt, o, refs.length));
    const vars: Record<string, string> = { bin, dir, prompt_file: pf, events };
    const refArgs = refs.map((b, i) => { const k = `ref${i + 1}`; vars[k] = join(dir, `${k}.jpg`); writeFileSync(vars[k], b); return `-i {${k}}`; }).join(" ");
    const tpl = `{bin} exec --json --ephemeral --skip-git-repo-check --ignore-user-config -c 'notify=[]' -s read-only -C {dir} ${refArgs} - < {prompt_file} > {events}`;
    runCommand("картинки Codex", tpl, vars, d, timeout(d));
    const lines = existsSync(events) ? readFileSync(events, "utf8").split("\n").filter((l) => l.startsWith("{")) : [];
    let thread = "", said = "", failed = "";
    for (const l of lines) {
      try {
        const ev = JSON.parse(l) as { type?: string; thread_id?: string; item?: { type?: string; text?: string }; error?: { message?: string }; message?: string };
        if (ev.type === "thread.started") thread = ev.thread_id ?? "";
        if (ev.type === "item.completed" && ev.item?.type === "agent_message" && ev.item.text?.trim()) said = ev.item.text.trim();
        if (ev.type === "turn.failed" || ev.type === "error") failed = ev.error?.message ?? ev.message ?? "ошибка";
      } catch { /* не JSON */ }
    }
    const out = thread ? join(codexHome(d.env), "generated_images", thread) : "";
    const files = out && existsSync(out) ? readdirSync(out).filter((f) => /\.png$/i.test(f)).map((f) => join(out, f)).sort((x, y) => statSync(y).mtimeMs - statSync(x).mtimeMs) : [];
    if (!files.length) throw new ProviderError(`картинки Codex: картинки нет${failed ? ` (${failed})` : ""}${said ? `: ${said.slice(0, 300)}` : ""}`);
    return { data: readFileSync(files[0]), notes: files.length > 1 ? [`Codex сделал ${files.length} картинок — взята последняя`] : [] };
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

// Своя программа: IMAGE_COMMAND с подстановками {prompt_file} {out_png} (= {out}) {size}
// {width} {height} {quality} {background} {refs} (пути референсов JPEG через запятую).
const imageCommand = async (prompt: string, o: ImageOptions, refs: Buffer[], cfg: ImageConfig, d: D): Promise<ImageResult> => {
  const tpl = need(d.env, "IMAGE_COMMAND", "картинки (command)");
  const dir = tmp("studio-img-");
  try {
    const pf = join(dir, "prompt.txt"), out = join(dir, "out.png");
    writeFileSync(pf, prompt);
    const refFiles = refs.map((b, i) => { const f = join(dir, `ref${i + 1}.jpg`); writeFileSync(f, b); return f; });
    const [w, h] = SIZES[o.size ?? ""] ?? [1024, 1024];
    runCommand("картинки (IMAGE_COMMAND)", tpl, { prompt_file: pf, out_png: out, out, size: o.size ?? "1024x1024", width: String(w), height: String(h),
      quality: o.quality ?? "medium", background: o.background ?? "auto", refs: refFiles.join(",") }, d, timeout(d));
    if (!existsSync(out) || statSync(out).size === 0) throw new ProviderError("картинки (IMAGE_COMMAND): команда не записала картинку в {out_png}");
    const notes = refs.length && !cfg.refs ? ["в IMAGE_COMMAND нет {refs} — референсы не переданы"] : [];
    return { data: readFileSync(out), notes };
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

// Убрать фон своей программой: IMAGE_BG_COMMAND с {in_png} {out_png}, например
// «rembg i {in_png} {out_png}» (pip install "rembg[cli]") — для провайдеров без прозрачности.
export const removeBackground = async (png: Buffer, dep: Deps = {}): Promise<Buffer> => {
  const d = deps(dep);
  const tpl = need(d.env, "IMAGE_BG_COMMAND", "удаление фона");
  const dir = tmp("studio-bg-");
  try {
    const inp = join(dir, "in.png"), out = join(dir, "out.png");
    writeFileSync(inp, png);
    runCommand("удаление фона (IMAGE_BG_COMMAND)", tpl, { in_png: inp, out_png: out }, d, 300_000);
    if (!existsSync(out) || statSync(out).size === 0) throw new ProviderError("удаление фона: команда не записала {out_png}");
    return readFileSync(out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

// Картинка по промпту. refs — уменьшенные JPEG-референсы (лист персонажа, стиль).
// notes — что провайдер сделал не так, как просили (печатаются инструментом).
export const image = async (prompt: string, o: ImageOptions = {}, refs: Buffer[] = [], dep: Deps = {}): Promise<ImageResult> => {
  const d = deps(dep);
  const cfg = imageConfig(d.env);
  if (!cfg.ready) throw new ProviderNotConfigured(`картинки: ${cfg.problem}`);
  const r = cfg.provider === "openai" ? await imageOpenAI(prompt, o, refs, cfg, d)
    : cfg.provider === "gemini" ? await imageGemini(prompt, o, refs, cfg, d)
    : cfg.provider === "codex" ? await imageCodex(prompt, o, refs, cfg, d)
    : await imageCommand(prompt, o, refs, cfg, d);
  if (o.background === "transparent" && !cfg.transparency) {
    // Без IMAGE_BG_COMMAND прозрачности не будет — studio image измерит альфу и предупредит.
    if (cfg.bgRemover) { r.data = await removeBackground(r.data, dep); r.notes.push("фон убран программой IMAGE_BG_COMMAND"); }
  }
  return r;
};
