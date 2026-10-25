// <SwapText> — текст в постоянной плашке/карточке меняется ПЕРЕКРЁСТНО: старый уходит, пока
// новый приходит, плашка остаётся (нет кадра «пустая карточка», который ловит FrameAudit
// как empty-plate). Ширина/высота плашки — от коробки, текст не «дышит».
//   <SwapText box={card} items={[{ at: 0, node: <b>+7°</b> }, { at: 130, node: <b>+6°</b> }]}
//             plate={{ background: "#fff", borderRadius: 28 }} />
// at — кадр, с которого виден элемент; переход длится fade кадров (8), сдвиг rise px (0).
// mode "sequential" (по умолчанию): старый уходит за ~0.6·fade, новый начинает приходить,
// когда старый погас полностью, — две строки не стоят друг на друге полупрозрачными (на
// телефоне это «каша»: «На счётет / 1000000₽₽»). "cross" — прежнее одновременное растворение
// (только для строк одинаковой ширины/формы).
import React from "react";
import { useCurrentFrame } from "remotion";
import type { Box } from "../layout";

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (t: number) => t * t * (3 - 2 * t);

export const SwapText: React.FC<{
  box: Box; items: Array<{ at: number; node: React.ReactNode }>; fade?: number; rise?: number;
  plate?: React.CSSProperties; style?: React.CSSProperties; id?: string; mode?: "sequential" | "cross";
}> = ({ box, items, fade = 8, rise = 0, plate, style, id = "swap", mode = "sequential" }) => {
  const frame = useCurrentFrame();
  const list = [...items].sort((p, q) => p.at - q.at);
  return (
    <div data-id={id} style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, ...plate }}>
      {list.map((it, i) => {
        const next = list[i + 1];
        const outDur = mode === "cross" ? fade : Math.max(3, Math.round(fade * 0.6));
        // Новый — ровно после ухода старого: даже один общий кадр на 10 % — «каша» на стоп-кадре.
        const inDelay = mode === "cross" || i === 0 ? 0 : outDur;
        const inDur = mode === "cross" ? fade : Math.max(4, Math.round(fade * 0.75));
        const inK = i === 0 && it.at <= 0 ? 1 : ease(clamp01((frame - it.at - inDelay) / inDur));
        const outK = next ? ease(clamp01((frame - next.at) / outDur)) : 0;
        const o = Math.min(inK, 1 - outK);
        if (o <= 0.001) return null;
        return (
          <div key={i} style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: o, transform: rise ? `translateY(${((1 - inK) - outK) * rise}px)` : undefined, ...style }}>
            {it.node}
          </div>
        );
      })}
    </div>
  );
};
