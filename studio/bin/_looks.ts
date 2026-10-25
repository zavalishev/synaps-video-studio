// Облик последних роликов студии: реестр (обезличенные отпечатки) + соседние папки jobs/.
// Для studio looks (до выбора направлений), board.ts (палитра от предмета — по пикселям) и
// критика (out/recent-looks.png — кадры 0 соседей по ленте без имён).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import sharp from "sharp";
import { dominantColors, layoutOf, lookCell, type Layout } from "../lib/art-direction/looks";
import { readRegistry, registryId, voiceOf } from "./_registry";
import { ROOT } from "./_lib";

export type Look = { id: string; label: string; at: string; bg?: string; ink?: string; accent?: string; cell?: string; voice?: string; display?: string; layout?: Layout; note?: string; story?: string; job?: string };

// Новые сначала; свой ролик (dir) не входит.
export const recentLooks = (dir: string | null, n = 10): Look[] => {
  const jobsDir = join(ROOT, "jobs");
  const byId = new Map<string, string>(); // id реестра → папка ролика (только локально, для превью)
  const local: Look[] = [];
  if (existsSync(jobsDir)) {
    for (const d of readdirSync(jobsDir)) {
      if (d.startsWith("_") || d.startsWith("t-")) continue;
      const jd = join(jobsDir, d);
      if (dir && jd === dir) continue;
      const tf = join(jd, "theme.json");
      if (!existsSync(tf)) continue;
      byId.set(registryId(jd), jd);
      try {
        const t = JSON.parse(readFileSync(tf, "utf8"));
        local.push({ id: registryId(jd), label: d, at: new Date(statSync(tf).mtimeMs).toISOString(), bg: t.palette?.bg, ink: t.palette?.ink, accent: t.palette?.accent, cell: lookCell(t.palette?.bg, t.palette?.accent)?.key, voice: voiceOf(t.fonts?.display?.module), display: t.fonts?.display?.module, layout: layoutOf(t), story: t.story?.form, job: jd });
      } catch { /* битая тема */ }
    }
  }
  const reg: Look[] = readRegistry(dir ?? undefined, 60).map((f, i) => ({
    id: f.id, label: byId.has(f.id) ? basename(byId.get(f.id)!) : `ролик ${i + 1}`, at: f.at, bg: f.bg, ink: f.ink, accent: f.accentColor,
    cell: f.cell ?? lookCell(f.bg, f.accentColor)?.key, voice: f.voice ?? voiceOf(f.display), display: f.display,
    layout: f.layout ?? layoutOf({ type: { align: f.align, lockup: f.lockup }, shapes: { plate: f.plate } }), note: f.note, story: f.storyForm, job: byId.get(f.id),
  }));
  const all = new Map<string, Look>();
  for (const l of [...local, ...reg]) { const p = all.get(l.id); all.set(l.id, p ? { ...p, ...Object.fromEntries(Object.entries(l).filter(([, v]) => v !== undefined)), at: p.at > l.at ? p.at : l.at } as Look : l); }
  return [...all.values()].sort((p, q) => (q.at > p.at ? 1 : -1)).slice(0, n);
};

