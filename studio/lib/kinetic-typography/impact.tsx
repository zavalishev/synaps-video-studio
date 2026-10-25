// Удар без прыжка: как сделать кульминацию самым плотным моментом ролика, не нарушая пол
// («без вжухов, пружин с перелётом и дрожи»). Всё — чистые функции кадра.
//   maskReveal(frame, at)      — слово/число открывается шторкой (clip-path), без прозрачности:
//                                 не «призрак», а твёрдый предмет, который выезжает из-под маски;
//   scaleStep(frame, at)       — короткая ступенька масштаба 0.9 → 1 за 4 кадра, ease-out, без перелёта;
//   flashAt(frame, at)         — непрозрачность вспышки света 0 → peak → 0 за 2–3 кадра (<Flash/>);
//   <RollNumber/>              — цифры прокручиваются по разрядам в окне (табличные). По умолчанию
//                                 (turns 0) старшие разряды стоят с первого кадра, крутятся только
//                                 settle младших: факт брифа (цена, зарплата) читается сразу; from —
//                                 с какого числа (продолжение прошлого бита); turns ≥ 1 — полные
//                                 обороты (счётчик роста, не факт). Соседние цифры в окно не лезут;
//   holdFrames(fps)            — сколько держать цифру после удара (≥ 1 с).
// Тексты без плашки — тоже приёмы, а не только «таблетка»:
//   typeOnImage(color)         — крупный текст прямо на картинке: мягкая тень без обводки;
//   markerHighlight(color)     — выделение маркером под словом (полоса за нижней половиной букв).
import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { reportGuard } from "../layout";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const out = Easing.out(Easing.cubic);

export const maskReveal = (frame: number, at: number, o: { dur?: number; dir?: "up" | "down" | "left" | "right" } = {}): React.CSSProperties => {
  const k = interpolate(frame, [at, at + (o.dur ?? 7)], [0, 1], { ...clamp, easing: out });
  const r = (1 - k) * 100;
  const inset = { up: `${r}% 0 0 0`, down: `0 0 ${r}% 0`, left: `0 ${r}% 0 0`, right: `0 0 0 ${r}%` }[o.dir ?? "up"];
  return { clipPath: `inset(${inset})` };
};

export const scaleStep = (frame: number, at: number, o: { from?: number; dur?: number } = {}): number =>
  interpolate(frame, [at, at + (o.dur ?? 4)], [o.from ?? 0.9, 1], { ...clamp, easing: out });

export const flashAt = (frame: number, at: number, o: { frames?: number; peak?: number } = {}): number => {
  const n = Math.max(2, o.frames ?? 3), peak = o.peak ?? 0.35;
  if (frame < at || frame > at + n) return 0;
  return interpolate(frame, [at, at + 1, at + n], [0, peak, 0], clamp);
};

// Вспышка света на весь кадр (или в коробке): белая/тёплая, 2–3 кадра, в кадр звука удара.
export const Flash: React.FC<{ at: number; frames?: number; peak?: number; color?: string; blend?: React.CSSProperties["mixBlendMode"] }> = ({ at, frames, peak, color = "#fff", blend = "screen" }) => {
  const f = useCurrentFrame();
  const o = flashAt(f, at, { frames, peak });
  if (o <= 0) return null;
  // Отметка для probe: скачок яркости на этих кадрах — нарочная вспышка, а не склейка.
  reportGuard({ id: "flash", kind: "note:flash", frame: f, amount: 0 });
  return <AbsoluteFill data-audit-skip style={{ background: color, opacity: o, mixBlendMode: blend, pointerEvents: "none" }} />;
};

export const holdFrames = (fps: number, sec = 1.2) => Math.round(fps * sec);

