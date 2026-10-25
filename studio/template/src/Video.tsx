// Заглушка: директор заменяет её своим роликом. Раскладка, которая дёшево правится:
//   src/Video.tsx        — тонкий таймлайн: Stage, звук, последовательность битов, FrameAudit;
//   src/scenes/bNN.tsx   — одна сцена (бит) на файл: правка одной сцены — Edit одного файла,
//                          остальные не трогаются и не перечитываются.
// Кадр 0 — превью в ленте: он уже готовая картинка, а не проявление из пустоты.
// Шрифт и цвета — из theme.json (скилл art-direction; `studio fonts --suggest <голос>`).
import React from "react";
import { Sequence } from "remotion";
import { Stage } from "@studio";
import { FrameAudit } from "@studio/layout-guard";
import { Title } from "./scenes/b01";

export const Video: React.FC = () => (
  <Stage bg="#f3ede2">
    <Sequence from={0} layout="none" name="b01">
      <Title />
    </Sequence>
    <FrameAudit />
  </Stage>
);
