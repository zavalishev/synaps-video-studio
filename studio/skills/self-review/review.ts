// Самопроверка ролика одной командой — то, что делается перед каждым финальным рендером.
//   npx tsx .claude/skills/self-review/review.ts [--job dir] [--scale 0.5] [--cuts 0,120,…|none]
//        [--props json|file] [--frames a-b] [--concurrency N] [--gl angle] [--reuse] [--strict]
// Шаги:
//   1) lint — приёмы, из-за которых «прыгает»/«уезжает» (spring без damping, interpolate без
//      clamp, frame×скорость, смесь переходов, числа без tabular-nums, нет FrameAudit);
//   2) studio check — TypeScript и детерминизм (ошибка — дальше не идём);
//   3) черновой рендер out/review/draft.mp4 с inputProps.audit=true: <FrameAudit/> пишет
//      коробки всех видимых элементов на каждом кадре + нарушения страховки;
//   4) studio probe по пикселям (склейки, скорость, тряска, блюр-переходы, края, звук);
//   5) разбор треков элементов: скорость каждого элемента, отскоки/перелёты, дрожь ширины,
//      мигание, «выскакивания», вылет за край дольше 0.3 с;
//   6) лента (feed.ts): размер героя (data-hero), пустые полосы, пустой кадр 0, текст под
//      речью (без звука), текст на тексте, контраст по пикселям; из probe — застой, крючок,
//      пустые трети, дыры в звуке;
//   7) контактный лист, ленты движения на худших местах и склейках, плитки «как в ленте»
//      (phone-hook / phone-end / phone-sheet);
//   8) планы (shots.ts): уникальных планов N из M, кадр 0 против лучших кадров, энергия
//      входа в кульминацию; композиция (прилипло к верху), герой пропал, призраки текста,
//      цифры брифа на экране (feed.ts);
//   9) out/review/review.md + review.json — всё подробно; в терминал — короткая сводка
//      (≤ 25 строк): вердикт, круг k из N, главное с подсказкой «как исправить / как
//      пометить нарочное», две картинки для Read (review.png + phone-sheet.png), бюджет.
// Круги: out/review/rounds.json считает прогоны (без --reuse). После STUDIO_REVIEW_ROUNDS
// (по умолчанию 3) — только FAIL повод для нового круга; косметические WARN — в notes.md как
// принятые, а ЛЕНТОЧНЫЕ (крючок, кульминация, форма, факт — RIBBON) одной строкой не
// принимаются: один вариант через studio still и сравнение, без нового круга review.
// Склейки по плану: --cuts, иначе beats.json (поле from каждого бита), иначе без плана.
// --reuse — не рендерить заново, взять draft.mp4 и tracks.json прошлого прогона.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { isRibbon } from "../../bin/_gate";
import { budgetLine, bundleJob, COMPOSITION, glOpt, guardCollector, type GuardHit, jobDir, num, parseArgs, parseProps, ROOT, str, withRenderSlot, quietBrowserTags } from "../../bin/_lib";
import { lintJob } from "./lint";
import { analyzeBeats, analyzeFeed, heroItems, promiseTimes, analyzeFeed2, analyzeForm, type BeatsMetrics, type Feed2Metrics, type FeedMetrics, type FormMetrics, type Ink, isPayoff, measureContrast, measurePayoffText } from "./feed";
import { inkFrames, measureHeroInk } from "./ink";
import { briefNumbers, reviewFacts } from "../claims-and-compliance/facts";
import { analyzeShots, CLIMAX_MIN, endHoldSec, extractFrames, segmentsOf, type Segment, type ShotMetrics } from "./shots";
import sharp from "sharp";

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, "..", "..", "bin");
const TSX = join(ROOT, "node_modules", ".bin", "tsx");
const TRACK_TAG = "[studio-track]";

type Level = "FAIL" | "WARN" | "INFO";
type Issue = { level: Level; source: "lint" | "probe" | "guard" | "track" | "check" | "feed"; kind: string; frames?: [number, number]; id?: string; msg: string };
type Item = { k: string; t: string; x: number; y: number; w: number; h: number; o: number; fs?: number; c?: 1; r?: "hero"; a?: 1; b?: 1; wd?: 1; col?: string; sh?: 1; tx?: string; ro?: string; oh?: 1; px?: 1 };
type Track = { f: number; W: number; H: number; S?: [number, number, number, number]; items: Item[] };

const a = parseArgs(process.argv.slice(2), ["reuse", "strict"]);
quietBrowserTags();
const dir = jobDir(a);
const outDir = join(dir, "out", "review");
mkdirSync(outDir, { recursive: true });
const draft = join(outDir, "draft.mp4");
const issues: Issue[] = [];
const t0 = Date.now();

// ---------- круги ----------
const ROUND_LIMIT = Number(process.env.STUDIO_REVIEW_ROUNDS) || 3;
const roundsFile = join(outDir, "rounds.json");
const rounds: { n: number; history: Array<{ at: string; verdict: string; fail: number; warn: number }> } = existsSync(roundsFile) ? (() => { try { return JSON.parse(readFileSync(roundsFile, "utf8")); } catch { return { n: 0, history: [] }; } })() : { n: 0, history: [] };
if (!a.reuse) rounds.n++;

// ---------- ленточные WARN: то, от чего зависит, досмотрят ли ролик ----------
// Крючок, кульминация, форма (слайд-шоу), читаемость факта. Остальные WARN — косметика.
// Список общий с воротами финала (bin/_gate.ts): открытый ★ не даёт studio render выпустить final.mp4.

