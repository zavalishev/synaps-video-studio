// Бумажная кукла: тело-бумажка (чек, ценник или лист), голова-кружок с лицом, руки и
// ноги-палочки. Начало координат — между ступнями.
//
// PuppetFigure — чистый рисунок: все числа (углы рук и ног, наклон головы, лицо, цвета)
// приходят готовыми. Puppet ниже берёт всё из плана (поза кадра, руки, лицо, походка,
// живость, призрак). Риг (размеры, рука, кисть) — один источник: kit/geometry.ts.
import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { Mood } from "../timeline/types";
import { MONO } from "./fonts";
import { circleTorn, rand, receiptRect, tornRect } from "./paper";
import { armEnd, ENERGY_UNIT, GAIT_LOOK, RIG, strideLen, WALK_LEG_DEG, type GaitStyle } from "./geometry";

export { rig, RIG } from "./geometry";
export type { Rig } from "./geometry";

const HEAD_R = RIG.head.r;

// ---------- ЦВЕТА ----------
export type PuppetColors = {
  limb: string; head: string; ink: string; eyeWhite: string; mouth: string; blush: string; sweat: string;
  bodyLine: string; button: string; tagInk: string;
  markA: string; markB: string; markBowB: string; cap: string; contact: string;
};
// Цвета куклы 0.4 — из палитры серии (style.palette): линии — ink, голова и белки — paper,
// рот, румянец и знаки — accent.
export const puppetColors = (p: { ink: string; paper: string; accent: string; highlight?: string; bg?: string }): PuppetColors => ({
  limb: p.ink, head: p.paper, ink: p.ink, eyeWhite: p.paper, mouth: p.accent, blush: p.accent, sweat: p.highlight ?? p.accent,
  bodyLine: p.ink, button: p.accent, tagInk: p.ink,
  markA: p.accent, markB: p.accent, markBowB: p.ink, cap: p.ink, contact: "#000",
});

// ---------- ЛИЦО ----------
// Эмоция (mood) — словарь форм лица (глаза, брови, рот), не времени. Параметры лица
// меняют эту форму; без них лицо рисуется формой эмоции как есть.
//   eyes −1..1: раскрытие глаз (−1 — закрыты, 0 — как в форме, 1 — вдвое шире);
//   gaze: куда смотрят зрачки — вектор длиной ≤ 1 (доля хода зрачка внутри глаза);
//   brow −1..1: наклон бровей (1 — внутренние концы вверх, как у «sad», на BROW_PX; −1 — вниз);
//   browRaise −1..1: брови выше/ниже на BROW_PX; mouth −1..1: улыбка (+) / грусть (−) вместо
//   рта формы; blush 0..1: румянец; sweat: капля пота.
// BROW_PX — единица, в которой меряются брови: наклон бровей «sad» у словаря форм.
export const BROW_PX = 10;
export type FaceParams = {
  eyes?: number; gaze?: { x: number; y: number }; brow?: number; browRaise?: number; mouth?: number; blush?: number; sweat?: boolean;
};
export type FaceSpec = { mood: Mood; blink: boolean; open: number; talkMin: number; params?: FaceParams };

