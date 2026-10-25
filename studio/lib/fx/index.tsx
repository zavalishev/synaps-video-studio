// Частицы и световые эффекты 2D (SVG поверх кадра) — скилл fx-particles.
// Импорт: import { Rain, Snow, Stars, Dust, LightBeam, GodRays, Clouds, Fog, Burst, Leaves, Steam } from "@studio/fx";
// 3D-версии (InstancedMesh внутри ThreeCanvas) — "@studio/fx/three".
//
// Правила, зашитые в код (это страховка, а не стиль):
//   • положение каждой частицы — чистая функция кадра и сида (random(seed) из remotion,
//     noise2D из @remotion/noise); Math.random нет;
//   • перенос «по модулю» делается ЗА краем области: частица исчезает за краем и
//     возвращается из-за другого края — внутри кадра ничего не телепортируется;
//   • скорость — в долях высоты области в секунду, поэтому вид не зависит от fps и размера;
//   • размеры — от min(W, H) кадра (k = min/1080), а не в пикселях 1080×1920.
// Все параметры по умолчанию — стартовая точка, директор меняет их под сцену.
import React, { useMemo } from "react";
import { random, useCurrentFrame, useVideoConfig } from "remotion";
import { noise2D } from "@remotion/noise";

export type Area = { x: number; y: number; w: number; h: number };

type Common = {
  seed?: string;
  area?: Area;              // область в px кадра (по умолчанию весь кадр)
  clipPath?: string;        // CSS clip-path области (например, стекло окна: "inset(0 round 12px)")
  opacity?: number;         // общий множитель
  style?: React.CSSProperties;
  frame?: number;           // свой кадр (по умолчанию useCurrentFrame) — для замедления/сдвига
};

const useBase = (o: Common) => {
  const cur = useCurrentFrame();
  const { width: W, height: H, fps } = useVideoConfig();
  const area = o.area ?? { x: 0, y: 0, w: W, h: H };
  const k = Math.min(W, H) / 1080;
  return { frame: o.frame ?? cur, W, H, fps, area, k };
};

const Svg: React.FC<{ area: Area; clipPath?: string; opacity?: number; style?: React.CSSProperties; blend?: React.CSSProperties["mixBlendMode"]; children?: React.ReactNode }> = ({ area, clipPath, opacity, style, blend, children }) => (
  <svg
    width={area.w} height={area.h} viewBox={`0 0 ${area.w} ${area.h}`}
    style={{ position: "absolute", left: area.x, top: area.y, overflow: "hidden", pointerEvents: "none", clipPath, opacity, mixBlendMode: blend, ...style }}
  >
    {children}
  </svg>
);

// Положительный остаток.
export const wrap = (v: number, m: number) => ((v % m) + m) % m;
const rnd = (seed: string, i: number, k: string) => random(`${seed}|${i}|${k}`);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ---------------------------------------------------------------- дождь
export type RainProps = Common & {
  count?: number;           // число штрихов в области (80 — заметный дождь, 200 — ливень)
  angle?: number;           // наклон от вертикали, градусы (ветер вправо — плюс)
  speed?: number;           // высот области в секунду у ближних капель (дальние медленнее)
  length?: number;          // длина ближнего штриха, доля высоты кадра
  width?: number;           // толщина ближнего штриха, px при 1080
  color?: string;
  splash?: number;          // y (px области) линии земли для брызг; не задано — без брызг
};

