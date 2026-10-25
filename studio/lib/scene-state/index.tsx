// Скилл scene-state: время суток / погода / сезон как параметры сцены.
// Импорт: import { resolveLook, lookAt, Sky, Graded, GlowSpots, WeatherFx } from "@studio/scene-state";
// 3D-свет и перекраска модели — "@studio/scene-state/three". Blender — scene_state.py рядом.
import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { Clouds, Fog, Rain, Snow, Stars, type Area } from "../fx";
import { gradeFilter, type Look, mixColor, skyCss } from "./state";

export * from "./state";

// Небо 2D: градиент, солнце или луна с ореолом, звёзды и облака по Look.
// sun/moon — положение диска в px кадра (по умолчанию: солнце — по высоте над горизонтом).
export const Sky: React.FC<{ look: Look; horizon?: number; sun?: { x: number; y: number }; moon?: { x: number; y: number }; seed?: string; clouds?: boolean; stars?: boolean }> = ({ look, horizon = 0.62, sun, moon, seed = "sky", clouds = true, stars = true }) => {
  const { width: W, height: H } = useVideoConfig();
  const k = Math.min(W, H) / 1080;
  const sunPos = sun ?? { x: W * (0.5 + Math.sin((look.sunAzimuth * Math.PI) / 180) * 0.35), y: H * horizon - (look.sunElevation / 90) * H * horizon * 1.1 };
  const moonPos = moon ?? { x: W * 0.74, y: H * 0.16 };
  const sunVis = Math.max(0, Math.min(1, (look.sunElevation + 2) / 8)) * (1 - look.moon) * (1 - look.clouds * 0.7);
  return (
    <AbsoluteFill style={{ background: skyCss(look) }}>
      {stars && look.stars > 0.02 ? <Stars seed={`${seed}-st`} opacity={look.stars} area={{ x: 0, y: 0, w: W, h: H * horizon }} fadeTo={0.95} /> : null}
      {sunVis > 0.02 ? (
        <div style={{ position: "absolute", left: sunPos.x - 260 * k, top: sunPos.y - 260 * k, width: 520 * k, height: 520 * k, borderRadius: "50%", opacity: sunVis,
          background: `radial-gradient(circle, ${mixColor(look.sunColor, "#ffffff", 0.6)} 0 17%, ${look.sunColor}66 19%, ${look.sunColor}00 70%)` }} />
      ) : null}
      {look.moon > 0.02 ? (
        <div style={{ position: "absolute", left: moonPos.x - 200 * k, top: moonPos.y - 200 * k, width: 400 * k, height: 400 * k, opacity: look.moon,
          background: `radial-gradient(circle, #fffbe8 0 ${20}%, #fff6d266 ${22}%, #fff6d200 68%)`, borderRadius: "50%" }} />
      ) : null}
      {clouds && look.clouds > 0.05 ? (
        <Clouds seed={`${seed}-cl`} count={Math.round(2 + look.clouds * 6)} color={look.cloudTint} shade={mixColor(look.cloudTint, look.skyTop, 0.35)}
          opacity={Math.min(1, 0.4 + look.clouds)} band={[0.04, horizon * 0.7]} />
      ) : null}
    </AbsoluteFill>
  );
};

// Цветокор готовой картинки/сцены под состояние: экспозиция и насыщенность (filter) +
// тон (multiply) + лёгкая дымка (fog). Так «день» из генерации становится вечером или ночью
// без новой генерации. strength 0..1 — сила (1 — как в пресете).
export const Graded: React.FC<{ look: Look; strength?: number; fogTop?: number; children?: React.ReactNode; style?: React.CSSProperties }> = ({ look, strength = 1, fogTop = 0.5, children, style }) => {
  const s = Math.max(0, Math.min(1, strength));
  const l = { ...look, exposure: look.exposure * s, saturation: 1 + (look.saturation - 1) * s };
  return (
    <AbsoluteFill style={style}>
      <AbsoluteFill style={{ filter: gradeFilter(l) }}>{children}</AbsoluteFill>
      {look.gradeAmount > 0.01 ? <AbsoluteFill style={{ background: look.grade, mixBlendMode: "multiply", opacity: look.gradeAmount * s }} /> : null}
      {look.fog > 0.15 ? <AbsoluteFill style={{ background: `linear-gradient(180deg, ${look.fogColor}00 ${fogTop * 100}%, ${look.fogColor} 100%)`, opacity: Math.min(0.85, (look.fog - 0.1) * s) }} /> : null}
    </AbsoluteFill>
  );
};

// Тёплые огни поверх картинки: окна, фонари, свечи. amount — обычно look.windowGlow (× flicker).
export type GlowSpot = { x: number; y: number; r: number; color?: string };
export const GlowSpots: React.FC<{ spots: GlowSpot[]; amount: number; color?: string }> = ({ spots, amount, color = "#ffb85c" }) => {
  if (amount <= 0.01) return null;
  return (
    <AbsoluteFill style={{ mixBlendMode: "screen", pointerEvents: "none" }}>
      {spots.map((s, i) => (
        <div key={i} style={{ position: "absolute", left: s.x - s.r, top: s.y - s.r, width: s.r * 2, height: s.r * 2, borderRadius: "50%", opacity: amount,
          background: `radial-gradient(circle, ${s.color ?? color}ee 0%, ${s.color ?? color}66 30%, ${s.color ?? color}00 70%)` }} />
      ))}
    </AbsoluteFill>
  );
};

// Осадки и дымка по Look: дождь, снег, туман. area — где идёт (например, только окно).
export const WeatherFx: React.FC<{ look: Look; area?: Area; clipPath?: string; seed?: string; fogBand?: [number, number] }> = ({ look, area, clipPath, seed = "wx", fogBand }) => (
  <>
    {look.fog > 0.3 ? <Fog seed={`${seed}-fog`} density={Math.min(0.9, look.fog)} color={look.fogColor} area={area} clipPath={clipPath} band={fogBand} /> : null}
    {look.rain > 0.02 ? <Rain seed={`${seed}-rain`} count={Math.round(40 + look.rain * 140)} angle={6 + look.rain * 10} opacity={0.5 + 0.5 * look.rain} area={area} clipPath={clipPath} color={mixColor(look.skyBottom, "#ffffff", 0.7)} /> : null}
    {look.snow > 0.02 ? <Snow seed={`${seed}-snow`} count={Math.round(40 + look.snow * 140)} area={area} clipPath={clipPath} /> : null}
  </>
);
