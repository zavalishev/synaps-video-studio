// Публичный пакет: чистота репозитория, вход для Claude Code (скилл, корневые файлы), примеры
// брифов, окружение режиссёра. Без сети и без запуска claude.
// Public package hygiene: no infrastructure traces or secrets, skill entry, example briefs, director env.
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { directorEnv, shellSecrets } from "../studio/bin/_env";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set(["node_modules", ".git", ".cache", "jobs", "out", ".bundle", ".remotion"]);
const TEXT = /\.(ts|tsx|mjs|js|json|md|py|txt|sh|example|gitignore)$|^(studio|LICENSE|AGENTS\.md|CLAUDE\.md)$/;

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) walk(p, out);
    else if (TEXT.test(e.name) && e.name !== "package-lock.json") out.push(p);
  }
  return out;
};

describe("чистота публичного репозитория", () => {
  const files = walk(ROOT);

  it("нет следов чужой инфраструктуры, адресов и ключей", () => {
    // Части собраны по кусочкам, чтобы этот тест не находил сам себя.
    const banned = [
      ["ae", "za"], ["/opt/", "agent", "hub"], ["agent", "hub"], ["LLM_", "PROXY"], ["cli-", "proxy"],
      ["syn", "aps"], ["Син", "апс"], ["docker ", "exec"],
    ].map((p) => p.join("").toLowerCase());
    const keyLike = [/sk-[A-Za-z0-9_-]{20,}/, /AIza[0-9A-Za-z_-]{30,}/, /xi-api-key:\s*[0-9a-f]{20,}/i];
    const ipLike = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
    const hits: string[] = [];
    for (const f of files) {
      const s = readFileSync(f, "utf8");
      const low = s.toLowerCase();
      for (const b of banned) if (low.includes(b)) hits.push(`${relative(ROOT, f)}: «${b}»`);
      // Фальшивые ключи тестов провайдеров узнаются по словам-маркерам (test, secret, …).
      const fake = /test|secret|other|abcdef|img-|xxxx/i;
      for (const k of keyLike) for (const m of s.matchAll(new RegExp(k.source, k.flags + "g"))) if (!fake.test(m[0])) hits.push(`${relative(ROOT, f)}: похоже на ключ`);
      const ip = s.match(ipLike)?.[0];
      if (ip && !/^(127\.0\.0\.1|0\.0\.0\.0)$/.test(ip)) hits.push(`${relative(ROOT, f)}: IP ${ip}`);
    }
    expect(hits).toEqual([]);
  });

  it(".env не лежит в репозитории, образец .env.example — есть и без ключей", () => {
    const ignore = readFileSync(join(ROOT, ".gitignore"), "utf8").split("\n");
    for (const rule of [".env", "jobs/", "out/", ".cache/", "node_modules/"]) expect(ignore).toContain(rule);
    expect(ignore).toContain("!.env.example");
    const ex = readFileSync(join(ROOT, ".env.example"), "utf8");
    for (const line of ex.split("\n").filter((l) => /^[A-Z_]+_KEY\s*=/.test(l))) expect(line).toMatch(/=\s*$/);
  });

  it("package.json готов к публикации", () => {
    const p = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(p).toMatchObject({ name: "ai-video-studio", version: "0.1.0", private: false, license: "MIT" });
    expect(p.repository?.url).toContain("ai-video-studio");
    expect(Object.keys(p.scripts)).toEqual(expect.arrayContaining(["setup", "make", "doctor", "typecheck", "test"]));
  });

  it("лицензии: MIT, сторонние компоненты, Remotion отмечен в README", () => {
    expect(readFileSync(join(ROOT, "LICENSE"), "utf8")).toMatch(/^MIT License[\s\S]*Copyright \(c\) 2026/);
    const notices = readFileSync(join(ROOT, "THIRD_PARTY_NOTICES.md"), "utf8");
    for (const w of ["Remotion", "Kenney", "CC0", "OpenGameArt", "Open Font License"]) expect(notices).toContain(w);
    const catalog = JSON.parse(readFileSync(join(ROOT, "public/music/catalog.json"), "utf8"));
    for (const t of catalog.tracks ?? catalog) expect(notices).toContain(t.file);
    for (const f of ["README.md", "README.en.md"]) expect(readFileSync(join(ROOT, f), "utf8")).toContain("remotion.dev/license");
  });
});

