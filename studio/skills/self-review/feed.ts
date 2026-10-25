// Самопроверка «для ленты»: не «сломано ли», а «остановит ли палец и прочтётся ли на телефоне».
// Всё меряется по трекам <FrameAudit/> (коробки элементов на каждом кадре) и по пикселям
// черновика. Сигналы — WARN/INFO с числами: директор либо правит, либо пишет причину в
// notes.md. Пороги — сигнальные (почему — рядом с каждым), а не творческие правила.
//   • hero-*      — главный предмет (data-hero): доля безопасной зоны, первое появление
//                   (без пометки — крупнейший предмет, кроме фона, текста и data-bleed);
//   • empty-open  — кадр 0 (превью в ленте) пустой: только фон, всё ещё «проявляется»;
//   • dead-band   — горизонтальная полоса безопасной зоны без единого предмета большую часть ролика;
//   • near-empty  — почти пустые кадры (кроме фона) дольше 0.4 с;
//   • muted       — речь идёт, а на экране нет текста (в ленте смотрят без звука);
//   • text-collide — текст наезжает на другой текст;
//   • contrast-px — контраст текста по ПИКСЕЛЯМ готового кадра (заявленный фон не всегда правда);
//   • acting      — сводка по слоям data-acting (их скорость не считается «прыгает кадр»);
//   • text-on-hero — текст лежит на герое (3D-предмет наехал на заголовок), нарочно — data-over-hero;
//   • hero-cut    — герой (не во весь кадр) срезан краем кадра, даже внутри data-world;
//   • brand-small — имя бренда (data-role="brand") в последние 2 с мельче 4 % высоты.
//   • hero-small-beat / hero-small-payoff — размер героя ПО БИТАМ (25-й перцентиль, кадры без
//                   героя = 0), по нарисованным пикселям слоя data-hero (review рендерит его
//                   отдельно), а не по коробке: нитка ценника, поля viewBox и пустая обёртка-замер
//                   не раздувают героя; data-hero на тексте — не герой (INFO hero-text);
//   • hero-under-ui — центр героя в нижних 20 % (подпись ролика и кнопки ленты закрывают его);
//   • payoff-*    — контракт развязки (kind payoff): крупнее прошлого бита, текст читается
//                   (по пикселям) ≥ 1 с / ≥ 1.5 с для факта, нет стоп-кадра посреди жеста;
//   • end-hold    — финальная картинка стоит дольше 4 с / четверти ролика без нового события;
//   • layout-template — все биты собраны одинаково (заголовок сверху, предмет по центру);
//   • timid-motion — ни одного заметного движения в большинстве битов (скорость < 40 % потолка).
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { contrast, parseCss } from "../../lib/paper-kit/kit/color";
import { defaultMargins } from "../../lib/layout";

export type FItem = { k: string; t: string; x: number; y: number; w: number; h: number; o: number; fs?: number; c?: 1; r?: "hero"; a?: 1; b?: 1; wd?: 1; col?: string; sh?: 1; tx?: string; ro?: string; oh?: 1; px?: 1 };
export type FTrack = { f: number; W: number; H: number; S?: [number, number, number, number]; items: FItem[] };
export type FIssue = { level: "FAIL" | "WARN" | "INFO"; source: "feed"; kind: string; frames?: [number, number]; id?: string; msg: string };

const LIM = {
  heroShare: 0.35,    // медиана по ролику (кадры без героя = 0): CLAUDE.md «большая часть безопасной зоны»
  heroBeat: 0.25,     // 25-й перцентиль бита: четверть зоны — на 6-дюймовом экране «наклейка»
  heroPayoff: 0.3,    // развязка и финал: главный предмет — не меньше трети зоны
  payoffGrow: 1.4,    // развязка крупнее прошлого бита (или удар типографикой во весь кадр)
  heroLateSec: 1.0,   // герой/предмет обещания позже 1 с — в ленте решение «листать» уже принято
  deadBand: 0.3,      // пустая полоса ≥ 30 % высоты безопасной зоны…
  deadShare: 0.5,     // …больше половины ролика
  nearEmpty: 0.05,    // предметы занимают < 5 % безопасной зоны
  muted: 0.8,         // текст на экране меньше 80 % времени речи — без звука смысл теряется
  contrastBig: 3.0,   // крупный текст (≥ 3.5 % высоты): WCAG для крупного — 3:1
  contrastSmall: 4.5,
};

