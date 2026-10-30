// Статическая проверка сцен на приёмы, из-за которых ролик «прыгает» или картинки
// «уезжают» (то, что владелец уже отклонил). Секунды, без рендера. Это подсказки (WARN),
// а не запреты: директор может оставить приём, но тогда пусть посмотрит ленту движения.
//   npx tsx .claude/skills/self-review/lint.ts [--job dir] [--json]
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type LintIssue = { level: "FAIL" | "WARN" | "INFO"; kind: string; file: string; line: number; msg: string; code: string };

const walk = (d: string): string[] => !existsSync(d) ? [] : readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|css)$/.test(f) ? [p] : [];
});

// Текст вызова fn( … ) с учётом вложенных скобок, начиная с позиции открывающей скобки.
const callText = (src: string, open: number): string => {
  let depth = 0;
  for (let i = open; i < src.length && i < open + 4000; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  return src.slice(open, open + 400);
};
// Текст определения от позиции значения: объект/вызов/стрелка — по скобкам, иначе до конца строки.
const defText = (src: string, i: number): string => {
  const open = src.slice(i, i + 200).search(/[({]/);
  const eol = src.indexOf("\n", i) < 0 ? src.length : src.indexOf("\n", i);
  if (open < 0 || i + open > eol) return src.slice(i, eol);
  let depth = 0;
  for (let j = i + open; j < src.length && j < i + 4000; j++) {
    if (src[j] === "(" || src[j] === "{") depth++;
    else if (src[j] === ")" || src[j] === "}") { depth--; if (depth === 0) { const e2 = src.indexOf("\n", j); return src.slice(i, e2 < 0 ? src.length : e2); } }
  }
  return src.slice(i, eol);
};
const lineOf = (src: string, idx: number) => src.slice(0, idx).split("\n").length;
const strip = (s: string) => s.replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length)).replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));

