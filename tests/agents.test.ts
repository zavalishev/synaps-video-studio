// Агент-режиссёр (Claude Code или Codex) и картинки по подписке Codex — без сети и без запуска
// агентов: аргументы, разбор потока событий, бюджет по журналу, выбор агента, провайдер codex
// (codex exec подменён командой, которая пишет события и картинку как настоящий).
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexCommand, codexParser, pickAgent, type RunOpts } from "../studio/bin/_agents";
import { directorEnv } from "../studio/bin/_env";
import { codexImagePrompt } from "../studio/bin/_img";
import { budgetLine, readBudget } from "../studio/bin/_lib";
import { image, imageConfig } from "../studio/bin/_providers";
import { studioChanges, studioSnapshot } from "../studio/bin/_job";

const tmp = () => mkdtempSync(join(tmpdir(), "studio-agents-"));
const BIN = process.execPath; // любой существующий файл вместо claude/codex
const opts = (o: Partial<RunOpts> = {}): RunOpts => ({ prompt: "сделай ролик", dir: "/r/jobs/kofe", studio: "/r/studio", root: "/r", envFile: "/r/.env", maxUsd: 4, tools: ["Bash", "Read"], ...o });
const codexHome = (login: object | null) => {
  const h = tmp();
  if (login) writeFileSync(join(h, "auth.json"), JSON.stringify(login));
  return h;
};

describe("выбор агента", () => {
  const both = { CLAUDE_BIN: BIN, CODEX_BIN: BIN };
  it("явный --agent важнее STUDIO_AGENT, auto при обоих — Claude Code", () => {
    expect(pickAgent("codex", { ...both, STUDIO_AGENT: "claude" }).name).toBe("codex");
    expect(pickAgent(undefined, { ...both, STUDIO_AGENT: "codex" }).name).toBe("codex");
    expect(pickAgent(undefined, both).name).toBe("claude");
    expect(pickAgent("auto", both).name).toBe("claude");
  });
  it("неизвестный агент — понятная ошибка", () => {
    expect(() => pickAgent("gemini", both)).toThrow(/claude \| codex/);
  });
});

describe("аргументы запуска", () => {
  it("Claude Code: потолок в долларах, запреты .env и studio/, без git", () => {
    const a = pickAgent("claude", { CLAUDE_BIN: BIN });
    const args = a.args(opts({ model: "opus" }));
    expect(args.slice(0, 2)).toEqual(["-p", "сделай ролик"]);
    expect(args).toEqual(expect.arrayContaining(["--max-budget-usd", "4.00", "Read(//r/.env)", "Edit(//r/studio/**)", "Bash(git:*)", "--model", "opus"]));
    expect(a.stdin(opts())).toBeNull();
    expect(a.costInUsd).toBe(true);
  });
  it("Codex: exec --json, без личного config.toml, без песочницы, папка ролика, промпт через stdin", () => {
    const a = pickAgent("codex", { CODEX_BIN: BIN });
    const args = a.args(opts({ model: "gpt-x", effort: "high" }));
    expect(args.slice(0, 2)).toEqual(["exec", "--json"]);
    expect(args).toEqual(expect.arrayContaining(["--ignore-user-config", "--skip-git-repo-check", "-s", "danger-full-access", "-C", "/r/jobs/kofe", "-m", "gpt-x", 'model_reasoning_effort="high"', "project_doc_max_bytes=131072"]));
    expect(args[args.length - 1]).toBe("-");
    expect(args.join(" ")).not.toContain("сделай ролик");
    expect(a.stdin(opts())).toBe("сделай ролик");
    expect(a.costInUsd).toBe(false);
  });
  it("Codex: git из папки ролика не видит репозиторий студии", () => {
    const a = pickAgent("codex", { CODEX_BIN: BIN });
    expect(a.env({ PATH: "/bin" }, opts()).GIT_CEILING_DIRECTORIES).toBe("/r/jobs");
  });
});

