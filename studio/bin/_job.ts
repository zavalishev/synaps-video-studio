// Создание папки ролика jobs/<slug> из studio/template (общая часть new.ts и make.ts).
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { JOBS_DIR, ROOT, STUDIO } from "./_lib";

export const JOBS = JOBS_DIR;

export const slugify = (s: string) =>
  s.toLowerCase().replace(/ё/g, "е")
    .replace(/[а-я]/g, (c) => ({ а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" } as Record<string, string>)[c] ?? "")
    .replace(/[^a-z0-9_]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "job"; // «_» в начале сохраняется (_skilltest-*)

// Скиллы студии в папке ролика: .claude/skills (Claude Code) и .agents/skills (Codex) — ссылки
// на studio/skills, так что пути вида .claude/skills/self-review/review.ts работают у обоих.
export const SKILL_DIRS = [join(".claude", "skills"), join(".agents", "skills")];
export const linkSkills = (dir: string) => {
  const src = join(STUDIO, "skills");
  const names = readdirSync(src, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  for (const sub of SKILL_DIRS) {
    const skillsDir = join(dir, sub);
    mkdirSync(skillsDir, { recursive: true });
    for (const name of names) {
      const link = join(skillsDir, name);
      if (!existsSync(link)) symlinkSync(relative(skillsDir, join(src, name)), link);
    }
  }
};

// Снимок studio/ (путь → размер и время правки) и разница двух снимков: make.ts сверяет студию
// до и после прогона директора. Кэш Python (__pycache__) и скрытые файлы не считаются.
export const studioSnapshot = (root = STUDIO): Map<string, string> => {
  const m = new Map<string, string>();
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name === "__pycache__" || e.name === "node_modules") continue;
      const f = join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.isFile()) { const st = statSync(f); m.set(relative(root, f), `${st.size}:${st.mtimeMs}`); }
    }
  };
  walk(root);
  return m;
};
export const studioChanges = (a: Map<string, string>, b: Map<string, string>): string[] => {
  const out: string[] = [];
  for (const [k, v] of b) if (!a.has(k)) out.push(`+ studio/${k}`); else if (a.get(k) !== v) out.push(`~ studio/${k}`);
  for (const k of a.keys()) if (!b.has(k)) out.push(`- studio/${k}`);
  return out.sort();
};

// author — подпись публикующего (аккаунт, бренд) из профиля пользователя продукта: директор
// ставит её в финал, если уместно; нет — открытый вопрос в notes.md, а не молчаливый пропуск.
// brand — папка материалов заказчика (logo.*, photos/, refs/, brand.json) → public/brand/ и
// job.json.brand с путями для staticFile. Фото заказчика — настоящий товар/место: их берут
// героями (вырезка, PhotoLayers, --ref), генерация — только недостающего.
const IMG = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg"]);
const BRAND_MAX_BYTES = 25 * 1024 * 1024;
// Копируются только картинки (корень, photos/, refs/) и brand.json: без ссылок (могут вести
// наружу), скрытых файлов и файлов больше 25 МБ — пропущенное печатается.
const copyBrandDir = (src: string, dst: string, depth: number, skipped: string[]) => {
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) {
    const from = join(src, name);
    const st = lstatSync(from);
    if (name.startsWith(".") || st.isSymbolicLink()) { skipped.push(`${from} (скрытый файл или ссылка)`); continue; }
    if (st.isDirectory()) {
      if (depth === 0 && (name === "photos" || name === "refs")) copyBrandDir(from, join(dst, name), 1, skipped);
      else skipped.push(`${from}/ (папка не из photos/, refs/)`);
      continue;
    }
    if (!st.isFile()) continue;
    const ok = IMG.has(extname(name).toLowerCase()) || (depth === 0 && name === "brand.json");
    if (!ok) { skipped.push(`${from} (не картинка)`); continue; }
    if (st.size > BRAND_MAX_BYTES) { skipped.push(`${from} (больше 25 МБ)`); continue; }
    copyFileSync(from, join(dst, name));
  }
};
export const importBrand = (dir: string, src: string) => {
  if (!existsSync(src) || !statSync(src).isDirectory()) throw new Error(`--brand: нет папки ${src}`);
  const dst = join(dir, "public", "brand");
  const skipped: string[] = [];
  copyBrandDir(src, dst, 0, skipped);
  if (skipped.length) console.error(`--brand: пропущено ${skipped.length}: ${skipped.slice(0, 8).join("; ")}${skipped.length > 8 ? " …" : ""}`);
  const list = (sub: string) => existsSync(join(dst, sub)) ? readdirSync(join(dst, sub)).filter((f) => IMG.has(extname(f).toLowerCase())).sort().map((f) => `brand/${sub}/${f}`) : [];
  const logo = readdirSync(dst).find((f) => /^logo\./i.test(f) && IMG.has(extname(f).toLowerCase()));
  let extra: Record<string, unknown> = {};
  try { if (existsSync(join(dst, "brand.json"))) extra = JSON.parse(readFileSync(join(dst, "brand.json"), "utf8")); } catch { /* не JSON — без него */ }
  return { ...extra, ...(logo ? { logo: `brand/${logo}` } : {}), photos: list("photos"), refs: list("refs") };
};

export const createJob = (slug: string, o: { brief?: string; width?: number; height?: number; fps?: number; author?: string; brand?: string } = {}): string => {
  const dir = join(JOBS, slug);
  if (existsSync(dir)) throw new Error(`папка уже есть: ${dir}`);
  cpSync(join(STUDIO, "template"), dir, { recursive: true });
  for (const d of ["out", "public", "assets"]) mkdirSync(join(dir, d), { recursive: true });
  const job = JSON.parse(readFileSync(join(dir, "job.json"), "utf8"));
  if (o.width) job.width = o.width;
  if (o.height) job.height = o.height;
  if (o.fps) job.fps = o.fps;
  if (o.author) job.author = o.author;
  if (o.brand) job.brand = importBrand(dir, o.brand);
  writeFileSync(join(dir, "job.json"), JSON.stringify(job, null, 2) + "\n");
  if (o.brief !== undefined) writeFileSync(join(dir, "brief.md"), o.brief.trim() + "\n");
  writeFileSync(join(dir, "notes.md"), `# Заметки директора: ${slug}\n\n`);
  // Руководство директора: CLAUDE.md (Claude Code) и AGENTS.md (Codex) — ссылки на studio/CLAUDE.md.
  for (const f of ["CLAUDE.md", "AGENTS.md"]) symlinkSync(relative(dir, join(STUDIO, "CLAUDE.md")), join(dir, f));
  linkSkills(dir);
  return dir;
};
