// Полный рендер ролика → out/final.mp4 (H.264 + AAC, громкость −14 LUFS, true peak −1.5).
//   studio render [--out out/final.mp4] [--crf 18] [--scale 1] [--concurrency 6]
//                 [--frames 0-89] [--props json|file] [--probe] [--gl angle] [--no-loudnorm] [--job dir]
// Для черновика: --scale 0.5 --out out/draft.mp4. Для 3D-сцен — --concurrency 3.
// --audio-only — правка только звука (sfx.json, громкость музыки, приглушение): кадры не
// рендерятся, новая дорожка (−14 LUFS) подкладывается к готовому out/final.mp4 (-c:v copy).
// Секунды вместо полного рендера; probe по картинке после этого не нужен — только mixcheck.
// Нарушения страховки кадра со всех кадров → рядом с mp4: <имя>.guard.json (его читает probe).
import { existsSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { cpus } from "node:os";
import { dirname } from "node:path";
import { ff } from "./_media";
import { budgetLine, bundleJob, COMPOSITION, ensureDir, glOpt, guardCollector, inJob, jobDir, num, parseArgs, parseProps, printGuard, str, withRenderSlot, quietBrowserTags } from "./_lib";
import { appendRegistry } from "./_registry";
import { finalGate } from "./_gate";

const a = parseArgs(process.argv.slice(2), ["probe", "no-loudnorm", "audio-only"]);
quietBrowserTags();
const dir = jobDir(a);
// Ворота финала (bin/_gate.ts): открытые ★ ленточные WARN, FAIL review или несделанная правка
// №1 критика — рендер идёт в out/candidate.mp4, статус ролика needs-stage-2, а не «финал».
const wanted = inJob(dir, str(a, "out", "out/final.mp4")!);
const isFinal = !a["audio-only"] && !str(a, "frames") && num(a, "scale", 1) === 1 && /final\.mp4$/.test(wanted);
const gate = isFinal && process.env.STUDIO_FINAL_GATE !== "0" ? finalGate(dir) : null;
const cand = wanted.replace(/final\.mp4$/, "candidate.mp4");
const out = (gate && !gate.ok) || (a["audio-only"] && !existsSync(wanted) && existsSync(cand)) ? cand : wanted;
ensureDir(dirname(out));
if (gate && !gate.ok) console.error(`ворота финала закрыты — рендер в ${out.split("/").slice(-2).join("/")}, статус needs-stage-2:\n${gate.open.map((x) => `  • ${x}`).join("\n")}\nбюджет — сюда, а не на косметику; закрыл всё — studio render ещё раз даст out/final.mp4`);
const props = { ...parseProps(a), ...(a.probe ? { probe: true } : {}) };

const hasAudio = (p: string) =>
  spawnSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", p]).stdout.toString().trim().length > 0;

// Двухпроходная нормализация громкости: замер, затем линейная поправка по замеру.
export const loudnorm = (src: string, dst: string, I = -14, TP = -1.5, LRA = 11) => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-i", src, "-af", `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:print_format=json`, "-f", "null", "-"]);
  const txt = r.stderr.toString();
  const j = JSON.parse(txt.slice(txt.lastIndexOf("{"), txt.lastIndexOf("}") + 1));
  // Тишина (немой ролик с пустой дорожкой): нормализовать нечего.
  if (!Number.isFinite(Number(j.input_i)) || Number(j.input_i) < -70) {
    ff(["-i", src, "-c", "copy", dst]);
    return { inputI: Number(j.input_i), inputTP: Number(j.input_tp) };
  }
  const af = `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
  ff(["-i", src, "-c:v", "copy", "-af", af, "-ar", "48000", "-c:a", "aac", "-b:a", "192k", dst]);
  return { inputI: Number(j.input_i), inputTP: Number(j.input_tp) };
};

const audioOnly = async () => {
  if (!existsSync(out)) throw new Error(`--audio-only: нет ${out} — сначала полный studio render`);
  const { renderMedia, selectComposition } = await import("@remotion/renderer");
  const serveUrl = await bundleJob(dir);
  const chromiumOptions = { gl: glOpt(a) };
  const comp = await selectComposition({ serveUrl, id: COMPOSITION, inputProps: props, chromiumOptions, logLevel: "error" });
  const wav = out.replace(/\.mp4$/, ".audio.wav");
  const t = Date.now();
  await renderMedia({ serveUrl, composition: comp, codec: "wav", outputLocation: wav, inputProps: props, chromiumOptions, overwrite: true, logLevel: "error" });
  const mux = out.replace(/\.mp4$/, ".mux.mp4");
  ff(["-i", out, "-i", wav, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", mux]);
  const m = loudnorm(mux, out + ".tmp.mp4");
  renameSync(out + ".tmp.mp4", out);
  rmSync(mux, { force: true }); rmSync(wav, { force: true });
  console.error(`звук пересобран за ${((Date.now() - t) / 1000).toFixed(1)} с (картинка не тронута); громкость: было ${m.inputI} LUFS → −14`);
  console.log(out);
  const bl = budgetLine(dir);
  if (bl) console.log(bl);
};

const main = async () => {
  if (a["audio-only"]) return audioOnly();
  const { renderMedia, selectComposition } = await import("@remotion/renderer");
  const serveUrl = await bundleJob(dir);
  const chromiumOptions = { gl: glOpt(a) };
  const guard = guardCollector();
  const comp = await selectComposition({ serveUrl, id: COMPOSITION, inputProps: props, chromiumOptions, onBrowserLog: guard.onBrowserLog, logLevel: "error" });
  const fr = str(a, "frames");
  const frameRange = fr ? (fr.split("-").map(Number) as [number, number]) : null;
  const raw = out.replace(/\.mp4$/, ".raw.mp4");
  const t = Date.now();
  let lastPct = -1;
  await withRenderSlot(`render ${dir}`, () => renderMedia({
    serveUrl, composition: comp, codec: "h264", outputLocation: raw, inputProps: props, chromiumOptions,
    crf: num(a, "crf", 18), scale: num(a, "scale", 1), concurrency: num(a, "concurrency", Math.max(2, Math.min(8, cpus().length - 4))),
    frameRange, audioCodec: "aac", overwrite: true, onBrowserLog: guard.onBrowserLog, logLevel: "error",
    onProgress: ({ progress }) => { const p = Math.floor(progress * 10); if (p !== lastPct && process.stderr.isTTY) { lastPct = p; process.stderr.write(`рендер ${p * 10}%\r`); } },
  }));
  const sec = (Date.now() - t) / 1000;
  if (!a["no-loudnorm"] && hasAudio(raw)) {
    const m = loudnorm(raw, out + ".tmp.mp4");
    renameSync(out + ".tmp.mp4", out);
    rmSync(raw, { force: true });
    console.error(Number.isFinite(m.inputI) && m.inputI > -70 ? `громкость: было ${m.inputI} LUFS → −14` : "громкость: дорожка тихая, не нормализовал");
  } else {
    renameSync(raw, out);
  }
  const guardFile = out.replace(/\.mp4$/, ".guard.json");
  const list = guard.save(guardFile);
  console.error(`\nрендер ${comp.durationInFrames} кадров за ${sec.toFixed(1)} с (${(sec / (comp.durationInFrames / comp.fps)).toFixed(2)} с на секунду ролика)`);
  printGuard(list);
  if (!existsSync(out)) throw new Error("нет файла результата");
  // Обезличенный отпечаток облика (тема, без контента) — в реестр студии для board.ts.
  if (!fr && num(a, "scale", 1) === 1 && /final\.mp4$/.test(out)) appendRegistry(dir);
  if (gate) {
    writeFileSync(inJob(dir, "out/status.json"), JSON.stringify({ status: gate.ok ? "final" : "needs-stage-2", file: out.split("/").slice(-2).join("/"), open: gate.open, accepted: gate.accepted, at: new Date().toISOString() }, null, 1));
    if (gate.ok) rmSync(inJob(dir, "out/candidate.mp4"), { force: true });
    else console.log(`СТАТУС: needs-stage-2 (открыто ${gate.open.length}) — out/final.mp4 не выпущен`);
  }
  console.log(out);
  const bl = budgetLine(dir);
  if (bl) console.log(bl);
};
main().catch((e) => { console.error("ошибка: " + (e?.stack ?? e)); process.exit(1); });
