// Декорации бумажного набора. Задник рисуется под героями, «передний план» (прилавок) — над ними.
//
// Встроенные декорации (city, island, stall, board) — пресеты формы, как позы кукол: что
// нарисовано и как оно может жить (облака плывут, окна зажигаются), а цвета — роли палитры
// серии (фон сцены bg/бумага, чернила, accent, highlight, positive): у декорации нет своих
// цветов. Пол — линия ground сцены (нет = линия рига), задник закрывает кадр с запасом
// plan.overscan (страховка «края декорации не видно»: столько, сколько просит серия).
// Надписей от движка нет: вывеска лавки пустая, «СВЕЖЕЕ» на прилавке нет.
// Своя жизнь декорации (машины, облака, чайки, пыль, окна, звёзды, море, пальма, навес) —
// поле партитуры scene.ambient (множитель скорости; не написано — 0: декорация неподвижна,
// как в кадре 0). Случайный узор (звёзды, окна, пыль, места машин и облаков) — из сида серии.
// Своё место (сгенерированный фон) — по рамке backdropImageRect.
import React from "react";
import { mix } from "../kit/color";
import { circleTorn, rand, tornRect } from "../kit/paper";
import { stageBg } from "../kit/style";
import { GROUND, H, SET_BASE, SET_DY, STALL, W } from "../kit/geometry";
import type { Palette } from "../timeline/types";

// Кадр, линия земли и геометрия декораций — общие с планом (kit/geometry.ts).
export { backdropImageRect, backdropRect, GROUND, H, obstacles, W } from "../kit/geometry";
export type { Obstacle } from "../kit/geometry";
export { circleTorn };

const BASE = SET_BASE;
const DY = SET_DY;

// Роли палитры для встроенных декораций (пресет: доли смешения — форма декорации).
export type SetColors = ReturnType<typeof setColors>;
export const setColors = (p: Palette) => {
  const base = stageBg(p);
  const gold = p.highlight ?? p.accent;
  const green = p.positive ?? mix(p.accent, p.ink, 0.3);
  return {
    sky: base, skyEdge: mix(base, p.ink, 0.15),
    soft: mix(base, p.paper, 0.5), mote: mix(base, p.ink, 0.5),
    sun: p.accent, star: p.paper, night: mix(base, p.ink, 0.7),
    sea: Array.from({ length: 6 }, (_, i) => mix(base, p.ink, 0.3 + i * 0.07)),
    sand: mix(gold, p.paper, 0.4), grass: green, trunk: mix(p.accent, p.ink, 0.55), leaf: [green, mix(green, p.paper, 0.25)],
    house: Array.from({ length: 8 }, (_, i) => mix(p.ink, base, 0.15 + (i % 4) * 0.08)),
    lit: gold, unlit: mix(p.ink, base, 0.1), road: p.ink, kerb: mix(p.ink, base, 0.2), mark: p.paper,
    car: [mix(p.accent, p.paper, 0.45), mix(green, p.paper, 0.45)], glass: mix(p.paper, p.accent, 0.15), wheel: p.ink,
    floor: mix(p.accent, p.ink, 0.6), floorLine: mix(p.accent, p.ink, 0.72), post: mix(p.accent, p.ink, 0.5),
    sign: p.ink, awning: [p.accent, p.paper], counter: mix(p.accent, p.ink, 0.4), counterBar: mix(p.accent, p.ink, 0.55),
    plank: mix(base, p.ink, 0.45),
  };
};

// low — сколько ещё вниз до края задника; t — время жизни декорации (кадр × ambient);
// rnd — случайное число узора из сида серии.
type Ctx = { c: SetColors; os: number; dy: number; low: number; t: number; rnd: (k: number) => number; sd: number };

const Backdrop: React.FC<{ x: Ctx }> = ({ x }) => (
  <>
    <defs>
      <radialGradient id="bd04" cx="50%" cy="38%" r="75%">
        <stop offset="0%" stopColor={x.c.sky} />
        <stop offset="100%" stopColor={x.c.skyEdge} />
      </radialGradient>
    </defs>
    <rect x={-x.os} y={-x.os} width={W + 2 * x.os} height={H + 2 * x.os} fill="url(#bd04)" />
  </>
);

