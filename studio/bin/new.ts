// Новая папка ролика из шаблона, без запуска директора.
//   studio new <slug> [--brief brief.md|"текст"] [--width 1080 --height 1920 --fps 30] [--author "@handle"] [--brand dir]
import { existsSync, readFileSync } from "node:fs";
import { createJob, slugify } from "./_job";
import { die, num, parseArgs, str } from "./_lib";

const a = parseArgs();
const slug = a._[0] ? slugify(a._[0]) : die("нужен slug: studio new <slug>");
const b = str(a, "brief");
const brief = b === undefined ? undefined : existsSync(b) ? readFileSync(b, "utf8") : b;
try {
  console.log(createJob(slug, { brief, width: num(a, "width"), height: num(a, "height"), fps: num(a, "fps"), author: str(a, "author"), brand: str(a, "brand") }));
} catch (e) { die((e as Error).message); }
