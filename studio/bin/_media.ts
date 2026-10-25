// Локальные помощники медиа: ffmpeg/ffprobe, хэш для ключей кэша, папки кэша. Без сети.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./_lib";

export const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

export const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export const ffprobeDuration = (p: string): number =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]).toString().trim());

export const ff = (args: string[]) => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
  if (r.status !== 0) throw new Error("ffmpeg: " + r.stderr.toString());
};

// Кэш платных шагов (.cache/<kind> в корне репо, не в git): повтор того же запроса — бесплатно.
export const cacheDir = (kind: string) => {
  const d = join(ROOT, ".cache", kind);
  mkdirSync(d, { recursive: true });
  return d;
};
