#!/usr/bin/env node
// Первая настройка студии: npm run setup [-- --yes] [-- --no-whisper] [-- --no-browser] [-- --skip-install]
//   1) Node ≥ 22; 2) npm ci (точные версии из package-lock.json); 3) ffmpeg, агент-режиссёр (Claude Code или Codex CLI), Blender, whisper.cpp — есть ли и как поставить;
//   4) .env из .env.example (если ещё нет); 5) по желанию скачать модель whisper.cpp (бесплатно, ≈ 0,5 ГБ);
//   6) браузер для рендера Remotion (Chrome Headless Shell, бесплатно); 7) studio doctor.
// Ничего платного не вызывает и ключей не печатает. Plain Node, no dependencies (runs before npm install).
// First-time setup. Free, no paid API calls, never prints keys.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const YES = args.has("--yes") || args.has("-y");
const mac = platform() === "darwin";
const ok = (s) => console.log(`  ✓ ${s}`);
const warn = (s) => console.log(`  ! ${s}`);
const bad = (s) => console.log(`  ✗ ${s}`);
const step = (s) => console.log(`\n== ${s}`);
const hint = (brew, apt) => (mac ? brew : apt);

const which = (cmd) => {
  const r = spawnSync("sh", ["-c", 'command -v "$1"', "sh", cmd], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() || null : null;
};
const version = (bin, a = ["--version"]) => {
  const r = spawnSync(bin, a, { encoding: "utf8", timeout: 20_000 });
  return r.status === 0 ? (r.stdout || r.stderr).split("\n")[0].trim() : null;
};
const expandHome = (p) => (p === "~" ? homedir() : p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);
const dotenv = (file) => {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.trim().match(/^(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/\s+#.*$/, "").replace(/^(['"])(.*)\1$/, "$2").trim();
  }
  return out;
};
const ask = async (q) => {
  if (YES) return true;
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`  ? ${q} [y/N] `)).trim().toLowerCase();
  rl.close();
  return a === "y" || a === "yes" || a === "д" || a === "да";
};

let fatal = 0;

step("Node");
const major = Number(process.versions.node.split(".")[0]);
if (major >= 22) ok(`Node ${process.versions.node}`);
else { bad(`Node ${process.versions.node} — нужен 22+ (лучше 24): ${hint("brew install node", "https://nodejs.org или nvm install 24")}`); process.exit(1); }

