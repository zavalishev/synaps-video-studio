// Запуск студии: бриф → папка ролика → агент-директор (Claude Code без окна) → out/final.mp4.
//   npx tsx studio/make.ts --brief brief.md|"текст брифа" [--slug s] [--size 1080x1920] [--fps 30]
//        [--author "@handle"] [--brand dir] [--model opus] [--finish-model …] [--effort …] [--finish-effort …]
//        [--phases 2|1] [--budget-usd 4] [--budget-min 15] [--max-budget-usd 6]
//        [--timeout-min 90] [--resume] [--dry-run] [--prompt "своя задача директору"]
// Два этапа с чистым контекстом (по умолчанию):
//   A «сборка» — бриф → концепт, тема, голос, биты, ассеты, сцены → первый review.ts и критик
//     → раздел «Передача» в notes.md; контекст растёт до ~150 тыс., но не тащится дальше;
//   B «доводка» — новый claude -p: бриф, concept.md, «Передача», сводка review — правки по
//     приоритету (≤ 2 круга review), финальный рендер, probe, mixcheck, notes.md.
//   Цикл проверок в раунде 2 стоил 55–65 % времени и денег именно потому, что каждая мелкая
//   правка перечитывала всю историю сборки (140–300 тыс. токенов на вызов).
// Бюджет: --budget-usd/--budget-min — ориентир, который директор видит строкой «бюджет: …» в
// выводе studio-инструментов; --max-budget-usd — жёсткая страховка claude на ВЕСЬ прогон.
// Что делает:
//   1) jobs/<slug>/ из studio/template (brief.md, job.json, src/, public/, out/, notes.md),
//      CLAUDE.md и AGENTS.md — ссылки на studio/CLAUDE.md, скиллы — ссылки в .claude/skills;
//   2) claude -p в папке ролика: правки файлов без вопросов (acceptEdits); набор инструментов
//      ОГРАНИЧЕН (--tools Bash, Read, Write, Edit, Glob, Grep, Task) — без расписаний, фоновых
//      ожиданий, веба и встроенных скиллов (каждый лишний инструмент — токены в каждом вызове);
//      --exclude-dynamic-system-prompt-sections — общий кэш префикса у параллельных роликов;
//      --add-dir studio; studio/bin в PATH; только настройки проекта, без MCP, без git;
//   3) поток событий → jobs/<slug>/director.log, итог → director.result.json (сумма по этапам и
//      по всем result-событиям: стоимость, ходы, время — критик в фоне больше не «теряет» ходы);
//      сторож по времени, caffeinate на время прогона;
//   4) печатает JSON: {job, final, exists, ...итог}.
// --brand dir — материалы заказчика: logo.(svg|png), photos/ (товар, место, люди), refs/ (прошлые
// посты — образец стиля), brand.json ({colors, fonts, words: {use, avoid}}) → public/brand/ и
// job.json.brand. Нет — директор делает ставки-заглушки и пишет «пришлите фото» в вопросы заказчику.
// Итог печатает clientQuestions — раздел notes.md «## Вопросы заказчику» (противоречия брифа,
// допущения, что заменить на настоящее, обязательные пометки): оркестратор показывает его владельцу.
// --resume — продолжить в существующей папке (новый запуск директора с тем же брифом;
// директор видит notes.md и файлы прошлых шагов). --dry-run — только создать папку.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { clientQuestions } from "./skills/claims-and-compliance/facts";
import { join } from "node:path";
import { createJob, JOBS, linkSkills, slugify } from "./bin/_job";
import { die, num, parseArgs, ROOT, STUDIO, str } from "./bin/_lib";

const a = parseArgs(process.argv.slice(2), ["resume", "dry-run"]);
const PHASES = num(a, "phases", 2)!;
// Claude Code CLI: $CLAUDE_BIN, иначе ~/.local/bin/claude (родной установщик), иначе claude из PATH.
const CLAUDE = process.env.CLAUDE_BIN ?? [join(process.env.HOME ?? "", ".local/bin/claude")].find((p) => existsSync(p)) ?? "claude";

const briefArg = str(a, "brief") ?? (a.resume ? undefined : die("нужен --brief brief.md или --brief \"текст\""));
const brief = briefArg === undefined ? undefined : existsSync(briefArg) ? readFileSync(briefArg, "utf8") : briefArg;

