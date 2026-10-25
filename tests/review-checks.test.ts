// Проверки и помощники самопроверки: лента, факты, развязка, монтаж, отступы под интерфейс.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { countAt } from "../studio/lib/data-viz";
import { calloutEnd } from "../studio/lib/explainer-cards";
import { samePaletteFamily } from "../studio/lib/art-direction/theme";
import { defaultMargins, FEED_UI } from "../studio/lib/layout";
import { briefFacts, calcLedger, inventedNumbers } from "../studio/skills/claims-and-compliance/facts";
import { analyzeFeed, type FTrack } from "../studio/skills/self-review/feed";
import { lintJob } from "../studio/skills/self-review/lint";
import { hflip, isJump, isMirror } from "../studio/skills/self-review/shots";

describe("countAt: счётчик, продолжающий прошлый бит", () => {
  const o = { start: 6, dur: 63, from: 16105, to: 25937 };
  it("в кадре start — ровно from (не округлённое 16 100)", () => {
    expect(countAt(0, o)).toBe(16105);
    expect(countAt(6, o)).toBe(16105);
  });
  it("никогда не идёт назад и не выходит за [from, to]", () => {
    let prev = -Infinity;
    for (let f = 0; f <= 80; f++) {
      const v = countAt(f, o);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeGreaterThanOrEqual(16105);
      expect(v).toBeLessThanOrEqual(25937);
      prev = v;
    }
    expect(countAt(69, o)).toBe(25937);
  });
  it("счёт вниз — тоже монотонно и с точным началом", () => {
    const d = { start: 0, dur: 30, from: 900, to: 120 };
    let prev = Infinity;
    for (let f = 0; f <= 31; f++) { const v = countAt(f, d); expect(v).toBeLessThanOrEqual(prev); prev = v; }
    expect(countAt(0, d)).toBe(900);
    expect(countAt(30, d)).toBe(120);
  });
});

describe("факты брифа с фразой", () => {
  const brief = "«ФиксПро»: замена экрана за 1 час. 12–15 секунд, без голоса. Адрес: ТЦ «Галерея», 2 этаж. Покажи 3D, 4K-экран, iPhone15.";
  const f = briefFacts(brief);
  it("1 — факт с фразой, 12–15 секунд — параметр ролика", () => {
    expect(f.find((x) => x.n === "1")).toMatchObject({ param: false });
    expect(f.find((x) => x.n === "1")!.phrase).toContain("за 1 час");
    expect(f.find((x) => x.n === "12–15")).toMatchObject({ param: true });
    expect(f.find((x) => x.n === "2")!.phrase).toContain("2 этаж");
  });
  it("цифра, слитая с буквами (3D, 4K, iPhone15), — не факт", () => {
    expect(f.map((x) => x.n)).not.toContain("3");
    expect(f.map((x) => x.n)).not.toContain("4");
    expect(f.map((x) => x.n)).not.toContain("15");
  });
  it("2/2 — одно значение", () => {
    expect(briefFacts("График 2/2, зарплата от 55 000 ₽").map((x) => x.n)).toEqual(["2/2", "55 000"]);
  });
});