const area = (b: { w: number; h: number }) => Math.max(0, b.w) * Math.max(0, b.h);
const inter = (a: FItem, b: FItem) => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  return x2 > x && y2 > y ? (x2 - x) * (y2 - y) : 0;
};
const median = (xs: number[]) => { if (!xs.length) return NaN; const s = [...xs].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };
const runs = (fl: number[], gap = 1): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (const f of [...new Set(fl)].sort((p, q) => p - q)) { if (out.length && f - out[out.length - 1][1] <= gap) out[out.length - 1][1] = f; else out.push([f, f]); }
  return out;
};
const root = (k: string) => k.split(/[:#>]/)[0];
// Безопасная зона, если трек её не принёс, — тот же источник, что у Stage (FEED_UI в layout.ts).
const safeOf = (W: number, H: number): [number, number, number, number] => { const m = defaultMargins(W, H); return [m.left, m.top, W - m.left - m.right, H - m.top - m.bottom]; };
// Коробка героя на кадре: объединение его не-текстовых элементов (data-hero).
const heroBox = (t: FTrack) => {
  const hs = heroItems(t).items;
  if (!hs.length) return null;
  const x = Math.min(...hs.map((h) => h.x)), y = Math.min(...hs.map((h) => h.y));
  return { k: "hero", t: "box", o: 1, x, y, w: Math.max(...hs.map((h) => h.x + h.w)) - x, h: Math.max(...hs.map((h) => h.y + h.h)) - y, bleed: hs.some((h) => h.b) };
};

// Элементы героя на кадре: не текст и не обёртка, внутри которой только надпись (data-hero на
// «7–12» или на штампе — это текст, а не предмет). Пустая обёртка-замер 3D (px) — герой.
export const heroItems = (t: FTrack): { items: FItem[]; textOnly: boolean } => {
  const hs = t.items.filter((it) => it.r === "hero" && it.o >= 0.5);
  if (!hs.length) return { items: [], textOnly: false };
  const txt = hs.filter((it) => it.t === "text");
  const things = hs.filter((it) => it.t !== "text" && !(it.t === "box" && !it.px && txt.some((x) => inter(x, it) > 0.25 * area(it)) && !hs.some((y) => y !== it && y.t !== "text" && y.t !== "box" && inter(y, it) > 0.5 * area(y))));
  return { items: things, textOnly: !things.length && txt.length > 0 };
};
export type Ink = { f: number; x: number; y: number; w: number; h: number; share: number };

export type FeedMetrics = {
  hero: { marked: boolean; firstSec: number | null; medianShare: number | null; minShare: number | null; visibleShare: number };
  open: { items: number; textOrHero: boolean };
  deadBand: { medianFrac: number; where: string };
  coverage: { median: number };
  muted: { speechSec: number; textShare: number } | null;
  contrast: Array<{ id: string; f: number; measured: number }>;
};

export const analyzeFeed = (tracks: FTrack[], fps: number, cuts: number[], wordsFile: string | null, ink?: Map<number, Ink>): { issues: FIssue[]; m: FeedMetrics } => {
  const issues: FIssue[] = [];
  const m: FeedMetrics = { hero: { marked: false, firstSec: null, medianShare: null, minShare: null, visibleShare: 0 }, open: { items: 0, textOrHero: false }, deadBand: { medianFrac: 0, where: "" }, coverage: { median: 0 }, muted: null, contrast: [] };
  if (!tracks.length) return { issues, m };
  const W = tracks[0].W, H = tracks[0].H;
  const S = tracks[0].S ?? safeOf(W, H);
  const safeA = S[2] * S[3];
  const isBg = (it: FItem) => it.t !== "text" && it.r !== "hero" && it.w >= W * 0.98; // фон и полосы во всю ширину (земля, небо, море)
  const nearCut = (f: number) => cuts.some((c) => Math.abs(c - f) <= 2);
  const clipSafe = (it: FItem) => {
    const x = Math.max(it.x, S[0]), y = Math.max(it.y, S[1]);
    const x2 = Math.min(it.x + it.w, S[0] + S[2]), y2 = Math.min(it.y + it.h, S[1] + S[3]);
    return x2 > x && y2 > y ? { x, y, w: x2 - x, h: y2 - y } : null;
  };

  // ---- герой ----
  m.hero.marked = tracks.some((t) => t.items.some((it) => it.r === "hero"));
  const heroShares: number[] = [];
  let first: number | null = null, visible = 0;
  for (const t of tracks) {
    let hs = heroItems(t).items;
    if (!m.hero.marked) {
      const cand = t.items.filter((it) => it.o >= 0.5 && !it.b && it.t !== "text" && it.t !== "box" && !isBg(it) && !(it.w >= W * 0.98 && it.h >= H * 0.98));
      hs = cand.length ? [cand.reduce((p, q) => (area(q) > area(p) ? q : p))] : [];
    }
    const ik = heroItems(t).textOnly ? undefined : ink?.get(t.f); // надпись с data-hero — не предмет
    if (!hs.length && !ik) { if (m.hero.marked) heroShares.push(0); continue; } // кадр без героя — ноль, а не «не в счёт»
    const x = ik ? ik.x : Math.min(...hs.map((h) => h.x)), y = ik ? ik.y : Math.min(...hs.map((h) => h.y));
    const x2 = ik ? ik.x + ik.w : Math.max(...hs.map((h) => h.x + h.w)), y2 = ik ? ik.y + ik.h : Math.max(...hs.map((h) => h.y + h.h));
    const c = clipSafe({ k: "", t: "", o: 1, x, y, w: x2 - x, h: y2 - y });
    const share = c ? area(c) / safeA : 0;
    heroShares.push(share);
    visible++;
    if (first === null) first = t.f;
  }
  m.hero.visibleShare = +(visible / tracks.length).toFixed(2);
  if (heroShares.length) {
    m.hero.firstSec = first === null ? null : +(first / fps).toFixed(2);
    m.hero.medianShare = +median(heroShares).toFixed(3);
    m.hero.minShare = +Math.min(...heroShares).toFixed(3);
    const what = m.hero.marked ? "герой (data-hero)" : "крупнейший предмет (герой не помечен data-hero — это догадка)";
    if (m.hero.medianShare < LIM.heroShare) issues.push({ level: "WARN", source: "feed", kind: "hero-small", msg: `${what} занимает в среднем ${Math.round(m.hero.medianShare * 100)} % безопасной зоны (мин. ${Math.round(m.hero.minShare * 100)} %; кадры без героя — 0) — на телефоне в ленте это «наклейка». Сначала кадрирование, а не уменьшение: крупнее план, обрезать в деталь (голова и руки), герой уходит за край (data-bleed), текст в его свободном месте (data-over-hero) — или причина в notes.md` });
    if (first !== null && first / fps > LIM.heroLateSec) issues.push({ level: "WARN", source: "feed", kind: "hero-late", frames: [0, first], msg: `${what} впервые в кадре на ${(first / fps).toFixed(1)} с — первая секунда решает, листать ли дальше; покажите предмет/обещание сразу, заголовок может прийти позже` });
  }
  if (!m.hero.marked) issues.push({ level: "INFO", source: "feed", kind: "hero-unmarked", msg: "пометьте главный предмет data-hero (на обёртке) — самопроверка померит его размер и первое появление точно, а не по догадке" });

  // ---- кадр 0 ----
  const t0 = tracks[0];
  const open = t0.items.filter((it) => it.o >= 0.5 && !it.b && !isBg(it) && !(it.w >= W * 0.98 && it.h >= H * 0.98));
  m.open = { items: open.length, textOrHero: open.some((it) => it.t === "text" || it.r === "hero") };
  if (t0.f === 0 && !open.length) issues.push({ level: "WARN", source: "feed", kind: "empty-open", frames: [0, 0], msg: "кадр 0 — только фон: всё ещё проявляется или не пришло. Кадр 0 — это превью в ленте и первое впечатление; он должен быть готовой картинкой (герой или обещание), без проявления из пустоты" });

  // ---- занятость безопасной зоны: пустые полосы и почти пустые кадры ----
  const COLS = 8, ROWS = 16;
  const bands: number[] = [], covs: number[] = [], bandWhere: string[] = [];
  const emptyFrames: number[] = [];
  for (const t of tracks) {
    const grid = new Uint8Array(COLS * ROWS);
    for (const it of t.items) {
      // 3D-мир во весь кадр (холст data-world) — заполнение; пустоту в нём ловит probe (sparse).
      // Плоский 2D-фон с data-world — НЕ заполнение (тетрадный лист робота считался «всё занято»):
      // он отсекается как фон ниже, меряются его дети.
      if (it.wd && it.o >= 0.5 && it.t === "canvas") { grid.fill(1); break; }
      if (it.o < 0.3 || it.b || isBg(it) || (it.w >= W * 0.98 && it.h >= H * 0.98) || area(it) < 0.002 * W * H) continue; // декор навылет (data-bleed) — не содержание
      const c = clipSafe(it);
      if (!c) continue;
      const c0 = Math.floor(((c.x - S[0]) / S[2]) * COLS), c1 = Math.min(COLS - 1, Math.floor(((c.x + c.w - S[0]) / S[2]) * COLS - 1e-6));
      const r0 = Math.floor(((c.y - S[1]) / S[3]) * ROWS), r1 = Math.min(ROWS - 1, Math.floor(((c.y + c.h - S[1]) / S[3]) * ROWS - 1e-6));
      for (let r = r0; r <= r1; r++) for (let q = c0; q <= c1; q++) grid[r * COLS + q] = 1;
    }
    let cov = 0, best = 0, cur = 0, bestEnd = 0;
    for (let r = 0; r < ROWS; r++) {
      let any = 0;
      for (let q = 0; q < COLS; q++) { cov += grid[r * COLS + q]; any |= grid[r * COLS + q]; }
      if (!any) { cur++; if (cur > best) { best = cur; bestEnd = r; } } else cur = 0;
    }
    const covShare = cov / (COLS * ROWS);
    covs.push(covShare);
    bands.push(best / ROWS);
    const mid = (bestEnd - best / 2 + 0.5) / ROWS;
    bandWhere.push(best ? (mid < 0.34 ? "сверху" : mid > 0.66 ? "снизу" : "посередине") : "");
    if (covShare < LIM.nearEmpty && !nearCut(t.f)) emptyFrames.push(t.f);
  }
  m.coverage.median = +median(covs).toFixed(2);
  m.deadBand.medianFrac = +median(bands).toFixed(2);
  const bigBand = bands.filter((b) => b >= LIM.deadBand).length / bands.length;
  if (bigBand > LIM.deadShare) {
    const cnt = new Map<string, number>();
    bands.forEach((b, i) => { if (b >= LIM.deadBand) cnt.set(bandWhere[i], (cnt.get(bandWhere[i]) ?? 0) + 1); });
    m.deadBand.where = [...cnt.entries()].sort((p, q) => q[1] - p[1])[0]?.[0] ?? "";
    issues.push({ level: "WARN", source: "feed", kind: "dead-band", msg: `${Math.round(bigBand * 100)} % ролика в безопасной зоне есть пустая полоса ≥ ${Math.round(LIM.deadBand * 100)} % высоты (чаще ${m.deadBand.where}; медиана ${Math.round(m.deadBand.medianFrac * 100)} %) — на телефоне эта часть экрана ничего не делает. Перекомпонуйте: крупнее герой, ниже горизонт, текст на свободном месте; декор в полосе — не решение` });
  }
  for (const [p, q] of runs(emptyFrames, 2)) if (q - p + 1 >= Math.round(fps * 0.4)) issues.push({ level: "WARN", source: "feed", kind: "near-empty", frames: [p, q], msg: `кадры почти пустые (предметы < ${Math.round(LIM.nearEmpty * 100)} % безопасной зоны) ${((q - p + 1) / fps).toFixed(1)} с — пауза оправдана, только если в ней уже есть следующая мысль` });

  // ---- без звука: есть ли текст, пока идёт речь ----
  if (wordsFile && existsSync(wordsFile)) {
    try {
      const ws: Array<{ start: number; end: number }> = JSON.parse(readFileSync(wordsFile, "utf8")).words ?? [];
      const byF = new Map(tracks.map((t) => [t.f, t]));
      let sp = 0, withText = 0;
      for (const w of ws) for (let f = Math.round(w.start * fps); f <= Math.round(w.end * fps); f++) {
        const t = byF.get(f);
        if (!t) continue;
        sp++;
        if (t.items.some((it) => it.t === "text" && it.o >= 0.5)) withText++;
      }
      if (sp) {
        m.muted = { speechSec: +(sp / fps).toFixed(1), textShare: +(withText / sp).toFixed(2) };
        if (m.muted.textShare < LIM.muted) issues.push({ level: "WARN", source: "feed", kind: "muted", msg: `пока звучит речь, текст на экране только ${Math.round(m.muted.textShare * 100)} % времени — в ленте большинство смотрит без звука. Субтитры по словам или ключевой текст на каждую фразу (выбор за вами) — или причина в notes.md` });
      }
    } catch { /* нет слов */ }
  }

  // ---- текст на тексте ----
  const coll: Map<string, number[]> = new Map();
  for (const t of tracks) {
    if (t.f % 3) continue;
    // Коробка текста по Range — строка целиком (с запасом шрифта сверху и снизу); буквы —
    // примерно средние 2/3 её высоты: сравниваем их, иначе крупная цифра «наезжает» пустотой.
    const tx = t.items.filter((it) => it.t === "text" && it.o >= 0.5).map((it) => ({ ...it, y: it.y + it.h * 0.18, h: it.h * 0.67 }));
    for (let i = 0; i < tx.length; i++) for (let j = i + 1; j < tx.length; j++) {
      if (root(tx[i].k) === root(tx[j].k)) continue;
      const a0 = inter(tx[i], tx[j]);
      if (a0 > 0.15 * Math.min(area(tx[i]), area(tx[j]))) { const key = `${tx[i].k} × ${tx[j].k}`; coll.set(key, [...(coll.get(key) ?? []), t.f]); }
    }
  }
  for (const [key, fl] of coll) for (const [p, q] of runs(fl, 6).slice(0, 2)) issues.push({ level: "WARN", source: "feed", kind: "text-collide", id: key, frames: [p, q], msg: `текст наезжает на текст: ${key}` });

  // ---- текст на герое и герой за краем ----
  // Текст поверх героя (3D-предмет пролетает через заголовок) на телефоне — каша. Герой во весь
  // кадр (фото-фон) и текст внутри самого героя (подпись на товаре) — не в счёт; нарочно —
  // data-over-hero на тексте (обложка: надпись прямо на разбитом стекле).
  const onHero = new Map<string, number[]>();
  const cutFrames: number[] = [];
  const hbAt = new Map<number, ReturnType<typeof heroBox>>();
  for (const t of tracks) {
    const hb = heroBox(t);
    if (!hb) continue;
    hbAt.set(t.f, hb);
    const big = hb.w * hb.h > 0.6 * W * H;
    if (!big) {
      for (const it of t.items) {
        if (it.t !== "text" || it.o < 0.5 || it.r === "hero" || it.oh || it.ro === "decor") continue;
        const g = { ...it, y: it.y + it.h * 0.18, h: it.h * 0.67 };
        if (inter(g, hb as FItem) > 0.25 * area(g)) onHero.set(root(it.k), [...(onHero.get(root(it.k)) ?? []), t.f]);
      }
    }
    if (!hb.bleed && hb.w <= W && hb.h <= H) { // влезает в кадр, но срезан (крупный план больше кадра — не в счёт)
      const vis = inter(hb as FItem, { k: "", t: "", o: 1, x: 0, y: 0, w: W, h: H });
      if (area(hb) > 0 && 1 - vis / area(hb) > 0.06) cutFrames.push(t.f);
    }
  }
  // Только когда предмет движется через текст (пролетает, растёт, разбирается) и недолго (≤ 2.5 с):
  // подпись, которая лежит на герое весь бит (наклейка на стакане, метка на столбике), —
  // композиция, а не наезд предмета на заголовок.
  const moved = (p: number, q: number) => {
    const a0 = hbAt.get(p);
    if (!a0) return false;
    for (let f = p; f <= q; f++) {
      const b0 = hbAt.get(f);
      if (!b0) continue;
      if (Math.hypot(b0.x + b0.w / 2 - (a0.x + a0.w / 2), b0.y + b0.h / 2 - (a0.y + a0.h / 2)) > 0.015 * W || Math.abs(b0.w * b0.h / Math.max(1, a0.w * a0.h) - 1) > 0.06) return true;
    }
    return false;
  };
  for (const [id, fl] of onHero) for (const [p, q] of runs(fl, 2).filter(([p0, q0]) => q0 - p0 + 1 >= 6 && q0 - p0 + 1 <= fps * 2.5 && moved(p0, q0)).slice(0, 2)) issues.push({ level: "WARN", source: "feed", kind: "text-on-hero", id, frames: [p, q], msg: `«${id}» лежит на герое ${q - p + 1} кадров — на телефоне текст и предмет спорят за одно место. Разведи их (текст на свободное место, предмет пролетает в стороне или после надписи) или пометь нарочное data-over-hero на тексте` });
  for (const [p, q] of runs(cutFrames, 2)) if (q - p + 1 >= Math.round(fps * 0.5)) { issues.push({ level: "WARN", source: "feed", kind: "hero-cut", frames: [p, q], msg: `герой срезан краем кадра ${((q - p + 1) / fps).toFixed(1)} с (лицо/корпус уходит за край) — даже внутри data-world: мир за краем можно, герой нет. Камера/кадрирование по герою, место по направлению взгляда; нарочный крупный выход — data-bleed на герое` }); break; }

  // ---- бренд на финале ----
  const tail = tracks.filter((t) => t.f > tracks[tracks.length - 1].f - fps * 2);
  const brandFs = Math.max(0, ...tail.flatMap((t) => t.items.filter((it) => it.t === "text" && it.ro === "brand" && it.o >= 0.5 && it.fs).map((it) => (it.fs ?? 0) / H)));
  if (brandFs > 0 && brandFs < 0.04) issues.push({ level: "INFO", source: "feed", kind: "brand-small", msg: `имя бренда (data-role="brand") в последние 2 с — ${(brandFs * 100).toFixed(1)} % высоты: значок без имени не запоминается. Что зритель наберёт в поиске?` });

  // ---- игра персонажа ----
  const acting = new Set(tracks.flatMap((t) => t.items.filter((it) => it.a).map((it) => it.k)));
  if (acting.size) issues.push({ level: "INFO", source: "feed", kind: "acting", msg: `слои игры персонажа (data-acting): ${[...acting].slice(0, 6).join(", ")} — их скорость и перелёты не считаются «прыгает»; проверьте ленты глазами: игра читается, кадр стоит` });
  return { issues, m };
};

// ---- контраст по пикселям черновика ----
// Для текста с известным цветом (getComputedStyle) на выборке кадров: пиксели внутри коробки
// глифов делятся на «чернила» (близко к цвету текста) и «фон» (далеко), контраст — цвет
// текста против медианы фона. Тень и обводка попадают в «фон» и честно повышают контраст.
export const measureContrast = async (draft: string, tracks: FTrack[], fps: number): Promise<{ issues: FIssue[]; rows: Array<{ id: string; f: number; measured: number }> }> => {
  const issues: FIssue[] = [];
  const rows: Array<{ id: string; f: number; measured: number }> = [];
  if (!tracks.length || !existsSync(draft)) return { issues, rows };
  const H = tracks[0].H, W = tracks[0].W;
  const pick = new Set<number>([tracks[0].f]);
  for (const t of tracks) if (t.f % Math.round(fps) === 0) pick.add(t.f);
  pick.add(tracks[tracks.length - 1].f);
  const frames = [...pick].filter((f) => tracks.some((t) => t.f === f && t.items.some((it) => it.t === "text" && it.col && it.o >= 0.8))).slice(0, 80);
  if (!frames.length) return { issues, rows };
  const tmp = mkdtempSync(join(tmpdir(), "contrast-"));
  try {
    const sel = frames.map((f) => `eq(n\\,${f})`).join("+");
    const r = spawnSync("ffmpeg", ["-v", "error", "-i", draft, "-vf", `select='${sel}'`, "-fps_mode", "passthrough", join(tmp, "f%04d.png")]);
    if (r.status !== 0) return { issues, rows };
    const files = readdirSync(tmp).filter((f) => f.endsWith(".png")).sort();
    const worst = new Map<string, { f: number; c: number; big: boolean }>();
    for (let i = 0; i < files.length && i < frames.length; i++) {
      const f = frames[i];
      const t = tracks.find((x) => x.f === f)!;
      const { data, info } = await sharp(join(tmp, files[i])).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const k = info.width / W;
      for (const it of t.items) {
        if (it.t !== "text" || !it.col || it.o < 0.8 || !it.fs || it.fs < 0.02 * H) continue;
        const [cr, cg, cb, ca] = parseCss(it.col);
        if (ca < 0.5) continue; // градиент/прозрачная заливка — цвет не известен
        const x0 = Math.max(0, Math.floor(it.x * k)), y0 = Math.max(0, Math.floor(it.y * k));
        const x1 = Math.min(info.width, Math.ceil((it.x + it.w) * k)), y1 = Math.min(info.height, Math.ceil((it.y + it.h) * k));
        if (x1 - x0 < 3 || y1 - y0 < 3) continue;
        let ink = 0, n = 0;
        const bg: Array<[number, number, number]> = [];
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const o = (y * info.width + x) * 3;
          const d = Math.hypot(data[o] - cr, data[o + 1] - cg, data[o + 2] - cb);
          n++;
          if (d < 60) ink++; else if (d > 110) bg.push([data[o], data[o + 1], data[o + 2]]);
        }
        if (ink / n < 0.04 || bg.length < 0.15 * n) continue;
        const lumOf = (p: [number, number, number]) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
        bg.sort((p, q) => lumOf(p) - lumOf(q));
        const med = bg[Math.floor(bg.length / 2)];
        const hex = (v: number) => Math.round(v).toString(16).padStart(2, "0");
        const c = contrast(`#${hex(cr)}${hex(cg)}${hex(cb)}`, `#${hex(med[0])}${hex(med[1])}${hex(med[2])}`);
        const id = root(it.k);
        // Крупный текст — 3:1 (WCAG), но предложение и поддержка (data-role offer/support) —
        // информация, которую надо прочесть: пол студии 4.5 для них при любом кегле.
        const big = it.fs >= 0.035 * H && it.ro !== "offer" && it.ro !== "support";
        const w0 = worst.get(id);
        if (!w0 || c < w0.c) worst.set(id, { f, c, big });
      }
    }
    for (const [id, w0] of worst) {
      rows.push({ id, f: w0.f, measured: +w0.c.toFixed(2) });
      const min = w0.big ? LIM.contrastBig : LIM.contrastSmall;
      if (w0.c < min) issues.push({ level: "WARN", source: "feed", kind: "contrast-px", id, frames: [w0.f, w0.f], msg: `«${id}»: контраст по пикселям кадра ${w0.c.toFixed(2)} (нужно ≥ ${min}) — под текстом не тот фон, что заявлен. Подложка (плашка/скрим), цвет «чернил» или место спокойнее` });
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  return { issues, rows };
};

// ---- композиция и текст по битам: призраки, «прилипло к верху», герой пропал, иерархия ----
export type Seg = { id: string; from: number; to: number; kind?: string };
export type Feed2Metrics = {
  headline: Array<{ id: string; maxFrac: number }>;
  composition: { topHeavyShare: number; medianCy: number; medianBottom: number };
  heroAbsent: Array<[number, number]>;
  figures: Array<{ fig: string; firstSec: number | null }>;
  roles: Array<{ role: string; maxFrac: number }>;
};

// Цифры брифа, которые зритель должен увидеть: цены, проценты, даты, адреса с номером.
export const briefFigures = (brief: string): Array<{ fig: string; digits: string; price: boolean }> => {
  const out: Array<{ fig: string; digits: string; price: boolean }> = [];
  const add = (fig: string, price: boolean) => { const d = fig.replace(/\D/g, ""); if (d && !out.some((x) => x.digits === d)) out.push({ fig: fig.trim(), digits: d, price }); };
  for (const m of brief.matchAll(/(\d[\d\s ]{0,9}\d|\d)\s*(₽|руб|р\.|%|процент)/gi)) add(m[0], /₽|руб|р\./i.test(m[2]));
  for (const m of brief.matchAll(/\b(\d{1,2})\s+(январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)\S*/gi)) add(m[0], false);
  return out.slice(0, 6);
};

export const analyzeFeed2 = (tracks: FTrack[], fps: number, segs: Seg[], brief: string | null): { issues: FIssue[]; m: Feed2Metrics } => {
  const issues: FIssue[] = [];
  const m: Feed2Metrics = { headline: [], composition: { topHeavyShare: 0, medianCy: NaN, medianBottom: NaN }, heroAbsent: [], figures: [], roles: [] };
  if (!tracks.length) return { issues, m };
  const W = tracks[0].W, H = tracks[0].H;
  const S = tracks[0].S ?? safeOf(W, H);
  const byF = new Map(tracks.map((t) => [t.f, t]));
  const segAt = (f: number) => segs.find((s) => f >= s.from && f < s.to);

  // Призрак: две строки текста друг на друге, обе полупрозрачные (смена текста одновременным
  // растворением — «На счётет / 1000000₽₽»).
  // Призрак = одна строка гаснет, другая проявляется в том же месте (а не две строки,
  // которые вместе входят в одну композицию).
  const ghost: Map<string, number[]> = new Map();
  for (const t of tracks) {
    const prev = byF.get(t.f - 1);
    const trend = (it: FItem) => { const p = prev?.items.find((x) => x.k === it.k); return p ? Math.sign(Math.round((it.o - p.o) * 100)) : 1; };
    const tx = t.items.filter((it) => it.t === "text" && it.o > 0.2 && it.o < 0.92);
    for (let i = 0; i < tx.length; i++) for (let j = i + 1; j < tx.length; j++) {
      if (tx[i].tx && tx[i].tx === tx[j].tx) continue;
      if (trend(tx[i]) * trend(tx[j]) >= 0) continue;
      const a0 = inter(tx[i], tx[j]);
      if (a0 > 0.3 * Math.min(area(tx[i]), area(tx[j]))) { const key = `${root(tx[i].k)} × ${root(tx[j].k)}`; ghost.set(key, [...(ghost.get(key) ?? []), t.f]); }
    }
  }
  for (const [key, fl] of ghost) for (const [p, q] of runs(fl, 1)) if (q - p + 1 >= 2) { issues.push({ level: "WARN", source: "feed", kind: "ghost-text", id: key, frames: [p, q], msg: `две строки текста друг на друге полупрозрачными ${q - p + 1} кадров (${key}) — на телефоне это каша букв. Сначала уход, потом приход (SwapText по умолчанию так и делает) или маска-прокрутка` }); break; }

  // Самый крупный текст бита: есть ли слово, которое «бьёт».
  for (const sg of segs) {
    let mx = 0;
    for (let f = sg.from; f < sg.to; f++) for (const it of byF.get(f)?.items ?? []) if (it.t === "text" && it.o >= 0.6 && it.fs && !it.b && it.ro !== "decor") mx = Math.max(mx, it.fs / H);
    m.headline.push({ id: sg.id, maxFrac: +mx.toFixed(3) });
  }
  const withText = m.headline.filter((h) => h.maxFrac > 0);
  if (withText.length >= 2 && Math.max(...withText.map((h) => h.maxFrac)) < 0.06) issues.push({ level: "WARN", source: "feed", kind: "no-headline", msg: `самый крупный текст во всём ролике ${(Math.max(...withText.map((h) => h.maxFrac)) * 100).toFixed(1)} % высоты: на телефоне всё «прилично и мелко», нет слова, которое бьёт. Ключевое слово/цифра бита — ориентир ≥ 7 % высоты (~130 px) или ≥ 60 % ширины безопасной зоны; подписи — 3.5–5 %` });

  // Иерархия по смыслу (data-role): предложение крупнее поддержки и не мельче 5 % высоты.
  const roleMax = new Map<string, number>();
  for (const t of tracks) for (const it of t.items) if (it.t === "text" && it.ro && it.fs && it.o >= 0.6) roleMax.set(it.ro, Math.max(roleMax.get(it.ro) ?? 0, it.fs / H));
  m.roles = [...roleMax.entries()].map(([role, v]) => ({ role, maxFrac: +v.toFixed(3) }));
  const offer = roleMax.get("offer"), support = roleMax.get("support");
  if (offer !== undefined && ((support !== undefined && offer < support) || offer < 0.05)) issues.push({ level: "INFO", source: "feed", kind: "offer-small", msg: `текст data-role="offer" — ${(offer * 100).toFixed(1)} % высоты${support !== undefined ? `, поддержка — ${(support * 100).toFixed(1)} %` : ""}: условие предложения (цена, «только по выходным») — информация, а не сноска. Нарочно так?` });

  // Композиция: центр масс содержимого (герой, текст, картинки) по высоте безопасной зоны.
  const cys: number[] = [], bottoms: number[] = [];
  let top = 0, counted = 0;
  for (const t of tracks) {
    if (t.f % 3) continue;
    let sa = 0, sy = 0, bot = 0;
    for (const it of t.items) {
      if (it.o < 0.5 || it.b || (it.wd && it.t === "canvas") || it.ro === "decor") continue;
      if (it.t !== "text" && it.r !== "hero" && (it.w >= W * 0.98 || area(it) < 0.003 * W * H)) continue;
      const y0 = Math.max(it.y, S[1]), y1 = Math.min(it.y + it.h, S[1] + S[3]);
      if (y1 <= y0) continue;
      const a0 = Math.max(1, it.w) * (y1 - y0) * (it.r === "hero" ? 2 : 1);
      sa += a0; sy += a0 * ((y0 + y1) / 2); bot = Math.max(bot, y1);
    }
    if (!sa) continue;
    const cy = (sy / sa - S[1]) / S[3], bt = (bot - S[1]) / S[3];
    cys.push(cy); bottoms.push(bt); counted++;
    if (cy < 0.4 && bt < 0.65) top++;
  }
  if (counted) {
    m.composition = { topHeavyShare: +(top / counted).toFixed(2), medianCy: +median(cys).toFixed(2), medianBottom: +median(bottoms).toFixed(2) };
    if (top / counted > 0.5) issues.push({ level: "WARN", source: "feed", kind: "top-heavy", msg: `композиция прилипла к верху ${Math.round((top / counted) * 100)} % ролика: центр содержимого на ${Math.round(m.composition.medianCy * 100)} % высоты безопасной зоны, низ — на ${Math.round(m.composition.medianBottom * 100)} %. Рабочая зона — вся безопасная (Reels закрывает нижние ~20 % и правую колонку ~12 % в нижней половине): герой ниже и крупнее (центр ≈ 55 %), камера ближе, горизонт ниже; помощник composeV из @studio/camera-choreography` });
  }

  // Герой пропал: помечен data-hero, но на кадрах его нет или он < 2 % кадра (кроме битов kind establish).
  if (tracks.some((t) => t.items.some((it) => it.r === "hero"))) {
    const miss: number[] = [];
    for (const t of tracks) {
      const sg = segAt(t.f);
      if (sg && /establish|общий|intro-wide/i.test(sg.kind ?? "")) continue;
      const hs = t.items.filter((it) => it.r === "hero" && it.o >= 0.4);
      const a0 = hs.reduce((s0, it) => s0 + area(it), 0);
      if (a0 < 0.02 * W * H) miss.push(t.f);
    }
    for (const [p, q] of runs(miss, 2)) if (q - p + 1 > fps * 0.8) {
      m.heroAbsent.push([p, q]);
      issues.push({ level: "WARN", source: "feed", kind: "hero-absent", frames: [p, q], msg: `герой (data-hero) пропал или меньше 2 % кадра на ${((q - p + 1) / fps).toFixed(1)} с — кадр без героя и без мысли. Камера ведёт героя (follow-fall в camera-choreography), или бит помечен kind: "establish" в beats.json, если общий план нарочно` });
    }
  }

  // Цифры брифа на экране: когда впервые видны (по тексту в треках).
  if (brief) {
    const figs = briefFigures(brief);
    for (const fg of figs) {
      let first: number | null = null;
      for (const t of tracks) { if (t.items.some((it) => it.t === "text" && it.o >= 0.5 && (it.tx ?? "").replace(/\D/g, "").includes(fg.digits))) { first = t.f; break; } }
      m.figures.push({ fig: fg.fig, firstSec: first === null ? null : +(first / fps).toFixed(1) });
    }
    const prices = figs.map((fg, i) => ({ ...fg, sec: m.figures[i].firstSec })).filter((x) => x.price);
    const firstPrice = prices.map((x) => x.sec).filter((x): x is number => x !== null).sort((p, q) => p - q)[0];
    if (prices.length && (firstPrice === undefined || firstPrice > 3)) issues.push({ level: "WARN", source: "feed", kind: "offer-late", msg: `промо: цена/предложение из брифа (${prices.map((x) => x.fig).join(", ")}) впервые на экране ${firstPrice === undefined ? "— нигде (текстом)" : `на ${firstPrice} с`}. Что предлагают и почему сейчас — видно в первые 2–3 с? Кто пролистнул на 3-й секунде, предложения не увидел. Если позже нарочно — почему, в notes.md` });
  }
  return { issues, m };
};

// ---- форма: слайд-шоу, метроном склеек, призыв без воздуха ----
// slideshow — бит, где единственное движение — общий наезд на одно фото (все предметы едут
// вместе с фоном), а текст встаёт на склейке без входа и без события. Один такой бит —
// спокойствие; большинство битов — «пролистываемая карусель фото». Подсказка, не квота.
// metronome — все планы одной длины (разброс < 20 %): ритм не следует смыслу.
// cta-cramped — data-role="cta" прижат к заголовку (зазор < ½ строки) или мельче половины его.
export type FormMetrics = { photoBeats: number; slideshow: string[]; shotCv: number | null };
export const analyzeForm = (tracks: FTrack[], fps: number, segs: Seg[]): { issues: FIssue[]; m: FormMetrics } => {
  const issues: FIssue[] = [];
  const m: FormMetrics = { photoBeats: 0, slideshow: [], shotCv: null };
  if (!tracks.length) return { issues, m };
  const W = tracks[0].W, H = tracks[0].H;
  const byF = new Map(tracks.map((t) => [t.f, t]));
  const isFull = (it: FItem) => it.t !== "text" && it.t !== "box" && it.w >= W * 0.98 && it.h >= H * 0.98 && it.o >= 0.9;
  const cx = (it: FItem) => it.x + it.w / 2, cy = (it: FItem) => it.y + it.h / 2;
  for (const sg of segs) {
    if (sg.to - sg.from < fps * 1.2) continue;
    const f0 = byF.get(sg.from + 2), f1 = byF.get(sg.to - 3);
    if (!f0 || !f1) continue;
    const bg0 = f0.items.filter(isFull).sort((p, q) => area(q) - area(p))[0];
    const bg1 = bg0 && f1.items.find((it) => it.k === bg0.k && isFull(it));
    if (!bg0 || !bg1) continue; // не фото во весь кадр — другая история (2D/3D)
    m.photoBeats++;
    const s = bg1.w / Math.max(1, bg0.w);
    let live = false;
    // Предметы, которые двигаются сами (не вместе с фоном), появляются или исчезают внутри бита.
    const big = (t: FTrack) => t.items.filter((it) => !isFull(it) && it.t !== "text" && it.t !== "box" && !it.b && it.o >= 0.5 && area(it) >= 0.01 * W * H);
    const a0 = big(f0), a1 = big(f1);
    for (const it of a1) {
      const p = a0.find((x) => x.k === it.k);
      if (!p || it.a) { live = true; break; }
      const px = cx(bg1) + (cx(p) - cx(bg0)) * s, py = cy(bg1) + (cy(p) - cy(bg0)) * s;
      if (Math.hypot(px - cx(it), py - cy(it)) > 0.004 * W || Math.abs(it.w / Math.max(1, p.w) - s) > 0.03) { live = true; break; }
    }
    if (!live && a0.some((p) => !a1.some((x) => x.k === p.k))) live = true;
    // Текст: вход (прозрачность, маска, сдвиг) или появление посреди бита — тоже событие.
    if (!live) {
      const seen = new Set<string>();
      for (let f = sg.from; f < sg.to && !live; f++) {
        const t = byF.get(f);
        if (!t) continue;
        for (const it of t.items) {
          if (it.t !== "text" || it.o < 0.3 || seen.has(it.k)) continue;
          seen.add(it.k);
          if (f > sg.from + 6 || it.o < 0.85 || it.c) { live = true; break; }
          const later = byF.get(f + 5)?.items.find((x) => x.k === it.k);
          if (later && (Math.abs(later.y - it.y) > 0.003 * H || Math.abs(later.w - it.w) > 0.02 * Math.max(1, it.w))) { live = true; break; }
        }
      }
    }
    if (!live) m.slideshow.push(sg.id);
  }
  if (m.photoBeats >= 3 && m.slideshow.length / m.photoBeats >= 0.6) issues.push({ level: "WARN", source: "feed", kind: "slideshow", msg: `${m.slideshow.length} из ${m.photoBeats} фото-битов (${m.slideshow.slice(0, 6).join(", ")}) — только общий наезд на одно фото, текст встаёт на склейке без входа: «карусель фото». Что в предмете движется само (пламя, пар, вращение, руки)? PhotoLayers/вырезка со своим движением, fx над предметом, текст маской на слове — выбор за тобой; спокойный ролик — тоже выбор, но записанный` });
  // Ритм склеек
  const lens = segs.slice(0, -1).map((sg) => (sg.to - sg.from) / fps).filter((x) => x > 0);
  if (lens.length >= 5) {
    const mean = lens.reduce((s0, x) => s0 + x, 0) / lens.length;
    const sd = Math.sqrt(lens.reduce((s0, x) => s0 + (x - mean) ** 2, 0) / lens.length);
    m.shotCv = +(sd / mean).toFixed(2);
    if (m.shotCv < 0.2) issues.push({ level: "INFO", source: "feed", kind: "metronome", msg: `все планы ≈ ${mean.toFixed(1)} с (разброс ${Math.round(m.shotCv * 100)} %) — склейки метрономом. «Нет застоя дольше ~3 с» — потолок, а не интервал: долгий план на главном, триоль коротких на перечислении, стоп на ударе` });
  }
  // Призыв на финале
  const last = tracks[tracks.length - 1];
  const tx = last.items.filter((it) => it.t === "text" && it.o >= 0.6 && it.fs);
  const cta = tx.find((it) => it.ro === "cta");
  if (cta) {
    const title = tx.filter((it) => it !== cta && it.ro !== "decor" && it.ro !== "disclaimer").sort((p, q) => (q.fs ?? 0) - (p.fs ?? 0))[0];
    if (title) {
      const gap = cta.y >= title.y ? cta.y - (title.y + title.h) : title.y - (cta.y + cta.h);
      const small = (cta.fs ?? 0) < 0.5 * (title.fs ?? 0);
      if (gap < 0.5 * cta.h || small) issues.push({ level: "WARN", source: "feed", kind: "cta-cramped", frames: [last.f, last.f], msg: `призыв «${cta.tx ?? cta.k}» ${gap < 0.5 * cta.h ? `прижат к «${title.tx ?? title.k}» (зазор ${Math.round(gap)} px < ½ строки)` : ""}${small ? `${gap < 0.5 * cta.h ? " и " : ""}мельче половины заголовка` : ""} — читается как подзаголовок, а не действие. Воздух, свой вес или своя плашка` });
    }
  }
  return { issues, m };
};

// ---- герой по битам, развязка, финал, однообразие раскладки, робкое движение ----
// Раунд 5: медиана по всему ролику прятала плохие биты (робот 15 % зоны на финале при медиане
// 0.42), коробка считала нитку ценника и пустой div-замер, data-hero на тексте подменял героя.
// Здесь — по битам, по нарисованным пикселям героя (ink: review рендерит слой data-hero
// отдельно), кадры без героя — ноль.
export type BeatHero = { id: string; kind?: string; p25: number; median: number; ink: boolean; typo: boolean; cy: number | null };
export type BeatsMetrics = { beats: BeatHero[]; payoff: { id: string; share: number; prev: number | null; textSec: number | null; freezeSec: number | null } | null; endHoldSec: number | null; layoutSame: number; motionBeats: number };
const pct = (xs: number[], q: number) => { if (!xs.length) return NaN; const s0 = [...xs].sort((p, q2) => p - q2); return s0[Math.min(s0.length - 1, Math.floor(q * s0.length))]; };
export const isPayoff = (sg: Seg) => /payoff|развяз/i.test(sg.kind ?? "");

export const analyzeBeats = (tracks: FTrack[], fps: number, segs: Seg[], o: { ink?: Map<number, Ink>; diffs?: number[] | null; payoffTextSec?: number | null; payoffTextFact?: boolean; endHoldSec?: number | null } = {}): { issues: FIssue[]; m: BeatsMetrics } => {
  const issues: FIssue[] = [];
  const m: BeatsMetrics = { beats: [], payoff: null, endHoldSec: o.endHoldSec ?? null, layoutSame: 0, motionBeats: 0 };
  if (!tracks.length || !segs.length) return { issues, m };
  const W = tracks[0].W, H = tracks[0].H;
  const S = tracks[0].S ?? safeOf(W, H);
  const safeA = S[2] * S[3];
  const byF = new Map(tracks.map((t) => [t.f, t]));
  const marked = tracks.some((t) => t.items.some((it) => it.r === "hero"));
  const clipShare = (b: { x: number; y: number; w: number; h: number }) => {
    const x = Math.max(b.x, S[0]), y = Math.max(b.y, S[1]), x2 = Math.min(b.x + b.w, S[0] + S[2]), y2 = Math.min(b.y + b.h, S[1] + S[3]);
    return x2 > x && y2 > y ? ((x2 - x) * (y2 - y)) / safeA : 0;
  };
  const textOnly = new Set<string>(), proxy2d: number[] = [], underUi: number[] = [];
  // ---- размер героя по битам ----
  for (const sg of segs) {
    const shares: number[] = [], inkShares: number[] = [], cys: number[] = [];
    let typo = false;
    for (let f = sg.from; f < sg.to; f++) {
      const t = byF.get(f);
      if (!t) continue;
      // Удар типографикой во весь кадр: слово ≥ 12 % высоты или во всю ширину зоны и ≥ 8 %.
      for (const it of t.items) if (it.t === "text" && it.o >= 0.6 && it.ro !== "decor" && ((it.fs ?? 0) >= 0.12 * H || (it.w >= 0.85 * S[2] && (it.fs ?? 0) >= 0.08 * H))) typo = true;
      const hi = heroItems(t);
      if (hi.textOnly) { for (const it of t.items) if (it.r === "hero" && it.t === "text") textOnly.add(it.tx ?? it.k); shares.push(0); continue; } // надпись — не предмет
      const ik = o.ink?.get(f);
      if (ik) {
        // Слой data-hero ничего не нарисовал, а в кадре 3D-холст: герой — в холсте, мерим замер.
        // Слой data-hero ничего не нарисовал, а герой — пустая обёртка-замер: в 3D-холсте герой
        // там, мерим коробку; без холста видимый предмет не помечен (INFO hero-proxy-2d), коробка —
        // догадка (и не основание для FAIL: ink=false).
        const canvas = t.items.some((it) => it.t === "canvas" && it.o >= 0.5);
        if (ik.share < 0.005 && hi.items.length && hi.items.every((it) => it.px)) { if (!canvas) proxy2d.push(f); }
        else {
          inkShares.push(ik.share);
          if (ik.share > 0.005) { cys.push(ik.y + ik.h / 2); if (ik.y + ik.h / 2 > H * 0.8) underUi.push(f); }
          continue;
        }
      }
      if (!hi.items.length) { shares.push(0); continue; }
      const x = Math.min(...hi.items.map((h) => h.x)), y = Math.min(...hi.items.map((h) => h.y));
      const b = { x, y, w: Math.max(...hi.items.map((h) => h.x + h.w)) - x, h: Math.max(...hi.items.map((h) => h.y + h.h)) - y };
      shares.push(clipShare(b));
      cys.push(b.y + b.h / 2);
      if (b.y + b.h / 2 > H * 0.8 && b.w * b.h < 0.6 * W * H) underUi.push(f);
    }
    const use = inkShares.length ? inkShares : shares;
    m.beats.push({ id: sg.id, kind: sg.kind, p25: +pct(use, 0.25).toFixed(3), median: +pct(use, 0.5).toFixed(3), ink: inkShares.length > 0, typo, cy: cys.length ? +((pct(cys, 0.5) - S[1]) / S[3]).toFixed(2) : null });
  }
  if (marked) {
    const skip = (b: BeatHero) => /establish|общий|type|типограф/i.test(b.kind ?? "") || (b.typo && b.median < 0.02);
    const est = (b: BeatHero) => /establish|общий/i.test(b.kind ?? "");
    const small = m.beats.filter((b, i) => !skip(b) && Number.isFinite(b.p25) && b.p25 < LIM.heroBeat && !(isPayoff(segs[i]) || i === segs.length - 1));
    if (small.length) issues.push({ level: "WARN", source: "feed", kind: "hero-small-beat", msg: `герой мелкий по битам (25-й перцентиль доли безопасной зоны${small.some((b) => b.ink) ? ", по пикселям героя" : ""}): ${small.slice(0, 6).map((b) => `${b.id} ${Math.round(b.p25 * 100)} %`).join(", ")} — в этих битах на телефоне «наклейка» и пустое поле. Кадрируй в героя (голова и руки, деталь), пусть уходит за край (data-bleed), текст — в его свободное место; без героя нарочно — kind: "establish" у бита` });
    // Развязка и финал (призыв): главный предмет крупный или удар типографикой во весь кадр.
    const last = segs.length - 1;
    for (const i of [...new Set([segs.findIndex(isPayoff), last])].filter((x) => x >= 0)) {
      const b = m.beats[i];
      // Развязка может ударить типографикой; финал — нет: «того же мира», герой в кадре (CLAUDE.md).
      if (!b || est(b) || !Number.isFinite(b.p25) || b.p25 >= LIM.heroPayoff || (isPayoff(segs[i]) && b.typo)) continue;
      issues.push({ level: b.ink ? "FAIL" : "WARN", source: "feed", kind: "hero-small-payoff", frames: [segs[i].from, segs[i].to - 1], msg: `${i === last && !isPayoff(segs[i]) ? "финал" : "развязка"} ${b.id}: герой ${Math.round(b.p25 * 100)} % безопасной зоны${b.ink ? " по пикселям" : " по коробке"} (нужно ≥ ${Math.round(LIM.heroPayoff * 100)} %) — на телефоне главный кадр не держится на предмете. Герой крупнее прошлых битов, обрезан в кадр, уходит за край; или удар типографикой во весь кадр` });
    }
  }
  if (textOnly.size) issues.push({ level: "INFO", source: "feed", kind: "hero-text", msg: `data-hero стоит на тексте (${[...textOnly].slice(0, 3).map((x) => `«${x}»`).join(", ")}) — проверка героя меряет предмет, а не надпись: в этих битах героя «нет». Пометь data-hero сам рисунок/предмет; крупное слово — это data-role="offer"` });
  if (proxy2d.length >= fps * 0.5) issues.push({ level: "INFO", source: "feed", kind: "hero-proxy-2d", frames: [proxy2d[0], proxy2d[proxy2d.length - 1]], msg: "data-hero на пустой обёртке без 3D-холста: слой героя ничего не рисует — видимый предмет не помечен. Пометь data-hero сам рисунок (img/svg/<g>)" });
  for (const [p, q] of runs(underUi, 2)) if (q - p + 1 >= fps * 0.5) { issues.push({ level: "WARN", source: "feed", kind: "hero-under-ui", frames: [p, q], msg: `центр героя в нижних 20 % кадра ${((q - p + 1) / fps).toFixed(1)} с — там подпись ролика и кнопки ленты. Тело, земля, фон могут уходить под интерфейс; главная масса героя — выше (центр ≈ 55 % зоны)` }); break; }

  // ---- контракт развязки ----
  const pi = segs.findIndex(isPayoff);
  if (pi >= 0) {
    const b = m.beats[pi], prev = pi > 0 ? m.beats[pi - 1] : null;
    m.payoff = { id: segs[pi].id, share: b?.median ?? NaN, prev: prev ? prev.median : null, textSec: o.payoffTextSec ?? null, freezeSec: null };
    if (b && prev && !b.typo && Number.isFinite(b.median) && Number.isFinite(prev.median) && prev.median > 0.02 && b.median < LIM.payoffGrow * prev.median) issues.push({ level: "WARN", source: "feed", kind: "payoff-small", frames: [segs[pi].from, segs[pi].to - 1], msg: `развязка ${b.id} не крупнее прошлого бита: герой ${Math.round(b.median * 100)} % зоны против ${Math.round(prev.median * 100)} % у ${prev.id} (ориентир ×${LIM.payoffGrow}) — удар не читается как удар. Скачок крупности на развязке или типографика во весь кадр` });
    const need = o.payoffTextFact ? 1.5 : 1.0;
    if (o.payoffTextSec !== null && o.payoffTextSec !== undefined && o.payoffTextSec < need) issues.push({ level: "WARN", source: "feed", kind: "payoff-short", frames: [segs[pi].from, segs[pi].to - 1], msg: `текст развязки читается ${o.payoffTextSec.toFixed(1)} с по пикселям (нужно ≥ ${need} с${o.payoffTextFact ? " для факта" : ""}) — маска/шторка ещё открывается, когда бит уже уходит. Раньше вход или дольше бит` });
    // Стоп-кадр посреди жеста: движение → стоит > 0.8 с → снова движение внутри бита.
    // Развязка, бит перед ней (жест, который к ней ведёт: дворник, разрез, наливание) и биты-доказательства.
    // Один отрезок: путь к развязке + сама развязка (жест часто начинается в прошлом бите).
    const spans: Array<{ ci: number; sg: Seg }> = [{ ci: pi, sg: { id: pi > 0 ? `${segs[pi - 1].id}–${segs[pi].id}` : segs[pi].id, from: segs[Math.max(0, pi - 1)].from, to: segs[pi].to } }, ...segs.flatMap((x, k) => (/proof|доказ/i.test(x.kind ?? "") && k !== pi ? [{ ci: k, sg: x }] : []))];
    if (o.diffs?.length) for (const { ci, sg } of spans) {
      if (m.payoff.freezeSec) break;
      // Скользящая медиана 5 кадров: смена подписи (одиночный всплеск) не «движение жеста».
      const med5 = (f: number) => { const w = [-2, -1, 0, 1, 2].map((k) => o.diffs![f + k]).filter((v): v is number => v !== undefined).sort((p, q) => p - q); return w.length ? w[Math.floor(w.length / 2)] : 0; };
      const still = (f: number) => med5(f) < 0.0015, moving = (f: number) => med5(f) >= 0.004;
      for (let f = sg.from + 2; f < sg.to - 2; f++) {
        if (!still(f)) continue;
        let q = f; while (q + 1 < sg.to - 1 && still(q + 1)) q++;
        const len = q - f + 1;
        const before = Array.from({ length: f - sg.from }, (_, k) => sg.from + k).filter(moving).length >= 3;
        const after = Array.from({ length: Math.max(0, sg.to - q - 1) }, (_, k) => q + 1 + k).filter(moving).length >= 3;
        if (len > fps * 0.8 && before && after) {
          m.payoff.freezeSec = +(len / fps).toFixed(1);
          issues.push({ level: "WARN", source: "feed", kind: "payoff-freeze", frames: [f, q], msg: `${ci === pi ? "развязка" : "доказательство"} ${sg.id}: жест замирает на ${(len / fps).toFixed(1)} с посередине (кадры ${f}–${q}), потом движение продолжается — на телефоне это «завис». Жест доходит до конца одним ходом; пауза — после удара, а не внутри` });
          break;
        }
        f = q;
      }
    }
  }
  // ---- финал стоит ----
  const dur = (tracks[tracks.length - 1].f + 1) / fps;
  if (o.endHoldSec !== null && o.endHoldSec !== undefined && o.endHoldSec > 4) {
    const long = o.endHoldSec > 5 || o.endHoldSec > 0.25 * dur; // 4–5 с — косметика, дольше — ★
    issues.push({ level: "WARN", source: "feed", kind: long ? "end-hold" : "end-static", frames: [Math.max(0, tracks[tracks.length - 1].f - Math.round(o.endHoldSec * fps)), tracks[tracks.length - 1].f], msg: `финальная картинка стоит ${o.endHoldSec.toFixed(1)} с (${Math.round((o.endHoldSec / dur) * 100)} % ролика) без нового события — меняется только текст. Финальный мир ≤ 4 с без события: телефон/адрес читается поверх продолжающегося действия (дворник доходит, дверь бокса открывается, герой берёт товар)` });
  }
  // ---- однообразие раскладки: заголовок сверху, предмет по центру — в каждом бите ----
  let same = 0, counted = 0;
  for (const [i, sg] of segs.entries()) {
    const t = byF.get(Math.round((sg.from + sg.to) / 2));
    if (!t) continue;
    const head = t.items.filter((it) => it.t === "text" && it.o >= 0.6 && it.fs && it.ro !== "decor").sort((p, q) => (q.fs ?? 0) - (p.fs ?? 0))[0];
    const cy = m.beats[i]?.cy;
    if (!head || cy === null || cy === undefined) continue;
    counted++;
    const hy = (head.y + head.h / 2 - S[1]) / S[3];
    if (hy < 0.33 && cy > 0.33 && cy < 0.7 && m.beats[i].median < 0.5) same++;
  }
  m.layoutSame = counted ? +(same / counted).toFixed(2) : 0;
  if (counted >= 5 && same / counted >= 0.8) issues.push({ level: "WARN", source: "feed", kind: "layout-template", msg: `${same} из ${counted} битов собраны одинаково: заголовок сверху, предмет посередине, низ пустой — слайд-шоу шаблоном, даже если планы разные. Варианты из camera-choreography: герой во весь кадр (full-bleed), текст за/поверх героя (data-over-hero), экстремальная деталь, текст внизу на земле/горизонте` });
  // ---- робкое движение: в бите нет ни одного движения быстрее 40 % потолка ----
  const L = 0.006 * W, floor = 0.4 * L;
  let moved = 0;
  for (const sg of segs) {
    let peak = 0;
    for (let f = sg.from + 3; f < sg.to - 1; f++) {
      const t = byF.get(f), p = byF.get(f - 1);
      if (!t || !p) continue;
      for (const it of t.items) {
        if (it.t === "text" || it.px || (it.w >= W * 0.98 && it.h >= H * 0.98) || it.o < 0.5) continue;
        const q = p.items.find((x) => x.k === it.k);
        if (!q || Math.abs(it.w - q.w) > 0.25 * Math.max(1, q.w)) continue;
        peak = Math.max(peak, Math.hypot(it.x + it.w / 2 - q.x - q.w / 2, it.y + it.h / 2 - q.y - q.h / 2) + Math.abs(it.w - q.w) / 2);
      }
    }
    if (peak >= floor) moved++;
  }
  m.motionBeats = moved;
  if (segs.length >= 4 && moved / segs.length < 0.5) issues.push({ level: "WARN", source: "feed", kind: "timid-motion", msg: `заметное движение (≥ 40 % потолка скорости) только в ${moved} из ${segs.length} битов — «всё плавно и мало»: потолок 0.6 %W/кадр — предел, а не цель. Один уверенный ход на бит с разгоном и торможением: наезд-ступенька, проводка за героем, вход предмета; фото — параллакс вырезки (generated-imagery)` });
  return { issues, m };
};

// ---- текст развязки: сколько секунд он читается по пикселям ----
// Маска/шторка: в треке o=1 с первого кадра, а на экране слово ещё закрыто. Меряем долю
// «чернил» (пиксели цвета текста) в коробке глифов на каждом кадре окна; читается — когда
// чернил ≥ 60 % от максимума. Возвращает самый длинный такой кусок (с) и «факт ли» (цифры
// или > 2 слов).
export const measurePayoffText = async (draft: string, tracks: FTrack[], fps: number, seg: Seg): Promise<{ sec: number; fact: boolean; id: string } | null> => {
  if (!existsSync(draft) || !tracks.length) return null;
  const H = tracks[0].H, W = tracks[0].W;
  const byF = new Map(tracks.map((t) => [t.f, t]));
  const last = tracks[tracks.length - 1].f;
  // Главный текст развязки: самый крупный, что появляется в бите.
  let main: FItem | null = null;
  for (let f = seg.from; f < seg.to; f++) for (const it of byF.get(f)?.items ?? []) if (it.t === "text" && it.col && it.ro !== "decor" && (it.fs ?? 0) > (main?.fs ?? 0)) main = it;
  if (!main || !main.col) return null;
  const key = main.k, txt = main.tx ?? "";
  const a0 = seg.from, b0 = Math.min(last, seg.to - 1 + Math.round(fps * 2));
  const tmp = mkdtempSync(join(tmpdir(), "payoff-"));
  try {
    const r = spawnSync("ffmpeg", ["-v", "error", "-i", draft, "-vf", `select='between(n\\,${a0}\\,${b0})'`, "-fps_mode", "passthrough", join(tmp, "f%04d.png")]);
    if (r.status !== 0) return null;
    const files = readdirSync(tmp).filter((f) => f.endsWith(".png")).sort();
    const [cr, cg, cb] = parseCss(main.col);
    const inkAt: number[] = [];
    for (let i = 0; i < files.length; i++) {
      const it = byF.get(a0 + i)?.items.find((x) => x.k === key);
      if (!it || it.o < 0.3) { inkAt.push(0); continue; }
      const { data, info } = await sharp(join(tmp, files[i])).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const k = info.width / W;
      const x0 = Math.max(0, Math.floor(it.x * k)), y0 = Math.max(0, Math.floor((it.y + it.h * 0.18) * k));
      const x1 = Math.min(info.width, Math.ceil((it.x + it.w) * k)), y1 = Math.min(info.height, Math.ceil((it.y + it.h * 0.85) * k));
      let ink = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const o = (y * info.width + x) * 3; n++; if (Math.hypot(data[o] - cr, data[o + 1] - cg, data[o + 2] - cb) < 60) ink++; }
      inkAt.push(n ? (ink / n) * it.o : 0);
    }
    return { sec: +(readableRun(inkAt) / fps).toFixed(2), fact: /\d/.test(txt) || txt.split(/\s+/).filter(Boolean).length > 2, id: root(key) };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
};
// Самый длинный кусок кадров, где чернил ≥ 60 % от максимума (и максимум заметен).
export const readableRun = (inkAt: number[]): number => {
  const mx = Math.max(0, ...inkAt);
  if (mx < 0.02) return 0;
  let best = 0, cur = 0;
  for (const v of inkAt) { if (v >= 0.6 * mx) { cur++; best = Math.max(best, cur); } else cur = 0; }
  return best;
};

// Обещание концепта: в concept.md строки «Доказательство: 12.5 с — …», «Поворот: 6 с — …».
export const promiseTimes = (concept: string): Array<{ what: string; sec: number; text: string }> => {
  const out: Array<{ what: string; sec: number; text: string }> = [];
  for (const m of concept.matchAll(/(доказательств\S*|поворот\S*|proof|turn)[^:\n]{0,40}:\s*~?\s*([\d]+(?:[.,]\d+)?)\s*с(?![а-яё])\s*[—–-]?\s*([^\n]*)/gi)) out.push({ what: /доказ|proof/i.test(m[1]) ? "доказательство" : "поворот", sec: Number(m[2].replace(",", ".")), text: m[3].trim().slice(0, 60) });
  return out.slice(0, 3);
};
