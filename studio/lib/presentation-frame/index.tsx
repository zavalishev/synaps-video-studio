// Скилл presentation-frame: упаковка ролика для площадки — окно, ноутбук, телефон, постоянный
// заголовок, прогресс. Импорт: import { Backdrop, Screen, WindowCard, Laptop, Phone, Headline, ProgressBar, StepDots, Vignette } from "@studio/presentation-frame";
//
// Главный приём — <Screen w h>: внутри него «свой кадр» w×h (useVideoConfig детей видит w×h,
// Stage/Guarded/CoverImage работают как в полном кадре), а снаружи он вписан в рамку. Поэтому
// сцену, написанную для 1080×1920, можно положить в окно или телефон без переделки, а готовый
// mp4 — через <OffthreadVideo> внутри Screen.
// Бренды устройств не рисуем: ноутбук и телефон — обобщённые, без логотипов.
import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";

type Box = { x: number; y: number; w: number; h: number };

// ---------------------------------------------------------------- фон-подложка
// Подложка: заливка, по желанию мягкие цветные пятна и точечная сетка. Цвета — только из
// theme.json (color обязателен, пятен и сетки по умолчанию нет: «окно на бежевом» с
// персиковым и голубым пятном было домом студии). Пятна дрейфуют медленно (drift px за ролик).
export const Backdrop: React.FC<{ color: string; blobs?: { x: number; y: number; r: number; color: string }[]; dots?: string | false; drift?: number; children?: React.ReactNode }> = ({
  color, blobs = [], dots = false, drift = 40, children,
}) => {
  const frame = useCurrentFrame();
  const { width: W, height: H, durationInFrames: D } = useVideoConfig();
  const t = frame / Math.max(1, D - 1);
  return (
    <AbsoluteFill style={{ background: color, overflow: "hidden" }}>
      {blobs.map((b, i) => {
        const r = b.r * Math.max(W, H);
        const dx = Math.sin(t * Math.PI + i) * drift, dy = Math.cos(t * Math.PI + i * 2) * drift * 0.6;
        return <div key={i} style={{ position: "absolute", left: b.x * W - r + dx, top: b.y * H - r + dy, width: r * 2, height: r * 2, borderRadius: "50%", background: `radial-gradient(closest-side, ${b.color}, ${b.color}00)`, opacity: 0.85 }} />;
      })}
      {dots ? <AbsoluteFill style={{ backgroundImage: `radial-gradient(${dots} 1.6px, transparent 1.8px)`, backgroundSize: `${Math.round(W / 24)}px ${Math.round(W / 24)}px` }} /> : null}
      {children}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- «кадр в кадре»
// Дети рисуются в виртуальном кадре w×h и вписываются (contain) в коробку box (px внешнего
// кадра; по умолчанию — весь родитель). from — с какого кадра внешнего ролика идёт внутренний.
export const Screen: React.FC<{ w: number; h: number; box?: Box; from?: number; radius?: number; background?: string; children?: React.ReactNode }> = ({ w, h, box, from = 0, radius = 0, background = "#000", children }) => {
  const { width: W, height: H } = useVideoConfig();
  const b = box ?? { x: 0, y: 0, w: W, h: H };
  const k = Math.min(b.w / w, b.h / h);
  const ox = b.x + (b.w - w * k) / 2, oy = b.y + (b.h - h * k) / 2;
  return (
    <div style={{ position: "absolute", left: ox, top: oy, width: w * k, height: h * k, overflow: "hidden", borderRadius: radius, background }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, transform: `scale(${k})`, transformOrigin: "0 0" }}>
        <Sequence from={from} width={w} height={h}>{children}</Sequence>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- окно приложения
export type Tilt = { x?: number; y?: number; z?: number }; // градусы, держите в пределах ±10
const tiltCss = (t?: Tilt) => (t ? `perspective(2400px) rotateX(${t.x ?? 0}deg) rotateY(${t.y ?? 0}deg) rotateZ(${t.z ?? 0}deg)` : undefined);

// Окно с заголовком: chrome "mac" (три точки + название), "browser" (точки + адресная строка),
// "none". content — размер внутреннего кадра (по умолчанию — по коробке окна).
export const WindowCard: React.FC<{
  box: Box; title?: string; chrome?: "mac" | "browser" | "none"; url?: string; radius?: number; tilt?: Tilt; dark?: boolean;
  content?: { w: number; h: number }; contentFrom?: number; font?: string; children?: React.ReactNode; style?: React.CSSProperties;
}> = ({ box, title, chrome = "mac", url, radius, tilt, dark = false, content, contentFrom = 0, font = "sans-serif", children, style }) => {
  const { height: H } = useVideoConfig();
  const R = radius ?? Math.round(Math.min(box.w, box.h) * 0.035);
  const bar = chrome === "none" ? 0 : Math.round(Math.max(36, H * 0.03));
  const inner = { x: 0, y: bar, w: box.w, h: box.h - bar };
  const c = content ?? { w: inner.w, h: inner.h };
  const barBg = dark ? "#23232b" : "#f6f3ee", ink = dark ? "#c9c6d1" : "#6b665e";
  return (
    <div style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, borderRadius: R, overflow: "hidden", transform: tiltCss(tilt),
      boxShadow: "0 40px 90px rgba(40,28,15,.28), 0 8px 22px rgba(40,28,15,.16)", background: dark ? "#16161c" : "#fff", ...style }}>
      {chrome !== "none" ? (
        <div style={{ position: "absolute", left: 0, top: 0, width: box.w, height: bar, background: barBg, display: "flex", alignItems: "center", gap: bar * 0.22, padding: `0 ${bar * 0.45}px`, boxSizing: "border-box", borderBottom: `1px solid ${dark ? "#2e2e38" : "#e7e1d8"}` }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((col) => <div key={col} style={{ width: bar * 0.3, height: bar * 0.3, borderRadius: "50%", background: col }} />)}
          {chrome === "browser" ? (
            <div style={{ flex: 1, marginLeft: bar * 0.4, height: bar * 0.6, borderRadius: bar * 0.3, background: dark ? "#2e2e38" : "#ebe6de", color: ink, fontFamily: font, fontSize: bar * 0.34, display: "flex", alignItems: "center", padding: `0 ${bar * 0.4}px` }}>{url ?? ""}</div>
          ) : (
            <div style={{ flex: 1, textAlign: "center", marginRight: bar * 1.2, color: ink, fontFamily: font, fontSize: bar * 0.38, fontWeight: 600 }}>{title ?? ""}</div>
          )}
        </div>
      ) : null}
      <div style={{ position: "absolute", left: inner.x, top: inner.y, width: inner.w, height: inner.h }}>
        <Screen w={c.w} h={c.h} box={{ x: 0, y: 0, w: inner.w, h: inner.h }} from={contentFrom} background={dark ? "#16161c" : "#fff"}>{children}</Screen>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- ноутбук (обобщённый)
// box — ширина/положение всего ноутбука; экран 16:10. glow — свет экрана на «столе» (тёмная сцена).
export const Laptop: React.FC<{ box: Box; content?: { w: number; h: number }; contentFrom?: number; tilt?: Tilt; glow?: number; children?: React.ReactNode }> = ({ box, content, contentFrom = 0, tilt, glow = 0, children }) => {
  const sw = box.w * 0.84, sh = sw / 1.6;
  const bez = sw * 0.028;
  const lidW = sw + bez * 2, lidH = sh + bez * 2.4;
  const lidX = box.x + (box.w - lidW) / 2, lidY = box.y;
  const baseH = box.w * 0.035;
  const c = content ?? { w: 1600, h: 1000 };
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", transform: tiltCss(tilt), transformOrigin: `${box.x + box.w / 2}px ${box.y + lidH}px` }}>
      {glow > 0 ? <div style={{ position: "absolute", left: box.x - box.w * 0.2, top: lidY + lidH - box.w * 0.05, width: box.w * 1.4, height: box.w * 0.5, borderRadius: "50%", background: `radial-gradient(closest-side, rgba(170,200,255,${0.35 * glow}), rgba(170,200,255,0))` }} /> : null}
      <div style={{ position: "absolute", left: lidX, top: lidY, width: lidW, height: lidH, borderRadius: bez * 1.6, background: "linear-gradient(180deg, #2b2c31, #1c1d21)", boxShadow: "0 30px 70px rgba(0,0,0,.35)" }} />
      <Screen w={c.w} h={c.h} box={{ x: lidX + bez, y: lidY + bez * 1.2, w: sw, h: sh }} from={contentFrom} radius={bez * 0.4}>{children}</Screen>
      {/* блик стекла */}
      <div style={{ position: "absolute", left: lidX + bez, top: lidY + bez * 1.2, width: sw, height: sh, background: "linear-gradient(115deg, rgba(255,255,255,.10) 0%, rgba(255,255,255,0) 38%)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", left: box.x, top: lidY + lidH, width: box.w, height: baseH, borderRadius: `0 0 ${baseH}px ${baseH}px`, background: "linear-gradient(180deg, #d9dade 0%, #b9bbc2 60%, #8f9198 100%)", boxShadow: "0 24px 40px rgba(0,0,0,.3)" }} />
      <div style={{ position: "absolute", left: box.x + box.w * 0.42, top: lidY + lidH, width: box.w * 0.16, height: baseH * 0.35, borderRadius: `0 0 ${baseH}px ${baseH}px`, background: "#a3a5ac" }} />
    </div>
  );
};

// ---------------------------------------------------------------- телефон (обобщённый)
export const Phone: React.FC<{ box: Box; content?: { w: number; h: number }; contentFrom?: number; tilt?: Tilt; color?: string; children?: React.ReactNode }> = ({ box, content, contentFrom = 0, tilt, color = "#1d1e22", children }) => {
  const R = box.w * 0.13, bez = box.w * 0.035;
  const c = content ?? { w: 1080, h: 1920 };
  return (
    <div style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, borderRadius: R, background: color, transform: tiltCss(tilt), boxShadow: "0 40px 90px rgba(30,20,10,.35), inset 0 0 0 2px rgba(255,255,255,.08)" }}>
      <Screen w={c.w} h={c.h} box={{ x: bez, y: bez, w: box.w - bez * 2, h: box.h - bez * 2 }} from={contentFrom} radius={R - bez}>{children}</Screen>
      <div style={{ position: "absolute", left: box.w / 2 - box.w * 0.14, top: bez * 2, width: box.w * 0.28, height: box.w * 0.075, borderRadius: box.w, background: "#0b0b0d" }} />
    </div>
  );
};