export const Face: React.FC<{ face: FaceSpec; colors: PuppetColors }> = ({ face, colors: c }) => {
  const { mood, blink, open, talkMin, params: fp } = face;
  const ink = c.ink;
  const closed = fp?.eyes !== undefined && fp.eyes <= -1 + 1e-6;
  // Ход зрачка: у белого глаза — до края белка, у глаза-точки — на свой радиус.
  const gz = (max: number) => (fp?.gaze ? { x: fp.gaze.x * max, y: fp.gaze.y * max } : { x: 0, y: 0 });
  const eye = (x: number) => {
    let el: React.ReactElement;
    if (mood === "shocked") {
      const g = gz(12 - 5);
      el = <g key={x}><circle cx={x} cy={-6} r={12} fill={c.eyeWhite} stroke={ink} strokeWidth={3} /><circle cx={x + g.x} cy={-4 + g.y} r={5} fill={ink} /></g>;
    } else if (mood === "proud" || mood === "happy") {
      el = <path key={x} d={`M${x - 10},-2 Q${x},-14 ${x + 10},-2`} stroke={ink} strokeWidth={5} fill="none" strokeLinecap="round" />;
    } else if (blink || closed) {
      return <line key={x} x1={x - 8} y1={-4} x2={x + 8} y2={-4} stroke={ink} strokeWidth={4} strokeLinecap="round" />;
    } else {
      const look = mood === "thinking" ? 4 : 0;
      const g = gz(6);
      el = <circle key={x} cx={x + look + g.x} cy={-4 - look + g.y} r={6} fill={ink} />;
    }
    if (fp?.eyes === undefined || closed) return closed ? <line key={x} x1={x - 8} y1={-4} x2={x + 8} y2={-4} stroke={ink} strokeWidth={4} strokeLinecap="round" /> : el;
    const k = Math.max(0, 1 + fp.eyes);
    return <g key={x} transform={`translate(0,-4) scale(1,${k}) translate(0,4)`}>{el}</g>;
  };
  let brows: React.ReactNode = {
    neutral: null,
    happy: null,
    proud: <><path d="M-34,-30 L-12,-34" stroke={ink} strokeWidth={4} /><path d="M12,-34 L34,-30" stroke={ink} strokeWidth={4} /></>,
    sad: <><path d="M-34,-22 L-12,-32" stroke={ink} strokeWidth={4} /><path d="M12,-32 L34,-22" stroke={ink} strokeWidth={4} /></>,
    worried: <><path d="M-34,-24 L-12,-32" stroke={ink} strokeWidth={4} /><path d="M12,-32 L34,-24" stroke={ink} strokeWidth={4} /></>,
    shocked: <><path d="M-34,-34 Q-22,-44 -10,-36" stroke={ink} strokeWidth={4} fill="none" /><path d="M10,-36 Q22,-44 34,-34" stroke={ink} strokeWidth={4} fill="none" /></>,
    thinking: <><path d="M-34,-28 L-12,-28" stroke={ink} strokeWidth={4} /><path d="M12,-34 L34,-28" stroke={ink} strokeWidth={4} /></>,
  }[mood];
  if (fp && (fp.brow !== undefined || fp.browRaise !== undefined)) {
    const base = -28 - (fp.browRaise ?? 0) * BROW_PX;
    const tilt = (fp.brow ?? 0) * BROW_PX / 2;
    brows = <>
      <path d={`M-34,${base + tilt} L-12,${base - tilt}`} stroke={ink} strokeWidth={4} />
      <path d={`M12,${base - tilt} L34,${base + tilt}`} stroke={ink} strokeWidth={4} />
    </>;
  }
  let mouth: React.ReactNode = {
    neutral: <line x1={-14} y1={26} x2={14} y2={26} stroke={ink} strokeWidth={5} strokeLinecap="round" />,
    happy: <path d="M-24,16 Q0,46 24,16 Z" fill={c.mouth} stroke={ink} strokeWidth={4} strokeLinejoin="round" />,
    proud: <path d="M-18,22 Q2,36 20,18" stroke={ink} strokeWidth={5} fill="none" strokeLinecap="round" />,
    sad: <path d="M-18,32 Q0,18 18,32" stroke={ink} strokeWidth={5} fill="none" strokeLinecap="round" />,
    worried: <path d="M-18,28 Q-9,22 0,28 Q9,34 18,28" stroke={ink} strokeWidth={4} fill="none" strokeLinecap="round" />,
    shocked: <ellipse cx={0} cy={28} rx={11} ry={15} fill={c.mouth} stroke={ink} strokeWidth={4} />,
    thinking: <line x1={2} y1={28} x2={20} y2={24} stroke={ink} strokeWidth={5} strokeLinecap="round" />,
  }[mood];
  // Кривая рта из параметра: концы на месте, середина вниз (улыбка) или вверх.
  if (fp?.mouth !== undefined) mouth = <path d={`M-20,26 Q0,${26 + fp.mouth * 20} 20,26`} stroke={ink} strokeWidth={5} fill="none" strokeLinecap="round" />;
  // Говорит: рот открывается по громкости голоса.
  const talk = open > talkMin
    ? <ellipse cx={0} cy={26} rx={12 + open * 5} ry={3 + open * 15} fill={c.mouth} stroke={ink} strokeWidth={4} />
    : null;
  const blushOp = fp?.blush !== undefined ? fp.blush : mood === "happy" || mood === "proud" ? 0.5 : 0;
  const sweat = fp?.sweat !== undefined ? fp.sweat : mood === "worried";
  return (
    <g>
      {eye(-22)}{eye(22)}
      {brows}
      {talk ?? mouth}
      {blushOp > 0 && <><circle cx={-36} cy={14} r={9} fill={c.blush} opacity={blushOp} /><circle cx={36} cy={14} r={9} fill={c.blush} opacity={blushOp} /></>}
      {sweat && <path d="M44,-30 Q52,-14 44,-8 Q36,-14 44,-30 Z" fill={c.sweat} />}
    </g>
  );
};