// Прокрутка цифр по разрядам: старшие разряды останавливаются раньше, младшие — позже.
// Факт брифа (цена, зарплата, дата) читается с первого кадра: по умолчанию крутятся только
// `settle` младших разрядов (от цифры `from` или от 0), старшие стоят. turns ≥ 1 — каждый
// разряд делает полные обороты: это счётчик роста, промежуточные числа — чужие («от 14 000»
// вместо «от 55 000»), поэтому пока цифры крутятся, пишется отметка note:roll — review спросит
// fact-unreadable, если так крутится число из брифа дольше 0.5 с.
export const RollNumber: React.FC<{
  value: number; start: number; dur?: number; fontFamily: string; fontWeight?: number | string; size: number; color: string;
  prefix?: string; suffix?: string; group?: boolean; stagger?: number; id?: string; style?: React.CSSProperties;
  from?: number; turns?: number; settle?: number;
}> = ({ value, start, dur = 18, fontFamily, fontWeight = 800, size, color, prefix = "", suffix = "", group = true, stagger = 3, id = "roll", style, from, turns = 0, settle = 2 }) => {
  const frame = useCurrentFrame();
  const fmt = (n: number) => (group ? new Intl.NumberFormat("ru-RU").format(Math.round(n)) : String(Math.round(n)));
  const txt = fmt(value);
  const chars = [...txt];
  const digitsIdx = chars.map((c, i) => (/\d/.test(c) ? i : -1)).filter((i) => i >= 0);
  // Цифры «откуда»: from, выровненный по младшим разрядам; без from — те же старшие, младшие от 0.
  const fromDigits = from !== undefined ? String(Math.round(Math.abs(from))).padStart(digitsIdx.length, "0").slice(-digitsIdx.length) : null;
  // Окно ровно в высоту строки, цифры в колонке с шагом окна: соседняя цифра в окно не попадает.
  const pad = 0.15 * size, lh = size * 1.1, cell = lh + pad * 2;
  let rolling = false;
  const digits = chars.map((c, i) => {
    if (!/\d/.test(c)) return null;
    const order = digitsIdx.indexOf(i);
    const d = Number(c);
    const low = digitsIdx.length - order <= settle;
    const fd = fromDigits ? Number(fromDigits[order]) : turns > 0 || low ? 0 : d;
    const steps = ((d - fd + 10) % 10) + 10 * Math.max(0, Math.round(turns));
    const t0 = start + order * stagger;
    const k = interpolate(frame, [t0, t0 + dur], [0, 1], { ...clamp, easing: out });
    if (steps > 0 && k > 0 && k < 1) rolling = true;
    const pos = fd + steps * k;
    return { pos: frame >= t0 + dur ? d : pos % 10, moving: steps > 0 };
  });
  if (rolling) reportGuard({ id, kind: "note:roll", frame, amount: Math.round(value) });
  return (
    <div data-id={id} style={{ display: "inline-flex", alignItems: "flex-end", fontFamily, fontWeight, fontSize: size, lineHeight: `${lh}px`, color, fontVariantNumeric: "tabular-nums", fontFeatureSettings: "'tnum' 1", whiteSpace: "nowrap", ...style }}>
      {prefix ? <span>{prefix}</span> : null}
      {chars.map((c, i) => {
        const dg = digits[i];
        if (!dg) return <span key={i}>{c === " " ? " " : c}</span>;
        if (!dg.moving) return <span key={i}>{c}</span>;
        return (
          <span key={i} style={{ position: "relative", display: "inline-block", height: cell, margin: `${-pad}px 0`, overflow: "hidden", verticalAlign: "bottom" }}>
            <span style={{ visibility: "hidden", display: "block", padding: `${pad}px 0`, lineHeight: `${lh}px` }}>0</span>
            <span data-acting style={{ position: "absolute", left: 0, right: 0, top: 0, transform: `translateY(${-dg.pos * cell}px)`, display: "flex", flexDirection: "column" }}>
              {Array.from({ length: 11 }, (_, n) => <span key={n} style={{ height: cell, lineHeight: `${cell}px`, textAlign: "center" }}>{n % 10}</span>)}
            </span>
          </span>
        );
      })}
      {suffix ? <span>{suffix}</span> : null}
    </div>
  );
};

export const typeOnImage = (shadow = "rgba(0,0,0,.55)", size = 100): React.CSSProperties => ({
  textShadow: `0 ${Math.round(size * 0.04)}px ${Math.round(size * 0.18)}px ${shadow}, 0 0 ${Math.round(size * 0.5)}px ${shadow}`,
});

export const markerHighlight = (color: string, o: { from?: number; to?: number; skew?: number } = {}): React.CSSProperties => ({
  backgroundImage: `linear-gradient(transparent ${o.from ?? 52}%, ${color} ${o.from ?? 52}%, ${color} ${o.to ?? 92}%, transparent ${o.to ?? 92}%)`,
  padding: "0 0.12em", boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone",
});