// ---------- подсказки: как исправить и как законно пометить нарочное ----------
// Чтобы не читать исходники проверок: у каждого вида — вероятная причина/правка и пометка.
const HINT: Record<string, string> = {
  "edge-cut": "сдвинь внутрь безопасной зоны (useGuardedBox/tween) · нарочный выход — data-bleed, мир за краем — data-world",
  "edge-crossing": "предмет у края движется — останови внутри зоны · нарочно: data-bleed; 3D-мир: data-world на холсте",
  "text-cut": "текст в безопасной зоне (zones().safe), FitText",
  "text-outside-safe": "текст выше нижних ~20 % (подпись, ник, звук ленты) и ниже верхних ~8 % (zones().safe)",
  "text-under-ui": "адрес/призыв/цифра — выше нижних 20 % и левее колонки кнопок справа (нижняя половина)",
  "text-tiny": "крупнее (≥ 3.5 % высоты) · нарочно мелкое (сноска) — data-decor",
  "text-overflow": "буквы вылезли из плашки: шире плашка/меньше кегль, поле ≥ 0.15 em",
  "cover-gap": "фон через CoverImage/coverRect (zoom ≥ 1.04); однотонная область самой картинки — смотри ленту",
  "cover-upscale": "картинка нужной ориентации или меньше наезд",
  "el-fast": "длиннее движение (minMoveFrames) или CRUISE · игра персонажа — data-acting",
  "el-jitter": "пружина без перелёта (springIn) или tween · нарочная дрожь — data-acting",
  "el-reversal": "одно направление на движение; разворот — не чаще раза в секунду",
  "el-width-jitter": "tabular-nums / Counter; ширина под итоговую строку",
  "shake": "камера без разворотов · нарочная дрожь героя — data-acting",
  "fast-motion": "медленнее камера (≤ 0.6 %W/кадр) или склейка вместо пролёта",
  "blur-transition": "склейка на слове вместо размытия",
  "unplanned-cut": "склейка не из beats.json — добавь в план или убери скачок · нарочная вспышка/засветка — data-accent на её слое (или <Flash/>)",
  "cut-rate": "не больше двух склеек в секунду",
  "empty-plate": "SwapText (смена текста без пустой карточки)",
  "pop-rate": "входы с весом (шторка, масштаб), не всё сразу",
  "stale": "смена крупности/наезд к детали/новый предмет на фразе",
  "stale-open": "бит входит в середину действия; медленное действие — сменой крупности (общий → деталь → общий)",
  "stale-share": "что обновляет внимание каждые 2–3 с? крупность, предмет, свет",
  "slow-open": "событие крючка до 1.5 с; титульная карточка ≤ 2 с",
  "weak-hook": "кадр 0 — готовая картинка; что-то происходит до 1.5 с",
  "dull-open": "открой лучшим кадром ролика (петля к нему в конце)",
  "same-shot": "та же вещь — другой крупностью/углом",
  "flat-climax": "удар без прыжка: склейка на число, маска, прокрутка цифр, вспышка 2–3 кадра",
  "offer-late": "предложение (цена/срок) в первые 2–3 с или причина в notes.md",
  "top-heavy": "герой ниже и крупнее, горизонт ниже, камера ближе (composeV)",
  "hero-small": "сначала кадрирование, а не уменьшение: обрезать в деталь, за край (data-bleed), текст в свободное место героя; frameSubject (fill 0.85)",
  "hero-small-beat": "в этих битах — крупнее план/деталь, герой за край; без героя нарочно — kind: \"establish\"",
  "hero-small-payoff": "развязка/финал: герой ≥ 30 % зоны (крупнее прошлых битов) или удар типографикой во весь кадр",
  "hero-under-ui": "тело/земля — под интерфейс можно; главная масса героя выше нижних 20 %",
  "hero-text": "data-hero — на рисунок/предмет, не на надпись",
  "hero-proxy-2d": "data-hero на видимый рисунок (img/svg/<g>), а не на пустую обёртку",
  "payoff-small": "скачок крупности на развязке (×1.4+) или слово во весь кадр",
  "payoff-short": "текст развязки открыт ≥ 1 с (факт ≥ 1.5 с): раньше вход, короче маска, дольше бит",
  "payoff-freeze": "жест одним ходом до конца; пауза — после удара",
  "end-hold": "финальный мир ≤ 4 с без события: телефон/адрес поверх продолжающегося действия",
  "end-static": "в финале — событие (жест доходит, дверь открывается), а не только смена текста",
  "layout-template": "разные раскладки: герой во весь кадр, текст поверх/за героем, экстремальная деталь, текст на земле",
  "timid-motion": "один уверенный ход на бит (≥ 40 % потолка) с разгоном и торможением; фото — параллакс вырезки",
  "hero-late": "герой в кадре 0, заголовок может прийти позже",
  "hero-absent": "камера ведёт героя · общий план нарочно — kind: \"establish\" в beats.json",
  "dead-band": "перекомпонуй: герой крупнее и за край, земля/горизонт в нижнюю полосу (под интерфейс можно), текст в свободном месте героя; не декор в полосу",
  "sparse": "перекомпонуй: обрезать в героя, герой за край, земля/горизонт заполняет низ; не мельче",
  "muted": "субтитры или ключевой текст на каждую фразу",
  "contrast-px": "подложка/тень под текстом или другое место",
  "ghost-text": "смена текста: сначала уход, потом приход (SwapText)",
  "no-headline": "ключевое слово/цифра ≥ 7 % высоты",
  "text-collide": "разведи тексты по времени или одна строка в свободное место героя — не уменьшая героя",
  "audio-hole": "подложка/атмосфера между фразами",
  "audio-fade-end": "музыка/подложка до последнего кадра",
  "slideshow": "событие в предмете (PhotoLayers, вырезка со своим движением, fx), текст маской на слове",
  "cta-cramped": "воздух между заголовком и призывом, свой вес/плашка",
  "date-weekday": "не исправлять молча: «## Вопросы заказчику» в notes.md + итоговый JSON",
  "date-past": "вопрос заказчику в notes.md",
  "invented-number": "без числа или допущение в «## Вопросы заказчику»",
  "regulated?": "studio skill claims-and-compliance; \"regulated\" в job.json",
  "disclaimer-missing": "текст data-role=\"disclaimer\" (claims-and-compliance)",
  "disclaimer-weak": "дольше на экране и крупнее (≥ 5 с, ≥ 7 % кадра)",
  "sfx-units": "SfxEvent: atSec (секунды) или at (целые кадры)",
  "text-on-hero": "текст в негативное пространство героя или герой за край (crop/bleed), а не мельче героя · нарочно (обложка) — data-over-hero",
  "hero-cut": "кадрирование по герою, воздух по взгляду · нарочный крупный выход — data-bleed на герое",
  "text-clipped": "fitLabelPx/FitText или шире плашка; nowrap в узком блоке режет буквы",
  "jump-cut": "крупность ×1.5+ или другой угол · без склейки — \"cut\": \"none\" у бита в beats.json",
  "mirror-cut": "герой смотрит в ту же сторону через склейку; разворот — действие внутри бита",
  "list-slideshow": "список — содержание, не форма: сгруппируй мелкое в быструю серию, главному — больше времени и удар",
  "fact-unreadable": "факт читается с первого кадра: RollNumber turns=0 (крутятся 1–2 младших разряда) или scaleStep/maskReveal",
  "brand-small": "имя бренда на финале ≥ 4 % высоты (или логотип заказчика)",
};

// ---------- бриф и биты ----------
const readBeats = (): Segment[] | null => {
  const bf = join(dir, "beats.json");
  if (!existsSync(bf)) return null;
  try {
    const j = JSON.parse(readFileSync(bf, "utf8"));
    const beats: Array<{ id?: string; from?: number; start_f?: number; to?: number; end_f?: number; kind?: string; hero?: string }> = Array.isArray(j) ? j : j.beats ?? [];
    return beats.map((b, i) => ({ id: b.id ?? `b${i + 1}`, from: b.from ?? b.start_f ?? 0, to: b.to ?? b.end_f ?? 0, kind: b.kind, hero: b.hero }));
  } catch { return null; }
};

// ---------- склейки по плану ----------
const plannedCuts = (): number[] | null => {
  const c = str(a, "cuts");
  if (c === "none") return null;
  if (c) return c.split(",").map(Number).filter(Number.isFinite);
  const bf = join(dir, "beats.json");
  if (!existsSync(bf)) return null;
  try {
    const j = JSON.parse(readFileSync(bf, "utf8"));
    const beats: Array<{ from?: number; start_f?: number; cut?: string; transition?: string }> = Array.isArray(j) ? j : j.beats ?? [];
    // Граница бита без склейки (камера продолжает движение) — "cut": "none" | "continuous".
    return beats.filter((b) => !/^(none|continuous|нет)$/i.test(String(b.cut ?? b.transition ?? ""))).map((b) => b.from ?? b.start_f ?? 0).filter((f) => f > 0);
  } catch { return null; }
};