// ---------------------------------------------------------------- постоянный заголовок
// Неподвижная надпись над роликом (1–2 строки), как в «снято с экрана». Кегль — от ширины
// коробки и числа символов один раз, а не по кадрам (ширина не «дышит»).
export const Headline: React.FC<{ text: string; box: Box; font: string; weight?: number; color: string; maxLines?: 1 | 2; italic?: boolean; align?: "center" | "left"; accent?: { word: string; color: string; font?: string } }> = ({
  text, box, font, weight = 700, color, maxLines = 2, italic = false, align = "center", accent,
}) => {
  const chars = Math.max(8, Math.ceil(text.length / maxLines));
  const size = Math.min(box.h / (maxLines * 1.15), (box.w / chars) * 1.85);
  const parts = accent ? text.split(accent.word) : [text];
  return (
    <div style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, display: "flex", alignItems: "center", justifyContent: align === "center" ? "center" : "flex-start", textAlign: align }}>
      <div style={{ fontFamily: font, fontWeight: weight, fontStyle: italic ? "italic" : "normal", fontSize: size, lineHeight: 1.12, color, letterSpacing: "-0.01em" }}>
        {accent ? parts.map((p, i) => (
          <React.Fragment key={i}>{p}{i < parts.length - 1 ? <span style={{ color: accent.color, fontFamily: accent.font ?? font, fontStyle: accent.font ? "italic" : undefined }}>{accent.word}</span> : null}</React.Fragment>
        )) : text}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- прогресс