// ---------- ТЕЛО И ЗНАК ----------
// look — словарь тел фазы A: "receipt" | "tag" | остальное — лист. (Фаза B: тело по описанию.)
const Body: React.FC<{ look?: string; color: string | undefined; seed: number; tagText?: React.ReactNode; colors: PuppetColors }> = ({ look, color, seed, tagText, colors: c }) => {
  const { w, h, top } = RIG.body;
  const fill = color;
  const lines = Array.from({ length: 8 }, (_, i) => (
    <g key={i}>
      <rect x={-w / 2 + 18} y={top + 26 + i * 27} width={50 + rand(seed + i) * 40} height={6} fill={c.bodyLine} opacity={0.6} />
      <rect x={w / 2 - 50} y={top + 26 + i * 27} width={30} height={6} fill={c.bodyLine} opacity={0.6} />
    </g>
  ));
  if (look === "receipt") {
    return (
      <g transform={`translate(${-w / 2},${top})`} filter="url(#shadow-soft)">
        <path d={receiptRect(w, h)} fill={fill} filter="url(#grain)" />
        <g transform={`translate(${w / 2},${-top})`}>{lines}</g>
        <circle cx={w / 2} cy={h * 0.55} r={8} fill={c.button} /><circle cx={w / 2} cy={h * 0.72} r={8} fill={c.button} />
      </g>
    );
  }
  if (look === "tag") {
    return (
      <g transform={`translate(${-w / 2},${top})`} filter="url(#shadow-soft)">
        <path d={`M24,0 L${w - 24},0 L${w},24 L${w},${h} L0,${h} L0,24 Z`} fill={fill} filter="url(#grain)" />
        <circle cx={w / 2} cy={26} r={9} fill={c.tagInk} opacity={0.75} />
        {tagText !== undefined && (
          <text x={w / 2} y={h * 0.5} textAnchor="middle" fontFamily={MONO} fontWeight={700} fontSize={22} fill={c.tagInk} opacity={0.7}>
            {tagText}
          </text>
        )}
        <rect x={30} y={h * 0.62} width={w - 60} height={5} fill={c.tagInk} opacity={0.35} />
        <rect x={30} y={h * 0.7} width={w - 90} height={5} fill={c.tagInk} opacity={0.35} />
      </g>
    );
  }
  return (
    <g transform={`translate(${-w / 2},${top})`} filter="url(#shadow-soft)">
      <path d={tornRect(w, h, seed, 3)} fill={fill} filter="url(#grain)" />
    </g>
  );
};

// mark — словарь знаков фазы A: "headband" | "cap" | "bow" | нет.
const Mark: React.FC<{ mark?: string; sway: number; colors: PuppetColors }> = ({ mark, sway, colors: c }) => {
  if (mark === "headband") return (
    <g>
      <path d={`M${-HEAD_R + 2},-30 Q0,-44 ${HEAD_R - 2},-30 L${HEAD_R - 4},-16 Q0,-30 ${-HEAD_R + 4},-16 Z`} fill={c.markA} />
      <g transform={`translate(${HEAD_R - 6},-24) rotate(${sway * 14})`}>
        <path d="M0,0 L30,-12 L26,10 Z" fill={c.markA} />
        <path d="M0,2 L28,14 L18,26 Z" fill={c.markB} />
      </g>
    </g>
  );
  if (mark === "cap") return (
    <g>
      <path d={`M${-HEAD_R + 4},-28 Q0,-${HEAD_R + 28} ${HEAD_R - 4},-28 Z`} fill={c.cap} />
      <path d={`M${HEAD_R - 14},-30 L${HEAD_R + 38},-26 L${HEAD_R - 10},-18 Z`} fill={c.cap} />
    </g>
  );
  if (mark === "bow") return (
    <g transform={`translate(${HEAD_R - 18},${-HEAD_R + 8}) rotate(${sway * 8})`}>
      <path d="M0,0 L-24,-16 L-24,16 Z M0,0 L24,-16 L24,16 Z" fill={c.markA} /><circle r={7} fill={c.markBowB} />
    </g>
  );
  return null;
};

