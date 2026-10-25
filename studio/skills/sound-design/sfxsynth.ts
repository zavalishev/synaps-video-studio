// Одиночные звуки, которых нет в каталоге CC0 (`studio sfx`), — синтез ffmpeg, бесплатно,
// детерминированно. Звук мира предмета: свеча — чирк спички и треск фитиля, подарок — шорох
// ленты и бумаги. Выбор, ставить ли звук и куда, — за директором.
//   npx tsx .claude/skills/sound-design/sfxsynth.ts --kind match|crackle|rustle|tear|chime|hoot [--seed 3] [--id имя]
//   match    — чирк спички: сухое трение 0.15 с → вспышка пламени, затухает за ~0.7 с;
//   crackle  — короткая пачка потрескиваний (фитиль, полено) ~0.8 с;
//   rustle   — шорох ткани/ленты/упаковки ~1 с (завязать бант, развернуть);
//   tear     — рвётся бумага/крафт ~0.6 с;
//   chime    — мягкий колокольчик «динь» (2–3 синусовых обертона, экспоненциальный спад) ~1.6 с:
//              загорелся огонёк, появилось чудо, сказочный акцент; --seed сдвигает высоту;
//   hoot     — сова «у-ху»: два мягких скольжения тона ~380→300 Гц с дыханием ~1.3 с.
// Кладёт public/sfx/<id>.wav (id = kind, если не задан) → в sfx.json: {"atSec": 2.4, "id": "match"}.
// Громкость файла ≈ пик −3 дБFS, как у каталога: в SfxTrack volume 0.2–0.45.
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { die, jobDir, num, parseArgs, str } from "../../bin/_lib";

const a = parseArgs(process.argv.slice(2));
const dir = jobDir(a);
const kind = str(a, "kind") ?? die("нужен --kind match|crackle|rustle|tear|chime|hoot");
const seed = num(a, "seed", 3)!;
const id = str(a, "id", kind)!;
const out = join(dir, "public", "sfx", `${id}.wav`);
mkdirSync(join(dir, "public", "sfx"), { recursive: true });

const norm = "alimiter=limit=0.7:level=false,loudnorm=I=-20:TP=-3:LRA=15";
const noise = (d: number, c: string, s: number) => ["-f", "lavfi", "-i", `anoisesrc=d=${d}:c=${c}:r=48000:a=1:seed=${s}`];
let args: string[];
if (kind === "match") {
  // трение: полосовой шум с рваной огибающей; вспышка: розовый шум, быстрый подъём, спад.
  args = [...noise(1.0, "white", seed), ...noise(1.0, "pink", seed + 1),
    "-filter_complex", `[0]bandpass=f=3200:width_type=h:w=2600,volume='if(lt(t\\,0.16)\\,(0.6+0.4*sin(2*PI*t*90))*(1-t/0.16)\\,0)':eval=frame[s];[1]lowpass=f=2500,highpass=f=150,volume='if(lt(t\\,0.12)\\,0\\,min(1\\,(t-0.12)/0.04)*exp(-(t-0.12)*4.5))':eval=frame[f];[s][f]amix=inputs=2:normalize=0:weights=1 0.7,${norm}`];
} else if (kind === "crackle") {
  args = ["-f", "lavfi", "-i", `aevalsrc=lt(random(0)\\,0.0006*(0.2+sin(PI*t/0.8)))*(0.4+0.6*random(1)):s=48000:d=0.8`, ...noise(0.8, "white", seed),
    "-filter_complex", `[0]lowpass=f=120,lowpass=f=120,aeval=min(1\\,abs(val(0))*300)[e];[e][1]amultiply,highpass=f=600,lowpass=f=8000,${norm}`];
} else if (kind === "rustle") {
  args = [...noise(1.1, "pink", seed),
    "-filter_complex", `[0]bandpass=f=3800:width_type=h:w=5000,volume='(0.3+0.7*pow(abs(sin(2*PI*t*3.1+${seed})*sin(2*PI*t*7.7))\\,0.7))*sin(PI*t/1.1)':eval=frame,${norm}`];
} else if (kind === "tear") {
  args = ["-f", "lavfi", "-i", `aevalsrc=lt(random(0)\\,0.004)*(0.5+0.5*random(1)):s=48000:d=0.6`, ...noise(0.6, "white", seed),
    "-filter_complex", `[0]lowpass=f=300,aeval=min(1\\,abs(val(0))*60)[e];[e][1]amultiply,highpass=f=900,lowpass=f=9000,volume='min(1\\,t/0.05)*(1-0.6*t/0.6)':eval=frame,${norm}`];
} else if (kind === "chime") {
  // Колокольчик: основной тон + негармонические обертоны (2.76, 5.4 — как у металлической
  // пластины), быстрый мягкий удар, обертоны гаснут быстрее основного.
  const f0 = 1320 * 2 ** (((seed % 5) - 2) / 12);
  args = ["-f", "lavfi", "-i", `aevalsrc=(sin(2*PI*${f0.toFixed(1)}*t)+0.45*sin(2*PI*${(f0 * 2.76).toFixed(1)}*t)*exp(-t*3)+0.2*sin(2*PI*${(f0 * 5.4).toFixed(1)}*t)*exp(-t*7))*exp(-t*2.4)*min(1\\,t/0.004):s=48000:d=1.6`,
    "-af", `aecho=0.7:0.5:90|170:0.2|0.12,${norm}`];
} else if (kind === "hoot") {
  // «у-ху»: два гласных скольжения (фаза — интеграл линейной частоты), огибающая-синус с мягкой
  // атакой, второй обертон чуть слышен, сверху дыхание; всё глушится ниже 1.2 кГц (далеко в лесу).
  const k = 1 + ((seed % 3) - 1) * 0.04;
  const hoot = (t0: number, d: number, f1: number, f2: number) => `between(t\\,${t0}\\,${t0 + d})*pow(abs(sin(PI*(t-${t0})/${d}))\\,1.6)*(sin(2*PI*(${(f1 * k).toFixed(1)}*(t-${t0})+${((f2 - f1) * k / (2 * d)).toFixed(2)}*(t-${t0})*(t-${t0})))+0.15*sin(4*PI*(${(f1 * k).toFixed(1)}*(t-${t0})+${((f2 - f1) * k / (2 * d)).toFixed(2)}*(t-${t0})*(t-${t0}))))`;
  args = ["-f", "lavfi", "-i", `aevalsrc=${hoot(0.05, 0.32, 390, 350)}+${hoot(0.55, 0.7, 370, 300)}:s=48000:d=1.35`, ...noise(1.35, "pink", seed),
    "-filter_complex", `[1]lowpass=f=900,volume=0.06[b];[0][b]amix=inputs=2:normalize=0,lowpass=f=1200,aecho=0.8:0.6:140|260:0.25|0.15,${norm}`];
} else die(`неизвестный --kind ${kind}: match | crackle | rustle | tear | chime | hoot`);
const r = spawnSync("ffmpeg", ["-y", "-v", "error", ...args!, "-ac", "1", "-ar", "48000", out], { encoding: "utf8" });
if (r.status !== 0) die(r.stderr);
console.log(`public/sfx/${id}.wav  → sfx.json {"atSec": …, "id": "${id}"}`);
