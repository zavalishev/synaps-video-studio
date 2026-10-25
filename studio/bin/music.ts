// Каталог музыки (лицензированные треки владельца): public/music/catalog.json репозитория.
//   studio music                         — список: id, настроение, темп, энергия, длина, лицензия
//   studio music calm | studio music --bpm 90-110 | studio music --energy 3-5
//   studio music --copy id [--job dir]   — скопировать в public/music/ ролика
// В ролике — <Bed> из @studio/sound-design (под речью приглушается). Резать монтаж по долям
// такта: доля = 60/bpm с; склейки и акценты на долях читаются как ритм, а не как «прыгает».
// Пустой каталог — нормальная ситуация: тогда музыка — открытый вопрос в notes.md
// («музыки нет: владелец добавит звук площадки в приложении»), а ролик держит атмосфера места
// (bed.ts: rain/sea/wind/city/roomtone) и звуки событий. Генерация музыки — только по «да».
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { die, ensureDir, jobDir, parseArgs, ROOT, str } from "./_lib";

type Track = { id: string; file: string; mood?: string[]; bpm?: number; energy?: number; durSec?: number; loop?: boolean; license?: string; source?: string };
const DIR = join(ROOT, "public", "music");
const catFile = join(DIR, "catalog.json");
const cat: Track[] = existsSync(catFile) ? JSON.parse(readFileSync(catFile, "utf8")).tracks ?? [] : [];
const a = parseArgs();
const range = (k: string): [number, number] | null => { const v = str(a, k); if (!v) return null; const [x, y] = v.split("-").map(Number); return [x, Number.isFinite(y) ? y : x]; };

const copy = str(a, "copy");
if (copy) {
  const t = cat.find((x) => x.id === copy) ?? die(`нет трека ${copy} (studio music — список)`);
  const dst = ensureDir(join(jobDir(a), "public", "music"));
  copyFileSync(join(DIR, t.file), join(dst, t.file));
  console.log(`public/music/${t.file}  → staticFile("music/${t.file}"); лицензия: ${t.license ?? "?"} (${t.source ?? "—"}) — запишите в notes.md`);
} else if (!cat.length) {
  console.log("каталог музыки пуст (public/music/catalog.json).");
  console.log("Музыки нет → в notes.md открытым вопросом: «музыка: нет лицензированной; владелец добавит звук площадки».");
  console.log("Ролик держат атмосфера места (bed.ts --kind rain|sea|wind|city|roomtone), звуки событий в паузах речи и акцент на крючке.");
} else {
  const q = a._[0]?.toLowerCase();
  const bpm = range("bpm"), en = range("energy");
  const list = cat.filter((t) => (!q || t.id.includes(q) || (t.mood ?? []).some((m) => m.toLowerCase().includes(q)))
    && (!bpm || (t.bpm !== undefined && t.bpm >= bpm[0] && t.bpm <= bpm[1])) && (!en || (t.energy !== undefined && t.energy >= en[0] && t.energy <= en[1])));
  for (const t of list) console.log(`${t.id}\t${(t.mood ?? []).join(",")}\t${t.bpm ?? "?"} bpm\tэнергия ${t.energy ?? "?"}\t${t.durSec?.toFixed(0) ?? "?"} с${t.loop ? " петля" : ""}\t${t.license ?? "?"}`);
  console.error(`${list.length} из ${cat.length} треков`);
}
