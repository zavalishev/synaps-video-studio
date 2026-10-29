// <Rig> — герой из частей на шарнирах в кадре: готовые движения по списку действий, дыхание,
// моргание и запаздывание ушей/хвоста сами. Части и скелет — `studio rig cut` (из листа частей,
// сгенерированного `studio image`), проверка поз без рендера — `studio rig check`.
//
//   import rig from "../../public/rig/bear/rig.json";
//   <Rig rig={rig} x={540} y={1500} height={900} actions={[
//     { do: "walk", at: 0.3, to: [700, 1500] }, { do: "hop", at: 2.1 }, { do: "wave", at: 3, arm: "R" },
//     ...talkFromWords(words, { ids: ["hello"] }),
//   ]} />
//
// x, y — точка на земле под героем (середина низа в исходной позе), height — рост в пикселях.
// Время действий — секунды от начала сцены (Sequence), delay сдвигает все.
import React, { useMemo } from "react";
import { Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { bounds, css, drawList, evaluate, restBounds, rootMatrix, validateRig, type RigAction, type RigDef } from "./pose";

export * from "./pose";

export type RigProps = {
  rig: RigDef;
  x: number;
  y: number;
  height: number;
  facing?: 1 | -1;
  actions?: RigAction[];
  /** Сдвиг времени действий, секунды. */
  delay?: number;
  /** Тень под ногами: true — мягкая тёмная, строка — свой цвет, false — без тени. */
  shadow?: boolean | string;
  /** Метить как героя кадра для самопроверки (data-hero). По умолчанию да. */
  hero?: boolean;
  /** Фильтр на всего героя (цветокор под фон: "saturate(0.9) brightness(0.97)"). */
  filter?: string;
  id?: string;
};

export const Rig: React.FC<RigProps> = ({ rig, x, y, height, facing = 1, actions = [], delay = 0, shadow = true, hero = true, filter, id }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rest = useMemo(() => {
    const err = validateRig(rig);
    if (err.length) throw new Error(`Rig ${rig.name ?? ""}: ${err.join("; ")}`);
    return restBounds(rig);
  }, [rig]);
  const t = frame / fps - delay;
  const st = evaluate(rig, actions, t, { x, y, facing, height, seed: id ?? rig.name });
  const items = drawList(rig, st.pose, rootMatrix(rig, rest, st.x, st.y, height, st.pose));
  const bb = bounds(items);
  const lift = Math.max(0, -st.pose.dy) / height;
  const shadowColor = typeof shadow === "string" ? shadow : "rgba(0,0,0,0.28)";
  const sw = height * 0.42 * (1 - 0.5 * Math.min(1, lift * 2.5));
  return (
    <>
      {shadow !== false && (
        <div style={{ position: "absolute", left: st.x - sw / 2, top: st.y - height * 0.025, width: sw, height: height * 0.05, borderRadius: "50%", background: `radial-gradient(closest-side, ${shadowColor}, transparent)`, opacity: 1 - 0.6 * Math.min(1, lift * 2.5) }} />
      )}
      <div data-id={id ?? rig.name ?? "rig"} {...(hero ? { "data-hero": "" } : {})} data-acting=""
        style={{ position: "absolute", left: bb.x, top: bb.y, width: bb.w, height: bb.h, filter }}>
        {items.map((it) => it.kind === "img" ? (
          <Img key={it.name} src={staticFile(it.src)}
            style={{ position: "absolute", left: 0, top: 0, width: it.w, height: it.h, maxWidth: "none", transformOrigin: "0 0", transform: css(it.m, bb.x, bb.y) }} />
        ) : (
          <svg key={it.name} width={1} height={1} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", transformOrigin: "0 0", transform: css(it.m, bb.x, bb.y) }}>
            {it.outline && <path d={it.d} fill="none" stroke={it.outline} strokeWidth={it.width + 6} strokeLinecap="round" />}
            <path d={it.d} fill="none" stroke={it.color} strokeWidth={it.width} strokeLinecap="round" />
            {it.endR ? <circle cx={0} cy={it.len} r={it.endR} fill={it.endColor ?? it.color} stroke={it.outline} strokeWidth={it.outline ? 3 : 0} /> : null}
          </svg>
        ))}
      </div>
    </>
  );
};
