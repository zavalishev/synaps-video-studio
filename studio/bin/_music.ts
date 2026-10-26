// Своя музыка под ролик через провайдера из .env: MUSIC_PROVIDER = elevenlabs | command | none.
//   elevenlabs — ElevenLabs Music (POST /v1/music, ключ ELEVENLABS_API_KEY; на платных тарифах
//                разрешена коммерческая публикация). Кредиты общие с озвучкой: ~14 кредитов
//                за секунду музыки — трек на 30 с ≈ 400.
//   command    — своя программа: MUSIC_COMMAND с подстановками {prompt_file} {plan_file}
//                {out_mp3} (= {out}) {seconds}. Описание и план — только файлами.
// Выключено (none) — музыка только из каталога (studio music).
// Generated music for a video. Configure in .env; check with `studio doctor`.
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deps, fetchRetry, need, pick, ProviderError, ProviderNotConfigured, runCommand, short, templateProblem, tmp, type D, type Deps, type Env } from "./_http";

export type MusicConfig = { provider: string; model: string; ready: boolean; problem?: string; tag: string; plan: boolean };
export const MUSIC_PLACEHOLDERS = ["prompt_file", "plan_file", "out_mp3", "out", "seconds"];
export const MUSIC_MIN_SEC = 5, MUSIC_MAX_SEC = 180;

// План трека по секциям (схема music_v1): крючок, развитие, кульминация, финал — каждая со
// своей длиной, чтобы подъём лёг на нужную секунду ролика. Слова (lines) не поддерживаем:
// под речью диктора песня со словами мешает.
export type MusicSection = { name: string; styles: string[]; avoid?: string[]; sec: number };
export type MusicPlan = { styles: string[]; avoid?: string[]; sections: MusicSection[] };
export type MusicRequest = { prompt?: string; seconds?: number; plan?: MusicPlan };
export type MusicResult = { audio: Buffer; seconds: number };

export const musicConfig = (env: Env = process.env): MusicConfig => {
  const p = (env.MUSIC_PROVIDER ?? "").trim().toLowerCase() || "none";
  if (p === "elevenlabs") {
    const model = pick(env, "ELEVENLABS_MUSIC_MODEL", "music_v1");
    const ok = Boolean(env.ELEVENLABS_API_KEY?.trim());
    return { provider: p, model, ready: ok, problem: ok ? undefined : "нет ELEVENLABS_API_KEY", tag: `elevenlabs:${model}`, plan: model === "music_v1" };
  }
  if (p === "command") {
    const tpl = env.MUSIC_COMMAND?.trim() ?? "";
    const bad = tpl ? templateProblem("MUSIC_COMMAND", tpl, MUSIC_PLACEHOLDERS) : "нет MUSIC_COMMAND";
    return { provider: p, model: "command", ready: !bad, problem: bad, tag: `command:${short(tpl)}`, plan: /\{plan_file\}/.test(tpl) };
  }
  const off = { model: "", ready: false, plan: false };
  if (p === "none") return { provider: "none", ...off, problem: "генерация музыки выключена (MUSIC_PROVIDER=none)", tag: "none" };
  return { provider: p, ...off, problem: `неизвестный MUSIC_PROVIDER=${p} (elevenlabs | command | none)`, tag: p };
};

const clean = (s: unknown, max: number) => String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const list = (v: unknown, what: string): string[] => {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new ProviderError(`музыка: ${what} — список строк`);
  return v.map((x) => clean(x, 120)).filter(Boolean).slice(0, 12);
};

// Проверка и нормализация плана: 1–8 секций по 3–120 с, сумма — в пределах длины трека.
export const checkPlan = (raw: unknown): MusicPlan => {
  const p = raw as Partial<MusicPlan> | null;
  if (!p || typeof p !== "object" || !Array.isArray(p.sections)) throw new ProviderError("музыка: план — {styles, avoid?, sections: [{name, styles, avoid?, sec}]}");
  if (p.sections.length < 1 || p.sections.length > 8) throw new ProviderError("музыка: в плане 1–8 секций");
  const styles = list(p.styles, "styles");
  if (!styles.length) throw new ProviderError("музыка: план без styles (жанр, инструменты, настроение, темп)");
  const sections = p.sections.map((s, i) => {
    const sec = Number(s?.sec);
    if (!Number.isFinite(sec) || sec < 3 || sec > 120) throw new ProviderError(`музыка: секция ${i + 1}: sec от 3 до 120`);
    const name = clean(s?.name, 60) || `part ${i + 1}`;
    return { name, styles: list(s?.styles, `styles секции ${i + 1}`), avoid: list(s?.avoid, `avoid секции ${i + 1}`), sec: Math.round(sec * 10) / 10 };
  });
  const total = sections.reduce((t, s) => t + s.sec, 0);
  if (total < MUSIC_MIN_SEC || total > MUSIC_MAX_SEC) throw new ProviderError(`музыка: сумма секций ${total.toFixed(1)} с — нужно ${MUSIC_MIN_SEC}–${MUSIC_MAX_SEC}`);
  return { styles, avoid: list(p.avoid, "avoid"), sections };
};
export const planSeconds = (p: MusicPlan) => p.sections.reduce((t, s) => t + s.sec, 0);

