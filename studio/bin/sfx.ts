// Каталог звуков (CC0, kenney): public/sfx репозитория.
//   studio sfx                    — список: id, семейство, длина, путь
//   studio sfx pop                — только семейство/поиск
//   studio sfx --copy pop1,whoosh2 [--job dir]  — скопировать в public/sfx/ ролика
// В ролике: <Audio src={staticFile("sfx/pop1.wav")} volume={0.6} /> внутри <Sequence from={кадр}>.
// Звук на событие (появление, склейка) — ±1 кадр от события; не больше одного на 0.5 с.
import { copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { die, ensureDir, jobDir, parseArgs, ROOT, str } from "./_lib";

const DIR = join(ROOT, "public", "sfx");
const cat = JSON.parse(readFileSync(join(DIR, "catalog.json"), "utf8")).sounds as Array<{ id: string; family: string; durSec: number }>;
const a = parseArgs();
const copy = str(a, "copy");
if (copy) {
  const dir = jobDir(a);
  const dst = ensureDir(join(dir, "public", "sfx"));
  for (const id of copy.split(",").map((s) => s.trim())) {
    if (!cat.some((s) => s.id === id)) die(`нет звука ${id}`);
    copyFileSync(join(DIR, `${id}.wav`), join(dst, `${id}.wav`));
    console.log(`public/sfx/${id}.wav  → staticFile("sfx/${id}.wav")`);
  }
} else {
  const q = a._[0];
  const list = q ? cat.filter((s) => s.family === q || s.id.includes(q)) : cat;
  for (const s of list) console.log(`${s.id}\t${s.family}\t${s.durSec.toFixed(2)} с\t${join(DIR, s.id + ".wav")}`);
  console.error(`${list.length} звуков; семейства: ${[...new Set(cat.map((s) => s.family))].join(", ")}`);
}