export const Rain: React.FC<RainProps> = (p) => {
  const { frame, fps, area, k, H } = useBase(p);
  const { seed = "rain", count = 90, angle = 10, speed = 2.2, length = 0.06, width = 2.2, color = "#dfe8f5", splash } = p;
  const tan = Math.tan((angle * Math.PI) / 180);
  const drops = useMemo(() => Array.from({ length: count }, (_, i) => {
    const z = rnd(seed, i, "z") ** 1.6;             // больше дальних, меньше ближних
    return {
      z,
      x0: rnd(seed, i, "x"),
      y0: rnd(seed, i, "y"),
      v: lerp(0.55, 1, z),
      len: lerp(0.35, 1, z),
      w: lerp(0.35, 1, z),
      a: lerp(0.18, 0.62, z) * (0.75 + 0.25 * rnd(seed, i, "a")),
    };
  }), [seed, count]);
  const L = length * H;
  const slack = area.h * Math.abs(tan) + 2 * L;       // запас по x под наклон
  const lo = (tan > 0 ? -area.h * tan : 0) - L;
  const cycle = area.h + 2 * L;                        // путь до переноса: от −L до h+L
  return (
    <Svg area={area} clipPath={p.clipPath} opacity={p.opacity} style={p.style}>
      <g stroke={color} strokeLinecap="round" fill="none">
        {drops.map((d, i) => {
          const len = d.len * L;
          const yHead = wrap(d.y0 * cycle + (frame * speed * area.h * d.v) / fps, cycle) - L; // голова капли
          const x = lo + d.x0 * (area.w + slack) + yHead * tan;
          const dx = tan * len, dy = len;
          return <line key={i} x1={x - dx} y1={yHead - dy} x2={x} y2={yHead} strokeWidth={d.w * width * k} opacity={d.a} />;
        })}
      </g>
      {splash !== undefined ? <Splashes seed={seed} frame={frame} fps={fps} y={splash} w={area.w} k={k} color={color} count={Math.round(count / 4)} /> : null}
    </Svg>
  );
};

// Брызги: короткие расходящиеся эллипсы на линии земли, у каждой своя фаза.
const Splashes: React.FC<{ seed: string; frame: number; fps: number; y: number; w: number; k: number; color: string; count: number }> = ({ seed, frame, fps, y, w, k, color, count }) => {
  const period = Math.round(fps * 0.6);
  return (
    <g fill="none" stroke={color}>
      {Array.from({ length: count }, (_, i) => {
        const ph = Math.floor(rnd(seed, i, "sp") * period);
        const local = wrap(frame + ph, period);
        const cycleN = Math.floor((frame + ph) / period);
        const t = local / (period * 0.5);
        if (t > 1) return null;
        const x = rnd(seed + "s" + cycleN, i, "x") * w;
        const r = (4 + 14 * t) * k;
        return <ellipse key={i} cx={x} cy={y + rnd(seed, i, "dy") * 20 * k} rx={r} ry={r * 0.28} strokeWidth={1.4 * k} opacity={0.5 * (1 - t)} />;
      })}
    </g>
  );
};

// ---------------------------------------------------------------- снег
export type SnowProps = Common & {
  count?: number;           // 120 — снегопад, 40 — редкие хлопья
  speed?: number;           // высот области в секунду у ближних хлопьев
  size?: number;            // радиус ближнего хлопка, px при 1080
  sway?: number;            // амплитуда покачивания, px при 1080
  wind?: number;            // снос вправо, ширин области в секунду (может быть < 0)
  color?: string;
};

export const Snow: React.FC<SnowProps> = (p) => {
  const { frame, fps, area, k } = useBase(p);
  const { seed = "snow", count = 120, speed = 0.16, size = 7, sway = 26, wind = 0.02, color = "#ffffff" } = p;
  const flakes = useMemo(() => Array.from({ length: count }, (_, i) => {
    const z = rnd(seed, i, "z") ** 1.4;
    return {
      z, x0: rnd(seed, i, "x"), y0: rnd(seed, i, "y"),
      r: lerp(0.3, 1, z), v: lerp(0.45, 1, z),
      period: lerp(3.5, 6.5, rnd(seed, i, "p")), ph: rnd(seed, i, "ph") * Math.PI * 2,
      a: lerp(0.45, 0.95, z),
    };
  }), [seed, count]);
  const R = size * k;
  const cycleY = area.h + 4 * R;
  const margin = sway * k * 2 + 4 * R;
  const cycleX = area.w + 2 * margin;
  // Три слоя глубины: ближние чуть размыты (глубина резкости), дальние — мелкие и тусклые.
  const layer = (lo: number, hi: number, blur: number) => (
    <g fill={color} style={blur ? { filter: `blur(${blur * k}px)` } : undefined}>
      {flakes.map((f, i) => {
        if (f.z < lo || f.z >= hi) return null;
        const t = frame / fps;
        const y = wrap(f.y0 * cycleY + t * speed * area.h * f.v, cycleY) - 2 * R;
        const x = wrap(f.x0 * cycleX + t * wind * area.w * f.v + Math.sin((2 * Math.PI * t) / f.period + f.ph) * sway * k * f.v, cycleX) - margin;
        return <circle key={i} cx={x} cy={y} r={f.r * R} opacity={f.a} />;
      })}
    </g>
  );
  return (
    <Svg area={area} clipPath={p.clipPath} opacity={p.opacity} style={p.style}>
      {layer(0, 0.45, 0)}
      {layer(0.45, 0.85, 0)}
      {layer(0.85, 1.01, 1.6)}
    </Svg>
  );
};

