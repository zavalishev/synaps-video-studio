// Облик студии как пространство (клетки, журнал), палитра от предмета по
// пикселям, герой по нарисованным пикселям и по битам, контракт развязки, ворота финала,
// без утечек цвета и размера из помощников.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deltaE, dominantColors, groundedIn, layoutOf, lookCell, occupancy, sameLayout } from "../studio/lib/art-direction/looks";
import { gateFrom, isRibbon } from "../studio/bin/_gate";
import { analyzeBeats, analyzeFeed, heroItems, type FItem, type FTrack, type Ink, promiseTimes, readableRun, type Seg } from "../studio/skills/self-review/feed";
import { inkBox, inkFrames } from "../studio/skills/self-review/ink";
import { zones } from "../studio/lib/layout-guard/zones";
import { composeV, frameSubject2D } from "../studio/lib/camera-choreography";
import { vizTheme } from "../studio/lib/data-viz";
import { cardTheme } from "../studio/lib/explainer-cards";

const W = 1080, H = 1920;
const S: [number, number, number, number] = [59, 154, 962, 1382];
const track = (f: number, items: FItem[]): FTrack => ({ f, W, H, S, items });
const bg: FItem = { k: "bg", t: "img", x: 0, y: 0, w: W, h: H, o: 1 };

describe("облик: клетки и подача", () => {
  it("лайм на тёмном — одна клетка у четырёх роликов, светлые и средние свободны", () => {
    const looks = [{ bg: "#1f3046", accent: "#a9cf3c" }, { bg: "#0F2A1E", accent: "#D2FF3C" }, { bg: "#24150E", accent: "#C6F04A" }, { bg: "#0e1b1d", accent: "#b8ff3b" }, { bg: "#F6EBDD", accent: "#B8501A" }];
    const occ = occupancy(looks);
    expect(lookCell("#1f3046", "#a9cf3c")!.key).toBe("dark/4");
    expect(occ.top[0]).toMatchObject({ key: "dark/4", n: 4 });
    expect(occ.free.mid.length).toBe(12);
    expect(occ.free.dark).not.toContain(4);
    expect(lookCell("#c79c6b", "#888888")!.sector).toBe(-1); // серый акцент — нейтральный
  });
  it("«влево рваным краем» и «блок влево» — одна подача; центр — другая", () => {
    const a = layoutOf({ type: { lockup: "номер шага огромной цифрой + слово капслоком влево рваным краем" }, shapes: { plate: "bar" } });
    const b = layoutOf({ type: { align: "left", lockup: "одно число во весь экран, всё влево рваным краем" }, shapes: { plate: "box" } });
    const c = layoutOf({ type: { align: "center", scale: "giant" }, shapes: { plate: "bar" } });
    expect(a).toMatchObject({ align: "left", scale: "giant", plate: "plate" });
    expect(sameLayout(a, b)).toBe(true);
    expect(sameLayout(a, c)).toBe(false);
  });
});

describe("палитра от предмета — по пикселям", () => {
  it("кремовая груша не оправдывает лаймовый акцент, зелёная — оправдывает", () => {
    expect(deltaE("#a9cf3c", "#dcc28d")).toBeGreaterThan(10);
    expect(groundedIn("#a9cf3c", [{ hex: "#dcc28d" }, { hex: "#cfae77" }, { hex: "#e2cba0" }])).toBeNull();
    expect(groundedIn("#a9cf3c", [{ hex: "#a6cc40", file: "pear.png" }])).toMatchObject({ file: "pear.png" });
  });
  it("доминантные цвета: прозрачное не считается, доли по пикселям", () => {
    const px = Buffer.alloc(100 * 4);
    for (let i = 0; i < 100; i++) { const o = i * 4; if (i < 60) { px[o] = 220; px[o + 1] = 194; px[o + 2] = 141; px[o + 3] = 255; } else if (i < 80) { px[o] = 30; px[o + 1] = 48; px[o + 2] = 70; px[o + 3] = 255; } else px[o + 3] = 0; }
    const d = dominantColors(px, 4);
    expect(d.length).toBe(2);
    expect(d[0].share).toBeCloseTo(0.75, 2);
  });
});

