// Слой «Wetter»: состояние сцены = данные, а не отдельная сцена.
//   SceneState {time, weather, season, overrides} → resolveLook → Look (все числа и цвета света);
//   lookAt(frame, keys) — плавная смена состояний по ключам (24–36 кадров — естественно);
//   flicker — мерцание «свет гаснет»; wmoToWeather / timeOfDayAt — из реальных данных погоды.
// Чистые функции: работают в рендере, в node (tsx) и для выгрузки в Blender (look.ts → JSON).
import presets from "./presets.json";

export type TimeOfDay = "dawn" | "day" | "golden" | "evening" | "night";
export type Weather = "clear" | "cloudy" | "fog" | "rain" | "storm" | "snow";
export type Season = "spring" | "summer" | "autumn" | "winter";

export type Look = {
  skyTop: string; skyBottom: string;
  sunColor: string; sunIntensity: number; sunElevation: number; sunAzimuth: number;
  hemiSky: string; hemiGround: string; hemiIntensity: number;
  fogColor: string; fog: number;              // 0..1 — плотность дымки
  exposure: number; saturation: number;       // EV-поправка, насыщенность (1 — как есть)
  windowGlow: number; stars: number; moon: number;
  water: string; grade: string; gradeAmount: number;   // цветокор для 2D-картинок
  clouds: number; cloudTint: string; rain: number; snow: number;
  foliage: string; ground: string; accent: string; snowCover: number;
};

export type SceneState = { time: TimeOfDay; weather?: Weather; season?: Season; overrides?: Partial<Look>; mute?: number }; // mute — насколько облачность гасит краски времени суток (1 по умолчанию, 0 — нарочная стилизация)

type Hex = string;
const parse = (h: Hex): [number, number, number] => {
  let s = h.replace("#", "");
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255) as [number, number, number];
};
const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const hex = (v: number[]) => "#" + v.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0")).join("");

// Смесь цветов в линейном свете (без «грязной» середины, как у sRGB-смеси).
export const mixColor = (a: Hex, b: Hex, t: number): Hex => {
  const x = parse(a).map(toLin), y = parse(b).map(toLin);
  return hex(x.map((c, i) => toSrgb(c + (y[i] - c) * t)));
};
export const hexToLinear = (h: Hex): [number, number, number] => parse(h).map(toLin) as [number, number, number];
const desat = (h: Hex, s: number) => {
  const [r, g, b] = parse(h);
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return hex([r, g, b].map((c) => l + (c - l) * s));
};

const P = presets as unknown as {
  time: Record<TimeOfDay, Partial<Look> & { grade: string }>;
  weather: Record<Weather, { clouds: number; cloudTint: Hex; sunMul: number; hemiMul: number; skyMix: Hex; skyMixAmt: number; fogAdd: number; rain: number; snow: number; starsMul: number; satMul: number }>;
  season: Record<Season, { foliage: Hex; ground: Hex; accent: Hex; snowCover: number }>;
  snowColor: Hex;
};
export const PRESETS = P;
export const SNOW_COLOR = P.snowColor;

export const resolveLook = (s: SceneState): Look => {
  const t = P.time[s.time];
  if (!t) throw new Error(`scene-state: нет времени суток «${s.time}» (${Object.keys(P.time).join(", ")})`);
  const w = P.weather[s.weather ?? "clear"];
  if (!w) throw new Error(`scene-state: нет погоды «${s.weather}» (${Object.keys(P.weather).join(", ")})`);
  const se = P.season[s.season ?? "summer"];
  if (!se) throw new Error(`scene-state: нет сезона «${s.season}» (${Object.keys(P.season).join(", ")})`);
  const night = s.time === "night";
  // Ночью «серое небо» погоды — тёмное, иначе тучи светятся.
  const skyMix = night ? mixColor(w.skyMix, "#141a2e", 0.8) : w.skyMix;
  const base = t as Look;
  const look: Look = {
    ...base,
    skyTop: mixColor(base.skyTop, skyMix, w.skyMixAmt),
    skyBottom: mixColor(base.skyBottom, skyMix, w.skyMixAmt * 0.85),
    sunIntensity: base.sunIntensity * w.sunMul,
    hemiIntensity: base.hemiIntensity * w.hemiMul,
    fogColor: mixColor(base.fogColor, skyMix, w.skyMixAmt * 0.6),
    fog: Math.min(1, base.fog + w.fogAdd),
    saturation: base.saturation * w.satMul,
    stars: base.stars * w.starsMul,
    moon: base.moon * (w.clouds > 0.7 ? 0.25 : 1),
    clouds: w.clouds, cloudTint: night ? mixColor(w.cloudTint, "#26304f", 0.85) : w.cloudTint,
    rain: w.rain, snow: w.snow,
    foliage: se.foliage, ground: se.ground, accent: se.accent,
    snowCover: Math.max(se.snowCover, w.snow > 0 ? 0.5 * w.snow : 0),
    water: w.skyMixAmt > 0 ? mixColor(base.water, desat(base.water, 0.4), w.skyMixAmt) : base.water,
  };
  // Пасмурно гасит краски времени суток: «розовый рассвет при пасмурно» противоречит данным.
  // Чем плотнее облачность, тем ближе небо и цветокор к серому небу погоды; mute 0 — стилизация
  // нарочно (запишите почему), 1 — по умолчанию.
  const mute = (s.mute ?? 1) * Math.max(0, (w.clouds - 0.5) / 0.5);
  if (mute > 0 && !night) {
    look.skyTop = mixColor(look.skyTop, skyMix, 0.5 * mute);
    look.skyBottom = mixColor(look.skyBottom, skyMix, 0.6 * mute);
    look.sunColor = mixColor(look.sunColor, "#f4f4f2", 0.6 * mute);
    look.fogColor = mixColor(look.fogColor, skyMix, 0.5 * mute);
    look.gradeAmount = look.gradeAmount * (1 - 0.7 * mute);
  }
  return { ...look, ...s.overrides };
};

