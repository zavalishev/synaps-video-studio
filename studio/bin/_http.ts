// Общее для провайдеров (_tts.ts, _img.ts, _asr.ts): ошибки, HTTP с повторами и паузой,
// маскировка ключей, запуск своей программы по шаблону команды. Ключи никогда не печатаются.
// Shared provider plumbing: errors, HTTP with retries/backoff, key redaction, command templates.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Env = Record<string, string | undefined>;
export type RunResult = { status: number | null; stderr: string };
export type Deps = {
  fetch?: typeof fetch;
  env?: Env;
  sleep?: (ms: number) => Promise<void>;
  run?: (cmd: string, timeoutMs: number, env?: Env) => RunResult;
};
export type D = Required<Deps>;
export const deps = (d: Deps = {}): D => ({
  fetch: d.fetch ?? fetch,
  env: d.env ?? process.env,
  sleep: d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
  run: d.run ?? ((cmd, timeoutMs, env) => {
    const r = spawnSync("sh", ["-c", cmd], { timeout: timeoutMs, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env } });
    return { status: r.status, stderr: (r.stderr ?? "") + (r.error ? String(r.error.message) : "") };
  }),
});

export class ProviderNotConfigured extends Error {
  constructor(msg: string) { super(msg); this.name = "ProviderNotConfigured"; }
}
export class ProviderError extends Error {
  constructor(msg: string, readonly status?: number, readonly retryable = false) { super(msg); this.name = "ProviderError"; }
}

export const short = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 10);

// ---------- ключи: никогда не печатать ----------
export const SECRET_VARS = ["OPENAI_API_KEY", "ELEVENLABS_API_KEY", "GEMINI_API_KEY"];
// Любая переменная с таким именем считается секретом (токены своих программ: Kimi, Fish, Replicate…).
export const SECRET_NAME = /KEY|TOKEN|SECRET|PASS|AUTH/i;
export const redact = (s: string, env: Env = process.env): string => {
  let out = s;
  const vals = new Set<string>();
  for (const k of SECRET_VARS) { const v = env[k]; if (v) vals.add(v); }
  for (const [k, v] of Object.entries(env)) if (v && SECRET_NAME.test(k)) vals.add(v);
  // длинные — первыми, чтобы ключ-подстрока другого ключа не оставил хвост
  for (const v of [...vals].filter((x) => x.length >= 6).sort((x, y) => y.length - x.length)) out = out.split(v).join("***");
  return out
    .replace(/\b(Bearer)\s+[^\s"',;]+/gi, "$1 ***")
    .replace(/\b(xi-api-key|x-api-key|api-key|authorization)(["']?\s*[:=]\s*["']?)[^\s"',;]+/gi, "$1$2***")
    .replace(/\b(sk-[A-Za-z0-9]{0,4})[A-Za-z0-9_-]{12,}/g, "$1***")
    .replace(/\bsk_[A-Za-z0-9]{20,}/g, "sk_***")
    .replace(/\bhf_[A-Za-z0-9]{20,}/g, "hf_***")
    .replace(/\br8_[A-Za-z0-9]{20,}/g, "r8_***")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "AIza***");
};

// ---------- HTTP с повторами ----------
const RETRY_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const hint = (status: number, body: string) =>
  status === 401 ? "ключ не принят — проверьте ключ в .env" :
  status === 403 ? "доступ запрещён — у ключа нет прав на эту модель или регион" :
  status === 404 ? "не найдено — проверьте имя модели / голоса в .env" :
  status === 429 && /quota|billing|credits/i.test(body) ? "закончилась квота или баланс у провайдера" :
  status === 429 ? "лимит запросов" :
  status >= 500 ? "сбой на стороне провайдера" : "";
const noRetryBody = (body: string) => /insufficient_quota|billing|quota_exceeded|credits/i.test(body);

export type HttpOpts = { timeoutMs?: number; tries?: number };
// Повторы на сеть, 408/409/425/429/5xx: пауза 1 с, 3 с, 9 с… (не больше 30 с) или Retry-After.
// 401/403/404/400 и «кончилась квота» — сразу ошибка с подсказкой.
export const fetchRetry = async (what: string, url: string, init: RequestInit, d: D, o: HttpOpts = {}): Promise<Response> => {
  const tries = o.tries ?? 4;
  const timeoutMs = o.timeoutMs ?? 180_000;
  let last: ProviderError | null = null;
  let wait = 0;
  for (let i = 0; i < tries; i++) {
    if (i > 0) await d.sleep(wait || Math.min(30_000, 1000 * 3 ** (i - 1)));
    wait = 0;
    let res: Response;
    try {
      res = await d.fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      const m = (e as Error)?.name === "TimeoutError" ? `нет ответа за ${Math.round(timeoutMs / 1000)} с` : String((e as Error)?.message ?? e);
      last = new ProviderError(`${what}: сеть — ${redact(m, d.env)}`, undefined, true);
      continue;
    }
    if (res.ok) return res;
    const body = redact((await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 500), d.env);
    const retryable = RETRY_STATUS.has(res.status) && !noRetryBody(body);
    const h = hint(res.status, body);
    last = new ProviderError(`${what}: HTTP ${res.status}${h ? ` (${h})` : ""}: ${body}`, res.status, retryable);
    if (!retryable) throw last;
    const ra = Number(res.headers.get("retry-after"));
    if (Number.isFinite(ra) && ra > 0) wait = Math.min(60_000, ra * 1000);
  }
  throw last ?? new ProviderError(`${what}: не удалось`);
};

export const need = (env: Env, key: string, what: string) => {
  const v = env[key]?.trim();
  if (!v) throw new ProviderNotConfigured(`${what}: нет ${key} в .env (см. .env.example, studio doctor)`);
  return v;
};
export const pick = (env: Env, key: string, def: string) => env[key]?.trim() || def;
export const tmp = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));

