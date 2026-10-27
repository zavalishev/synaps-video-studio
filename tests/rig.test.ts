// Скелетная анимация: математика поз (чистые функции) и резка листа частей.
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { apply, drawList, evaluate, placeAt, restBounds, rootMatrix, talkFromWords, validateRig, type RigDef } from "../studio/lib/rig/pose";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const rig: RigDef = {
  name: "t",
  parts: {
    torso: { src: "t.png", w: 100, h: 120, pivot: [50, 110] },
    head: { src: "h.png", w: 80, h: 80, parent: "torso", at: [50, 10], pivot: [40, 75], z: 2, alt: { blink: "hb.png", talk: "ht.png" } },
    armL: { src: "a.png", w: 30, h: 90, parent: "torso", at: [10, 20], pivot: [15, 10], z: -1 },
    armR: { src: "a.png", w: 30, h: 90, parent: "torso", at: [90, 20], pivot: [15, 10], z: -1 },
    legL: { src: "l.png", w: 35, h: 80, parent: "torso", at: [30, 105], pivot: [17, 8], z: -2 },
    legR: { src: "l.png", w: 35, h: 80, parent: "torso", at: [70, 105], pivot: [17, 8], z: -2 },
    ear: { src: "e.png", w: 20, h: 20, parent: "head", at: [10, 10], pivot: [10, 18], follow: 0.6 },
  },
};

describe("скелет", () => {
  it("проверка ловит ошибки", () => {
    expect(validateRig(rig)).toEqual([]);
    expect(validateRig({ parts: { a: { src: "a", w: 1, h: 1 }, b: { src: "b", w: 1, h: 1 } } })[0]).toMatch(/корень/);
    expect(validateRig({ parts: { a: { src: "a", w: 1, h: 1 }, b: { parent: "x", src: "b", w: 1, h: 1 } } }).join()).toMatch(/не найден/);
    expect(validateRig({ parts: { a: { w: 1, h: 1 } } }).join()).toMatch(/картинка/);
  });

  it("в исходной позе низ героя стоит на земле, рост — заданный", () => {
    const rest = restBounds(rig);
    const st = evaluate(rig, [], 0, { x: 500, y: 1600, height: 800 });
    const flat = { ...st.pose, dy: 0, sy: 1, sx: 1, ang: {} };
    const items = drawList(rig, flat, rootMatrix(rig, rest, 500, 1600, 800, flat));
    let y1 = -Infinity, y0 = Infinity;
    for (const it of items) if (it.kind === "img") for (const q of [[0, 0], [it.w, it.h], [0, it.h], [it.w, 0]] as [number, number][]) { const [, y] = apply(it.m, q); y1 = Math.max(y1, y); y0 = Math.min(y0, y); }
    expect(y1).toBeCloseTo(1600, 0);
    expect(y1 - y0).toBeCloseTo(800, 0);
  });

  it("порядок отрисовки по z: ноги, руки, туловище, голова", () => {
    const names = drawList(rig, evaluate(rig, [], 0, { x: 0, y: 0, height: 100 }).pose, [1, 0, 0, 1, 0, 0]).map((i) => i.name);
    expect(names.indexOf("legL")).toBeLessThan(names.indexOf("armL"));
    expect(names.indexOf("armL")).toBeLessThan(names.indexOf("torso"));
    expect(names.indexOf("torso")).toBeLessThan(names.indexOf("head"));
  });

  it("ходьба доводит до цели и разворачивает героя по ходу", () => {
    const acts = [{ do: "walk" as const, at: 0, to: [100, 0] as [number, number], dur: 2 }];
    expect(placeAt(acts, 1, { x: 500, y: 0, height: 100 }).x).toBeLessThan(500);
    const end = placeAt(acts, 3, { x: 500, y: 0, height: 100 });
    expect(end.x).toBe(100);
    expect(end.facing).toBe(-1);
  });

  it("взмах поднимает руку наружу и вверх, моргание и речь меняют голову", () => {
    const up = evaluate(rig, [{ do: "wave", at: 0, arm: "R" }], 0.8, { x: 0, y: 0, height: 100 }).pose;
    expect(up.ang.armR).toBeLessThan(-120); // правая рука: наружу — против часовой
    const talk = Array.from({ length: 30 }, (_, i) => evaluate(rig, [{ do: "talk", at: 0, dur: 3 }], i / 10, { x: 0, y: 0, height: 100 }).pose.alt.head);
    expect(talk).toContain("talk");
    const blinks = Array.from({ length: 300 }, (_, i) => evaluate(rig, [], i / 30, { x: 0, y: 0, height: 100 }).pose.alt.head).filter((x) => x === "blink");
    expect(blinks.length).toBeGreaterThan(2);
  });

  it("поза — чистая функция времени (одинаковая при повторе)", () => {
    const acts = [{ do: "hop" as const, at: 0.2 }, { do: "walk" as const, at: 0, to: [300, 0] as [number, number] }];
    const a = evaluate(rig, acts, 0.55, { x: 0, y: 0, height: 200 });
    const b = evaluate(rig, acts, 0.55, { x: 0, y: 0, height: 200 });
    expect(a).toEqual(b);
    expect(a.pose.dy).toBeLessThan(0); // в воздухе
  });

  it("реплики из words.json становятся речью", () => {
    const w = { lines: [{ id: "a", start: 1, end: 2 }, { id: "b", start: 3, end: 4.5 }] };
    expect(talkFromWords(w, { ids: ["b"], offset: 1 })).toEqual([{ do: "talk", at: 2, dur: 1.5 }]);
  });

  it("предмет-персонаж: резиновые конечности и лицо на теле", () => {
    const obj: RigDef = { parts: { torso: { src: "b.png", w: 100, h: 140, pivot: [50, 126], alt: { blink: "bb.png" } }, armL: { parent: "torso", at: [10, 70], hose: { len: 40, width: 6, color: "#000", endR: 7 } } } };
    expect(validateRig(obj)).toEqual([]);
    const items = drawList(obj, evaluate(obj, [], 0, { x: 0, y: 0, height: 100 }).pose, [1, 0, 0, 1, 0, 0]);
    expect(items.find((i) => i.name === "armL")?.kind).toBe("hose");
    const blinks = Array.from({ length: 300 }, (_, i) => evaluate(obj, [], i / 30, { x: 0, y: 0, height: 100 }).pose.alt.torso).filter(Boolean);
    expect(blinks.length).toBeGreaterThan(2);
  });
});

