// Агент-режиссёр для запуска без окна (make.ts): Claude Code или Codex — по подписке пользователя.
//   --agent claude|codex  >  STUDIO_AGENT в .env  >  auto (какой установлен; оба — Claude Code).
// Каждый агент — свой набор аргументов и свой разбор потока событий в общий вид (инструмент,
// текст, итог), чтобы make.ts, журнал director.log и бюджет не зависели от агента.
// Director agent for headless runs: Claude Code or Codex CLI, each on the user's own subscription.
import { dirname, join } from "node:path";
import { claudeBin, codexBin, codexHome, codexLogin } from "./_tools";

export type AgentName = "claude" | "codex";
export const AGENTS: AgentName[] = ["claude", "codex"];

// Итог сессии в общем виде. costUsd — только у Claude Code (он считает цену по API);
// у Codex цены в потоке нет: на подписке это расход лимита, поэтому — токены.
export type Usage = { input: number; cached: number; output: number };
export type Res = { is_error?: boolean; total_cost_usd?: number; num_turns?: number; duration_api_ms?: number; session_id?: string; result?: string; modelUsage?: Record<string, Record<string, number>>; usage?: Usage };
export type Ev =
  | { kind: "init"; tools: string[] | null }
  | { kind: "tool"; name: string; what: string }
  | { kind: "text"; text: string }
  | { kind: "result"; res: Res };

export type RunOpts = { prompt: string; dir: string; studio: string; model?: string; effort?: string; maxUsd: number; tools: string[]; envFile: string; root: string };

export type Agent = {
  name: AgentName;
  auth: RegExp;               // переменные входа этого агента — только они переходят в окружение режиссёра
  bin: string;
  title: string;              // для людей: «Claude Code», «Codex CLI»
  costInUsd: boolean;         // поток событий несёт цену (Claude) или только токены (Codex)
  subagents: boolean;         // есть ли инструмент субагента для критика со свежим взглядом
  args: (o: RunOpts) => string[];
  stdin: (o: RunOpts) => string | null; // промпт через stdin (Codex) или аргументом (Claude)
  env: (base: NodeJS.ProcessEnv, o: RunOpts) => NodeJS.ProcessEnv;
  parser: () => (line: string) => Ev[]; // новый разборщик на каждый запуск (у Codex есть состояние)
};

const install: Record<AgentName, string> = {
  claude: "Claude Code CLI — https://claude.com/claude-code (или CLAUDE_BIN в .env)",
  codex: "Codex CLI — npm i -g @openai/codex, затем codex login (или CODEX_BIN в .env)",
};

// ---------- Claude Code ----------
// Вход каждого агента — только ему: режиссёр Codex не получает ключей Anthropic/AWS, Claude — Codex.
export const CLAUDE_AUTH = /^(ANTHROPIC_\w+|CLAUDE_CODE_OAUTH_TOKEN|AWS_\w+|CLOUD_ML_REGION|VERTEX_\w+|GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_CLOUD_PROJECT)$/;
export const CODEX_AUTH = /^(CODEX_API_KEY|CODEX_ACCESS_TOKEN)$/;