let slug = str(a, "slug") ? slugify(str(a, "slug")!) : slugify((brief ?? "job").split("\n").find((l) => l.trim())!.replace(/^#+\s*/, ""));
let dir = join(JOBS, slug);
if (a.resume) {
  if (!existsSync(dir)) die(`нет папки ${dir} для --resume`);
  if (brief !== undefined) writeFileSync(join(dir, "brief.md"), brief.trim() + "\n");
  linkSkills(dir); // скиллы могли добавиться
} else {
  for (let k = 2; existsSync(dir); k++) dir = join(JOBS, `${slug}-${k}`);
  slug = dir.slice(JOBS.length + 1);
  const [w, h] = (str(a, "size") ?? "").split("x").map(Number);
  createJob(slug, { brief, width: w || undefined, height: h || undefined, fps: num(a, "fps"), author: str(a, "author"), brand: str(a, "brand") });
}
console.error(`папка ролика: ${dir}`);
if (a["dry-run"]) { console.log(JSON.stringify({ job: dir, final: join(dir, "out/final.mp4"), exists: false, dryRun: true })); process.exit(0); }

const RESULT_JSON = `Последнее сообщение — только JSON: {"final":"out/final.mp4","seconds":<длина>,"concept":"…","skills":["…"],"paid":{"tts":<n>,"images":<n>},"probe":"PASS|WARN|FAIL","critic":"<оценка критика 1–10 или null>","client_questions":["… — то же, что в notes.md «## Вопросы заказчику»: противоречия брифа, допущения, заглушки вместо настоящего товара/места/людей, обязательные пометки"],"open_issues":["…"]}`;
const COMMON = `Рабочая папка — текущая (${dir}). Бриф — brief.md. Руководство студии — CLAUDE.md (уже в контексте). Не трогай ничего вне этой папки.
Работай экономно: скиллы — карточками (\`studio skill <имя>\`), API — \`studio api <модуль>\`, исходники проверок не читай; правки — Edit по месту, сцена — свой файл; из отчётов — сводка, которую печатает инструмент; картинки — те, что он велит открыть. Следи за строкой «бюджет: …» в выводе инструментов.`;

const PROMPT_ONE = str(a, "prompt") ?? `Ты — режиссёр-постановщик ролика. ${COMMON}
Сам выбери концепт, стиль, структуру, камеру, тайминг и инструменты под этот бриф — шаблонов нет, скиллы дают знания и стартовые точки.
Веди notes.md (решения и почему, что проверил, что исправил). Результат — out/final.mp4 по производственному циклу CLAUDE.md (review не больше 3 кругов; критик выслушан; финальный probe без FAIL).
${a.resume ? "Это продолжение прерванного прогона: прочитай notes.md и продолжи с первого незавершённого шага." : "Это новый прогон: папка свежая — director.log и чужие ролики не читай, начинай с брифа."}
${RESULT_JSON}`;

const PROMPT_A = `Ты — режиссёр-постановщик ролика. ${COMMON}
Этап 1 из 2 — СБОРКА. Сам выбери концепт, стиль, структуру, камеру, тайминг и инструменты под этот бриф — шаблонов нет.
Пройди производственный цикл CLAUDE.md до первого круга самопроверки включительно: бриф → концепт и тема → голос → биты → ассеты → сцены → studio check → кадры → review.ts (круг 1) → критик со свежим взглядом по плиткам этого черновика (structure: крючок, повторы, кульминация, финал) → правка FAIL первого круга, если она очевидна.
Затем допиши в notes.md раздел «## Передача» (≤ 25 строк): концепт одной фразой; карта src/ (файл → бит → что в кадре); что уже проверено; список дел по приоритету (FAIL; затем ★ ленточные WARN — крючок, кульминация, развязка, форма, факт, финал — каждый с одной конкретной альтернативой; правка №1 критика — без неё studio render не выпустит final.mp4; остальные правки критика; WARN героя/финала) с файлом и битом для каждого; что принято осознанно и почему. Финальный рендер не делай — его сделает этап 2 с чистым контекстом.
${a.resume ? "Это продолжение прерванного прогона: прочитай notes.md и продолжи с первого незавершённого шага." : "Это новый прогон: папка свежая — director.log и чужие ролики не читай, начинай с брифа."}
Последнее сообщение — только JSON: {"phase":"build","handoff":"notes.md#Передача","review":"PASS|WARN|FAIL"}`;

const PROMPT_B = `Ты — режиссёр-постановщик, этап 2 из 2 — ДОВОДКА ролика, который собран на этапе 1 (контекст сборки сознательно не передан, чтобы правки были дешёвыми). ${COMMON}
Прочитай: brief.md, concept.md, раздел «## Передача» в notes.md (\`sed -n '/^## Передача/,$p' notes.md\`), сводку прошлого review (\`head -40 out/review/review.md\`). Остальные файлы — только те, что правишь.
Сделай дела из «Передачи» по приоритету: правка — Edit в файле сцены; после правок — review.ts (не больше 2 кругов на этом этапе; после лимита новый круг — только ради FAIL; ★ ленточные WARN — одна попытка варианта через studio still и сравнение; косметические WARN — в notes.md как принятые). Звук правишь — \`studio render --audio-only\` вместо полного рендера.
Сначала ★ и правка №1 критика — у них приоритет над косметикой: studio render выпускает out/final.mp4 только без открытых ★, без FAIL review и со строкой «Критик #1: сделано — …» в notes.md (иначе — out/candidate.mp4 и статус needs-stage-2).
Финал: studio render → studio probe out/final.mp4 (без FAIL) → mixcheck → \`studio sheet out/final.mp4\` посмотрен → notes.md: что сделано на этапе 2, итог probe/review, ответы на вопросы ленты, ответ критику, что осталось открытым; раздел «## Вопросы заказчику» актуален (его увидит владелец).
Если out/final.mp4 уже готов и в «Передаче» нет дел — только сверь probe и notes.md.
${RESULT_JSON}`;

// Task — для критика со свежим контекстом (self-review/critic.md): он видит только бриф и
// плитки «как в ленте», без истории сборки — так самооценка не завышается.
const TOOLS = (process.env.STUDIO_TOOLS ?? "Bash,Read,Write,Edit,Glob,Grep,Task").split(",");
const BUDGET_USD = num(a, "budget-usd", 4)!, BUDGET_MIN = num(a, "budget-min", 15)!;
const HARD_USD = num(a, "max-budget-usd", 6)!;
const argsFor = (prompt: string, o: { model?: string; effort?: string; maxUsd: number }) => [
  "-p", prompt,
  "--output-format", "stream-json", "--verbose",
  "--permission-mode", "acceptEdits",
  "--tools", TOOLS.join(","),
  "--allowedTools", ...TOOLS, "Agent",
  "--disable-slash-commands",
  "--exclude-dynamic-system-prompt-sections",
  // Директор видит только руководство студии: без личного ~/.claude/CLAUDE.md, хуков и MCP-серверов
  // владельца (там правила для разработки, например «git checkout основной ветки» — в ролике это
  // переключило бы ветку репо посреди прогона). git директору не нужен вовсе.
  "--setting-sources", "project,local",
  "--strict-mcp-config",
  "--disallowedTools", "Bash(git:*)", "Bash(git *)",
  "--add-dir", STUDIO,
  ...(o.model ? ["--model", o.model] : []),
  ...(o.effort ? ["--effort", o.effort] : []),
  "--max-budget-usd", o.maxUsd.toFixed(2),
];

const log = join(dir, "director.log");
const env = { ...process.env, PATH: `${join(STUDIO, "bin")}:${process.env.PATH}`, STUDIO_JOB: dir, STUDIO_ROOT: ROOT, STUDIO_BUDGET_USD: String(BUDGET_USD), STUDIO_BUDGET_MIN: String(BUDGET_MIN) };
const t0 = Date.now();
const limitMin = num(a, "timeout-min", 90)!;

type Res = { is_error?: boolean; total_cost_usd?: number; num_turns?: number; duration_ms?: number; duration_api_ms?: number; session_id?: string; result?: string; modelUsage?: Record<string, Record<string, number>> };
type PhaseOut = { name: string; code: number | null; results: Res[]; minutes: number; tools: string[] | null };

const runPhase = (name: string, prompt: string, o: { model?: string; effort?: string; maxUsd: number; minutes: number }): Promise<PhaseOut> => new Promise((resolveP) => {
  appendFileSync(log, `\n===== ${new Date().toISOString()} запуск директора (этап ${name})\n`);
  const tp = Date.now();
  const p = spawn(CLAUDE, argsFor(prompt, o), { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
  const caf = spawnSync("which", ["caffeinate"]).status === 0 ? spawn("caffeinate", ["-dimsu", "-w", String(p.pid)], { stdio: "ignore" }) : null;
  const timer = setTimeout(() => { appendFileSync(log, `\n[сторож] этап ${name}: ${o.minutes.toFixed(0)} мин — останавливаю\n`); p.kill("SIGTERM"); setTimeout(() => p.kill("SIGKILL"), 10_000); }, o.minutes * 60_000);
  const results: Res[] = [];
  let tools: string[] | null = null;
  let rest = "";
  p.stdout.on("data", (b: Buffer) => {
    appendFileSync(log, b);
    rest += b.toString();
    const lines = rest.split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.type === "system" && ev.subtype === "init") {
          tools = ev.tools ?? null;
          if (tools && !tools.includes("Task") && !tools.includes("Agent")) console.error(`[${name}] внимание: нет инструмента субагента (Task/Agent) — критик пойдёт вторым проходом самого директора`);
        }
        if (ev.type === "result") results.push(ev);
        if (ev.type === "assistant" && !ev.parent_tool_use_id) {
          for (const c of ev.message?.content ?? []) {
            const min = ((Date.now() - t0) / 60000).toFixed(1);
            if (c.type === "tool_use") {
              const what = c.name === "Bash" ? c.input?.command : c.input?.file_path ?? c.input?.description ?? c.input?.pattern ?? "";
              console.error(`[${min} мин ${name}] ${c.name}: ${String(what).split("\n")[0].slice(0, 140)}`);
            } else if (c.type === "text" && c.text?.trim()) console.error(`[${min} мин ${name}] » ${c.text.trim().split("\n")[0].slice(0, 160)}`);
          }
        }
      } catch { /* не JSON — уже в логе */ }
    }
  });
  p.stderr.on("data", (b: Buffer) => appendFileSync(log, b));
  p.on("close", (code) => { clearTimeout(timer); caf?.kill(); resolveP({ name, code, results, minutes: (Date.now() - tp) / 60000, tools }); });
});

// Итог этапа: стоимость — максимум (total_cost_usd накопительный в сессии), ходы и время —
// сумма по всем result-событиям (сессия, ушедшая в ожидание фонового критика, даёт два).
const phaseSum = (ph: PhaseOut) => {
  const bySession = new Map<string, Res[]>();
  for (const r of ph.results) bySession.set(r.session_id ?? "", [...(bySession.get(r.session_id ?? "") ?? []), r]);
  let cost = 0, turns = 0, apiMs = 0;
  for (const rs of bySession.values()) { cost += Math.max(...rs.map((r) => r.total_cost_usd ?? 0)); turns += rs.reduce((s0, r) => s0 + (r.num_turns ?? 0), 0); apiMs += rs.reduce((s0, r) => s0 + (r.duration_api_ms ?? 0), 0); }
  const last = ph.results[ph.results.length - 1];
  return { phase: ph.name, exitCode: ph.code, costUsd: +cost.toFixed(4), turns, minutes: +ph.minutes.toFixed(1), apiMinutes: +(apiMs / 60000).toFixed(1), isError: last?.is_error ?? null, sessionId: last?.session_id ?? null, result: last?.result ?? null, modelUsage: last?.modelUsage ?? null };
};

const main = async () => {
  const phases: Array<ReturnType<typeof phaseSum>> = [];
  if (PHASES <= 1 || str(a, "prompt")) {
    phases.push(phaseSum(await runPhase("один", PROMPT_ONE, { model: str(a, "model"), effort: str(a, "effort"), maxUsd: HARD_USD, minutes: limitMin })));
  } else {
    const A = phaseSum(await runPhase("A", PROMPT_A, { model: str(a, "model"), effort: str(a, "effort"), maxUsd: HARD_USD * 0.7, minutes: limitMin * 0.65 }));
    phases.push(A);
    const left = Math.max(1, HARD_USD - A.costUsd);
    const leftMin = Math.max(10, limitMin - (Date.now() - t0) / 60000);
    phases.push(phaseSum(await runPhase("B", PROMPT_B, { model: str(a, "finish-model") ?? str(a, "model"), effort: str(a, "finish-effort") ?? str(a, "effort"), maxUsd: left, minutes: leftMin })));
  }
  const last = phases[phases.length - 1];
  const total = { total_cost_usd: +phases.reduce((s0, p0) => s0 + p0.costUsd, 0).toFixed(4), num_turns: phases.reduce((s0, p0) => s0 + p0.turns, 0), duration_ms: Date.now() - t0, phases, result: last.result, is_error: last.isError };
  // --resume: прошлые запуски в той же папке складываются (иначе ролик «стоил» только последний
  // кусок: стена 3.8 мин при 10.7 мин API). runs — история, cumulative — сумма всех запусков.
  const rf = join(dir, "director.result.json");
  let prev: { runs?: unknown[]; total_cost_usd?: number; num_turns?: number; duration_ms?: number; phases?: Array<{ apiMinutes?: number }>; cumulative?: { costUsd: number; turns: number; wallMinutes: number; apiMinutes: number; runs: number } } | null = null;
  if (a.resume && existsSync(rf)) { try { prev = JSON.parse(readFileSync(rf, "utf8")); } catch { /* битый — начнём заново */ } }
  const apiMin = (ps?: Array<{ apiMinutes?: number }>) => (ps ?? []).reduce((s0, p0) => s0 + (p0.apiMinutes ?? 0), 0);
  const base = prev?.cumulative ?? (prev ? { costUsd: prev.total_cost_usd ?? 0, turns: prev.num_turns ?? 0, wallMinutes: (prev.duration_ms ?? 0) / 60000, apiMinutes: apiMin(prev.phases), runs: 1 } : { costUsd: 0, turns: 0, wallMinutes: 0, apiMinutes: 0, runs: 0 });
  const cumulative = { costUsd: +(base.costUsd + total.total_cost_usd).toFixed(4), turns: base.turns + total.num_turns, wallMinutes: +(base.wallMinutes + total.duration_ms / 60000).toFixed(1), apiMinutes: +(base.apiMinutes + apiMin(phases)).toFixed(1), runs: base.runs + 1 };
  writeFileSync(rf, JSON.stringify({ ...total, cumulative, runs: [...(prev?.runs ?? []), { at: new Date().toISOString(), costUsd: total.total_cost_usd, turns: total.num_turns, wallMinutes: +(total.duration_ms / 60000).toFixed(1), resume: Boolean(a.resume) }] }, null, 1));
  // Статус от ворот финала (studio render): needs-stage-2 — ролик собран, но открыты ★ или правка
  // критика; файл — out/candidate.mp4. Владелец видит это, а не «финал».
  let status: { status: string; file?: string; open?: string[] } | null = null;
  try { status = existsSync(join(dir, "out", "status.json")) ? JSON.parse(readFileSync(join(dir, "out", "status.json"), "utf8")) : null; } catch { status = null; }
  const final = status?.status === "needs-stage-2" ? join(dir, "out", "candidate.mp4") : join(dir, "out", "final.mp4");
  let summary: unknown = null;
  const m = (last.result ?? "").match(/\{[\s\S]*\}\s*$/);
  if (m) { try { summary = JSON.parse(m[0]); } catch { /* директор ответил не JSON */ } }
  // Вопросы заказчику — из notes.md, даже если директор не вернул JSON: их увидит владелец.
  const nf = join(dir, "notes.md");
  const cq = existsSync(nf) ? clientQuestions(readFileSync(nf, "utf8")).split("\n").map((l) => l.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim()).filter(Boolean) : [];
  console.log(JSON.stringify({
    job: dir, final, exists: existsSync(final), status: status?.status ?? (existsSync(final) ? "final" : "none"), open: status?.open ?? [], exitCode: last.exitCode, minutes: +((Date.now() - t0) / 60000).toFixed(1),
    isError: last.isError, costUsd: total.total_cost_usd, turns: total.num_turns, cumulative, phases: phases.map(({ result: _r, modelUsage: _m, ...p0 }) => p0), clientQuestions: cq, summary, log,
  }, null, 1));
  process.exit(last.exitCode ?? 1);
};
main().catch((e) => { console.error("ошибка: " + (e?.stack ?? e)); process.exit(1); });
