// Скилл paper-2d: бумага, коллаж, аппликация. Тонкая обёртка над бумажным набором (paper-kit:
// куклы, значки предметов, декорации, фильтры бумаги) + примитивы сцены, которых в наборе
// нет: волны со строчкой, подвесы на нитках, покачивание на воде, луч, звёзды, надпись на
// рваной полоске. Всё рисуется в SVG и зависит только от кадра и сида.
//   import { PaperScene, TornShape, PaperCircle, PaperLabel, StitchedWave, Hanging, Bob, Beam,
//            Stars, PaperPuppet, PaperProp, PaperSet, paperTheme, PAPER_LOOKS } from "@studio/paper-2d";
// Вкус (палитра, фактура, амплитуды) — параметры директора; палитра — paperTheme(theme) из theme.json.
// Страховка: волны и задники шире кадра на свою амплитуду (края не открываются), маятник
// ограничен ±6° (больше — запись paper-swing в лог), покачивание без резких смен.
import React, { useLayoutEffect, useState } from "react";
import { cancelRender, continueRender, delayRender, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { EASE } from "../camera";
import { reportGuard } from "../layout";
import { circleTorn, hash, PaperDefs, rand, tornRect, type PaperLook } from "../paper-kit/kit/paper";
import { KitStyleProvider } from "../paper-kit/kit/style";
import { mix } from "../paper-kit/kit/color";
import { mixOk, oklch } from "../art-direction/theme";
import { Puppet, puppetColors } from "../paper-kit/kit/Puppet";
import { PropIcon, propColors } from "../paper-kit/kit/Items";
import { SetBack, SetFront } from "../paper-kit/sets/Sets";
import { GESTURE_ARMS, gestureArms } from "../paper-kit/kit/geometry";
import type { Mood, Palette } from "../paper-kit/timeline/types";

export type { PaperLook, Palette, Mood };
export { tornRect, circleTorn, rand, hash, mix };

// ---------- тема бумаги — из theme.json ролика ----------
// Палитра — роли (ink, paper, accent, highlight, positive, negative, bg), как у бумажного набора.
// Готовых палитр нет (были «ночное море», «крафт», «пастель» — и ролики студии походили друг на
// друга): роли выводятся из theme.palette; своё значение роли — одноимённым ключом в palette.
// Фактура — PAPER_LOOKS (без цвета).
export const PAPER_LOOKS = {
  soft: { shadow: "soft", grain: 0.22, edge: 0.35, seed: 7 },
  rough: { shadow: "soft", grain: 0.3, edge: 0.5, seed: 11 },
  clean: { shadow: "soft", grain: 0.18, edge: 0.3, seed: 3 },
} as const satisfies Record<string, PaperLook>;
export const paperTheme = (theme: { palette: { bg: string; ink: string; accent: string; [k: string]: string | undefined } }, look: PaperLook = PAPER_LOOKS.soft): { palette: Required<Palette>; look: PaperLook } => {
  const P = theme?.palette;
  if (!P?.bg || !P?.ink || !P?.accent) throw new Error("paperTheme: нужна theme.palette с bg, ink, accent (theme.json ролика)");
  const inkDark = oklch(P.ink).L < 0.55;
  return {
    palette: {
      bg: P.bg, ink: P.ink, accent: P.accent,
      paper: P.paper ?? P.surface ?? (inkDark ? mixOk(P.bg, "#ffffff", 0.78) : mixOk(P.bg, "#000000", 0.55)),
      highlight: P.highlight ?? P.accent2 ?? mixOk(P.accent, "#ffffff", 0.35),
      positive: P.positive ?? P.accent2 ?? P.accent, negative: P.negative ?? P.accent,
    },
    look,
  };
};

// ---------- сцена ----------
// Корень бумажной сцены: SVG на весь кадр, фильтры бумаги (#shadow, #shadow-soft, #grain,
// #edge) и палитра для набора. viewBox — координаты сцены: по умолчанию пиксели кадра;
// "kit" — 1080×1920 набора (куклы, декорации рассчитаны на него), вписанный с обрезкой.
export const PaperScene: React.FC<{
  palette: Palette; look: PaperLook; viewBox?: "frame" | "kit" | string; textCase?: "upper" | "sentence" | "asis";
  children?: React.ReactNode; style?: React.CSSProperties;
}> = ({ palette, look, viewBox = "frame", textCase = "asis", children, style }) => {
  const { width: W, height: H } = useVideoConfig();
  const vb = viewBox === "frame" ? `0 0 ${W} ${H}` : viewBox === "kit" ? "0 0 1080 1920" : viewBox;
  return (
    <KitStyleProvider style={{ palette, case: textCase, seed: look.seed }}>
      <svg width={W} height={H} viewBox={vb} preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, display: "block", ...style }}>
        <PaperDefs look={look} />
        {children}
      </svg>
    </KitStyleProvider>
  );
};