const claude = (bin: string): Agent => ({
  name: "claude", auth: CLAUDE_AUTH, bin, title: "Claude Code", costInUsd: true, subagents: true,
  args: (o) => [
    "-p", o.prompt,
    "--output-format", "stream-json", "--verbose",
    "--permission-mode", "acceptEdits",
    "--tools", o.tools.join(","),
    "--allowedTools", ...o.tools, "Agent",
    "--disable-slash-commands",
    "--exclude-dynamic-system-prompt-sections",
    // Директор видит только руководство студии: без личного ~/.claude/CLAUDE.md, хуков и MCP-серверов
    // владельца (там правила для разработки, например «git checkout основной ветки» — в ролике это
    // переключило бы ветку репо посреди прогона). git директору не нужен вовсе.
    "--setting-sources", "project,local",
    "--strict-mcp-config",
    // .env с ключами провайдеров директору не нужен: инструменты студии читают его сами.
    // Это запрет инструментов Read/Edit/Write, а не песочница: Bash остаётся с правами пользователя
    // (см. README «Безопасность»). Студию (studio/: руководство, скиллы, инструменты) директор
    // не правит — иначе одна неудачная или подсказанная брифом правка ушла бы во все следующие ролики.
    "--disallowedTools", "Bash(git:*)", "Bash(git *)",
    `Read(/${o.envFile})`, `Edit(/${o.envFile})`, `Write(/${o.envFile})`,
    `Read(/${join(o.root, ".env")}.*)`, `Edit(/${join(o.root, ".env")}*)`, `Write(/${join(o.root, ".env")}*)`,
    `Edit(/${o.studio}/**)`, `Write(/${o.studio}/**)`,
    "--add-dir", o.studio,
    ...(o.model ? ["--model", o.model] : []),
    ...(o.effort ? ["--effort", o.effort] : []),
    "--max-budget-usd", o.maxUsd.toFixed(2),
  ],
  stdin: () => null,
  env: (base) => base,
  parser: () => (line) => {
    const ev = JSON.parse(line);
    const out: Ev[] = [];
    if (ev.type === "system" && ev.subtype === "init") out.push({ kind: "init", tools: ev.tools ?? null });
    if (ev.type === "result") out.push({ kind: "result", res: ev });
    if (ev.type === "assistant" && !ev.parent_tool_use_id) {
      for (const c of ev.message?.content ?? []) {
        if (c.type === "tool_use") out.push({ kind: "tool", name: c.name, what: String(c.name === "Bash" ? c.input?.command : c.input?.file_path ?? c.input?.description ?? c.input?.pattern ?? "") });
        else if (c.type === "text" && c.text?.trim()) out.push({ kind: "text", text: c.text });
      }
    }
    return out;
  },
});