describe("ворота финала", () => {
  const review = { issues: [{ level: "WARN", kind: "flat-climax" }, { level: "WARN", kind: "cta-cramped" }, { level: "FAIL", source: "lint", kind: "spring" }] };
  it("открытый ★ и несделанная правка критика — не финал", () => {
    const g = gateFrom(review, "## Критик\nКритик #1: отложено на этап 2\n", false);
    expect(g.ok).toBe(false);
    expect(g.open.join("\n")).toMatch(/★ flat-climax/);
    expect(g.open.join("\n")).toMatch(/критика не сделана/);
    expect(g.open.join("\n")).not.toMatch(/cta-cramped|spring/); // косметика и lint не держат
  });
  it("★ закрыт вариантом новее review и строкой «пробовал»; критик сделан — финал", () => {
    const notes = "★ flat-climax: пробовал вспышку 3 кадра → хуже, потому что съедает цену\n## Критик\nКритик #1: сделано — финал крупнее\n";
    expect(gateFrom(review, notes, true)).toMatchObject({ ok: true, accepted: ["flat-climax"] });
    expect(gateFrom(review, notes, false).ok).toBe(false); // без варианта строка не закрывает
  });
  it("нет review — не финал; новые ★ развязки и финала в списке ворот", () => {
    expect(gateFrom(null, "", true).ok).toBe(false);
    for (const k of ["payoff-short", "payoff-freeze", "hero-small-payoff", "end-hold"]) expect(isRibbon(k)).toBe(true);
    expect(isRibbon("end-static")).toBe(false);
  });
});

describe("герой: предмет, а не надпись и не коробка", () => {
  it("data-hero на тексте и на обёртке надписи — не герой", () => {
    const t = track(0, [bg, { k: "age:7–12", t: "text", x: 59, y: 600, w: 962, h: 200, o: 1, r: "hero", tx: "7–12" }, { k: "wrap", t: "box", x: 0, y: 590, w: W, h: 220, o: 1, r: "hero" }]);
    expect(heroItems(t)).toMatchObject({ items: [], textOnly: true });
    const t2 = track(0, [{ k: "robot", t: "svg", x: 340, y: 700, w: 400, h: 540, o: 1, r: "hero" }, { k: "label", t: "text", x: 400, y: 900, w: 200, h: 60, o: 1, r: "hero" }]);
    expect(heroItems(t2).items.map((x) => x.k)).toEqual(["robot"]);
  });
  it("плоский 2D-фон с data-world не делает кадр «заполненным»", () => {
    const paper: FItem = { ...bg, k: "paper", t: "svg", wd: 1 };
    const robot: FItem = { k: "robot", t: "svg", x: 440, y: 900, w: 200, h: 260, o: 1, r: "hero", wd: 1 };
    const tracks = Array.from({ length: 30 }, (_, f) => track(f, [paper, robot]));
    const { m, issues } = analyzeFeed(tracks, 30, [], null);
    expect(m.coverage.median).toBeLessThan(0.2);
    expect(issues.some((i) => i.kind === "dead-band")).toBe(true);
  });
  it("рамка по массе: нитка ценника не раздувает героя", () => {
    const w = 100, h = 200, px = new Uint8Array(w * h * 4);
    const set = (x: number, y: number) => { px[(y * w + x) * 4 + 3] = 255; };
    for (let y = 0; y < 120; y++) set(50, y);                          // нитка
    for (let y = 120; y < 180; y++) for (let x = 30; x < 70; x++) set(x, y); // ценник
    const b = inkBox(px, w, h)!;
    expect(b.y).toBeGreaterThan(100);
    expect(b.w).toBeLessThanOrEqual(41);
  });
  it("кадры замера: по 3 на бит и плотнее на развязке и финале", () => {
    const fr = inkFrames([{ from: 0, to: 60 }, { from: 60, to: 120, kind: "payoff" }, { from: 120, to: 200 }], 199);
    expect(fr.filter((f) => f < 60).length).toBe(3);
    expect(fr.filter((f) => f >= 60 && f < 120).length).toBe(6);
  });
});