describe("«## Расчёты»: вычисленные числа проверяются", () => {
  const notes = "## Расчёты\n- 10 000 * 1.1^5 = 16 105\n- 10000*1,1^10 → 25937 ₽\n- 2+2 = 5\n## Вопросы заказчику\nнет\n";
  it("сошлось — разрешено, не сошлось — calc-mismatch", () => {
    const l = calcLedger(notes);
    expect(l.ok).toContain(16105);
    expect(l.ok).toContain(25937);
    expect(l.bad.join(" ")).toContain("2+2");
  });
  it("invented-number пропускает проверенное и ругается на ошибку расчёта", () => {
    const dir = mkdtempSync(join(tmpdir(), "facts-"));
    try {
      const out = inventedNumbers({ dir, brief: "откладываешь 10 000 ₽ под 10%", screen: ["16 105 ₽", "25 937"], notes });
      expect(out.some((x) => x.kind === "invented-number" && x.level === "WARN")).toBe(false);
      expect(out.some((x) => x.kind === "calc-mismatch")).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("lint: зажим через константу — не unclamped", () => {
  it("const cl = {… clamp …}; interpolate(f, r, v, cl) и { ...cl, easing }", () => {
    const dir = mkdtempSync(join(tmpdir(), "lint-"));
    try {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", "a.tsx"), `const cl = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const a = interpolate(frame, [0, 10], [0, 1], cl);
const b = interpolate(frame, [0, 10], [0, 1], { ...cl, easing: EASE });
const c = interpolate(frame, [0, 10], [0, 1]);
`);
      const un = lintJob(dir).filter((x) => x.kind === "unclamped");
      expect(un).toHaveLength(1);
      expect(un[0].code).toContain("const c");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("семья палитры: «тёмное + лайм» у разных жанров", () => {
  it("четыре похожих ролика — одна семья; светлый фон или другой тон — нет", () => {
    expect(samePaletteFamily({ bg: "#24150E", accent: "#C6F04A" }, { bg: "#0F2A1E", accent: "#D2FF3C" })).toBe(true);
    expect(samePaletteFamily({ bg: "#0e1b1d", accent: "#b8ff3b" }, { bg: "#1c1934", accent: "#e4f07a" })).toBe(true);
    expect(samePaletteFamily({ bg: "#24150E", accent: "#C6F04A" }, { bg: "#F4EFE6", accent: "#C6F04A" })).toBe(false);
    expect(samePaletteFamily({ bg: "#24150E", accent: "#C6F04A" }, { bg: "#101020", accent: "#E0402A" })).toBe(false);
  });
});

describe("зона ленты — один источник", () => {
  it("Stage по умолчанию оставляет низ 20 % под подпись ролика", () => {
    const m = defaultMargins(1080, 1920);
    expect(m.bottom).toBe(Math.round(1920 * FEED_UI.bottom));
    expect(1920 - m.bottom).toBeLessThanOrEqual(1536);
  });
});

describe("грамматика склеек", () => {
  it("hflip — зеркало по горизонтали", () => {
    expect([...hflip(Float32Array.from([1, 2, 3, 4, 5, 6]), 3, 2)]).toEqual([3, 2, 1, 6, 5, 4]);
  });
  it("зеркальный разворот героя и скачок", () => {
    expect(isMirror(0.1, 0.8, true)).toBe(true);
    expect(isMirror(0.7, 0.75, true)).toBe(false);
    expect(isJump(0.9, false)).toBe(true);
    expect(isJump(0.9, true)).toBe(false);
    expect(isJump(0.99, false)).toBe(false); // граница бита без склейки, кадр тот же
    expect(isJump(0.5, false, 1.05)).toBe(true); // герой той же крупности сдвинут
    expect(isJump(0.5, false, 2.2)).toBe(false); // крупность сменилась ×2 — это новый план
  });
});

describe("выноска: линия кончается у края подписи", () => {
  it("конец линии — на ближайшем крае с зазором, не в центре слова", () => {
    const e = calloutEnd({ x: 100, y: 500 }, { x: 300, y: 480, w: 200, h: 40 }, 8);
    expect(e.x).toBeCloseTo(292);
    expect(e.y).toBeCloseTo(500);
  });
});

describe("лента: текст на герое и герой за краем", () => {
  const W = 1080, H = 1920;
  const mk = (f: number, items: FTrack["items"]): FTrack => ({ f, W, H, S: [59, 192, 962, 1344], items });
  it("text-on-hero — 3D-герой пролетает через заголовок; data-over-hero — нарочно; неподвижная наклейка — нет", () => {
    const hero = (f: number) => ({ k: "hero", t: "box", x: 300, y: 600 - f * 8, w: 500, h: 600, o: 1, r: "hero" as const });
    const title = { k: "СТАРЫЙ — ПРОЧЬ", t: "text", x: 350, y: 700, w: 400, h: 120, o: 1, fs: 100 };
    const tr = Array.from({ length: 20 }, (_, f) => mk(f, [hero(f), title]));
    expect(analyzeFeed(tr, 30, [], null).issues.some((i) => i.kind === "text-on-hero")).toBe(true);
    const still = Array.from({ length: 20 }, (_, f) => mk(f, [hero(0), title]));
    expect(analyzeFeed(still, 30, [], null).issues.some((i) => i.kind === "text-on-hero")).toBe(false);
    const ok = tr.map((t) => ({ ...t, items: t.items.map((it) => (it.t === "text" ? { ...it, oh: 1 as const } : it)) }));
    expect(analyzeFeed(ok, 30, [], null).issues.some((i) => i.kind === "text-on-hero")).toBe(false);
  });
  it("hero-cut — герой (не во весь кадр) наполовину за краем, даже в data-world", () => {
    const tr = Array.from({ length: 30 }, (_, f) => mk(f, [{ k: "ёж", t: "svg", x: 800, y: 900, w: 500, h: 400, o: 1, r: "hero" as const, wd: 1 as const }]));
    expect(analyzeFeed(tr, 30, [], null).issues.some((i) => i.kind === "hero-cut")).toBe(true);
    const inside = tr.map((t) => ({ ...t, items: t.items.map((it) => ({ ...it, x: 300 })) }));
    expect(analyzeFeed(inside, 30, [], null).issues.some((i) => i.kind === "hero-cut")).toBe(false);
  });
});
