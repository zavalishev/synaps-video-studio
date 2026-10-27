// Озвучка одним заходом: реплики одного голоса читаются как связная речь (интонация видит
// соседние фразы), потом запись режется на реплики по таймингам слов из ответа провайдера.
// Пометки исполнения — английские слова в квадратных скобках ([warmly], [sighs]): их понимает
// ElevenLabs eleven_v3, вслух они не читаются; в субтитры и тайминги не попадают.
import type { TimedWord } from "./_tts";

export const TAG_RE = /\[[^[\]\n]{1,40}\]/g;
export const stripTags = (s: string) => s.replace(TAG_RE, " ").replace(/\s+/g, " ").trim();
export const isTagWord = (w: string) => /^\[[^[\]]{1,40}\]$/.test(w.trim());
const leadsWithTag = (s: string) => /^\s*\[[^[\]\n]{1,40}\]/.test(s);

export const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]/gu, "");
/** Слова реплики, которые звучат (без пометок и одиночных знаков). */
export const speechTokens = (s: string) => stripTags(s).split(/\s+/).filter((t) => norm(t).length > 0);

export type Segment = { start: number; end: number; words: TimedWord[] };

// Запас по краям реплики: начало слова — с вдохом, конец — с затуханием.
const LEAD = 0.06, DECAY = 0.15, LAST_DECAY = 0.25;

/**
 * Режет общую запись (`dur` секунд, слова `heard`) на реплики `texts`. Пометка в начале реплики
 * (вздох, смех) звучит до первого слова — она остаётся у своей реплики. null — слова ответа не
 * совпали со сценарием: тогда реплики озвучиваются по одной.
 */
export const splitJoint = (texts: string[], heard: TimedWord[], dur: number): Segment[] | null => {
  const words = heard.filter((w) => !isTagWord(w.text) && norm(w.text).length > 0);
  const tokens = texts.map(speechTokens);
  if (!texts.length || tokens.some((t) => t.length === 0)) return null;
  if (words.length !== tokens.reduce((n, t) => n + t.length, 0)) return null;
  // Провайдер возвращает символы сценария; больше 20 % несовпадений — разметка чужая.
  const flat = tokens.flat();
  const miss = flat.filter((t, i) => norm(t) !== norm(words[i].text)).length;
  if (miss > flat.length * 0.2) return null;

  let k = 0;
  const groups = tokens.map((t) => { const g = words.slice(k, k + t.length); k += t.length; return g; });
  const starts = groups.map((g, i) => {
    const first = g[0].start;
    if (i === 0) return leadsWithTag(texts[0]) ? 0 : Math.max(0, first - LEAD);
    const prevEnd = groups[i - 1][groups[i - 1].length - 1].end;
    const s = leadsWithTag(texts[i]) ? Math.min(prevEnd + 0.08, first - 0.02) : Math.max(prevEnd + LEAD, first - LEAD * 1.5);
    return Math.min(Math.max(s, prevEnd), first);
  });
  const segs = groups.map((g, i) => {
    const lastEnd = g[g.length - 1].end;
    const end = i === groups.length - 1 ? Math.min(dur, lastEnd + LAST_DECAY) : Math.min(starts[i + 1], lastEnd + DECAY);
    const start = starts[i];
    return {
      start, end: Math.max(end, start + 0.05),
      words: g.map((w) => ({ text: w.text, start: Math.max(0, w.start - start), end: Math.max(0, w.end - start) })),
    };
  });
  return segs;
};

/** Реплики подряд одним заходом: тот же голос и подача, текст в пределах `max` знаков. */
export const groupLines = <T extends { text: string; key: string }>(items: T[], max: number): number[][] => {
  const out: number[][] = [];
  let cur: number[] = [], len = 0;
  items.forEach((it, i) => {
    const prev = cur.length ? items[cur[cur.length - 1]] : null;
    const add = it.text.length + (cur.length ? 1 : 0);
    if (prev && (prev.key !== it.key || len + add > max)) { out.push(cur); cur = []; len = 0; }
    len += it.text.length + (cur.length ? 1 : 0);
    cur.push(i);
  });
  if (cur.length) out.push(cur);
  return out;
};