// ---------- громкость (как studio render) ----------
const loudnorm = (src: string, dst: string) => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-i", src, "-af", "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"]);
  const txt = r.stderr.toString();
  const j = JSON.parse(txt.slice(txt.lastIndexOf("{"), txt.lastIndexOf("}") + 1));
  if (!Number.isFinite(Number(j.input_i)) || Number(j.input_i) < -70) { spawnSync("ffmpeg", ["-y", "-v", "error", "-i", src, "-c", "copy", dst]); return; }
  const af = `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
  spawnSync("ffmpeg", ["-y", "-v", "error", "-i", src, "-c:v", "copy", "-af", af, "-ar", "48000", "-c:a", "aac", "-b:a", "192k", dst]);
};
const hasAudio = (p: string) => spawnSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", p]).stdout.toString().trim().length > 0;

// ---------- рендер с треками ----------
const render = async (): Promise<{ tracks: Track[]; guard: GuardHit[]; fps: number; frames: number; sec: number }> => {
  const { renderMedia, selectComposition } = await import("@remotion/renderer");
  const serveUrl = await bundleJob(dir);
  const props = { ...parseProps(a), audit: true };
  const chromiumOptions = { gl: glOpt(a) };
  const guard = guardCollector();
  const tracks = new Map<number, Track>();
  const onBrowserLog = (log: { text: string; type: string }) => {
    const i = log.text.indexOf(TRACK_TAG);
    if (i >= 0) { try { const t = JSON.parse(log.text.slice(i + TRACK_TAG.length)) as Track; tracks.set(t.f, t); } catch { /* обрезанный лог */ } return; }
    guard.onBrowserLog(log);
  };
  const comp = await selectComposition({ serveUrl, id: COMPOSITION, inputProps: props, chromiumOptions, onBrowserLog, logLevel: "error" });
  const fr = str(a, "frames");
  const frameRange = fr ? (fr.split("-").map(Number) as [number, number]) : null;
  const raw = draft.replace(/\.mp4$/, ".raw.mp4");
  const t = Date.now();
  let last = -1;
  await withRenderSlot(`review ${dir}`, () => renderMedia({
    serveUrl, composition: comp, codec: "h264", outputLocation: raw, inputProps: props, chromiumOptions,
    crf: 23, scale: num(a, "scale", 0.5), concurrency: num(a, "concurrency", Number(process.env.STUDIO_RENDER_CONCURRENCY) || Math.max(2, Math.min(8, cpus().length - 4))),
    frameRange, audioCodec: "aac", overwrite: true, onBrowserLog, logLevel: "error",
    onProgress: ({ progress }) => { const p = Math.floor(progress * 10); if (p !== last && process.stderr.isTTY) { last = p; process.stderr.write(`черновик ${p * 10}%\r`); } },
  }));
  const sec = (Date.now() - t) / 1000;
  if (hasAudio(raw)) { loudnorm(raw, draft); rmSync(raw, { force: true }); } else renameSync(raw, draft);
  const g = guard.save(draft.replace(/\.mp4$/, ".guard.json"));
  const list = [...tracks.values()].sort((p, q) => p.f - q.f);
  writeFileSync(join(outDir, "tracks.json"), JSON.stringify({ fps: comp.fps, frames: comp.durationInFrames, tracks: list }));
  return { tracks: list, guard: g, fps: comp.fps, frames: comp.durationInFrames, sec };
};

// ---------- разбор треков элементов ----------
const runs = (frames: number[], gap = 1): Array<[number, number]> => {
  const s = [...new Set(frames)].sort((p, q) => p - q);
  const out: Array<[number, number]> = [];
  for (const f of s) { if (out.length && f - out[out.length - 1][1] <= gap) out[out.length - 1][1] = f; else out.push([f, f]); }
  return out;
};

const analyzeTracks = (tracks: Track[], fps: number, cuts: number[]) => {
  if (!tracks.length) return;
  const W = tracks[0].W, H = tracks[0].H;
  const nearCut = (f: number) => cuts.some((c) => Math.abs(c - f) <= 1);
  const series = new Map<string, Array<Item & { f: number }>>();
  for (const t of tracks) for (const it of t.items) {
    if (it.w >= W * 0.98 && it.h >= H * 0.98) continue; // фон во весь кадр — его ведёт probe/CoverImage
    if (it.px) continue; // замер героя (пустая обёртка 3D, <g> в svg) — его движение видит probe по пикселям
    const arr = series.get(it.k) ?? [];
    arr.push({ ...it, f: t.f });
    series.set(it.k, arr);
  }
  const L = 0.006 * W, minMove = 0.0015 * W;
  const found: Record<string, Array<{ id: string; frames: [number, number]; value: number; extra?: string }>> = { fast: [], fontSwap: [], reversal: [], jitter: [], actJitter: [], width: [], flicker: [], pop: [] };
  for (const [id, s] of series) {
    s.sort((p, q) => p.f - q.f);
    // Игра персонажа (data-acting на этих кадрах): прыжок, падение, сжатие — ремесло, а не
    // «прыгает кадр». Скорость и перелёты в эти кадры не проверяются; дрожь (3+ разворота в
    // секунду) — WARN act-jitter.
    const actFlips: number[] = [];
    const actDir: Record<"x" | "y", number> = { x: 0, y: 0 };
    const fastFrames: number[] = [];
    let peak = 0;
    const lastDir: Record<"x" | "y", { f: number; s: number } | null> = { x: null, y: null };
    const flips: Record<"x" | "y" | "w", number[]> = { x: [], y: [], w: [] };
    let lastW: { f: number; s: number } | null = null;
    let lastO: { f: number; s: number } | null = null;
    const oFlips: number[] = [];
    for (let i = 1; i < s.length; i++) {
      const p = s[i - 1], c = s[i];
      if (c.f - p.f !== 1 || nearCut(c.f) || p.o < 0.3 || c.o < 0.3) continue;
      const dx = c.x + c.w / 2 - (p.x + p.w / 2), dy = c.y + c.h / 2 - (p.y + p.h / 2), dw = c.w - p.w;
      // Резкая смена размера — это другой элемент под тем же ключом (страница подписей,
      // новая строка в той же плашке), а не движение.
      if (Math.abs(dw) > 0.25 * Math.max(1, p.w) || Math.abs(c.h - p.h) > 0.25 * Math.max(1, p.h)) continue;
      const v = Math.hypot(dx, dy) + Math.abs(dw) / 2;
      if (c.a || p.a) {
        for (const [ax, d] of [["x", dx], ["y", dy]] as const) {
          if (Math.abs(d) < minMove) continue;
          const sg = Math.sign(d);
          if (actDir[ax] !== 0 && actDir[ax] !== sg) actFlips.push(c.f);
          actDir[ax] = sg;
        }
        continue;
      }
      if (v > L) { fastFrames.push(c.f); peak = Math.max(peak, v); }
      for (const [ax, d] of [["x", dx], ["y", dy]] as const) {
        if (Math.abs(d) < minMove) continue;
        const sg = Math.sign(d), ld = lastDir[ax];
        if (ld && ld.s !== sg && c.f - ld.f < fps) flips[ax].push(c.f);
        lastDir[ax] = { f: c.f, s: sg };
      }
      if (Math.abs(dw) > 1 && c.t === "text") {
        const sg = Math.sign(dw);
        if (lastW && lastW.s !== sg && c.f - lastW.f < fps) flips.w.push(c.f);
        lastW = { f: c.f, s: sg };
      }
      const dO = c.o - p.o;
      if (Math.abs(dO) > 0.08) {
        const sg = Math.sign(dO);
        if (lastO && lastO.s !== sg && c.f - lastO.f < fps / 2) oFlips.push(c.f);
        lastO = { f: c.f, s: sg };
      }
    }
    // Скачок текста в первые кадры его жизни одним кадром — почти всегда подмена запасного
    // шрифта загруженным (ширина строки меняется), а не движение: INFO, не FAIL.
    const born = s[0].f;
    for (const r of runs(fastFrames)) {
      if (!(r[1] - r[0] >= 1 || peak > 3 * L)) continue;
      if (s[0].t === "text" && r[1] - r[0] <= 1 && r[0] - born <= 10) { found.fontSwap.push({ id, frames: r, value: +(peak / W * 100).toFixed(2) }); continue; }
      found.fast.push({ id, frames: r, value: +(peak / W * 100).toFixed(2) });
    }
    for (const ax of ["x", "y"] as const) {
      for (const r of runs(flips[ax], fps)) {
        const n = flips[ax].filter((f) => f >= r[0] && f <= r[1]).length;
        (n >= 3 ? found.jitter : found.reversal).push({ id, frames: r, value: n, extra: ax === "x" ? "по горизонтали" : "по вертикали" });
      }
    }
    for (let i = 0; i < actFlips.length; i++) {
      const n = actFlips.filter((f) => f >= actFlips[i] && f < actFlips[i] + fps).length;
      if (n >= 4) { found.actJitter.push({ id, frames: [actFlips[i], actFlips[i] + fps], value: n, extra: "" }); break; }
    }
    for (const r of runs(flips.w, fps)) if (flips.w.filter((f) => f >= r[0] && f <= r[1]).length >= 3) found.width.push({ id, frames: r, value: 0 });
    for (const r of runs(oFlips, fps)) if (oFlips.filter((f) => f >= r[0] && f <= r[1]).length >= 2) found.flicker.push({ id, frames: r, value: 0 });
    // Выскакивание: элемент появился сразу почти непрозрачным, крупный, не на склейке.
    for (let i = 0; i < s.length; i++) {
      const c = s[i], p = s[i - 1];
      if (c.f === tracks[0].f || nearCut(c.f)) continue;
      if (c.t === "text" || c.c) continue; // текст появляется по словам; шторка — не скачок
      if ((!p || p.f !== c.f - 1) && c.o >= 0.85 && (c.w * c.h) / (W * H) >= 0.015) found.pop.push({ id, frames: [c.f, c.f], value: +((c.w * c.h) / (W * H) * 100).toFixed(1) });
    }
  }
  for (const x of found.fast) issues.push({ level: x.value > 1.8 ? "FAIL" : "WARN", source: "track", kind: "el-fast", id: x.id, frames: x.frames, msg: `«${x.id}» движется до ${x.value} % ширины за кадр (лимит 0.6) — рывок` });
  for (const x of found.fontSwap) issues.push({ level: "INFO", source: "track", kind: "el-fast?", id: x.id, frames: x.frames, msg: `«${x.id}» скачет одним кадром в начале своей жизни (${x.value} %W) — похоже на подмену шрифта при загрузке, не движение; глянь кадры ${x.frames[0]}–${x.frames[1] + 1}, если сомневаешься` });
  for (const x of found.jitter) issues.push({ level: "FAIL", source: "track", kind: "el-jitter", id: x.id, frames: x.frames, msg: `«${x.id}» ${x.value} раз меняет направление ${x.extra} за секунду — дрожит/пружинит` });
  for (const x of found.actJitter) issues.push({ level: "WARN", source: "track", kind: "act-jitter", id: x.id, frames: x.frames, msg: `«${x.id}» (data-acting) ${x.value} раз меняет направление за секунду — игра или дрожь? посмотри ленту` });
  for (const x of found.reversal) issues.push({ level: "WARN", source: "track", kind: "el-reversal", id: x.id, frames: x.frames, msg: `«${x.id}» разворачивается ${x.extra} быстрее чем через секунду — перелёт/отскок` });
  for (const x of found.width) issues.push({ level: "FAIL", source: "track", kind: "el-width-jitter", id: x.id, frames: x.frames, msg: `«${x.id}»: ширина текста дёргается туда-сюда — цифры без tabular-nums или раскладка на каждом кадре` });
  for (const x of found.flicker) issues.push({ level: "WARN", source: "track", kind: "el-flicker", id: x.id, frames: x.frames, msg: `«${x.id}» мигает (прозрачность туда-обратно быстрее полсекунды)` });
  const popFrames = found.pop.map((x) => x.frames[0]).sort((p, q) => p - q);
  for (let i = 0; i < popFrames.length; i++) {
    const inSec = popFrames.filter((f) => f >= popFrames[i] && f < popFrames[i] + fps).length;
    if (inSec > 2) { issues.push({ level: "WARN", source: "track", kind: "pop-rate", frames: [popFrames[i], popFrames[i] + fps], msg: `${inSec} крупных элементов выскакивают без появления за секунду — мельтешит` }); break; }
  }
  for (const x of found.pop.slice(0, 6)) issues.push({ level: "INFO", source: "track", kind: "el-pop", id: x.id, frames: x.frames, msg: `«${x.id}» (${x.value} % кадра) появляется без перехода` });
};

// ---------- отчёт страховки ----------
const analyzeGuard = (guard: GuardHit[], fps: number, briefNums: Set<number>) => {
  const minRun = Math.round(0.3 * fps);
  for (const g of guard) {
    // Число брифа (цена, зарплата, дата) крутится прокруткой дольше 0.5 с — на паузе и скриншоте
    // зритель видит чужие числа («от 14 000» вместо «от 55 000»).
    if (g.kind === "note:roll" && g.worst >= 10 && briefNums.has(Math.round(g.worst)) && g.frames.length > 0.5 * fps) {
      issues.push({ level: "WARN", source: "guard", kind: "fact-unreadable", id: g.id, frames: [g.frames[0], g.frames[g.frames.length - 1]], msg: `«${g.id}»: число брифа ${g.worst} ${(g.frames.length / fps).toFixed(1)} с показывает промежуточные значения — факт заказчика читается с первого кадра. Прокрутка — для счётчика роста, не для цены/зарплаты/даты: RollNumber turns=0 (крутятся только младшие разряды), scaleStep или maskReveal` });
      continue;
    }
    // Герой анфас идёт через кадр — приставной шаг дольше пары шагов читается как шарканье влево-вправо.
    if (g.kind === "note:rig-shuffle") {
      const r = runs(g.frames).reduce((m, x) => (x[1] - x[0] > m[1] - m[0] ? x : m), [0, -1] as [number, number]);
      if (r[1] >= r[0]) issues.push({ level: "WARN", source: "guard", kind: "rig-front-walk", frames: r, msg: `герой анфас идёт вбок дальше своего роста (${((r[1] - r[0] + 1) / fps).toFixed(1)} с) — приставной шаг на длинном пути читается как «шарканье влево-вправо». Через кадр — лист в профиль (studio rig cut --side); анфас — подход до роста, «к зрителю» сменой плана или move` });
      continue;
    }
    if (g.kind.startsWith("note:")) continue;
    const rs = runs(g.frames);
    const longest = rs.reduce((m, r) => Math.max(m, r[1] - r[0] + 1), 0);
    const span: [number, number] = [g.frames[0], g.frames[g.frames.length - 1]];
    const det = JSON.stringify(g.detail);
    if ((g.kind === "text-cut" || g.kind === "text-outside-safe") && g.frames[g.frames.length - 1] < 10 && longest < minRun) {
      issues.push({ level: "INFO", source: "guard", kind: `${g.kind}?`, id: g.id, frames: span, msg: `«${g.id}» ${g.kind === "text-cut" ? "обрезан краем" : "вне безопасной зоны"} только в кадрах ${span[0]}–${span[1]} (до загрузки шрифта?) — глянь кадр 10; если там цело, это не брак` });
    } else if (g.kind === "edge-cut" || g.kind === "text-cut") {
      issues.push({ level: longest >= minRun || g.kind === "text-cut" ? "FAIL" : "WARN", source: "guard", kind: g.kind, id: g.id, frames: span, msg: `«${g.id}» обрезан краем кадра ${longest} кадров подряд (${g.frames.length} всего; худшее ${g.worst}px) ${det}${longest < minRun ? " — короткий вход/выход? если нарочно — data-bleed" : ""}` });
    } else if (g.kind === "text-outside-safe") {
      issues.push({ level: longest >= minRun ? "FAIL" : "WARN", source: "guard", kind: g.kind, id: g.id, frames: span, msg: `«${g.id}» вне безопасной зоны (под интерфейсом площадки) ${g.frames.length} кадров; худшее ${g.worst}px` });
    } else if (g.kind === "text-tiny") {
      const frac = Number((g.detail as { frac?: number })?.frac ?? 0);
      issues.push({ level: frac && frac < 0.018 ? "FAIL" : "WARN", source: "guard", kind: g.kind, id: g.id, frames: span, msg: `«${g.id}»: кегль ${(frac * 100).toFixed(1)} % высоты (${g.frames.length} кадров) — меньше 3 % на телефоне читается с трудом, меньше 1.8 % — брак. Всё, что зритель должен прочесть, — размером подписи; нарочно мелкое (сноска, декор) — data-decor` });
    } else if (g.kind === "empty-plate") {
      issues.push({ level: longest >= 2 ? "WARN" : "INFO", source: "guard", kind: g.kind, id: g.id, frames: span, msg: `«${g.id}»: видна плашка без текста ${longest} кадров подряд — смена текста через «пустую карточку»; меняйте текст в плашке перекрёстно (SwapText из kinetic-typography)` });
    } else if (g.kind === "cover-upscale") {
      issues.push({ level: "WARN", source: "guard", kind: g.kind, id: g.id, frames: span, msg: `«${g.id}»: фон растянут до ×${g.worst} — на телефоне мыло. Картинка нужной ориентации (9:16 — вертикальная), меньше наезд, или план, где фон не во весь экран — ${det}` });
    } else if (g.kind === "text-overflow") {
      issues.push({ level: "WARN", source: "guard", kind: g.kind, id: g.id, frames: span, msg: `«${g.id}»: буквы вылезают за плашку на ${g.worst}px (${g.frames.length} кадров) ${det}` });
    } else if (g.kind === "text-tight") {
      issues.push({ level: "INFO", source: "guard", kind: g.kind, id: g.id, frames: span, msg: `«${g.id}»: буквы почти касаются края плашки ${det}` });
    } else if (g.kind === "text-under-ui") {
      const role = String((g.detail as { role?: string } | null)?.role ?? "");
      issues.push({ level: longest >= minRun && /cta|offer/.test(role) ? "FAIL" : "WARN", source: "guard", kind: g.kind, id: g.id, frames: span, msg: `«${g.id}»${role ? ` (${role})` : ""} в колонке кнопок ленты справа (нижняя половина кадра) ${g.frames.length} кадров — лайк/комментарии/звук закроют текст` });
    } else if (g.kind === "text-clipped") {
      // Срезанные буквы, которые держатся (не кадр-другой анимации появления), — брак, который зритель
      // видит сразу: FAIL, а не WARN (на проде такие ролики уходили в чат с обрезанной цитатой).
      const vert = /top|bottom/.test(String((g.detail as { side?: string } | null)?.side ?? ""));
      const why = vert ? "строки не влезли по высоте блока: выше блок, меньше текста или кегль (FitText)" : "подпись шире своей плашки/блока";
      issues.push({ level: longest >= 6 ? "FAIL" : "INFO", source: "guard", kind: g.kind, id: g.id, frames: span, msg: `«${g.id}»: буквы срезаны родителем (overflow) на ${g.worst}px, ${longest} кадров подряд — ${why} ${det}` });
    } else if (g.kind === "audit-misplaced") {
      issues.push({ level: "WARN", source: "guard", kind: g.kind, frames: span, msg: "FrameAudit не во весь кадр — положите его прямым ребёнком <Stage>" });
    } else {
      const fail = g.kind.startsWith("caption") || ["cover-gap", "outside-safe", "motion-too-fast", "sfx-units"].includes(g.kind);
      issues.push({ level: fail ? "FAIL" : "WARN", source: "guard", kind: g.kind, id: g.id, frames: span, msg: `«${g.id}»: ${g.frames.length} кадров, худшее ${g.worst} — ${det}` });
    }
  }
};

const sheet = (args: string[]): string | null => {
  const r = spawnSync(TSX, [join(BIN, "sheet.ts"), ...args], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim().split("  ")[0] : null;
};

const main = async () => {
  // 1) lint
  for (const l of lintJob(dir)) issues.push({ level: l.level, source: "lint", kind: l.kind, msg: `${l.file}:${l.line} — ${l.msg}${l.code ? ` [${l.code}]` : ""}` });
  // 2) check
  const ch = spawnSync(TSX, [join(BIN, "check.ts"), "--job", dir], { encoding: "utf8" });
  if (ch.status !== 0) {
    issues.push({ level: "FAIL", source: "check", kind: "check", msg: (ch.stdout + ch.stderr).trim().slice(0, 2000) });
    return finish(null);
  }
  // 3) рендер
  let r: Awaited<ReturnType<typeof render>>;
  if (a.reuse && existsSync(draft) && existsSync(join(outDir, "tracks.json"))) {
    const j = JSON.parse(readFileSync(join(outDir, "tracks.json"), "utf8"));
    const gf = draft.replace(/\.mp4$/, ".guard.json");
    r = { tracks: j.tracks, guard: existsSync(gf) ? JSON.parse(readFileSync(gf, "utf8")).violations ?? [] : [], fps: j.fps, frames: j.frames, sec: 0 };
  } else r = await render();
  // 4) probe
  const cuts = plannedCuts();
  const wordsF = join(dir, "public", "words.json");
  const pr = spawnSync(TSX, [join(BIN, "probe.ts"), draft, "--json", ...(cuts?.length ? ["--cuts", cuts.join(",")] : []), ...(existsSync(wordsF) ? ["--words", wordsF] : [])], { encoding: "utf8", maxBuffer: 64 << 20 });
  let probe: ({ verdict: string; cuts: number[]; issues: Array<{ level: Level; kind: string; frames: [number, number]; msg: string }>; audio: unknown; maxSpeedPctPerFrame: number; cutsPerMin: number } & ProbeFeed) | null = null;
  try { probe = JSON.parse(pr.stdout); } catch { issues.push({ level: "WARN", source: "probe", kind: "probe-error", msg: pr.stderr.slice(0, 500) }); }
  // Сверка с DOM: probe видит «пустую полосу» по однотонной области у края. Если на этих
  // кадрах картинка/холст во весь кадр (по трекам FrameAudit) — полоса в самой картинке.
  const covered = new Set(r.tracks.filter((t) => t.items.some((it) => it.wd || (it.t !== "text" && it.t !== "box" && it.o >= 0.95 && it.x <= 1 && it.y <= 1 && it.x + it.w >= t.W - 1 && it.y + it.h >= t.H - 1))).map((t) => t.f));
  for (const i of probe?.issues ?? []) {
    if (i.kind.startsWith("guard:")) continue;
    if (i.kind === "edge-crossing" && r.tracks.some((t) => t.f >= i.frames[0] && t.f <= i.frames[1] && t.items.some((it) => it.wd))) { issues.push({ level: "INFO", source: "probe", kind: "edge-crossing?", frames: i.frames, msg: `${i.msg} — в этих кадрах 3D-мир во весь кадр (data-world): край режет мир, это не вылет` }); continue; }
    if (i.kind === "cover-gap" && covered.size) {
      let n = 0, k = 0;
      for (let f = i.frames[0]; f <= i.frames[1]; f++) { n++; if (covered.has(f)) k++; }
      if (k === n) { issues.push({ level: "INFO", source: "probe", kind: "cover-gap?", frames: i.frames, msg: `${i.msg} — но по DOM фон-картинка покрывает кадр целиком: это однотонная область самой картинки; глянь ленту` }); continue; }
    }
    if (i.kind === "edge-crossing") {
      const bleedHere = r.tracks.some((t) => t.f >= i.frames[0] && t.f <= i.frames[1] && t.items.some((it) => it.b));
      if (bleedHere) { issues.push({ level: "INFO", source: "probe", kind: "edge-crossing?", frames: i.frames, msg: `${i.msg} — в этих кадрах есть слой data-bleed (нарочный выход/вход): проверь ленту — выход мотивирован и продолжается на следующем плане?` }); continue; }
    }
    // Бит открывается стоп-кадром: застой начинается в первую секунду после склейки по плану.
    if (i.kind === "stale" && (cuts ?? []).some((c) => i.frames[0] >= c - 2 && i.frames[0] <= c + (r.fps || 30))) { issues.push({ level: "WARN", source: "probe", kind: "stale-open", frames: i.frames, msg: `${i.msg} — и начинается сразу после склейки: бит открывается стоп-кадром. Не принимается фразой «действие медленное»: бит входит в середину действия или крупностью на то, что движется` }); continue; }
    issues.push({ level: i.level, source: "probe", kind: i.kind, frames: i.frames, msg: i.msg });
  }
  // 5) треки и страховка
  const allCuts = [...new Set([...(cuts ?? []), ...(probe?.cuts ?? [])])];
  if (!r.tracks.length) issues.push({ level: "WARN", source: "track", kind: "no-tracks", msg: "треков нет: <FrameAudit/> не стоит в Stage — проверка по элементам пропущена" });
  analyzeTracks(r.tracks, r.fps, allCuts);
  const bfile = join(dir, "brief.md");
  analyzeGuard(r.guard, r.fps, existsSync(bfile) ? briefNumbers(readFileSync(bfile, "utf8")) : new Set());
  // 6) лента: герой, пустые полосы, кадр 0, без звука, контраст по пикселям
  const segs = segmentsOf(readBeats(), allCuts, r.frames, r.fps);
  // Нарисованный герой: второй проход кадров со слоем data-hero отдельно (секунды, бесплатно).
  let ink = new Map<number, Ink>();
  const S0 = r.tracks[0]?.S;
  if (S0 && r.tracks.some((t) => t.items.some((it) => it.r === "hero"))) {
    try { ink = await measureHeroInk(await bundleJob(dir), COMPOSITION, inkFrames(segs, r.frames - 1), { props: parseProps(a), gl: glOpt(a), S: S0 }); }
    catch (e) { issues.push({ level: "INFO", source: "feed", kind: "hero-ink?", msg: `герой по пикселям не померен (${String(e).slice(0, 120)}) — размер по коробке` }); }
  }
  const wf = join(dir, "public", "words.json");
  const fd = analyzeFeed(r.tracks, r.fps, allCuts, existsSync(wf) ? wf : null, ink);
  issues.push(...fd.issues);
  const ct = await measureContrast(draft, r.tracks, r.fps);
  issues.push(...ct.issues);
  fd.m.contrast = ct.rows;
  // 7) планы, композиция, цифры брифа
  const bf = join(dir, "brief.md");
  const f2 = analyzeFeed2(r.tracks, r.fps, segs, existsSync(bf) ? readFileSync(bf, "utf8") : null);
  issues.push(...f2.issues);
  // Коробка героя на кадре (по трекам; кадры черновика — в масштабе --scale, сравнение кропов
  // этого не замечает: обе стороны склейки в одном масштабе).
  const byF = new Map(r.tracks.map((t) => [t.f, t]));
  const heroAt = (f: number) => {
    const hs = byF.get(f)?.items.filter((it) => it.r === "hero" && it.t !== "text" && it.o >= 0.5) ?? [];
    if (!hs.length) return null;
    const x = Math.min(...hs.map((h) => h.x)), y = Math.min(...hs.map((h) => h.y));
    return { x, y, w: Math.max(...hs.map((h) => h.x + h.w)) - x, h: Math.max(...hs.map((h) => h.y + h.h)) - y };
  };
  const sh = await analyzeShots(draft, segs, r.fps, (probe as { diffs?: number[] } | null)?.diffs ?? null, { planned: cuts ?? [], detected: probe?.cuts, heroAt, W: r.tracks[0]?.W });
  issues.push(...sh.issues);
  // Герой по битам, контракт развязки, финал, однообразие раскладки, робкое движение.
  const pseg = segs.find(isPayoff);
  const pt = pseg ? await measurePayoffText(draft, r.tracks, r.fps, pseg) : null;
  const eh = await endHoldSec(draft, r.frames, r.fps);
  const bt = analyzeBeats(r.tracks, r.fps, segs, { ink, diffs: (probe as { diffs?: number[] } | null)?.diffs ?? null, payoffTextSec: pt?.sec ?? null, payoffTextFact: pt?.fact, endHoldSec: eh });
  issues.push(...bt.issues);
  // Кульминация на уже показанной картинке: удар приходится на знакомый кадр.
  const cl = sh.m.climax?.id;
  const reuse = cl ? sh.m.similar.find((x) => x.b === cl || x.a === cl) : undefined;
  if (cl && reuse) issues.push({ level: "INFO", source: "feed", kind: "climax-reuse", msg: `кульминация ${cl} почти повторяет ${reuse.a === cl ? reuse.b : reuse.a} (${reuse.sim}) — главное обещание на уже виденном кадре. Кадр-доказательство обещания: новый угол или новая информация` });
  // 8) форма: слайд-шоу, метроном, призыв
  const fm = analyzeForm(r.tracks, r.fps, segs);
  issues.push(...fm.issues);
  // Список-слайд-шоу без фото: ≥ 5 планов одной длины и кульминация не выделена — «по пункту
  // на карточку» (вакансия, условия, прайс). Фото-карусель ловит slideshow выше.
  if (fm.m.shotCv !== null && fm.m.shotCv < 0.3 && segs.length >= 5 && fm.m.slideshow.length < 3 && (!sh.m.climax || sh.m.climax.ratio < CLIMAX_MIN)) {
    issues.push({ level: "WARN", source: "feed", kind: "list-slideshow", msg: `${segs.length} планов почти одной длины (разброс ${Math.round(fm.m.shotCv * 100)} %), кульминация ${sh.m.climax ? `×${sh.m.climax.ratio}` : "не помечена"} — «по пункту на карточку». Список — содержание, а не форма: мелкое — быстрой серией (2–3 пункта за 1.5 с), главному — долгий план и удар; или форма «смена изнутри», «вопрос зрителя → ответ» (beat-planner: списки)` });
  }
  // 9) факты брифа: дни недели, числа не из брифа, регулируемая категория и её пометка
  for (const x of reviewFacts(dir, r.tracks, r.fps)) issues.push({ level: x.level, source: "feed", kind: x.kind, msg: x.msg });
  return finish({ ...r, cuts: cuts ?? [], probe, feed: fd.m, feed2: f2.m, shots: sh.m, form: fm.m, segs, beats: bt.m, ink });
};

type ProbeFeed = { speedBudgetUsedPct?: number; staleShare?: number; longestStaleSec?: number; open?: { busy0: number; change1_5s: number; firstVoiceSec: number | null }; open10?: { cuts: number; events: number; longestStillSec: number }; busyThirds?: number[]; endStatic?: boolean; emptyThirdShare?: number[] };
type Ctx = { fps: number; frames: number; sec: number; cuts: number[]; probe: ({ verdict: string; cuts: number[]; audio: unknown; maxSpeedPctPerFrame: number; cutsPerMin: number } & ProbeFeed) | null; feed?: FeedMetrics; feed2?: Feed2Metrics; shots?: ShotMetrics; form?: FormMetrics; segs?: Segment[]; beats?: BeatsMetrics; ink?: Map<number, Ink>; tracks?: Track[] };

// Склейка нескольких листов в одну картинку (одна Read вместо пяти): строки друг под другом,
// каждая — к общей ширине, подпись слева сверху.
const stack = async (rows: Array<{ file: string; label: string }>, out: string, width = 1500): Promise<string | null> => {
  const parts: Array<{ input: Buffer; top: number; left: number }> = [];
  let y = 0;
  for (const r of rows) {
    if (!existsSync(r.file)) continue;
    const img = await sharp(r.file).resize({ width, withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
    const lab = Buffer.from(`<svg width="${width}" height="34" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111"/><text x="10" y="24" font-family="Helvetica" font-size="20" fill="#fff">${r.label.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text></svg>`);
    parts.push({ input: lab, top: y, left: 0 }); y += 34;
    parts.push({ input: img.data, top: y, left: 0 }); y += img.info.height + 6;
  }
  if (!parts.length) return null;
  await sharp({ create: { width, height: y, channels: 3, background: "#222" } }).composite(parts).png().toFile(out);
  return out;
};