type Shadow = "big" | "small" | "none";
const shadowFilter = (s: Shadow | undefined) => (s === "none" ? undefined : s === "small" ? "url(#shadow-soft)" : "url(#shadow)");

// Рваный лист (x, y — левый верхний угол). edge — неровный край фильтром сцены.
export const TornShape: React.FC<{
  x: number; y: number; w: number; h: number; fill: string; seed?: number; amp?: number; rotate?: number; shadow?: Shadow; edge?: boolean;
  opacity?: number; children?: React.ReactNode;
}> = ({ x, y, w, h, fill, seed = 1, amp = 4, rotate = 0, shadow = "big", edge = false, opacity, children }) => (
  <g transform={`translate(${x},${y}) rotate(${rotate} ${w / 2} ${h / 2})`} filter={shadowFilter(shadow)} opacity={opacity}>
    <path d={tornRect(w, h, seed, amp)} fill={fill} filter={edge ? "url(#edge)" : "url(#grain)"} />
    {children}
  </g>
);

// Рваный кружок с центром (cx, cy): луна, солнце, голова, монета.
export const PaperCircle: React.FC<{ cx: number; cy: number; r: number; fill: string; seed?: number; shadow?: Shadow; opacity?: number }> = ({ cx, cy, r, fill, seed = 1, shadow = "big", opacity }) => (
  <g transform={`translate(${cx - r},${cy - r})`} filter={shadowFilter(shadow)} opacity={opacity}>
    <path d={circleTorn(r, seed)} fill={fill} filter="url(#grain)" />
  </g>
);

// Ширина строки в px настоящим шрифтом — после того, как шрифт загружен (кадр ждёт замер).
// Замер один раз на текст/шрифт/кегль, не на каждый кадр: ширина не «дышит».
const widthCache = new Map<string, number>();
export const useTextWidth = (text: string, font: string, size: number, weight: number | string = 400, letterSpacing = 0): number | null => {
  const key = `${text}|${font}|${size}|${weight}|${letterSpacing}`;
  const [w, setW] = useState<number | null>(() => widthCache.get(key) ?? null);
  const [handle] = useState(() => (widthCache.has(key) ? null : delayRender(`ширина «${text.slice(0, 20)}»`)));
  useLayoutEffect(() => {
    if (handle === null) return;
    const css = `${weight} ${size}px ${font}`;
    document.fonts.load(css, text).then(() => {
      const ctx = document.createElement("canvas").getContext("2d")!;
      ctx.font = css;
      const v = ctx.measureText(text).width + letterSpacing * Math.max(0, text.length - 1);
      widthCache.set(key, v);
      setW(v);
      continueRender(handle);
    }).catch((e) => cancelRender(e));
  }, [handle, key, font, size, text, weight, letterSpacing]);
  return w;
};

// Надпись на рваной полоске (центр x, y). Ширина полоски — по замеру текста настоящим
// шрифтом (или w).
export const PaperLabel: React.FC<{
  x: number; y: number; text: string; font: string; size: number; fill: string; ink: string; weight?: number; rotate?: number;
  w?: number; padX?: number; padY?: number; seed?: number; letterSpacing?: number; opacity?: number;
}> = ({ x, y, text, font, size, fill, ink, weight = 800, rotate = 0, w, padX = size * 0.55, padY = size * 0.32, seed = 5, letterSpacing = 0, opacity }) => {
  const measured = useTextWidth(text, font, size, weight, letterSpacing);
  const tw = w ?? (measured ?? text.length * size * 0.6) + padX * 2;
  const th = size * 1.15 + padY * 2;
  return (
    <g transform={`translate(${x},${y}) rotate(${rotate})`} opacity={opacity}>
      <g transform={`translate(${-tw / 2},${-th / 2})`} filter="url(#shadow-soft)">
        <path d={tornRect(tw, th, seed, 3, 12)} fill={fill} filter="url(#grain)" />
      </g>
      <text x={0} y={size * 0.36} textAnchor="middle" fontFamily={font} fontWeight={weight} fontSize={size} fill={ink} letterSpacing={letterSpacing}>{text}</text>
    </g>
  );
};

