// Общее для инструментов студии (studio/bin/*.ts): корень репо, папка ролика, разбор
// аргументов, сборка Remotion с алиасом @studio, сбор отчёта страховки кадра из логов браузера.
// Платные провайдеры (TTS, картинки, тайминги) — _providers.ts; ffmpeg и кэш — _media.ts.
// Настройки пользователя (.env в корне) загружаются первым импортом — до любых провайдеров.
import "./_env";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const STUDIO = join(ROOT, "studio");
export const LIB = join(STUDIO, "lib");
// Где лежат ролики и кэш (по умолчанию — в репозитории). На сервере студия может стоять
// только для чтения, а ролик — в отдельной папке проекта: STUDIO_JOBS_DIR, STUDIO_CACHE_DIR.
export const JOBS_DIR = process.env.STUDIO_JOBS_DIR ? resolve(process.env.STUDIO_JOBS_DIR) : join(ROOT, "jobs");
export const CACHE_DIR = process.env.STUDIO_CACHE_DIR ? resolve(process.env.STUDIO_CACHE_DIR) : join(ROOT, ".cache");

export type Args = { _: string[]; [k: string]: string | boolean | string[] };

// --key value, --key=value, --flag; всё после «--» уходит в args["--"] как есть.
export const parseArgs = (argv = process.argv.slice(2), flags: string[] = []): Args => {
  const out: Args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") { out["--"] = argv.slice(i + 1); break; }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const key = a.slice(2);
      const next = argv[i + 1];
      if (flags.includes(key) || next === undefined || (next.startsWith("--") && next.length > 2)) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
};

export const str = (a: Args, k: string, def?: string): string | undefined => {
  const v = a[k];
  return typeof v === "string" ? v : def;
};
export const num = (a: Args, k: string, def?: number): number | undefined => {
  const v = a[k];
  if (typeof v !== "string") return def;
  const n = Number(v);
  if (!Number.isFinite(n)) die(`--${k}: не число: ${v}`);
  return n;
};

export const die = (msg: string, code = 1): never => {
  console.error("ошибка: " + msg);
  process.exit(code);
};

export const ensureDir = (p: string) => { mkdirSync(p, { recursive: true }); return p; };

// Папка ролика: --job <dir>, иначе текущая (в ней должен быть job.json).
export const jobDir = (a: Args): string => {
  const d = resolve(str(a, "job") ?? process.env.STUDIO_JOB ?? process.cwd());
  if (!existsSync(join(d, "job.json"))) die(`нет job.json в ${d} — запустите из папки ролика или передайте --job <dir>`);
  return d;
};

export type JobConfig = {
  width: number; height: number; fps: number;
  durationInFrames?: number;   // явно; иначе от аудио
  audio?: string;              // путь в public/, например "voice.wav"
  tailSec?: number;            // хвост после аудио
  author?: string;             // подпись публикующего (аккаунт/бренд), если известна
  // материалы заказчика (studio make --brand dir): пути от public/ для staticFile
  brand?: { logo?: string; photos?: string[]; refs?: string[]; colors?: string[]; fonts?: string[]; words?: { use?: string[]; avoid?: string[] }; [k: string]: unknown };
  // регулируемая категория — решение директора (claims-and-compliance): "medical" | "supplements" |
  // "finance" | "alcohol" | "children" (через запятую) | "none"
  regulated?: string;
};
export const readJob = (dir: string): JobConfig => JSON.parse(readFileSync(join(dir, "job.json"), "utf8"));

export const inJob = (dir: string, p: string) => (isAbsolute(p) ? p : join(dir, p));

