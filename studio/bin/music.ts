// Музыка ролика: каталог студии (public/music/catalog.json, CC0) или своя под ролик (MUSIC_PROVIDER).
//   studio music                         — список: id, настроение, темп, энергия, длина, лицензия
//   studio music calm | studio music --bpm 90-110 | studio music --energy 3-5
//   studio music --copy id [--job dir]   — скопировать в public/music/ ролика
//   studio music --make "описание" --sec 32 [--id имя] [--job dir]
//   studio music --plan music-plan.json [--id имя] [--job dir]
//                                        — сгенерировать трек под ролик (платно; studio doctor:
//                                          «музыка: генерация»). Повтор того же запроса — из кэша.
// В ролике — <Bed> из @studio/sound-design (под речью приглушается). Резать монтаж по долям
// такта: доля = 60/bpm с; склейки и акценты на долях читаются как ритм, а не как «прыгает».
// Ни каталога, ни генерации — музыка открытым вопросом в notes.md, ролик держит атмосфера места
// (bed.ts: rain/sea/wind/city/roomtone) и звуки событий.
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { die, ensureDir, inJobStrict, jobDir, num, parseArgs, ROOT, str } from "./_lib";
import { cacheDir, ffprobeDuration } from "./_media";
import { music, musicConfig, musicKey, type MusicRequest } from "./_music";

type Track = { id: string; file: string; mood?: string[]; bpm?: number; energy?: number; durSec?: number; loop?: boolean; license?: string; source?: string; trend?: boolean; genre?: string; niche?: string[] };
const DIR = join(ROOT, "public", "music");
const catFile = join(DIR, "catalog.json");
const cat: Track[] = existsSync(catFile) ? JSON.parse(readFileSync(catFile, "utf8")).tracks ?? [] : [];
const a = parseArgs();
const range = (k: string): [number, number] | null => { const v = str(a, k); if (!v) return null; const [x, y] = v.split("-").map(Number); return [x, Number.isFinite(y) ? y : x]; };

const make = str(a, "make"), planArg = str(a, "plan");
const copy = str(a, "copy");
if (make !== undefined || planArg) {
  const dir = jobDir(a);
  const cfg = musicConfig();
  if (!cfg.ready) die(`генерация музыки недоступна: ${cfg.problem}. Возьмите трек из каталога (studio music) или запишите вопрос в notes.md.`);
  let plan: unknown;
  if (planArg) {
    try { plan = JSON.parse(readFileSync(inJobStrict(dir, planArg, "--plan"), "utf8")); } catch (e) { die(`--plan: ${(e as Error).message}`); }
  }
  const req: MusicRequest = { prompt: make, seconds: num(a, "sec"), plan: plan as MusicRequest["plan"] };
  let key: string;
  try { key = musicKey(req); } catch (e) { die((e as Error).message); }
  const cached = join(cacheDir("music"), `${key!}.mp3`);
  const hit = existsSync(cached);
  if (!hit) {
    try {
      const r = await music(req);
      writeFileSync(cached + ".tmp", r.audio);
      renameSync(cached + ".tmp", cached);
    } catch (e) { die(`${(e as Error).message}\nБез своей музыки: трек из каталога (studio music) или атмосфера места (bed.ts).`); }
  }
  const id = (str(a, "id") ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || `gen-${key!}`;
  const dst = join(ensureDir(join(dir, "public", "music")), `${id}.mp3`);
  copyFileSync(cached, dst);
  const dur = ffprobeDuration(dst);
  console.log(`public/music/${id}.mp3  ${dur.toFixed(1)} с${hit ? " (из кэша, бесплатно)" : ""}  → <Bed src={staticFile("music/${id}.mp3")} …/>`);
  console.log(`источник: сгенерировано ${cfg.provider} (${cfg.model}) — запишите в notes.md описание трека и почему он такой.`);
  console.log("Модель не слышит трек: проверьте mixcheck (уровни, хвост) после рендера; склейки — на долях темпа из описания.");
} else if (copy) {
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
  const tags = (t: Track) => [...(t.mood ?? []), ...(t.niche ?? []), t.genre ?? ""];
  // Трендовые треки (поджанры на подъёме в Reels/TikTok) — первыми: старые — только детское, сон, погода.
  const list = [...cat].sort((x, y) => Number(Boolean(y.trend)) - Number(Boolean(x.trend))).filter((t) => (!q || t.id.includes(q) || tags(t).some((m) => m.toLowerCase().includes(q)))
    && (!bpm || (t.bpm !== undefined && t.bpm >= bpm[0] && t.bpm <= bpm[1])) && (!en || (t.energy !== undefined && t.energy >= en[0] && t.energy <= en[1])));
  for (const t of list) console.log(`${t.trend ? "ТРЕНД " : ""}${t.id}\t${t.genre ? t.genre + "; " : ""}${tags(t).filter((x) => x && x !== t.genre).join(",")}\t${t.bpm ?? "?"} bpm\tэнергия ${t.energy ?? "?"}\t${t.durSec?.toFixed(0) ?? "?"} с${t.loop ? " петля" : ""}\t${t.license ?? "?"}`);
  console.error(`${list.length} из ${cat.length} треков`);
}
