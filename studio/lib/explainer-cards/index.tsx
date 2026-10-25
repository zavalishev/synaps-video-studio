// Скилл explainer-cards: карточки-объяснялки и макеты интерфейсов как функции кадра.
//   import { Card, WindowChrome, Terminal, Checklist, StepCard, FlowGraph, LoopDiagram,
//            StatPill, StickyNote, DocCard, cardTheme } from "@studio/explainer-cards";
// Вкуса здесь нет: цвета, шрифты, радиусы — из CardTheme (директор собирает её из theme.json);
// cardTheme(theme, шрифты) — CardTheme из theme.json. Тексты пишет директор под тему ролика.
// Страховка: наклон карточки > ±10° пишется в лог (card-tilt); моноширинный текст переносится
// только по пробелам (не посреди слова); появление — без перелёта.
import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { evolvePath, getLength, getPointAtLength } from "@remotion/paths";
import { EASE } from "../camera";
import { reportGuard } from "../layout";
import { Counter } from "../data-viz";
import { measureWidth, useFontReady } from "../layout-guard/text";
import { mixOk, shapeStyle, type Shapes } from "../art-direction/theme";

// ---------- линия «рисуется» ----------
// drawOn(g, d, stroke) — evolvePath + прозрачность 0, пока нарисованная длина < 2 толщин:
// круглый конец линии нулевой длины виден точкой/чёрточкой («красная точка над головой» до
// того, как стрелка начала рисоваться). Для своих стрелок: <path d={d} {...drawOn(g, d, 8)} />.
export const drawOn = (g: number, d: string, stroke: number): { strokeDasharray: string; strokeDashoffset: number; opacity: number } => {
  const ev = evolvePath(Math.min(1, Math.max(0, g)), d);
  const len = getLength(d) * Math.min(1, Math.max(0, g));
  return { strokeDasharray: ev.strokeDasharray, strokeDashoffset: ev.strokeDashoffset, opacity: len < 2 * stroke ? 0 : 1 };
};

// ---------- тема ----------
export type CardTheme = {
  bg: string;          // холст под карточками (для ореолов и «выреза»)
  surface: string;     // карточка
  surface2: string;    // тёмная поверхность (терминал, тёмная плитка)
  ink: string;         // текст на surface
  ink2: string;        // текст на surface2
  muted: string;       // второстепенный текст
  line: string;        // линии, рамки, пустые сегменты
  accent: string;      // главный акцент
  accentSoft: string;  // светлая пара акцента (градиент цифры)
  ok: string;          // «готово», «подключено»
  font: string;        // CSS font-family текста (кириллица)
  mono: string;        // моноширинный (кириллица: JetBrains Mono)
  serif?: string;      // курсивный акцент (Playfair Display Italic, Lora Italic…)
  hand?: string;       // рукописный (Caveat)
  radius?: number;     // радиус карточки, px (не задан — 0: форма — решение темы, theme.shapes)
  shadow?: string;     // CSS box-shadow карточки (не задан — без тени)
  border?: string;     // CSS border карточки (например «3px solid #1b1a17» — чернильная линия)
};

