// Факты брифа — детерминированно, бесплатно, без вкуса. Не решает за директора, а показывает:
//   • date-weekday — «суббота, 2 ноября», а 2.11 ближайшего года — понедельник;
//   • date-past    — дата с годом уже прошла;
//   • числа брифа  — всё, что можно показать/сказать как факт (цены, время, места, телефон);
//   • invented-number — число в речи (words.json, в т. ч. словами) или на экране, которого нет
//     ни в брифе, ни в данных (public/data/*.json); принять можно, записав его в notes.md
//     в разделе «## Вопросы заказчику» — или, если число ВЫЧИСЛЕНО из брифа (сложный процент,
//     сумма, разница), строкой в «## Расчёты» notes.md: «10000 * 1.1^5 = 16105». Выражение
//     вычисляется, совпало — число проверено (calc-mismatch, если нет);
//   • регулируемая категория по словам брифа (медицина, БАД, финансы, алкоголь, дети) —
//     подсказка открыть claims-and-compliance; решение — поле regulated в job.json.
// CLI: `studio facts [brief.md]` (studio/bin/facts.ts; пишет out/facts.json). review.ts зовёт reviewFacts.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type FactIssue = { level: "WARN" | "INFO" | "FAIL"; kind: string; msg: string };

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е");

// ---------- даты и дни недели ----------
const MONTHS: Array<[RegExp, number]> = [
  [/^январ/, 0], [/^феврал/, 1], [/^март/, 2], [/^апрел/, 3], [/^ма[йя]/, 4], [/^июн/, 5],
  [/^июл/, 6], [/^август/, 7], [/^сентябр/, 8], [/^октябр/, 9], [/^ноябр/, 10], [/^декабр/, 11],
];
const WEEKDAYS: Array<[RegExp, number, string]> = [
  [/понедельник/, 1, "понедельник"], [/вторник/, 2, "вторник"], [/сред[аеуы](?![а-я])/, 3, "среда"], [/четверг/, 4, "четверг"],
  [/пятниц/, 5, "пятница"], [/суббот/, 6, "суббота"], [/воскресень/, 0, "воскресенье"],
];
const WD_NAME = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

export type BriefDate = { text: string; day: number; month: number; year: number; explicitYear: boolean; weekday?: number; weekdayText?: string };

// Год без явного указания — ближайший, в котором дата не раньше «сегодня − 2 дня» (анонсы
// обычно про будущее).
export const briefDates = (brief: string, today = new Date()): BriefDate[] => {
  const t = norm(brief);
  const out: BriefDate[] = [];
  const re = /(\d{1,2})\s+(январ\S*|феврал\S*|март\S*|апрел\S*|ма[йя]\S*|июн\S*|июл\S*|август\S*|сентябр\S*|октябр\S*|ноябр\S*|декабр\S*)(?:\s+(\d{4}))?/g;
  for (const m of t.matchAll(re)) {
    const day = Number(m[1]);
    const month = MONTHS.find(([r]) => r.test(m[2]))?.[1];
    if (month === undefined || day < 1 || day > 31) continue;
    let year = m[3] ? Number(m[3]) : today.getFullYear();
    if (!m[3]) {
      const ref = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 2);
      if (new Date(year, month, day) < ref) year++;
    }
    // День недели — в той же фразе, в пределах ~25 знаков до или после даты.
    const i0 = m.index ?? 0, i1 = i0 + m[0].length;
    const before = t.slice(Math.max(0, i0 - 25), i0).split(/[.!?\n]/).pop() ?? "";
    const after = t.slice(i1, i1 + 25).split(/[.!?\n]/)[0];
    let wd: [RegExp, number, string] | undefined;
    for (const w of WEEKDAYS) if (w[0].test(`${before} | ${after}`)) { wd = w; break; }
    out.push({ text: (brief.slice(i0, i1).trim() || m[0]).replace(/[,.;:]+$/, ""), day, month, year, explicitYear: Boolean(m[3]), ...(wd ? { weekday: wd[1], weekdayText: wd[2] } : {}) });
  }
  return out;
};

