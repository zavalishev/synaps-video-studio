// Скилл beat-planner: биты (beats.json) в сцене.
//   import beatsFile from "../beats.json";
//   import { Beats, beatAt } from "@studio/beat-planner";
//   <Beats beats={beatsFile.beats} render={(b) => <Scene beat={b} />} />
// Каждый бит — <Sequence from={b.from} durationInFrames={b.to - b.from}> (слой во весь кадр,
// заранее смонтирован за premountFor кадров — картинки успевают загрузиться): внутри сцены кадр
// считается от начала бита. overlap — сколько кадров следующий бит начинается раньше (для
// растворения/шторки, которые сцена делает сама); по умолчанию 0 — чистая склейка на слове.
import React from "react";
import { Sequence } from "remotion";

export type Beat = {
  id: string; from: number; to: number;
  text?: string; keywords?: string[]; kind?: string; shot?: string; skill?: string; why?: string;
  transition?: { type: string; frames?: number }; cut_word?: string;
  [k: string]: unknown;
};

export const Beats: React.FC<{
  beats: Beat[];
  render: (beat: Beat, index: number) => React.ReactNode;
  overlap?: number | ((beat: Beat, index: number) => number);
  premountFor?: number;
}> = ({ beats, render, overlap = 0, premountFor = 15 }) => (
  <>
    {beats.map((b, i) => {
      const ov = i === 0 ? 0 : typeof overlap === "function" ? overlap(b, i) : overlap;
      return (
        <Sequence key={b.id} from={b.from - ov} durationInFrames={b.to - b.from + ov} premountFor={premountFor} name={b.id}>
          {render(b, i)}
        </Sequence>
      );
    })}
  </>
);

export const beatAt = (beats: Beat[], frame: number): Beat | null => beats.find((b) => frame >= b.from && frame < b.to) ?? null;

// 0 → 1 по длине бита (для медленного наезда, прогресса шага).
export const beatProgress = (b: Beat, frame: number) => Math.min(1, Math.max(0, (frame - b.from) / Math.max(1, b.to - b.from)));

// Кадры склеек — для studio probe --cuts и самопроверки.
export const cutsOf = (beats: Beat[]) => beats.slice(1).map((b) => b.from);