// Тема карточек — только из theme.json текущего ролика (palette + shapes): готовых палитр нет,
// иначе «тёплый минимализм с терракотой» и «ночь с мятой» становятся домом студии.
//   const t = cardTheme(theme, { font, mono, serif, hand });
export const cardTheme = (
  theme: { palette: { bg: string; ink: string; accent: string; surface?: string; muted?: string; accent2?: string; dark?: string; onDark?: string; [k: string]: string | undefined }; shapes?: Shapes },
  o: { font: string; mono: string; serif?: string; hand?: string; size?: number },
): CardTheme => {
  const P = theme?.palette;
  if (!P?.bg || !P?.ink || !P?.accent) throw new Error("cardTheme: нужна theme.palette с bg, ink, accent (theme.json ролика) — цвета карточек берутся только из арт-дирекции ролика");
  const sh = shapeStyle(theme.shapes, { size: o.size ?? 80, ink: P.ink });
  return {
    bg: P.bg, surface: P.surface ?? mixOk(P.bg, P.ink, 0.05), surface2: P.dark ?? P.ink, ink: P.ink, ink2: P.onDark ?? P.bg,
    muted: P.muted ?? mixOk(P.ink, P.bg, 0.45), line: mixOk(P.ink, P.bg, 0.82), accent: P.accent, accentSoft: mixOk(P.accent, P.bg, 0.55), ok: P.ok ?? P.accent2 ?? P.accent,
    font: o.font, mono: o.mono, ...(o.serif ? { serif: o.serif } : {}), ...(o.hand ? { hand: o.hand } : {}),
    radius: typeof sh.borderRadius === "number" ? sh.borderRadius : 0, ...(sh.boxShadow ? { shadow: String(sh.boxShadow) } : {}), ...(sh.border ? { border: String(sh.border) } : {}),
  };
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const prog = (f: number, start: number, dur: number, ease: (t: number) => number = EASE) =>
  interpolate(f, [start, start + Math.max(1, dur)], [0, 1], { easing: ease, extrapolateLeft: "clamp", extrapolateRight: "clamp" });

// Мягкий вход карточки: подъём + лёгкий масштаб + прозрачность, без перелёта.
export const cardIn = (f: number, at: number, o: { dur?: number; dy?: number; scaleFrom?: number; blur?: number } = {}): React.CSSProperties => {
  const p = prog(f, at, o.dur ?? 14);
  const blur = (o.blur ?? 0) * (1 - p);
  return { opacity: clamp01(p * 1.4), transform: `translateY(${(1 - p) * (o.dy ?? 28)}px) scale(${(o.scaleFrom ?? 0.96) + (1 - (o.scaleFrom ?? 0.96)) * p})`, ...(blur > 0.05 ? { filter: `blur(${blur}px)` } : {}) };
};

// ---------- карточка ----------
// Поверхность с радиусом и тенью; tilt — наклон в перспективе (не больше ±10°).
export const Card: React.FC<{
  w: number; h: number; theme: CardTheme; dark?: boolean; tilt?: { x?: number; y?: number }; padding?: number;
  radius?: number; style?: React.CSSProperties; children?: React.ReactNode; id?: string;
}> = ({ w, h, theme: t, dark, tilt, padding = 0, radius, style, children, id = "card" }) => {
  const f = useCurrentFrame();
  const tx = tilt?.x ?? 0, ty = tilt?.y ?? 0;
  if (f === 0 && (Math.abs(tx) > 10 || Math.abs(ty) > 10)) reportGuard({ id, kind: "card-tilt", frame: f, amount: Math.max(Math.abs(tx), Math.abs(ty)), detail: "наклон карточки больше ±10° читается как ошибка" });
  const tr = tx || ty ? `perspective(1200px) rotateX(${tx}deg) rotateY(${ty}deg)` : undefined;
  return (
    <div style={{
      width: w, height: h, borderRadius: radius ?? t.radius ?? 0, background: dark ? t.surface2 : t.surface, color: dark ? t.ink2 : t.ink,
      boxShadow: t.shadow, border: t.border, padding, boxSizing: "border-box", overflow: "hidden", position: "relative", transform: tr, transformStyle: "preserve-3d", ...style,
    }}>{children}</div>
  );
};

// Окно с полосой заголовка (три точки, заголовок по центру). Без логотипов и чужих брендов.
export const WindowChrome: React.FC<{
  w: number; h: number; theme: CardTheme; title?: string; dark?: boolean; tilt?: { x?: number; y?: number };
  barH?: number; style?: React.CSSProperties; children?: React.ReactNode; id?: string;
}> = ({ w, h, theme: t, title, dark, tilt, barH = 64, style, children, id }) => (
  <Card w={w} h={h} theme={t} dark={dark} tilt={tilt} style={style} id={id}>
    <div style={{ height: barH, display: "flex", alignItems: "center", padding: `0 ${barH * 0.4}px`, borderBottom: `1.5px solid ${dark ? "rgba(255,255,255,.08)" : t.line}`, position: "relative" }}>
      {["#ff5f57", "#febc2e", "#28c840"].map((c, i) => (
        <span key={i} style={{ width: barH * 0.26, height: barH * 0.26, borderRadius: "50%", background: c, marginRight: barH * 0.16, opacity: dark ? 0.9 : 1 }} />
      ))}
      {title ? <div style={{ position: "absolute", left: 0, right: 0, textAlign: "center", fontFamily: t.mono, fontSize: barH * 0.36, color: t.muted, letterSpacing: 0.5 }}>{title}</div> : null}
    </div>
    <div style={{ position: "relative", height: h - barH }}>{children}</div>
  </Card>
);

// ---------- терминал ----------
export type TermLine = { text: string; kind?: "cmd" | "out" | "ok" | "err" | "note"; at?: number; prompt?: string };
export type TermSchedule = Array<{ start: number; end: number; line: TermLine }>;

// Расписание набора: команда печатается cps символов в секунду, вывод появляется сразу после
// команды через gap кадров. Явный at у строки переопределяет время.
export const termSchedule = (lines: TermLine[], fps: number, o: { start?: number; cps?: number; gap?: number } = {}): TermSchedule => {
  const cps = o.cps ?? 26, gap = o.gap ?? 8;
  let t = o.start ?? 0;
  return lines.map((line) => {
    const start = line.at ?? t;
    const typed = (line.kind ?? "cmd") === "cmd";
    const end = typed ? start + Math.ceil((line.text.length / cps) * fps) : start;
    t = end + gap;
    return { start, end, line };
  });
};

export const Terminal: React.FC<{
  lines: TermLine[]; theme: CardTheme; px?: number; start?: number; cps?: number; gap?: number; prompt?: string;
  cursor?: boolean; padding?: number; lineGap?: number; style?: React.CSSProperties;
}> = ({ lines, theme: t, px = 34, start = 0, cps, gap, prompt = "$", cursor = true, padding = 36, lineGap = 0.55, style }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sch = termSchedule(lines, fps, { start, cps, gap });
  const color = { cmd: t.ink2, out: t.muted, ok: t.ok, err: "#ff6b6b", note: t.accentSoft } as const;
  const active = [...sch].reverse().find((s) => f >= s.start);
  const typing = active && f < active.end;
  // Курсор: горит, пока печатает; в паузе мигает раз в секунду (от кадра).
  const cursorOn = cursor && (typing || Math.floor(f / (fps / 2)) % 2 === 0);
  return (
    <div style={{ padding, fontFamily: t.mono, fontSize: px, lineHeight: 1.35, whiteSpace: "pre-wrap", wordBreak: "normal", overflowWrap: "normal", ...style }}>
      {sch.map((s, i) => {
        if (f < s.start) return null;
        const kind = s.line.kind ?? "cmd";
        const n = kind === "cmd" ? Math.floor(interpolate(f, [s.start, Math.max(s.start + 1, s.end)], [0, s.line.text.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })) : s.line.text.length;
        const fade = kind === "cmd" ? 1 : prog(f, s.start, 6);
        const isActive = active === s;
        return (
          <div key={i} style={{ color: color[kind], opacity: fade, marginBottom: px * lineGap }}>
            {kind === "cmd" ? <span style={{ color: t.accent }}>{(s.line.prompt ?? prompt) + " "}</span> : null}
            {kind === "ok" ? <span>✓ </span> : null}
            {s.line.text.slice(0, n)}
            {isActive && cursorOn ? <span style={{ display: "inline-block", width: px * 0.58, height: px * 1.05, background: t.accent, verticalAlign: "text-bottom", marginLeft: 2 }} /> : null}
          </div>
        );
      })}
    </div>
  );
};

// ---------- чек-лист ----------
export type CheckItem = { text: string; at: number; enterAt?: number };

// Пункты входят по очереди (enterAt, по умолчанию start + i·stagger), отмечаются в at:
// галочка рисуется, текст гаснет и (strike) зачёркивается. counter — подпись «готово k/n».
export const Checklist: React.FC<{
  items: CheckItem[]; theme: CardTheme; px?: number; start?: number; stagger?: number; strike?: boolean;
  counter?: (done: number, total: number) => string; gap?: number; style?: React.CSSProperties;
}> = ({ items, theme: t, px = 44, start = 0, stagger = 5, strike = true, counter, gap = 0.62, style }) => {
  const f = useCurrentFrame();
  const done = items.filter((it) => f >= it.at + 6).length;
  const box = px * 1.1;
  return (
    <div style={{ fontFamily: t.font, fontSize: px, color: t.ink, ...style }}>
      {counter ? (
        <div style={{ fontFamily: t.mono, fontSize: px * 0.62, letterSpacing: px * 0.08, color: t.muted, marginBottom: px * 0.7, fontVariantNumeric: "tabular-nums" }}>
          {counter(done, items.length)}
        </div>
      ) : null}
      {items.map((it, i) => {
        const enter = prog(f, it.enterAt ?? start + i * stagger, 12);
        const check = prog(f, it.at, 10);
        const fill = prog(f, it.at, 6);
        const d = `M${box * 0.24},${box * 0.52} L${box * 0.43},${box * 0.7} L${box * 0.78},${box * 0.3}`;
        const ev = drawOn(check, d, box * 0.12);
        const sw = prog(f, it.at + 4, 10);
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: px * 0.45, marginBottom: px * gap, opacity: enter, transform: `translateY(${(1 - enter) * 16}px)` }}>
            <svg width={box} height={box} style={{ flex: "none" }}>
              <rect x={2} y={2} width={box - 4} height={box - 4} rx={box * 0.28} fill={fill > 0 ? t.accent : "none"} fillOpacity={fill} stroke={fill > 0.5 ? t.accent : t.line} strokeWidth={3} />
              {check > 0 ? <path d={d} fill="none" stroke={t.surface} strokeWidth={box * 0.12} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={ev.strokeDasharray} strokeDashoffset={ev.strokeDashoffset} opacity={ev.opacity} /> : null}
            </svg>
            <span style={{ position: "relative", color: interpolate(sw, [0, 1], [0, 1]) > 0.5 && strike ? t.muted : t.ink, lineHeight: 1.2 }}>
              {it.text}
              {strike && sw > 0 ? <span style={{ position: "absolute", left: 0, top: "54%", height: Math.max(3, px * 0.07), width: `${sw * 100}%`, background: t.muted, borderRadius: 2 }} /> : null}
            </span>
          </div>
        );
      })}
    </div>
  );
};