const Cloud: React.FC<{ x: Ctx; y: number; w: number; seed: number; fill: string }> = ({ x, y, w, seed, fill }) => {
  const dx = ((x.t * 0.25 + x.rnd(seed) * (W + w * 2)) % (W + w * 2)) - w;
  return (
    <g transform={`translate(${dx},${y})`} filter="url(#shadow-soft)">
      <ellipse cx={0} cy={0} rx={w / 2} ry={w / 7} fill={fill} filter="url(#grain)" />
    </g>
  );
};

const Sun: React.FC<{ x: number; y: number; fill: string }> = ({ x, y, fill }) => (
  <g filter="url(#shadow-soft)">
    <path transform={`translate(${x - 72},${y - 72})`} d={circleTorn(72, 7)} fill={fill} filter="url(#grain)" />
  </g>
);

const Sea: React.FC<{ x: Ctx; top: number }> = ({ x, top }) => {
  const frame = x.t;
  return (
    <g>
      {x.c.sea.map((c, i) => {
        const y = top + i * 110;
        const dx = Math.sin((frame / 30) * 0.8 + i + x.sd) * 10;
        return <path key={i} transform={`translate(${-x.os + dx},${y})`} d={tornRect(W + 2 * x.os, H - y + x.os + x.low, 300 + i, 3, 24)} fill={c} />;
      })}
    </g>
  );
};

const Island: React.FC<{ c: SetColors }> = ({ c }) => (
  <g filter="url(#shadow)">
    <path d={`M90,${GROUND - 8} Q540,${GROUND - 40} 990,${GROUND - 8} L1020,${GROUND + 70} Q540,${GROUND + 120} 60,${GROUND + 70} Z`}
      fill={c.sand} filter="url(#grain)" />
    <path d={`M100,${GROUND - 8} Q540,${GROUND - 40} 980,${GROUND - 8} L980,${GROUND + 6} Q540,${GROUND - 22} 100,${GROUND + 6} Z`}
      fill={c.grass} />
  </g>
);

const Palm: React.FC<{ x: number; c: SetColors; t: number; ph: number }> = ({ x, c, t, ph }) => {
  const sway = Math.sin(t / 22 + ph) * 3;
  return (
    <g transform={`translate(${x},${GROUND - 4})`} filter="url(#shadow-soft)">
      <path d="M-8,0 Q-14,-160 10,-330 L22,-328 Q2,-160 10,0 Z" fill={c.trunk} filter="url(#grain)" />
      <g transform={`translate(16,-330) rotate(${sway})`}>
        {[-150, -110, -60, -20, 25, 70].map((a, i) => (
          <path key={i} transform={`rotate(${a})`} d="M0,0 Q60,-30 130,-6 Q70,4 0,8 Z" fill={c.leaf[i % 2]} />
        ))}
      </g>
    </g>
  );
};

const Gulls: React.FC<{ x: Ctx }> = ({ x }) => {
  const frame = x.t;
  return (
    <g>
      {[0, 1, 2].map((i) => {
        const gx = ((frame * (2.2 + i * 0.6) + x.rnd(500 + i) * (W + 2 * x.os)) % (W + 2 * x.os)) - x.os;
        const y = 380 + i * 70 + Math.sin(frame / 30 + i) * 20;
        const flap = Math.sin(frame / 3 + i * 2) * 16;
        return <path key={i} d={`M${gx - 26},${y - flap} Q${gx - 12},${y - 10} ${gx},${y} Q${gx + 12},${y - 10} ${gx + 26},${y - flap}`}
          stroke={x.c.soft} strokeWidth={5} fill="none" strokeLinecap="round" />;
      })}
    </g>
  );
};

const Dust: React.FC<{ x: Ctx; fill: string }> = ({ x: c, fill }) => {
  const frame = c.t, rnd = c.rnd;
  return (
    <g>
      {Array.from({ length: 16 }, (_, i) => {
        const x = rnd(i * 3.1) * W + Math.sin(frame / 50 + i) * 20;
        const y = ((rnd(i * 5.3) * H - frame * (0.4 + rnd(i) * 0.5)) % H + H) % H;
        return <circle key={i} cx={x} cy={y} r={1.5 + rnd(i * 7) * 2.5} fill={fill} opacity={0.12 + rnd(i * 9) * 0.15} />;
      })}
    </g>
  );
};

