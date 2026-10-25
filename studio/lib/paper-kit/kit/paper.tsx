// Бумажная основа: детерминированный шум, рваные края, дрожание стоп-моушена, фильтры
// тени/зерна/края, вход и уход по спецификации плана. Всё зависит только от кадра и seed —
// рендер в несколько вкладок даёт одинаковую картинку. Своих вкусовых чисел у кита нет:
// их передаёт вызывающий.
import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { motionAt, type MotionOffset } from "../timeline/sample";
import type { ResolvedMotion } from "../timeline/types";

export const rand = (seed: number): number => {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};
export const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 100000;
};

// Стоп-моушен: бумажка чуть смещается раз в step кадров, как в покадровой съёмке.
// Все параметры обязательны: у кита своих чисел нет. seed — уже с сидом серии внутри
// (вызывающий смешивает сид серии с адресом детали).
export const useJitter = (seed: number, amp: number, rotAmp: number, step: number) => {
  const frame = useCurrentFrame();
  const k = Math.floor(frame / Math.max(1, step));
  return {
    dx: (rand(seed + k * 7.1) - 0.5) * 2 * amp,
    dy: (rand(seed + k * 3.7 + 11) - 0.5) * 2 * amp,
    rot: (rand(seed + k * 5.3 + 29) - 0.5) * 2 * rotAmp,
  };
};

// Вход или уход по разрешённой спецификации плана (ResolvedMotion): смещение позы в
// текущем кадре. Та же функция, что у кадра плана (timeline/sample.ts motionAt), —
// нарисованное совпадает с проверенным страховкой.
export const useMotion = (spec: ResolvedMotion, phase: "enter" | "exit"): MotionOffset => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return motionAt(spec, frame, fps, phase);
};

// Рваный прямоугольник: точки по периметру с шумом. amp — глубина надрыва.
export const tornRect = (w: number, h: number, seed: number, amp = 4, step = 14): string => {
  const pts: Array<[number, number]> = [];
  let i = 0;
  const j = () => (rand(seed + i++ * 1.37) - 0.5) * 2 * amp;
  for (let x = 0; x < w; x += step) pts.push([x, j()]);
  for (let y = 0; y < h; y += step) pts.push([w + j(), y]);
  for (let x = w; x > 0; x -= step) pts.push([x, h + j()]);
  for (let y = h; y > 0; y -= step) pts.push([j(), y]);
  return "M" + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L") + "Z";
};

// Зубчатый край снизу, как у чека.
export const receiptRect = (w: number, h: number, tooth = 12): string => {
  let d = `M0,0L${w},0L${w},${h}`;
  for (let x = w; x > 0; x -= tooth) d += `L${x - tooth / 2},${h - tooth * 0.6}L${Math.max(0, x - tooth)},${h}`;
  return d + "Z";
};

// Общие фильтры: тень бумаги, зерно и неровный край. Кладутся один раз в корень сцены.
// Рисунки кита ссылаются на них по id (shadow, shadow-soft, grain, edge); значения — из
// style серии. Нулевой ход (shadow "none", grain 0, edge 0) — фильтры-пустышки: рисунок
// как есть (ссылка на несуществующий фильтр в SVG прячет элемент, поэтому они есть всегда).
export type PaperLook = { shadow: "none" | "soft" | "hard"; grain: number; edge: number; seed: number };
// Словарь именованных теней style.shadow (их числа — часть словаря, как позы жестов):
// soft — мягкая тень бумаги, hard — та же тень с резким краем (без размытия).
// big — для листов и героев, small — для мелких деталей.
export const SHADOW_LOOK = {
  soft: { big: { dy: 7, blur: 6, opacity: 0.45 }, small: { dy: 4, blur: 4, opacity: 0.3 } },
  hard: { big: { dy: 7, blur: 0, opacity: 0.45 }, small: { dy: 4, blur: 0, opacity: 0.3 } },
} as const;
// Условности фильтров (не вкус серии): масштаб шума бумажного волокна, длина волны края и
// предел неровности края (страховка: при edge 1 текст ещё читается).
export const PAPER_FILTER = { grainFrequency: 0.85, edgeFrequency: 0.04, edgeMaxPx: 12 } as const;

