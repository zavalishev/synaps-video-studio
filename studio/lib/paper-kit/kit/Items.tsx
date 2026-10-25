// Детали бумажного набора. Каждая рисуется вокруг своей точки (0,0) по раскладке из kit/geometry.ts —
// той же, по которой план меряет рамку (itemBox), поэтому страховка проверяет нарисованное.
//
// Всё, что видно, — из плана: поля детали (data, времена уже в кадрах), палитра и регистр
// серии (KitStyleProvider), вход и уход (ResolvedMotion). Своих чисел вкуса у кита нет:
//   не написано roll / draw / grow — число, график, столбики сразу в готовом виде;
//   не написан trend — без стрелки; не написан цвет — роль палитры (ценник — бумага,
//     штамп и график — accent, тренд — positive/negative), текст на заливке — чернила или
//     бумага, что контрастнее (fgOn);
//   регистр — style.case (нет = как написано), поворот — element.rotate (нет = 0);
//   ни одной надписи от движка (шапку чека, подпись лодки и т.п. пишет модель, если хочет).
// Ступенчатый вход (Motion.stagger): единицы детали — буквы заголовка, строки формулы и
// карточки, столбики сравнения, значки предмета — входят по очереди тем же движением; деталь
// без единиц входит целиком (единица 0). Поза всей детали в этом случае движение не
// применяет (timeline/sample.ts pose), чтобы оно не сложилось дважды.
import React from "react";
import { SvgImage } from "./SvgImage";
import { evolvePath } from "@remotion/paths";
import {
  CALENDAR, CARD, CHART, COMPARE, COUNTER, CUTOUT, FONT, FORMULA, PROP, STAMP, TAG, TITLE,
  calendarGeom, cardGeom, chartGeom, compareGeom, counterGeom, fitImage, fitSize, formulaGeom, measured,
  ransomGeom, stampGeom, tagGeom, textWidth, W,
} from "./geometry";
import { DISPLAY, HEAVY, MONO } from "./fonts";
import { circleTorn, Pin, rand, receiptRect, Sheet, tornRect } from "./paper";
import { fgOn, mix } from "./color";
import { stageBg, useCased, useKitStyle } from "./style";
import { easeAt, motionAt } from "../timeline/sample";
import type * as T from "../timeline/types";

// Рамка детали — по тем же функциям, что рисуют детали ниже (kit/geometry.ts).
export { itemBox, PROP_BOX, propBox } from "./geometry";

// ---------- ОБЩЕЕ ----------
type Data = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
type Sub = { frame: number; durF: number; ease: T.Ease } | null;
// Ход подвижной части (прокрутка, рисование, рост): нет поля — готово (1); до начала — 0.
const progress = (s: Sub, f: number, fps: number): number => {
  if (!s) return 1;
  if (f < s.frame) return 0;
  return s.durF > 0 ? easeAt(s.ease, (f - s.frame) / s.durF, s.durF / fps) : 1;
};

// Что рисует деталь в кадре f.
export type ItemArtProps = {
  el: T.PlanElement; f: number; fps: number; seed: number;
  img: (key: string | undefined) => string | null;   // адрес картинки или null (заглушка)
  settled?: boolean;                                  // без ступенчатого входа (деталь в полёте give/rain)
};

// Единица ступенчатого входа/ухода: n-я единица начинает то же движение на n·stagger позже,
// до своего начала не видна. (cx, cy) — центр единицы (вокруг него масштаб и поворот).
const Unit: React.FC<{ p: ItemArtProps; n: number; cx?: number; cy?: number; children: React.ReactNode }> = ({ p, n, cx = 0, cy = 0, children }) => {
  if (p.settled) return <>{children}</>;
  const { el, f, fps } = p;
  let dx = 0, dy = 0, s = 1, rot = 0, op = 1;
  const add = (m: T.ResolvedMotion, phase: "enter" | "exit") => {
    const o = motionAt({ ...m, frame: m.frame + n * m.staggerF }, f, fps, phase);
    if (o.k !== null) { dx += o.dx; dy += o.dy; s *= o.scale; rot += o.rotate; op *= o.opacity; }
    if (o.fade !== null) op *= o.fade;
  };
  const en = el.enter && el.enter.staggerF > 0 ? el.enter : undefined;
  const ex = el.exit && el.exit.staggerF > 0 ? el.exit : undefined;
  if (en) {
    if (f < en.frame + n * en.staggerF) return null;
    add(en, "enter");
  }
  if (ex && el.outF !== null && f >= el.outF) add(ex, "exit");
  if (!en && !ex) return <>{children}</>;
  return (
    <g opacity={op} transform={`translate(${dx + cx},${dy + cy}) rotate(${rot}) scale(${s}) translate(${-cx},${-cy})`}>
      {children}
    </g>
  );
};