// Ленточка кадров черновика с рамкой нарисованного героя и подписью (для review.png и критика).
const overlayStrip = async (frames: Array<{ f: number; label: string; box?: { x: number; y: number; w: number; h: number } | null }>, W: number, out: string): Promise<string | null> => {
  if (!frames.length || !existsSync(draft)) return null;
  const { dir: tmp, files } = extractFrames(draft, frames.map((x) => x.f));
  try {
    const TW = 300, parts: Array<{ input: Buffer; left: number; top: number }> = [];
    let TH = 0, x = 0;
    for (const fr of frames) {
      const file = files.get(fr.f);
      if (!file) continue;
      const img = await sharp(file).resize({ width: TW }).png().toBuffer({ resolveWithObject: true });
      TH = img.info.height;
      parts.push({ input: img.data, left: x, top: 0 });
      const k = TW / W;
      const rect = fr.box && fr.box.w > 0 ? `<rect x="${fr.box.x * k}" y="${fr.box.y * k}" width="${fr.box.w * k}" height="${fr.box.h * k}" fill="none" stroke="#ff2d55" stroke-width="3"/>` : "";
      parts.push({ input: Buffer.from(`<svg width="${TW}" height="${TH}" xmlns="http://www.w3.org/2000/svg">${rect}<rect y="${TH - 30}" width="${TW}" height="30" fill="rgba(0,0,0,.7)"/><text x="6" y="${TH - 9}" font-family="Helvetica" font-size="17" fill="#fff">${fr.label.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text></svg>`), left: x, top: 0 });
      x += TW + 6;
    }
    if (!parts.length) return null;
    await sharp({ create: { width: x, height: TH, channels: 3, background: "#222" } }).composite(parts).png().toFile(out);
    return out;
  } finally { rmSync(tmp, { recursive: true, force: true }); }
};