// ---------- волны со строчкой ----------
// Полоса моря от гребня y до низа кадра (bottom). Синусоида длиной волны wavelength и
// амплитудой amp; белая «строчка» stitch повторяет гребень на inset ниже. Слой покачивается
// влево-вправо на sway px с периодом period секунд (разные фазы у слоёв — параллакс без
// хаоса). Полоса шире кадра на amp + sway с каждой стороны — края не открываются.
export const StitchedWave: React.FC<{
  y: number; fill: string; amp?: number; wavelength?: number; phase?: number; sway?: number; period?: number; bottom?: number;
  stitch?: string; inset?: number; dash?: string; stitchWidth?: number; shadow?: Shadow; width?: number; id?: string;
}> = ({ y, fill, amp = 18, wavelength = 260, phase = 0, sway = 14, period = 5, bottom, stitch, inset = 22, dash = "16 12", stitchWidth = 4, shadow = "big", width, id = "wave" }) => {
  const f = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const vw = width ?? W;
  const t = f / fps;
  const dx = sway * Math.sin((2 * Math.PI * t) / period + phase);
  if (f === 0 && sway > 40) reportGuard({ id, kind: "paper-sway", frame: f, amount: sway, detail: "покачивание волны больше 40 px читается как «уезжает»" });
  const margin = amp + Math.abs(sway) + wavelength;
  const x0 = -margin, x1 = vw + margin;
  const k = (2 * Math.PI) / wavelength;
  const crest = (yy: number) => {
    let d = "";
    for (let x = x0; x <= x1; x += 12) d += `${d ? "L" : "M"}${x.toFixed(1)},${(yy + amp * Math.sin(k * x + phase * 3)).toFixed(1)}`;
    return d;
  };
  const yb = bottom ?? H + 40;
  return (
    <g transform={`translate(${dx},0)`} filter={shadowFilter(shadow)}>
      <path d={`${crest(y)} L${x1},${yb} L${x0},${yb} Z`} fill={fill} filter="url(#grain)" />
      {stitch ? <path d={crest(y + inset)} fill="none" stroke={stitch} strokeWidth={stitchWidth} strokeDasharray={dash} strokeLinecap="round" opacity={0.9} /> : null}
    </g>
  );
};