export const checkDates = (brief: string, today = new Date()): FactIssue[] => {
  const issues: FactIssue[] = [];
  for (const d of briefDates(brief, today)) {
    const real = new Date(d.year, d.month, d.day);
    const ds = `${String(d.day).padStart(2, "0")}.${String(d.month + 1).padStart(2, "0")}.${d.year}`;
    if (d.weekday !== undefined && real.getDay() !== d.weekday) {
      issues.push({ level: "WARN", kind: "date-weekday", msg: `в брифе «${d.weekdayText}, ${d.text}», а ${ds} это ${WD_NAME[real.getDay()]}${d.explicitYear ? "" : " (год не указан — взят ближайший)"}. Противоречие брифа: не исправляй молча — первым пунктом в notes.md «## Вопросы заказчику» и в итоговый JSON; ролик собирай по брифу или без дня недели` });
    }
    if (d.explicitYear && real < new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
      issues.push({ level: "WARN", kind: "date-past", msg: `дата ${ds} в брифе уже прошла — опечатка в годе? вопрос заказчику в notes.md` });
    }
  }
  return issues;
};

// ---------- числа ----------
const CARD: Array<[RegExp, number]> = [
  [/^(ноль|нуля|нолей)$/, 0],
  [/^(один|одна|одно|одного|одной|одному|одним|одну|одних)$/, 1],
  [/^(два|две|двух|двум|двумя)$/, 2], [/^(три|трех|трем|тремя)$/, 3], [/^(четыре|четырех|четырем|четырьмя)$/, 4],
  [/^(пять|пяти|пятью)$/, 5], [/^(шесть|шести|шестью)$/, 6], [/^(семь|семи|семью)$/, 7], [/^(восемь|восьми|восемью)$/, 8],
  [/^(девять|девяти|девятью)$/, 9], [/^(десять|десяти|десятью)$/, 10],
  [/^одиннадцат(ь|и|ью)$/, 11], [/^двенадцат(ь|и|ью)$/, 12], [/^тринадцат(ь|и|ью)$/, 13], [/^четырнадцат(ь|и|ью)$/, 14],
  [/^пятнадцат(ь|и|ью)$/, 15], [/^шестнадцат(ь|и|ью)$/, 16], [/^семнадцат(ь|и|ью)$/, 17], [/^восемнадцат(ь|и|ью)$/, 18],
  [/^девятнадцат(ь|и|ью)$/, 19], [/^двадцат(ь|и|ью)$/, 20], [/^тридцат(ь|и|ью)$/, 30], [/^сорок(а)?$/, 40],
  [/^(пятьдесят|пятидесяти)$/, 50], [/^(шестьдесят|шестидесяти)$/, 60], [/^(семьдесят|семидесяти)$/, 70],
  [/^(восемьдесят|восьмидесяти)$/, 80], [/^(девяносто|девяноста)$/, 90],
  [/^(сто|ста)$/, 100], [/^(двести|двухсот)$/, 200], [/^(триста|трехсот)$/, 300], [/^(четыреста|четырехсот)$/, 400],
  [/^(пятьсот|пятисот)$/, 500], [/^(шестьсот|шестисот)$/, 600], [/^(семьсот|семисот)$/, 700], [/^(восемьсот|восьмисот)$/, 800],
  [/^(девятьсот|девятисот)$/, 900],
];
const MULT: Array<[RegExp, number]> = [[/^тысяч(а|и|у|ей|ам|ами|ах)?$/, 1000], [/^миллион(а|ов|ам)?$/, 1_000_000]];
const cls = (v: number) => (v < 10 ? 0 : v < 100 ? 1 : 2);

// Числа из последовательности слов (речь): «две тысячи пятьсот» → 2500; телефон «девятьсот
// сто двадцать три» → 900, 123. Порядковые («первое», «второе») не считаются.
export const numbersInWords = (tokens: string[]): Array<{ n: number; src: string }> => {
  const out: Array<{ n: number; src: string }> = [];
  let total = 0, cur = 0, prevCls = 9, has = false, src: string[] = [];
  const flush = () => { if (has) out.push({ n: total + cur, src: src.join(" ") }); total = 0; cur = 0; prevCls = 9; has = false; src = []; };
  for (const raw of tokens) {
    const w = norm(raw).replace(/[^a-zа-я0-9]/g, "");
    if (/\d/.test(w)) { flush(); for (const n of numbersInText(raw)) out.push({ n, src: raw }); continue; }
    const m = MULT.find(([r]) => r.test(w));
    if (m && has) { total += (cur || 1) * m[1]; cur = 0; prevCls = 9; src.push(raw); continue; }
    const c = CARD.find(([r]) => r.test(w));
    if (!c) { flush(); continue; }
    const v = c[1];
    if (has && cls(v) >= prevCls) flush();
    cur += v; prevCls = cls(v); has = true; src.push(raw);
  }
  flush();
  return out;
};

