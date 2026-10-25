// Контактный лист: кадры ролика или набор PNG одним изображением с подписями — смотреть
// глазами (Read) весь ролик или движение за несколько соседних кадров.
//   studio sheet out/final.mp4 [--n 12] [--cols 4] [--width 270] [--out out/sheet.png]
//   studio sheet out/final.mp4 --frames 40-45 --cols 6       # лента движения: 6 соседних кадров
//   studio sheet out/final.mp4 --frames 0,30,60,90
//   studio sheet out/stills [--cols 4]                        # все PNG папки
//   studio sheet a.png b.png c.png
// Подпись: номер кадра и время (для mp4) или имя файла.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import { die, ensureDir, num, parseArgs, str } from "./_lib";

const a = parseArgs();
if (!a._.length) die("нужен mp4, папка или PNG: studio sheet out/final.mp4");
const cols0 = num(a, "cols");
const width = num(a, "width", 270)!;

type Tile = { file: string; label: string };

const probeVideo = (p: string) => {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets,r_frame_rate", "-of", "json", p]).stdout.toString();
  const s = JSON.parse(r).streams[0];
  const [n, d] = s.r_frame_rate.split("/").map(Number);
  return { frames: Number(s.nb_read_packets), fps: n / d };
};

const fromVideo = (p: string, tmp: string): Tile[] => {
  const { frames, fps } = probeVideo(p);
  const spec = str(a, "frames");
  let list: number[] = [];
  if (spec) {
    for (const tok of spec.split(",")) {
      if (/^\d+-\d+$/.test(tok)) { const [x, y] = tok.split("-").map(Number); for (let f = x; f <= y; f++) list.push(f); }
      else list.push(Number(tok));
    }
  } else {
    const n = num(a, "n", 12)!;
    list = Array.from({ length: n }, (_, i) => Math.round((i * (frames - 1)) / Math.max(1, n - 1)));
  }
  list = [...new Set(list.filter((f) => f >= 0 && f < frames))].sort((x, y) => x - y);
  if (!list.length) die("нет кадров в диапазоне");
  const sel = list.map((f) => `eq(n\\,${f})`).join("+");
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", p, "-vf", `select='${sel}',scale=${width}:-2`, "-fps_mode", "passthrough", join(tmp, "f%04d.png")]);
  if (r.status !== 0) die("ffmpeg: " + r.stderr.toString());
  const files = readdirSync(tmp).filter((f) => f.endsWith(".png")).sort();
  return files.map((f, i) => ({ file: join(tmp, f), label: `#${list[i]}  ${(list[i] / fps).toFixed(2)}s` }));
};

const main = async () => {
  const tmp = mkdtempSync(join(tmpdir(), "sheet-"));
  try {
    let tiles: Tile[] = [];
    const first = resolve(a._[0]);
    if (a._.length === 1 && /\.(mp4|mov|webm|mkv)$/i.test(first)) tiles = fromVideo(first, tmp);
    else if (a._.length === 1 && statSync(first).isDirectory()) tiles = readdirSync(first).filter((f) => /\.png$/i.test(f)).sort().map((f) => ({ file: join(first, f), label: f }));
    else tiles = a._.map((f) => ({ file: resolve(f), label: basename(f) }));
    if (!tiles.length) die("нечего собирать");
    const metas = await Promise.all(tiles.map((t) => sharp(t.file).metadata()));
    const ratio = (metas[0].height ?? 1) / (metas[0].width ?? 1);
    const tw = width, th = Math.round(width * ratio), lh = 26;
    const cols = cols0 ?? Math.min(tiles.length, ratio > 1.2 ? 6 : 4);
    const rows = Math.ceil(tiles.length / cols);
    const gap = 6;
    const W = cols * tw + (cols + 1) * gap, H = rows * (th + lh) + (rows + 1) * gap;
    const comps: OverlayOptions[] = [];
    for (let i = 0; i < tiles.length; i++) {
      const x = gap + (i % cols) * (tw + gap), y = gap + Math.floor(i / cols) * (th + lh + gap);
      const img = await sharp(tiles[i].file).resize(tw, th, { fit: "contain", background: "#808080" }).flatten({ background: "#808080" }).png().toBuffer();
      comps.push({ input: img, left: x, top: y + lh });
      const svg = `<svg width="${tw}" height="${lh}" xmlns="http://www.w3.org/2000/svg"><text x="4" y="19" font-family="Menlo, monospace" font-size="16" fill="#fff">${tiles[i].label.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text></svg>`;
      comps.push({ input: Buffer.from(svg), left: x, top: y });
    }
    const defOut = existsSync(first) && statSync(first).isFile() && /\.(mp4|mov|webm|mkv)$/i.test(first)
      ? first.replace(/\.[^.]+$/, str(a, "frames") ? `.strip-${str(a, "frames")!.replace(/[^0-9-]/g, "_")}.png` : ".sheet.png")
      : join(statSync(first).isDirectory() ? first : dirname(first), "sheet.png");
    const out = resolve(str(a, "out") ?? defOut);
    ensureDir(dirname(out));
    await sharp({ create: { width: W, height: H, channels: 3, background: "#555555" } }).composite(comps).png().toFile(out);
    console.log(`${out}  (${tiles.length} кадров, ${W}×${H})`);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
};
main().catch((e) => { console.error("ошибка: " + (e?.message ?? e)); process.exit(1); });
