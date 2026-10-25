// Look из состояния сцены — в JSON (для Blender: scene_state.py, или чтобы посмотреть числа).
//   npx tsx studio/lib/scene-state/look.ts --time night --weather rain --season autumn [--set fog=0.4] [--out assets/look.json]
import { writeFileSync } from "node:fs";
import { resolveLook, type SceneState } from "./state";

const argv = process.argv.slice(2);
const get = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const overrides: Record<string, number | string> = {};
for (let i = 0; i < argv.length; i++) if (argv[i] === "--set") {
  const [k, v] = argv[i + 1].split("=");
  overrides[k] = Number.isFinite(Number(v)) ? Number(v) : v;
}
const state = { time: get("time") ?? "day", weather: get("weather"), season: get("season"), overrides } as SceneState;
const look = resolveLook(state);
const json = JSON.stringify({ state, look }, null, 1);
const out = get("out");
if (out) { writeFileSync(out, json + "\n"); console.log(out); } else console.log(json);