// ---------- подвес на нитке ----------
// Маятник: θ = A·sin(2πt/period + phase)·затухание; A ≤ 6°. drop — элемент «спускается»
// на нитке сверху (за dur кадров с мягкой остановкой, без перелёта) в кадр at.
// (x, y) — точка подвеса (часто y ≤ 0, над кадром), length — длина нитки до верха элемента.
export const Hanging: React.FC<{
  x: number; y: number; length: number; amp?: number; period?: number; phase?: number; decay?: number;
  drop?: { at: number; dur?: number; from?: number }; thread?: string; threadWidth?: number; id?: string; children?: React.ReactNode;
}> = ({ x, y, length, amp = 4, period = 3.2, phase = 0, decay, drop, thread = "rgba(255,255,255,.7)", threadWidth = 2, id = "hang", children }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (f === 0 && Math.abs(amp) > 6) reportGuard({ id, kind: "paper-swing", frame: f, amount: amp, detail: "маятник больше ±6° — дёргано" });
  const since = drop ? Math.max(0, f - drop.at) : f;
  const t = since / fps;
  const env = decay ? Math.exp(-t / decay) * 0.85 + 0.15 : 1;
  const theta = amp * env * Math.sin((2 * Math.PI * t) / period + phase);
  const p = drop ? interpolate(f, [drop.at, drop.at + (drop.dur ?? 24)], [0, 1], { easing: EASE, extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  const L = drop ? (drop.from ?? 0) + (length - (drop.from ?? 0)) * p : length;
  if (drop && f < drop.at) return null;
  return (
    <g transform={`translate(${x},${y}) rotate(${theta})`}>
      <line x1={0} y1={0} x2={0} y2={L} stroke={thread} strokeWidth={threadWidth} />
      <g transform={`translate(0,${L})`}>{children}</g>
    </g>
  );
};

// ---------- покачивание на воде ----------
// Вверх-вниз на lift px и наклон на tilt° с периодом period с; дети рисуются вокруг (0, 0).
export const Bob: React.FC<{ x: number; y: number; lift?: number; tilt?: number; period?: number; phase?: number; children?: React.ReactNode }> = ({ x, y, lift = 8, tilt = 3, period = 3, phase = 0, children }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = (2 * Math.PI * f) / (fps * period) + phase;
  return <g transform={`translate(${x},${y + lift * Math.sin(a)}) rotate(${tilt * Math.sin(a - 0.8)})`}>{children}</g>;
};

// ---------- луч ----------
// Луч маяка/фонаря из точки (x, y): треугольник с градиентом 0.9 → 0, режим screen, лёгкое
// размытие. angle(f) — направление в градусах (0 — вправо); по умолчанию медленный обход.
export const Beam: React.FC<{
  x: number; y: number; length: number; spread?: number; color?: string; angle?: number | ((f: number) => number); blur?: number; opacity?: number; id?: string;
}> = ({ x, y, length, spread = 16, color = "#fff6c8", angle, blur = 8, opacity = 0.8, id = "beam" }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = typeof angle === "function" ? angle(f) : angle ?? -20 + 30 * Math.sin((2 * Math.PI * f) / (fps * 8));
  const half = length * Math.tan((spread * Math.PI) / 360);
  return (
    <g transform={`translate(${x},${y}) rotate(${a})`} style={{ mixBlendMode: "screen" }} opacity={opacity}>
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={color} stopOpacity={0.9} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
        <filter id={`${id}-b`} x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation={blur} /></filter>
      </defs>
      <path d={`M0,0 L${length},${-half} L${length},${half} Z`} fill={`url(#${id}-g)`} filter={`url(#${id}-b)`} />
    </g>
  );
};

// ---------- звёзды ----------
// n звёзд в прямоугольнике (сид), мерцают плавно (не мигают): яркость 0.55..1 от кадра.
export const Stars: React.FC<{ n: number; box: { x: number; y: number; w: number; h: number }; fill: string; seed?: number; size?: [number, number]; twinkle?: number }> = ({ n, box, fill, seed = 1, size = [3, 7], twinkle = 0.45 }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <g>
      {Array.from({ length: n }, (_, i) => {
        const r = size[0] + rand(seed + i * 3.1) * (size[1] - size[0]);
        const x = box.x + rand(seed + i * 7.7) * box.w, y = box.y + rand(seed + i * 5.3) * box.h;
        const ph = rand(seed + i * 1.9) * Math.PI * 2;
        const per = 2 + rand(seed + i * 2.3) * 3;
        const o = 1 - twinkle * (0.5 + 0.5 * Math.sin((2 * Math.PI * f) / (fps * per) + ph));
        return <path key={i} transform={`translate(${x},${y}) scale(${r / 10})`} d="M0,-10 L2.6,-2.6 L10,0 L2.6,2.6 L0,10 L-2.6,2.6 L-10,0 L-2.6,-2.6 Z" fill={fill} opacity={o} />;
      })}
    </g>
  );
};

// Звезда-подвеска (пятиконечная бумажная) — для Hanging.
export const PaperStar: React.FC<{ r: number; fill: string; seed?: number }> = ({ r, fill, seed = 1 }) => {
  let d = "";
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = (i % 2 ? r * 0.45 : r) * (1 + (rand(seed + i) - 0.5) * 0.06);
    d += `${i ? "L" : "M"}${(rr * Math.cos(a)).toFixed(1)},${(r + rr * Math.sin(a)).toFixed(1)}`;
  }
  return <g filter="url(#shadow-soft)"><path d={d + "Z"} fill={fill} filter="url(#grain)" /></g>;
};

// ---------- кукла ----------
export const GESTURES = Object.keys(GESTURE_ARMS) as Array<keyof typeof GESTURE_ARMS>;
export const MOODS: Mood[] = ["neutral", "happy", "proud", "sad", "worried", "shocked", "thinking"];

