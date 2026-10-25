// Лист стиля: theme.json → проверка (кириллица, контрасты, акценты) → PNG с палитрой,
// шрифтами и образцом подписи. Смотреть Read-ом до первых ассетов.
//   npx tsx .claude/skills/art-direction/board.ts [theme.json] [--job dir] [--out out/style-board.png]
//        [--scale 0.6] [--check]   (--check — только проверка, без рендера)
// Код выхода 1, если в теме есть FAIL.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { die, ensureDir, jobDir, LIB, num, parseArgs, readJob, ROOT, str } from "../../bin/_lib";
import { checkTheme, colorDistance, samePaletteFamily, type Theme } from "../../lib/art-direction/theme";
import { amberHits, appendRegistry, readRegistry, voiceOf, type Fingerprint } from "../../bin/_registry";
import { groundedIn, nearestColor, layoutLabel, layoutOf, lookCell, sameLayout } from "../../lib/art-direction/looks";
import { assetColors } from "../../bin/_looks";

const a = parseArgs(process.argv.slice(2), ["check"]);
const dir = jobDir(a);
const file = resolve(dir, a._[0] ?? "theme.json");
if (!existsSync(file)) die(`нет ${file} — сначала напишите theme.json (см. SKILL.md, presets.json)`);
const theme = JSON.parse(readFileSync(file, "utf8")) as Theme;
const issues = checkTheme(theme);
for (const i of issues) console.log(`${i.level}: ${i.msg}`);
if (!issues.length) console.log("тема: проверка пройдена");
const failed = issues.some((i) => i.level === "FAIL");