const CityFar: React.FC<{ x: Ctx }> = ({ x }) => {
  const frame = x.t, rnd = x.rnd;
  return (
    <g>
      <rect x={-x.os} y={-x.os} width={W + 2 * x.os} height={H + 2 * x.os} fill={x.c.night} />
      <g transform={`translate(0,${DY + x.dy})`}>
        {Array.from({ length: 48 }, (_, i) => (
          <circle key={i} cx={-x.os + rnd(i) * (W + 2 * x.os)} cy={160 + rnd(i + 99) * 600} r={rnd(i + 7) * 2 + 1}
            fill={x.c.star} opacity={0.35 + 0.4 * Math.abs(Math.sin(frame / 25 + i))} />
        ))}
        <g filter="url(#shadow-soft)">
          <path transform="translate(800,330)" d={circleTorn(56, 3)} fill={x.c.star} filter="url(#grain)" />
        </g>
      </g>
    </g>
  );
};

const Car: React.FC<{ x: Ctx; y: number; color: string; speed: number; offset: number; dir: 1 | -1 }> = ({ x, y, color, speed, offset, dir }) => {
  const frame = x.t;
  const span = W + 2 * x.os + 300;
  const p = (frame * speed + x.rnd(offset) * span) % span;
  const cx = dir === 1 ? -x.os - 150 + p : W + x.os + 150 - p;
  const wheel = (frame * speed * 3) % 360;
  return (
    <g transform={`translate(${cx},${y}) scale(${dir * 0.9},0.9)`} filter="url(#shadow-soft)">
      <path d="M-110,10 L-90,-30 L-40,-60 L50,-60 L90,-20 L110,10 L110,40 L-110,40 Z" fill={color} />
      <rect x={-30} y={-50} width={60} height={34} fill={x.c.glass} />
      {[-60, 60].map((wx) => (
        <g key={wx} transform={`translate(${wx},42) rotate(${wheel})`}>
          <circle r={22} fill={x.c.wheel} /><rect x={-3} y={-18} width={6} height={36} fill={x.c.kerb} />
        </g>
      ))}
    </g>
  );
};

const HOUSES = [
  { x: -200, w: 210, h: 410 }, { x: 0, w: 190, h: 430 }, { x: 180, w: 150, h: 330 }, { x: 320, w: 200, h: 470 },
  { x: 510, w: 170, h: 360 }, { x: 670, w: 210, h: 500 }, { x: 870, w: 210, h: 390 }, { x: 1070, w: 220, h: 440 },
];
const CityMid: React.FC<{ x: Ctx }> = ({ x }) => {
  const frame = x.t, rnd = x.rnd;
  const { c, os, low } = x;
  const base = 1150;
  return (
    <g transform={`translate(0,${DY})`}>
      {HOUSES.map((b, i) => (
        <g key={i} filter="url(#shadow)">
          <path transform={`translate(${b.x},${base - b.h})`} d={tornRect(b.w, b.h, 40 + i, 2)} fill={c.house[i]} filter="url(#grain)" />
          {Array.from({ length: Math.floor((b.h - 60) / 58) * Math.floor((b.w - 30) / 44) }, (_, k) => {
            const cols = Math.floor((b.w - 30) / 44);
            const cx = b.x + 22 + (k % cols) * 44;
            const cy = base - b.h + 34 + Math.floor(k / cols) * 58;
            const lit = rnd(i * 50 + k + Math.floor((frame + k * 37) / 150) * 0.731) > 0.35;
            return <rect key={k} x={cx} y={cy} width={26} height={34} fill={lit ? c.lit : c.unlit} />;
          })}
        </g>
      ))}
      <rect x={-os} y={base} width={W + 2 * os} height={40} fill={c.kerb} />
      <rect x={-os} y={base + 40} width={W + 2 * os} height={H - base + os + low} fill={c.road} />
      {Array.from({ length: 11 }, (_, i) => (
        <rect key={i} x={-os + i * 150 + 20} y={base + 170} width={80} height={10} fill={c.mark} opacity={0.6} />
      ))}
      <Car x={x} y={base + 110} color={c.car[0]} speed={7} offset={700} dir={1} />
      <Car x={x} y={base + 230} color={c.car[1]} speed={5} offset={701} dir={-1} />
      <rect x={-os} y={BASE + 60} width={W + 2 * os} height={H - BASE + os + low} fill={c.road} />
    </g>
  );
};