// Ценник: лист цвета color (нет — бумага палитры), текст — контрастный.
export const TagArt: React.FC<{ text: string; color?: string; size?: number; seed: number }> = ({ text, color, size: want = TAG.size }) => {
  const { palette: pal } = useKitStyle();
  const { size, w, h } = tagGeom(measured(text, FONT.display, TAG.letterSpacing), want);
  const fill = color ?? pal.paper;
  return (
    <g transform={`translate(${-w / 2},${-h / 2})`}>
      <Sheet w={w} h={h} fill={fill}>
        <text x={w / 2} y={h / 2 + size * 0.36} textAnchor="middle" fontFamily={DISPLAY} fontWeight={600} fontSize={size}
          fill={fgOn(fill, pal)} letterSpacing={TAG.letterSpacing}>{text}</text>
      </Sheet>
    </g>
  );
};

// ---------- ТАБЛО ----------
const Counter: React.FC<{ p: ItemArtProps; d: Data }> = ({ p, d }) => {
  const { palette: pal } = useKitStyle();
  const cased = useCased();
  const value = d.value as number;
  const from = (d.from as number | null | undefined) ?? null;
  const roll = d.roll as Sub;
  const fmt = (n: number) => `${d.prefix ?? ""}${n.toLocaleString("ru-RU")}${d.unit ?? ""}`;
  // Прокрутка только если написаны и from, и roll; иначе — сразу итоговое число.
  const q = from !== null && roll ? progress(roll, p.f, p.fps) : 1;
  const v = from !== null && roll ? Math.round(from + (value - from) * q) : value;
  const delta = from === null ? 0 : value - from;
  const trend = d.trend as "good" | "bad" | "none";
  const showTrend = trend !== "none" && delta !== 0;
  const { w } = counterGeom(textWidth(fmt(value), FONT.mono, COUNTER.digits), !!d.label, showTrend);
  const look = d.look as "led" | "paper" | "plain";
  const H2 = COUNTER.screenH / 2;
  const digits = look === "led" ? pal.accent : look === "paper" ? fgOn(pal.paper, pal) : fgOn(stageBg(pal), pal);
  // Стрелка тренда — когда число докрутилось (событие самой прокрутки, без своей задержки).
  const arrowOn = showTrend && (!roll || from === null || p.f >= roll.frame + roll.durF);
  const label = d.label ? cased(d.label as string) : undefined;
  const lw = w - 20;
  const ls = label ? fitSize(measured(label, FONT.mono), 24, lw - 20) : 0;
  return (
    <g>
      {label && (
        <g transform={`translate(${-lw / 2},${COUNTER.label.y})`}>
          {look === "plain" ? null : <Sheet w={lw} h={COUNTER.label.h} fill={pal.paper} />}
          <text x={lw / 2} y={COUNTER.label.h / 2 + ls * 0.36} textAnchor="middle" fontFamily={MONO} fontWeight={700} fontSize={ls}
            fill={fgOn(look === "plain" ? stageBg(pal) : pal.paper, pal)}>{label}</text>
        </g>
      )}
      <g filter="url(#shadow)">
        {look === "led" && <rect x={-w / 2} y={-H2} width={w} height={COUNTER.screenH} rx={8} fill={pal.ink} />}
        {look === "led" && <rect x={-w / 2 + 10} y={-H2 + 10} width={w - 20} height={COUNTER.screenH - 20} rx={4} fill={mix(pal.ink, pal.accent, 0.12)} />}
        {look === "paper" && <g transform={`translate(${-w / 2},${-H2})`}><Sheet w={w} h={COUNTER.screenH} fill={pal.paper} /></g>}
        <text x={0} y={COUNTER.digits * 0.36} textAnchor="middle" fontFamily={MONO} fontWeight={700} fontSize={COUNTER.digits} fill={digits}>{fmt(v)}</text>
      </g>
      {arrowOn && (
        <g transform={`translate(${w / 2 + COUNTER.arrow.dx},-10)`}>
          <path d={delta > 0 ? "M0,24 L18,-6 L36,24 Z" : "M0,-6 L18,24 L36,-6 Z"}
            fill={trend === "good" ? pal.positive ?? pal.accent : pal.negative ?? pal.accent} />
        </g>
      )}
    </g>
  );
};

