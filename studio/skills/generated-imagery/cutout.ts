// Подготовка вырезки после `studio image --bg transparent` (бесплатно, локально, sharp):
//   npx tsx ../../studio/skills/generated-imagery/cutout.ts public/img/fox.png [--out public/img/fox.cut.png]
//       [--choke 0.2] [--erode 0] [--strong] [--pad 8] [--no-trim] [--preview out/fox.halo.png]
// 1) снимает ореол: альфа «поджимается» (ниже choke·255 — прозрачно, край резче), край
//    съедается на erode px, цвет полупрозрачных пикселей берётся от непрозрачных соседей
//    (светлая/тёмная кайма от фона генерации уходит). По умолчанию мягко (choke 0.2, без
//    съёма края) — пушистые стили (войлок, шерсть, дым) сохраняют ворс; --strong (choke 0.4,
//    erode 1) — для чётких краёв (2D, вектор, пиксель) и явной каймы;
// 2) обрезает пустые поля (остаётся pad px) — вырезка честно вписывается в коробку Cutout;
// 3) превью: вырезка на тёмном, среднем и светлом фоне рядом — откройте Read-ом и проверьте
//    край глазами (критерий «артефакты: ореолы альфы»).
// Печатает размер и долю полупрозрачных пикселей на краю до/после.
import sharp from "sharp";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

const argv = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const FLAGS = ["--no-trim", "--strong"];
const src = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--") && !FLAGS.includes(argv[i - 1])));
if (!src) { console.error("нужен файл: cutout.ts public/img/x.png"); process.exit(2); }
const out = opt("out", src.replace(/\.png$/i, ".cut.png"))!;
const strong = argv.includes("--strong");
const choke = Number(opt("choke", strong ? "0.4" : "0.2"));
const erode = Number(opt("erode", strong ? "1" : "0"));
const pad = Number(opt("pad", "8"));
const preview = opt("preview", out.replace(/^public\//, "out/").replace(/\.png$/i, ".halo.png"))!;

const main = async () => {
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const px = new Uint8ClampedArray(data);
  const A = (i: number) => px[i * 4 + 3];
  const semiBefore = edgeSemi(px, W, H);
  // 1a. поджать альфу: a' = (a − lo)/(255 − lo)
  const lo = choke * 255;
  for (let i = 0; i < W * H; i++) px[i * 4 + 3] = Math.max(0, Math.min(255, ((A(i) - lo) / (255 - lo)) * 255));
  // 1b. съесть край на erode px (минимум альфы в окрестности)
  for (let k = 0; k < erode; k++) {
    const a0 = new Uint8ClampedArray(W * H);
    for (let i = 0; i < W * H; i++) a0[i] = px[i * 4 + 3];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (a0[i] === 0) continue;
      let m = a0[i];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        m = Math.min(m, xx < 0 || yy < 0 || xx >= W || yy >= H ? 0 : a0[yy * W + xx]);
      }
      // мягкий съём: край не рубится в 0, а уходит к соседнему минимуму наполовину
      px[i * 4 + 3] = Math.round((a0[i] + m) / 2);
    }
  }
  // 1c. цвет полупрозрачного края — от непрозрачных соседей (радиус 3)
  const R = 3;
  const src4 = new Uint8ClampedArray(px);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, a = src4[i * 4 + 3];
    if (a === 0 || a >= 250) continue;
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const j = yy * W + xx;
      if (src4[j * 4 + 3] >= 250) { r += src4[j * 4]; g += src4[j * 4 + 1]; b += src4[j * 4 + 2]; n++; }
    }
    if (n) { px[i * 4] = r / n; px[i * 4 + 1] = g / n; px[i * 4 + 2] = b / n; }
  }
  const semiAfter = edgeSemi(px, W, H);
  let img = sharp(Buffer.from(px.buffer), { raw: { width: W, height: H, channels: 4 } }).png();
  let buf = await img.toBuffer();
  if (!argv.includes("--no-trim")) {
    // поля: ограничивающая рамка непрозрачного (альфа > 8)
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (px[(y * W + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) { console.error("картинка целиком прозрачная"); process.exit(1); }
    const l = Math.max(0, x0 - pad), t = Math.max(0, y0 - pad);
    const w = Math.min(W, x1 + pad + 1) - l, h = Math.min(H, y1 + pad + 1) - t;
    buf = await sharp(buf).extract({ left: l, top: t, width: w, height: h }).png().toBuffer();
    // Предмет касается края исходника — скорее всего, он обрезан генерацией.
    if (x0 <= 1 || y0 <= 1 || x1 >= W - 2 || y1 >= H - 2) console.warn("ВНИМАНИЕ: объект касается края исходной картинки — проверьте, не обрезан ли он (перегенерируйте с «generous empty margin»).");
  }
  mkdirSync(dirname(out), { recursive: true });
  await sharp(buf).toFile(out);
  const meta = await sharp(buf).metadata();
  // превью на трёх фонах
  const tile = 360;
  const scaled = await sharp(buf).resize({ width: tile, height: tile, fit: "inside" }).toBuffer();
  const sm = await sharp(scaled).metadata();
  const bgs = ["#141414", "#808080", "#f4f1ea"];
  const comps = await Promise.all(bgs.map(async (c, k) => ({ input: await sharp({ create: { width: tile, height: tile, channels: 4, background: c } }).composite([{ input: scaled, left: Math.round((tile - sm.width!) / 2), top: Math.round((tile - sm.height!) / 2) }]).png().toBuffer(), left: k * tile, top: 0 })));
  mkdirSync(dirname(preview), { recursive: true });
  await sharp({ create: { width: tile * 3, height: tile, channels: 4, background: "#000" } }).composite(comps).png().toFile(preview);
  console.log(`${out}\n  ${meta.width}×${meta.height}; мягкий край (доля полупрозрачных среди видимых): ${(semiBefore * 100).toFixed(1)} % → ${(semiAfter * 100).toFixed(1)} %\n  превью ореола: ${preview}`);
};

// Доля полупрозрачных пикселей (8 < a < 240) среди видимых (a > 8): ширина мягкой каймы.
function edgeSemi(px: Uint8ClampedArray, W: number, H: number) {
  let vis = 0, semi = 0;
  for (let i = 0; i < W * H; i++) { const a = px[i * 4 + 3]; if (a > 8) { vis++; if (a < 240) semi++; } }
  return vis ? semi / vis : 0;
}
main().catch((e) => { console.error("ошибка: " + (e?.message ?? e)); process.exit(1); });
