// Настройки пользователя из .env в корне репо (KEY=VALUE, как dotenv). Ключи провайдеров живут
// только там: .env в .gitignore, образец — .env.example. Переменные, уже заданные в окружении,
// не перезаписываются. Файл — $STUDIO_ENV_FILE, иначе <корень>/.env; STUDIO_DOTENV=0 — не читать.
// Settings from <repo>/.env (dotenv style). Existing environment variables win.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SECRET_VARS } from "./_http";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// KEY=VALUE построчно; «export KEY=…» тоже; '…' — как есть, "…" — с \n \t \" \\; без кавычек —
// до « #» (комментарий в конце строки).
export const parseDotenv = (src: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const raw of src.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (v.startsWith("'")) {
      const end = v.indexOf("'", 1);
      v = end > 0 ? v.slice(1, end) : v.slice(1);
    } else if (v.startsWith('"')) {
      let s = "";
      for (let i = 1; i < v.length && v[i] !== '"'; i++) {
        if (v[i] === "\\" && i + 1 < v.length) {
          const c = v[++i];
          s += c === "n" ? "\n" : c === "t" ? "\t" : c === "r" ? "\r" : c;
        } else s += v[i];
      }
      v = s;
    } else {
      const hash = v.search(/\s#/);
      v = (hash >= 0 ? v.slice(0, hash) : v).trim();
    }
    out[m[1]] = v;
  }
  return out;
};

// Загрузить файл в env (только отсутствующие ключи). Возвращает имена загруженных ключей.
export const loadDotenv = (file: string, env: NodeJS.ProcessEnv = process.env): string[] => {
  if (!existsSync(file)) return [];
  const vars = parseDotenv(readFileSync(file, "utf8"));
  const loaded: string[] = [];
  for (const [k, v] of Object.entries(vars)) {
    if (env[k] === undefined) { env[k] = v; loaded.push(k); }
  }
  return loaded;
};

export const ENV_FILE = process.env.STUDIO_ENV_FILE ?? join(ROOT_DIR, ".env");

// Ключи, пришедшие из .env (а не из окружения): make.ts не передаёт их директору — инструменты
// студии сами перечитают .env, а в окружении сессии Claude ключам делать нечего.
export const DOTENV_KEYS: string[] =
  process.env.STUDIO_DOTENV === "0" || process.env.VITEST ? [] : loadDotenv(ENV_FILE);

// Окружение режиссёра (claude -p или codex exec из make.ts): без ключей, пришедших из .env (инструменты студии
// перечитают .env сами), без похожих на ключи переменных из окружения оболочки (OPENAI_API_KEY,
// GITHUB_TOKEN… из ~/.zshrc — одна команда env, и ключ в контексте модели и в director.log),
// и без переменных родительской сессии Claude Code или Codex — при запуске из интерактивного
// claude/codex (скилл make-video) вложенный агент иначе считает себя частью чужой сессии
// (или песочницы: CODEX_SANDBOX*).
// Авторизация агентов (подписка, CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_*, Bedrock/Vertex; CODEX_HOME,
// CODEX_API_KEY) остаётся.
// Director env: drops .env keys, key-like shell variables and parent Claude Code session variables;
// keeps Claude Code's own auth.
const PARENT_SESSION = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_AGENT_SDK_VERSION|CLAUDE_CODE_(ENTRYPOINT|SESSION_\w+|CHILD_SESSION|MESSAGING_\w+|SSE_PORT|EXECPATH)|CODEX_SANDBOX\w*|CODEX_THREAD_ID)$/;
const KEY_LIKE = /(_API_KEY|_KEY|_TOKEN|_SECRET|PASSWORD|_PASS)$/i;
const CLAUDE_AUTH = /^(ANTHROPIC_\w+|CLAUDE_CODE_OAUTH_TOKEN|AWS_\w+|CLOUD_ML_REGION|VERTEX_\w+|GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_CLOUD_PROJECT|CODEX_API_KEY)$/;
export const isShellSecret = (k: string) => !CLAUDE_AUTH.test(k) && (SECRET_VARS.includes(k) || KEY_LIKE.test(k));
export const directorEnv = (env: NodeJS.ProcessEnv, dotenvKeys: string[]): Record<string, string> =>
  Object.fromEntries(Object.entries(env).filter((e): e is [string, string] =>
    e[1] !== undefined && !dotenvKeys.includes(e[0]) && !PARENT_SESSION.test(e[0]) && !isShellSecret(e[0])));
// Ключи провайдеров, заданные в окружении оболочки (а не в .env), — для предупреждения в make.ts.
export const shellSecrets = (env: NodeJS.ProcessEnv, dotenvKeys: string[]): string[] =>
  Object.keys(env).filter((k) => env[k] && !dotenvKeys.includes(k) && SECRET_VARS.includes(k));