// ---------- ШТАМП ----------
const Stamp: React.FC<{ d: Data }> = ({ d }) => {
  const { palette: pal } = useKitStyle();
  const cased = useCased();
  const text = cased(d.text as string);
  const { size, w, h } = stampGeom(measured(text, FONT.displayBold, STAMP.letterSpacing), (d.size as number | undefined) ?? STAMP.size, W);
  const c = (d.color as string | undefined) ?? pal.accent;
  return (
    <g>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} fill="none" stroke={c} strokeWidth={8} />
      <rect x={-w / 2 + 12} y={-h / 2 + 12} width={w - 24} height={h - 24} fill="none" stroke={c} strokeWidth={3} />
      <text x={0} y={size * 0.36} textAnchor="middle" fontFamily={DISPLAY} fontWeight={700} fontSize={size} fill={c} letterSpacing={STAMP.letterSpacing}>{text}</text>
    </g>
  );
};

// ---------- ЗАГОЛОВОК ----------
// clean — строки шрифтом Oswald; ransom — буквы на вырезанных листках цветов палитры
// (вид «ransom» — словарь формы: листок, наклон и шрифт каждой буквы — из сида серии).
const Title: React.FC<{ p: ItemArtProps; d: Data }> = ({ p, d }) => {
  const { palette: pal } = useKitStyle();
  const cased = useCased();
  const lines = ((d.lines as string[]) ?? []).map(cased);
  const want = (d.size as number | undefined) ?? TITLE.maxSize;
  let unit = 0;
  let body: React.ReactNode;
  let bottom: number;
  if (d.look === "ransom") {
    const g = ransomGeom(lines.join(" "));
    const k = d.size === undefined ? 1 : want / g.size;
    const size = g.size;
    const sheets = [pal.paper, pal.accent, pal.ink, pal.highlight, pal.positive, pal.negative, pal.bg].filter((c): c is string => !!c);
    body = (
      <g transform={`scale(${k}) translate(0,${-g.totalH / 2})`}>
        {g.lines.map((line, li) => (
          <g key={li} transform={`translate(${(-line.length * size) / 2},${li * size * TITLE.lineK})`}>
            {[...line].map((ch, ci) => {
              if (ch === " ") return null;
              const n = unit++;
              const s = p.seed + n * 13;
              const bg = sheets[Math.floor(rand(s) * sheets.length)];
              return (
                <Unit key={ci} p={p} n={n} cx={ci * size + size / 2} cy={size / 2}>
                  <g transform={`translate(${ci * size + size / 2},${size / 2}) rotate(${(rand(s + 1) - 0.5) * 12})`}>
                    <g transform={`translate(${-size * 0.46},${-size * 0.52})`}>
                      <Sheet w={size * 0.92} h={size * 1.04} fill={bg}>
                        <text x={size * 0.46} y={size * 0.82} textAnchor="middle" fontFamily={rand(s + 3) > 0.5 ? DISPLAY : HEAVY} fontWeight={800}
                          fontSize={size * 0.86} fill={fgOn(bg, pal)}>{ch}</text>
                      </Sheet>
                    </g>
                  </g>
                </Unit>
              );
            })}
          </g>
        ))}
      </g>
    );
    bottom = (g.box.y + g.box.h) * k;
  } else {
    const lh = want * TITLE.lineK;
    const h = lines.length * lh;
    const fg = fgOn(stageBg(pal), pal);
    body = (
      <g>
        {lines.map((line, li) => {
          const lw = textWidth(line, FONT.displayBold, want);
          const y = -h / 2 + li * lh + lh / 2 + want * 0.36;
          let x = -lw / 2;
          return [...line].map((ch, ci) => {
            const cw = textWidth(ch, FONT.displayBold, want);
            const cx = x;
            x += cw;
            if (/\s/.test(ch)) return null;
            const n = unit++;
            return (
              <Unit key={`${li}-${ci}`} p={p} n={n} cx={cx + cw / 2} cy={y - want * 0.36}>
                <text x={cx} y={y} fontFamily={DISPLAY} fontWeight={700} fontSize={want} fill={fg}>{ch}</text>
              </Unit>
            );
          });
        })}
      </g>
    );
    bottom = h / 2;
  }
  const sub = d.sub ? cased(d.sub as string) : undefined;
  return (
    <g>
      {body}
      {sub && <g transform={`translate(0,${bottom + TITLE.sub.y})`}><TagArt text={sub} color={pal.highlight} size={TITLE.sub.size} seed={p.seed + 1} /></g>}
    </g>
  );
};