// ---------- РИСУНОК ----------
export type PuppetFigureProps = {
  x: number; y: number; rot: number; scale: number;        // точка между ступнями на сцене, поворот, масштаб
  style?: React.CSSProperties;                              // прозрачность призрака и т.п.
  contact: number;                                          // непрозрачность тени под ногами (0 — нет)
  sy: number;                                               // сжатие по вертикали (1 — нет)
  legs: [number, number];                                   // углы ног от вертикали, градусы
  arms: [number, number];                                   // углы рук [левая, правая] от вертикали вниз, наружу +
  breathe: number;                                          // масштаб тела по вертикали
  headY: number; headTilt: number;                          // центр головы (y рига) и наклон, градусы
  facing: 1 | -1 | 0;                                       // куда носки (0 — к зрителю)
  face: FaceSpec;
  markSway: number;
  look?: string; mark?: string; color?: string; seed: number; tagText?: React.ReactNode;
  colors: PuppetColors;
};

export const PuppetFigure: React.FC<PuppetFigureProps> = (p) => {
  const c = p.colors;
  const arm = (side: -1 | 1, deg: number) => {
    const sx = side * RIG.shoulder.x, sy = RIG.shoulder.y;
    const { x: hx, y: hy } = armEnd(side, deg);
    return (
      <g key={side}>
        <line x1={sx} y1={sy} x2={hx} y2={hy} stroke={c.limb} strokeWidth={RIG.limb} strokeLinecap="round" />
        <circle cx={hx} cy={hy} r={RIG.hand} fill={c.head} stroke={c.limb} strokeWidth={3} />
      </g>
    );
  };
  const { hip, leg: L, foot } = RIG;
  const leg = (side: -1 | 1, deg: number) => (
    <g key={side} transform={`translate(${side * hip.x},${hip.y}) rotate(${deg})`}>
      <line x1={0} y1={0} x2={side * L.endDx} y2={L.len} stroke={c.limb} strokeWidth={L.width} strokeLinecap="round" />
      <ellipse cx={side * L.endDx + p.facing * foot.dx} cy={foot.y} rx={foot.rx} ry={foot.ry} fill={c.limb} />
    </g>
  );
  return (
    <g transform={`translate(${p.x},${p.y}) rotate(${p.rot}) scale(${p.scale})`} style={p.style}>
      {p.contact > 0 && <ellipse cx={0} cy={RIG.shadow.cy} rx={RIG.shadow.rx} ry={RIG.shadow.ry} fill={c.contact} opacity={p.contact} />}
      <g transform={`scale(1,${p.sy})`}>
        {leg(-1, p.legs[0])}{leg(1, p.legs[1])}
        {arm(-1, p.arms[0])}
        <g transform={`scale(1,${p.breathe})`} style={{ transformOrigin: "0px -240px" }}>
          <Body look={p.look} color={p.color} seed={p.seed} tagText={p.tagText} colors={c} />
        </g>
        {arm(1, p.arms[1])}
        <g transform={`translate(0,${p.headY}) rotate(${p.headTilt})`} filter="url(#shadow-soft)">
          <path transform={`translate(${-HEAD_R},${-HEAD_R})`} d={circleTorn(HEAD_R, p.seed)} fill={c.head} filter="url(#grain)" />
          <Face face={p.face} colors={c} />
          <Mark mark={p.mark} sway={p.markSway} colors={c} />
        </g>
      </g>
    </g>
  );
};

