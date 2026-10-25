// Слова озвучки: public/words.json (пишет `studio voice`). Тайминги в секундах и в формате
// @remotion/captions (captions: Caption[] в мс) — для createTikTokStyleCaptions.
import { useEffect, useState } from "react";
import { cancelRender, continueRender, delayRender, staticFile } from "remotion";
import type { Caption } from "@remotion/captions";

export { createTikTokStyleCaptions } from "@remotion/captions";
export type { Caption };

export type Word = { text: string; start: number; end: number; line: number };
export type Line = { id: string; say: string; start: number; end: number; words: Word[] };
export type WordsFile = { audio: string; total: number; lang: string; lines: Line[]; words: Word[]; captions: Caption[] };

export const useWords = (file = "words.json"): WordsFile | null => {
  const [data, setData] = useState<WordsFile | null>(null);
  const [handle] = useState(() => delayRender(`words ${file}`));
  useEffect(() => {
    fetch(staticFile(file)).then((r) => { if (!r.ok) throw new Error(`нет public/${file}`); return r.json(); })
      .then((j) => { setData(j); continueRender(handle); })
      .catch((e) => cancelRender(e));
  }, [file, handle]);
  return data;
};

// Слово, звучащее в момент t (секунды), или null.
export const wordAt = (words: Word[], t: number): Word | null => words.find((w) => t >= w.start && t < w.end) ?? null;
// Секунда → кадр (вниз), кадр → секунда.
export const secToFrame = (s: number, fps: number) => Math.floor(s * fps);
export const frameToSec = (f: number, fps: number) => f / fps;
