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

  it("при ходьбе опорная стопа не скользит по земле, а шаг выше земли не уходит", () => {
    const shin = { src: "s.png", w: 30, h: 60, pivot: [15, 4] as [number, number] };
    const variants: RigDef[] = [
      { ...rig, view: "side" },
      { ...rig, view: "front" },
      { ...rig, view: "side", parts: { ...rig.parts, legL: { ...rig.parts.legL, h: 50 }, legR: { ...rig.parts.legR, h: 50 },
        shinL: { ...shin, parent: "legL", at: [17, 46] }, shinR: { ...shin, parent: "legR", at: [17, 46] } } },
    ];
    for (const r of variants) {
      const rest = restBounds(r);
      const acts = [{ do: "walk" as const, at: 0, to: [2500, 1600] as [number, number] }];
      const o = { x: 500, y: 1600, height: 800 };
      const foot = (t: number, leg: "L" | "R") => {
        const st = evaluate(r, acts, t, o);
        const items = drawList(r, st.pose, rootMatrix(r, rest, st.x, st.y, 800, st.pose));
        const name = r.parts[`shin${leg}`] ? `shin${leg}` : `leg${leg}`;
        const it = items.find((i) => i.name === name)!;
        if (it.kind !== "img") throw new Error("img");
        return apply(it.m, [r.parts[name].pivot![0], r.parts[name].h! * 0.94 + r.parts[name].pivot![1] * 0.06]);
      };
      // Середина пути (ровная скорость, тело ~16 px/кадр): на каждом кадре одна из стоп стоит.
      // Допуск — кадр смены ноги (одна ставится, другая отрывается): там обе чуть движутся.
      const mins: number[] = [];
      let lowest = -Infinity;
      for (let t = 1.0; t < 2.0; t += 1 / 30) {
        mins.push(Math.min(...(["L", "R"] as const).map((s) => Math.abs(foot(t + 1 / 30, s)[0] - foot(t, s)[0]))));
        for (const s of ["L", "R"] as const) lowest = Math.max(lowest, foot(t, s)[1]);
      }
      const calm = mins.filter((v) => v < 1.5).length / mins.length;
      expect(calm, `${r.view}: доля кадров без скольжения`).toBeGreaterThan(0.8);
      expect(Math.max(...mins), `${r.view}: худший кадр`).toBeLessThan(4);
      expect(lowest, r.view).toBeLessThan(1600 + 8); // стопа не проваливается под землю
    }
  });

  it("на старте и остановке стопа не едет по полу, а ноги не дёргаются после шага", () => {
    const shin = { src: "s.png", w: 30, h: 60, pivot: [15, 4] as [number, number] };
    const variants: RigDef[] = [
      { ...rig, view: "front" },
      { ...rig, view: "side", parts: { ...rig.parts, legL: { ...rig.parts.legL, h: 50 }, legR: { ...rig.parts.legR, h: 50 },
        shinL: { ...shin, parent: "legL", at: [17, 46] }, shinR: { ...shin, parent: "legR", at: [17, 46] } } },
    ];
    // Пути не кратны шагу: шаг сам подгоняется под путь.
    for (const r of variants) for (const tx of [1300, 1170, 640]) {
      const rest = restBounds(r);
      const acts = [{ do: "walk" as const, at: 0.5, to: [tx, 1600] as [number, number] }];
      const o = { x: 500, y: 1600, height: 800 };
      // Конец пути — первый кадр, где герой уже в цели (скорость считается от длины ноги).
      let end = 0.5;
      while (end < 30 && evaluate(r, acts, end, o).x !== tx) end += 1 / 120;
      const feet = (t: number) => {
        const st = evaluate(r, acts, t, o);
        const items = drawList(r, st.pose, rootMatrix(r, rest, st.x, st.y, 800, st.pose));
        return (["L", "R"] as const).map((leg) => {
          const name = r.parts[`shin${leg}`] ? `shin${leg}` : `leg${leg}`;
          const it = items.find((i) => i.name === name)!;
          return apply(it.m, [r.parts[name].pivot![0], r.parts[name].h! * 0.94 + r.parts[name].pivot![1] * 0.06]);
        });
      };
      const label = `${r.view} → ${tx}`;
      for (const [t0, t1] of [[0.4, 0.8], [end - 0.3, end + 0.5]]) {
        let worst = 0;
        for (let t = t0; t < t1; t += 1 / 30) {
          const a = feet(t), b = feet(t + 1 / 30);
          worst = Math.max(worst, Math.min(...a.map((q, i) => Math.abs(b[i][0] - q[0]))));
        }
        expect(worst, `${label}: опорная стопа на ${t0.toFixed(1)}–${t1.toFixed(1)} с`).toBeLessThan(4); // как в середине пути: допуск — кадр смены ноги
      }
      // В конце пути тело уже тормозит: ни одна нога не дёргается и не «прыгает» в позу покоя.
      let jump = 0;
      for (let t = end - 1 / 30; t < end + 0.5; t += 1 / 30) {
        const a = feet(t), b = feet(t + 1 / 30);
        jump = Math.max(jump, ...a.map((q, i) => Math.hypot(b[i][0] - q[0], b[i][1] - q[1])));
      }
      expect(jump, `${label}: рывок ноги при остановке`).toBeLessThan(10); // «прыжок» в позу покоя — это 100+ px
      // После остановки стопы стоят так же, как в покое до шага (никакой ноги, оставшейся в шаге).
      const gap = (t: number) => { const [l, rr] = feet(t); return l[0] - rr[0]; };
      expect(Math.abs(gap(end + 0.6) - gap(0.2)), `${label}: стопы как в покое`).toBeLessThan(0.02 * 800);
    }
  });

  it("в профиль — короткий частый шаг: ~1,6–1,8 шага в секунду, шаг ~0,7 ноги, руки отстают, бёдра качаются по шагу, корпус доигрывает", () => {
    const shin = { src: "s.png", w: 30, h: 60, pivot: [15, 4] as [number, number] };
    const r: RigDef = { ...rig, view: "side", parts: { ...rig.parts, legL: { ...rig.parts.legL, h: 50 }, legR: { ...rig.parts.legR, h: 50 },
      shinL: { ...shin, parent: "legL", at: [17, 46] }, shinR: { ...shin, parent: "legR", at: [17, 46] } } };
    const o = { x: 500, y: 1600, height: 800 };
    const acts = [{ do: "walk" as const, at: 0, to: [2500, 1600] as [number, number] }];
    let end = 0;
    while (evaluate(r, acts, end, o).x !== 2500) end += 1 / 120;
    // Постановки стопы — стопа на экране перестала двигаться (была в переносе, встала на пол).
    const fps = 30, N = Math.floor(end * fps), rest = restBounds(r);
    const feet = (t: number) => {
      const st = evaluate(r, acts, t, o);
      const items = drawList(r, st.pose, rootMatrix(r, rest, st.x, st.y, 800, st.pose));
      return (["shinL", "shinR"] as const).map((n) => { const it = items.find((i) => i.name === n)!; return apply(it.m, [15, 60 * 0.94 + 4 * 0.06])[0]; });
    };
    let contacts = 0;
    const still = [true, true], plantF: number[] = [];
    for (let f = 0; f < N; f++) {
      const a = feet(f / fps), b = feet((f + 1) / fps);
      [0, 1].forEach((i) => { const s = Math.abs(b[i] - a[i]) < 1.5; if (s && !still[i]) { contacts++; plantF.push(f); } still[i] = s; });
    }
    const steps = contacts / end;
    expect(steps, "шагов в секунду").toBeGreaterThan(1.4);
    expect(steps, "шагов в секунду").toBeLessThan(2.2);
    // Длина шага в длинах ноги: путь / число шагов.
    const L = 0.94 * (50 - 8) + 0.94 * (60 - 4), restH = restBounds(r).h, legPx = (L / restH) * 800;
    expect(2000 / contacts / legPx).toBeGreaterThan(0.55);
    expect(2000 / contacts / legPx).toBeLessThan(0.9);
    // Рука отстаёт от противоположной ноги на 2–3 кадра: крайнее положение руки позже крайнего положения ноги.
    const series = (n: string) => Array.from({ length: N }, (_, f) => evaluate(r, acts, f / fps, o).pose.ang[n] ?? 0);
    // Левая рука идёт вместе с правой ногой (противоположной) — сдвиг, при котором кривые совпадают лучше всего.
    const legS = series("legR"), armS = series("armL");
    const mid = Math.floor(N / 2) - 30, win = 60;
    const mean = (s: number[]) => s.slice(mid - 12, mid + win + 12).reduce((x, y) => x + y, 0) / (win + 24);
    const ml = mean(legS), ma = mean(armS);
    let lagF = 0, best = -Infinity;
    for (let s = -10; s <= 10; s++) {
      let c = 0;
      for (let f = mid; f < mid + win; f++) c += (armS[f] - ma) * (legS[f - s] - ml);
      if (c > best) { best = c; lagF = s; }
    }
    expect(Math.max(...armS.slice(mid, mid + win)) - Math.min(...armS.slice(mid, mid + win)), "размах руки").toBeGreaterThan(30);
    expect(lagF, "запаздывание руки, кадров").toBeGreaterThanOrEqual(1);
    expect(lagF, "запаздывание руки, кадров").toBeLessThanOrEqual(4);
    // Бёдра ниже всего на постановке стопы (нога дальше всего вынесена) и заметно поднимаются над стопой.
    const dyS = Array.from({ length: N + 8 }, (_, f) => evaluate(r, acts, f / fps, o).pose.dy);
    const offs = plantF.filter((f) => f > 0.3 * N && f < 0.7 * N).map((c) => {
      let b = c - 3; for (let f = c - 3; f <= c + 3; f++) if (dyS[f] > dyS[b]) b = f; return b - c;
    });
    expect(offs.length).toBeGreaterThan(2);
    expect(Math.max(...offs.map(Math.abs)), "бёдра ниже всего у постановки, кадров").toBeLessThanOrEqual(2);
    expect(Math.max(...dyS.slice(mid, mid + 20)) - Math.min(...dyS.slice(mid, mid + 20)), "качание бёдер, px").toBeGreaterThan(3);
    // Доигрыш: через ~0,1 с после остановки корпус наклонён вперёд, через 0,7 с — снова как в покое.
    const torso = (t: number) => evaluate(r, acts, t, o).pose.ang.torso ?? 0;
    expect(torso(end + 0.11), "корпус по инерции вперёд").toBeGreaterThan(2);
    expect(Math.abs(torso(end + 0.7)), "корпус успокоился").toBeLessThan(0.01);
  });

  it("ходьба без телепортов: цепочка walk внахлёст, по диагонали, после бега; герой без ног не дёргается", () => {
    const shin = { src: "s.png", w: 30, h: 60, pivot: [15, 4] as [number, number] };
    const side: RigDef = { ...rig, view: "side", parts: { ...rig.parts, legL: { ...rig.parts.legL, h: 50 }, legR: { ...rig.parts.legR, h: 50 },
      shinL: { ...shin, parent: "legL", at: [17, 46] }, shinR: { ...shin, parent: "legR", at: [17, 46] } } };
    const o = { x: 500, y: 1600, height: 800 };
    const maxStep = (r: RigDef, acts: Parameters<typeof evaluate>[1], from: number, to: number, f: (s: ReturnType<typeof evaluate>) => number) => {
      let m = 0;
      for (let t = from; t < to; t += 1 / 30) m = Math.max(m, Math.abs(f(evaluate(r, acts, t + 1 / 30, o)) - f(evaluate(r, acts, t, o))));
      return m;
    };
    // Второй walk назначен раньше, чем кончится первый: герой доходит и идёт дальше, не перескакивая.
    const chain = [{ do: "walk" as const, at: 0, to: [1100, 1600] as [number, number] }, { do: "walk" as const, at: 1, to: [1800, 1600] as [number, number] }];
    for (const r of [side, { ...rig, view: "front" as const }]) expect(maxStep(r, chain, 0, 8, (s) => s.x), `${r.view}: шаг корня за кадр`).toBeLessThan(0.05 * 800);
    // Добежал — сразу пошёл дальше: корпус не обрывает доигрыш скачком.
    let runEnd = 0; const run1 = [{ do: "run" as const, at: 0, to: [1500, 1600] as [number, number] }];
    while (evaluate(side, run1, runEnd, o).x !== 1500) runEnd += 1 / 120;
    const runWalk = [...run1, { do: "walk" as const, at: runEnd + 0.12, to: [2200, 1600] as [number, number] }];
    expect(maxStep(side, runWalk, runEnd - 0.2, runEnd + 0.6, (s) => s.pose.ang.torso ?? 0), "скачок корпуса, градусов за кадр").toBeLessThan(2.5);
    // По диагонали опорная стопа стоит, как и по прямой.
    const rest = restBounds(side), diag = [{ do: "walk" as const, at: 0, to: [1700, 1100] as [number, number] }];
    const foot = (t: number) => { const st = evaluate(side, diag, t, o); const items = drawList(side, st.pose, rootMatrix(side, rest, st.x, st.y, 800, st.pose));
      return (["shinL", "shinR"] as const).map((n) => apply(items.find((i) => i.name === n)!.m, [15, 60 * 0.94 + 4 * 0.06])); };
    const mins: number[] = [];
    for (let t = 0.8; t < 2; t += 1 / 30) { const a = foot(t), b = foot(t + 1 / 30); mins.push(Math.min(...a.map((q, i) => Math.abs(b[i][0] - q[0])))); }
    expect(mins.filter((v) => v < 1.5).length / mins.length, "по диагонали: доля кадров без скольжения").toBeGreaterThan(0.8);
    // Герой без ног (призрак, бюст с руками): руки при ходьбе качаются плавно, а не дёргаются.
    const legless: RigDef = { name: "g", view: "side", parts: { torso: rig.parts.torso, head: rig.parts.head, armL: rig.parts.armL, armR: rig.parts.armR } };
    const walk = [{ do: "walk" as const, at: 0, to: [2500, 1600] as [number, number] }];
    expect(maxStep(legless, walk, 1, 2, (s) => s.pose.ang.armL ?? 0), "рука без ног, градусов за кадр").toBeLessThan(5);
  });

  it("уши и хвост отстают от движения и при ходьбе влево (герой отражён)", () => {
    const o = { x: 1000, y: 0, height: 800 };
    // Угол уха на экране: в осях героя × facing (отражение меняет направление поворота).
    const r: RigDef = { ...rig, parts: { ...rig.parts, ear: { ...rig.parts.ear, follow: 1 } } };
    const screen = (to: number) => { const s = evaluate(r, [{ do: "run", at: 0, to: [to, 0] }], 1, o); return (s.pose.ang.ear ?? 0) * s.pose.facing; };
    const right = screen(2500), left = screen(-500);
    // Вправо — ухо отстаёт влево (против часовой, угол < 0); влево — зеркально.
    expect(right).toBeLessThan(-3);
    expect(left).toBeGreaterThan(3);
  });

  it("два героя моргают и дышат не синхронно; в профиль машет ближняя рука", () => {
    const head = { ...rig.parts.head, alt: { blink: "b.png" } };
    const blinks = (seed: string) => Array.from({ length: 600 }, (_, f) => f)
      .filter((f) => evaluate({ ...rig, parts: { ...rig.parts, head } }, [], f / 30, { x: 0, y: 0, height: 100, seed }).pose.alt.head === "blink");
    const a = blinks("медведь"), b = blinks("зерно");
    expect(a.length).toBeGreaterThan(2);
    expect(a.filter((f) => b.includes(f)).length / a.length).toBeLessThan(0.5);
    const side: RigDef = { ...rig, view: "side", parts: { ...rig.parts, armL: { ...rig.parts.armL, z: 3 }, armR: { ...rig.parts.armR, z: -1 } } };
    const p = evaluate(side, [{ do: "wave", at: 0 }], 0.8, { x: 0, y: 0, height: 100 }).pose;
    expect(Math.abs(p.ang.armL ?? 0)).toBeGreaterThan(120);
    expect(Math.abs(p.ang.armR ?? 0)).toBeLessThan(40);
  });

  it("разворот — переворот по ширине за доли секунды, а не мгновенное зеркало", () => {
    const acts = [{ do: "walk" as const, at: 0, to: [900, 0] as [number, number], dur: 1 }, { do: "walk" as const, at: 2, to: [100, 0] as [number, number], dur: 1 }];
    const vis = (t: number) => { const s = evaluate(rig, acts, t, { x: 500, y: 0, height: 100 }); return s.pose.facing * s.pose.sx; };
    expect(vis(1.9)).toBeGreaterThan(0.9);
    expect(Math.abs(vis(2 + 0.09))).toBeLessThan(0.2); // середина разворота — «ребро»
    expect(vis(2.3)).toBeLessThan(-0.9);
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

  it("рот по словам озвучки: открыт на слогах, закрыт в паузе между словами", () => {
    const words = { lines: [{ id: "a", start: 2, end: 4, words: [
      { text: "Привет", start: 2.0, end: 2.5 },   // 2 слога
      { text: "друзья", start: 3.2, end: 3.8 },   // пауза 0,7 с перед словом
    ] }] };
    const acts = talkFromWords(words);
    expect(acts[0]).toMatchObject({ do: "talk", at: 2, dur: 2 });
    const beats = (acts[0] as { beats: number[][] }).beats;
    [[0, 0.5, 2], [1.2, 1.8, 2]].forEach((b, i) => b.forEach((v, j) => expect(beats[i][j]).toBeCloseTo(v, 6)));
    const head = { ...rig.parts.head, alt: { talk: "t.png" } };
    const r: RigDef = { ...rig, parts: { ...rig.parts, head } };
    const open = (t: number) => evaluate(r, acts, t, { x: 0, y: 0, height: 100 }).pose.alt.head === "talk";
    // Пауза 2,5–3,2: рот закрыт все кадры.
    for (let t = 2.55; t < 3.18; t += 1 / 30) expect(open(t), `пауза ${t.toFixed(2)}`).toBe(false);
    // Двухсложное слово: открыл — прикрыл — снова открыл.
    const seq = Array.from({ length: 15 }, (_, i) => open(2 + i / 30));
    expect(seq[0]).toBe(true);
    expect(seq.filter((v, i) => i > 0 && v && !seq[i - 1]).length).toBe(1);
    // Без слов — старое поведение (рот хлопает по реплике).
    const plain = talkFromWords({ lines: [{ id: "x", start: 0, end: 2 }] });
    expect(Array.from({ length: 60 }, (_, i) => evaluate(r, plain, i / 30, { x: 0, y: 0, height: 100 }).pose.alt.head)).toContain("talk");
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

  it("--side: четыре части ног внизу → бёдра и голени, герой в профиль", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rig-side-"));
    writeFileSync(join(dir, "job.json"), JSON.stringify({ width: 1080, height: 1920, fps: 30 }));
    const box = (x: number, y: number, w: number, h: number) => ({ input: { create: { width: w, height: h, channels: 4 as const, background: { r: 90, g: 140, b: 200, alpha: 1 } } }, left: x, top: y });
    await sharp({ create: { width: 1000, height: 700, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([box(100, 20, 120, 110), box(300, 20, 120, 110), box(500, 20, 120, 110),
        box(420, 200, 140, 170), box(280, 200, 50, 150), box(650, 200, 50, 150),
        box(250, 460, 55, 100), box(380, 460, 50, 110), box(560, 460, 55, 100), box(690, 460, 50, 110)])
      .png().toFile(join(dir, "sheet.png"));
    const r = spawnSync(join(ROOT, "node_modules/.bin/tsx"), [join(ROOT, "studio/bin/rig.ts"), "cut", "sheet.png", "--name", "s", "--side", "--job", dir], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(readFileSync(join(dir, "public/rig/s/rig.json"), "utf8")) as RigDef;
    expect(out.view).toBe("side");
    expect(out.parts.shinL?.parent).toBe("legL");
    expect(out.parts.shinR?.parent).toBe("legR");
    expect(validateRig(out)).toEqual([]);
  }, 30000);
});