// Путь строго внутри папки ролика (с учётом ссылок): то, что уходит провайдеру (промпт-файл,
// референсы, реплики) или пишется инструментом. Иначе null. Абсолютный путь, «..» и ссылка
// наружу (~/.ssh/id_rsa, .env студии) не проходят — даже если директора уговорил текст брифа.
// Path confined to the job folder (symlinks resolved), or null.
export const jobPath = (dir: string, p: string): string | null => {
  const abs = resolve(dir, p);
  let root: string;
  try { root = realpathSync(dir); } catch { return null; }
  let cur = abs;
  const rest: string[] = [];
  for (;;) {
    let isLink = false, present = false;
    try { const st = lstatSync(cur); present = true; isLink = st.isSymbolicLink(); } catch { /* нет такого */ }
    if (present) {
      if (isLink && !existsSync(cur)) return null; // висячая ссылка: запись ушла бы по ней
      break;
    }
    const up = dirname(cur);
    if (up === cur) return null;
    rest.unshift(basename(cur));
    cur = up;
  }
  const real = join(realpathSync(cur), ...rest);
  return real === root || real.startsWith(root + sep) ? abs : null;
};
export const inJobStrict = (dir: string, p: string, what = "путь"): string =>
  jobPath(dir, p) ?? die(`${what}: ${p} — вне папки ролика. Инструменты студии берут и пишут файлы только внутри неё; нужен внешний файл — сначала скопируйте его сюда (владелец студии — через --brand).`);

// ---------- Remotion ----------
export const COMPOSITION = "Video";

// Шрифты без интернета: STUDIO_FONTS_DIR — зеркало файлов Google Fonts (scripts/fonts-offline.mjs).
// Перед сборкой в public/fonts-offline/ ролика копируются только семейства, которые
// импортируют сцены ролика и библиотека студии; studio/lib/fonts.ts берёт их оттуда.
const FONT_IMPORT = /@remotion\/google-fonts\/(\w+)/g;
const fontFamiliesUsed = (dirs: string[]): Set<string> => {
  const out = new Set<string>();
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const f = join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.(tsx?|jsx?)$/.test(e.name)) for (const m of readFileSync(f, "utf8").matchAll(FONT_IMPORT)) out.add(m[1]);
    }
  };
  dirs.forEach(walk);
  return out;
};
export const offlineFonts = (dir: string): boolean => {
  const mirror = process.env.STUDIO_FONTS_DIR;
  if (!mirror) return false;
  const dst = join(dir, "public", "fonts-offline");
  for (const fam of fontFamiliesUsed([join(dir, "src"), LIB])) {
    const src = join(mirror, fam);
    if (!existsSync(src)) die(`шрифт ${fam}: нет в зеркале STUDIO_FONTS_DIR (${mirror}) — выберите другое семейство (studio fonts)`);
    const to = join(dst, fam);
    if (!existsSync(to)) cpSync(src, to, { recursive: true });
  }
  return true;
};

export const bundleJob = async (dir: string): Promise<string> => {
  const { bundle, webpack } = await import("@remotion/bundler");
  const t = Date.now();
  const offline = offlineFonts(dir);
  const url = await bundle({
    entryPoint: join(dir, "src", "index.ts"),
    publicDir: join(dir, "public"),
    rootDir: ROOT,
    outDir: join(dir, ".bundle"),
    webpackOverride: (c) => ({
      ...c,
      resolve: { ...c.resolve, alias: { ...((c.resolve?.alias as Record<string, string>) ?? {}), "@studio": LIB } },
      plugins: [...(c.plugins ?? []), new webpack.DefinePlugin({ __STUDIO_FONTS_OFFLINE__: JSON.stringify(offline) })],
    }),
  });
  console.error(`сборка: ${((Date.now() - t) / 1000).toFixed(1)} с`);
  return url;
};

// Страховка кадра (studio/lib/layout.ts) пишет нарушения в console.warn с меткой.
// Инструменты рендера собирают их в out/guard.json — его читает probe и самопроверка.
export const GUARD_TAG = "[studio-guard]";
export type GuardHit = { id: string; kind: string; frames: number[]; worst: number; detail: unknown };
export const guardCollector = () => {
  const hits = new Map<string, GuardHit>();
  const other: string[] = [];
  const onBrowserLog = (log: { text: string; type: string }) => {
    const i = log.text.indexOf(GUARD_TAG);
    if (i < 0) {
      if (log.type === "error" && other.length < 50) other.push(log.text.slice(0, 500));
      return;
    }
    try {
      const v = JSON.parse(log.text.slice(i + GUARD_TAG.length));
      const key = `${v.id}|${v.kind}`;
      const h: GuardHit = hits.get(key) ?? { id: v.id, kind: v.kind, frames: [], worst: 0, detail: v.detail };
      if (!h.frames.includes(v.frame)) h.frames.push(v.frame);
      if ((v.amount ?? 0) > h.worst) { h.worst = v.amount; h.detail = v.detail; }
      hits.set(key, h);
    } catch { /* не наш формат */ }
  };
  const save = (file: string) => {
    const list = [...hits.values()].map((h) => ({ ...h, frames: h.frames.sort((a, b) => a - b) }));
    writeFileSync(file, JSON.stringify({ violations: list, browserErrors: other }, null, 1));
    return list;
  };
  return { onBrowserLog, save };
};