describe("studio rig cut", () => {
  it("режет лист на части и угадывает роли по раскладке", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rig-"));
    writeFileSync(join(dir, "job.json"), JSON.stringify({ width: 1080, height: 1920, fps: 30 }));
    const W = 900, H = 600;
    const box = (x: number, y: number, w: number, h: number) => ({ input: { create: { width: w, height: h, channels: 4 as const, background: { r: 200, g: 120, b: 60, alpha: 1 } } }, left: x, top: y });
    await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([box(100, 20, 120, 110), box(300, 20, 120, 110), box(500, 20, 120, 110), // три головы
        box(380, 200, 140, 170), box(250, 200, 50, 150), box(600, 200, 50, 150), // туловище, руки
        box(360, 420, 60, 150), box(480, 420, 60, 150)]) // ноги
      .png().toFile(join(dir, "sheet.png"));
    const r = spawnSync(join(ROOT, "node_modules/.bin/tsx"), [join(ROOT, "studio/bin/rig.ts"), "cut", "sheet.png", "--name", "box", "--job", dir], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(readFileSync(join(dir, "public/rig/box/rig.json"), "utf8")) as RigDef;
    expect(Object.keys(out.parts).sort()).toEqual(["armL", "armR", "head", "legL", "legR", "torso"]);
    expect(out.parts.head.alt).toEqual({ blink: "rig/box/head-blink.png", talk: "rig/box/head-talk.png" });
    expect(existsSync(join(dir, "public/rig/box/legR.png"))).toBe(true);
    const c = spawnSync(join(ROOT, "node_modules/.bin/tsx"), [join(ROOT, "studio/bin/rig.ts"), "check", "public/rig/box/rig.json", "--job", dir], { encoding: "utf8" });
    expect(c.status, c.stderr).toBe(0);
    expect(existsSync(join(dir, "out/rig-box-check.png"))).toBe(true);
  }, 30000);
});
