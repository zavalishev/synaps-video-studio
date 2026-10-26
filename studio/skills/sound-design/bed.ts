// Подложка и атмосфера места без лицензий и без денег: синтез ffmpeg. Это «воздух» и звук
// места, а НЕ музыка — музыка своя (`studio music --make/--plan`, если подключена) или из каталога;
// нет ни той ни другой — это открытый вопрос в notes.md, а не молчаливая норма.
//   npx tsx .claude/skills/sound-design/bed.ts [--kind roomtone|pad|rain|rain-heavy|sea|wind|city|fire|night]
//        [--sec 20] [--root 110] [--seed 7] [--out public/music/<kind>.wav]
//   roomtone   — тёплый шум комнаты (убирает «цифровую» тишину между репликами);
//   pad        — тихий мягкий аккорд (мажорная нона от --root Гц), медленное дыхание громкости;
//   rain       — дождь: шелест по листьям/крыше; rain-heavy — ливень с низом;
//   sea        — прибой: накат и откат волн каждые ~6–8 с;
//   wind       — ветер: порывы с медленным подъёмом и спадом;
//   city       — далёкий город: гул и лёгкое движение;
//   fire       — свеча/камин: редкие сухие потрескивания (деревянный фитиль, поленья) поверх
//                тихого низкого гула пламени; детерминированно (--seed);
//   night      — ночной лес/луг: два сверчка (трели ~4.3 и ~5 кГц неровным ритмом) над тихим
//                воздухом; для сказки, вечера, сна.
// Одиночные звуки, которых нет в каталоге (спичка, треск, лента/ткань, рвётся бумага), —
// sfxsynth.ts в этой же папке.
// Атмосфера отвечает на вопрос «как звучит это место?» — ролик про дождь без дождя звучит пусто.
// Громкость файла −24 LUFS; в ролике <Bed base≈0.5 under≈0.15> — дальше решает ухо директора
// по mixcheck (между репликами на 8–14 дБ ниже речи).
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { die, jobDir, num, parseArgs, str } from "../../bin/_lib";

const a = parseArgs(process.argv.slice(2));
const dir = jobDir(a);
const kind = str(a, "kind", "pad")!;
const sec = num(a, "sec", 20)!;
const root = num(a, "root", 110)!;
const seed = num(a, "seed", 7)!;
const out = resolve(dir, str(a, "out", `public/music/${kind}.wav`)!);
mkdirSync(dirname(out), { recursive: true });