describe("вход для агентов", () => {
  it("скилл make-video: имя, описание с триггерами, путь к руководству", () => {
    const md = readFileSync(join(ROOT, ".claude/skills/make-video/SKILL.md"), "utf8");
    const fm = md.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
    expect(fm).toMatch(/^name: make-video$/m);
    expect(fm).toMatch(/^description: .*ролик/m);
    expect(md).toContain("studio/CLAUDE.md");
    expect(md).toContain("npm run -s make");
  });

  it("корневые CLAUDE.md и AGENTS.md короткие и уступают руководству в папке ролика", () => {
    for (const f of ["CLAUDE.md", "AGENTS.md"]) {
      const s = readFileSync(join(ROOT, f), "utf8");
      expect(s.split("\n").length).toBeLessThan(40); // их читает и режиссёр в jobs/<slug> — дорогие токены
      expect(s).toContain("jobs/<slug>");
    }
  });

  it("примеры брифов: шесть жанров и английский, у каждого заголовок, публикующий, пометка «вымышлено»", () => {
    const dir = join(ROOT, "examples/briefs");
    const briefs = readdirSync(dir).filter((f) => f.endsWith(".md"));
    expect(briefs.length).toBe(7);
    for (const f of briefs) {
      const s = readFileSync(join(dir, f), "utf8");
      expect(s, f).toMatch(/^# \S/);
      expect(s, f).toMatch(/Кто публикует:|Who publishes:/);
      expect(s, f).toMatch(/вымышлен|made up/);
      expect(s, f).toMatch(/@example_\w+/);
    }
  });

  it("setup — обычный Node без зависимостей (запускается до npm install)", () => {
    const s = readFileSync(join(ROOT, "scripts/setup.mjs"), "utf8");
    const imports = [...s.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    expect(imports.every((m) => m.startsWith("node:"))).toBe(true);
    expect(statSync(join(ROOT, "studio/bin/studio")).mode & 0o111).toBeTruthy();
    expect(existsSync(join(ROOT, ".env.example"))).toBe(true);
  });
});

describe("окружение режиссёра", () => {
  it("без ключей из .env и оболочки и без переменных родительской сессии Claude Code; авторизация остаётся", () => {
    const env = {
      PATH: "/usr/bin", HOME: "/home/u", OPENAI_API_KEY: "from-dotenv",
      CLAUDECODE: "1", CLAUDE_PID: "42", CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_CODE_SESSION_ID: "s",
      CLAUDE_CODE_SSE_PORT: "1", CLAUDE_CODE_MESSAGING_TOKEN: "t", CLAUDE_AGENT_SDK_VERSION: "1",
      CLAUDE_CODE_OAUTH_TOKEN: "user-auth", CLAUDE_CODE_USE_BEDROCK: "1", ELEVENLABS_API_KEY: "from-shell",
      GEMINI_API_KEY: "from-shell", GITHUB_TOKEN: "gh", KIMI_SECRET: "k", HF_TOKEN: "hf", DB_PASSWORD: "p",
      ANTHROPIC_BASE_URL: "https://api.example", AWS_SECRET_ACCESS_KEY: "aws", AWS_REGION: "us-east-1",
    };
    const out = directorEnv(env, ["OPENAI_API_KEY"]);
    expect(Object.keys(out).sort()).toEqual(["ANTHROPIC_BASE_URL", "AWS_REGION", "AWS_SECRET_ACCESS_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "HOME", "PATH"]);
    expect(shellSecrets(env, ["OPENAI_API_KEY"]).sort()).toEqual(["ELEVENLABS_API_KEY", "GEMINI_API_KEY"]);
  });
});
