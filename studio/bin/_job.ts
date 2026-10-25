// Создание папки ролика jobs/<slug> из studio/template (общая часть new.ts и make.ts).
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { ROOT, STUDIO } from "./_lib";

export const JOBS = join(ROOT, "jobs");

export const slugify = (s: string) =>
  s.toLowerCase().replace(/ё/g, "е")
    .replace(/[а-я]/g, (c) => ({ а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" } as Record<string, string>)[c] ?? "")
    .replace(/[^a-z0-9_]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "job"; // «_» в начале сохраняется (_skilltest-*)

export const linkSkills = (dir: string) => {
  const skillsDir = join(dir, ".claude", "skills");
  mkdirSync(skillsDir, { recursive: true });
  const src = join(STUDIO, "skills");
  for (const name of readdirSync(src, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    const link = join(skillsDir, name);
    if (!existsSync(link)) symlinkSync(relative(skillsDir, join(src, name)), link);
  }
};

// author — подпись публикующего (аккаунт, бренд) из профиля пользователя продукта: директор
// ставит её в финал, если уместно; нет — открытый вопрос в notes.md, а не молчаливый пропуск.
// brand — папка материалов заказчика (logo.*, photos/, refs/, brand.json) → public/brand/ и
// job.json.brand с путями для staticFile. Фото заказчика — настоящий товар/место: их берут
// героями (вырезка, PhotoLayers, --ref), генерация — только недостающего.
const IMG = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg"]);
export const importBrand = (dir: string, src: string) => {
  if (!existsSync(src) || !statSync(src).isDirectory()) throw new Error(`--brand: нет папки ${src}`);
  const dst = join(dir, "public", "brand");
  cpSync(src, dst, { recursive: true });
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
