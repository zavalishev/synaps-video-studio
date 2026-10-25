// Облик последних роликов студии — ДО выбора направлений (CLAUDE.md, шаг 2).
//   studio looks [--n 10] [--job dir]      — занятые и свободные клетки (фон × тон акцента),
//        «дом студии» (самая частая клетка, подача, голос шрифта), журнал облика соседей и лист
//        out/recent-looks.png (кадр 0 соседей + палитры);
//   studio looks --note "что видит зритель"  — дописать свой облик в журнал студии одной фразой
//        (после листа стиля: «сине-сланцевый фон, лаймовая шкала, узкий капслок слева сверху»).
// Свободная клетка — не приказ: бренд (palette.source: "user") важнее. Но выбор «как у соседей»
// требует сравнения с альтернативой (board.ts → palette.alt).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { HUE_RU, LIGHT_RU, type Lightness, layoutLabel, lookCell, occupancy } from "../lib/art-direction/looks";
import { budgetLine, parseArgs, str, num } from "./_lib";
import { recentLooks, renderRecentLooks } from "./_looks";
import { noteRegistry } from "./_registry";

const a = parseArgs(process.argv.slice(2), []);
const jobArg = str(a, "job") ?? process.env.STUDIO_JOB ?? process.cwd();
const dir = existsSync(join(jobArg, "job.json")) ? jobArg : null;

const note = str(a, "note");
if (note !== undefined) {
  if (!dir) { console.error("ошибка: --note — из папки ролика (нужен job.json)"); process.exit(1); }
  noteRegistry(dir, note);
  console.log(`журнал облика: записано «${note.trim().slice(0, 200)}»`);
  process.exit(0);
}

const main = async () => {
  const looks = recentLooks(dir, num(a, "n", 10)!);
  if (!looks.length) { console.log("облик: прошлых роликов нет — любая клетка свободна"); return; }
  const occ = occupancy(looks);
  console.log(`облик последних ${looks.length} роликов (новые сверху):`);
  looks.forEach((l, i) => {
    const c = lookCell(l.bg, l.accent);
    console.log(`  ${i + 1}. ${l.label.slice(0, 18).padEnd(18)} ${c?.label ?? "—"} · голос ${l.voice ?? l.display ?? "—"} · подача ${l.layout ? layoutLabel(l.layout) : "—"}${l.note ? ` · «${l.note.slice(0, 80)}»` : ""}`);
  });
  const rows = (["dark", "mid", "light"] as Lightness[]).map((L) => {
    const busy = [...occ.counts.entries()].filter(([k]) => k.startsWith(L + "/")).map(([k, n]) => { const s = Number(k.split("/")[1]); return `${s < 0 ? "нейтр." : HUE_RU[s]} ×${n}`; });
    return `${LIGHT_RU[L]}: ${busy.length ? busy.join(", ") : "—"}`;
  });
  console.log(`занято (фон × тон акцента): ${rows.join(" | ")}`);
  const free = (["dark", "mid", "light"] as Lightness[]).map((L) => `${LIGHT_RU[L]}: ${occ.free[L].map((s) => HUE_RU[s]).join(", ") || "—"}`);
  console.log(`СВОБОДНО: ${free.join(" | ")}`);
  // Дом студии: самое частое по каждой оси.
  const most = <T,>(xs: Array<T | undefined>, key: (x: T) => string) => {
    const m = new Map<string, number>();
    for (const x of xs) if (x !== undefined) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
    return [...m.entries()].sort((p, q) => q[1] - p[1])[0];
  };
  const h1 = occ.top[0], h3 = most(looks.map((l) => l.voice), (v) => v);
  const ax = (k: "align" | "anchor" | "scale" | "plate", ru: string) => { const m = most(looks.map((l) => l.layout?.[k]), (v) => v); return m && m[1] >= Math.max(3, Math.ceil(looks.length * 0.4)) ? `${ru} ${m[0]} (${m[1]} из ${looks.length})` : ""; };
  const house = [
    h1 && h1.n >= 2 ? `${h1.label} (${h1.n} из ${occ.total})` : "",
    ax("align", "текст"), ax("anchor", "якорь"), ax("scale", "крупность"), ax("plate", "подложка"),
    h3 && h3[1] >= 2 ? `голос ${h3[0]} (${h3[1]} из ${looks.length})` : "",
  ].filter(Boolean);
  if (house.length) console.log(`дом студии сейчас: ${house.join("; ")} — это не брать по привычке`);
  console.log("три направления описывай клеткой (светлота фона × тон акцента), хотя бы одно — в СВОБОДНОЙ; средний фон (mid-tone) и цветное поле — тоже варианты; бренд заказчика важнее клеток");
  if (dir) {
    const png = await renderRecentLooks(looks, join(dir, "out", "recent-looks.png"));
    if (png) console.log(`лист: out/recent-looks.png (кадр 0 соседей по ленте) — одна Read; критику — он же`);
    console.log(`после листа стиля: studio looks --note "что видит зритель: фон, акцент, шрифт, где текст" — в журнал студии`);
    const bl = budgetLine(dir);
    if (bl) console.log(bl);
  }
};
main().catch((e) => { console.error("ошибка: " + (e?.stack ?? e)); process.exit(1); });