// Тонкая полоса прогресса (по умолчанию — доля ролика); value 0..1 — свой прогресс.
// color — из theme.palette (обязателен: лаймовое умолчание делало прогресс одинаковым во всех роликах).
export const ProgressBar: React.FC<{ box: Box; color: string; track?: string; value?: number }> = ({ box, color, track = "rgba(127,127,127,.22)", value }) => {
  const frame = useCurrentFrame();
  const { durationInFrames: D } = useVideoConfig();
  const v = Math.min(1, Math.max(0, value ?? frame / Math.max(1, D - 1)));
  return (
    <div style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, borderRadius: box.h, background: track, overflow: "hidden" }}>
      <div style={{ width: `${v * 100}%`, height: "100%", borderRadius: box.h, background: color }} />
    </div>
  );
};

// Сегменты шагов: done — сколько пройдено, current — доля текущего (0..1).
// color — из theme.palette (обязателен), track — нейтральный, если не задан.
export const StepDots: React.FC<{ x: number; y: number; count: number; done: number; current?: number; seg?: number; gap?: number; h?: number; color: string; track?: string }> = ({ x, y, count, done, current = 0, seg = 64, gap = 14, h = 8, color, track = "rgba(127,127,127,.22)" }) => (
  <div style={{ position: "absolute", left: x, top: y, display: "flex", gap }}>
    {Array.from({ length: count }, (_, i) => (
      <div key={i} style={{ width: seg, height: h, borderRadius: h, background: track, overflow: "hidden" }}>
        <div style={{ width: `${i < done ? 100 : i === done ? current * 100 : 0}%`, height: "100%", background: color }} />
      </div>
    ))}
  </div>
);

export const Vignette: React.FC<{ strength?: number; color?: string }> = ({ strength = 0.35, color = "0,0,0" }) => (
  <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 45%, rgba(${color},0) 55%, rgba(${color},${strength}) 100%)`, pointerEvents: "none" }} />
);