const checkRequest = (req: MusicRequest): { prompt: string; plan?: MusicPlan; seconds: number } => {
  const plan = req.plan ? checkPlan(req.plan) : undefined;
  const prompt = clean(req.prompt, 1000);
  if (!plan && prompt.length < 3) throw new ProviderError("музыка: нужно описание трека (--make \"…\") или план (--plan)");
  const seconds = plan ? planSeconds(plan) : Number(req.seconds);
  if (!Number.isFinite(seconds) || seconds < MUSIC_MIN_SEC || seconds > MUSIC_MAX_SEC) throw new ProviderError(`музыка: длина от ${MUSIC_MIN_SEC} до ${MUSIC_MAX_SEC} с (--sec)`);
  return { prompt, plan, seconds };
};

const musicElevenLabs = async (r: ReturnType<typeof checkRequest>, cfg: MusicConfig, d: D): Promise<Buffer> => {
  const key = need(d.env, "ELEVENLABS_API_KEY", "музыка ElevenLabs");
  const base = pick(d.env, "ELEVENLABS_BASE_URL", "https://api.elevenlabs.io/v1").replace(/\/$/, "");
  const body: Record<string, unknown> = { model_id: cfg.model };
  if (r.plan && cfg.plan) {
    body.composition_plan = {
      positive_global_styles: r.plan.styles, negative_global_styles: [...(r.plan.avoid ?? []), "vocals", "lyrics"],
      sections: r.plan.sections.map((s) => ({ section_name: s.name, positive_local_styles: s.styles, negative_local_styles: s.avoid ?? [],
        duration_ms: Math.round(s.sec * 1000), lines: [] })),
    };
    body.respect_sections_durations = true;
  } else {
    // План не поддержан моделью — та же музыка одной строкой: стили и секции словами.
    body.prompt = r.plan ? planToPrompt(r.plan, r.prompt) : r.prompt;
    body.music_length_ms = Math.round(r.seconds * 1000);
    body.force_instrumental = true;
  }
  const res = await fetchRetry("музыка ElevenLabs", `${base}/music?output_format=${pick(d.env, "ELEVENLABS_MUSIC_FORMAT", "mp3_44100_128")}`, {
    method: "POST", headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" }, body: JSON.stringify(body),
  }, d, { timeoutMs: 300_000, tries: 3 });
  return Buffer.from(await res.arrayBuffer());
};

export const planToPrompt = (p: MusicPlan, prompt = "") => {
  let t = 0;
  const parts = p.sections.map((s) => { const a = t; t += s.sec; return `${a.toFixed(0)}–${t.toFixed(0)} s ${s.name}: ${s.styles.join(", ")}`; });
  return [prompt, `Style: ${p.styles.join(", ")}.`, p.avoid?.length ? `Avoid: ${p.avoid.join(", ")}.` : "", `Structure: ${parts.join("; ")}.`, "Instrumental, no vocals."]
    .filter(Boolean).join(" ");
};

const musicCommand = (r: ReturnType<typeof checkRequest>, cfg: MusicConfig, d: D): Buffer => {
  const tpl = need(d.env, "MUSIC_COMMAND", "музыка (command)");
  const dir = tmp("studio-music-");
  try {
    const promptFile = join(dir, "prompt.txt"), planFile = join(dir, "plan.json"), out = join(dir, "out.mp3");
    writeFileSync(promptFile, r.plan && !cfg.plan ? planToPrompt(r.plan, r.prompt) : r.prompt);
    writeFileSync(planFile, r.plan ? JSON.stringify(r.plan) : "");
    runCommand("музыка (MUSIC_COMMAND)", tpl, { prompt_file: promptFile, plan_file: planFile, out_mp3: out, out, seconds: r.seconds.toFixed(1) },
      d, Number(d.env.MUSIC_COMMAND_TIMEOUT_SEC || 600) * 1000);
    if (!existsSync(out) || statSync(out).size === 0) throw new ProviderError("музыка (MUSIC_COMMAND): команда не записала трек в {out_mp3}");
    return readFileSync(out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

// Ключ кэша: тот же провайдер, описание, план и длина — тот же трек (повтор бесплатно).
export const musicKey = (req: MusicRequest, env: Env = process.env) => {
  const r = checkRequest(req);
  return short(JSON.stringify([musicConfig(env).tag, r.prompt, r.plan ?? null, r.seconds]));
};

export const music = async (req: MusicRequest, dep: Deps = {}): Promise<MusicResult> => {
  const d = deps(dep);
  const cfg = musicConfig(d.env);
  if (!cfg.ready) throw new ProviderNotConfigured(`музыка: ${cfg.problem}`);
  const r = checkRequest(req);
  const audio = cfg.provider === "elevenlabs" ? await musicElevenLabs(r, cfg, d) : musicCommand(r, cfg, d);
  if (audio.length < 2000) throw new ProviderError("музыка: провайдер вернул пустой трек");
  return { audio, seconds: r.seconds };
};
