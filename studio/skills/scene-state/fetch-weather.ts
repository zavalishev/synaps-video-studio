// Реальная погода → состояние сцены (Open-Meteo, без ключа, CC BY 4.0 — атрибуция в кадре обязательна).
//   npx tsx .claude/skills/scene-state/fetch-weather.ts --lat 55.75 --lon 37.62 [--place "Москва"] [--out public/data/weather.json]
// Пишет: {place, fetchedAt, attribution, current:{temp, code, wind, precip, isDay, hour}, state:{time, weather, season}}.
// Кэш — сам файл: рендер читает его через staticFile/импорт и не зависит от сети. Повторный
// запуск перезаписывает (новые данные), поэтому вызывайте один раз на ролик.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { timeOfDayAt, wmoToWeather, type Season } from "../../lib/scene-state/state";

const argv = process.argv.slice(2);
const get = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const lat = Number(get("lat")), lon = Number(get("lon"));
if (!Number.isFinite(lat) || !Number.isFinite(lon)) { console.error("нужны --lat и --lon"); process.exit(1); }
const out = get("out") ?? "public/data/weather.json";

const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m,precipitation,is_day&daily=sunrise,sunset&timezone=auto&forecast_days=1`;
const res = await fetch(url);
if (!res.ok) { console.error(`Open-Meteo: ${res.status}`); process.exit(1); }
const d = await res.json() as {
  current: { time: string; temperature_2m: number; weather_code: number; wind_speed_10m: number; precipitation: number; is_day: number };
  daily: { sunrise: string[]; sunset: string[] };
};
const hourOf = (iso: string) => { const t = iso.split("T")[1] ?? "12:00"; const [h, m] = t.split(":").map(Number); return h + m / 60; };
const hour = hourOf(d.current.time);
const month = Number(d.current.time.slice(5, 7));
const south = lat < 0;
const seasonOf = (m: number): Season => { const s: Season[] = ["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "autumn", "autumn", "autumn", "winter"]; return s[(south ? m + 5 : m - 1) % 12]; };
const result = {
  place: get("place") ?? `${lat},${lon}`,
  fetchedAt: d.current.time,
  attribution: "Погода: Open-Meteo.com, CC BY 4.0",
  current: { temp: d.current.temperature_2m, code: d.current.weather_code, wind: d.current.wind_speed_10m, precip: d.current.precipitation, isDay: d.current.is_day === 1, hour },
  state: { time: timeOfDayAt(hour, hourOf(d.daily.sunrise[0]), hourOf(d.daily.sunset[0])), weather: wmoToWeather(d.current.weather_code), season: seasonOf(month) },
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(result, null, 1) + "\n");
console.log(out);
console.log(JSON.stringify(result.state), `${result.current.temp}°, код ${result.current.code}`);
