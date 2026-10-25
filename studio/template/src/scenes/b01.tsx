// Бит b01 (пример раскладки «одна сцена — один файл»). Положение каждого слоя — функция кадра;
// главный предмет помечен data-hero (самопроверка меряет его размер и первое появление).
import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { Guarded, progress, useTextCheck } from "@studio";

export const Title: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const size = Math.round(H * 0.07);
  useTextCheck("title", { fontSizePx: size, color: "#1d1b18", background: "#f3ede2", words: 2 });
  const push = 1 + 0.08 * progress(frame, fps * 0.5, fps * 2); // наезд к главному с полсекунды
  return (
    <Guarded id="title" box={{ x: W * 0.1, y: H * 0.4, w: W * 0.8, h: H * 0.18 }}>
      <div data-hero style={{ transform: `scale(${push})`, height: "100%", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", fontFamily: "sans-serif", fontWeight: 800, fontSize: size, color: "#1d1b18" }}>
        Студия: проверка
      </div>
    </Guarded>
  );
};
