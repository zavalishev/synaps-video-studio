// Стиль серии для бумажного набора: палитра, регистр текста, сид. Его кладёт в контекст
// KitStyleProvider (paper-2d), рисунки деталей, декораций и подписи читают только его — своих цветов и
// регистра у кита нет. Без провайдера рисунок 0.4 падает громко (сцена уходит в
// NeutralScene), а не рисует «запасными» цветами.
import React, { createContext, useContext } from "react";
import { applyCase } from "./geometry";
import type { Palette } from "../timeline/types";

export type KitStyle = { palette: Palette; case: "upper" | "sentence" | "asis"; seed: number };
const Ctx = createContext<KitStyle | null>(null);

export const KitStyleProvider: React.FC<{ style: KitStyle; children: React.ReactNode }> = ({ style, children }) => (
  <Ctx.Provider value={style}>{children}</Ctx.Provider>
);
export const useKitStyle = (): KitStyle => {
  const s = useContext(Ctx);
  if (!s) throw new Error("кит 0.4: нет KitStyleProvider — палитру серии некому передать");
  return s;
};
// Текст в регистре серии (style.case; нет = как написано).
export const useCased = () => {
  const s = useKitStyle();
  return (text: string) => applyCase(text, s.case);
};
// Фон сцены по палитре: bg, если есть, иначе бумага (на нём проверяется контраст подписи).
export const stageBg = (p: Palette) => p.bg ?? p.paper;
