// Скилл sound-design: звук ролика как функции кадра.
//   import { SfxTrack, Bed, speechSpans, duck } from "@studio/sound-design";
//   <Audio src={staticFile("voice.wav")} />                                  // голос
//   <SfxTrack events={[{ atSec: 2.8, id: "pop2", volume: 0.35, why: "вход карточки" }]} />
//   Время события: atSec — секунды (как words.json; предпочтительно), at — ЦЕЛЫЙ кадр.
//   Дробный at — ошибка (sfx-units, FAIL): это почти всегда секунды в поле кадров, и все
//   звуки сбиваются в первые полсекунды.
//   <Bed src={staticFile("music/x.mp3")} words={words?.words} base={0.3} />   // under = base/2
// Правила-страховки (не вкус): звук события в кадр события; не чаще одного на minGapSec;
// итог нормализует studio render (−14 LUFS, пик −1.5).
// Приглушение под речью по умолчанию — вдвое (≈ −6 дБ): в ленте музыку должно быть слышно
// на динамике телефона (mixcheck: речь − паузы 6–10 дБ). Экспертный разговор «голос прежде
// всего» — under ≈ base × 0.3; детское/соцсети — × 0.5 (по умолчанию).
import React from "react";
import { Audio, interpolate, Sequence, staticFile, useVideoConfig } from "remotion";
import { reportGuard } from "../layout";

export type SfxEvent = { at?: number; atSec?: number; id: string; volume?: number; why?: string; trimEnd?: number };

// Кадр события: atSec × fps или целый at. null — время не задано.
export const sfxFrame = (e: SfxEvent, fps: number): number | null =>
  typeof e.atSec === "number" ? Math.round(e.atSec * fps) : typeof e.at === "number" ? Math.round(e.at) : null;

// Звуки каталога (`studio sfx --copy id` кладёт их в public/sfx/). Пики каталога ≈ −2 дБFS —
// при volume 1 щелчок громче голоса: стартовые громкости 0.2–0.45.
export const SfxTrack: React.FC<{ events: SfxEvent[]; minGapSec?: number; dir?: string; defaultVolume?: number }> = ({ events, minGapSec = 0.5, dir = "sfx", defaultVolume = 0.35 }) => {
  const { fps, durationInFrames: D } = useVideoConfig();
  // Единицы: дробный at — секунды в поле кадров; все события в первую секунду длинного
  // ролика — тоже похоже на секунды. Сигнал sfx-units (FAIL) с причиной, а не «тесно».
  for (const e of events) {
    if (typeof e.atSec !== "number" && typeof e.at === "number" && !Number.isInteger(e.at)) reportGuard({ id: `sfx:${e.id}`, kind: "sfx-units", frame: 0, amount: e.at, detail: { msg: `дробный at=${e.at}: at — номер кадра; секунды — atSec: ${e.at}` } });
    if (typeof e.atSec !== "number" && typeof e.at !== "number") reportGuard({ id: `sfx:${e.id}`, kind: "sfx-units", frame: 0, amount: 0, detail: { msg: "нет времени события: atSec (секунды) или at (кадр)" } });
  }
  const timed = events.map((e) => ({ ...e, f: sfxFrame(e, fps) })).filter((e): e is SfxEvent & { f: number } => e.f !== null);
  if (timed.length >= 3 && D > fps * 6 && timed.every((e) => e.f < fps)) reportGuard({ id: "sfx", kind: "sfx-units", frame: 0, amount: timed.length, detail: { msg: `все ${timed.length} звуков в первую секунду ролика длиной ${(D / fps).toFixed(0)} с — время указано в секундах в поле at? используйте atSec` } });
  const sorted = [...timed].sort((p, q) => p.f - q.f);
  sorted.forEach((e, i) => {
    const prev = sorted[i - 1];
    if (prev && (e.f - prev.f) / fps < minGapSec) reportGuard({ id: `sfx:${e.id}`, kind: "sfx-crowded", frame: e.f, amount: +((e.f - prev.f) / fps).toFixed(2), detail: { prev: prev.id, atFrame: prev.f, minGapSec } });
  });
  return (
    <>
      {sorted.map((e, i) => (
        <Sequence key={`${e.id}-${e.f}-${i}`} from={e.f} durationInFrames={e.trimEnd ?? Math.round(fps * 3)} layout="none" name={`sfx ${e.id}`}>
          <Audio src={staticFile(`${dir}/${e.id}.wav`)} volume={e.volume ?? defaultVolume} />
        </Sequence>
      ))}
    </>
  );
};

type W = { start: number; end: number };
// Где звучит речь: слова, склеенные через паузы короче mergeGap (с.).
export const speechSpans = (words: W[] = [], mergeGap = 0.45): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (const w of words) {
    const last = out[out.length - 1];
    if (last && w.start - last[1] <= mergeGap) last[1] = Math.max(last[1], w.end);
    else out.push([w.start, w.end]);
  }
  return out;
};

// Громкость подложки на кадре: base без речи, under под речью; плавно за rampSec до и после.
export const duck = (frame: number, fps: number, spans: Array<[number, number]>, o: { base?: number; under?: number; rampSec?: number } = {}) => {
  const base = o.base ?? 0.3, under = o.under ?? base * 0.5, ramp = o.rampSec ?? 0.25;
  const t = frame / fps;
  let k = 0; // 1 — речь
  for (const [s, e] of spans) {
    if (t >= s - ramp && t <= e + ramp) {
      const kin = t < s ? (t - (s - ramp)) / ramp : 1;
      const kout = t > e ? 1 - (t - e) / ramp : 1;
      k = Math.max(k, Math.min(kin, kout));
    }
  }
  return base + (under - base) * k;
};

// Подложка (музыка/атмосфера) с приглушением под речь и мягкими краями.
export const Bed: React.FC<{
  src: string; words?: W[]; base?: number; under?: number; rampSec?: number;
  fadeInSec?: number; fadeOutSec?: number; loop?: boolean; from?: number; durationInFrames?: number;
}> = ({ src, words, base = 0.3, under, rampSec = 0.25, fadeInSec = 0.6, fadeOutSec = 0.4, loop = true, from = 0, durationInFrames }) => {
  const { fps, durationInFrames: D } = useVideoConfig();
  const len = durationInFrames ?? D - from;
  const spans = React.useMemo(() => speechSpans(words), [words]);
  return (
    <Sequence from={from} durationInFrames={len} layout="none" name="bed">
      <Audio src={src} loop={loop} volume={(f) => {
        const edge = interpolate(f, [0, fadeInSec * fps, len - fadeOutSec * fps, len], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        return edge * duck(f + from, fps, spans, { base, under, rampSec });
      }} />
    </Sequence>
  );
};

// Кадры слов — чтобы поставить звук ровно на слово: wordFrame(words, "десять", fps).
export const wordFrame = (words: Array<{ text: string; start: number }> = [], prefix: string, fps: number, nth = 0) => {
  const hits = words.filter((w) => w.text.toLowerCase().replace(/ё/g, "е").startsWith(prefix.toLowerCase().replace(/ё/g, "е")));
  return hits[nth] ? Math.round(hits[nth].start * fps) : null;
};
