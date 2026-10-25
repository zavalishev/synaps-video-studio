// Слова озвучки → страницы субтитров. Чистые функции, без React: можно звать в node
// (проверка плана) и в сцене.
//   • paginate(words, opts) — группы по 1–N слов: разрыв на конце фразы, на паузе, по
//     числу слов и знаков; короткий предлог не остаётся последним словом страницы;
//   • keywordSet / isKeyword — ключевые слова (сравнение без регистра, ё = е, без знаков);
//   • pageAt(pages, t) — страница на момент t (с.) с учётом опережения и удержания.
export type CapWord = { text: string; start: number; end: number; line?: number; gi?: number };
export type CapPage = { i: number; words: CapWord[]; start: number; end: number; showUntil: number };

export const normWord = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9%]/g, "");

const SENT_END = /[.!?…]["»)]?$/;
const SOFT_END = /[,;:—–]["»)]?$/;
const SHORT = new Set(["в", "во", "и", "а", "но", "на", "с", "со", "к", "ко", "у", "о", "об", "от", "до", "за", "по", "из", "не", "ни", "что", "как", "это"]);

export type PaginateOpts = {
  maxWords?: number;   // по умолчанию 4
  maxChars?: number;   // по умолчанию 24 (вертикаль, крупный кегль, 2 строки)
  pauseSec?: number;   // пауза в речи, на которой страница рвётся (0.32)
  softBreak?: boolean; // рвать на запятой/тире, если страница уже не короче 2 слов (да)
  holdSec?: number;    // последняя страница держится после конца речи (0.6)
  maxGapHoldSec?: number; // страница держится в паузе не дольше (0.8), дальше — пусто
};

export const paginate = (words: CapWord[], o: PaginateOpts & { keepTogether?: Array<[number, number]> } = {}): CapPage[] => {
  const maxW = o.maxWords ?? 4, maxC = o.maxChars ?? 24, pause = o.pauseSec ?? 0.32;
  const groups: CapWord[][] = [];
  let cur: CapWord[] = [];
  const chars = (g: CapWord[]) => g.reduce((s, w) => s + w.text.length, 0) + Math.max(0, g.length - 1);
  words.forEach((w, i) => {
    const prev = words[i - 1];
    const brk = cur.length > 0 && (
      cur.length >= maxW ||
      chars([...cur, w]) > maxC ||
      (prev && SENT_END.test(prev.text)) ||
      (prev && w.start - prev.end >= pause) ||
      ((o.softBreak ?? true) && prev && SOFT_END.test(prev.text) && cur.length >= 2) ||
      (prev && prev.line !== undefined && w.line !== undefined && prev.line !== w.line)
    );
    // Ключевая фраза не рвётся между страницами: начало фразы уходит на новую страницу.
    const ph = brk ? o.keepTogether?.find(([a, b]) => a < i && i <= b && words[a] && cur.includes(words[a])) : undefined;
    if (ph && cur.indexOf(words[ph[0]]) > 0) {
      const k = cur.indexOf(words[ph[0]]);
      groups.push(cur.slice(0, k)); cur = [...cur.slice(k), w];
    } else if (brk) {
      // Короткое служебное слово не висит в конце страницы — уходит на следующую.
      const last = cur[cur.length - 1];
      if (cur.length > 1 && SHORT.has(normWord(last.text)) && !SENT_END.test(last.text) && !SOFT_END.test(last.text)) {
        cur.pop(); groups.push(cur); cur = [last, w];
      } else { groups.push(cur); cur = [w]; }
    } else cur.push(w);
  });
  if (cur.length) groups.push(cur);
  const hold = o.holdSec ?? 0.6, gapHold = o.maxGapHoldSec ?? 0.8;
  return groups.map((g, i) => {
    const start = g[0].start, end = g[g.length - 1].end;
    const next = groups[i + 1]?.[0].start;
    const showUntil = next === undefined ? end + hold : Math.min(next, end + gapHold);
    return { i, words: g, start, end, showUntil };
  });
};

export const pageAt = (pages: CapPage[], t: number, leadSec = 0.04): CapPage | null => {
  for (let i = pages.length - 1; i >= 0; i--) {
    const p = pages[i];
    if (t >= p.start - leadSec) return t < p.showUntil ? p : null;
  }
  return null;
};

export const keywordSet = (list: string[] = []) => new Set(list.flatMap((k) => k.split(/\s+/)).map(normWord).filter(Boolean));
export const isKeyword = (set: Set<string>, w: string) => set.has(normWord(w));

// Ключевые фразы → диапазоны индексов слов [первое, последнее] (подряд, без регистра;
// окончания прощаются: «аренда» найдёт «аренды»).
export const keywordRanges = (words: Array<{ text: string }>, phrases: string[] = []): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  const W = words.map((w) => normWord(w.text));
  const stem = (x: string, n: number) => x.slice(0, Math.max(4, n - 2));
  const same = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 4 && stem(a, Math.min(a.length, b.length)) === stem(b, Math.min(a.length, b.length)));
  for (const ph of phrases) {
    const P = ph.split(/\s+/).map(normWord).filter(Boolean);
    if (!P.length) continue;
    for (let i = 0; i + P.length <= W.length; i++) if (P.every((p, k) => same(W[i + k], p))) out.push([i, i + P.length - 1]);
  }
  return out;
};

// Индексы слов, входящих в ключевые фразы (подряд, без регистра; окончания прощаются:
// «аренда» найдёт «аренды»). Фразы — из beats.json/плана директора.
export const keywordIndices = (words: Array<{ text: string }>, phrases: string[] = []): Set<number> => {
  const out = new Set<number>();
  for (const [a, b] of keywordRanges(words, phrases)) for (let k = a; k <= b; k++) out.add(k);
  return out;
};