// ---------- КАРТОЧКА ----------
const Card: React.FC<{ p: ItemArtProps; d: Data }> = ({ p, d }) => {
  const { palette: pal } = useKitStyle();
  const cased = useCased();
  const title = d.title ? cased(d.title as string) : undefined;
  const lines = ((d.lines as string[]) ?? []).map(cased);
  const { w, h } = cardGeom(!!title, lines.length, (d.width as number | undefined) ?? CARD.w);
  const fg = fgOn(pal.paper, pal);
  const room = w - 2 * CARD.padX;
  const ts = title ? fitSize(measured(title, FONT.displayBold), CARD.title.size, room) : 0;
  // Строки — одним кеглем: самая длинная влезает в поле.
  const ls = Math.min(CARD.line.size, ...lines.map((l) => fitSize(measured(l, FONT.monoRegular), CARD.line.size, room)));
  const center = d.align === "center";
  const y0 = title ? CARD.line.y : CARD.line.yNoTitle;
  const pin = { head: mix(pal.ink, pal.paper, 0.6), shade: pal.ink };
  return (
    <g transform={`translate(${-w / 2},${-h / 2})`}>
      <Sheet w={w} h={h} fill={pal.paper}>
        <Pin x={CARD.pin.dx} y={CARD.pin.y} {...pin} /><Pin x={w - CARD.pin.dx} y={CARD.pin.y} {...pin} />
        {title && <text x={w / 2} y={CARD.title.y} textAnchor="middle" fontFamily={DISPLAY} fontWeight={700} fontSize={ts} fill={fg}>{title}</text>}
        {lines.map((l, i) => (
          <Unit key={i} p={p} n={i} cx={w / 2} cy={y0 + i * CARD.lineH - ls / 2}>
            <text x={center ? w / 2 : CARD.padX} y={y0 + i * CARD.lineH} textAnchor={center ? "middle" : "start"}
              fontFamily={MONO} fontWeight={500} fontSize={ls} fill={fg}>{l}</text>
          </Unit>
        ))}
      </Sheet>
    </g>
  );
};

// ---------- ГРАФИК ----------
const SAMPLES = 120;
// Форма кривой: точки модели (равномерно по x, значения — в долю высоты CHART.span) или
// словарь форм (shape).
const curvePts = (points: number[] | undefined, shape: string | undefined, w: number, h: number): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  const [lo, hi] = CHART.span;
  if (points && points.length >= 2) {
    const mn = Math.min(...points), mx = Math.max(...points);
    const yOf = (v: number) => (mx === mn ? (lo + hi) / 2 : hi - ((v - mn) / (mx - mn)) * (hi - lo));
    for (let i = 0; i <= SAMPLES; i++) {
      const t = i / SAMPLES;
      const u = t * (points.length - 1);
      const j = Math.min(points.length - 2, Math.floor(u));
      const v = points[j] + (points[j + 1] - points[j]) * (u - j);
      out.push([t * w, yOf(v) * h]);
    }
    return out;
  }
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    let y = 0.5;
    switch (shape) {
      case "rise": y = t < 0.4 ? 0.7 : 0.7 - (t - 0.4) * 1.0; break;
      case "fall": y = t < 0.4 ? 0.3 : 0.3 + (t - 0.4) * 1.0; break;
      case "flat": y = 0.55 + Math.sin(t * 20) * 0.01; break;
      case "wave": y = 0.5 - Math.sin(t * Math.PI * 2 * 3) * 0.28; break;
      case "boom-bust":
        y = t < 0.3 ? 0.62 : t < 0.55 ? 0.62 - Math.sin(((t - 0.3) / 0.25) * Math.PI / 2) * 0.48 :
          t < 0.75 ? 0.14 + ((t - 0.55) / 0.2) * 0.7 : 0.84 - ((t - 0.75) / 0.25) * 0.2;
        break;
      case "long-wave": y = 0.75 - Math.sin(t * Math.PI) * 0.5 - Math.sin(t * Math.PI * 2 * 5) * 0.06; break;
    }
    out.push([t * w, y * h]);
  }
  return out;
};

