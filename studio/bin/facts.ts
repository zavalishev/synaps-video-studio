// Факты брифа: даты и дни недели, числа, регулируемая категория — бесплатно, без вкуса.
//   studio facts [brief.md] [--job dir]  → печать + out/facts.json
// Логика — studio/skills/claims-and-compliance/facts.ts (её же зовёт review.ts).
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, jobDir, parseArgs } from "./_lib";
import { factsReport } from "../skills/claims-and-compliance/facts";

const a = parseArgs();
const dir = jobDir(a);
const r = factsReport(dir, a._[0] ?? "brief.md");
console.log(r.lines.join("\n"));
writeFileSync(join(ensureDir(join(dir, "out")), "facts.json"), JSON.stringify(r, null, 1));