const COLOR_KEYS: (keyof Look)[] = ["skyTop", "skyBottom", "sunColor", "hemiSky", "hemiGround", "fogColor", "water", "grade", "cloudTint", "foliage", "ground", "accent"];

// Смесь двух Look: цвета — в линейном свете, числа — линейно, азимут — по короткой дуге.
export const mixLook = (a: Look, b: Look, t: number): Look => {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const out = { ...a } as Record<string, number | string>;
  for (const k of Object.keys(b) as (keyof Look)[]) {
    const x = a[k], y = b[k];
    if (COLOR_KEYS.includes(k)) out[k] = mixColor(x as string, y as string, t);
    else if (k === "sunAzimuth") { const d = ((((y as number) - (x as number)) % 360) + 540) % 360 - 180; out[k] = (x as number) + d * t; }
    else if (typeof x === "number" && typeof y === "number") out[k] = x + (y - x) * t;
    else out[k] = t < 0.5 ? x : y;
  }
  return out as unknown as Look;
};

const smooth = (t: number) => t * t * (3 - 2 * t);

export type LookKey = { f: number; state?: SceneState; look?: Look; dur?: number; ease?: (t: number) => number };

// Состояние сцены в кадре frame по ключам. Ключ {f, state, dur}: к кадру f сцена приходит
// в state, смена начинается в f − dur (по умолчанию 30 кадров). До первого ключа — первый.
export const lookAt = (frame: number, keys: LookKey[]): Look => {
  if (!keys.length) throw new Error("lookAt: нет ключей");
  const ks = [...keys].sort((p, q) => p.f - q.f).map((k) => ({ ...k, L: k.look ?? resolveLook(k.state!) }));
  let cur = ks[0].L;
  for (let i = 1; i < ks.length; i++) {
    const k = ks[i];
    const dur = Math.max(1, k.dur ?? 30);
    const start = k.f - dur;
    if (frame <= start) break;
    const t = Math.min(1, (frame - start) / dur);
    cur = mixLook(cur, k.L, (k.ease ?? smooth)(t));
    if (t < 1) break;
  }
  return cur;
};

// Мерцание «свет гаснет»: 1 до start, неровное мигание, к start+dur — 0 (out) или наоборот (in).
// Сидированный, детерминированный. Пример: windowGlow * flicker(frame, {start: 90, dur: 30}).
export const flicker = (frame: number, o: { start: number; dur?: number; mode?: "out" | "in"; seed?: number }) => {
  const dur = o.dur ?? 30;
  const t = Math.min(1, Math.max(0, (frame - o.start) / dur));
  const env = o.mode === "in" ? t : 1 - t;
  if (t <= 0 || t >= 1) return env;
  const s = o.seed ?? 7;
  const n = Math.sin(frame * 12.9898 + s * 78.233) * 43758.5453;
  const r = n - Math.floor(n);
  const blink = r < 0.3 * (o.mode === "in" ? 1 - t : t) ? 0.15 : 1; // чем ближе к концу, тем чаще провалы
  return env * blink * (0.75 + 0.25 * r);
};

// Направление на солнце (единичный вектор, Y вверх) — для directionalLight в three.
export const sunDirection = (l: Pick<Look, "sunElevation" | "sunAzimuth">): [number, number, number] => {
  const el = (l.sunElevation * Math.PI) / 180, az = (l.sunAzimuth * Math.PI) / 180;
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
};

// Коды погоды WMO (Open-Meteo, MET Norway в пересчёте) → погода пресета.
export const wmoToWeather = (code: number): Weather => {
  if (code <= 1) return "clear";
  if (code <= 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "storm";
  if (code >= 51) return "rain";
  return "cloudy";
};

// Время суток по часу (местному) и, если есть, восходу/закату (часы, дробные).
export const timeOfDayAt = (hour: number, sunrise = 6.5, sunset = 19.5): TimeOfDay => {
  if (hour < sunrise - 0.75 || hour >= sunset + 0.75) return "night";
  if (hour < sunrise + 1) return "dawn";
  if (hour >= sunset - 0.25) return "evening";
  if (hour >= sunset - 1.75) return "golden";
  return "day";
};

// CSS: градиент неба и цветокор картинки под состояние (для 2D/2.5D сцен).
export const skyCss = (l: Look) => `linear-gradient(180deg, ${l.skyTop} 0%, ${mixColor(l.skyTop, l.skyBottom, 0.55)} 45%, ${l.skyBottom} 100%)`;
export const gradeFilter = (l: Look) => {
  const b = Math.pow(2, l.exposure);
  return `brightness(${b.toFixed(3)}) saturate(${l.saturation.toFixed(3)})`;
};