// ---------- КУКЛА 0.4 ----------
// Всё решено планом: поза кадра (точка, масштаб, поворот, прозрачность — с реакциями,
// дрожанием, призраком и страховкой — timeline/sample.ts pose), углы рук (жест-поза,
// pointAt, ключи рук), куда смотрит. Здесь — только то, что выводится из этих чисел:
//   шаги — из скорости по x: фаза ноги = пройденный путь / длина шага (ноги не скользят),
//     размах ног — геометрия рига (шаг = длина ноги -> ±WALK_LEG_DEG), таз опускается ровно
//     настолько, чтобы ступни остались на полу; жест рук во время шага не отменяется;
//   gait.energy — размах встречного маха рук (1 = как ноги), gait.style — словарь наклона
//     корпуса (GAIT_LOOK); нет gait — руки держат свою позу;
//   energy — живость стоя (дыхание, покачивание знака, моргание, кивок при речи) в единицах
//     ENERGY_UNIT; нет = 0 — кукла стоит, не моргает;
//   рот — громкость голоса в окнах talking и face.open (что больше).
export type PuppetPlanProps = {
  x: number; y: number; scale: number; rotate: number; opacity: number;
  vx: number;                                   // скорость по x, px сцены за кадр (дорожка + вход/уход, без дрожания)
  stepX: number;                                // x той же дорожки — по нему фаза шага
  facing: 1 | -1 | 0; arms: [number, number];
  mood?: Mood; face?: FaceParams & { open?: number; tilt?: number };
  talk: number;                                 // громкость голоса 0..1 в окнах talking (иначе 0)
  energy: number; gait?: { style: GaitStyle; energy: number };
  look?: string; mark?: string; color?: string; label?: string; seed: number;
  colors: PuppetColors; contact: number;
};

export const Puppet: React.FC<PuppetPlanProps> = (p) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const moving = Math.abs(p.vx) > 1e-3;
  const stride = strideLen(p.scale);
  // Фаза шага по пройденному пути: полный цикл ног — два шага.
  const phase = (Math.PI * p.stepX) / Math.max(1e-6, stride);
  const legDeg = moving ? WALK_LEG_DEG * Math.sin(phase) : 0;
  const drop = moving ? RIG.leg.len * (1 - Math.cos((legDeg * Math.PI) / 180)) : 0;
  const swing = moving && p.gait ? legDeg * p.gait.energy : 0;
  const lean = moving && p.gait ? GAIT_LOOK[p.gait.style].lean * (p.facing || 1) : 0;
  const e = p.energy;
  const breathe = 1 + Math.sin((2 * Math.PI * t) / ENERGY_UNIT.breathe.period + p.seed) * ENERGY_UNIT.breathe.amp * e;
  const sway = Math.sin((2 * Math.PI * t) / ENERGY_UNIT.sway.period + p.seed) * ENERGY_UNIT.sway.amp * e;
  const blink = e > 0 && ((t + (p.seed % 100) / 10) % ENERGY_UNIT.blink.period) < ENERGY_UNIT.blink.dur;
  const open = Math.max(p.talk, p.face?.open ?? 0);
  const nod = open * ENERGY_UNIT.nod * e;
  const fp: FaceParams | undefined = p.face
    ? { eyes: p.face.eyes, gaze: p.face.gaze, brow: p.face.brow, browRaise: p.face.browRaise, mouth: p.face.mouth, blush: p.face.blush, sweat: p.face.sweat }
    : undefined;
  return (
    <g opacity={p.opacity}>
      <PuppetFigure
        x={p.x} y={p.y + drop * p.scale} rot={p.rotate + lean} scale={p.scale}
        contact={p.contact} sy={1} legs={[legDeg, -legDeg]} arms={[p.arms[0] - swing, p.arms[1] + swing]} breathe={breathe}
        headY={RIG.head.y + nod} headTilt={p.face?.tilt ?? 0} facing={p.facing}
        face={{ mood: p.mood ?? "neutral", blink, open, talkMin: 0, params: fp }}
        markSway={sway} look={p.look} mark={p.mark} color={p.color} seed={p.seed} tagText={p.label}
        colors={p.colors}
      />
    </g>
  );
};
