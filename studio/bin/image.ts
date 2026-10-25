// Картинка через подключённого провайдера (bin/_providers.ts) → PNG в public/.
//   studio image "промпт" [--out img/hero.png] [--size 1024x1024|1024x1536|1536x1024|auto]
//                [--quality low|medium|high] [--bg transparent|opaque] [--prompt-file p.txt]
//                [--force] [--job dir] [--ref img/sheet.png[,img/b.png]] [--no-retry]
// --ref — картинки-референсы (лист персонажа, стиль): модель держит того же героя/стиль.
//   Пути — от public/ или от папки ролика. Входят в ключ кэша (по содержимому файлов).
// Кэш .cache/studio-img по (модель, промпт, размер, качество, фон): повтор — бесплатно,
// --force — сгенерировать заново. Каждая картинка дописывается в public/images.json
// (файл, промпт, параметры, ключ). Печатает путь, размер и есть ли прозрачность.
// Ориентация: если пришла картинка не той ориентации (просили вертикаль 1024x1536 — пришла
// горизонталь), инструмент один раз повторяет запрос с явным указанием композиции
// (--no-retry — не повторять). Не вышло — громкое ВНИМАНИЕ и orientationMismatch в манифесте:
// горизонтальный фон в 9:16 обрежется по бокам и растянется (~×2) — это брак, а не норма.
// Платный шаг: держите бюджет картинок ролика (план) и проверяйте каждую глазами (Read).
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { cacheDir, sha } from "./_media";
import { image, IMAGE_MODEL } from "./_providers";
import { die, ensureDir, inJob, jobDir, parseArgs, str } from "./_lib";

const a = parseArgs(process.argv.slice(2), ["force", "no-retry"]);
const dir = jobDir(a);
const pf = str(a, "prompt-file");
const prompt = (pf ? readFileSync(inJob(dir, pf), "utf8") : a._.join(" ")).trim() || die("нужен промпт: studio image \"…\"");
const size = str(a, "size", "1024x1024")!;
const quality = str(a, "quality", "medium")!;
const bg = str(a, "bg", "transparent")!;
if (!["transparent", "opaque", "auto"].includes(bg)) die("--bg: transparent | opaque | auto");
if (!["1024x1024", "1024x1536", "1536x1024", "auto"].includes(size)) die("--size: 1024x1024 | 1024x1536 | 1536x1024 | auto");

// Референсы: файл в public/ или путь от папки ролика.
const refs = (str(a, "ref") ?? "").split(",").map((r) => r.trim()).filter(Boolean).map((r) => {
  const cands = [inJob(dir, join("public", r.replace(/^public\//, ""))), inJob(dir, r)];
  const f = cands.find((c) => existsSync(c));
  if (!f) die(`--ref: нет файла ${r}`);
  return f!;
});
const refBufs = refs.map((f) => readFileSync(f));
const refKey = refBufs.map((b) => sha(b.toString("base64"))).join(",");
// Референс уходит уменьшенным JPEG (≤ 1024 px, ~100 КБ): полноразмерный PNG в несколько МБ
// подвешивал запрос до тайм-аута (15 мин), а модели для узнавания героя хватает 1024.
const refJpegs = () => Promise.all(refBufs.map((b) => sharp(b).flatten({ background: "#ffffff" }).resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()));
const keyOf = (p: string) => sha([IMAGE_MODEL, p, size, quality, bg, ...(refKey ? [refKey] : [])].join("|"));
// Сгенерировать (или взять из кэша) по промпту → путь в кэше.
const generate = async (p: string, force: boolean): Promise<string> => {
  const file = join(cacheDir("studio-img"), `${keyOf(p)}.png`);
  if (!existsSync(file) || force) {
    console.error(`генерация (${size}, ${quality}, фон ${bg}${refs.length ? `, референсов ${refs.length}` : ""})…`);
    const t = Date.now();
    const buf = await image(p, { size, quality, background: bg }, refs.length ? await refJpegs() : []);
    writeFileSync(file + ".tmp", buf);
    renameSync(file + ".tmp", file);
    console.error(`готово за ${((Date.now() - t) / 1000).toFixed(0)} с`);
  } else console.error("из кэша");
  return file;
};
const wantPortrait = size === "1024x1536", wantLandscape = size === "1536x1024";
const wrongOrientation = (w = 0, h = 0) => (wantPortrait && w > h) || (wantLandscape && h > w);
const main = async () => {
  let cached = await generate(prompt, Boolean(a.force));
  let usedPrompt = prompt;
  let m0 = await sharp(cached).metadata();
  if (wrongOrientation(m0.width, m0.height) && !a["no-retry"]) {
    usedPrompt = `${prompt}\n\n${wantPortrait ? "Vertical portrait composition: a tall 2:3 frame, the scene is built top-to-bottom." : "Horizontal landscape composition: a wide 3:2 frame."}`;
    console.error(`пришло ${m0.width}×${m0.height} вместо ${size} — повторяю один раз с явной ориентацией`);
    cached = await generate(usedPrompt, false);
    m0 = await sharp(cached).metadata();
  }
  const mismatch = wrongOrientation(m0.width, m0.height);
  if (mismatch) console.error(`ВНИМАНИЕ: ориентация не та (${m0.width}×${m0.height} вместо ${size}). Фон 9:16 из горизонтали обрежется по бокам и растянется — переформулируйте сцену вертикально или постройте кадр так, чтобы фон не шёл во весь экран.`);
  const rel = str(a, "out") ?? `img/${keyOf(usedPrompt)}.png`;
  const out = inJob(dir, join("public", rel.replace(/^public\//, "")));
  ensureDir(dirname(out));
  copyFileSync(cached, out);
  const meta = await sharp(out).metadata();
  let alpha = "нет";
  if (meta.hasAlpha) {
    const st = await sharp(out).extractChannel(3).stats();
    alpha = st.channels[0].min < 250 ? "есть прозрачные пиксели" : "канал есть, но всё непрозрачно";
  }
  const manifest = inJob(dir, "public/images.json");
  const list = existsSync(manifest) ? JSON.parse(readFileSync(manifest, "utf8")) : [];
  const fileRel = out.slice(inJob(dir, "public").length + 1);
  const entry = { file: fileRel, prompt: usedPrompt, size, quality, bg, model: IMAGE_MODEL, key: keyOf(usedPrompt), w: meta.width, h: meta.height, ...(mismatch ? { orientationMismatch: true } : {}), ...(refs.length ? { refs: refs.map((r) => r.slice(dir.length + 1)) } : {}) };
  writeFileSync(manifest, JSON.stringify([...list.filter((e: { file: string }) => e.file !== fileRel), entry], null, 1));
  console.log(`${out}\n  ${meta.width}×${meta.height}, прозрачность: ${alpha}; staticFile("${fileRel}")`);
};
main().catch((e) => { console.error("ошибка: " + (e?.message ?? e)); process.exit(1); });
