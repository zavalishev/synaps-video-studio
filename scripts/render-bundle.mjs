// Рендер готового бандла студии (статичный сайт сцен, который собирает bundleJob) в mp4.
//   node scripts/render-bundle.mjs <bundle-dir> <composition> <props.json> <out.mp4> [scale] [crf] [frames a-b]
// Нужен только @remotion/renderer той же версии, что собрала бандл, и браузер Remotion —
// исходники сцен и библиотека студии уже внутри бандла. Так рендер уходит на другую машину
// (Mac с видеочипом), см. STUDIO_RENDER_COMMAND в studio/bin/render.ts.
// Окружение: STUDIO_GL (angle на Mac, swangle без видеочипа), STUDIO_RENDER_CONCURRENCY.
// Консоль браузера (метки страховки кадра) — в <out>.browser.log.
// Renders a prebuilt studio bundle to mp4 (used for remote rendering).
import { appendFileSync, readFileSync } from "node:fs";
import { cpus } from "node:os";

const [bundle, composition, propsFile, out, scaleArg, crfArg, framesArg] = process.argv.slice(2);
if (!bundle || !composition || !propsFile || !out) {
  console.error("нужно: render-bundle.mjs <bundle-dir> <composition> <props.json> <out.mp4> [scale] [crf] [frames]");
  process.exit(2);
}
if (!/^[A-Za-z0-9_-]+$/.test(composition)) { console.error("bad composition"); process.exit(2); }
const { renderMedia, selectComposition } = await import("@remotion/renderer");
const inputProps = JSON.parse(readFileSync(propsFile, "utf8"));
const chromiumOptions = { gl: process.env.STUDIO_GL || "angle" };
const logFile = `${out}.browser.log`;
const onBrowserLog = (l) => { try { appendFileSync(logFile, `${l.type}\t${l.text}\n`); } catch { /* журнал не обязателен */ } };
const frameRange = framesArg ? framesArg.split("-").map(Number) : null;
const t = Date.now();
const comp = await selectComposition({ serveUrl: bundle, id: composition, inputProps, chromiumOptions, onBrowserLog, logLevel: "error" });
await renderMedia({
  serveUrl: bundle, composition: comp, codec: "h264", outputLocation: out, inputProps, chromiumOptions,
  crf: Number(crfArg) || 18, scale: Number(scaleArg) || 1,
  concurrency: Number(process.env.STUDIO_RENDER_CONCURRENCY) || Math.max(2, Math.min(8, cpus().length - 2)),
  frameRange, audioCodec: "aac", pixelFormat: "yuv420p", overwrite: true, onBrowserLog, logLevel: "error", timeoutInMilliseconds: 120000,
});
console.error(`render-bundle: ${comp.durationInFrames} кадров за ${((Date.now() - t) / 1000).toFixed(1)} с`);