// Числа, записанные цифрами: «2 500 ₽» → 2500 (и 2, 500), «+7 (999) 000-11-22» → 7, 999, 000, 11, 22.
export const numbersInText = (s: string): number[] => {
  const out = new Set<number>();
  // «2 500» — одно число (части 2 и 500 сами по себе не факты)
  const rest = s.replace(/\d{1,3}(?:[  ]\d{3})+(?![\d])/g, (m) => { out.add(Number(m.replace(/\D/g, ""))); return " "; });
  for (const m of rest.matchAll(/\d+(?:[.,]\d+)?/g)) out.add(Number(m[0].replace(",", ".")));
  return [...out];
};

// Числа брифа с фразой — для отчёта директору: «1 → «за 1 час»», а не голые «2, 3, 12, 15».
// Цифра, слитая с буквами (3D, 4K, 5G, iPhone15), — часть названия, не факт; длительность ролика
// («12–15 секунд», «ролик на 30 с») — параметр производства, не цифра для экрана.
export type BriefFact = { n: string; phrase: string; param: boolean };
export const briefFacts = (brief: string): BriefFact[] => {
  const out: BriefFact[] = [];
  const re = /(?<![\p{L}\d/])(\d+\/\d+|\d{1,3}(?:[  ]\d{3})+|\d+(?:[.,]\d+)?)(?:\s*[–—-]\s*(\d+(?:[.,]\d+)?))?(?![\p{L}\d/])/gu;
  for (const m of brief.matchAll(re)) {
    const i0 = m.index ?? 0, i1 = i0 + m[0].length;
    const line0 = brief.lastIndexOf("\n", i0) + 1, line1 = brief.indexOf("\n", i1) < 0 ? brief.length : brief.indexOf("\n", i1);
    const line = brief.slice(line0, line1);
    // Фраза — в пределах предложения: ~3 слова до и после числа.
    let s0 = line0, s1 = line1;
    for (const b of brief.slice(line0, i0).matchAll(/[.!?;](?=\s)/g)) s0 = line0 + (b.index ?? 0) + 1;
    const nb = brief.slice(i1, line1).search(/[.!?;](?=\s|$)/);
    if (nb >= 0) s1 = i1 + nb;
    let a0 = Math.max(s0, i0 - 18), a1 = Math.min(s1, i1 + 20);
    while (a0 > s0 && /\S/.test(brief[a0 - 1])) a0--;
    while (a1 < s1 && /\S/.test(brief[a1])) a1++;
    const phrase = brief.slice(a0, a1).replace(/\s+/g, " ").replace(/^[\s,.;:—-]+|[\s,.;:—-]+$/g, "");
    const after = brief.slice(i1, i1 + 12).toLowerCase();
    const param = /^\s*(сек|с(?![а-яё]))/.test(after) && (Boolean(m[2]) || /ролик|видео|длительн|хронометраж|reels|shorts|клип|рилс/i.test(line));
    const n = m[2] ? `${m[1]}–${m[2]}` : m[1];
    if (!out.some((x) => x.n === n && x.phrase === phrase)) out.push({ n, phrase, param });
  }
  return out;
};