let src: string[];
if (kind === "roomtone") {
  src = ["-f", "lavfi", "-i", `anoisesrc=d=${sec}:c=brown:r=48000:a=0.5:seed=7`, "-af", "lowpass=f=500,highpass=f=40,loudnorm=I=-24:TP=-6:LRA=7"];
} else if (kind === "pad") {
  // Аккорд: 1, 5, 9, 3 (через октаву), лёгкая расстройка — «хор»; медленное дыхание 0.12 Гц.
  const f = [1, 1.5, 2.25, 2.52].map((m) => root * m);
  const voice = (hz: number, k: number) => `(sin(2*PI*${hz.toFixed(3)}*t)+0.6*sin(2*PI*${(hz * 1.004).toFixed(3)}*t+${k}))`;
  const expr = `(${f.map((hz, k) => voice(hz, k + 1)).join("+")})*0.06*(0.75+0.25*sin(2*PI*0.12*t))*min(1\\,t/2)*min(1\\,(${sec}-t)/2)`;
  src = ["-f", "lavfi", "-i", `aevalsrc=${expr}:s=48000:d=${sec}`, "-af", "lowpass=f=1400,aecho=0.8:0.6:120|240:0.25|0.15,loudnorm=I=-24:TP=-6:LRA=7"];
} else if (kind === "rain" || kind === "rain-heavy") {
  const heavy = kind === "rain-heavy";
  // Шелест: розовый шум в верхней середине + редкие «капли» (белый шум, рваный по громкости).
  src = ["-f", "lavfi", "-i", `anoisesrc=d=${sec}:c=pink:r=48000:a=0.6:seed=${seed}`, "-f", "lavfi", "-i", `anoisesrc=d=${sec}:c=white:r=48000:a=0.3:seed=${seed + 1}`, "-f", "lavfi", "-i", `anoisesrc=d=${sec}:c=brown:r=48000:a=0.5:seed=${seed + 2}`,
    "-filter_complex", `[0]highpass=f=${heavy ? 300 : 700},lowpass=f=${heavy ? 7000 : 9000}[s];[1]highpass=f=2500,volume='0.25+0.75*gt(sin(2*PI*t*13.7)*sin(2*PI*t*7.3)\,0.6)':eval=frame[d];[2]lowpass=f=250,volume=${heavy ? 0.9 : 0.25}[l];[s][d][l]amix=inputs=3:normalize=0,afade=t=in:d=1.5,afade=t=out:st=${Math.max(0, sec - 1.5)}:d=1.5,loudnorm=I=-24:TP=-6:LRA=7`];
} else if (kind === "sea") {
  // Прибой: низ и шипение пены, громкость «накатывает» с периодом ~7 с.
  src = ["-f", "lavfi", "-i", `anoisesrc=d=${sec}:c=brown:r=48000:a=0.7:seed=${seed}`, "-f", "lavfi", "-i", `anoisesrc=d=${sec}:c=pink:r=48000:a=0.4:seed=${seed + 1}`,
    "-filter_complex", `[0]lowpass=f=600,volume='0.35+0.65*pow(0.5+0.5*sin(2*PI*t/7.1)\,2)':eval=frame[a];[1]highpass=f=1500,lowpass=f=8000,volume='0.1+0.9*pow(0.5+0.5*sin(2*PI*t/7.1-0.9)\,4)':eval=frame[b];[a][b]amix=inputs=2:normalize=0,afade=t=in:d=2,afade=t=out:st=${Math.max(0, sec - 2)}:d=2,loudnorm=I=-24:TP=-6:LRA=9`];
} else if (kind === "wind") {
  src = ["-f", "lavfi", "-i", `anoisesrc=d=${sec}:c=pink:r=48000:a=0.7:seed=${seed}`,
    "-af", `bandpass=f=500:width_type=h:w=700,volume='0.25+0.75*pow(0.5+0.5*sin(2*PI*t/9.3)*sin(2*PI*t/4.1+1)\,2)':eval=frame,afade=t=in:d=2,afade=t=out:st=${Math.max(0, sec - 2)}:d=2,loudnorm=I=-24:TP=-6:LRA=9`];
} else if (kind === "city") {
  src = ["-f", "lavfi", "-i", `anoisesrc=d=${sec}:c=brown:r=48000:a=0.6:seed=${seed}`, "-f", "lavfi", "-i", `anoisesrc=d=${sec}:c=pink:r=48000:a=0.2:seed=${seed + 1}`,
    "-filter_complex", `[0]lowpass=f=350,highpass=f=35[a];[1]bandpass=f=1200:width_type=h:w=1500,volume='0.3+0.7*pow(0.5+0.5*sin(2*PI*t/11.0)\,3)':eval=frame[b];[a][b]amix=inputs=2:normalize=0,afade=t=in:d=2,afade=t=out:st=${Math.max(0, sec - 2)}:d=2,loudnorm=I=-24:TP=-6:LRA=7`];
} else if (kind === "fire") {
  // Треск: редкие импульсы (гуще пачками) → огибающая 3–8 мс → умножение на белый шум;
  // под ним — низкий «вдох» пламени. random() в aevalsrc детерминирован; сид меняет фазу пачек.
  const ph = (seed % 17) * 0.37;
  src = ["-f", "lavfi", "-i", `aevalsrc=lt(random(0)\\,0.00008*(1+4*gt(sin(2*PI*t*0.7+${ph.toFixed(2)}+sin(t*1.3))\\,0.7)))*(0.3+0.7*random(1)):s=48000:d=${sec}`,
    "-f", "lavfi", "-i", `anoisesrc=d=${sec}:c=white:r=48000:a=1:seed=${seed + 1}`, "-f", "lavfi", "-i", `anoisesrc=d=${sec}:c=brown:r=48000:a=0.5:seed=${seed}`,
    "-filter_complex", `[0]lowpass=f=120,lowpass=f=120,aeval=min(1\\,abs(val(0))*300)[env];[env][1]amultiply,highpass=f=500,lowpass=f=8000[c];[2]lowpass=f=240,highpass=f=40,volume='0.5+0.3*sin(2*PI*t*0.37)*sin(2*PI*t*0.11)':eval=frame[r];[c][r]amix=inputs=2:normalize=0:weights=1 0.5,afade=t=in:d=1,afade=t=out:st=${Math.max(0, sec - 1)}:d=1,loudnorm=I=-24:TP=-3:LRA=15`];
} else if (kind === "night") {
  // Сверчок: несущая 4.3/5 кГц × пульсы ~28/33 Гц внутри трели × неровные трели (сумма двух
  // медленных синусов > порога). Два сверчка в разных фазах + тихий низкий воздух.
  const ph = (seed % 11) * 0.53;
  const cricket = (hz: number, pr: number, rate: number, p0: number) => `sin(2*PI*${hz}*t)*gt(sin(2*PI*${pr}*t)\\,0.2)*gt(sin(2*PI*${rate}*t+${p0.toFixed(2)})+0.6*sin(2*PI*0.23*t+${(p0 * 2).toFixed(2)})\\,0.5)`;
  src = ["-f", "lavfi", "-i", `aevalsrc=0.5*${cricket(4300, 28, 0.9, ph)}+0.35*${cricket(5000, 33, 0.63, ph + 1.7)}:s=48000:d=${sec}`, "-f", "lavfi", "-i", `anoisesrc=d=${sec}:c=brown:r=48000:a=0.4:seed=${seed}`,
    "-filter_complex", `[0]bandpass=f=4600:width_type=h:w=2400,aecho=0.6:0.4:60|130:0.2|0.1,volume=0.5[c];[1]lowpass=f=300,highpass=f=40[r];[c][r]amix=inputs=2:normalize=0:weights=1 0.6,afade=t=in:d=2,afade=t=out:st=${Math.max(0, sec - 2)}:d=2,loudnorm=I=-24:TP=-6:LRA=9`];
} else die(`неизвестный --kind ${kind}: roomtone | pad | rain | rain-heavy | sea | wind | city | fire | night`);
const r = spawnSync("ffmpeg", ["-y", "-v", "error", ...src!, "-ac", "1", "-ar", "48000", out], { encoding: "utf8" });
if (r.status !== 0) die(r.stderr);
console.log(`${out}  → staticFile("${out.split("/public/")[1] ?? out}")`);
