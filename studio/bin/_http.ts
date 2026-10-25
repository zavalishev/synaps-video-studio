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
  run?: (cmd: string, timeoutMs: number) => RunResult;
};
export type D = Required<Deps>;
export const deps = (d: Deps = {}): D => ({
  fetch: d.fetch ?? fetch,
  env: d.env ?? process.env,
  sleep: d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
  run: d.run ?? ((cmd, timeoutMs) => {
    const r = spawnSync("sh", ["-c", cmd], { timeout: timeoutMs, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
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
export const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

// ---------- ключи: никогда не печатать ----------
export const SECRET_VARS = ["OPENAI_API_KEY", "ELEVENLABS_API_KEY", "GEMINI_API_KEY"];
export const redact = (s: string, env: Env = process.env): string => {
  let out = s;
  for (const k of SECRET_VARS) { const v = env[k]; if (v && v.length >= 6) out = out.split(v).join("***"); }
  return out
    .replace(/\b(sk-[A-Za-z0-9]{0,4})[A-Za-z0-9_-]{12,}/g, "$1***")
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

// Шаблон команды: {имя} → значение в одинарных кавычках shell (текст и промпт — только файлами).
export const fill = (tpl: string, vars: Record<string, string>) =>
  tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? shq(vars[k]) : m));
export const runCommand = (what: string, cmd: string, d: D, timeoutMs: number) => {
  const r = d.run(cmd, timeoutMs);
  if (r.status !== 0) throw new ProviderError(`${what}: команда завершилась с кодом ${r.status}: ${redact(r.stderr.trim().split("\n").slice(-8).join("\n"), d.env)}`);
};
