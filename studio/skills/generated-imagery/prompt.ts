// Промпт картинки из стиля реестра и роли (без вызова модели, бесплатно).
//   npx tsx ../../studio/skills/generated-imagery/prompt.ts --style felt --role cutout "a fox barista in an apron" \
//       [--extra "holding a cup, waving"] [--palette "rust orange, cream, teal"] [--same] [--out assets/prompts/fox.txt]
//   --list — показать стили (id, название, для чего).
// Дальше: studio image --prompt-file assets/prompts/fox.txt --bg transparent [--ref img/sheet.png]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { STYLES, ROLES, stylePrompt } from "../../lib/generated-imagery/prompt";

const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const flag = (k: string) => argv.includes(`--${k}`);
if (flag("list")) {
  for (const s of STYLES) console.log(`${s.id.padEnd(16)} ${s.ru_label.padEnd(22)} ${s.best_for}`);
  console.log(`\nроли: ${Object.keys(ROLES).filter((r) => r !== "same-character").join(", ")}`);
  process.exit(0);
}
const valued = new Set(["style", "role", "extra", "palette", "out"]);
const subject = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && valued.has(argv[i - 1].replace(/^--/, "")))).join(" ");
const style = opt("style"), role = opt("role") as keyof typeof ROLES | undefined;
if (!subject || !style || !role || !(role in ROLES)) {
  console.error('нужно: --style <id|свой текст> --role cutout|prop|backdrop|sheet "субъект"  (--list — стили)');
  process.exit(2);
}
const text = stylePrompt({ subject, role, style, extra: opt("extra"), palette: opt("palette"), sameCharacter: flag("same") });
const out = opt("out");
if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, text + "\n"); console.error(`→ ${out}`); }
console.log(text);