const Stall: React.FC<{ x: Ctx }> = ({ x }) => {
  const frame = x.t;
  const { c, os, low } = x;
  const { stripes, x0, x1, sign: sg, awning: aw, posts } = STALL;
  const sw = (x1 - x0) / stripes;
  return (
    <g transform={`translate(0,${DY})`}>
      <rect x={-os} y={BASE} width={W + 2 * os} height={H - BASE + os + low} fill={c.floor} filter="url(#grain)" />
      {Array.from({ length: 6 }, (_, i) => <rect key={i} x={-os} y={BASE + 40 + i * 70} width={W + 2 * os} height={3} fill={c.floorLine} />)}
      <rect x={x0 + posts.inset} y={posts.y} width={posts.w} height={BASE - posts.y} fill={c.post} />
      <rect x={x1 - posts.inset - posts.w} y={posts.y} width={posts.w} height={BASE - posts.y} fill={c.post} />
      <g filter="url(#shadow)">
        <rect x={x0 + sg.inset} y={sg.y} width={x1 - x0 - 2 * sg.inset} height={sg.h} fill={c.sign} />
      </g>
      <g filter="url(#shadow)">
        {Array.from({ length: stripes }, (_, i) => (
          <path key={i}
            d={`M${x0 + i * sw},${aw.y} L${x0 + (i + 1) * sw},${aw.y} L${x0 + (i + 1) * sw},${aw.y1} Q${x0 + (i + 0.5) * sw},${aw.wave + Math.sin(frame / 5 + i + x.sd) * aw.waveAmp} ${x0 + i * sw},${aw.y1} Z`}
            fill={c.awning[i % 2]} />
        ))}
      </g>
    </g>
  );
};

const F = STALL.front;
const StallFront: React.FC<{ c: SetColors }> = ({ c }) => (
  <g filter="url(#shadow)" transform={`translate(0,${DY})`}>
    <path transform={`translate(${F.x},${F.y})`} d={tornRect(F.w, BASE - F.top, 77, 2)} fill={c.counter} filter="url(#grain)" />
    <rect x={F.x} y={F.y} width={F.w} height={F.bar} fill={c.counterBar} />
  </g>
);

const Plank: React.FC<{ c: SetColors }> = ({ c }) => (
  <g filter="url(#shadow)">
    <path transform={`translate(250,${GROUND})`} d={tornRect(580, 34, 12, 2)} fill={c.plank} filter="url(#grain)" />
  </g>
);

export const BUILTIN_SETS04 = ["city", "island", "stall", "board"] as const;

// Встроенная декорация: слой far (небо, задник) или mid (дома, море, лавка, доска пола).
// os — запас задника по краю (plan.overscan), ground — линия пола сцены (px), t — время
// жизни декорации в кадрах (кадр × scene.ambient; 0 — неподвижна), seed — сид серии.
export const SetBack: React.FC<{ set: string; layer: "far" | "mid"; palette: Palette; os: number; ground: number; t: number; seed: number }> = ({ set, layer, palette, os, ground, t, seed }) => {
  const dy = ground - GROUND;
  const sd = (seed % 100003) / 100003;
  const rnd = (k: number) => rand(k + sd * 1000);
  const x: Ctx = { c: setColors(palette), os, dy, low: Math.max(0, -dy), t, rnd, sd: sd * 2 * Math.PI };
  const far = layer === "far";
  // Средний план опускается/поднимается вместе с полом сцены.
  const mid = (node: React.ReactNode) => <g transform={`translate(0,${dy})`}>{node}</g>;
  switch (set) {
    case "city":
      return far ? <CityFar x={x} /> : mid(<CityMid x={x} />);
    case "island":
      return far ? (
        <g>
          <Backdrop x={x} />
          <Cloud x={x} y={330} w={230} seed={1} fill={x.c.soft} />
          <Cloud x={x} y={270} w={170} seed={9} fill={x.c.soft} />
          <Sun x={820} y={560} fill={x.c.sun} />
          <Gulls x={x} />
        </g>
      ) : mid(<g><Sea x={x} top={1030 + DY} /><Island c={x.c} /><Palm x={930} c={x.c} t={t} ph={x.sd} /></g>);
    case "stall":
      return far ? <Backdrop x={x} /> : mid(<Stall x={x} />);
    case "board":
      // Доска пола — часть пресета, кто бы ни стоял в сцене.
      return far ? <g><Backdrop x={x} /><Dust x={x} fill={x.c.mote} /></g> : mid(<Plank c={x.c} />);
    default:
      return null;
  }
};

// Передний план встроенной декорации (прилавок лавки) — над героями.
export const SetFront: React.FC<{ set: string; palette: Palette; ground: number }> = ({ set, palette, ground }) =>
  set === "stall" ? <g transform={`translate(0,${ground - GROUND})`}><StallFront c={setColors(palette)} /></g> : null;
