// Проверка готового ролика по пикселям (без модели, секунды): ловит «прыгает» и «уезжает».
//   studio probe out/final.mp4 [--cuts 0,120,240] [--json] [--strict] [--words public/words.json]
//   --cuts — кадры запланированных склеек (из плана): склейки не из списка = «прыжок».
//   --strict — код выхода 1, если есть проблемы уровня FAIL.
// Что меряет (кадр за кадром на уменьшенной копии):
//   • склейки (резкая смена кадра) и их частота; незапланированные склейки;
//   • быстрое движение: сдвиг всего кадра/крупного слоя быстрее 0.6 % ширины за кадр
//     (резкие пружины, панорамы-«вжухи»); тряска — смена направления чаще раза в секунду;
//   • блюр-переходы: провал резкости на несколько кадров (whip/blur-переход, motion blur);
//   • край кадра: предмет пересекает край и движется через него (картинка уезжает за
//     кадр); у фоновой картинки — пустая полоса у края (фон не покрывает кадр);
//   • чёрные кадры; громкость (−14 LUFS, true peak ≤ −1.5) и «дыры» в звуке;
//   • лента (WARN — исправить или объяснить в notes.md): застой — план почти не меняется
//     под речью (stale, stale-share), слабое открытие — кадр 0 пустой или первые 1.5 с ничего
//     не происходит (weak-hook), пустая треть кадра большую часть ролика (sparse), стоящий
//     финал (static-end); сколько лимита скорости реально использовано;
//   • отчёт страховки кадра рендера (<имя>.guard.json): вылеты из безопасной зоны,
//     фон не покрывает кадр, мелкие/неконтрастные подписи, слишком быстрая камера.
// Пишет <имя>.probe.json рядом с mp4. Каждая проблема — с кадрами: смотрите их глазами
// (studio sheet <mp4> --frames a-b).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { budgetLine, die, guardNoteFrames, type GuardHit, parseArgs, str } from "./_lib";

const a = parseArgs(process.argv.slice(2), ["json", "strict"]);
const file = a._[0] ? resolve(a._[0]) : die("нужен mp4: studio probe out/final.mp4");
if (!existsSync(file)) die(`нет файла ${file}`);
const planned = (str(a, "cuts") ?? "").split(",").map((s) => s.trim()).filter(Boolean).map(Number);

// ---------- параметры ----------
const LIM = {
  speedFrac: 0.006,      // 0.6 % ширины за кадр
  reverseSec: 1,
  cutsPerSec: 2,         // больше двух склеек в любой секунде — мельтешение
  blurDip: 0.55,         // резкость ниже 55 % от соседей
  black: 0.035,
  // Лента (сигналы «хорошо ли», а не «сломано»; WARN — исправить или объяснить в notes.md):
  staleChange: 0.15,     // за 2 с заметно изменилось меньше 15 % кадра — для глаза план «стоит»
                         // (частицы, «дыхание», наезд на 3–6 % и новая строка текста — ниже порога;
                         // новый план, крупный предмет, смена света, наезд к детали — выше)
  staleSpeechSec: 2.5,   // столько «стоит» под речью — зритель в ленте успевает уйти
  staleShare: 0.35,      // доля ролика, где кадр «стоит», — слайд-шоу
  openBusy: 0.06,        // первый кадр почти пустой (деталь меньше чем в 6 % блоков) — превью пустое
  sparseThird: 0.08,     // треть кадра без детали большую часть ролика — герой мелкий/пустая полоса
  audioHoleLu: 18,       // громкость момента ниже интегральной на 18 LU — «дыра» в звуке
  audioHoleSec: 0.8,
};

const info = JSON.parse(spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate,nb_frames:format=duration", "-of", "json", file]).stdout.toString());
const st = info.streams[0];
const W = st.width, H = st.height;
const [fn, fd] = st.r_frame_rate.split("/").map(Number);
const fps = fn / fd;
const AW = 270, AH = Math.round((AW * H) / W / 2) * 2;
const K = W / AW; // px кадра на px анализа

type F = { diff: number; sharp: number; luma: number; dx: number; dy: number; flat: boolean; occ: number[]; band: number[]; stripDiff: number[]; busy: number[] };
const frames: F[] = [];
// Миниатюры кадров (TW px по ширине) — для «новизны»: насколько кадр изменился за 2 с.
const TB = 5, TW = Math.floor(AW / TB), TH = Math.floor(AH / TB);
const thumbs: Float32Array[] = [];
// Доля миниатюры, изменившейся заметно (> 16 уровней яркости): частицы и медленный наезд
// трогают мало клеток, новый план/крупный предмет — много.
const changedShare = (p: Float32Array, q: Float32Array) => { let k = 0; for (let i = 0; i < p.length; i++) if (Math.abs(p[i] - q[i]) > 16) k++; return k / p.length; };

const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };

// Сдвиг профиля prev → cur (px анализа), субпиксельно; null — не определить.
const shift = (p: Float32Array, c: Float32Array, S: number): number | null => {
  const n = p.length;
  const mean = (v: Float32Array) => v.reduce((s, x) => s + x, 0) / v.length;
  const mp = mean(p), mc = mean(c);
  let sd = 0;
  for (let i = 0; i < n; i++) sd += Math.abs(c[i] - mc);
  if (sd / n < 1.5) return null; // нет текстуры — сдвиг не виден
  const cost: number[] = [];
  for (let s = -S; s <= S; s++) {
    let e = 0, k = 0;
    for (let i = Math.max(0, s); i < Math.min(n, n + s); i++) { e += Math.abs((c[i] - mc) - (p[i - s] - mp)); k++; }
    cost.push(k > n / 2 ? e / k : Infinity);
  }
  let bi = 0;
  for (let i = 1; i < cost.length; i++) if (cost[i] < cost[bi]) bi = i;
  // Сдвиг должен объяснять изменение: иначе это смена содержимого (слово, склейка), а не движение.
  if (bi !== S && cost[bi] > 0.6 * cost[S]) return null;
  let off = 0;
  if (bi > 0 && bi < cost.length - 1 && Number.isFinite(cost[bi - 1]) && Number.isFinite(cost[bi + 1])) {
    const d = cost[bi - 1] - 2 * cost[bi] + cost[bi + 1];
    if (d > 1e-6) off = (0.5 * (cost[bi - 1] - cost[bi + 1])) / d;
  }
  return bi - S + off;
};

let prevGray: Float32Array | null = null, prevCol: Float32Array | null = null, prevRow: Float32Array | null = null, prevRgb: Buffer | null = null;
const SX = Math.round(AW * 0.12), SY = Math.round(AH * 0.12);
const STRIP = 2; // px анализа у края

const analyze = (rgb: Buffer) => {
  const n = AW * AH;
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2];
  let diff = 0, luma = 0, sharp = 0, grad = 0;
  for (let i = 0; i < n; i++) { luma += g[i]; if (prevGray) diff += Math.abs(g[i] - prevGray[i]); }
  for (let y = 1; y < AH - 1; y++) for (let x = 1; x < AW - 1; x++) {
    const i = y * AW + x;
    sharp += Math.abs(4 * g[i] - g[i - 1] - g[i + 1] - g[i - AW] - g[i + AW]);
    grad += Math.abs(g[i + 1] - g[i - 1]) + Math.abs(g[i + AW] - g[i - AW]);
  }
  const col = new Float32Array(AW), row = new Float32Array(AH);
  for (let y = 0; y < AH; y++) for (let x = 0; x < AW; x++) { col[x] += g[y * AW + x] / AH; row[y] += g[y * AW + x] / AW; }
  const dx = prevCol ? shift(prevCol, col, SX) : 0;
  const dy = prevRow ? shift(prevRow, row, SY) : 0;
  // Фон: самый частый цвет (4 бита на канал).
  const hist = new Map<number, number>();
  for (let i = 0; i < n; i++) { const q = ((rgb[i * 3] >> 4) << 8) | ((rgb[i * 3 + 1] >> 4) << 4) | (rgb[i * 3 + 2] >> 4); hist.set(q, (hist.get(q) ?? 0) + 1); }
  let mq = 0, mc = 0;
  for (const [q, c] of hist) if (c > mc) { mc = c; mq = q; }
  const bg = [((mq >> 8) & 15) * 16 + 8, ((mq >> 4) & 15) * 16 + 8, (mq & 15) * 16 + 8];
  const flat = mc / n >= 0.25;
  const isBg = (i: number) => Math.abs(rgb[i * 3] - bg[0]) + Math.abs(rgb[i * 3 + 1] - bg[1]) + Math.abs(rgb[i * 3 + 2] - bg[2]) < 60;
  // Края: 0 — левый, 1 — правый, 2 — верх, 3 — низ.
  const edgeIdx = (e: number): number[] => {
    const out: number[] = [];
    if (e < 2) for (let y = 0; y < AH; y++) for (let s = 0; s < STRIP; s++) out.push(y * AW + (e === 0 ? s : AW - 1 - s));
    else for (let x = 0; x < AW; x++) for (let s = 0; s < STRIP; s++) out.push((e === 2 ? s : AH - 1 - s) * AW + x);
    return out;
  };
  const occ: number[] = [], stripDiff: number[] = [], band: number[] = [];
  for (let e = 0; e < 4; e++) {
    const idx = edgeIdx(e);
    occ.push(idx.filter((i) => !isBg(i)).length / idx.length);
    let sd = 0;
    if (prevRgb) for (const i of idx) sd += Math.abs(rgb[i * 3] - prevRgb[i * 3]) + Math.abs(rgb[i * 3 + 1] - prevRgb[i * 3 + 1]) + Math.abs(rgb[i * 3 + 2] - prevRgb[i * 3 + 2]);
    stripDiff.push(sd / idx.length / 3);
  }
  // Пустая полоса у края при фоновой картинке: подряд однотонные столбцы/строки у края,
  // а дальше — текстура. Ширина полосы в px кадра.
  if (!flat) {
    const lineStd = (vals: number[]) => { const m = vals.reduce((s, v) => s + v, 0) / vals.length; return Math.sqrt(vals.reduce((s, v) => s + (v - m) ** 2, 0) / vals.length); };
    const colStd = (x: number) => lineStd(Array.from({ length: AH }, (_, y) => g[y * AW + x]));
    const rowStd = (y: number) => lineStd(Array.from({ length: AW }, (_, x) => g[y * AW + x]));
    const lineAt = [(i: number) => colStd(i), (i: number) => colStd(AW - 1 - i), (i: number) => rowStd(i), (i: number) => rowStd(AH - 1 - i)];
    for (let e = 0; e < 4; e++) {
      const max = Math.round((e < 2 ? AW : AH) * 0.25);
      let w = 0;
      while (w < max && lineAt[e](w) < 1.0) w++;
      band.push(w > 0 && w < max && lineAt[e](Math.min(max, w + 2)) > 10 ? Math.round(w * K) : 0);
    }
  } else band.push(0, 0, 0, 0);
  // Миниатюра и «занятость»: доля блоков ~16 px кадра с деталью (std > 6) — по третям высоты.
  const th = new Float32Array(TW * TH);
  for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) {
    let sm = 0;
    for (let y = ty * TB; y < ty * TB + TB; y++) for (let x = tx * TB; x < tx * TB + TB; x++) sm += g[y * AW + x];
    th[ty * TW + tx] = sm / (TB * TB);
  }
  thumbs.push(th);
  const BS = 4, busyN = [0, 0, 0], busyD = [0, 0, 0];
  for (let by = 0; by + BS <= AH; by += BS) {
    const third = Math.min(2, Math.floor((by / AH) * 3));
    for (let bx = 0; bx + BS <= AW; bx += BS) {
      let m = 0, m2 = 0;
      for (let y = by; y < by + BS; y++) for (let x = bx; x < bx + BS; x++) { const v = g[y * AW + x]; m += v; m2 += v * v; }
      m /= BS * BS; m2 /= BS * BS;
      busyD[third]++;
      if (m2 - m * m > 36) busyN[third]++;
    }
  }
  const busy = busyN.map((v, k) => v / Math.max(1, busyD[k]));
  frames.push({ busy, diff: prevGray ? diff / n / 255 : 0, sharp: grad / n > 0.6 ? sharp / grad : NaN, luma: luma / n / 255, dx: (dx ?? 0) * K, dy: (dy ?? 0) * K, flat, occ, band, stripDiff });
  prevGray = g; prevCol = col; prevRow = row; prevRgb = rgb;
};