const finish = async (c: Ctx | null) => {
  const order: Record<Level, number> = { FAIL: 0, WARN: 1, INFO: 2 };
  // Сначала то, что видит зритель ленты: крючок, герой, финал, затем остальное.
  const prio = (k: string) => (isRibbon(k) ? -1 : /date|invented|disclaimer|regulated|hook|open|offer|hero|dull|same-shot|slideshow|climax|top-heavy|headline|stale|edge|cut|text/.test(k) ? 0 : 1);
  issues.sort((p, q) => order[p.level] - order[q.level] || prio(p.kind) - prio(q.kind) || (p.frames?.[0] ?? 0) - (q.frames?.[0] ?? 0));
  const verdict = issues.some((i) => i.level === "FAIL") ? "FAIL" : issues.some((i) => i.level === "WARN") ? "WARN" : "PASS";
  const nF = issues.filter((i) => i.level === "FAIL").length, nW = issues.filter((i) => i.level === "WARN").length, nI = issues.filter((i) => i.level === "INFO").length;
  // ---- листы ----
  const looks: Array<{ file: string; why: string }> = [];
  const extra: Array<{ file: string; why: string }> = [];
  if (c && existsSync(draft)) {
    const L = c.frames - 1, fps = c.fps;
    const hookF = [0, 0.25, 0.5, 0.75, 1, 1.5].map((t) => Math.min(L, Math.round(t * fps)));
    const hook = sheet([draft, "--frames", [...new Set(hookF)].join(","), "--cols", "6", "--width", "300", "--out", join(outDir, "phone-hook.png")]);
    const endF = [2, 1.5, 1, 0.5, 0].map((t) => Math.max(0, L - Math.round(t * fps)));
    const end = sheet([draft, "--frames", [...new Set([...endF, 0, Math.min(L, Math.round(fps * 0.5))])].join(","), "--cols", "7", "--width", "300", "--out", join(outDir, "phone-end.png")]);
    const bestF = [0, ...(c.shots?.bestFrames ?? [])];
    const best = bestF.length > 1 ? sheet([draft, "--frames", [...new Set(bestF)].join(","), "--cols", String(Math.min(4, new Set(bestF).size)), "--width", "300", "--out", join(outDir, "phone-best.png")]) : null;
    // Развязка: первый, пиковый и последний кадр бита payoff с рамкой нарисованного героя.
    const W0 = c.tracks?.[0]?.W ?? 1080;
    const ps = c.segs?.find(isPayoff);
    let payoffStrip: string | null = null;
    if (ps) {
      const tf = new Map((c.tracks ?? []).map((t) => [t.f, t]));
      const realInk = [...(c.ink?.values() ?? [])].filter((v) => { const t = tf.get(v.f); return !t || !heroItems(t).textOnly; });
      const near = (f: number) => { let best: Ink | null = null; for (const v of realInk) if (!best || Math.abs(v.f - f) < Math.abs(best.f - f)) best = v; return best && Math.abs(best.f - f) <= fps ? best : null; };
      const inPay = realInk.filter((v) => v.f >= ps.from && v.f < ps.to).sort((p, q) => q.share - p.share)[0];
      const fr = [ps.from, inPay?.f ?? Math.round((ps.from + ps.to) / 2), ps.to - 1].map((f, i) => { const v = near(f); return { f, label: `${["начало", "пик", "конец"][i]} ${ps.id} · ${(f / fps).toFixed(1)} с${v ? ` · герой ${Math.round(v.share * 100)} %` : ""}`, box: v }; });
      payoffStrip = await overlayStrip(fr, W0, join(outDir, "phone-payoff.png"));
    }
    const cf = join(dir, "concept.md");
    const prom = existsSync(cf) ? promiseTimes(readFileSync(cf, "utf8")) : [];
    const promStrip = prom.length ? await overlayStrip(prom.map((p0) => ({ f: Math.min(L, Math.round(p0.sec * fps)), label: `${p0.what} ${p0.sec} с: ${p0.text}`.slice(0, 34) })), W0, join(outDir, "phone-promise.png")) : null;
    const ph = sheet([draft, "--n", String(Math.max(6, Math.min(16, Math.round(c.frames / fps / 2)))), "--cols", "8", "--width", "220", "--out", join(outDir, "phone-sheet.png")]);
    const combo = await stack([
      ...(hook ? [{ file: hook, label: "КРЮЧОК 0–1.5 с (кадр 0 = превью в ленте)" }] : []),
      ...(best ? [{ file: best, label: "КАДР 0 против трёх самых ярких кадров ролика" }] : []),
      ...(payoffStrip ? [{ file: payoffStrip, label: "РАЗВЯЗКА: начало / пик / конец бита payoff, красная рамка — нарисованный герой" }] : []),
      ...(promStrip ? [{ file: promStrip, label: `ОБЕЩАНИЕ КОНЦЕПТА (concept.md): ${prom.map((p0) => `${p0.what} ${p0.sec} с — ${p0.text}`).join("; ")}`.slice(0, 140) }] : []),
      ...(end ? [{ file: end, label: "ФИНАЛ: кадры 0 и 0.5 с, затем последние 2 с (шов петли)" }] : []),
    ], join(outDir, "review.png"));
    if (combo) looks.push({ file: combo, why: "крючок, кадр 0 против лучших, финал и шов петли — плитки размера телефона" });
    if (ph) looks.push({ file: ph, why: "весь ролик плитками: герой крупный? каждые 2–3 с новое? планы не повторяются?" });
    // Ленты движения — только по месту проблемы; открывать, если FAIL по движению непонятен.
    const spots: Array<{ f: number; why: string }> = [];
    for (const i of issues.filter((x) => x.frames && x.level === "FAIL" && x.source !== "lint")) {
      const f = i.frames![0];
      if (!spots.some((s2) => Math.abs(s2.f - f) < 8)) spots.push({ f, why: `${i.level} ${i.kind}${i.id ? ` «${i.id}»` : ""}` });
      if (spots.length >= 3) break;
    }
    // Доказательство процесса (бит kind proof/доказ…): ленточка начала, середины и конца —
    // инструмент уходит, когда дело сделано? поверит ли мастер этого дела?
    for (const sg of (c.segs ?? []).filter((x) => /proof|доказ/i.test(x.kind ?? "")).slice(0, 2)) {
      const fr = Array.from({ length: 6 }, (_, i) => Math.round(sg.from + ((sg.to - 1 - sg.from) * i) / 5));
      const out = sheet([draft, "--frames", [...new Set(fr)].join(","), "--cols", "6", "--width", "200", "--out", join(outDir, `strip-proof-${sg.id}.png`)]);
      if (out) extra.push({ file: out, why: `доказательство ${sg.id} (один раз): начало/середина/конец процесса — инструмент уходит, когда дело сделано? поверит ли мастер?` });
    }
    for (const sp of spots) {
      const a0 = Math.max(0, sp.f - 2), b0 = Math.min(c.frames - 1, a0 + 5);
      const out = sheet([draft, "--frames", `${a0}-${b0}`, "--cols", "6", "--width", "200", "--out", join(outDir, `strip-${a0}-${b0}.png`)]);
      if (out) extra.push({ file: out, why: `кадры ${a0}–${b0}: ${sp.why}` });
    }
  }
  const rel = (p: string) => relative(dir, p);
  rounds.history.push({ at: new Date().toISOString(), verdict, fail: nF, warn: nW });
  try { writeFileSync(roundsFile, JSON.stringify(rounds, null, 1)); } catch { /* не критично */ }
  const overRounds = rounds.n >= ROUND_LIMIT;
  const roundLabel = rounds.n > ROUND_LIMIT ? `круг ${rounds.n} (сверх лимита ${ROUND_LIMIT}: только ради FAIL)` : `круг ${rounds.n} из ${ROUND_LIMIT}`;
  const ribbon = [...new Set(issues.filter((i) => i.level === "WARN" && isRibbon(i.kind)).map((i) => i.kind))];
  const ribbonRule = `ленточные WARN (${ribbon.join(", ")}) — ворота финала: studio render не выпустит out/final.mp4, пока ★ открыт (будет out/candidate.mp4 и статус needs-stage-2). Закрыть: исправить, или один вариант (правка сцены → studio still --sheet/--vary) и строка в notes.md «★ <вид>: пробовал X → хуже, потому что…»; правка №1 критика — «Критик #1: сделано — …»`;
  const report = { job: basename(dir), verdict, round: rounds.n, roundLimit: ROUND_LIMIT, seconds: c ? +(c.frames / c.fps).toFixed(2) : null, renderSec: c?.sec ?? null, plannedCuts: c?.cuts ?? [], probe: c?.probe ? { verdict: c.probe.verdict, cuts: c.probe.cuts, cutsPerMin: c.probe.cutsPerMin, maxSpeedPctPerFrame: c.probe.maxSpeedPctPerFrame, audio: c.probe.audio, speedBudgetUsedPct: c.probe.speedBudgetUsedPct, staleShare: c.probe.staleShare, longestStaleSec: c.probe.longestStaleSec, open: c.probe.open, open10: c.probe.open10, busyThirds: c.probe.busyThirds } : null, feed: c?.feed ?? null, feed2: c?.feed2 ?? null, beats: c?.beats ?? null, shots: c?.shots ?? null, form: c?.form ?? null, issues, look: looks.map((l) => ({ file: rel(l.file), why: l.why })), strips: extra.map((l) => ({ file: rel(l.file), why: l.why })), tookSec: +((Date.now() - t0) / 1000).toFixed(1) };
  writeFileSync(join(outDir, "review.json"), JSON.stringify(report, null, 1));
  const pct = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${Math.round(v * 100)} %`);
  // ---- цифры ленты: короткие строки (и в терминал, и в отчёт) ----
  const nums: string[] = [];
  if (c) {
    const pf = c.probe, fm = c.feed, f2 = c.feed2, sm = c.shots;
    nums.push(`крючок: деталь кадра 0 ${pct(pf?.open?.busy0)}, за 1.5 с изменилось ${pct(pf?.open?.change1_5s)}; первое слово ${pf?.open?.firstVoiceSec ?? "—"} с; герой с ${fm?.hero.firstSec ?? "—"} с${fm && !fm.hero.marked ? " (без data-hero — догадка)" : ""}; кадр 0 по яркости/цвету — место ${sm?.open.rank ?? "—"} из ${sm?.open.of ?? "—"}`);
    nums.push(`первые 10 с: обновлений кадра ${pf?.open10?.events ?? "—"} (склеек ${pf?.open10?.cuts ?? "—"}), самый долгий стоп ${pf?.open10?.longestStillSec ?? "—"} с; весь ролик «стоит» ${pct(pf?.staleShare)} (дольше всего ${pf?.longestStaleSec ?? "—"} с)`);
    nums.push(`форма: фото-битов ${c.form?.photoBeats ?? 0}, из них «только наезд» ${c.form?.slideshow.length ?? 0}${c.form?.slideshow.length ? ` (${c.form.slideshow.slice(0, 5).join(", ")})` : ""}; разброс длины планов ${c.form?.shotCv ?? "—"}`);
    nums.push(`планы: уникальных ${sm?.unique ?? "—"} из ${sm?.segments ?? "—"}${sm?.similar.length ? ` (${sm.similar.slice(0, 3).map((x) => `${x.a}≈${x.b} ${x.sim}`).join(", ")})` : ""}; кульминация ${sm?.climax ? `${sm.climax.id} ×${sm.climax.ratio} от медианы энергии` : "— (нет бита kind payoff)"}`);
    if (c.beats?.beats.length) nums.push(`герой по битам (25-й перцентиль${c.beats.beats.some((b) => b.ink) ? ", по пикселям" : ""}): ${c.beats.beats.slice(0, 14).map((b) => `${b.id} ${Number.isFinite(b.p25) ? Math.round(b.p25 * 100) : "—"}`).join(" · ")} %; развязка ${c.beats.payoff ? `${c.beats.payoff.id}: герой ${pct(c.beats.payoff.share)} против ${pct(c.beats.payoff.prev)}, текст читается ${c.beats.payoff.textSec ?? "—"} с` : "— (нет бита kind payoff)"}; финал стоит ${c.beats.endHoldSec ?? "—"} с; биты с заметным движением ${c.beats.motionBeats} из ${c.beats.beats.length}`);
    nums.push(`герой: в среднем ${pct(fm?.hero.medianShare)} безопасной зоны (мин. ${pct(fm?.hero.minShare)}); композиция: центр на ${pct(f2?.composition.medianCy)} высоты зоны, низ ${pct(f2?.composition.medianBottom)}; пустые трети ${pf?.emptyThirdShare?.map((v) => pct(v)).join(" / ") ?? pf?.busyThirds?.map((v) => pct(v)).join(" / ") ?? "—"}`);
    nums.push(`текст: крупнейший по битам ${f2?.headline.length ? f2.headline.slice(0, 10).map((h) => `${h.id} ${(h.maxFrac * 100).toFixed(1)}`).join(" · ") + (f2.headline.length > 10 ? " …" : "") : "—"} (% высоты); без звука — текст ${fm?.muted ? pct(fm.muted.textShare) : "—"} времени речи${f2?.figures.length ? `; цифры брифа на экране: ${f2.figures.map((x) => `${x.fig} — ${x.firstSec ?? "нет"}${x.firstSec !== null ? " с" : ""}`).join(", ")}` : ""}`);
  }
  // ---- review.md ----
  const md: string[] = [];
  md.push(`# Самопроверка ${report.job}: ${verdict} (${roundLabel})`, "");
  if (overRounds) md.push(`**Круги исчерпаны.** Новый круг review — только ради FAIL. Косметические WARN не правь: в notes.md как принятые (одна строка «почему»).${ribbon.length ? ` Но ${ribbonRule}.` : ""} Застой дольше 5 с принимается, только если в notes.md названо, какая новая информация появляется внутри него каждые ~3 с («речь объясняет» — не она). Затем studio render → probe → mixcheck.`, "");
  if (c) md.push(`Черновик: \`${rel(draft)}\` — ${report.seconds} с, ${c.frames} кадров; склейки по плану: ${c.cuts.join(", ") || "нет"}; probe: ${c.probe?.verdict ?? "—"}, склеек ${c.probe?.cutsPerMin ?? "—"}/мин, макс. скорость кадра ${c.probe?.maxSpeedPctPerFrame ?? "—"} %W/кадр (${c.probe?.speedBudgetUsedPct ?? "—"} % лимита — потолок, а не цель); звук ${JSON.stringify(c.probe?.audio ?? null)}.`, "");
  md.push("## Сигналы", "", "Ленточные (крючок, кульминация, форма, факт) помечены ★ — они первыми в «Дела по приоритету».", "", "| Уровень | Источник | Что | Кадры | Подробно | Как исправить / пометить |", "|---|---|---|---|---|---|");
  for (const i of issues) md.push(`| ${i.level} | ${i.source} | ${isRibbon(i.kind) && i.level === "WARN" ? "★ " : ""}${i.kind} | ${i.frames ? `${i.frames[0]}–${i.frames[1]}` : ""} | ${i.msg.replace(/\|/g, "/").replace(/\n/g, " ")} | ${(HINT[i.kind.replace(/\?$/, "")] ?? "").replace(/\|/g, "/")} |`);
  if (!issues.length) md.push("| — | — | сигналов нет | | | |");
  md.push("", "## Посмотри глазами", "");
  for (const l of looks) md.push(`- \`${rel(l.file)}\` — ${l.why}`);
  for (const l of extra) md.push(`- (по нужде) \`${rel(l.file)}\` — ${l.why}`);
  if (c) {
    md.push("", "## Лента: цифры", "", ...nums.map((x) => `- ${x}`));
    if (c.feed?.contrast.length) md.push(`- контраст по пикселям (худшее): ${c.feed.contrast.slice(0, 8).map((x) => `${x.id} ${x.measured}`).join(", ")}`);
    if (c.feed2?.roles.length) md.push(`- роли текста (data-role, макс. % высоты): ${c.feed2.roles.map((x) => `${x.role} ${(x.maxFrac * 100).toFixed(1)}`).join(", ")}`);
    md.push("", "## Лента: вопросы (одной фразой каждое — в notes.md)", "",
      "1. Крючок: что видно и слышно в первую секунду и почему не пролистают? Для промо: что предлагают и почему сейчас — видно в первые 2–3 с?",
      "2. Кадр 0 не хуже лучшего кадра ролика? (review.png, второй ряд)",
      "3. Герой: на плитке телефона главное — первое, что видит глаз, и крупное? какая полоса кадра ничего не делает?",
      "4. Жизнь: каждые 2–3 с новое (крупность, предмет, свет, действие)? какой план повторяет уже показанный — и зачем? кульминация — самый плотный момент?",
      "5. Без звука: смысл понятен? самое важное слово — самое крупное?",
      "6. Финал: последний кадр сам говорит итог (что/когда/где, бренд или вывод) и служит тому, кто публикует (сохранить, прийти, отправить)? петля к кадру 0?",
      "7. Звук: музыка слышна между фразами (на 6–10 дБ ниже речи), атмосфера места, акценты в паузах?",
      "8. Правда: что ролик утверждает словом и картинкой (состав, количество, место, люди, результат, сезон)? Что не из брифа или противоречит ему/речи? Что зритель примет за настоящий товар/зал/сотрудника — и это настоящее? Так ли это выглядит и работает в жизни (глазами мастера этого дела)?",
      "9. Обещания концепта: каждое действие из concept.md (пишет, наливает, загорается, шлёпает) — на каком кадре видно и кто/что его делает? Материал и стиль, названные в concept.md (бумага, глина, фото), узнаются на плитке телефона? Звуки из «как звучит» — есть в sfx.json/подложке? Чего нет — сделать или «заменено на X, потому что…».",
      "10. Самое слабое место — какое? Одна правка именно его. Финальный кадр героя — посмотри одним still в полном размере (углы, швы, грани), не на листе.");
  }
  writeFileSync(join(outDir, "review.md"), md.join("\n") + "\n");
  // ---- короткая сводка в терминал (≤ 25 строк) ----
  const out: string[] = [];
  out.push(`review: ${verdict} — ${nF} FAIL, ${nW} WARN, ${nI} INFO — ${roundLabel} — ${((Date.now() - t0) / 1000).toFixed(0)} с`);
  const shown = issues.filter((x) => x.level !== "INFO" && x.source !== "lint");
  const short = (m: string) => { const cut = m.search(/ — |\. /); return (cut > 40 ? m.slice(0, cut) : m).slice(0, 130); };
  // Одинаковые сигналы (тот же вид и предмет) — одной строкой с числом мест.
  const groups = new Map<string, { i: Issue; n: number }>();
  for (const i of shown) { const k = `${i.level}|${i.kind}|${i.id ?? ""}`; const g = groups.get(k); if (g) g.n++; else groups.set(k, { i, n: 1 }); }
  const gl = [...groups.values()];
  for (const { i, n } of gl.slice(0, 9)) {
    const h = HINT[i.kind.replace(/\?$/, "")];
    out.push(`  ${i.level}${isRibbon(i.kind) && i.level === "WARN" ? "★" : ""} ${i.kind}${i.id ? ` «${i.id.slice(0, 30)}»` : ""}${i.frames ? ` [${i.frames[0]}–${i.frames[1]}]` : ""}${n > 1 ? ` (+ещё ${n - 1})` : ""}: ${short(i.msg)}${h ? ` → ${h}` : ""}`);
  }
  if (gl.length > 9) out.push(`  … ещё ${gl.length - 9} видов — в out/review/review.md`);
  const lint = issues.filter((x) => x.source === "lint" && x.level !== "INFO");
  if (lint.length) {
    const cnt = new Map<string, number>();
    for (const l of lint) cnt.set(l.kind, (cnt.get(l.kind) ?? 0) + 1);
    out.push(`  lint (подсказки по коду, ${lint.length}): ${[...cnt.entries()].map(([k, n]) => (n > 1 ? `${k}×${n}` : k)).join(", ")} — строки в review.md; приём можно оставить, если лента чистая`);
  }
  out.push(...nums.map((x) => `  ${x.slice(0, 220)}`));
  out.push(`смотреть (Read): ${looks.map((l) => rel(l.file)).join(" + ") || "—"}${extra.length ? `; ленты движения по FAIL — в review.md` : ""}`);
  const bl = budgetLine(dir);
  if (bl) out.push(bl);
  if (overRounds) out.push(`круги исчерпаны (${rounds.n}/${ROUND_LIMIT}): новый круг — только ради FAIL; косметические WARN → notes.md как принятые${ribbon.length ? `; ${ribbonRule}` : ""}; дальше studio render → probe → mixcheck`);
  else if (verdict !== "FAIL") out.push(`дальше: ${ribbon.length ? `сначала ★ ленточные WARN (${ribbon.join(", ")}) — от них зависит, досмотрят ли; затем ` : ""}1–2 WARN героя или финала; остальные — в notes.md с причиной`);
  console.log(out.join("\n"));
  if (a.strict && verdict === "FAIL") process.exit(1);
};

main().catch((e) => { console.error("ошибка: " + (e?.stack ?? e)); process.exit(1); });