// Шаблон команды: {имя} → "${STUDIO_CMD_ИМЯ}", а сами значения идут в окружение программы.
// Раскрытие переменной shell не разбирает повторно, поэтому никакое значение ({voice} от
// режиссёра, путь с пробелом или кавычкой) не может стать командой. Текст и промпт — только файлами.
// Плейсхолдер в кавычках ('{voice}' или "{voice}") — ошибка: подстановка кавычит сама.
// Command template: {name} → "${STUDIO_CMD_NAME}", values travel as env vars (never re-parsed by sh).
export const cmdVar = (k: string) => `STUDIO_CMD_${k.toUpperCase()}`;
export const quotedPlaceholders = (tpl: string, names: Iterable<string>): string[] => {
  const known = new Set(names);
  const bad: string[] = [];
  let q: "'" | '"' | null = null;
  for (let i = 0; i < tpl.length; i++) {
    const c = tpl[i];
    if (q !== "'" && c === "\\") { i++; continue; }
    if (q === null && (c === "'" || c === '"')) { q = c; continue; }
    if (q !== null && c === q) { q = null; continue; }
    if (q !== null && c === "{") {
      const m = tpl.slice(i).match(/^\{(\w+)\}/);
      if (m && known.has(m[1])) bad.push(m[0]);
    }
  }
  return [...new Set(bad)];
};
// Проблема шаблона для studio doctor / voiceConfig: плейсхолдеры в кавычках.
export const templateProblem = (key: string, tpl: string, names: string[]): string | undefined => {
  const bad = quotedPlaceholders(tpl, names);
  return bad.length ? `в ${key} уберите кавычки вокруг ${bad.join(" ")} (значение подставляется уже закавыченным)` : undefined;
};
export const fill = (tpl: string, vars: Record<string, string>): { cmd: string; env: Env } => {
  const bad = quotedPlaceholders(tpl, Object.keys(vars));
  if (bad.length) throw new ProviderNotConfigured(`шаблон команды: уберите кавычки вокруг ${bad.join(" ")} — значение подставляется уже закавыченным (см. .env.example)`);
  const env: Env = {};
  const cmd = tpl.replace(/\{(\w+)\}/g, (m, k: string) => {
    if (!(k in vars)) return m;
    env[cmdVar(k)] = vars[k];
    return `"\${${cmdVar(k)}}"`;
  });
  return { cmd, env };
};
export const runCommand = (what: string, tpl: string, vars: Record<string, string>, d: D, timeoutMs: number) => {
  const { cmd, env } = fill(tpl, vars);
  const r = d.run(cmd, timeoutMs, env);
  if (r.status !== 0) throw new ProviderError(`${what}: команда завершилась с кодом ${r.status}: ${redact(r.stderr.trim().split("\n").slice(-8).join("\n"), d.env)}`);
};