step("Пакеты (npm ci)");
if (args.has("--skip-install")) warn("пропущено (--skip-install)");
else {
  // npm ci ставит ровно то, что в package-lock.json (с проверкой хешей), и не обновляет его.
  const r = spawnSync("npm", ["ci", "--no-audit", "--no-fund"], { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) { bad("npm ci не прошёл — см. вывод выше"); process.exit(1); }
  ok("пакеты установлены");
}

step("Программы");
const ffmpeg = which("ffmpeg"), ffprobe = which("ffprobe");
if (ffmpeg && ffprobe) ok(version(ffmpeg, ["-version"]) ?? "ffmpeg");
else { bad(`ffmpeg/ffprobe не найдены — без них нет рендера и звука: ${hint("brew install ffmpeg", "sudo apt install ffmpeg")}`); fatal++; }

const env = { ...dotenv(join(ROOT, ".env")), ...process.env };
// Режиссёр — любой из двух агентов по подписке пользователя: Claude Code или Codex CLI.
const claude = (env.CLAUDE_BIN && expandHome(env.CLAUDE_BIN)) || [join(homedir(), ".local/bin/claude")].find(existsSync) || which("claude");
const codex = (env.CODEX_BIN && expandHome(env.CODEX_BIN)) || ["/opt/homebrew/bin/codex", "/usr/local/bin/codex", join(homedir(), ".local/bin/codex")].find(existsSync) || which("codex");
const codexHome = env.CODEX_HOME ? expandHome(env.CODEX_HOME) : join(homedir(), ".codex");
if (claude && version(claude)) ok(`Claude Code ${version(claude)} — режиссёр по подписке Claude (войдите один раз: запустите claude)`);
if (codex && version(codex)) ok(`Codex CLI ${version(codex)} — режиссёр по подписке ChatGPT${existsSync(join(codexHome, "auth.json")) ? "" : " (войдите один раз: codex login)"}; картинки по подписке — IMAGE_PROVIDER=codex`);
if (!(claude && version(claude)) && !(codex && version(codex))) { bad("нет агента-режиссёра — поставьте хотя бы один: Claude Code (curl -fsSL https://claude.ai/install.sh | bash) или Codex CLI (npm i -g @openai/codex)"); fatal++; }
if (env.ANTHROPIC_API_KEY?.trim()) warn("задан ANTHROPIC_API_KEY — Claude Code будет списывать работу с API-счёта, а не с подписки");

const blender = (env.BLENDER && expandHome(env.BLENDER)) || ["/opt/homebrew/bin/blender", "/usr/local/bin/blender", "/Applications/Blender.app/Contents/MacOS/Blender", "/usr/bin/blender", "/snap/bin/blender"].find(existsSync) || which("blender");
if (blender) ok(`Blender: ${blender} (3D-ассеты)`);
else warn(`Blender не найден (необязательно, 3D-ассеты): ${hint("brew install --cask blender", "sudo snap install blender --classic")}`);

const whisper = (env.WHISPER_CPP_BIN && (existsSync(expandHome(env.WHISPER_CPP_BIN)) ? expandHome(env.WHISPER_CPP_BIN) : which(env.WHISPER_CPP_BIN))) || which("whisper-cli") || which("whisper-cpp");
if (whisper) ok(`whisper.cpp: ${whisper} (тайминги слов для субтитров)`);
else warn(`whisper.cpp не найден (необязательно, точные тайминги слов): ${hint("brew install whisper-cpp", "соберите https://github.com/ggml-org/whisper.cpp")}`);

step(".env");
const envFile = join(ROOT, ".env");
if (existsSync(envFile)) ok(".env уже есть — не трогаю");
else { copyFileSync(join(ROOT, ".env.example"), envFile); ok(".env создан из .env.example — впишите своих провайдеров (или оставьте none)"); }

step("Модель whisper.cpp");
// Модели — с зафиксированного коммита репозитория на Hugging Face, с проверкой SHA-256 (хеши —
// из LFS-метаданных этого коммита). Другая модель — скачайте сами и впишите WHISPER_CPP_MODEL.
const WHISPER_REV = "5359861c739e955e79d9a303bcbc70fb988958b1";
const WHISPER_SHA256 = {
  tiny: "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21",
  base: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
  small: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
  medium: "6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208",
  "large-v3-turbo": "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69",
};
const sha256File = (file) => new Promise((res, rej) => {
  const h = createHash("sha256");
  createReadStream(file).on("data", (b) => h.update(b)).on("error", rej).on("end", () => res(h.digest("hex")));
});
const MODEL = (() => { const m = [...args].find((a) => a.startsWith("--whisper-model=")); return m ? m.split("=")[1] : "small"; })();
const modelSet = env.WHISPER_CPP_MODEL || env.WHISPER_MODEL;
const known = [
  join(homedir(), ".cache/whisper/ggml-small.bin"), join(homedir(), ".cache/whisper.cpp/ggml-small.bin"),
  join(homedir(), "models/ggml-small.bin"), "/opt/homebrew/share/whisper-cpp/ggml-small.bin",
  "/usr/local/share/whisper-cpp/ggml-small.bin", "/usr/share/whisper-cpp/ggml-small.bin",
].find(existsSync);
if (args.has("--no-whisper")) warn("пропущено (--no-whisper)");
else if (modelSet) (existsSync(expandHome(modelSet)) ? ok : warn)(`WHISPER_CPP_MODEL=${modelSet}${existsSync(expandHome(modelSet)) ? "" : " — файла нет"}`);
else if (known) ok(`модель найдена: ${known}`);
else if (!whisper) warn("сначала поставьте whisper.cpp, затем снова npm run setup — предложу скачать модель");
else if (!WHISPER_SHA256[MODEL]) warn(`модель ${MODEL}: нет проверенного хеша (есть: ${Object.keys(WHISPER_SHA256).join(", ")}) — скачайте сами и впишите WHISPER_CPP_MODEL в .env`);
else {
  const dst = join(homedir(), ".cache/whisper", `ggml-${MODEL}.bin`);
  const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/${WHISPER_REV}/ggml-${MODEL}.bin`;
  if (await ask(`Скачать модель whisper.cpp ggml-${MODEL}.bin (${MODEL === "small" ? "≈ 0,5 ГБ" : "размер по модели"}, бесплатно) в ${dst}?`)) {
    mkdirSync(dirname(dst), { recursive: true });
    const tmp = dst + ".part";
    const r = spawnSync("curl", ["-fL", "--retry", "3", "-o", tmp, url], { stdio: "inherit" });
    const sum = r.status === 0 ? await sha256File(tmp).catch(() => "") : "";
    if (r.status === 0 && sum !== WHISPER_SHA256[MODEL]) {
      rmSync(tmp, { force: true }); bad(`модель скачалась, но SHA-256 не совпал (${sum.slice(0, 16)}… вместо ${WHISPER_SHA256[MODEL].slice(0, 16)}…) — файл удалён`);
    } else if (r.status === 0) {
      renameSync(tmp, dst); ok(`модель: ${dst} (SHA-256 проверен)`);
      if (MODEL !== "small") warn(`не small — впишите в .env: WHISPER_CPP_MODEL=${dst}`);
    } else { rmSync(tmp, { force: true }); warn(`не скачалось — вручную: curl -fL -o ${dst} ${url}`); }
  } else warn(`пропущено; вручную: curl -fL -o ${dst} ${url}`);
}

step("Браузер для рендера (Remotion)");
if (args.has("--no-browser") || args.has("--skip-install")) warn("пропущено — Remotion скачает его при первом рендере");
else {
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", "const r = await import('@remotion/renderer'); await r.ensureBrowser();"], { cwd: ROOT, stdio: "inherit" });
  if (r.status === 0) ok("Chrome Headless Shell готов");
  else warn("не получилось — Remotion попробует ещё раз при первом рендере");
}

step("studio doctor");
spawnSync(join(ROOT, "studio/bin/studio"), ["doctor"], { cwd: ROOT, stdio: "inherit" });

console.log(fatal
  ? "\nНе хватает обязательного (✗ выше) — поставьте и запустите npm run setup ещё раз."
  : `\nГотово. Дальше:
  claude  или  codex                        # в этой папке: «сделай ролик про …» (скилл make-video)
  npm run make -- --brief examples/briefs/01-coffee-promo.md   # или целиком без окна (--agent claude|codex)`);
process.exit(fatal ? 1 : 0);
