// Отдельные кадры ролика в PNG — для зрительной проверки до полного рендера.
//   studio still [--frames 0,45,mid,last,2.5s,100-110] [--every 30] [--scale 0.5]
//                [--out out/stills] [--props '{"x":1}'|file.json] [--probe] [--gl angle] [--job dir]
// По умолчанию: первый, средний и последний кадр. --probe рисует рамки страховки кадра
// (зелёная — в порядке, красная — нарушение) и пишет out/stills/guard.json.
// Печатает пути PNG — их можно сразу открыть Read-ом или собрать в лист: studio sheet out/stills
//   --sheet — сразу собрать отснятые кадры в один лист out/stills/sheet.png (одна Read).
//   --vary 'cloudY=4.3,4.8,5.2' — те же кадры для каждого значения inputProps.cloudY (сцена
//            читает ручку из getInputProps()/props) → один подписанный лист: выбрать значение
//            одной Read вместо цепочки «поправил число → still → посмотрел».
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { STILL_STAMP } from "./_gate";
import { budgetLine, bundleJob, COMPOSITION, ensureDir, glOpt, guardCollector, inJob, jobDir, num, parseArgs, parseProps, printGuard, quietBrowserTags, ROOT, str } from "./_lib";

const a = parseArgs(process.argv.slice(2), ["probe", "sheet"]);
quietBrowserTags();
const dir = jobDir(a);
const scale = num(a, "scale", 0.5)!;
const outDir = ensureDir(inJob(dir, str(a, "out", "out/stills")!));
const props = { ...parseProps(a), ...(a.probe ? { probe: true } : {}) };

const main = async () => {
  const { openBrowser, renderStill, selectComposition } = await import("@remotion/renderer");
  const serveUrl = await bundleJob(dir);
  const chromiumOptions = { gl: glOpt(a) };
  const browser = await openBrowser("chrome", { chromiumOptions });
  try {
    const guard = guardCollector();
    const comp = await selectComposition({ serveUrl, id: COMPOSITION, inputProps: props, puppeteerInstance: browser, chromiumOptions, onBrowserLog: guard.onBrowserLog, logLevel: "error" });
    const last = comp.durationInFrames - 1;
    const frames = new Set<number>();
    const spec = str(a, "frames");
    const every = num(a, "every");
    if (every) for (let f = 0; f <= last; f += every) frames.add(f);
    for (const tok of (spec ?? (every ? "" : "0,mid,last")).split(",").map((s) => s.trim()).filter(Boolean)) {
      if (tok === "mid") frames.add(Math.floor(last / 2));
      else if (tok === "last") frames.add(last);
      else if (/^[\d.]+s$/.test(tok)) frames.add(Math.min(last, Math.round(parseFloat(tok) * comp.fps)));
      else if (/^\d+-\d+$/.test(tok)) { const [p, q] = tok.split("-").map(Number); for (let f = p; f <= Math.min(q, last); f++) frames.add(f); }
      else if (/^\d+$/.test(tok)) frames.add(Math.min(last, Number(tok)));
      else throw new Error(`--frames: непонятный кадр «${tok}»`);
    }
    console.error(`композиция ${comp.width}×${comp.height}, ${comp.fps} fps, ${comp.durationInFrames} кадров (${(comp.durationInFrames / comp.fps).toFixed(2)} с)`);
    const vary = str(a, "vary");
    const [vKey, vList] = vary ? [vary.split("=")[0], vary.slice(vary.indexOf("=") + 1).split(",")] : [null, [null]];
    const parse = (v: string) => { try { return JSON.parse(v); } catch { return v; } };
    const shots: string[] = [];
    for (const f of [...frames].sort((x, y) => x - y)) {
      for (const v of vList) {
        const p = vKey && v !== null ? { ...props, [vKey]: parse(v) } : props;
        const name = vKey && v !== null ? `${vKey}=${v} f${String(f).padStart(4, "0")}.png` : `f${String(f).padStart(4, "0")}.png`;
        const output = join(outDir, name);
        await renderStill({ serveUrl, composition: comp, frame: f, output, scale, inputProps: p, puppeteerInstance: browser, chromiumOptions, overwrite: true, onBrowserLog: guard.onBrowserLog, logLevel: "error" });
        shots.push(output);
        if (!a.sheet && !vKey) console.log(output);
      }
    }
    printGuard(guard.save(join(outDir, "guard.json")));
    // Отметка «кадры сняты» для ворот финала (_gate.ts): вариант после review засчитывается,
    // в какую бы папку (--out) ни легли кадры.
    writeFileSync(join(ensureDir(join(dir, "out")), STILL_STAMP), `${new Date().toISOString()} ${outDir}\n`);
    if (a.sheet || vKey) {
      const out = join(outDir, vKey ? `vary-${vKey}.png` : "sheet.png");
      const cols = vKey ? vList.length : Math.min(6, shots.length);
      const r = spawnSync(join(ROOT, "node_modules", ".bin", "tsx"), [join(ROOT, "studio", "bin", "sheet.ts"), ...shots, "--cols", String(cols), "--width", String(vKey ? 300 : 240), "--out", out], { encoding: "utf8" });
      console.log(r.status === 0 ? `лист: ${out} (${shots.length} кадров${vKey ? `, по столбцу на значение ${vKey}` : ""})` : `лист не собран: ${r.stderr.slice(0, 300)}`);
    }
    const bl = budgetLine(dir);
    if (bl) console.log(bl);
  } finally {
    await browser.close({ silent: true });
  }
};
main().catch((e) => { console.error("ошибка: " + (e?.stack ?? e)); process.exit(1); });