describe("поток событий Codex", () => {
  const lines = [
    { type: "thread.started", thread_id: "t-1" },
    { type: "turn.started" },
    { type: "item.completed", item: { id: "i0", type: "agent_message", text: "Читаю бриф" } },
    { type: "item.started", item: { id: "i1", type: "command_execution", command: "/bin/zsh -lc 'studio still --frames 0 && echo '\\''ok'\\'''", status: "in_progress" } },
    { type: "item.completed", item: { id: "i1", type: "command_execution", command: "…", exit_code: 0 } },
    { type: "item.completed", item: { id: "i2", type: "file_change", changes: [{ path: "src/scenes/A.tsx", kind: "update" }] } },
    { type: "item.completed", item: { id: "i3", type: "agent_message", text: '{"final":"out/final.mp4"}' } },
    { type: "turn.completed", usage: { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 50, reasoning_output_tokens: 20 } },
  ].map((x) => JSON.stringify(x));
  it("инструменты, текст и итог в общем виде", () => {
    const parse = codexParser();
    const evs = lines.flatMap((l) => parse(l));
    expect(evs[0]).toEqual({ kind: "init", tools: null });
    expect(evs.filter((e) => e.kind === "tool")).toEqual([
      { kind: "tool", name: "Bash", what: "studio still --frames 0 && echo 'ok'" },
      { kind: "tool", name: "Edit", what: "src/scenes/A.tsx" },
    ]);
    const res = evs.find((e) => e.kind === "result");
    expect(res).toMatchObject({ res: { is_error: false, session_id: "t-1", result: '{"final":"out/final.mp4"}', num_turns: 2, usage: { input: 1000, cached: 800, output: 70 } } });
  });
  it("turn.failed — итог с ошибкой", () => {
    const parse = codexParser();
    parse(JSON.stringify({ type: "thread.started", thread_id: "t-2" }));
    const evs = parse(JSON.stringify({ type: "turn.failed", error: { message: "usage limit reached" } }));
    expect(evs.find((e) => e.kind === "result")).toMatchObject({ res: { is_error: true, result: "usage limit reached" } });
  });
  it("строка команды без обёртки оболочки", () => {
    expect(codexCommand("/bin/bash -lc 'ls -la'")).toBe("ls -la");
    expect(codexCommand("ls")).toBe("ls");
  });
});

describe("бюджет по журналу Codex", () => {
  it("вызовы, review и рендеры считаются; вместо долларов — подписка", () => {
    const dir = tmp();
    const ev = (o: object) => JSON.stringify(o);
    writeFileSync(join(dir, "director.log"), [
      `===== ${new Date().toISOString()} запуск директора (этап A, codex)`,
      ev({ type: "thread.started", thread_id: "t" }),
      ev({ type: "item.started", item: { type: "command_execution", command: "/bin/zsh -lc 'npx tsx .claude/skills/self-review/review.ts'" } }),
      ev({ type: "item.started", item: { type: "command_execution", command: "/bin/zsh -lc 'studio render --scale 0.5'" } }),
      ev({ type: "item.started", item: { type: "command_execution", command: "/bin/zsh -lc 'studio render --audio-only'" } }),
      ev({ type: "item.started", item: { type: "agent_message", text: "…" } }),
    ].join("\n"));
    const b = readBudget(dir)!;
    expect(b).toMatchObject({ agent: "codex", usd: 0, calls: 3, reviews: 1, renders: 1 });
    expect(budgetLine(dir)).toMatch(/^бюджет: подписка Codex · \d+ мин из \d+ · вызовов 3/);
  });
});

