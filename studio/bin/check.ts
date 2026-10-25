// Быстрые блокирующие проверки до рендера (секунды, без браузера):
//   studio check [--job dir]
//   1) TypeScript (tsc --noEmit по tsconfig ролика);
//   2) недетерминизм в src/: Math.random, Date.now, new Date(), performance.now, useFrame,
//      clock.getElapsedTime, CSS animation/transition — всё это даёт «прыжки» и разные
//      кадры в разных вкладках рендера. Разрешено: useCurrentFrame, random(seed) из remotion.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { jobDir, parseArgs, ROOT } from "./_lib";

const a = parseArgs();
const dir = jobDir(a);
let bad = 0;

const tsc = spawnSync(join(ROOT, "node_modules/.bin/tsc"), ["--noEmit", "-p", join(dir, "tsconfig.json")], { encoding: "utf8" });
if (tsc.status !== 0) { bad++; console.log("TypeScript: ошибки\n" + (tsc.stdout + tsc.stderr).trim()); } else console.log("TypeScript: ок");

const FORBIDDEN: Array<[RegExp, string]> = [
  [/Math\.random\s*\(/, "Math.random — берите random(seed) из remotion"],
  [/Date\.now\s*\(|new Date\s*\(\s*\)|performance\.now\s*\(/, "время системы — берите useCurrentFrame()"],
  [/\buseFrame\s*\(/, "useFrame (R3F) — камеру и анимацию считайте от useCurrentFrame()"],
  [/getElapsedTime\s*\(/, "clock.getElapsedTime — только от кадра"],
  [/\b(animation|transition)\s*:\s*["'`][^"'`]*\d+(m?s)/, "CSS animation/transition — в рендере не работают по кадрам"],
  [/@keyframes/, "CSS @keyframes — не по кадрам"],
];
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|css)$/.test(f) ? [p] : [];
});
const hits: string[] = [];
for (const f of walk(join(dir, "src"))) {
  readFileSync(f, "utf8").split("\n").forEach((line, i) => {
    if (/^\s*\/\//.test(line)) return;
    for (const [re, why] of FORBIDDEN) if (re.test(line)) hits.push(`${relative(dir, f)}:${i + 1}: ${why}\n    ${line.trim()}`);
  });
}
if (hits.length) { bad++; console.log(`Детерминизм: ${hits.length} нарушений\n` + hits.join("\n")); } else console.log("Детерминизм: ок");
process.exit(bad ? 1 : 0);