// ---------- «## Расчёты»: производные числа, проверенные вычислением ----------
// Строка: «выражение = значение» (или →). Выражение — цифры, + − * / × ^ ( ) и пробелы-разряды.
const evalExpr = (e: string): number | null => {
  const x = e.replace(/(\d)[  ](?=\d{3}(?!\d))/g, "$1").replace(/(\d),(\d)/g, "$1.$2").replace(/×|х(?=\s*\d)/g, "*").replace(/[−–]/g, "-").replace(/\^/g, "**").replace(/\s+/g, "");
  if (!x || !/^[\d.+\-*/()]+$/.test(x) || !/\d/.test(x)) return null;
  try { const v = Function(`"use strict"; return (${x});`)() as unknown; return typeof v === "number" && Number.isFinite(v) ? v : null; } catch { return null; }
};
export const calcLedger = (notes: string): { ok: number[]; bad: string[]; unparsed: string[] } => {
  const sec = notes.match(/^##\s*Расч[её]ты[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m)?.[1] ?? "";
  const ok: number[] = [], bad: string[] = [], unparsed: string[] = [];
  for (const raw of sec.split("\n")) {
    const line = raw.replace(/^[\s*•-]+/, "").replace(/`/g, "").trim();
    if (!line) continue;
    const m = line.match(/^(.*?)(?:=|→|->)\s*([+−-]?\d[\d  ]*(?:[.,]\d+)?)\s*(?:₽|%|руб\S*)?\s*(?:\(.*\))?$/);
    if (!m) { unparsed.push(line.slice(0, 60)); continue; }
    const want = Number(m[2].replace(/[  ]/g, "").replace(",", ".").replace("−", "-"));
    const got = evalExpr(m[1].replace(/[₽%]|руб\S*/g, "").split(/[:=]/).pop() ?? "");
    if (got === null) { unparsed.push(line.slice(0, 60)); continue; }
    if (Math.abs(got - want) <= Math.max(0.51, Math.abs(want) * 0.001)) ok.push(want, Math.round(want), Math.abs(want));
    else bad.push(`${line.slice(0, 60)} (выходит ${+got.toFixed(2)})`);
  }
  return { ok, bad, unparsed };
};

export const briefNumbers = (brief: string): Set<number> => {
  const set = new Set<number>(numbersInText(brief));
  for (const m of brief.matchAll(/\d+/g)) set.add(Number(m[0])); // и группы цифр по отдельности (телефон «900 123 45 67»)
  for (const x of numbersInWords(brief.split(/\s+/))) set.add(x.n);
  return set;
};

const dataNumbers = (dir: string): Set<number> => {
  const set = new Set<number>();
  const dd = join(dir, "public", "data");
  if (!existsSync(dd)) return set;
  const walk = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) { set.add(v); set.add(Math.round(v)); set.add(Math.floor(v)); set.add(Math.ceil(v)); set.add(Math.abs(Math.round(v))); set.add(+v.toFixed(1)); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  for (const f of readdirSync(dd).filter((x) => x.endsWith(".json"))) { try { walk(JSON.parse(readFileSync(join(dd, f), "utf8"))); } catch { /* не JSON */ } }
  return set;
};

// Раздел notes.md, который оркестратор показывает заказчику.
export const clientQuestions = (notes: string): string => {
  const m = notes.match(/^##\s*Вопросы заказчику[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m);
  return m ? m[1].trim() : "";
};

export const inventedNumbers = (o: { dir: string; brief: string; words?: string[]; screen?: string[]; notes?: string }): FactIssue[] => {
  const ledger = calcLedger(o.notes ?? "");
  const allowed = new Set<number>([0, 1, ...briefNumbers(o.brief), ...dataNumbers(o.dir), ...ledger.ok]);
  const calcIssues: FactIssue[] = [
    ...(ledger.bad.length ? [{ level: "WARN" as const, kind: "calc-mismatch", msg: `«## Расчёты» в notes.md не сходятся: ${ledger.bad.slice(0, 4).join("; ")} — исправь число в ролике или выражение` }] : []),
    ...(ledger.unparsed.length ? [{ level: "INFO" as const, kind: "calc-unparsed", msg: `«## Расчёты»: не смог вычислить ${ledger.unparsed.slice(0, 3).map((x) => `«${x}»`).join(", ")} — формат «10000 * 1.1^5 = 16105» (цифры и + − * / ^ ( ))` }] : []),
  ];
  const found = new Map<number, string[]>();
  const add = (n: number, src: string) => { if (allowed.has(n)) return; const l = found.get(n) ?? []; if (l.length < 2 && !l.includes(src)) l.push(src); found.set(n, l); };
  for (const x of numbersInWords(o.words ?? [])) add(x.n, `речь «${x.src}»`);
  for (const s of o.screen ?? []) {
    if (/^\s*\d{1,2}\s*[.)]?\s*$/.test(s) && Number(s.replace(/\D/g, "")) <= 10) continue; // номер пункта списка
    for (const n of numbersInText(s)) add(n, `экран «${s.trim().slice(0, 24)}»`);
  }
  if (!found.size) return calcIssues;
  const q = clientQuestions(o.notes ?? "");
  const accepted = [...found.keys()].filter((n) => q.includes(String(n)) || (found.get(n) ?? []).some((s) => { const w = s.match(/«(.+)»/)?.[1]; return Boolean(w && norm(q).includes(norm(w))); }));
  const open = [...found.keys()].filter((n) => !accepted.includes(n));
  const list = (ns: number[]) => ns.slice(0, 6).map((n) => `${n} (${(found.get(n) ?? []).join(", ")})`).join("; ");
  const out: FactIssue[] = [...calcIssues];
  if (open.length) out.push({ level: "WARN", kind: "invented-number", msg: `числа не из брифа и не из данных: ${list(open)}. Для зрителя это слово заказчика. Скажи без числа («несколько раз, в такт дыханию») или впиши допущение в notes.md «## Вопросы заказчику» — его увидит владелец; число, вычисленное из брифа, — строкой в «## Расчёты» («10000 * 1.1^5 = 16105»)` });
  if (accepted.length) out.push({ level: "INFO", kind: "invented-number", msg: `числа-допущения записаны в «Вопросы заказчику»: ${list(accepted)}` });
  return out;
};

// ---------- регулируемые категории ----------
export type Regulated = "medical" | "supplements" | "finance" | "alcohol" | "children";
const CATS: Array<[Regulated, RegExp, string]> = [
  ["medical", /клиник|стоматолог|(?<![а-я])зуб|брекет|элайнер|(?<![а-я])кап[аыу](?![а-я])|(?<![а-я])врач|лечени|медицин|косметолог|инъекц|ботокс|диагност|имплант|ортодонт|массаж/, "медицина/медуслуги"],
  ["supplements", /(?<![а-я])бад(?![а-я])|биодобав|витамин/, "БАД"],
  ["finance", /кредит|(?<![а-я])займ|ипотек|(?<![а-я])вклад|рассрочк|инвест|страхов|брокер|микрофин/, "финансы"],
  ["alcohol", /алкогол|(?<![а-я])вин[оа](?![а-я])|(?<![а-я])пив[оа]|пивн|коньяк|водк|виски|(?<![а-я])сидр/, "алкоголь"],
  ["children", /для детей|детск|(?<![а-я])ребен|школьник|малыш/, "дети"],
];
export const guessRegulated = (brief: string): Array<{ cat: Regulated; label: string }> =>
  CATS.filter(([, r]) => r.test(norm(brief))).map(([cat, , label]) => ({ cat, label }));

// Требования к пометке (ориентир 38-ФЗ «О рекламе»; не юридическая консультация).
export const DISCLAIMER_RULES: Partial<Record<Regulated, { text: string; minSec: number; minArea: number; law: string }>> = {
  medical: { text: "Имеются противопоказания. Необходима консультация специалиста", minSec: 5, minArea: 0.07, law: "ст. 24 ч. 7" },
  supplements: { text: "Не является лекарственным средством", minSec: 5, minArea: 0.07, law: "ст. 25 ч. 1.1" },
  alcohol: { text: "Чрезмерное потребление алкоголя вредит вашему здоровью", minSec: 0, minArea: 0.1, law: "ст. 21 ч. 3" },
};

// ---------- отчёт (studio facts) ----------
export const factsReport = (dir: string, briefFile = "brief.md", today = new Date()): { lines: string[]; issues: FactIssue[] } => {
  const bf = join(dir, briefFile);
  if (!existsSync(bf)) return { lines: [`нет ${bf}`], issues: [] };
  const brief = readFileSync(bf, "utf8");
  const dates = briefDates(brief, today);
  const facts = briefFacts(brief);
  const cats = guessRegulated(brief);
  const issues = checkDates(brief, today);
  const ds = (d: BriefDate) => `${String(d.day).padStart(2, "0")}.${String(d.month + 1).padStart(2, "0")}.${d.year}`;
  const lines = [
    `даты: ${dates.length ? dates.map((d) => `${d.weekdayText ? d.weekdayText + ", " : ""}${d.text} → ${ds(d)} (${WD_NAME[new Date(d.year, d.month, d.day).getDay()]})`).join("; ") : "нет"}`,
    `числа брифа (дословно, с фразой): ${facts.filter((f) => !f.param).map((f) => `${f.n} → «${f.phrase}»`).join("; ") || "нет"}${facts.some((f) => f.param) ? `; параметры ролика, не для экрана: ${facts.filter((f) => f.param).map((f) => `${f.n} → «${f.phrase}»`).join("; ")}` : ""} — других чисел в речи и на экране нет, или они в «## Вопросы заказчику»; вычисленные из брифа — в «## Расчёты» (выражение = значение)`,
    `категория: ${cats.length ? cats.map((c) => c.label).join(", ") + " — похоже на регулируемую: studio skill claims-and-compliance; решение — \"regulated\" в job.json (\"none\" — если нет)" : "по словам брифа не регулируется (решает директор)"}`,
    ...issues.map((i) => `${i.level} ${i.kind}: ${i.msg}`),
    ...(issues.length ? [] : ["противоречий дат не найдено"]),
    "дальше: notes.md «## Факты брифа» — утверждения дословно, запреты брифа, категория, якоря реальности (что зритель проверит в жизни) и как каждый показан",
  ];
  return { lines, issues };
};

// ---------- для review.ts: факты брифа против готового черновика ----------
type TItem = { k: string; t: string; w: number; h: number; o: number; tx?: string; ro?: string };
type TTrack = { f: number; W: number; H: number; items: TItem[] };
export const reviewFacts = (dir: string, tracks: TTrack[], fps: number, today = new Date()): FactIssue[] => {
  const bf = join(dir, "brief.md");
  if (!existsSync(bf)) return [];
  const brief = readFileSync(bf, "utf8");
  const issues: FactIssue[] = [...checkDates(brief, today)];
  const notesF = join(dir, "notes.md");
  const notes = existsSync(notesF) ? readFileSync(notesF, "utf8") : "";
  const wf = join(dir, "public", "words.json");
  let words: string[] = [];
  try { if (existsSync(wf)) words = (JSON.parse(readFileSync(wf, "utf8")).words ?? []).map((w: { text: string }) => w.text); } catch { /* нет слов */ }
  // Текст на экране — то, что успевают прочесть (≥ 0.2 с): промежуточные значения счётчика
  // (10 100, 10 200…) стоят по кадру-два и утверждением не являются.
  const seenN = new Map<string, number>();
  for (const t of tracks) for (const it of t.items) if (it.t === "text" && it.o >= 0.5 && it.tx && it.ro !== "decor") seenN.set(it.tx, (seenN.get(it.tx) ?? 0) + 1);
  const screen = [...seenN.entries()].filter(([, n]) => n >= Math.max(6, Math.round(fps * 0.2))).map(([tx]) => tx);
  issues.push(...inventedNumbers({ dir, brief, words, screen, notes }));
  // Регулируемая категория: решение директора в job.json (regulated: "medical" | … | "none").
  let declared: string | undefined;
  try { declared = JSON.parse(readFileSync(join(dir, "job.json"), "utf8")).regulated; } catch { /* нет job.json */ }
  const cats: Regulated[] = declared && declared !== "none" ? (String(declared).split(/[,\s]+/).filter(Boolean) as Regulated[]) : declared === "none" ? [] : guessRegulated(brief).map((c) => c.cat);
  const explicit = Boolean(declared && declared !== "none");
  if (!declared && cats.length) issues.push({ level: "WARN", kind: "regulated?", msg: `бриф похож на регулируемую категорию (${guessRegulated(brief).map((c) => c.label).join(", ")}): обязательные пометки и запреты на обещания — studio skill claims-and-compliance; решение — "regulated" в job.json ("none" — если нет)` });
  if (tracks.length) {
    const W = tracks[0].W, H = tracks[0].H;
    for (const c of cats) {
      const rule = DISCLAIMER_RULES[c];
      if (!rule) continue;
      let n = 0, maxArea = 0;
      for (const t of tracks) {
        const ds = t.items.filter((it) => it.ro === "disclaimer" && it.o >= 0.6);
        if (!ds.length) continue;
        n++;
        maxArea = Math.max(maxArea, ds.reduce((s0, it) => s0 + Math.max(0, it.w) * Math.max(0, it.h), 0) / (W * H));
      }
      const sec = n / fps;
      if (!n) issues.push({ level: explicit ? "FAIL" : "WARN", kind: "disclaimer-missing", msg: `${c}: нет текста data-role="disclaimer" — «${rule.text}» (38-ФЗ ${rule.law}; ориентир ≥ ${rule.minSec} с, ≥ ${Math.round(rule.minArea * 100)} % площади кадра). Где и как — решает директор (полоса внизу мира, на финале, в плашке)` });
      else if (sec < rule.minSec || maxArea < rule.minArea) issues.push({ level: "WARN", kind: "disclaimer-weak", msg: `${c}: пометка видна ${sec.toFixed(1)} с, занимает до ${(maxArea * 100).toFixed(1)} % кадра — ориентир ≥ ${rule.minSec} с и ≥ ${Math.round(rule.minArea * 100)} % (38-ФЗ ${rule.law})` });
    }
  }
  return issues;
};