const Chart: React.FC<{ p: ItemArtProps; d: Data }> = ({ p, d }) => {
  const { palette: pal } = useKitStyle();
  const cased = useCased();
  const { w, h } = chartGeom();
  const pad = CHART.pad;
  const pts = curvePts(d.points as number[] | undefined, d.shape as string | undefined, w - pad * 2, h - CHART.plotH);
  const path = "M" + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L");
  const prog = progress(d.draw as Sub, p.f, p.fps);
  const ev = evolvePath(prog, path);
  const color = (d.color as string | undefined) ?? pal.accent;
  const fg = fgOn(pal.paper, pal);
  const tip = pts[Math.min(SAMPLES, Math.round(prog * SAMPLES))];
  const title = d.title ? cased(d.title as string) : undefined;
  const T0 = CHART.title;
  const tw = title ? textWidth(title, FONT.displayBold, T0.size) + 2 * T0.padX : 0;
  const pin = { head: mix(pal.ink, pal.paper, 0.6), shade: pal.ink };
  const marks = (d.marks as Array<{ x: number; text: string; frame: number }>) ?? [];
  return (
    <g transform={`translate(${-w / 2},${-h / 2})`}>
      <Sheet w={w} h={h} fill={pal.paper}>
        <Pin x={26} y={22} {...pin} /><Pin x={w - 26} y={22} {...pin} />
        {title && (
          <g transform={`translate(${T0.x},${T0.y})`}>
            <rect width={tw} height={T0.h} fill="none" stroke={color} strokeWidth={4} />
            <text x={T0.padX} y={T0.h * 0.74} fontFamily={DISPLAY} fontWeight={700} fontSize={T0.size} fill={color}>{title}</text>
          </g>
        )}
        <line x1={pad} y1={h - CHART.axisY} x2={w - pad} y2={h - CHART.axisY} stroke={mix(fg, pal.paper, 0.6)} strokeWidth={3} />
        <g transform={`translate(${pad},${CHART.plotTop})`}>
          {prog > 0 && (
            <path d={path} fill="none" stroke={color} strokeWidth={CHART.stroke} strokeLinecap="round" strokeLinejoin="round"
              strokeDasharray={ev.strokeDasharray} strokeDashoffset={ev.strokeDashoffset} />
          )}
          {d.pen && prog > 0 && prog < 1 && (
            <g transform={`translate(${tip[0]},${tip[1]}) rotate(35)`}>
              <rect x={-8} y={-74} width={20} height={64} rx={4} fill={pal.ink} />
              <path d="M-8,-10 L12,-10 L2,6 Z" fill={color} />
            </g>
          )}
          {marks.map((mk, i) => {
            if (p.f < mk.frame || prog < mk.x) return null;
            const pt = pts[Math.min(SAMPLES, Math.max(0, Math.round(mk.x * SAMPLES)))];
            return (
              <g key={i} transform={`translate(${pt[0]},${pt[1] - CHART.mark.dy})`}>
                <TagArt text={cased(mk.text)} size={CHART.mark.size} seed={p.seed + i} />
              </g>
            );
          })}
        </g>
      </Sheet>
    </g>
  );
};

// ---------- КАЛЕНДАРЬ ----------
const Calendar: React.FC<{ d: Data }> = ({ d }) => {
  const { palette: pal } = useKitStyle();
  const cased = useCased();
  const { w, h } = calendarGeom();
  const band = (d.color as string | undefined) ?? pal.accent;
  const top = cased(d.top as string), text = cased(d.text as string);
  const room = w - 2 * CALENDAR.padX;
  return (
    <g transform={`translate(${-w / 2},${-h / 2})`}>
      <Sheet w={w} h={h} fill={pal.paper}>
        <rect width={w} height={CALENDAR.band} fill={band} />
        <text x={w / 2} y={CALENDAR.top.y} textAnchor="middle" fontFamily={MONO} fontWeight={700}
          fontSize={fitSize(measured(top, FONT.mono), CALENDAR.top.size, room)} fill={fgOn(band, pal)}>{top}</text>
        <text x={w / 2} y={CALENDAR.text.y} textAnchor="middle" fontFamily={DISPLAY} fontWeight={700}
          fontSize={fitSize(measured(text, FONT.displayBold), CALENDAR.text.size, room)} fill={fgOn(pal.paper, pal)}>{text}</text>
        <circle cx={CALENDAR.ringDx} cy={0} r={CALENDAR.ring} fill={pal.ink} />
        <circle cx={w - CALENDAR.ringDx} cy={0} r={CALENDAR.ring} fill={pal.ink} />
      </Sheet>
    </g>
  );
};