// ---------------------------------------------------------------- звёзды
export type StarsProps = Common & {
  count?: number;
  twinkle?: number;         // глубина мерцания 0..1 (0.4 — спокойно)
  period?: [number, number];// период мерцания, секунды (медленно = спокойно)
  size?: number;            // радиус крупной звезды, px при 1080
  sparkle?: number;         // доля крупных звёзд с лучами
  color?: string;
  fadeTo?: number;          // y-доля области, где звёзды гаснут к горизонту (1 — без затухания)
};

export const Stars: React.FC<StarsProps> = (p) => {
  const { frame, fps, area, k } = useBase(p);
  const { seed = "stars", count = 140, twinkle = 0.4, period = [2.2, 5], size = 3.2, sparkle = 0.06, color = "#fff6dc", fadeTo = 1 } = p;
  const stars = useMemo(() => Array.from({ length: count }, (_, i) => {
    const big = rnd(seed, i, "big");
    return {
      x: rnd(seed, i, "x"), y: rnd(seed, i, "y") ** 1.25,
      r: big > 0.93 ? lerp(0.7, 1, rnd(seed, i, "r")) : lerp(0.18, 0.45, rnd(seed, i, "r")),
      sp: big > 1 - sparkle,
      per: lerp(period[0], period[1], rnd(seed, i, "per")), ph: rnd(seed, i, "ph") * Math.PI * 2,
    };
  }), [seed, count, sparkle, period[0], period[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = frame / fps;
  return (
    <Svg area={area} clipPath={p.clipPath} opacity={p.opacity} style={p.style}>
      <defs>
        <radialGradient id={`${seed}-g`}><stop offset="0" stopColor={color} stopOpacity="1" /><stop offset="1" stopColor={color} stopOpacity="0" /></radialGradient>
      </defs>
      {stars.map((s, i) => {
        const tw = 1 - twinkle / 2 + (twinkle / 2) * Math.sin((2 * Math.PI * t) / s.per + s.ph);
        const fade = fadeTo >= 1 ? 1 : Math.max(0, Math.min(1, (fadeTo - s.y) / (fadeTo * 0.35)));
        const x = s.x * area.w, y = s.y * area.h, r = s.r * size * k;
        const a = tw * fade;
        if (a <= 0.01) return null;
        return (
          <g key={i} opacity={a}>
            {s.sp ? (
              <>
                <circle cx={x} cy={y} r={r * 4} fill={`url(#${seed}-g)`} opacity={0.35} />
                <path d={`M${x - r * 5} ${y}L${x} ${y - r * 0.5}L${x + r * 5} ${y}L${x} ${y + r * 0.5}Z M${x} ${y - r * 5}L${x + r * 0.5} ${y}L${x} ${y + r * 5}L${x - r * 0.5} ${y}Z`} fill={color} opacity={0.8} />
              </>
            ) : null}
            <circle cx={x} cy={y} r={r} fill={color} />
          </g>
        );
      })}
    </Svg>
  );
};

// ---------------------------------------------------------------- пыль в луче
export type DustProps = Common & {
  count?: number;
  size?: number;            // радиус крупной пылинки, px при 1080
  drift?: number;           // амплитуда блуждания, px при 1080
  rise?: number;            // подъём, высот области в секунду (может быть < 0 — оседает)
  color?: string;
  // Яркость пылинки по её месту (0..1): например, 1 внутри луча и 0 вне. По умолчанию 1.
  light?: (x: number, y: number) => number;
};

export const Dust: React.FC<DustProps> = (p) => {
  const { frame, fps, area, k } = useBase(p);
  const { seed = "dust", count = 46, size = 4.5, drift = 40, rise = 0.012, color = "#fff1cf", light } = p;
  const motes = useMemo(() => Array.from({ length: count }, (_, i) => ({
    x0: rnd(seed, i, "x"), y0: rnd(seed, i, "y"), r: lerp(0.25, 1, rnd(seed, i, "r") ** 2),
    a: lerp(0.35, 0.9, rnd(seed, i, "a")),
  })), [seed, count]);
  const t = frame / fps;
  const m = drift * k * 2;
  return (
    <Svg area={area} clipPath={p.clipPath} opacity={p.opacity} style={p.style} blend="screen">
      <defs>
        <radialGradient id={`${seed}-d`}><stop offset="0" stopColor={color} stopOpacity="1" /><stop offset="0.45" stopColor={color} stopOpacity="0.55" /><stop offset="1" stopColor={color} stopOpacity="0" /></radialGradient>
      </defs>
      {motes.map((d, i) => {
        const x = wrap(d.x0 * (area.w + 2 * m) + noise2D(`${seed}x${i}`, t * 0.12, 0) * drift * k, area.w + 2 * m) - m;
        const y = wrap(d.y0 * (area.h + 2 * m) - t * rise * area.h + noise2D(`${seed}y${i}`, t * 0.12, 3) * drift * k, area.h + 2 * m) - m;
        const lit = light ? Math.max(0, Math.min(1, light(x + area.x, y + area.y))) : 1;
        const tw = 0.75 + 0.25 * noise2D(`${seed}a${i}`, t * 0.5, 7);
        const a = d.a * lit * tw;
        if (a < 0.02) return null;
        return <circle key={i} cx={x} cy={y} r={d.r * size * k * 2} fill={`url(#${seed}-d)`} opacity={a} />;
      })}
    </Svg>
  );
};

// ---------------------------------------------------------------- лучи
export type LightBeamProps = Common & {
  origin: { x: number; y: number };   // точка лампы, px кадра
  angle: number;            // направление, градусы (0 — вправо, 90 — вниз); анимируйте tween-ом
  spread?: number;          // раствор конуса, градусы
  length?: number;          // длина, доля высоты кадра
  color?: string;
  intensity?: number;       // 0..1 — яркость у источника
  softness?: number;        // размытие края, px при 1080
  core?: boolean;           // горячая сердцевина и ореол лампы
};

export const LightBeam: React.FC<LightBeamProps> = (p) => {
  const { W, H, k } = useBase(p);
  const { origin, angle, spread = 18, length = 1.1, color = "#fff2c4", intensity = 0.75, softness = 14, core = true, seed = "beam" } = p;
  const L = length * Math.max(W, H);
  const a = (angle * Math.PI) / 180;
  const cone = (sp: number) => {
    const h = (sp * Math.PI) / 360;
    const p1 = { x: origin.x + Math.cos(a - h) * L, y: origin.y + Math.sin(a - h) * L };
    const p2 = { x: origin.x + Math.cos(a + h) * L, y: origin.y + Math.sin(a + h) * L };
    return `M${origin.x} ${origin.y} L${p1.x} ${p1.y} L${p2.x} ${p2.y} Z`;
  };
  const tip = { x: origin.x + Math.cos(a) * L, y: origin.y + Math.sin(a) * L };
  const id = `${seed}-${Math.round(origin.x)}-${Math.round(origin.y)}`;
  return (
    <Svg area={{ x: 0, y: 0, w: W, h: H }} clipPath={p.clipPath} opacity={p.opacity} style={p.style} blend="screen">
      <defs>
        <linearGradient id={`${id}-l`} gradientUnits="userSpaceOnUse" x1={origin.x} y1={origin.y} x2={tip.x} y2={tip.y}>
          <stop offset="0" stopColor={color} stopOpacity={intensity} />
          <stop offset="0.35" stopColor={color} stopOpacity={intensity * 0.45} />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}-o`}><stop offset="0" stopColor="#ffffff" stopOpacity="1" /><stop offset="0.3" stopColor={color} stopOpacity="0.7" /><stop offset="1" stopColor={color} stopOpacity="0" /></radialGradient>
        <filter id={`${id}-b`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation={softness * k} /></filter>
      </defs>
      <path d={cone(spread)} fill={`url(#${id}-l)`} filter={`url(#${id}-b)`} />
      {core ? <path d={cone(spread * 0.35)} fill={`url(#${id}-l)`} filter={`url(#${id}-b)`} opacity={0.8} /> : null}
      {core ? <circle cx={origin.x} cy={origin.y} r={70 * k} fill={`url(#${id}-o)`} opacity={Math.min(1, intensity * 1.2)} /> : null}
    </Svg>
  );
};

// Несколько мягких лучей из точки за кадром (солнце в окно, свет сверху), с медленным дыханием.
export const GodRays: React.FC<Common & { origin: { x: number; y: number }; angle: number; fan?: number; rays?: number; color?: string; intensity?: number; length?: number }> = (p) => {
  const { frame, fps } = useBase(p);
  const { origin, angle, fan = 40, rays = 5, color = "#fff0c8", intensity = 0.35, length = 1.3, seed = "rays" } = p;
  return (
    <>
      {Array.from({ length: rays }, (_, i) => {
        const u = rays === 1 ? 0.5 : i / (rays - 1);
        const breathe = 0.7 + 0.3 * noise2D(`${seed}${i}`, (frame / fps) * 0.15, 0);
        return (
          <LightBeam key={i} seed={`${seed}${i}`} origin={origin} angle={angle - fan / 2 + fan * u + (rnd(seed, i, "j") - 0.5) * 4}
            spread={lerp(4, 11, rnd(seed, i, "s"))} length={length} color={color} intensity={intensity * breathe} softness={18} core={false}
            clipPath={p.clipPath} opacity={p.opacity} />
        );
      })}
    </>
  );
};

// ---------------------------------------------------------------- облака
export type CloudsProps = Common & {
  count?: number;
  speed?: number;           // ширин области в секунду (0.01 — едва ползут)
  color?: string;
  shade?: string;           // цвет нижней тени облака
  scale?: number;           // размер облака, доля ширины области
  band?: [number, number];  // по высоте: доли области, где живут облака
};

export const Clouds: React.FC<CloudsProps> = (p) => {
  const { frame, fps, area } = useBase(p);
  const { seed = "clouds", count = 5, speed = 0.008, color = "#ffffff", shade = "#d9e2ef", scale = 0.42, band = [0.05, 0.4] } = p;
  const clouds = useMemo(() => Array.from({ length: count }, (_, i) => {
    const puffs = 4 + Math.floor(rnd(seed, i, "n") * 3);
    return {
      x0: rnd(seed, i, "x"), y: lerp(band[0], band[1], rnd(seed, i, "y")), s: lerp(0.65, 1.15, rnd(seed, i, "s")),
      v: lerp(0.7, 1.3, rnd(seed, i, "v")), a: lerp(0.8, 1, rnd(seed, i, "a")),
      puffs: Array.from({ length: puffs }, (_, j) => ({
        dx: (j / (puffs - 1) - 0.5) * 0.8 + (rnd(seed, i * 10 + j, "dx") - 0.5) * 0.08,
        r: lerp(0.16, 0.28, rnd(seed, i * 10 + j, "r")) * (1 - Math.abs(j / (puffs - 1) - 0.5) * 0.9),
      })),
    };
  }), [seed, count, band[0], band[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  const cw = scale * area.w;
  const cycle = area.w + 2 * cw;
  return (
    <Svg area={area} clipPath={p.clipPath} opacity={p.opacity} style={p.style}>
      {clouds.map((c, i) => {
        const w = cw * c.s;
        const cx = wrap(c.x0 * cycle + (frame / fps) * speed * area.w * c.v, cycle) - cw;
        const cy = c.y * area.h;
        const base = cy + w * 0.08;
        return (
          <g key={i} opacity={c.a}>
            {c.puffs.map((pf, j) => <circle key={`s${j}`} cx={cx + pf.dx * w} cy={base - pf.r * w * 0.55 + w * 0.025} r={pf.r * w} fill={shade} />)}
            {c.puffs.map((pf, j) => <circle key={j} cx={cx + pf.dx * w} cy={base - pf.r * w * 0.55} r={pf.r * w} fill={color} />)}
            <rect x={cx - w * 0.42} y={base - w * 0.06} width={w * 0.84} height={w * 0.07} rx={w * 0.035} fill={color} />
          </g>
        );
      })}
    </Svg>
  );
};

// ---------------------------------------------------------------- туман
export const Fog: React.FC<Common & { density?: number; color?: string; band?: [number, number]; speed?: number }> = (p) => {
  const { frame, fps, area, k } = useBase(p);
  const { density = 0.5, color = "#e9edf2", band = [0.45, 1], speed = 0.006, seed = "fog" } = p;
  const t = frame / fps;
  const n = 7;
  return (
    <Svg area={area} clipPath={p.clipPath} opacity={p.opacity} style={p.style}>
      <defs>
        <linearGradient id={`${seed}-v`} x1="0" y1="0" x2="0" y2="1">
          <stop offset={band[0]} stopColor={color} stopOpacity="0" />
          <stop offset={Math.min(1, band[0] + (band[1] - band[0]) * 0.6)} stopColor={color} stopOpacity={density * 0.8} />
          <stop offset={band[1]} stopColor={color} stopOpacity={density} />
        </linearGradient>
        <filter id={`${seed}-b`} x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation={40 * k} /></filter>
      </defs>
      <rect x={0} y={0} width={area.w} height={area.h} fill={`url(#${seed}-v)`} />
      <g filter={`url(#${seed}-b)`} fill={color}>
        {Array.from({ length: n }, (_, i) => {
          const w = area.w * lerp(0.5, 0.9, rnd(seed, i, "w"));
          const cyc = area.w + w * 2;
          const x = wrap(rnd(seed, i, "x") * cyc + t * speed * area.w * (i % 2 ? 1 : -0.7), cyc) - w;
          const y = area.h * lerp(band[0] + 0.1, band[1], rnd(seed, i, "y"));
          return <ellipse key={i} cx={x + w / 2} cy={y} rx={w / 2} ry={area.h * 0.05} opacity={density * 0.55} />;
        })}
      </g>
    </Svg>
  );
};

// ---------------------------------------------------------------- акцент-всплеск
// Короткий разлёт искр из точки: на «да!», на появлении цифры. Без отскоков: ease-out и угасание.
export const Burst: React.FC<Common & { at: number; x: number; y: number; count?: number; radius?: number; dur?: number; color?: string; colors?: string[] }> = (p) => {
  const { frame, k, W, H } = useBase(p);
  const { at, x, y, count = 14, radius = 170, dur = 22, color = "#ffd36e", colors, seed = "burst" } = p;
  const t = (frame - at) / dur;
  if (t < 0 || t > 1) return null;
  const e = 1 - (1 - t) ** 3;
  return (
    <Svg area={{ x: 0, y: 0, w: W, h: H }} opacity={p.opacity} style={p.style}>
      {Array.from({ length: count }, (_, i) => {
        const ang = (i / count) * Math.PI * 2 + (rnd(seed, i, "a") - 0.5) * 0.4;
        const d = radius * k * lerp(0.6, 1, rnd(seed, i, "d")) * e;
        const s = lerp(9, 18, rnd(seed, i, "s")) * k * (1 - t * 0.5);
        const cx = x + Math.cos(ang) * d, cy = y + Math.sin(ang) * d;
        const c = colors ? colors[i % colors.length] : color;
        return <path key={i} d={`M${cx} ${cy - s}L${cx + s * 0.3} ${cy}L${cx} ${cy + s}L${cx - s * 0.3} ${cy}Z`} fill={c} opacity={1 - t} transform={`rotate(${(ang * 180) / Math.PI + 90} ${cx} ${cy})`} />;
      })}
    </Svg>
  );
};

// ---------------------------------------------------------------- вспышка молнии
// Множитель яркости 0..1 в кадр frame: короткий двойной всплеск после каждого удара.
// Осторожно: вспышка — резкая смена яркости; 1–2 на сцену, intensity ≤ 0.5, иначе probe увидит склейку.
export const lightning = (frame: number, strikes: number[], o: { decay?: number } = {}) => {
  const d = o.decay ?? 6;
  let v = 0;
  for (const s of strikes) {
    const t = frame - s;
    if (t < 0 || t > d * 3) continue;
    v = Math.max(v, Math.exp(-t / d) * (t < 2 ? 1 : 0.55 + 0.45 * Math.exp(-((t - 4) ** 2) / 2)));
  }
  return Math.min(1, v);
};

// ---------------------------------------------------------------- зерно
// Бумажное/плёночное зерно поверх кадра: снимает «пластиковую» плоскость заливок (и пустые
// плоские полосы у края). По умолчанию неподвижно; every — менять узор раз в N кадров
// (плёнка; держите ≥ 3, иначе зерно «кипит»).
export const Grain: React.FC<{ opacity?: number; scale?: number; seed?: number; every?: number; blend?: React.CSSProperties["mixBlendMode"] }> = ({ opacity = 0.08, scale = 0.9, seed = 3, every, blend = "overlay" }) => {
  const frame = useCurrentFrame();
  const { width: W, height: H } = useVideoConfig();
  const s = every ? seed + Math.floor(frame / every) : seed;
  const id = `grain-${s}`;
  return (
    <svg width={W} height={H} style={{ position: "absolute", inset: 0, pointerEvents: "none", mixBlendMode: blend, opacity }}>
      <filter id={id} x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency={scale} numOctaves={2} seed={s} stitchTiles="stitch" />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width={W} height={H} filter={`url(#${id})`} />
    </svg>
  );
};

// ---------------------------------------------------------------- листья
// Падающие листья — силуэт листа (SVG-путь), а не значок шрифта: поворот вокруг оси (лист
// «переворачивается» — сжатие по ширине), покачивание, медленное падение. Три глубины.
export type LeavesProps = Common & {
  count?: number; speed?: number; size?: number; sway?: number; wind?: number;
  colors?: string[];        // 2–4 оттенка из палитры (осень: охра, ржавчина, тыква)
  shape?: "maple" | "oval" | "birch";
};
const LEAF: Record<NonNullable<LeavesProps["shape"]>, string> = {
  maple: "M0,-1 L0.18,-0.55 L0.62,-0.72 L0.45,-0.3 L0.95,-0.2 L0.55,0.05 L0.75,0.45 L0.25,0.32 L0.08,0.75 L0,1 L-0.08,0.75 L-0.25,0.32 L-0.75,0.45 L-0.55,0.05 L-0.95,-0.2 L-0.45,-0.3 L-0.62,-0.72 L-0.18,-0.55 Z",
  oval: "M0,-1 C0.55,-0.6 0.55,0.5 0,1 C-0.55,0.5 -0.55,-0.6 0,-1 Z",
  birch: "M0,-1 C0.7,-0.55 0.6,0.55 0,1 C-0.6,0.55 -0.7,-0.55 0,-1 Z",
};
export const Leaves: React.FC<LeavesProps> = (p) => {
  const { frame, fps, area, k } = useBase(p);
  const { seed = "leaves", count = 18, speed = 0.12, size = 40, sway = 60, wind = 0.03, colors = ["#C8732E", "#A8432A", "#D9A441"], shape = "maple" } = p;
  const leaves = useMemo(() => Array.from({ length: count }, (_, i) => {
    const z = rnd(seed, i, "z") ** 1.3;
    return { z, x0: rnd(seed, i, "x"), y0: rnd(seed, i, "y"), r: lerp(0.45, 1, z), v: lerp(0.5, 1, z), period: lerp(2.6, 4.8, rnd(seed, i, "p")), ph: rnd(seed, i, "ph") * Math.PI * 2, spin: lerp(1.6, 3.2, rnd(seed, i, "s")), c: colors[Math.floor(rnd(seed, i, "c") * colors.length) % colors.length] };
  }), [seed, count, colors]);
  const R = size * k, t = frame / fps;
  const cycleY = area.h + 4 * R, margin = sway * k * 2 + 4 * R, cycleX = area.w + 2 * margin;
  return (
    <Svg area={area} clipPath={p.clipPath} opacity={p.opacity} style={p.style}>
      {leaves.map((l, i) => {
        const y = wrap(l.y0 * cycleY + t * speed * area.h * l.v, cycleY) - 2 * R;
        const x = wrap(l.x0 * cycleX + t * wind * area.w * l.v + Math.sin((2 * Math.PI * t) / l.period + l.ph) * sway * k * l.v, cycleX) - margin;
        const rot = Math.sin((2 * Math.PI * t) / l.period + l.ph) * 40 + l.ph * 57;
        const flip = Math.cos((2 * Math.PI * t) / l.spin + l.ph); // «переворот» листа
        return <path key={i} d={LEAF[shape]} fill={l.c} opacity={lerp(0.7, 1, l.z)} transform={`translate(${x},${y}) rotate(${rot}) scale(${l.r * R * (0.25 + 0.75 * Math.abs(flip))},${l.r * R})`} style={l.z > 0.85 ? { filter: `blur(${1.2 * k}px)` } : undefined} />;
      })}
    </Svg>
  );
};

// ---------------------------------------------------------------- пар
// Пар над горячим: мягкие вытянутые клубы светлее фона, поднимаются, расширяются и тают.
// Ставится над источником (чашка, кастрюля) — не серым пятном поверх тёмного кадра.
export type SteamProps = Common & { source: { x: number; y: number; w: number }; height?: number; puffs?: number; color?: string; strength?: number };
export const Steam: React.FC<SteamProps> = (p) => {
  const { frame, fps, area, k } = useBase(p);
  const { seed = "steam", source, height = 360, puffs = 7, color = "#ffffff", strength = 0.5 } = p;
  const t = frame / fps, H0 = height * k;
  return (
    <Svg area={area} clipPath={p.clipPath} opacity={p.opacity} style={p.style}>
      <g style={{ filter: `blur(${14 * k}px)` }}>
        {Array.from({ length: puffs }, (_, i) => {
          const life = 3.2 + rnd(seed, i, "l") * 1.6;
          const ph = ((t + rnd(seed, i, "o") * life) % life) / life; // 0 → 1 жизнь клуба
          const nx = noise2D(seed, i * 3.1, t * 0.35) * source.w * 0.35;
          const x = source.x - area.x + (rnd(seed, i, "x") - 0.5) * source.w * 0.6 + nx * ph;
          const y = source.y - area.y - ph * H0;
          const rx = (source.w * 0.12 + ph * source.w * 0.25) * (0.8 + 0.4 * rnd(seed, i, "r"));
          const a = strength * Math.sin(Math.PI * ph) * 0.8;
          return <ellipse key={i} cx={x} cy={y} rx={rx} ry={rx * 1.9} fill={color} opacity={a} />;
        })}
      </g>
    </Svg>
  );
};
