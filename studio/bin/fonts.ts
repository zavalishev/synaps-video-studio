// Шрифты Google с кириллицей (из @remotion/google-fonts, без сети).
//   studio fonts                — список всех семейств с кириллицей (имя модуля, начертания)
//   studio fonts <часть имени>  — поиск
//   studio fonts --rebuild      — пересобрать studio/lib/fonts-cyrillic.json
//   studio fonts --suggest [голос] [--seed slug] — 6 семейств под «голос» шрифта (poster-condensed,
//        heavy-grotesk, warm-serif, display-serif, hand-marker, slab, mono-ledger, rounded-kid,
//        tech, quirky-display, clean-grotesk) в порядке, перемешанном по ролику: разные ролики
//        видят разные первые варианты. Помечает семейства, уже взятые в последних роликах
//        (jobs/*/theme.json) — чтобы студия не говорила одним шрифтом.
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JOBS_DIR, LIB, parseArgs, ROOT } from "./_lib";
import { recentLooks } from "./_looks";

type Entry = { family: string; module: string; styles: Record<string, string[]> };
const OUT = join(LIB, "fonts-cyrillic.json");

const rebuild = (): Entry[] => {
  const req = createRequire(join(ROOT, "package.json"));
  const dir = join(ROOT, "node_modules/@remotion/google-fonts/dist/cjs");
  const out: Entry[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".js") && x !== "index.js" && !x.startsWith("base"))) {
    const mod = f.replace(/\.js$/, "");
    let info: { fontFamily: string; fonts: Record<string, Record<string, Record<string, string>>> };
    try { info = req(`@remotion/google-fonts/${mod}`).getInfo(); } catch { continue; }
    if (!info?.fonts) continue;
    const styles: Record<string, string[]> = {};
    for (const [st, ws] of Object.entries(info.fonts)) {
      const ok = Object.entries(ws).filter(([, subs]) => "cyrillic" in subs).map(([w]) => w);
      if (ok.length) styles[st] = ok;
    }
    if (Object.keys(styles).length) out.push({ family: info.fontFamily, module: mod, styles });
  }
  writeFileSync(OUT, JSON.stringify(out, null, 0).replace(/\},\{/g, "},\n{") + "\n");
  return out;
};

const a = parseArgs(process.argv.slice(2), ["rebuild"]);
const list: Entry[] = a.rebuild || !existsSync(OUT) ? rebuild() : JSON.parse(readFileSync(OUT, "utf8"));

if (a.suggest !== undefined) {
  const voices = JSON.parse(readFileSync(join(LIB, "font-voices.json"), "utf8")) as Record<string, string[]>;
  const voice = typeof a.suggest === "string" ? a.suggest : a._[0];
  if (!voice || !voices[voice]) {
    console.log(`голоса шрифта: ${Object.keys(voices).join(", ")}\nstudio fonts --suggest <голос> [--seed slug]`);
    process.exit(voice ? 2 : 0);
  }
  // Детерминированное перемешивание по ролику (seed — slug папки).
  const seed = String(a.seed ?? process.env.STUDIO_JOB?.split("/").pop() ?? process.cwd().split("/").pop() ?? "");
  let h = 2166136261;
  for (const c of seed + voice) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0), h / 4294967296);
  const pool = [...voices[voice]].map((m) => ({ m, k: rnd() })).sort((p, q) => p.k - q.k).map((x) => x.m);
  // Частые в последних роликах: display/caption из jobs/*/theme.json (последние 12 по времени).
  const recent = new Map<string, number>();
  const jobs = JOBS_DIR;
  if (existsSync(jobs)) {
    const dirs = readdirSync(jobs).filter((d) => !d.startsWith("_") && existsSync(join(jobs, d, "theme.json"))).map((d) => ({ d, t: statSync(join(jobs, d, "theme.json")).mtimeMs })).sort((p, q) => q.t - p.t).slice(0, 12);
    for (const { d } of dirs) {
      try { const t = JSON.parse(readFileSync(join(jobs, d, "theme.json"), "utf8")); for (const r of ["display", "caption"]) { const m = t.fonts?.[r]?.module; if (m) recent.set(m, (recent.get(m) ?? 0) + 1); } } catch { /* нет темы */ }
    }
  }
  // Голос считается по реестру студии и соседним роликам: другое семейство того же голоса —
  // тот же голос (Sofia Sans Extra Condensed → Alumni Sans → Fira Sans Extra Condensed).
  const looks = recentLooks(process.env.STUDIO_JOB ?? null, 8);
  const nVoice = looks.filter((l) => l.voice === voice).length;
  if (nVoice >= 2) console.log(`«${voice}» — голос ${nVoice} из ${looks.length} последних роликов студии: смена семейства внутри голоса облик не меняет. Другой голос — или причина в why`);
  console.log(`голос «${voice}» — варианты для этого ролика (порядок перемешан, не рейтинг):`);
  for (const m of pool.slice(0, 6)) {
    const e = list.find((x) => x.module === m);
    if (!e) continue;
    const n = recent.get(m) ?? 0;
    console.log(`  ${e.family}\t@remotion/google-fonts/${m}\t${Object.entries(e.styles).map(([s0, w]) => `${s0}:${w.join(",")}`).join(" ")}${n ? `\t← уже в ${n} из последних роликов` : ""}`);
  }
  process.exit(0);
}
const q = a._[0]?.toLowerCase();
const shown = q ? list.filter((e) => e.family.toLowerCase().includes(q) || e.module.toLowerCase().includes(q)) : list;
for (const e of shown) console.log(`${e.family}\t@remotion/google-fonts/${e.module}\t${Object.entries(e.styles).map(([s, w]) => `${s}:${w.join(",")}`).join(" ")}`);
console.error(`${shown.length} из ${list.length} семейств с кириллицей`);