// ---------- СРАВНЕНИЕ ----------
const Compare: React.FC<{ p: ItemArtProps; d: Data }> = ({ p, d }) => {
  const { palette: pal } = useKitStyle();
  const cased = useCased();
  const bars = (d.bars as Array<{ label: string; value: number; color?: string }>) ?? [];
  if (!bars.length) return null;
  const vText = (v: number) => cased(v.toLocaleString("ru-RU"));
  const tagW = (text: string, size: number) => tagGeom(measured(text, FONT.display, TAG.letterSpacing), size).w;
  const g = compareGeom(bars.map((b) => ({ value: b.value, valueW: tagW(vText(b.value), COMPARE.valueSize), labelW: tagW(cased(b.label), COMPARE.labelSize) })));
  const grow = d.grow as (Sub & { which: "all" | "last" | "none" }) | null;
  const q = progress(grow, p.f, p.fps);
  const lines = mix(pal.ink, pal.paper, 0.5);
  return (
    <g transform={`scale(${COMPARE.scale}) translate(0,${COMPARE.H0 / 2})`}>
      {bars.map((b, i) => {
        const grows = !!grow && (grow.which === "all" || (grow.which === "last" && i === bars.length - 1));
        const bh = g.heights[i] * (grows ? q : 1);
        const x = g.xs[i];
        const fill = b.color ?? pal.paper;
        return (
          <Unit key={i} p={p} n={i} cx={x} cy={-g.heights[i] / 2}>
            <g transform={`translate(${x},0)`}>
              {bh > 0 && (
                <g transform={`translate(${-COMPARE.barW / 2},${-bh})`}>
                  <path d={receiptRect(COMPARE.barW, Math.max(bh, 1))} fill={fill} filter="url(#shadow)" />
                  {Array.from({ length: Math.floor(bh / 34) }, (_, k) => (
                    <rect key={k} x={20} y={40 + k * 34} width={90 + rand(k + i * 31 + p.seed) * 40} height={6} fill={fgOn(fill, { ink: lines, paper: pal.paper })} opacity={0.5} />
                  ))}
                </g>
              )}
              <g transform={`translate(0,${-bh - COMPARE.valueY})`}><TagArt text={vText(b.value)} color={pal.ink} size={COMPARE.valueSize} seed={p.seed + i} /></g>
              <g transform={`translate(0,${COMPARE.labelY})`}><TagArt text={cased(b.label)} size={COMPARE.labelSize} seed={p.seed + i + 50} /></g>
            </g>
          </Unit>
        );
      })}
    </g>
  );
};

// ---------- ФОРМУЛА ----------
// receipt — чек с зубцами и штрихкодом, board — тёмная доска (лист цвета ink), plain — без листа.
const Formula: React.FC<{ p: ItemArtProps; d: Data }> = ({ p, d }) => {
  const { palette: pal } = useKitStyle();
  const cased = useCased();
  const lines = (d.lines as Array<{ text: string; color?: string; frame: number }>) ?? [];
  const { w, h } = formulaGeom(lines.length);
  const look = d.look as "receipt" | "board" | "plain";
  const base = look === "board" ? pal.ink : look === "receipt" ? pal.paper : stageBg(pal);
  const fg = fgOn(base, pal);
  const header = d.header ? cased(d.header as string) : null;
  const body = (
    <>
      {header && (
        <text x={w / 2} y={FORMULA.header.y} textAnchor="middle" fontFamily={MONO} fontWeight={500}
          fontSize={fitSize(measured(header, FONT.monoRegular), FORMULA.header.size, w - 2 * FORMULA.padX)} fill={mix(fg, base, 0.4)}>{header}</text>
      )}
      {lines.map((l, i) => {
        if (p.f < l.frame && !p.settled) return null;
        const text = cased(l.text);
        const y = FORMULA.top + i * FORMULA.lineH;
        const size = fitSize(measured(text, FONT.displayBold), FORMULA.size, w - 2 * FORMULA.padX);
        return (
          <Unit key={i} p={p} n={i} cx={w / 2} cy={y - size / 2}>
            <text x={w / 2} y={y} textAnchor="middle" fontFamily={DISPLAY} fontWeight={700} fontSize={size} fill={l.color ?? fg}>{text}</text>
          </Unit>
        );
      })}
      {look === "receipt" && Array.from({ length: FORMULA.barcode.n }, (_, i) => (
        <rect key={i} x={w / 2 - (FORMULA.barcode.n * FORMULA.barcode.step) / 2 + i * FORMULA.barcode.step} y={h - FORMULA.barcode.dy}
          width={rand(i + p.seed) > 0.5 ? 4 : 2} height={FORMULA.barcode.h} fill={fg} />
      ))}
    </>
  );
  return (
    <g transform={`translate(${-w / 2},${-h / 2})`}>
      {look === "plain" ? body : <Sheet w={w} h={h} fill={base} receipt={look === "receipt"}>{body}</Sheet>}
    </g>
  );
};

