// Нарисованный герой: размер по пикселям слоя data-hero, а не по коробке DOM.
// Кадры рендерятся второй раз с inputProps.heroOnly = true: <FrameAudit/> прячет всё, кроме
// поддерева [data-hero], фон прозрачный — непрозрачные пиксели и есть герой. Рамка — по массе
// (6–94 % непрозрачного по каждой оси), поэтому нитка ценника, тонкая выноска и поля viewBox
// её не раздувают. Пустая обёртка-замер 3D ничего не рисует — для неё feed.ts берёт коробку,
// если в кадре есть 3D-холст.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { Ink } from "./feed";

// Рамка непрозрачного по массе: отбрасывает по trim (6 %) массы с каждой стороны — нитка, тонкая
// выноска, антенна не раздвигают рамку; тело героя остаётся.
export const inkBox = (rgba: Uint8Array | Buffer, w: number, h: number, channels = 4, trim = 0.06): { x: number; y: number; w: number; h: number; mass: number } | null => {
  const col = new Float64Array(w), row = new Float64Array(h);
  let mass = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = rgba[(y * w + x) * channels + (channels - 1)] / 255;
    if (a < 0.2) continue;
    col[x] += a; row[y] += a; mass += a;
  }
  if (mass < 4) return null;
  const span = (arr: Float64Array) => {
    let acc = 0, lo = 0, hi = arr.length - 1;
    for (let i = 0; i < arr.length; i++) { acc += arr[i]; if (acc >= trim * mass) { lo = i; break; } }
    acc = 0;
    for (let i = arr.length - 1; i >= 0; i--) { acc += arr[i]; if (acc >= trim * mass) { hi = i; break; } }
    return [lo, hi] as const;
  };
  const [x0, x1] = span(col), [y0, y1] = span(row);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, mass };
};

// Кадры для замера: 3 на бит, 6 на развязку и финал; не больше max.
export const inkFrames = (segs: Array<{ from: number; to: number; kind?: string }>, last: number, max = 48): number[] => {
  const out = new Set<number>();
  segs.forEach((sg, i) => {
    const dense = /payoff|развяз/i.test(sg.kind ?? "") || i === segs.length - 1;
    const qs = dense ? [0.1, 0.25, 0.4, 0.55, 0.7, 0.9] : [0.2, 0.5, 0.85];
    for (const q of qs) out.add(Math.min(last, Math.round(sg.from + (sg.to - 1 - sg.from) * q)));
  });
  const all = [...out].sort((p, q) => p - q);
  if (all.length <= max) return all;
  return Array.from({ length: max }, (_, i) => all[Math.round((i * (all.length - 1)) / (max - 1))]);
};

export const measureHeroInk = async (serveUrl: string, compositionId: string, frames: number[], o: { props: Record<string, unknown>; gl: string; S: [number, number, number, number]; scale?: number }): Promise<Map<number, Ink>> => {
  const { openBrowser, renderStill, selectComposition } = await import("@remotion/renderer");
  const out = new Map<number, Ink>();
  if (!frames.length) return out;
  const chromiumOptions = { gl: o.gl as "angle" };
  const browser = await openBrowser("chrome", { chromiumOptions });
  const tmp = mkdtempSync(join(tmpdir(), "ink-"));
  const scale = o.scale ?? 0.25;
  try {
    const props = { ...o.props, heroOnly: true, audit: false };
    const comp = await selectComposition({ serveUrl, id: compositionId, inputProps: props, puppeteerInstance: browser, chromiumOptions, logLevel: "error" });
    const safeA = o.S[2] * o.S[3];
    for (const f of frames) {
      const file = join(tmp, `h${f}.png`);
      try {
        await renderStill({ serveUrl, composition: comp, frame: f, output: file, scale, imageFormat: "png", inputProps: props, puppeteerInstance: browser, chromiumOptions, overwrite: true, logLevel: "error" });
        const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const b = inkBox(data, info.width, info.height, info.channels);
        const k = comp.width / info.width;
        if (!b) { out.set(f, { f, x: 0, y: 0, w: 0, h: 0, share: 0 }); continue; }
        const box = { x: b.x * k, y: b.y * k, w: b.w * k, h: b.h * k };
        const x = Math.max(box.x, o.S[0]), y = Math.max(box.y, o.S[1]), x2 = Math.min(box.x + box.w, o.S[0] + o.S[2]), y2 = Math.min(box.y + box.h, o.S[1] + o.S[3]);
        out.set(f, { f, ...box, share: x2 > x && y2 > y ? +(((x2 - x) * (y2 - y)) / safeA).toFixed(3) : 0 });
      } catch { /* кадр не отрисовался — без замера */ }
    }
  } finally {
    await browser.close({ silent: true });
    rmSync(tmp, { recursive: true, force: true });
  }
  return out;
};