export const printGuard = (all: GuardHit[]) => {
  const list = all.filter((h) => !h.kind.startsWith("note:"));
  if (!list.length) { console.log("страховка кадра: нарушений нет"); return; }
  console.log(`страховка кадра: ${list.length} нарушений`);
  for (const h of list) {
    const fr = h.frames.length > 6 ? `${h.frames[0]}…${h.frames[h.frames.length - 1]} (${h.frames.length} кадров)` : h.frames.join(",");
    console.log(`  ${h.kind} ${h.id}: кадры ${fr}; худшее ${h.worst} — ${JSON.stringify(h.detail)}`);
  }
};

export const parseProps = (a: Args): Record<string, unknown> => {
  const p = str(a, "props");
  if (!p) return {};
  try { return JSON.parse(existsSync(p) ? readFileSync(p, "utf8") : p); } catch { return die("--props: не JSON и не файл"); }
};

// GL рендера: --gl, иначе STUDIO_GL (сервер без видеокарты — swangle), иначе angle.
export const glOpt = (a: Args) => (str(a, "gl") ?? process.env.STUDIO_GL ?? "angle") as "angle" | "swangle" | "egl" | "swiftshader" | "vulkan" | "angle-egl";

// ---------- очередь рендеров ----------
// Несколько роликов параллельно (несколько директоров) делят процессор: одновременные рендеры
// Chromium душат друг друга и все идут в разы дольше. Слоты — папки-замки в .cache/locks
// (STUDIO_RENDER_SLOTS, по умолчанию ~ядра/8, минимум 1; STUDIO_RENDER_LOCK=0 — без очереди).
// Замок мёртвого процесса снимается сам.
export const withRenderSlot = async <T>(what: string, fn: () => Promise<T>): Promise<T> => {
  if (process.env.STUDIO_RENDER_LOCK === "0") return fn();
  const { cpus } = await import("node:os");
  const { rmSync } = await import("node:fs");
  const slots = Math.max(1, Number(process.env.STUDIO_RENDER_SLOTS) || Math.floor(cpus().length / 8));
  const dir = join(CACHE_DIR, "locks");
  mkdirSync(dir, { recursive: true });
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  let held: string | null = null, waited = false;
  const t0 = Date.now();
  while (!held) {
    for (let i = 0; i < slots && !held; i++) {
      const lock = join(dir, `render-${i}`);
      try { mkdirSync(lock); writeFileSync(join(lock, "pid"), `${process.pid} ${what}`); held = lock; }
      catch {
        const pid = Number((existsSync(join(lock, "pid")) ? readFileSync(join(lock, "pid"), "utf8") : "").split(" ")[0]);
        if (pid && !alive(pid)) rmSync(lock, { recursive: true, force: true });
      }
    }
    if (!held) {
      if (!waited) { console.error(`очередь рендера: все ${slots} слота заняты другими роликами — жду`); waited = true; }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  if (waited) console.error(`очередь рендера: ждал ${((Date.now() - t0) / 1000).toFixed(0)} с`);
  const release = () => { try { rmSync(held!, { recursive: true, force: true }); } catch { /* уже снят */ } };
  process.once("exit", release);
  try { return await fn(); } finally { release(); }
};

// Remotion печатает в терминал каждый console.* из браузера. Отчёты страховки и треки
// ([studio-guard], [studio-track]) идут на каждом кадре — тысячи строк, которые директор
// потом читает (дорого по контексту). Их собирают onBrowserLog; в терминале они не нужны.
export const quietBrowserTags = () => {
  const tags = ["[studio-guard]", "[studio-track]", "PCFSoftShadowMap has been deprecated"]; // + повторяющийся шум three
  for (const m of ["log", "info", "warn"] as const) {
    const orig = console[m].bind(console);
    console[m] = (...args: unknown[]) => { if (args.some((x) => typeof x === "string" && tags.some((t) => x.includes(t)))) return; orig(...args); };
  }
};

// ---------- служебные отметки страховки ----------
// FrameAudit пишет не только нарушения, но и отметки «на этом кадре есть нарочный выход
// (data-bleed) / игра персонажа (data-acting) / 3D-мир во весь кадр (data-world) / картинка
// покрывает кадр» — kind начинается с «note:». Это не нарушения: по ним probe понижает свои
// пиксельные догадки (edge-crossing, shake, cover-gap) до INFO на этих кадрах.
export const isGuardNote = (kind: string) => kind.startsWith("note:");
export const guardNoteFrames = (list: GuardHit[], kind: string): Set<number> =>
  new Set(list.filter((g) => g.kind === `note:${kind}`).flatMap((g) => g.frames));

// ---------- бюджет прогона ----------
// Сколько уже потрачено: по director.log (поток событий claude -p или codex exec --json). Завершённые сессии — по их
// итогу (total_cost_usd), идущая — по usage сообщений с ценами модели (подогнаны по modelUsage
// прошлых прогонов: Opus — запись кэша 1 ч $8/M, чтение $0.20/M, выход $20/M; Sonnet вдвое
// дешевле на выходе). Ориентир — STUDIO_BUDGET_USD / STUDIO_BUDGET_MIN (их ставит make.ts).
type Price = { in: number; cw5: number; cw1h: number; cr: number; out: number };
const PRICES: Array<[RegExp, Price]> = [
  [/haiku/, { in: 1, cw5: 1.25, cw1h: 2, cr: 0.1, out: 5 }],
  [/sonnet/, { in: 2, cw5: 2.5, cw1h: 4, cr: 0.2, out: 10 }],
  [/./, { in: 4, cw5: 5, cw1h: 8, cr: 0.2, out: 20 }],
];
export type Budget = { agent: "claude" | "codex"; usd: number; calls: number; images: number; minutes: number; reviews: number; renders: number; limitUsd: number; limitMin: number };
export const readBudget = (dir: string): Budget | null => {
  const log = join(dir, "director.log");
  if (!existsSync(log)) return null;
  const limitUsd = Number(process.env.STUDIO_BUDGET_USD) || 4;
  const limitMin = Number(process.env.STUDIO_BUDGET_MIN) || 15;
  const txt = readFileSync(log, "utf8");
  // Время — от начала текущего прогона (последний запуск, кроме этапа B — он продолжает A).
  const starts = [...txt.matchAll(/===== (\S+) запуск директора([^\n]*)/g)].filter((m) => !/этап B/.test(m[2]));
  const t0 = starts.length ? Date.parse(starts[starts.length - 1][1]) : NaN;
  const results = new Map<string, number>();
  const est = new Map<string, number>();
  // output_tokens в потоке событий частичный (в итог попадает только после ответа): выход
  // оцениваем по длине текста и аргументов инструментов (≈ 0.9 токена на знак вместе с
  // рассуждениями — подогнано по четырём прогонам раунда 2).
  const msgs = new Map<string, { sid: string; model: string; u: Record<string, number> & { cache_creation?: Record<string, number> }; out: number; chars: number }>();
  let calls = 0, images = 0, reviews = 0, renders = 0, codex = false;
  const countCmd = (cmd: string) => {
    if (/self-review\/review\.ts/.test(cmd)) reviews++;
    if (/studio render\b/.test(cmd) && !/--audio-only/.test(cmd)) renders++;
  };
  for (const line of txt.split("\n")) {
    if (!line.startsWith("{")) continue;
    // Codex (codex exec --json): цены в потоке нет (подписка) — считаем вызовы, просмотры картинок,
    // review и рендеры; бюджет директора у Codex — время.
    if (line.startsWith('{"type":"thread.') || line.startsWith('{"type":"item.') || line.startsWith('{"type":"turn.')) {
      codex = true;
      let ce: { type?: string; item?: { type?: string; command?: string; path?: string; [k: string]: unknown } };
      try { ce = JSON.parse(line); } catch { continue; }
      const it = ce.item;
      if (ce.type !== "item.started" || !it?.type || ["agent_message", "reasoning", "todo_list", "error"].includes(it.type)) continue;
      calls++;
      if (it.type === "command_execution") countCmd(String(it.command ?? ""));
      else if (/\.(png|jpe?g|webp)$/i.test(String(it.path ?? ""))) images++;
      continue;
    }
    let ev: { type?: string; session_id?: string; total_cost_usd?: number; parent_tool_use_id?: string | null; message?: { id?: string; model?: string; usage?: Record<string, number>; content?: Array<{ type: string; name?: string; input?: Record<string, string> }> } };
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === "result" && ev.session_id) results.set(ev.session_id, Math.max(results.get(ev.session_id) ?? 0, ev.total_cost_usd ?? 0));
    if (ev.type !== "assistant" || !ev.message?.id) continue;
    const m = ev.message;
    const prev = msgs.get(m.id!);
    const out = Number(m.usage?.output_tokens ?? 0);
    const chars = (m.content ?? []).reduce((n, c) => n + (c.type === "text" ? String((c as { text?: string }).text ?? "").length : c.type === "tool_use" ? JSON.stringify(c.input ?? {}).length : 0), 0);
    if (!prev) msgs.set(m.id!, { sid: ev.session_id ?? "", model: m.model ?? "", u: (m.usage ?? {}) as never, out, chars });
    else { prev.out = Math.max(prev.out, out); prev.chars += chars; }
    if (ev.parent_tool_use_id) continue;
    for (const c of m.content ?? []) {
      if (c.type !== "tool_use") continue;
      calls++;
      if (c.name === "Read" && /\.(png|jpe?g|webp)$/i.test(c.input?.file_path ?? "")) images++;
      countCmd(c.name === "Bash" ? c.input?.command ?? "" : "");
    }
  }
  for (const v of msgs.values()) {
    const p = PRICES.find(([re]) => re.test(v.model))![1];
    const cc = v.u.cache_creation ?? {};
    const cw1h = Number(cc.ephemeral_1h_input_tokens ?? 0);
    const cw5 = Number(cc.ephemeral_5m_input_tokens ?? Math.max(0, Number(v.u.cache_creation_input_tokens ?? 0) - cw1h));
    const usd = (Number(v.u.input_tokens ?? 0) * p.in + cw5 * p.cw5 + cw1h * p.cw1h + Number(v.u.cache_read_input_tokens ?? 0) * p.cr + Math.max(v.out, 0.9 * v.chars) * p.out) / 1e6;
    est.set(v.sid, (est.get(v.sid) ?? 0) + usd);
  }
  let usd = 0;
  for (const sid of new Set([...results.keys(), ...est.keys()])) usd += results.get(sid) ?? est.get(sid) ?? 0;
  return { agent: codex ? "codex" : "claude", usd, calls, images, reviews, renders, minutes: Number.isFinite(t0) ? (Date.now() - t0) / 60000 : 0, limitUsd, limitMin };
};
// Одна строка для вывода инструментов: директор видит, сколько потратил, не считая сам.
export const budgetLine = (dir: string): string | null => {
  let b: Budget | null = null;
  try { b = readBudget(dir); } catch { return null; }
  if (!b || (!b.calls && !b.usd)) return null;
  const sub = b.agent === "codex"; // у Codex цены нет: бюджет — время (и лимит подписки)
  const over = (!sub && b.usd >= b.limitUsd * 0.85) || b.minutes >= b.limitMin * 0.85;
  return `бюджет: ${sub ? "подписка Codex" : `$${b.usd.toFixed(2)} из ${b.limitUsd}`} · ${b.minutes.toFixed(0)} мин из ${b.limitMin} · вызовов ${b.calls} · картинок прочитано ${b.images} · review ${b.reviews} · рендеров ${b.renders}` +
    (over ? "\n  → бюджет почти исчерпан: финализируй (studio render → probe → mixcheck → notes.md); оставшиеся WARN — в notes.md как принятые" : "");
};