// ---------- карточка шага ----------
// Огромная градиентная цифра, над ней курсивное слово (label), ниже сегментный прогресс и
// моно-подпись. Вход: размытие → резкость за ~10 кадров (не «вжух»), сегмент заливается.
export const StepCard: React.FC<{
  n: number; total: number; theme: CardTheme; label?: string; caption?: string; numPx?: number; start?: number;
  width?: number; weight?: number; numFont?: string; style?: React.CSSProperties;
}> = ({ n, total, theme: t, label, caption, numPx = 520, start = 0, width = 760, weight = 800, numFont, style }) => {
  const f = useCurrentFrame();
  const p = prog(f, start, 11);
  const seg = prog(f, start + 4, 12);
  const segW = Math.min(90, (width - (total - 1) * 16) / total);
  return (
    <div style={{ width, display: "flex", flexDirection: "column", alignItems: "center", ...style }}>
      <div style={{ position: "relative", height: numPx * 0.86, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
        <div style={{
          fontFamily: numFont ?? t.font, fontWeight: weight, fontSize: numPx, lineHeight: 0.8, letterSpacing: -numPx * 0.04,
          background: `linear-gradient(180deg, ${t.accentSoft} 0%, ${t.accent} 85%)`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
          opacity: p, filter: p < 0.99 ? `blur(${(1 - p) * 16}px)` : undefined, transform: `scale(${1.05 - 0.05 * p})`, fontVariantNumeric: "tabular-nums",
        }}>{n}</div>
        {label ? (
          <div style={{ position: "absolute", top: -numPx * 0.08, left: "50%", transform: "translateX(-60%)", fontFamily: t.serif ?? t.font, fontStyle: "italic", fontSize: numPx * 0.22, color: t.ink, whiteSpace: "nowrap" }}>{label}</div>
        ) : null}
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: numPx * 0.12 }}>
        {Array.from({ length: total }, (_, i) => (
          <div key={i} style={{ width: segW, height: 10, borderRadius: 5, background: i < n - 1 ? t.ink : t.line, overflow: "hidden" }}>
            {i === n - 1 ? <div style={{ width: `${seg * 100}%`, height: "100%", background: t.accent }} /> : null}
          </div>
        ))}
      </div>
      {caption ? <div style={{ marginTop: 26, fontFamily: t.mono, fontSize: 26, letterSpacing: 7, color: t.muted }}>{caption}</div> : null}
    </div>
  );
};