// ---------- ЗНАЧКИ ПРЕДМЕТОВ ----------
// Форма значка — словарь (рамки в geometry.ts PROP_BOX); цвета — роли палитры серии.
export type PropColors = {
  a: string; aLight: string; aDark: string; aDeep: string; paper: string; paperDark: string; ink: string;
  gold: string; goldDark: string; pos: string; neg: string; glass: string;
};
export const propColors = (p: T.Palette): PropColors => {
  const gold = p.highlight ?? p.accent;
  return {
    a: p.accent, aLight: mix(p.accent, p.paper, 0.45), aDark: mix(p.accent, p.ink, 0.3), aDeep: mix(p.accent, p.ink, 0.55),
    paper: p.paper, paperDark: mix(p.paper, p.ink, 0.15), ink: p.ink,
    gold, goldDark: mix(gold, p.ink, 0.3), pos: p.positive ?? p.accent, neg: p.negative ?? p.accent, glass: mix(p.paper, p.accent, 0.15),
  };
};

export const PropIcon: React.FC<{ name: string; seed: number; c: PropColors }> = ({ name, seed, c }) => {
  switch (name) {
    case "coin":
      return (
        <g filter="url(#shadow-soft)">
          <ellipse rx={46} ry={46} fill={c.goldDark} transform="translate(0,0)" />
          <circle r={46} fill={c.gold} />
          <circle r={34} fill="none" stroke={c.goldDark} strokeWidth={5} />
          <text y={16} textAnchor="middle" fontFamily={DISPLAY} fontWeight={700} fontSize={44} fill={c.goldDark}>₽</text>
        </g>
      );
    case "coins":
      return <g filter="url(#shadow-soft)">{[0, 1, 2, 3].map((i) => <ellipse key={i} cx={0} cy={30 - i * 18} rx={50} ry={16} fill={i % 2 ? c.gold : c.goldDark} stroke={c.goldDark} strokeWidth={3} />)}</g>;
    case "fish":
      return <g filter="url(#shadow-soft)"><path d="M-70,0 Q-20,-44 40,0 Q-20,44 -70,0 Z" fill={c.aLight} /><path d="M36,0 L76,-30 L70,0 L76,30 Z" fill={c.aDark} /><circle cx={-42} cy={-6} r={6} fill={c.ink} /></g>;
    case "boat":
      return <g filter="url(#shadow-soft)"><path d="M-110,0 L110,0 L80,50 L-80,50 Z" fill={c.aDark} /><rect x={-4} y={-150} width={8} height={150} fill={c.aDeep} /><path d="M6,-140 L90,-20 L6,-20 Z" fill={c.paper} /></g>;
    case "house":
      return <g filter="url(#shadow-soft)"><rect x={-70} y={-60} width={140} height={110} fill={c.aLight} /><path d="M-90,-56 L0,-130 L90,-56 Z" fill={c.aDark} /><rect x={-18} y={0} width={36} height={50} fill={c.aDeep} /><rect x={-56} y={-36} width={30} height={30} fill={c.gold} /></g>;
    case "bank":
      return <g filter="url(#shadow-soft)"><path d="M-110,-60 L0,-120 L110,-60 Z" fill={c.paper} /><rect x={-110} y={-60} width={220} height={16} fill={c.paperDark} />{[-80, -40, 0, 40, 80].map((x) => <rect key={x} x={x - 9} y={-40} width={18} height={90} fill={c.paper} />)}<rect x={-120} y={50} width={240} height={18} fill={c.paperDark} /></g>;
    case "car":
      return <g filter="url(#shadow-soft)"><path d="M-110,10 L-90,-30 L-40,-60 L50,-60 L90,-20 L110,10 L110,40 L-110,40 Z" fill={c.aLight} /><rect x={-30} y={-50} width={60} height={34} fill={c.glass} /><circle cx={-60} cy={42} r={22} fill={c.ink} /><circle cx={60} cy={42} r={22} fill={c.ink} /></g>;
    case "crown":
      return <g filter="url(#shadow-soft)"><path d="M-70,30 L-70,-30 L-35,0 L0,-50 L35,0 L70,-30 L70,30 Z" fill={c.gold} stroke={c.goldDark} strokeWidth={4} /></g>;
    case "question":
      return <g filter="url(#shadow)"><text y={110} textAnchor="middle" fontFamily={HEAVY} fontWeight={800} fontSize={300} fill={c.a}>?</text></g>;
    case "bulb":
      return <g filter="url(#shadow-soft)"><circle cy={-30} r={60} fill={mix(c.gold, c.paper, 0.5)} /><rect x={-26} y={22} width={52} height={40} fill={c.paperDark} /><path d="M-20,-30 Q0,-60 20,-30" stroke={c.goldDark} strokeWidth={5} fill="none" /></g>;
    case "cross":
      return <g filter="url(#shadow)"><path d="M-110,-110 L110,110 M110,-110 L-110,110" stroke={c.neg} strokeWidth={26} strokeLinecap="round" /></g>;
    case "heart":
      return <g filter="url(#shadow-soft)"><path d="M0,40 C-80,-10 -60,-80 0,-40 C60,-80 80,-10 0,40 Z" fill={c.a} /></g>;
    case "arrow-up":
      return <g filter="url(#shadow-soft)"><path d="M-22,90 L-22,-20 L-60,-20 L0,-100 L60,-20 L22,-20 L22,90 Z" fill={c.pos} /></g>;
    case "arrow-down":
      return <g filter="url(#shadow-soft)"><path d="M-22,-90 L-22,20 L-60,20 L0,100 L60,20 L22,20 L22,-90 Z" fill={c.neg} /></g>;
    case "chest":
      return <g filter="url(#shadow-soft)"><path transform="translate(-80,-50)" d={tornRect(160, 100, seed, 2)} fill={c.aDark} /><rect x={-80} y={-50} width={160} height={24} fill={c.aDeep} /><rect x={-12} y={-34} width={24} height={30} fill={c.gold} /></g>;
  }
  return <path d={circleTorn(40, seed)} fill={c.paper} />;
};