// Заметные цвета картинок ролика (public/img, public/brand/photos): фото и вырезки героя.
export const assetColors = async (dir: string, maxFiles = 16): Promise<Array<{ hex: string; share: number; file: string }>> => {
  const files: string[] = [];
  for (const sub of ["public/img", "public/brand/photos", "public/brand"]) {
    const d = join(dir, sub);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) if (/\.(png|jpe?g|webp)$/i.test(f) && !/logo/i.test(f)) files.push(join(d, f));
  }
  const out: Array<{ hex: string; share: number; file: string }> = [];
  for (const f of files.slice(0, maxFiles)) {
    try {
      const { data, info } = await sharp(f).resize(48, 48, { fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      for (const c of dominantColors(data, info.channels, 0.03).slice(0, 8)) out.push({ ...c, file: basename(f) });
    } catch { /* не картинка */ }
  }
  return out;
};

// Кадр 0 готового ролика (или черновика) — превью в ленте.
const frame0 = (job?: string): string | null => {
  if (!job) return null;
  const src = [join(job, "out", "final.mp4"), join(job, "out", "review", "draft.mp4")].find(existsSync);
  if (!src) return null;
  const cache = join(ROOT, ".cache", "looks");
  mkdirSync(cache, { recursive: true });
  const out = join(cache, `${registryId(job)}-${Math.round(statSync(src).mtimeMs)}.png`);
  if (!existsSync(out)) spawnSync("ffmpeg", ["-v", "error", "-y", "-i", src, "-frames:v", "1", "-vf", "scale=240:-2", out]);
  return existsSync(out) ? out : null;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
// Лист «соседи по ленте»: кадр 0 каждого из последних роликов (если есть) и полоса палитры.
// anonymous — без имён папок (для критика).
export const renderRecentLooks = async (looks: Look[], out: string, o: { anonymous?: boolean; mine?: { bg?: string; ink?: string; accent?: string; frame?: string | null } } = {}): Promise<string | null> => {
  const TW = 240, TH = 427, SW = 40, GAP = 10, LAB = 34;
  const tiles = [...looks.slice(0, 8)];
  const cols = tiles.length + (o.mine ? 1 : 0);
  if (!cols) return null;
  const W = cols * (TW + GAP) + GAP, H = LAB + TH + SW + GAP * 2;
  const parts: sharp.OverlayOptions[] = [];
  const tile = async (l: { bg?: string; ink?: string; accent?: string }, frame: string | null, label: string, x: number) => {
    const bg = l.bg ?? "#777", ink = l.ink ?? "#111", ac = l.accent ?? "#999";
    const lab = Buffer.from(`<svg width="${TW}" height="${LAB}" xmlns="http://www.w3.org/2000/svg"><text x="4" y="24" font-family="Helvetica" font-size="18" fill="#eee">${esc(label)}</text></svg>`);
    parts.push({ input: lab, left: x, top: GAP });
    if (frame) parts.push({ input: await sharp(frame).resize(TW, TH, { fit: "cover" }).png().toBuffer(), left: x, top: GAP + LAB });
    else parts.push({ input: Buffer.from(`<svg width="${TW}" height="${TH}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${bg}"/><rect x="24" y="${TH * 0.62}" width="${TW - 48}" height="40" fill="${ac}"/><text x="24" y="${TH * 0.35}" font-family="Helvetica" font-weight="bold" font-size="40" fill="${ink}">Аа 123</text><text x="24" y="${TH - 20}" font-family="Helvetica" font-size="14" fill="${ink}">нет кадра — только палитра</text></svg>`), left: x, top: GAP + LAB });
    parts.push({ input: Buffer.from(`<svg width="${TW}" height="${SW}" xmlns="http://www.w3.org/2000/svg"><rect width="${TW / 3}" height="${SW}" fill="${bg}"/><rect x="${TW / 3}" width="${TW / 3}" height="${SW}" fill="${ink}"/><rect x="${(2 * TW) / 3}" width="${TW / 3}" height="${SW}" fill="${ac}"/></svg>`), left: x, top: GAP + LAB + TH });
  };
  let x = GAP;
  if (o.mine) { await tile(o.mine, o.mine.frame ?? null, "ЭТОТ РОЛИК", x); x += TW + GAP; }
  for (let i = 0; i < tiles.length; i++) { await tile(tiles[i], frame0(tiles[i].job), o.anonymous ? `сосед ${i + 1}` : tiles[i].label.slice(0, 22), x); x += TW + GAP; }
  mkdirSync(dirname(out), { recursive: true });
  await sharp({ create: { width: W, height: H, channels: 3, background: "#1c1c1c" } }).composite(parts).png().toFile(out);
  return out;
};