const Identity: React.FC<{ id: string }> = ({ id }) => (
  <filter id={id}><feOffset dx="0" dy="0" /></filter>
);
export const PaperDefs: React.FC<{ look: PaperLook }> = ({ look }) => {
  const sh = look.shadow === "none" ? null : SHADOW_LOOK[look.shadow];
  const seed = Math.abs(Math.round(look.seed)) % 100000;
  const drop = (id: string, s: { dy: number; blur: number; opacity: number }) => (
    <filter id={id} x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy={s.dy} stdDeviation={s.blur} floodColor="#000" floodOpacity={s.opacity} />
    </filter>
  );
  return (
    <defs>
      {sh ? drop("shadow", sh.big) : <Identity id="shadow" />}
      {sh ? drop("shadow-soft", sh.small) : <Identity id="shadow-soft" />}
      {look.grain > 0 ? (
        <filter id="grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency={PAPER_FILTER.grainFrequency} numOctaves="2" seed={seed} result="n" />
          <feColorMatrix in="n" type="matrix" values={`0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ${look.grain} 0`} result="a" />
          <feComposite in="a" in2="SourceGraphic" operator="in" result="g" />
          <feMerge><feMergeNode in="SourceGraphic" /><feMergeNode in="g" /></feMerge>
        </filter>
      ) : <Identity id="grain" />}
      {look.edge > 0 ? (
        <filter id="edge" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency={PAPER_FILTER.edgeFrequency} numOctaves="2" seed={seed + 1} result="e" />
          <feDisplacementMap in="SourceGraphic" in2="e" scale={look.edge * PAPER_FILTER.edgeMaxPx} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      ) : <Identity id="edge" />}
    </defs>
  );
};

// Рваный кружок радиуса r (рисуется от (0,0) вправо-вниз): солнце, голова куклы, запасной значок.
export const circleTorn = (r: number, seed: number): string => {
  const n = 40;
  let d = "";
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r + (rand(seed + i) - 0.5) * 3;
    d += `${i ? "L" : "M"}${(r + rr * Math.cos(a)).toFixed(1)},${(r + rr * Math.sin(a)).toFixed(1)}`;
  }
  return d + "Z";
};

// Бумажный лист: прямоугольник (или чек с зубцами) цвета fill, зерно и тень — общими
// фильтрами серии (PaperDefs), неровный край — фильтром edge. Значений по
// умолчанию нет: цвет даёт палитра серии.
export const Sheet: React.FC<{
  w: number; h: number; fill: string; receipt?: boolean; children?: React.ReactNode;
}> = ({ w, h, fill, receipt = false, children }) => (
  <g filter="url(#shadow)">
    {receipt ? <path d={receiptRect(w, h)} fill={fill} filter="url(#grain)" /> : <rect width={w} height={h} fill={fill} filter="url(#grain)" />}
    {children}
  </g>
);

// Кнопка-гвоздик в углу листа: шляпка цвета head на тени цвета shade.
export const Pin: React.FC<{ x: number; y: number; head: string; shade: string }> = ({ x, y, head, shade }) => (
  <g>
    <circle cx={x} cy={y + 2} r={7} fill={shade} opacity={0.3} />
    <circle cx={x} cy={y} r={6} fill={head} />
  </g>
);

// Обёртка детали: поза кадра (точка, масштаб, поворот, прозрачность) уже посчитана
// планом (timeline/sample.ts pose — с входом/уходом, дрожанием и страховкой). Своих
// значений по умолчанию нет.
export type PlacedPose = { x: number; y: number; scale: number; rotate: number; opacity: number };
export const Placed: React.FC<{ pose: PlacedPose; children: React.ReactNode }> = ({ pose, children }) => (
  <g opacity={pose.opacity} transform={`translate(${pose.x},${pose.y}) rotate(${pose.rotate}) scale(${pose.scale})`}>
    {children}
  </g>
);