export const lintJob = (dir: string): LintIssue[] => {
  const out: LintIssue[] = [];
  const files = walk(join(dir, "src"));
  const transitions = new Map<string, { file: string; line: number }>();
  let hasAudit = false;
  for (const f of files) {
    const raw = readFileSync(f, "utf8");
    const src = strip(raw);
    const rel = relative(dir, f);
    const push = (level: LintIssue["level"], kind: string, idx: number, msg: string) =>
      out.push({ level, kind, file: rel, line: lineOf(src, idx), msg, code: raw.split("\n")[lineOf(src, idx) - 1]?.trim().slice(0, 160) ?? "" });
    if (/<FrameAudit\b/.test(src)) hasAudit = true;
    // 1) Пружины с перелётом.
    for (const m of src.matchAll(/\bspring\s*\(/g)) {
      const txt = callText(src, m.index! + m[0].length - 1);
      const d = txt.match(/damping\s*:\s*([\d.]+)/);
      if (!d) push("WARN", "spring-overshoot", m.index!, "spring без damping (по умолчанию 10) — перелёт и отскок читаются как «прыгает»; damping ≥ 100 или springIn из @studio");
      else if (Number(d[1]) < 100) push("WARN", "spring-overshoot", m.index!, `spring с damping ${d[1]} < 100 — перелёт/отскок; оставляйте только осознанно и смотрите ленту движения`);
    }
    // 2) interpolate без зажима: значение уходит дальше последнего ключа. Зажим через константу
    // (const cl = { extrapolateLeft: "clamp", … }; interpolate(f, r, v, cl) или { ...cl, easing })
    // и через обёртку-функцию с clamp внутри — тоже зажим: имена таких определений собираем.
    const clampNames = [...src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*/g)].filter((d) => /clamp/.test(defText(src, d.index! + d[0].length))).map((d) => d[1]);
    const usesClamp = (txt: string) => /clamp/.test(txt) || clampNames.some((n) => new RegExp(`(?<![\\w$])(?<!(?:^|[^.])\\.)${n.replace(/\$/g, "\\$")}(?![\\w$])`).test(txt));
    for (const m of src.matchAll(/\binterpolate\s*\(/g)) {
      const txt = callText(src, m.index! + m[0].length - 1);
      if (!usesClamp(txt) && /frame|f\b/.test(txt)) push("WARN", "unclamped", m.index!, "interpolate без extrapolateRight: \"clamp\" — после последнего ключа значение продолжает расти (так картинки уезжали за край)");
    }
    // 3) Движение пропорционально кадру без границы.
    for (const m of src.matchAll(/(translate[XY3d]*\(|\b(left|top|right|bottom|x|y|marginLeft)\s*:)[^\n;]{0,80}\bframe\s*\*\s*[\d.]+/g)) {
      push("WARN", "unbounded-drift", m.index!, "положение = frame × скорость без границы — слой уедет за кадр на длинной сцене; tween/kenBurns/useGuardedBox");
    }
    // 4) Переходы: типы и размытие движения.
    for (const m of src.matchAll(/\b(slide|wipe|flip|clockWipe|iris|fade|cube|none)\s*\(\s*(\{[^)]*\})?\s*\)/g)) {
      if (/@remotion\/transitions/.test(src)) transitions.set(m[1], { file: rel, line: lineOf(src, m.index!) });
    }
    for (const m of src.matchAll(/<(CameraMotionBlur|Trail)\b/g)) push("WARN", "motion-blur", m.index!, `${m[1]}: размытие движения читается как блюр-«вжух» (владелец отклонил) — только осознанно и коротко`);
    for (const m of src.matchAll(/blur\(\s*\$\{[^}]*(frame|progress|p\b|t\b)[^}]*\}\s*px\s*\)/g)) push("INFO", "animated-blur", m.index!, "анимированный blur — проверьте probe blur-transition: смена кадра через размытие = «вжух»");
    // 5) Числа без табличных цифр.
    if (/\binterpolate\s*\(/.test(src) && /(toFixed|toLocaleString|Math\.round|NumberFormat)\s*\(/.test(src) && !/tabular-nums|<Counter\b/.test(src)) {
      const idx = src.search(/(toFixed|toLocaleString|NumberFormat)\s*\(/);
      if (idx >= 0) push("WARN", "number-jitter", idx, "число считается по кадрам без font-variant-numeric: tabular-nums — строка дрожит по ширине (Counter из @studio/kinetic-typography)");
    }
    // 7) Части героя в обход <Rig>: сцена вырезает руки/ноги из скелета или рисует их картинки своими
    // <Img>/матрицами. Растянутая до цели картинка руки сплющивается и «отрывается» (ролик 77386).
    for (const m of src.matchAll(/Object\.entries\([^)]*\.parts\)\s*\.filter\s*\(|\.parts\[[^\]]+\][^;\n]{0,60}\.src\b|\.parts\.(?:arm|leg|shin|forearm)[LR]\??\.src\b/g)) {
      push("WARN", "rig-parts-bypass", m.index!, "части героя рисуются в обход <Rig> (вырезаны из скелета или своей картинкой) — растянутая рука сплющивается и «отрывается»; взять за руку, протянуть, держать предмет — действие reach {arm, to:[x,y]}, предмет в руке — handAt(…).hand");
    }
    // 6) Слой шире кадра от left без страховки.
    for (const m of src.matchAll(/width\s*:\s*(W|width)\s*\*\s*([\d.]+)/g)) {
      if (Number(m[2]) > 1.02 && !/CoverImage|coverRect|kenBurns|CameraView|useGuardedBox|Guarded|data-bleed/.test(src)) push("WARN", "wide-layer", m.index!, `слой шириной ${m[2]}×кадра без CoverImage/coverRect/CameraView — при сдвиге откроется край`);
    }
  }
  if (transitions.size > 2) {
    const first = [...transitions.values()][0];
    out.push({ level: "WARN", kind: "transition-mix", file: first.file, line: first.line, msg: `${transitions.size} типа переходов (${[...transitions.keys()].join(", ")}) — больше двух на ролик читается как мельтешение`, code: "" });
  }
  // Монолит: одна правка тянет в контекст весь файл (и переписывается целиком) — дорого.
  for (const f of files) {
    const n = readFileSync(f, "utf8").length;
    if (n > 16000) out.push({ level: "INFO", kind: "big-file", file: relative(dir, f), line: 0, msg: `${Math.round(n / 1000)} тыс. знаков в одном файле — разложите по сценам (src/scenes/bNN.tsx + тонкий Video.tsx): правка одной сцены через Edit дешевле и не задевает остальные`, code: "" });
  }
  if (files.length && !hasAudit) out.push({ level: "WARN", kind: "no-frame-audit", file: "src", line: 0, msg: "нет <FrameAudit/> в Stage — без него самопроверка не видит вылеты за край на текстурном фоне и движение отдельных элементов", code: "" });
  return out;
};

const isMain = Boolean(process.argv[1]) && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const ji = args.indexOf("--job");
  const dir = resolve(ji >= 0 ? args[ji + 1] : process.cwd());
  const issues = lintJob(dir);
  if (args.includes("--json")) console.log(JSON.stringify(issues, null, 1));
  else {
    if (!issues.length) console.log("lint: чисто");
    for (const i of issues) console.log(`${i.level} ${i.kind} ${i.file}:${i.line} — ${i.msg}${i.code ? `\n    ${i.code}` : ""}`);
  }
}