const Props: React.FC<{ p: ItemArtProps; d: Data }> = ({ p, d }) => {
  const { palette } = useKitStyle();
  const c = propColors(palette);
  const offsets = (d.offsets as Array<{ x: number; y: number }>) ?? [{ x: 0, y: 0 }];
  const k = (d.iconScale as number) ?? PROP.scale;
  return (
    <g>
      {offsets.map((o, i) => (
        <Unit key={i} p={p} n={i} cx={o.x} cy={o.y}>
          <g transform={`translate(${o.x},${o.y}) scale(${k})`}><PropIcon name={d.name as string} seed={p.seed + i} c={c} /></g>
        </Unit>
      ))}
    </g>
  );
};

// ---------- ВЫРЕЗКА ----------
// Заглушка вместо картинки, которой нет (не сгенерировалась или не загрузилась): лист по
// рамке картинки с крестом — рендер не падает, запись уже в fixes[].
export const Placeholder: React.FC<{ box: T.Rect }> = ({ box }) => {
  const { palette: pal } = useKitStyle();
  return (
    <g>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} fill={pal.paper} stroke={pal.ink} strokeWidth={4} strokeDasharray="18 12" opacity={0.85} />
      <path d={`M${box.x},${box.y}L${box.x + box.w},${box.y + box.h}M${box.x + box.w},${box.y}L${box.x},${box.y + box.h}`} stroke={pal.ink} strokeWidth={3} opacity={0.4} />
    </g>
  );
};

const Cutout: React.FC<{ p: ItemArtProps; d: Data }> = ({ p, d }) => {
  const cased = useCased();
  const dims = d.dims as { w: number; h: number } | undefined;
  const [w, h] = fitImage((d.size as number | undefined) ?? CUTOUT.side.m, dims);
  const href = d.missing ? null : p.img(d.key as string | undefined);
  const label = d.label ? cased(d.label as string) : undefined;
  return (
    <g>
      {href
        ? <SvgImage href={href} x={-w / 2} y={-h / 2} width={w} height={h} filter="url(#shadow)" />
        : <Placeholder box={{ x: -w / 2, y: -h / 2, w, h }} />}
      {label && <g transform={`translate(0,${h / 2 + CUTOUT.labelGap})`}><TagArt text={label} size={CUTOUT.labelSize} seed={p.seed + 1} /></g>}
    </g>
  );
};

// ---------- ДЕТАЛЬ ----------
export const ItemArt: React.FC<ItemArtProps> = (p) => {
  const d = p.el.data as Data;
  const whole = (node: React.ReactNode) => <Unit p={p} n={0}>{node}</Unit>;
  switch (p.el.kind) {
    case "counter": return whole(<Counter p={p} d={d} />);
    case "tag": return whole(<TagLeaf d={d} seed={p.seed} />);
    case "stamp": return whole(<Stamp d={d} />);
    case "title": return <Title p={p} d={d} />;
    case "card": return <Card p={p} d={d} />;
    case "chart": return whole(<Chart p={p} d={d} />);
    case "calendar": return whole(<Calendar d={d} />);
    case "compare": return <Compare p={p} d={d} />;
    case "formula": return <Formula p={p} d={d} />;
    case "cutout": return whole(<Cutout p={p} d={d} />);
    case "prop": return <Props p={p} d={d} />;
    default: return null;
  }
};
const TagLeaf: React.FC<{ d: Data; seed: number }> = ({ d, seed }) => {
  const cased = useCased();
  return <TagArt text={cased(d.text as string)} color={d.color as string | undefined} size={d.size as number | undefined} seed={seed} />;
};