describe("герой по битам и контракт развязки", () => {
  const segs: Seg[] = [{ id: "b1", from: 0, to: 30 }, { id: "b2", from: 30, to: 60, kind: "payoff" }, { id: "b3", from: 60, to: 90, kind: "cta" }];
  const robot = (f: number, w: number): FItem => ({ k: "robot", t: "svg", x: 540 - w / 2, y: 700, w, h: w, o: 1, r: "hero" });
  it("финал с героем 15 % по пикселям — FAIL; развязка мельче прошлого бита — ★", () => {
    const tracks = Array.from({ length: 90 }, (_, f) => track(f, [bg, robot(f, f < 30 ? 800 : f < 60 ? 700 : 400)]));
    const ink = new Map<number, Ink>([[75, { f: 75, x: 340, y: 700, w: 400, h: 400, share: 0.12 }], [85, { f: 85, x: 340, y: 700, w: 400, h: 400, share: 0.12 }]]);
    const { issues, m } = analyzeBeats(tracks, 30, segs, { ink });
    expect(issues.find((i) => i.kind === "hero-small-payoff")?.level).toBe("FAIL");
    expect(m.beats[2]).toMatchObject({ ink: true });
    expect(issues.some((i) => i.kind === "payoff-small")).toBe(true);
  });
  it("развязка — удар типографикой во весь кадр: не «мелкий герой»", () => {
    const tracks = Array.from({ length: 90 }, (_, f) => track(f, [bg, robot(f, f < 30 ? 800 : 300), ...(f >= 30 && f < 60 ? [{ k: "hit", t: "text", x: 59, y: 400, w: 900, h: 300, o: 1, fs: 260, tx: "БЕСПЛАТНО" } as FItem] : [])]));
    const { issues } = analyzeBeats(tracks, 30, segs);
    expect(issues.filter((i) => i.kind === "hero-small-payoff").map((i) => i.frames?.[0])).toEqual([60]); // только финал
    expect(issues.some((i) => i.kind === "payoff-small")).toBe(false);
  });
  it("жест замирает посередине развязки > 0.8 с — payoff-freeze; финал стоит 7 с — ★ end-hold", () => {
    const tracks = Array.from({ length: 90 }, (_, f) => track(f, [bg, robot(f, 800)]));
    const diffs = Array.from({ length: 90 }, (_, f) => (f >= 30 && f < 56 ? 0.0006 : 0.02));
    const { issues } = analyzeBeats(tracks, 30, segs, { diffs, endHoldSec: 7, payoffTextSec: 0.7, payoffTextFact: true });
    expect(issues.find((i) => i.kind === "payoff-freeze")?.frames).toEqual([30, 55]);
    expect(issues.some((i) => i.kind === "end-hold")).toBe(true);
    expect(issues.find((i) => i.kind === "payoff-short")?.msg).toMatch(/1\.5/);
  });
  it("все биты «заголовок сверху, предмет по центру» — layout-template; без движения — timid-motion", () => {
    const sg: Seg[] = Array.from({ length: 6 }, (_, i) => ({ id: `b${i}`, from: i * 30, to: i * 30 + 30 }));
    const tracks = Array.from({ length: 180 }, (_, f) => track(f, [bg, { k: "head", t: "text", x: 80, y: 200, w: 600, h: 120, o: 1, fs: 100 }, { k: `obj${Math.floor(f / 30)}`, t: "img", x: 340, y: 760, w: 400, h: 400, o: 1, r: "hero" }]));
    const { issues } = analyzeBeats(tracks, 30, sg);
    expect(issues.some((i) => i.kind === "layout-template")).toBe(true);
    expect(issues.some((i) => i.kind === "timid-motion")).toBe(true);
  });
  it("текст читается: самый длинный кусок, где чернил ≥ 60 % максимума", () => {
    expect(readableRun([0, 0.1, 0.2, 0.5, 0.5, 0.5, 0.2, 0.5])).toBe(3);
    expect(readableRun([0, 0.01])).toBe(0);
  });
  it("обещание концепта со временем из concept.md", () => {
    expect(promiseTimes("Доказательство: 12,5 с — робот едет по столу\nПоворот: 6 с — рисунок становится деталями")).toEqual([
      { what: "доказательство", sec: 12.5, text: "робот едет по столу" },
      { what: "поворот", sec: 6, text: "рисунок становится деталями" },
    ]);
  });
});