// Бумажная кукла набора (рост ≈ 650 px при scale 1; начало — между ступнями).
// walk — идёт из from в to между кадрами start и end (шаги от пройденного пути — ноги не
// скользят); talk — громкость голоса 0..1 (рот); energy — живость (дыхание, моргание).
export const PaperPuppet: React.FC<{
  x: number; y: number; scale?: number; palette: Palette; mood?: Mood; gesture?: keyof typeof GESTURE_ARMS; arms?: [number, number];
  facing?: 1 | -1 | 0; talk?: number; energy?: number; look?: "sheet" | "receipt" | "tag"; mark?: "headband" | "cap" | "bow"; color?: string;
  label?: string; seed?: number; walk?: { to: number; start: number; end: number; style?: "stroll" | "walk" | "run" | "tiptoe" }; contact?: number;
  opacity?: number; rotate?: number;
}> = (p) => {
  const f = useCurrentFrame();
  const scale = p.scale ?? 1;
  const xAt = (fr: number) => (p.walk ? interpolate(fr, [p.walk.start, p.walk.end], [p.x, p.walk.to], { easing: EASE, extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : p.x);
  const x = xAt(f);
  const vx = x - xAt(f - 1);
  const facing = p.facing ?? (p.walk ? (Math.sign(p.walk.to - p.x) as 1 | -1) : 0);
  const arms = p.arms ?? gestureArms(p.gesture, facing);
  return (
    <Puppet
      x={x} y={p.y} scale={scale} rotate={p.rotate ?? 0} opacity={p.opacity ?? 1} vx={vx} stepX={x}
      facing={facing} arms={arms} mood={p.mood} talk={p.talk ?? 0} energy={p.energy ?? 0.8}
      gait={p.walk ? { style: p.walk.style ?? "walk", energy: 0.6 } : undefined}
      look={p.look === "sheet" ? undefined : p.look} mark={p.mark} color={p.color ?? p.palette.accent} label={p.label}
      seed={p.seed ?? 1} colors={puppetColors(p.palette)} contact={p.contact ?? 0.18}
    />
  );
};

// ---------- предметы ----------
export const PROP_NAMES = ["coin", "coins", "fish", "boat", "house", "bank", "car", "crown", "question", "bulb", "cross", "heart", "arrow-up", "arrow-down", "chest"] as const;
// Значок-предмет набора (размер ≈ 160–260 px при scale 1.5), центр в (x, y).
export const PaperProp: React.FC<{ name: (typeof PROP_NAMES)[number]; x: number; y: number; scale?: number; rotate?: number; palette: Palette; seed?: number; opacity?: number }> = ({ name, x, y, scale = 1.5, rotate = 0, palette, seed = 1, opacity }) => (
  <g transform={`translate(${x},${y}) rotate(${rotate}) scale(${scale})`} opacity={opacity}>
    <PropIcon name={name} seed={seed} c={propColors(palette)} />
  </g>
);

// ---------- декорации набора ----------
// Встроенные декорации набора (city, island, stall, board) в координатах 1080×1920 — кладите в
// <PaperScene viewBox="kit">. ambient — скорость своей жизни (облака, окна; 0 — неподвижно).
export const PaperSet: React.FC<{ set: "city" | "island" | "stall" | "board"; palette: Palette; layer?: "back" | "front"; ambient?: number; ground?: number; overscan?: number; seed?: number }> = ({ set, palette, layer = "back", ambient = 1, ground = 1450, overscan = 60, seed = 1 }) => {
  const f = useCurrentFrame();
  if (layer === "front") return <SetFront set={set} palette={palette} ground={ground} />;
  return (
    <g>
      <SetBack set={set} layer="far" palette={palette} os={overscan} ground={ground} t={f * ambient} seed={seed} />
      <SetBack set={set} layer="mid" palette={palette} os={overscan} ground={ground} t={f * ambient} seed={seed} />
    </g>
  );
};

// Параллакс слоя: смещение по x для глубины depth ∈ [0, 1] (0 — дальний, неподвижный) при
// сдвиге «камеры» camX px. Слой должен быть шире кадра на |camX|·depth с каждой стороны.
export const parallaxX = (camX: number, depth: number) => -camX * depth;