describe("картинки по подписке Codex", () => {
  it("готовность: есть Codex CLI и вход", () => {
    expect(imageConfig({ IMAGE_PROVIDER: "codex", CODEX_BIN: BIN, CODEX_HOME: codexHome({ auth_mode: "chatgpt", tokens: {} }) }))
      .toMatchObject({ ready: true, transparency: true, refs: true, tag: "codex:image_gen" });
    expect(imageConfig({ IMAGE_PROVIDER: "codex", CODEX_BIN: BIN, CODEX_HOME: codexHome(null) }).problem).toMatch(/codex login/);
  });
  it("промпт: одна картинка, размер, фон, референсы", () => {
    const p = codexImagePrompt("a red apple", { size: "1024x1536", background: "transparent", quality: "high" }, 2);
    expect(p).toMatch(/exactly one image/);
    expect(p).toMatch(/1024x1536 \(portrait\)/);
    expect(p).toMatch(/transparent/);
    expect(p).toMatch(/2 attached images/);
    expect(p.endsWith("a red apple")).toBe(true);
  });
  it("картинка берётся из generated_images/<сессия>; референсы уходят через -i", async () => {
    const home = codexHome({ auth_mode: "chatgpt", tokens: {} });
    const env = { IMAGE_PROVIDER: "codex", CODEX_BIN: "/usr/bin/codex", CODEX_HOME: home };
    let seen = "", refsSeen = 0, prompt = "";
    const run = (cmd: string, _t: number, e?: Record<string, string | undefined>) => {
      seen = cmd;
      refsSeen = Object.keys(e ?? {}).filter((k) => /^STUDIO_CMD_REF\d+$/.test(k)).length;
      prompt = readFileSync(e!.STUDIO_CMD_PROMPT_FILE!, "utf8");
      const out = join(home, "generated_images", "t-9");
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, "old.png"), "OLD");
      utimesSync(join(out, "old.png"), new Date(1000), new Date(1000));
      writeFileSync(join(out, "new.png"), "PNGDATA");
      writeFileSync(e!.STUDIO_CMD_EVENTS!, JSON.stringify({ type: "thread.started", thread_id: "t-9" }) + "\n");
      return { status: 0, stderr: "" };
    };
    const r = await image("a fox", { size: "1024x1024", background: "transparent" }, [Buffer.from("a"), Buffer.from("b")], { env, run });
    expect(r.data.toString()).toBe("PNGDATA");
    expect(seen).toMatch(/exec --json --ephemeral .*-s read-only .*-i "\$\{STUDIO_CMD_REF1\}" -i "\$\{STUDIO_CMD_REF2\}" - < /);
    expect(refsSeen).toBe(2);
    expect(prompt).toMatch(/a fox$/);
  });
  it("картинки нет — ошибка со словами Codex", async () => {
    const home = codexHome({ auth_mode: "chatgpt", tokens: {} });
    const run = (_c: string, _t: number, e?: Record<string, string | undefined>) => {
      writeFileSync(e!.STUDIO_CMD_EVENTS!, [
        { type: "thread.started", thread_id: "t-0" },
        { type: "item.completed", item: { type: "agent_message", text: "I can't create that image." } },
      ].map((x) => JSON.stringify(x)).join("\n"));
      return { status: 0, stderr: "" };
    };
    await expect(image("x", {}, [], { env: { IMAGE_PROVIDER: "codex", CODEX_BIN: "/usr/bin/codex", CODEX_HOME: home }, run })).rejects.toThrow(/картинки нет: I can't create/);
  });
});

describe("окружение и студия", () => {
  it("директору не достаются переменные песочницы родительского Codex; вход Codex остаётся", () => {
    const out = directorEnv({ CODEX_SANDBOX: "seatbelt", CODEX_SANDBOX_NETWORK_DISABLED: "1", CODEX_API_KEY: "k", CODEX_HOME: "/h", PATH: "/bin" }, []);
    expect(out).toEqual({ CODEX_API_KEY: "k", CODEX_HOME: "/h", PATH: "/bin" });
  });
  it("сверка studio/: добавленные, изменённые и удалённые файлы", () => {
    const root = tmp();
    mkdirSync(join(root, "skills", "__pycache__"), { recursive: true });
    writeFileSync(join(root, "CLAUDE.md"), "a");
    writeFileSync(join(root, "skills", "x.md"), "b");
    const before = studioSnapshot(root);
    writeFileSync(join(root, "CLAUDE.md"), "changed");
    writeFileSync(join(root, "skills", "__pycache__", "sx.pyc"), "cache");
    writeFileSync(join(root, "new.ts"), "c");
    expect(studioChanges(before, studioSnapshot(root))).toEqual(["+ studio/new.ts", "~ studio/CLAUDE.md"]);
  });
});
