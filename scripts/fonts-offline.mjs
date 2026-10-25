// Зеркало шрифтов Google с кириллицей для работы без интернета (сервер, закрытая сеть, образ Docker).
//   node scripts/fonts-offline.mjs <папка> [--families Manrope,Unbounded] [--jobs 16]
// Качает woff2 всех начертаний из studio/lib/fonts-cyrillic.json (подмножества cyrillic, cyrillic-ext,
// latin, latin-ext) в <папка>/<модуль>/<файл>.woff2. Затем STUDIO_FONTS_DIR=<папка> — и сборка ролика
// берёт шрифты оттуда (studio/bin/_lib.ts offlineFonts, studio/lib/fonts.ts). Повторный запуск
// докачивает только недостающее.
// Offline mirror of Cyrillic Google Fonts; set STUDIO_FONTS_DIR to use it.
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(join(ROOT, "package.json"));
const argv = process.argv.slice(2);
const out = argv.find((a) => !a.startsWith("--"));
if (!out) { console.error("нужна папка: node scripts/fonts-offline.mjs <папка>"); process.exit(1); }
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const only = opt("families")?.split(",").map((s) => s.trim()).filter(Boolean);
const JOBS = Number(opt("jobs") ?? 16);
const SUBSETS = ["cyrillic", "cyrillic-ext", "latin", "latin-ext"];

const list = JSON.parse(readFileSync(join(ROOT, "studio/lib/fonts-cyrillic.json"), "utf8"))
  .filter((f) => !only || only.includes(f.module));
const tasks = [];
for (const f of list) {
  const info = req(`@remotion/google-fonts/${f.module}`).getInfo();
  for (const [style, weights] of Object.entries(info.fonts))
    for (const [, subsets] of Object.entries(weights))
      for (const s of SUBSETS) if (subsets[s]) tasks.push({ dir: join(out, info.importName), url: subsets[s] });
}
const uniq = [...new Map(tasks.map((t) => [t.url, t])).values()];
let done = 0, skipped = 0, failed = 0, bytes = 0;
// Имя файла — конец адреса; слишком длинные (вариативные шрифты) — последние 120 знаков.
// То же правило — в studio/lib/fonts.ts (offlineName).
const offlineName = (url) => { const n = url.split("/").pop(); return n.length > 200 ? n.slice(-120) : n; };
const one = async ({ dir, url }) => {
  const file = join(dir, offlineName(url));
  if (existsSync(file)) { skipped++; return; }
  mkdirSync(dir, { recursive: true });
  for (let k = 1; k <= 3; k++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const b = Buffer.from(await r.arrayBuffer());
      writeFileSync(file + ".part", b); renameSync(file + ".part", file);
      bytes += b.length; done++; return;
    } catch (e) { if (k === 3) { failed++; console.error(`не скачан ${url}: ${e.message}`); } }
  }
};
let i = 0;
await Promise.all(Array.from({ length: JOBS }, async () => { while (i < uniq.length) await one(uniq[i++]); }));
console.log(`шрифты: ${list.length} семейств, файлов ${uniq.length}: скачано ${done} (${(bytes / 1e6).toFixed(1)} МБ), уже были ${skipped}, ошибок ${failed} → ${out}`);
process.exit(failed ? 1 : 0);