const decode = () => new Promise<void>((res, rej) => {
  const p = spawn("ffmpeg", ["-v", "error", "-i", file, "-vf", `scale=${AW}:${AH}:flags=area`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  const size = AW * AH * 3;
  let buf: Buffer = Buffer.alloc(0);
  p.stdout.on("data", (d: Buffer) => {
    buf = buf.length ? Buffer.concat([buf, d]) : d;
    while (buf.length >= size) { analyze(Buffer.from(buf.subarray(0, size))); buf = buf.subarray(size); }
  });
  p.on("close", (c) => (c === 0 ? res() : rej(new Error("ffmpeg decode " + c))));
});

type Issue = { level: "FAIL" | "WARN" | "INFO"; kind: string; frames: [number, number]; msg: string };
const issues: Issue[] = [];
const ranges = (flags: boolean[], minLen = 1, joinGap = 2): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  let s = -1;
  for (let i = 0; i <= flags.length; i++) {
    if (i < flags.length && flags[i]) { if (s < 0) s = i; }
    else if (s >= 0) {
      if (out.length && s - out[out.length - 1][1] <= joinGap) out[out.length - 1][1] = i - 1;
      else out.push([s, i - 1]);
      s = -1;
    }
  }
  return out.filter(([p, q]) => q - p + 1 >= minLen);
};
const EDGE = ["левый", "правый", "верхний", "нижний"];

// Отметки FrameAudit из рендера (<имя>.guard.json): на каких кадрах есть нарочный выход через
// край (data-bleed), игра персонажа (data-acting), 3D-мир во весь кадр (data-world) или
// картинка во весь кадр. На этих кадрах пиксельные догадки probe — INFO, а не FAIL.
const guardFile = file.replace(/\.[^.]+$/, ".guard.json");
const guardAll: GuardHit[] = existsSync(guardFile) ? (JSON.parse(readFileSync(guardFile, "utf8")).violations ?? []) : [];
const noteBleed = guardNoteFrames(guardAll, "bleed"), noteWorld = guardNoteFrames(guardAll, "world");
const noteActing = guardNoteFrames(guardAll, "acting"), noteCovered = guardNoteFrames(guardAll, "covered");
const noteFlash = guardNoteFrames(guardAll, "flash");
// Нарочный акцент на весь кадр (data-accent: засветка экрана, вспышка, флеш-кадр) — скачок
// яркости ±3 кадра от него не склейка: иначе директор боится удара и кульминация плоская.
const noteAccent = guardNoteFrames(guardAll, "accent");
const nearAccent = (i: number) => { for (let d = -3; d <= 3; d++) if (noteAccent.has(i + d)) return true; return false; };
const share = (set: Set<number>, p: number, q: number) => { let k = 0; for (let f = p; f <= q; f++) if (set.has(f)) k++; return k / Math.max(1, q - p + 1); };

const main = async () => {
  const t0 = Date.now();
  await decode();
  const N = frames.length;
  if (N < 2) die("слишком короткое видео");
  // ---- склейки ----
  const diffs = frames.map((f) => f.diff);
  const cut = frames.map((f, i) => {
    if (i === 0) return false;
    const win = diffs.slice(Math.max(1, i - 15), Math.min(N, i + 16)).filter((_, k, arr) => arr.length && true);
    return f.diff > 0.15 || f.diff > Math.max(0.07, 5 * median(win));
  });
  // Вспышка света (<Flash/> из kinetic-typography) — скачок яркости нарочно, а не склейка.
  const cutFrames = cut.flatMap((c, i) => (c && !noteFlash.has(i) && !noteFlash.has(i - 1) && !nearAccent(i) ? [i] : []));
  const near = (f: number, list: number[], tol = 1) => list.some((c) => Math.abs(c - f) <= tol);
  for (const c of cutFrames) {
    if (planned.length && !near(c, planned)) issues.push({ level: "FAIL", kind: "unplanned-cut", frames: [c, c], msg: `резкая смена кадра не по плану (Δ ${(frames[c].diff * 100).toFixed(0)} %)` });
  }
  for (let i = 0; i < N; i++) {
    const inSec = cutFrames.filter((c) => c >= i && c < i + fps).length;
    if (inSec > LIM.cutsPerSec) { issues.push({ level: "FAIL", kind: "cut-rate", frames: [i, Math.min(N - 1, i + Math.round(fps))], msg: `${inSec} склеек за секунду — мельтешит` }); i += Math.round(fps); }
  }
  const nearCut = (i: number) => near(i, cutFrames, 1);
  // ---- быстрое движение ----
  const maxV = LIM.speedFrac * W;
  const speed = frames.map((f, i) => (nearCut(i) ? 0 : Math.hypot(f.dx, f.dy)));
  for (const [p, q] of ranges(speed.map((v) => v > maxV), 2)) {
    const top = Math.max(...speed.slice(p, q + 1));
    issues.push({ level: top > 3 * maxV ? "FAIL" : "WARN", kind: "fast-motion", frames: [p, q], msg: `кадр едет до ${(top / W * 100).toFixed(2)} % ширины за кадр (лимит ${(LIM.speedFrac * 100).toFixed(1)} %)` });
  }
  // ---- тряска: смена направления по x или y чаще раза в секунду ----
  const minMove = 0.0015 * W;
  for (const axis of ["dx", "dy"] as const) {
    let last: { i: number; s: number } | null = null;
    const hits: number[] = [];
    frames.forEach((f, i) => {
      if (nearCut(i) || Math.abs(f[axis]) < minMove) return;
      const s = Math.sign(f[axis]);
      if (last && s !== last.s && i - last.i < LIM.reverseSec * fps) hits.push(i);
      last = { i, s };
    });
    for (const [p, q] of ranges(frames.map((_, i) => hits.includes(i)), 1, Math.round(fps))) {
      // Нарочная дрожь/покачивание персонажа (data-acting) — игра, а не тряска кадра.
      if (share(noteActing, p, q) > 0.6) { issues.push({ level: "INFO", kind: "shake?", frames: [p, q], msg: `смена направления чаще раза в секунду, но на этих кадрах есть слой data-acting (игра персонажа: дрожь, покачивание) — проверь ленту: кадр стоит, двигается персонаж` }); continue; }
      issues.push({ level: q - p > fps ? "FAIL" : "WARN", kind: "shake", frames: [p, q], msg: `движение меняет направление (${axis === "dx" ? "по горизонтали" : "по вертикали"}) чаще раза в секунду — дрожит/дёргается. Если это нарочная игра персонажа — пометь слой data-acting` });
    }
  }
  // ---- блюр-переходы ----
  const sharp = frames.map((f) => f.sharp);
  const dip = frames.map((f, i) => {
    const win = sharp.slice(Math.max(0, i - 20), Math.min(N, i + 21));
    return f.luma > LIM.black && Number.isFinite(f.sharp) && f.sharp < LIM.blurDip * median(win.filter(Number.isFinite));
  });
  for (const [p, q] of ranges(dip, 2)) {
    if (q - p > 20) continue; // долгая мягкость — стиль, не переход
    // Провал = резкость была до и вернулась после (а не плавно ушла вместе с содержимым).
    const fin = (xs: number[]) => xs.filter(Number.isFinite);
    const low = Math.min(...fin(sharp.slice(p, q + 1)));
    const before = Math.max(0, ...fin(sharp.slice(Math.max(0, p - 8), p)));
    const after = Math.max(0, ...fin(sharp.slice(q + 1, Math.min(N, q + 9))));
    if (before * LIM.blurDip < low || after * LIM.blurDip < low) continue;
    const moved = Math.max(...speed.slice(Math.max(0, p - 2), Math.min(N, q + 3)), ...frames.slice(p, q + 1).map((f) => Math.hypot(f.dx, f.dy)));
    issues.push({ level: "FAIL", kind: "blur-transition", frames: [p, q], msg: `кадр размывается на ${q - p + 1} кадров${moved > maxV ? " с рывком движения (whip/blur)" : ""} — читается как «прыжок»` });
  }
  // ---- край кадра ----
  for (let e = 0; e < 4; e++) {
    const crossing = frames.map((f, i) => f.flat && f.occ[e] > 0.03 && f.stripDiff[e] > 0.8 && !nearCut(i));
    for (const [p, q] of ranges(crossing, Math.round(fps * 0.3), 3)) {
      const occMax = Math.max(...frames.slice(p, q + 1).map((f) => f.occ[e]));
      // Смена света на весь кадр: меняются все четыре края разом — это не предмет у края.
      const global = frames.slice(p, q + 1).filter((f) => f.stripDiff.every((d) => d > 0.5)).length / (q - p + 1) > 0.6;
      const why = global ? "меняются все четыре края разом — смена света/цвета на весь кадр" : share(noteWorld, p, q) > 0.6 ? "в кадре 3D-мир во весь кадр (data-world): край режет мир, а не предмет" : share(noteBleed, p, q) > 0.6 ? "в кадре слой data-bleed (нарочный выход/вход)" : "";
      if (why) { issues.push({ level: "INFO", kind: "edge-crossing?", frames: [p, q], msg: `${EDGE[e]} край меняется, но ${why} — не вылет; лента глазами, если сомнение` }); continue; }
      issues.push({ level: "FAIL", kind: "edge-crossing", frames: [p, q], msg: `${EDGE[e]} край: предмет движется через край кадра (закрыто до ${(occMax * 100).toFixed(0)} % края) — уезжает/обрезан. Нарочно — data-bleed на слое; 3D-мир за краем — data-world на холсте` });
    }
    const band = frames.map((f, i) => f.band[e] >= W * 0.008 && !nearCut(i));
    for (const [p, q] of ranges(band, 2)) {
      const wpx = Math.max(...frames.slice(p, q + 1).map((f) => f.band[e]));
      if (share(noteCovered, p, q) > 0.9 || share(noteWorld, p, q) > 0.9) { issues.push({ level: "INFO", kind: "cover-gap?", frames: [p, q], msg: `${EDGE[e]} край: однотонная полоса ~${wpx} px, но по DOM картинка/холст покрывает кадр целиком — это ровная область самой картинки (небо, стена)` }); continue; }
      issues.push({ level: "FAIL", kind: "cover-gap", frames: [p, q], msg: `${EDGE[e]} край: пустая полоса ~${wpx} px — фоновая картинка не покрывает кадр (CoverImage/coverRect)` });
    }
  }
  // ---- чёрные кадры ----
  for (const [p, q] of ranges(frames.map((f) => f.luma < LIM.black), Math.round(fps * 0.2))) {
    if (p === 0 && q < fps * 0.5) continue;
    issues.push({ level: "WARN", kind: "black", frames: [p, q], msg: `чёрные кадры ${((q - p + 1) / fps).toFixed(2)} с` });
  }
  // ---- статичные куски (информация) ----
  for (const [p, q] of ranges(diffs.map((d) => d < 0.0008), Math.round(fps * 3), 0)) {
    issues.push({ level: "INFO", kind: "static", frames: [p, q], msg: `кадр стоит ${((q - p + 1) / fps).toFixed(1)} с` });
  }
  // ---- лента: открытие, застой, пустые трети, конец ----
  // Речь (если ролик лежит в папке ролика): public/words.json рядом с out/.
  const wordsFile = str(a, "words") ?? [1, 2, 3].map((up) => resolve(file, ...Array(up).fill(".."), "public", "words.json")).find((w, k) => existsSync(w) && existsSync(resolve(file, ...Array(k + 1).fill(".."), "job.json"))) ?? "";
  let speech: Array<[number, number]> = [];
  if (existsSync(wordsFile)) {
    try {
      const ws: Array<{ start: number; end: number }> = JSON.parse(readFileSync(wordsFile, "utf8")).words ?? [];
      for (const w of ws) { const l = speech[speech.length - 1]; const s0 = Math.round(w.start * fps), e0 = Math.round(w.end * fps); if (l && s0 - l[1] <= fps * 0.45) l[1] = Math.max(l[1], e0); else speech.push([s0, e0]); }
    } catch { speech = []; }
  }
  const lag = Math.max(1, Math.round(fps * 2));
  // Новизна: какая доля кадра заметно изменилась за 2 с (склейка рядом — новизна по определению).
  const nov = thumbs.map((t, i) => (i < lag ? NaN : changedShare(t, thumbs[i - lag])));
  // Застой: подряд идущие кадры i, у которых кадр i ≈ кадр i−2 с; кусок [начало−2 с; конец].
  // Любое заметное изменение (или склейка) рвёт кусок.
  const staleFlag = new Array(N).fill(false);
  const staleRuns: Array<[number, number]> = [];
  let runStart = -1;
  for (let i = lag; i <= N; i++) {
    const low = i < N && nov[i] < LIM.staleChange && !cutFrames.some((c) => c > i - lag && c <= i);
    if (low && runStart < 0) runStart = i;
    if (!low && runStart >= 0) {
      const p0 = runStart - lag, q0 = i - 1;
      if (q0 - p0 + 1 >= Math.round(fps * 3)) { staleRuns.push([p0, q0]); for (let k = p0; k <= q0; k++) staleFlag[k] = true; }
      runStart = -1;
    }
  }
  const staleFrames = staleFlag.filter(Boolean).length;
  const longestStale = staleRuns.reduce((m, [p, q]) => Math.max(m, q - p + 1), 0);
  const overlapSpeech = (p: number, q: number) => speech.reduce((s0, [x, y]) => s0 + Math.max(0, Math.min(q, y) - Math.max(p, x) + 1), 0);
  for (const [p, q] of staleRuns) {
    const sp = overlapSpeech(p, q);
    if (speech.length && sp >= LIM.staleSpeechSec * fps) issues.push({ level: "WARN", kind: "stale", frames: [p, q], msg: `кадр почти не меняется ${((q - p + 1) / fps).toFixed(1)} с, из них ${(sp / fps).toFixed(1)} с идёт речь — для ленты это «слайд»: смена плана/масштаба, новый предмет, наезд к детали — или причина в notes.md` });
  }
  if (staleFrames / N > LIM.staleShare) issues.push({ level: "WARN", kind: "stale-share", frames: [0, N - 1], msg: `кадр «стоит» ${Math.round((staleFrames / N) * 100)} % ролика (самый длинный кусок ${(longestStale / fps).toFixed(1)} с). Спокойно ≠ неподвижно: что обновляет внимание каждые несколько секунд?` });
  // Открытие: первый кадр — это превью в ленте; за первые 1.5 с что-то должно произойти.
  const f15 = Math.min(N - 1, Math.round(fps * 1.5));
  const busyAll = (f: F) => (f.busy[0] + f.busy[1] + f.busy[2]) / 3;
  const openChange = changedShare(thumbs[f15], thumbs[0]);
  const medNov = median(nov.filter(Number.isFinite));
  const open = { busy0: +busyAll(frames[0]).toFixed(3), busy1s: +busyAll(frames[Math.min(N - 1, Math.round(fps))]).toFixed(3), change1_5s: +openChange.toFixed(4), medianChange2s: +medNov.toFixed(3), firstVoiceSec: speech.length ? +(speech[0][0] / fps).toFixed(2) : null };
  if (busyAll(frames[0]) < LIM.openBusy || busyAll(frames[0]) < 0.5 * open.busy1s) issues.push({ level: "WARN", kind: "weak-hook", frames: [0, f15], msg: `первый кадр почти пустой (деталь ${Math.round(open.busy0 * 100)} % против ${Math.round(open.busy1s * 100)} % через 1 с) — превью в ленте пустое; кадр 0 должен быть готовой картинкой с героем или обещанием` });
  else if (openChange < LIM.staleChange && cutFrames.every((c) => c > f15)) issues.push({ level: "WARN", kind: "weak-hook", frames: [0, f15], msg: `за первые 1.5 с заметно изменилось ${Math.round(openChange * 100)} % кадра — что остановит палец в ленте?` });
  // Первые 10 с — самое дорогое время в ленте: сколько раз обновился кадр и самый длинный
  // кусок, где ничего заметного не произошло (новизна за 1 с ниже порога).
  const lag1 = Math.max(1, Math.round(fps));
  const end10 = Math.min(N, Math.round(fps * 10));
  let longest10 = 0, run10 = 0, events10 = 0, wasLow = false;
  for (let i = lag1; i < end10; i++) {
    const low = changedShare(thumbs[i], thumbs[i - lag1]) < LIM.staleChange * 0.6 && !nearCut(i);
    run10 = low ? run10 + 1 : 0;
    if (!low && wasLow) events10++;
    wasLow = low;
    longest10 = Math.max(longest10, run10 ? run10 + lag1 : 0);
  }
  const cuts10 = cutFrames.filter((c) => c < end10).length;
  const open10 = { cuts: cuts10, events: cuts10 + events10, longestStillSec: +(longest10 / fps).toFixed(1) };
  if (N > fps * 6 && longest10 / fps >= 2.5) issues.push({ level: "WARN", kind: "slow-open", frames: [0, end10 - 1], msg: `в первые 10 с есть кусок ${(longest10 / fps).toFixed(1)} с без заметной перемены (порог для начала — 2.5 с; дальше по ролику — 3 с): здесь лента теряет больше всего зрителей. Самое сильное событие крючка — до 1.5 с, титульная карточка — не дольше 2 с` });
  if (open.firstVoiceSec !== null && open.firstVoiceSec > 1.0) issues.push({ level: "INFO", kind: "late-voice", frames: [0, speech[0][0]], msg: `первое слово на ${open.firstVoiceSec} с — для ленты поздно, если кадр не держит сам` });
  // Пустые трети: треть кадра без детали большую часть ролика.
  const thirdShare = [0, 1, 2].map((k) => frames.filter((f) => f.busy[k] < LIM.sparseThird).length / N);
  const busyThirds = [0, 1, 2].map((k) => +(frames.reduce((s0, f) => s0 + f.busy[k], 0) / N).toFixed(3));
  const TH3 = ["верхняя", "средняя", "нижняя"];
  thirdShare.forEach((sh, k) => { if (sh > 0.5) issues.push({ level: "WARN", kind: "sparse", frames: [0, N - 1], msg: `${TH3[k]} треть кадра пустая ${Math.round(sh * 100)} % ролика (деталь в среднем ${Math.round(busyThirds[k] * 100)} %) — на телефоне герой мелкий или полоса ничего не делает; перекомпонуйте (крупнее план, ниже горизонт, камера), а не украшайте полосу` }); });
  // Конец: последние 1.5 с.
  const endFrom = Math.max(0, N - Math.round(fps * 1.5));
  const endStatic = endFrom >= lag && nov.slice(endFrom).every((v) => v < LIM.staleChange * 0.5);
  if (endStatic) issues.push({ level: "INFO", kind: "static-end", frames: [endFrom, N - 1], msg: "последние 1.5 с кадр стоит — последний кадр несёт итог (что/когда/где, бренд) или петлю к кадру 0?" });
  // ---- звук ----
  let audio: { I: number; TP: number } | null = null;
  const has = spawnSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file]).stdout.toString().trim();
  if (has) {
    const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"]).stderr.toString();
    const I = Number(r.match(/I:\s+(-?[\d.]+|-inf) LUFS/g)?.pop()?.match(/-?[\d.]+/)?.[0]);
    const TP = Number(r.match(/Peak:\s+(-?[\d.]+|-inf)/g)?.pop()?.match(/-?[\d.]+/)?.[0]);
    audio = { I, TP };
    // Громкость момента (окно 400 мс, шаг 100 мс): «дыры» в звуке — подложки нет, между фразами тишина.
    const M = [...r.matchAll(/t:\s*([\d.]+)\s+TARGET:[^M]*M:\s*(-?[\d.]+)/g)].map((m) => ({ t: Number(m[1]), m: Number(m[2]) }));
    if (Number.isFinite(I) && I > -60 && M.length) {
      const startT = M.find((x) => x.m > I - 10)?.t ?? 0;
      const holes = ranges(M.map((x) => x.t > startT + 0.4 && x.m < I - LIM.audioHoleLu), Math.round(LIM.audioHoleSec / 0.1), 1);
      for (const [p, q] of holes) {
        const lo = Math.min(...M.slice(p, q + 1).map((x) => x.m));
        const atEnd = q >= M.length - 2;
        issues.push({ level: "WARN", kind: atEnd ? "audio-fade-end" : "audio-hole", frames: [Math.round((M[p].t - 0.4) * fps), Math.min(N - 1, Math.round(M[q].t * fps))], msg: `${atEnd ? "звук затухает в конце" : "дыра в звуке"} ${(M[q].t - M[p].t + 0.1).toFixed(1)} с: до ${lo} LUFS при ${I} в среднем — ${atEnd ? "финал звучит пусто: держите подложку/акцент до последнего кадра или петлю" : "между фразами пусто: подложка/атмосфера места или звук события в паузе"}` });
      }
    }
    if (Number.isFinite(I) && I > -60) {
      if (Math.abs(I + 14) > 1.5) issues.push({ level: "WARN", kind: "loudness", frames: [0, N - 1], msg: `громкость ${I} LUFS (цель −14 ±1)` });
      if (TP > -1) issues.push({ level: "WARN", kind: "true-peak", frames: [0, N - 1], msg: `пик ${TP} dBFS (не выше −1.5)` });
    }
  }
  // ---- страховка кадра из рендера ----
  const gf = guardFile;
  if (existsSync(gf)) {
    for (const g of guardAll) {
      if (g.kind.startsWith("note:") || g.kind === "text-tight") continue;
      const lvl = g.kind.startsWith("caption") || g.kind === "cover-gap" || g.kind === "outside-safe" || g.kind === "motion-too-fast" ? "FAIL" : "WARN";
      issues.push({ level: lvl, kind: `guard:${g.kind}`, frames: [g.frames[0], g.frames[g.frames.length - 1]], msg: `${g.id}: ${g.frames.length} кадров, худшее ${g.worst} — ${JSON.stringify(g.detail)}` });
    }
  }
  issues.sort((p, q) => p.frames[0] - q.frames[0]);
  const fails = issues.filter((i) => i.level === "FAIL").length, warns = issues.filter((i) => i.level === "WARN").length;
  const verdict = fails ? "FAIL" : warns ? "WARN" : "PASS";
  const stats = {
    file, width: W, height: H, fps, frames: N, seconds: +(N / fps).toFixed(2),
    cuts: cutFrames, cutsPerMin: +((cutFrames.length / (N / fps)) * 60).toFixed(1),
    maxSpeedPctPerFrame: +((Math.max(...speed) / W) * 100).toFixed(3),
    speedBudgetUsedPct: Math.round((Math.max(...speed) / maxV) * 100),
    staleShare: +(staleFrames / N).toFixed(3), longestStaleSec: +(longestStale / fps).toFixed(1),
    open, open10, busyThirds, emptyThirdShare: thirdShare.map((v) => +v.toFixed(2)), endStatic,
    medianSpeedPctPerFrame: +((median(speed.filter((v) => v > 0)) / W) * 100).toFixed(3),
    audio, guardFile: existsSync(gf) ? gf : null, verdict, fails, warns,
  };
  // diffs — изменение кадра к предыдущему (0…1) на каждом кадре: по нему самопроверка меряет
  // энергию входа в каждый бит (кульминация плотнее остальных?).
  const report = { ...stats, issues, diffs: diffs.map((d) => +d.toFixed(4)), ...(process.env.PROBE_DEBUG ? { series: frames.map((f, i) => ({ nov: +(nov[i] || 0).toFixed(4), busy: f.busy.map((b) => +b.toFixed(3)), d: +f.diff.toFixed(4), s: +f.sharp.toFixed(2), dx: +f.dx.toFixed(1), dy: +f.dy.toFixed(1), occ: f.occ.map((o) => +o.toFixed(3)), band: f.band })) } : {}) };
  writeFileSync(file.replace(/\.[^.]+$/, ".probe.json"), JSON.stringify(report, null, 1));
  if (a.json) { console.log(JSON.stringify(report, null, 1)); }
  else {
    console.log(`${verdict}: ${fails} FAIL, ${warns} WARN — ${N} кадров, ${stats.seconds} с, ${W}×${H}@${fps}`);
    console.log(`склейки: ${cutFrames.length} (${stats.cutsPerMin}/мин) ${cutFrames.slice(0, 30).join(",")}${cutFrames.length > 30 ? "…" : ""}`);
    console.log(`скорость кадра: макс ${stats.maxSpeedPctPerFrame} %W/кадр (${stats.speedBudgetUsedPct} % лимита 0.6), медиана движения ${stats.medianSpeedPctPerFrame} %W/кадр`);
    console.log(`лента: кадр «стоит» ${Math.round(stats.staleShare * 100)} % ролика (дольше всего ${stats.longestStaleSec} с); первый кадр — деталь ${Math.round(open.busy0 * 100)} %, за 1.5 с изменилось ${Math.round(open.change1_5s * 100)} %; деталь по третям ${busyThirds.map((v) => Math.round(v * 100) + " %").join(" / ")}`);
    if (audio) console.log(Number.isFinite(audio.I) && audio.I > -60 ? `звук: ${audio.I} LUFS, пик ${audio.TP} dBFS` : "звук: тишина");
    if (!existsSync(gf)) console.log("отчёта страховки рендера нет (рендер не через studio render?)");
    for (const i of issues) console.log(`  ${i.level} ${i.kind} [${i.frames[0]}–${i.frames[1]}] ${i.msg}`);
    const jd = [1, 2].map((up) => resolve(file, ...Array(up).fill(".."))).find((d) => existsSync(resolve(d, "job.json")));
    const bl = jd ? budgetLine(jd) : null;
    if (bl) console.log(bl);
  }
  console.error(`probe: ${((Date.now() - t0) / 1000).toFixed(1)} с`);
  if (a.strict && fails) process.exit(1);
};
main().catch((e) => { console.error("ошибка: " + (e?.stack ?? e)); process.exit(1); });
