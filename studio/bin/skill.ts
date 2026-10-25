// Карточка скилла вместо всего SKILL.md: что это, когда брать, главное API и ловушки.
//   studio skill                       — список скиллов (одна строка на скилл)
//   studio skill <имя> [<имя2> …]      — карточки (до «## Подробности»)
//   studio skill <имя> --section текст — один раздел подробностей (по части заголовка)
//   studio skill <имя> --full          — весь SKILL.md (только когда карточки не хватило)
// Карточка ≈ 1–2 тыс. знаков против 7–16 тыс. у полного файла: директор несёт её в контексте
// весь прогон, поэтому читается только то, что нужно сейчас.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, STUDIO } from "./_lib";

const a = parseArgs(process.argv.slice(2), ["full"]);
const SK = join(STUDIO, "skills");
const names = readdirSync(SK, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(SK, d.name, "SKILL.md"))).map((d) => d.name);
const desc = (md: string) => md.match(/^description:\s*(.+)$/m)?.[1] ?? "";

if (!a._.length) {
  for (const n of names) { const d = desc(readFileSync(join(SK, n, "SKILL.md"), "utf8")).split(/\. /)[0]; console.log(`${n} — ${d.length > 120 ? d.slice(0, 117) + "…" : d}`); }
  console.log("\nstudio skill <имя> — карточка; --section <раздел> — один раздел; --full — весь файл");
  process.exit(0);
}
for (const n of a._) {
  if (!names.includes(n)) { console.error(`нет скилла ${n}; есть: ${names.join(", ")}`); process.exitCode = 2; continue; }
  const md = readFileSync(join(SK, n, "SKILL.md"), "utf8");
  const body = md.replace(/^---[\s\S]*?---\n/, "");
  const sec = typeof a.section === "string" ? a.section.toLowerCase() : null;
  if (a.full) { console.log(body); continue; }
  if (sec) {
    const parts = body.split(/\n(?=## )/);
    const hit = parts.filter((p) => p.split("\n")[0].toLowerCase().includes(sec));
    console.log(hit.length ? hit.join("\n") : `в ${n} нет раздела «${a.section}»; разделы: ${parts.map((p) => p.split("\n")[0].replace(/^#+\s*/, "")).join(" | ")}`);
    continue;
  }
  const cut = body.search(/\n## Подробности/);
  const card = cut > 0 ? body.slice(0, cut) : body.split("\n").slice(0, 40).join("\n") + "\n…(карточки нет — первые 40 строк; --full для всего)";
  const rest = cut > 0 ? body.slice(cut).split(/\n(?=## )/).map((p) => p.split("\n")[0].replace(/^#+\s*/, "")).filter((h) => h && !h.startsWith("Подробности")) : [];
  console.log(`${card.trim()}${rest.length ? `\n\n(подробности по нужде — studio skill ${n} --section …: ${rest.join(" | ")})` : ""}\n`);
}