// «Дом студии»: насколько тема похожа на последние ролики (шрифт, фон, чернила, темперамент,
// форма плашек). Совпадение — не запрет, а вопрос: «почему этот ролик выглядит как прошлые?»
// Ответ — одной фразой в why (theme.json), с предметом из брифа, от которого взят выбор.
const near = (a?: string, b?: string) => Boolean(a && b && /^#/.test(a) && /^#/.test(b) && colorDistance(a, b) < 45);
// Плюс реестр студии (studio/bin/_registry.ts): обезличенные отпечатки всех выпущенных роликов.
const fromFp = (f: Fingerprint): Theme => ({
  name: f.id, palette: { bg: f.bg ?? "", ink: f.ink ?? "", accent: f.accentColor ?? "" },
  fonts: { display: { module: f.display ?? "", weight: "", style: f.displayStyle as "italic" | undefined }, ...(f.accent ? { accent: { module: f.accent, weight: "", style: f.accentStyle as "italic" | undefined } } : {}) },
  motion: { temperament: f.temperament as "calm" | undefined }, shapes: { plate: f.plate as "box" | undefined },
  type: { lockup: f.lockup, align: f.align as "center" | undefined, ...(f.layout?.anchor ? { anchor: f.layout.anchor as "top" } : {}), ...(f.layout?.scale ? { scale: f.layout.scale as "giant" } : {}) }, story: { form: f.storyForm, endCard: f.endCard }, photo: { light: f.photoLight }, amber: f.amber,
});
let needAlt = false;
const fingerprint = async () => {
  const jobs = join(dir, "..");
  const me = dir.split("/").pop();
  let rows: Array<{ d: string; t: Theme }> = [];
  try {
    rows = readdirSync(jobs).filter((d) => d !== me && !d.startsWith("_") && existsSync(join(jobs, d, "theme.json")))
      .map((d) => ({ d, m: statSync(join(jobs, d, "theme.json")).mtimeMs })).sort((p, q) => q.m - p.m).slice(0, 8)
      .map(({ d }) => { try { return { d, t: JSON.parse(readFileSync(join(jobs, d, "theme.json"), "utf8")) as Theme }; } catch { return null; } })
      .filter((x): x is { d: string; t: Theme } => Boolean(x));
  } catch { /* нет соседей */ }
  const reg = readRegistry(dir, 24).map((f) => ({ d: `реестр:${f.id}`, t: fromFp(f) }));
  rows = [...rows, ...reg.filter((r) => !rows.some((x) => near(x.t.palette?.bg, r.t.palette?.bg) && x.t.fonts?.display?.module === r.t.fonts?.display?.module))].slice(0, 30);
  // Штамп «AI-сток» в хвосте промптов — вопрос, а не запрет.
  const amb = amberHits(theme.imagePromptSuffix);
  if (amb.length >= 3) console.log(`INFO: AI-сток в imagePromptSuffix (${amb.join(", ")}) — тёплое окно, боке и дерево у студии почти в каждом фото-ролике. Какой предмет брифа требует именно этого света? Иначе — язык фото (generated-imagery «Язык фото»: вспышка, ровный день, цветной фон, сверху, макро…) в theme.photo`);
  if (rows.length < 2) return;
  const same: string[] = [];
  const cnt = (f: (t: Theme) => boolean) => rows.filter((r) => f(r.t)).length;
  const disp = theme.fonts?.display?.module;
  const n1 = cnt((t) => t.fonts?.display?.module === disp || t.fonts?.caption?.module === disp);
  if (disp && n1 >= 2) same.push(`шрифт ${disp} — в ${n1} из ${rows.length} последних роликов`);
  const n2 = cnt((t) => near(t.palette?.bg, theme.palette?.bg) && near(t.palette?.ink, theme.palette?.ink));
  if (n2 >= 2) same.push(`фон+чернила почти как в ${n2} роликах (${theme.palette.bg} / ${theme.palette.ink})`);
  const temp = theme.motion?.temperament;
  const n3 = cnt((t) => t.motion?.temperament === temp);
  if (temp && n3 >= Math.max(2, Math.ceil(rows.length * 0.6))) same.push(`темперамент «${temp}» — как у ${n3} из ${rows.length}`);
  const plate = theme.shapes?.plate ?? theme.captions?.look;
  const n4 = cnt((t) => (t.shapes?.plate ?? t.captions?.look) === plate);
  if (plate && n4 >= Math.max(2, Math.ceil(rows.length * 0.6))) same.push(`подписи/плашки «${plate}» — как у ${n4} из ${rows.length}`);
  // Подача: курсив-акцент с засечками (2 строки, вторая курсивом) — «подпись» студии.
  const italicAcc = (t: Theme) => t.fonts?.accent?.style === "italic" || t.fonts?.script?.style === "italic";
  const n5 = cnt(italicAcc);
  if (italicAcc(theme) && n5 >= Math.max(2, Math.ceil(rows.length * 0.5))) same.push(`курсивный акцент (${theme.fonts?.accent?.module ?? "accent"}) — у ${n5} из ${rows.length}: «вторая строка курсивом» стала узнаваемой подписью студии`);
  // Подача — по структуре (выравнивание, якорь, крупность, плашка), а не по строке: «влево
  // рваным краем» и «блок влево» — одна и та же подача.
  const myLayout = layoutOf(theme);
  const n6 = myLayout.align ? cnt((t) => sameLayout(myLayout, layoutOf(t))) : 0;
  if (n6 >= Math.max(2, Math.ceil(rows.length * 0.4))) same.push(`подача ${layoutLabel(myLayout)} (выравнивание · якорь · крупность · плашка) — у ${n6} из ${rows.length}`);
  // Голос шрифта: соседнее семейство того же голоса — тот же голос.
  const myVoice = voiceOf(disp);
  const n9 = myVoice ? cnt((t) => voiceOf(t.fonts?.display?.module) === myVoice) : 0;
  if (myVoice && n9 >= Math.max(2, Math.ceil(rows.length * 0.35))) same.push(`голос шрифта «${myVoice}» — у ${n9} из ${rows.length} (другое семейство того же голоса — тот же голос)`);
  // Семья палитры: тёмный/светлый фон + тон акцента (OKLCH). Цвета заказчика (source: "user")
  // — не вопрос: это его бренд.
  const userColors = (theme.palette as Record<string, unknown>)?.source === "user" || theme.source === "user";
  const fam = (t: Theme) => samePaletteFamily({ bg: theme.palette?.bg, accent: theme.palette?.accent }, { bg: t.palette?.bg, accent: t.palette?.accent });
  const n8 = userColors ? 0 : cnt(fam);
  let strong = false;
  if (n8 >= 2) {
    // Причина «акцент — от предмета» проверяется пикселями, а не словами: акцент должен быть
    // в картинках ролика (фото, вырезки, бренд) в пределах ΔE 6 и того же тона. Иначе — сравнение с
    // palette.alt (вторая палитра от другого предмета брифа, в свободной клетке studio looks).
    const cell = lookCell(theme.palette?.bg, theme.palette?.accent);
    const cols = await assetColors(dir);
    const g = theme.palette?.accent && cols.length ? groundedIn(theme.palette.accent, cols) : null;
    const alt = (theme.paletteAlt ?? (theme.palette as Record<string, unknown>)?.alt) as { bg?: string; accent?: string } | undefined;
    const altFam = alt ? cnt((t) => samePaletteFamily({ bg: alt.bg, accent: alt.accent }, { bg: t.palette?.bg, accent: t.palette?.accent })) : 0;
    const head = `${cell?.label ?? "та же семья"} (${theme.palette?.accent}) — у ${n8} из ${rows.length} последних`;
    if (g) console.log(`INFO: семья палитры как у соседей (${head}), но акцент есть в картинке ${g.file} (${g.hex}, ΔE ${g.de}) — от предмета, принято`);
    else if (alt && altFam < 2 && lookCell(alt.bg, alt.accent)) console.log(`WARN: ${head}; paletteAlt (${lookCell(alt.bg, alt.accent)!.label}) — на листе рядом. Выбери ГЛАЗАМИ и запиши в notes.md, что зритель видит иначе (не откуда цвет)`);
    else { same.push(`${head}${cols.length ? `; акцента нет в картинках ролика (ближайший цвет картинок ${nearestColor(theme.palette.accent, cols)?.hex ?? "—"}, ΔE ${nearestColor(theme.palette.accent, cols)?.de ?? "—"} при пороге 6)` : "; картинок ещё нет — проверка по пикселям после ассетов"}`); strong = true; needAlt = true; }
  }
  const form = theme.story?.form;
  const n7 = form ? cnt((t) => t.story?.form === form) : 0;
  if (form && n7 >= Math.max(2, Math.ceil(rows.length * 0.5))) same.push(`форма рассказа «${form}» — у ${n7} из ${rows.length}`);
  if (!theme.type?.lockup) console.log("INFO: theme.type.lockup не задан — подача текста станет умолчанием хелпера (2 строки по центру + курсив). Выбери из словаря подачи (kinetic-typography) и запиши");
  if (!theme.type?.align || !theme.type?.anchor || !theme.type?.scale) console.log("INFO: подача структурой — type.align (left|center|right|free), type.anchor (top|over-hero|bottom|in-world), type.scale (giant|large|medium): по ним студия сравнивает облик, а не по строке lockup");
  if (needAlt) console.log(`WARN★ палитра как у соседей: ${same.join("; ")}. Строкой в why/notes это не снимается: добавь paletteAlt {bg, ink, accent} (в корне theme.json) от ДРУГОГО предмета брифа в свободной клетке (studio looks) — лист стиля покажет обе, выбери глазами и запиши, что зритель видит иначе. Или акцент из картинки (после ассетов board.ts проверит пиксели), или palette.source: "user" (бренд)`);
  else if (same.length >= 2 || strong) console.log(`WARN: дом студии — тема похожа на последние ролики: ${same.join("; ")}. Это ролик про другой предмет: от какого предмета из брифа взяты шрифт, цвет и форма? Другой голос шрифта (studio fonts --suggest), другая референсная система (presets.json), свободная клетка (studio looks)`);
  else if (same.length) console.log(`INFO: совпадает с последними роликами — ${same[0]}`);
};
// Черновой отпечаток в реестр сразу после проверки темы: параллельные прогоны видят друг друга
// (раунд 4: четыре ролика одновременно выбрали «тёмное + лайм», не зная друг о друге).
// Финальный studio render перезапишет запись тем же ключом.
if (!failed) appendRegistry(dir);

const main = async () => {
  await fingerprint();
  const code = failed || needAlt ? 1 : 0;
  if (a.check) process.exit(code);
  const job = readJob(dir);
  const bdir = ensureDir(join(dir, ".board"));
  const roles = Object.entries(theme.fonts ?? {}).filter(([, f]) => f) as Array<[string, { module: string; weight: string; style?: string }]>;
  const imports = roles.map(([r, f]) => `import * as F_${r} from "@remotion/google-fonts/${f.module}";`).join("\n");
  const loads = roles.map(([r, f]) => `  ${r}: safe(() => loadCyrillicFont(F_${r}, { weights: [${JSON.stringify(String(f.weight))}], style: ${JSON.stringify(f.style ?? "normal")} })),`).join("\n");
  writeFileSync(join(bdir, "index.tsx"), `// создано board.ts — не редактировать
import React from "react";
import { Composition, registerRoot } from "remotion";
${imports}
import { loadCyrillicFont } from "@studio";
import { StyleBoard } from "@studio/art-direction";
const theme = ${JSON.stringify(theme)};
const safe = (f: () => string) => { try { return f(); } catch { return "sans-serif"; } };
const fonts = {
${loads}
};
const Board: React.FC = () => <StyleBoard theme={theme as never} fonts={fonts} />;
registerRoot(() => <Composition id="Board" component={Board} width={${job.width}} height={${job.height}} fps={30} durationInFrames={1} />);
`);
  const { bundle } = await import("@remotion/bundler");
  const { renderStill, selectComposition } = await import("@remotion/renderer");
  const serveUrl = await bundle({
    entryPoint: join(bdir, "index.tsx"), publicDir: join(dir, "public"), rootDir: ROOT, outDir: join(bdir, "bundle"),
    webpackOverride: (c) => ({ ...c, resolve: { ...c.resolve, alias: { ...((c.resolve?.alias as Record<string, string>) ?? {}), "@studio": LIB } } }),
  });
  const comp = await selectComposition({ serveUrl, id: "Board", inputProps: {} });
  const out = resolve(dir, str(a, "out", "out/style-board.png")!);
  mkdirSync(dirname(out), { recursive: true });
  await renderStill({ serveUrl, composition: comp, frame: 0, output: out, scale: num(a, "scale", 0.6), overwrite: true });
  console.log(out);
  process.exit(code);
};
main().catch((e) => { console.error("ошибка: " + (e?.stack ?? e)); process.exit(1); });