// ---------- схема из плиток ----------
export type FlowNode = { id: string; x: number; y: number; w?: number; h?: number; title: string; sub?: string; icon?: React.ReactNode; tone?: "surface" | "accent" | "dark"; at: number; status?: { text: string; at: number } };
export type FlowEdge = { from: string; to: string; at: number; dur?: number; label?: string; bend?: number; dashed?: boolean; pulse?: boolean };

const anchor = (a: FlowNode, b: FlowNode, defW: number, defH: number) => {
  const aw = a.w ?? defW, ah = a.h ?? defH, bw = b.w ?? defW, bh = b.h ?? defH;
  const dx = b.x - a.x, dy = b.y - a.y;
  if (Math.abs(dy) * 1.2 >= Math.abs(dx)) {
    const s = Math.sign(dy) || 1;
    return { p: { x: a.x, y: a.y + (s * ah) / 2 }, q: { x: b.x, y: b.y - (s * bh) / 2 }, vertical: true };
  }
  const s = Math.sign(dx) || 1;
  return { p: { x: a.x + (s * aw) / 2, y: a.y }, q: { x: b.x - (s * bw) / 2, y: b.y }, vertical: false };
};

// Плитки (центр x, y в px области) и связи-кривые, которые рисуются за dur кадров.
// pulse — точка бежит по готовой связи (период 1.5 с) — «данные идут».
export const FlowGraph: React.FC<{
  nodes: FlowNode[]; edges: FlowEdge[]; width: number; height: number; theme: CardTheme;
  nodeW?: number; nodeH?: number; px?: number; stroke?: number;
}> = ({ nodes, edges, width, height, theme: t, nodeW = 300, nodeH = 150, px = 36, stroke = 5 }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (
    <div style={{ position: "relative", width, height }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        {edges.map((e, i) => {
          const a = byId.get(e.from), b = byId.get(e.to);
          if (!a || !b) return null;
          const { p, q, vertical } = anchor(a, b, nodeW, nodeH);
          const k = e.bend ?? 0.5;
          const d = vertical
            ? `M${p.x},${p.y} C${p.x},${p.y + (q.y - p.y) * k} ${q.x},${q.y - (q.y - p.y) * k} ${q.x},${q.y}`
            : `M${p.x},${p.y} C${p.x + (q.x - p.x) * k},${p.y} ${q.x - (q.x - p.x) * k},${q.y} ${q.x},${q.y}`;
          const g = prog(f, e.at, e.dur ?? 18);
          if (g <= 0) return null;
          const ev = drawOn(g, d, stroke);
          const len = getLength(d);
          const tip = getPointAtLength(d, len * g) ?? { x: 0, y: 0 };
          const back = getPointAtLength(d, Math.max(0, len * g - 2)) ?? tip;
          const ang = (Math.atan2(tip.y - back.y, tip.x - back.x) * 180) / Math.PI;
          const period = Math.round(fps * 1.5);
          const pulseT = e.pulse && g >= 1 ? ((f - e.at - (e.dur ?? 18)) % period) / period : -1;
          const pp = pulseT >= 0 ? getPointAtLength(d, len * pulseT) : null;
          const mid = getPointAtLength(d, len * 0.5) ?? { x: 0, y: 0 };
          return (
            <g key={i}>
              <path d={d} fill="none" stroke={t.accent} strokeWidth={stroke} strokeLinecap="round"
                strokeDasharray={e.dashed ? undefined : ev.strokeDasharray} strokeDashoffset={e.dashed ? undefined : ev.strokeDashoffset}
                style={e.dashed ? { strokeDasharray: `2 ${stroke * 3}` } : undefined} opacity={e.dashed ? g : ev.opacity} />
              <g transform={`translate(${tip.x},${tip.y}) rotate(${ang})`} opacity={ev.opacity * clamp01(g * 3)}>
                <path d={`M${-stroke * 3.2},${-stroke * 2.2} L0,0 L${-stroke * 3.2},${stroke * 2.2}`} fill="none" stroke={t.accent} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
              </g>
              {pp ? <circle cx={pp.x} cy={pp.y} r={stroke * 1.6} fill={t.accent} /> : null}
              {e.label ? (
                <text x={mid.x} y={mid.y - stroke * 3} textAnchor="middle" fontFamily={t.mono} fontSize={px * 0.62} fill={t.muted} opacity={prog(f, e.at + (e.dur ?? 18) - 4, 8)}
                  stroke={t.bg} strokeWidth={px * 0.25} paintOrder="stroke" strokeLinejoin="round">{e.label}</text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {nodes.map((n) => {
        const w = n.w ?? nodeW, h = n.h ?? nodeH;
        const tone = n.tone ?? "surface";
        const bg = tone === "accent" ? t.accent : tone === "dark" ? t.surface2 : t.surface;
        const fg = tone === "surface" ? t.ink : tone === "dark" ? t.ink2 : "#ffffff";
        const st = n.status ? prog(f, n.status.at, 10) : 0;
        return (
          <div key={n.id} style={{ position: "absolute", left: n.x - w / 2, top: n.y - h / 2, width: w, height: h, ...cardIn(f, n.at, { dy: 18 }) }}>
            <div style={{ width: "100%", height: "100%", borderRadius: Math.min(36, h * 0.24), background: bg, boxShadow: t.shadow, display: "flex", alignItems: "center", gap: px * 0.5, padding: `0 ${px * 0.7}px`, boxSizing: "border-box", color: fg }}>
              {n.icon ? <div style={{ flex: "none", display: "flex" }}>{n.icon}</div> : null}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: t.font, fontWeight: 800, fontSize: px, lineHeight: 1.1 }}>{n.title}</div>
                {n.sub ? <div style={{ fontFamily: t.mono, fontSize: px * 0.62, letterSpacing: 2, opacity: 0.75, marginTop: 6, textTransform: "uppercase" }}>{n.sub}</div> : null}
              </div>
            </div>
            {n.status ? (
              <div style={{ position: "absolute", left: 0, right: 0, top: h + 14, textAlign: "center", fontFamily: t.mono, fontSize: px * 0.62, color: t.ok, opacity: st, letterSpacing: 1 }}>● {n.status.text}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

// ---------- цикл ----------
// Пунктирный круг, фишки по кругу (с 12 часов по часовой), точка-бегунок обходит цикл
// за period кадров (по умолчанию 4 с — спокойно). center — что в середине.
export const LoopDiagram: React.FC<{
  items: string[]; size: number; theme: CardTheme; start?: number; stagger?: number; px?: number; period?: number;
  center?: React.ReactNode; runner?: boolean; active?: number;
}> = ({ items, size, theme: t, start = 0, stagger = 8, px = 36, period, center, runner = true, active }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const R = size * 0.38, c = size / 2;
  const ring = prog(f, start, 24);
  const per = period ?? fps * 4;
  const runAt = start + 24 + items.length * stagger;
  const ang = f >= runAt ? (((f - runAt) % per) / per) * 360 - 90 : -90;
  const circ = 2 * Math.PI * R;
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ position: "absolute", inset: 0 }}>
        <circle cx={c} cy={c} r={R} fill="none" stroke={t.muted} strokeWidth={5} strokeDasharray="2 18" strokeLinecap="round" opacity={0.6 * ring} />
        <circle cx={c} cy={c} r={R} fill="none" stroke={t.accent} strokeWidth={5} strokeDasharray={`${circ * ring} ${circ}`} transform={`rotate(-90 ${c} ${c})`} opacity={0.22} />
        {runner && f >= runAt ? (
          <circle cx={c + R * Math.cos((ang * Math.PI) / 180)} cy={c + R * Math.sin((ang * Math.PI) / 180)} r={px * 0.42} fill={t.accent} opacity={prog(f, runAt, 10)} />
        ) : null}
      </svg>
      {center ? <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center" }}>{center}</div> : null}
      {items.map((txt, i) => {
        const a = (-90 + (360 * i) / items.length) * (Math.PI / 180);
        const x = c + R * Math.cos(a), y = c + R * Math.sin(a);
        const on = active === undefined ? true : active === i;
        return (
          <div key={i} style={{ position: "absolute", left: x, top: y, transform: "translate(-50%, -50%)" }}>
            <div style={{ ...cardIn(f, start + 10 + i * stagger, { dy: 10, scaleFrom: 0.85 }) }}>
              <div style={{ padding: `${px * 0.38}px ${px * 0.7}px`, borderRadius: 999, background: on ? t.surface : t.bg, boxShadow: on ? t.shadow : undefined, border: on ? "none" : `2px solid ${t.line}`, fontFamily: t.font, fontWeight: 700, fontSize: px, color: on ? t.ink : t.muted, whiteSpace: "nowrap" }}>
                <span style={{ fontFamily: t.mono, fontSize: px * 0.6, color: t.accent, marginRight: px * 0.3 }}>{String(i + 1).padStart(2, "0")}</span>{txt}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ---------- плашка-счётчик ----------
export const StatPill: React.FC<{
  label: string; value: number; theme: CardTheme; from?: number; start?: number; dur?: number; decimals?: number; prefix?: string; suffix?: string;
  px?: number; icon?: React.ReactNode; dark?: boolean; style?: React.CSSProperties;
}> = ({ label, value, theme: t, from = 0, start = 0, dur = 30, decimals, prefix, suffix, px = 40, icon, dark, style }) => {
  const f = useCurrentFrame();
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: px * 0.5, padding: `${px * 0.45}px ${px * 0.8}px`, borderRadius: 999, background: dark ? t.surface2 : t.surface, boxShadow: t.shadow, ...cardIn(f, start, { dy: 12 }), ...style }}>
      {icon}
      <span style={{ fontFamily: t.font, fontSize: px * 0.8, color: t.muted }}>{label}</span>
      <Counter value={value} from={from} start={start + 4} dur={dur} decimals={decimals} prefix={prefix} suffix={suffix}
        style={{ fontFamily: t.font, fontWeight: 800, fontSize: px, color: dark ? t.ink2 : t.ink }} />
    </div>
  );
};

// ---------- стикер ----------
// Квадратный листок с загнутым углом; текст «пишется» по буквам (speed — букв в секунду).
export const StickyNote: React.FC<{
  text: string; theme: CardTheme; color?: string; size?: number; rotate?: number; start?: number; speed?: number; px?: number; font?: string;
}> = ({ text, theme: t, color = "#ffe27a", size = 420, rotate = -3, start = 0, speed = 22, px, font }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const n = Math.floor(interpolate(f, [start + 8, start + 8 + (text.length / speed) * fps], [0, text.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const fold = size * 0.14;
  return (
    <div style={{ width: size, height: size, transform: `rotate(${rotate}deg)`, ...cardIn(f, start, { dy: 20 }) }}>
      <div style={{ position: "relative", width: "100%", height: "100%", background: color, clipPath: `polygon(0 0, 100% 0, 100% calc(100% - ${fold}px), calc(100% - ${fold}px) 100%, 0 100%)`, filter: "drop-shadow(0 18px 24px rgba(0,0,0,.18))", padding: size * 0.1, boxSizing: "border-box", fontFamily: font ?? t.hand ?? t.font, fontSize: px ?? size * 0.13, lineHeight: 1.15, color: "#2a261d" }}>
        <span>{text.slice(0, n)}</span>
        <span style={{ visibility: "hidden" }}>{text.slice(n)}</span>
        <div style={{ position: "absolute", right: 0, bottom: 0, width: fold, height: fold, background: "linear-gradient(135deg, rgba(0,0,0,.18) 0%, rgba(0,0,0,.05) 50%, transparent 50%)" }} />
      </div>
    </div>
  );
};

// ---------- документ ----------
// Карточка-документ: строки текста (настоящие) и маркер, который проводится по строке
// highlight.index в кадр highlight.at. Наезд камеры на строку — CameraView из @studio.
export const DocCard: React.FC<{
  w: number; h: number; theme: CardTheme; title?: string; lines: string[]; px?: number; highlight?: { index: number; at: number; color?: string };
  start?: number; stagger?: number;
}> = ({ w, h, theme: t, title, lines, px = 34, highlight, start = 0, stagger = 2 }) => {
  const f = useCurrentFrame();
  const hl = highlight ? prog(f, highlight.at, 14) : 0;
  return (
    <Card w={w} h={h} theme={t} padding={px * 1.6}>
      {title ? <div style={{ fontFamily: t.font, fontWeight: 800, fontSize: px * 1.5, color: t.ink, marginBottom: px * 0.9, lineHeight: 1.1 }}>{title}</div> : null}
      {lines.map((ln, i) => {
        const on = prog(f, start + i * stagger, 10);
        const isHl = highlight?.index === i;
        return (
          <div key={i} style={{ position: "relative", fontFamily: t.font, fontSize: px, lineHeight: 1.5, color: isHl && hl > 0.5 ? t.ink : t.muted, opacity: on, marginBottom: px * 0.25 }}>
            {isHl ? <span style={{ position: "absolute", left: -px * 0.2, top: "12%", height: "76%", width: `calc(${hl * 100}% + ${px * 0.4 * hl}px)`, background: highlight?.color ?? t.accentSoft, opacity: 0.55, borderRadius: px * 0.15 }} /> : null}
            <span style={{ position: "relative" }}>{ln}</span>
          </div>
        );
      })}
    </Card>
  );
};

// ---------- выноска: линия от точки предмета к подписи ----------
// calloutEnd — где линия выноски касается подписи: ближайшая точка края коробки подписи
// (с зазором gap), а не её центр — линия не перечёркивает слово («ПЛАТА» сквозь букву).
export const calloutEnd = (anchor: { x: number; y: number }, box: { x: number; y: number; w: number; h: number }, gap = 7): { x: number; y: number } => {
  const cx = Math.min(Math.max(anchor.x, box.x), box.x + box.w), cy = Math.min(Math.max(anchor.y, box.y), box.y + box.h);
  const inside = anchor.x >= box.x && anchor.x <= box.x + box.w && anchor.y >= box.y && anchor.y <= box.y + box.h;
  if (inside) return { x: anchor.x, y: anchor.y };
  const dx = anchor.x - cx, dy = anchor.y - cy, d = Math.hypot(dx, dy) || 1;
  return { x: cx + (dx / d) * gap, y: cy + (dy / d) * gap };
};

// <Callout> — готовая выноска (вариант, не обязанность): точка на предмете, линия рисуется к
// ближайшему краю подписи, подпись не мельче 3.2 % высоты, на пёстром фоне — тонкий скрим.
// at — центр подписи (px кадра); anchor — точка на предмете (для 3D — спроецированная).
export const Callout: React.FC<{
  anchor: { x: number; y: number }; at: { x: number; y: number }; label: string; start: number; dur?: number;
  font: { family: string; weight?: string | number }; size?: number; color: string; line?: string; scrim?: string; gap?: number; stroke?: number; id?: string;
}> = ({ anchor, at, label, start, dur = 12, font, size, color, line, scrim, gap = 7, stroke = 4, id = "callout" }) => {
  const f = useCurrentFrame();
  const { height: H } = useVideoConfig();
  const ready = useFontReady(font);
  const px = Math.max(size ?? 0, Math.round(H * 0.032));
  if (!ready) return null;
  // Ширина подписи — замер шрифта (canvas), поля скрима — вокруг.
  const padX = scrim ? px * 0.35 : 0, padY = scrim ? px * 0.18 : 0;
  const w = measureWidth(label, font, px) + padX * 2, h = px * 1.15 + padY * 2;
  const box = { x: at.x - w / 2, y: at.y - h / 2, w, h };
  const end = calloutEnd(anchor, box, gap);
  const d = `M ${anchor.x} ${anchor.y} L ${end.x} ${end.y}`;
  const g = interpolate(f, [start, start + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
  const lo = interpolate(f, [start + dur * 0.6, start + dur * 0.6 + 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const lc = line ?? color;
  return (
    <>
      <svg data-id={`${id}-line`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}>
        <circle cx={anchor.x} cy={anchor.y} r={stroke * 1.6} fill={lc} opacity={g > 0 ? 1 : 0} />
        <path d={d} stroke={lc} strokeWidth={stroke} strokeLinecap="round" fill="none" {...drawOn(g, d, stroke)} />
      </svg>
      <div data-id={id} data-role="support" style={{ position: "absolute", left: box.x, top: box.y, minWidth: w, height: h, display: "flex", alignItems: "center", justifyContent: "center", opacity: lo, fontFamily: font.family, fontWeight: font.weight ?? 700, fontSize: px, lineHeight: 1.15, color, whiteSpace: "nowrap", padding: `${padY}px ${padX}px`, background: scrim, borderRadius: scrim ? px * 0.2 : 0, boxSizing: "border-box" }}>
        {label}
      </div>
    </>
  );
};
