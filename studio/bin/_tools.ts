// Где лежат локальные программы студии (macOS и Linux): Blender, whisper.cpp, Claude Code CLI.
// Переменная окружения (или строка в .env) всегда важнее поиска по обычным местам.
// Local tool discovery. An env variable always wins over the usual install locations.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// «~/…» в путях из .env → домашняя папка.
export const expandHome = (p: string) => (p === "~" ? homedir() : p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);

// Есть ли программа в PATH (полный путь или null).
export const which = (cmd: string): string | null => {
  const r = spawnSync("sh", ["-c", 'command -v "$1"', "sh", cmd], { encoding: "utf8" });
  const p = r.status === 0 ? r.stdout.trim() : "";
  return p || null;
};

const firstExisting = (paths: string[]) => paths.find((p) => existsSync(p));
const fromEnv = (v?: string) => (v?.trim() ? expandHome(v.trim()) : undefined);

// Blender: $BLENDER, иначе Homebrew, приложение macOS, Linux, иначе из PATH.
export const blenderBin = (env = process.env): string | null =>
  fromEnv(env.BLENDER) ?? firstExisting(["/opt/homebrew/bin/blender", "/usr/local/bin/blender",
    "/Applications/Blender.app/Contents/MacOS/Blender", "/usr/bin/blender", "/snap/bin/blender"]) ?? which("blender");

// Claude Code CLI: $CLAUDE_BIN, иначе ~/.local/bin/claude (родной установщик), иначе из PATH.
export const claudeBin = (env = process.env): string | null =>
  fromEnv(env.CLAUDE_BIN) ?? firstExisting([join(homedir(), ".local/bin/claude")]) ?? which("claude");

// whisper.cpp: программа $WHISPER_CPP_BIN, иначе whisper-cli (Homebrew: brew install whisper-cpp)
// или whisper-cpp из PATH.
export const whisperBin = (env = process.env): string | null => {
  const set = fromEnv(env.WHISPER_CPP_BIN);
  if (set) return existsSync(set) ? set : which(set);
  return which("whisper-cli") ?? which("whisper-cpp");
};

// Модель whisper.cpp (ggml-*.bin): $WHISPER_CPP_MODEL (или старое имя $WHISPER_MODEL), иначе
// ggml-small.bin из обычных мест.
export const whisperModel = (env = process.env): string | null => {
  const set = fromEnv(env.WHISPER_CPP_MODEL) ?? fromEnv(env.WHISPER_MODEL);
  if (set) return existsSync(set) ? set : null;
  return firstExisting([
    join(homedir(), ".cache/whisper/ggml-small.bin"),
    join(homedir(), ".cache/whisper.cpp/ggml-small.bin"),
    join(homedir(), "models/ggml-small.bin"),
    "/opt/homebrew/share/whisper-cpp/ggml-small.bin",
    "/usr/local/share/whisper-cpp/ggml-small.bin",
    "/usr/share/whisper-cpp/ggml-small.bin",
  ]) ?? null;
};