describe("без утечек: размеры и цвета — от ролика", () => {
  it("zones: кнопки только в нижней половине, без субтитров в теме полоса не резервируется", () => {
    const z = zones(W, H, "reels");
    expect(z.safe.w).toBeGreaterThan(W * 0.88);
    expect(z.buttons).toMatchObject({ y: H / 2 });
    expect(z.caption.x + z.caption.w).toBeLessThanOrEqual(z.buttons!.x);
    const noCap = zones(W, H, "reels", { theme: {} }), cap = zones(W, H, "reels", { theme: { captions: { look: "clean" } } });
    expect(noCap.hero.h).toBeGreaterThan(cap.hero.h);
  });
  it("frameSubject2D и composeV по умолчанию — герой большую часть зоны", () => {
    const k = frameSubject2D({ x: 0, y: 0, w: 100, h: 100 }, { W, H });
    expect((100 * k.zoom) / zones(W, H).safe.w).toBeGreaterThan(0.8);
    const c = composeV({ x: 0, y: 0, w: 900, h: 1400 }, { titleH: 0, captionH: 0 });
    expect(c.hero.h / 1400).toBeCloseTo(0.75, 2);
  });
  it("vizTheme/cardTheme: только из палитры ролика, без палитры — ошибка", () => {
    const theme = { palette: { bg: "#F23D20", ink: "#111111", accent: "#FFFFFF" }, shapes: { corner: "none" as const } };
    const v = vizTheme(theme, { font: "x" });
    expect(v.accent).toBe("#FFFFFF");
    expect(v.series?.[0]).toBe("#FFFFFF");
    const c = cardTheme(theme, { font: "x", mono: "m" });
    expect(c).toMatchObject({ bg: "#F23D20", accent: "#FFFFFF", radius: 0 });
    expect(() => vizTheme({ palette: {} as never }, { font: "x" })).toThrow(/theme.palette/);
  });
  it("presets.json и помощники не несут готовых цветов «дома студии»", () => {
    const root = join(__dirname, "..", "studio");
    expect(readFileSync(join(root, "skills/art-direction/presets.json"), "utf8")).not.toMatch(/#[0-9a-f]{6}/i);
    for (const f of ["lib/data-viz/index.tsx", "lib/explainer-cards/index.tsx", "lib/presentation-frame/index.tsx"]) {
      const src = readFileSync(join(root, f), "utf8");
      expect(src).not.toMatch(/c8f031|7ee0b5|c65e45|VIZ_PRESETS|CARD_PRESETS/i);
    }
  });
});

describe("ворота финала: вариант в любой папке", () => {
  it("кадры studio still с --out вне out/stills засчитываются по отметке", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, utimesSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { finalGate, STILL_STAMP } = await import("../studio/bin/_gate");
    const dir = mkdtempSync(join(tmpdir(), "gate-"));
    mkdirSync(join(dir, "out", "review"), { recursive: true });
    const rf = join(dir, "out", "review", "review.json");
    writeFileSync(rf, JSON.stringify({ issues: [{ level: "WARN", kind: "flat-climax" }] }));
    utimesSync(rf, new Date(1_000_000), new Date(1_000_000));
    writeFileSync(join(dir, "notes.md"), "## Критик\nКритик #1: сделано — крупнее\n★ flat-climax: пробовал медленную маску → хуже, потому что поздно\n");
    expect(finalGate(dir).ok).toBe(false); // варианта после review нет
    writeFileSync(join(dir, "out", STILL_STAMP), "x"); // studio still --out out/variant
    expect(finalGate(dir)).toMatchObject({ ok: true, accepted: ["flat-climax"] });
  });
});