// ---------- Codex CLI ----------
// «/bin/zsh -lc 'команда'» → «команда» (для строки прогресса).
export const codexCommand = (cmd: string) => {
  const m = cmd.match(/^\S*\/(?:ba|z)?sh -l?c '([\s\S]*)'$/);
  return m ? m[1].replace(/'\\''/g, "'") : cmd;
};

type CodexItem = { id?: string; type?: string; text?: string; command?: string; changes?: Array<{ path?: string }>; tool?: string; server?: string; path?: string; prompt?: string; [k: string]: unknown };
export const codexParser = () => {
  let thread = "", last = "", tools = 0;
  const t0 = Date.now();
  return (line: string): Ev[] => {
    const ev = JSON.parse(line) as { type?: string; thread_id?: string; item?: CodexItem; usage?: Record<string, number>; error?: { message?: string }; message?: string };
    const out: Ev[] = [];
    if (ev.type === "thread.started") { thread = ev.thread_id ?? ""; out.push({ kind: "init", tools: null }); }
    const it = ev.item;
    if (ev.type === "item.started" && it) {
      // Инструмент — в момент начала (как у Claude: tool_use до результата).
      if (it.type === "command_execution") { tools++; out.push({ kind: "tool", name: "Bash", what: codexCommand(String(it.command ?? "")) }); }
      else if (it.type && !["agent_message", "reasoning", "file_change", "todo_list", "error"].includes(it.type)) {
        tools++;
        out.push({ kind: "tool", name: String(it.tool ?? it.type), what: String(it.path ?? it.prompt ?? it.server ?? "") });
      }
    }
    if (ev.type === "item.completed" && it) {
      if (it.type === "agent_message" && it.text?.trim()) { last = it.text; out.push({ kind: "text", text: it.text }); }
      // Правки файлов у Codex приходят одним событием по завершении.
      if (it.type === "file_change") { tools++; out.push({ kind: "tool", name: "Edit", what: (it.changes ?? []).map((c) => c.path).filter(Boolean).join(", ") }); }
    }
    if (ev.type === "turn.completed") {
      const u = ev.usage ?? {};
      out.push({ kind: "result", res: { is_error: false, session_id: thread, result: last, num_turns: tools, duration_api_ms: Date.now() - t0,
        usage: { input: Number(u.input_tokens ?? 0), cached: Number(u.cached_input_tokens ?? 0), output: Number(u.output_tokens ?? 0) + Number(u.reasoning_output_tokens ?? 0) } } });
    }
    if (ev.type === "turn.failed" || ev.type === "error") {
      const msg = ev.error?.message ?? ev.message ?? "ошибка Codex";
      out.push({ kind: "text", text: `ошибка: ${msg}` });
      if (ev.type === "turn.failed") out.push({ kind: "result", res: { is_error: true, session_id: thread, result: last || msg, num_turns: tools, duration_api_ms: Date.now() - t0 } });
    }
    return out;
  };
};

// Возможности Codex уровня аккаунта и встроенные, которые --ignore-user-config не выключает:
// приложения ChatGPT, плагины, браузер, управление компьютером, хуки. Режиссёру они не нужны
// (как MCP-серверы у Claude — --strict-mcp-config), а без песочницы были бы лишним доступом.
export const CODEX_OFF = ["apps", "plugins", "remote_plugin", "browser_use", "browser_use_external", "computer_use", "in_app_browser", "hooks"];

const codex = (bin: string): Agent => ({
  name: "codex", auth: CODEX_AUTH, bin, title: "Codex CLI", costInUsd: false, subagents: true,
  args: (o) => [
    "exec", "--json",
    // Личный ~/.codex/config.toml владельца (модель, уведомления, плагины, MCP) директору не нужен —
    // как --setting-sources у Claude; вход по подписке берётся из CODEX_HOME как обычно.
    "--ignore-user-config",
    // Папка ролика — не git-репозиторий (GIT_CEILING_DIRECTORIES в env): git директору не нужен.
    "--skip-git-repo-check",
    "-c", "notify=[]",
    ...CODEX_OFF.flatMap((f) => ["--disable", f]),
    // Руководство студии (AGENTS.md = studio/CLAUDE.md) ≈ 30 КБ — больше обычного лимита Codex.
    "-c", "project_doc_max_bytes=131072",
    "-c", 'approval_policy="never"',
    // Без песочницы Codex: Chrome рендера Remotion в ней не запускается (проверено на macOS).
    // Права — те же, что у Bash директора Claude Code: пользователя (README «Безопасность»).
    "-s", "danger-full-access",
    "-C", o.dir,
    ...(o.model ? ["-m", o.model] : []),
    ...(o.effort ? ["-c", `model_reasoning_effort="${o.effort}"`] : []),
    "-", // промпт — из stdin
  ],
  stdin: (o) => o.prompt,
  // Без поиска git-репозитория выше папки ролика: git status/checkout/commit из ролика не
  // дотянутся до репозитория студии (у Claude то же делает запрет Bash(git …)).
  // CODEX_HOME из .env (если задан там) — тоже: без него Codex не найдёт вход по подписке.
  env: (base, o) => ({ ...base, CODEX_HOME: codexHome(), GIT_CEILING_DIRECTORIES: dirname(o.dir) }),
  parser: codexParser,
});

// Кто режиссёр: явный выбор (--agent / STUDIO_AGENT) или первый установленный.
export const pickAgent = (choice: string | undefined, env: NodeJS.ProcessEnv = process.env): Agent => {
  const want = (choice ?? env.STUDIO_AGENT ?? "").trim().toLowerCase() || "auto";
  const bins: Record<AgentName, string | null> = { claude: claudeBin(env), codex: codexBin(env) };
  const make = (n: AgentName) => (n === "claude" ? claude(bins.claude!) : codex(bins.codex!));
  if (want === "auto") {
    const n = AGENTS.find((x) => bins[x]);
    if (!n) throw new Error(`не найден ни один агент-режиссёр. Установите один из них:\n  ${AGENTS.map((x) => install[x]).join("\n  ")}`);
    return make(n);
  }
  if (!AGENTS.includes(want as AgentName)) throw new Error(`неизвестный агент «${want}» (--agent claude | codex | auto)`);
  if (!bins[want as AgentName]) throw new Error(`не найден ${install[want as AgentName]}`);
  return make(want as AgentName);
};

// Готов ли агент работать (для doctor): установлен ли и вошёл ли.
export const agentStatus = (env: NodeJS.ProcessEnv = process.env) => ({
  claude: { bin: claudeBin(env), login: null as string | null },
  codex: { bin: codexBin(env), login: codexLogin(env) },
  choice: (env.STUDIO_AGENT ?? "").trim().toLowerCase() || "auto",
});
export const installHint = (n: AgentName) => install[n];
