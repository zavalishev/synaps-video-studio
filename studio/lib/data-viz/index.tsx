// Скилл data-viz: цифры и графики как функции кадра. Всё по выбору директора: цвета, шрифты,
// размеры и темп приходят параметрами (VizTheme); цвета — только vizTheme(theme) из theme.json.
//   import { Counter, BarChart, LineChart, Ring, Donut, Pictogram, fmtNum } from "@studio/data-viz";
//
// Что гарантировано (страховка, а не вкус):
//   • цифры не «дрожат»: tabular-nums + место под итоговую строку зарезервировано заранее;
//   • столбики растут от нуля (ось с нуля), без перелёта (плавность без пружин);
//   • слишком много категорий и мелкие подписи пишутся в лог страховки ([studio-guard] →
//     guard.json): viz-categories, viz-label-small.
import React from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { scaleBand, scaleLinear } from "d3-scale";
import { arc as d3arc, area as d3area, curveLinear, curveMonotoneX, line as d3line, pie as d3pie } from "d3-shape";
import { evolvePath, getLength, getPointAtLength } from "@remotion/paths";
import { EASE } from "../camera";
import { reportGuard } from "../layout";
import { mix } from "../paper-kit/kit/color";
import { mixOk } from "../art-direction/theme";

// ---------- тема ----------
export type VizTheme = {
  ink: string;          // основной текст, значения
  muted: string;        // подписи осей, второстепенное
  grid: string;         // сетка и ось
  accent: string;       // главный ряд / выделенный столбик
  series?: string[];    // остальные ряды и сегменты (по порядку); нет — accent и смеси
  track?: string;       // «дорожка» кольца, пустые иконки
  rest?: string;        // невыделенные столбики при highlight (нет — смесь track и muted)
  bg?: string;          // фон под графиком: ореол подписей поверх линии, обводка точки
  font: string;         // CSS font-family подписей (кириллица — через useCyrillicFont)
  numFont?: string;     // шрифт цифр (по умолчанию font)
  weight?: number;      // вес цифр (по умолчанию 800)
};

// Тема графика — только из theme.json текущего ролика: готовых палитр здесь нет (пресеты с
// конкретными цветами незаметно делали все ролики студии «бумага + терракота» или «ночь +
// мята»). Недостающие роли выводятся из palette смесью в OKLCH.
//   const t = vizTheme(theme, { font: caption });   // theme — import theme from "../theme.json"
export type PaletteLike = { bg: string; ink: string; accent: string; muted?: string; accent2?: string; [k: string]: string | undefined };
export const vizTheme = (theme: { palette: PaletteLike }, o: { font: string; numFont?: string; weight?: number; series?: string[] }): VizTheme => {
  const P = theme?.palette;
  if (!P?.bg || !P?.ink || !P?.accent) throw new Error("vizTheme: нужна theme.palette с bg, ink, accent (theme.json ролика) — цвета графика берутся только из арт-дирекции ролика");
  return {
    ink: P.ink, muted: P.muted ?? mixOk(P.ink, P.bg, 0.45), grid: mixOk(P.ink, P.bg, 0.8), accent: P.accent,
    series: o.series ?? [P.accent, ...(P.accent2 ? [P.accent2] : []), mixOk(P.accent, P.ink, 0.5), mixOk(P.ink, P.bg, 0.3), mixOk(P.ink, P.bg, 0.6)],
    track: mixOk(P.ink, P.bg, 0.88), bg: P.bg, font: o.font, ...(o.numFont ? { numFont: o.numFont } : {}), ...(o.weight ? { weight: o.weight } : {}),
  };
};

// Кегль подписи, которая должна влезть в ширину slot: длинное слово уменьшает кегль, а не
// вылезает за столбик (оценка по средней ширине буквы ≈ 0.6 em, без замера шрифта — замер до
// загрузки шрифта закэшировал бы неверную ширину). Переносится по словам, максимум 2 строки.
export const fitLabelPx = (text: string, want: number, slot: number, em = 0.6) => {
  const longest = Math.max(1, ...text.split(/\s+/).map((w) => w.length));
  return Math.min(want, Math.floor(slot / (longest * em)));
};

const seriesColor = (t: VizTheme, i: number) => (t.series && t.series.length ? t.series[i % t.series.length] : t.accent);

// ---------- числа ----------
// ru-RU: группы через неразрывный пробел, запятая в дробях. compact — «1,2 млн».
export const fmtNum = (n: number, o: { decimals?: number; prefix?: string; suffix?: string; locale?: string; compact?: boolean; sign?: boolean } = {}) => {
  const d = o.decimals ?? 0;
  const f = new Intl.NumberFormat(o.locale ?? "ru-RU", {
    minimumFractionDigits: d, maximumFractionDigits: d,
    ...(o.compact ? { notation: "compact", compactDisplay: "short" } : {}),
    ...(o.sign ? { signDisplay: "exceptZero" } : {}),
  } as Intl.NumberFormatOptions);
  return `${o.prefix ?? ""}${f.format(n)}${o.suffix ?? ""}`;
};

export const OUT_CUBIC = Easing.out(Easing.cubic);

// «Круглый» шаг прокрутки: в ролике про конкретные суммы промежуточные «138 019 ₽» читаются
// как мусор. По умолчанию (step "auto") во время счёта значение округляется до 1/10 порядка
// разницы (0 → 140 000 идёт шагом 10 000, 0 → 290 — шагом 10), в конце — точное число.
export const niceStep = (from: number, to: number) => { const d = Math.abs(to - from); return d >= 20 ? 10 ** Math.max(0, Math.floor(Math.log10(d)) - 1) : 1; };
// Значение счётчика в кадре: from → to между start и start+dur, зажато.
// До и в кадре start — ровно from (счётчик, продолжающий прошлый бит, встаёт на склейке на
// то же число, а не на округлённое «16 100» после «16 105»); во время счёта шаг округляется
// по направлению счёта и зажат в [from, to] — число никогда не идёт назад.
export const countAt = (frame: number, o: { start: number; dur: number; from?: number; to: number; ease?: (t: number) => number; decimals?: number; step?: number | "auto" }) => {
  const from = o.from ?? 0;
  if (frame <= o.start) return from;
  if (frame >= o.start + Math.max(1, o.dur)) return o.to;
  const v = interpolate(frame, [o.start, o.start + Math.max(1, o.dur)], [from, o.to], { easing: o.ease ?? OUT_CUBIC, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const k = 10 ** (o.decimals ?? 0);
  const step = o.step === undefined || o.step === "auto" ? (o.decimals ? 0 : niceStep(from, o.to)) : o.step;
  const lo = Math.min(from, o.to), hi = Math.max(from, o.to);
  const up = o.to >= from;
  const r = step > 1 ? (up ? Math.ceil(v / step) : Math.floor(v / step)) * step : (up ? Math.ceil(v * k - 1e-9) : Math.floor(v * k + 1e-9)) / k;
  return Math.min(hi, Math.max(lo, r));
};

const grow = (frame: number, start: number, dur: number, ease: (t: number) => number = EASE) =>
  interpolate(frame, [start, start + Math.max(1, dur)], [0, 1], { easing: ease, extrapolateLeft: "clamp", extrapolateRight: "clamp" });

// Число со счётом. Ширина не «дышит»: невидимая итоговая строка держит место (inline-grid,
// оба слоя в одной ячейке), цифры табличные. align — где «стоит» число при меньшей длине.
export const Counter: React.FC<{
  value: number; from?: number; start?: number; dur?: number; decimals?: number; prefix?: string; suffix?: string;
  compact?: boolean; ease?: (t: number) => number; align?: "left" | "center" | "right"; step?: number | "auto";
  style?: React.CSSProperties; suffixStyle?: React.CSSProperties;
}> = ({ value, from = 0, start = 0, dur = 30, decimals = 0, prefix, suffix, compact, ease, align = "right", step, style, suffixStyle }) => {
  const frame = useCurrentFrame();
  const v = countAt(frame, { start, dur, from, to: value, ease, decimals, step });
  const fmt = (n: number) => fmtNum(n, { decimals, compact });
  const cell: React.CSSProperties = { gridArea: "1 / 1", textAlign: align, whiteSpace: "nowrap" };
  // Резерв — самая длинная из строк начала и конца (счёт вниз тоже не дышит).
  const widest = fmt(value).length >= fmt(from).length ? fmt(value) : fmt(from);
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", fontVariantNumeric: "tabular-nums", fontFeatureSettings: "'tnum' 1", ...style }}>
      {prefix ? <span style={suffixStyle}>{prefix}</span> : null}
      <span style={{ display: "inline-grid" }}>
        <span style={{ ...cell, visibility: "hidden" }}>{widest}</span>
        <span style={cell}>{fmt(v)}</span>
      </span>
      {suffix ? <span style={suffixStyle}>{suffix}</span> : null}
    </span>
  );
};

// ---------- проверки ----------
const LABEL_MIN_FRAC = 0.018;   // подпись графика ≥ 1.8 % высоты кадра (≈35 px на 1920)
const useVizCheck = (id: string, o: { categories?: number; labelPx?: number; maxCategories?: number }) => {
  const frame = useCurrentFrame();
  const { height: H } = useVideoConfig();
  if (frame !== 0) return;  // параметры не зависят от кадра — достаточно одного отчёта
  if (o.categories !== undefined && o.categories > (o.maxCategories ?? 5)) reportGuard({ id, kind: "viz-categories", frame, amount: o.categories, detail: `категорий ${o.categories} > ${o.maxCategories ?? 5}: объедините мелкие в «прочее» или разбейте на два кадра` });
  if (o.labelPx !== undefined && o.labelPx < LABEL_MIN_FRAC * H) reportGuard({ id, kind: "viz-label-small", frame, amount: o.labelPx, detail: `подпись ${o.labelPx}px < ${Math.round(LABEL_MIN_FRAC * H)}px` });
};

// ---------- столбики ----------
// Подпись столбика считает тем же ходом, что и его высота: число всегда равно столбику.
const atGrow = (v: number, g: number, decimals = 0) => { const k = 10 ** decimals; return Math.round(v * g * k) / k; };

export type Datum = { label: string; value: number; color?: string; note?: string };

// Столбики от нуля. orientation "column" — вертикальные, подписи снизу; "row" — горизонтальные
// полосы, подпись над полосой (лучше для вертикального видео и длинных подписей).
// Рост: каждый столбик за dur кадров, следующий — через stagger; значение считает вместе.
export const BarChart: React.FC<{
  id?: string; data: Datum[]; width: number; height: number; theme: VizTheme;
  orientation?: "column" | "row"; start?: number; dur?: number; stagger?: number;
  max?: number; highlight?: number | string; decimals?: number; prefix?: string; suffix?: string;
  labelPx?: number; valuePx?: number; radius?: number; gap?: number; showValues?: boolean; baseline?: boolean;
}> = (p) => {
  const frame = useCurrentFrame();
  const { theme: t, data, width: Wd, height: Hd } = p;
  const start = p.start ?? 0, dur = p.dur ?? 24, stagger = p.stagger ?? 6;
  const labelPx = p.labelPx ?? 38, valuePx = p.valuePx ?? 48, radius = p.radius ?? 14;
  useVizCheck(p.id ?? "bars", { categories: data.length, labelPx });
  const maxV = p.max ?? Math.max(0, ...data.map((d) => d.value));
  const minV = Math.min(0, ...data.map((d) => d.value));
  const isHi = (d: Datum, i: number) => p.highlight === undefined ? true : typeof p.highlight === "number" ? p.highlight === i : p.highlight === d.label;
  const colorOf = (d: Datum, i: number) => d.color ?? (p.highlight === undefined ? seriesColor(t, i) : isHi(d, i) ? t.accent : t.rest ?? mix(t.track ?? t.grid, t.muted, 0.3));
  const num = (v: number) => fmtNum(v, { decimals: p.decimals, prefix: p.prefix, suffix: p.suffix });
  const numStyle: React.CSSProperties = { fontFamily: t.numFont ?? t.font, fontWeight: t.weight ?? 800, fontVariantNumeric: "tabular-nums", color: t.ink, whiteSpace: "nowrap" };

  if ((p.orientation ?? "column") === "row") {
    const rowH = Hd / data.length;
    const barH = Math.min(rowH * 0.42, valuePx * 1.5);
    const x = scaleLinear().domain([minV, maxV]).range([0, Wd - valuePx * 3.4]);
    return (
      <div style={{ position: "relative", width: Wd, height: Hd }}>
        {data.map((d, i) => {
          const g = grow(frame, start + i * stagger, dur);
          const w = Math.abs(x(d.value) - x(0)) * g;
          const y0 = i * rowH + (rowH - (labelPx * 1.35 + barH)) / 2;
          return (
            <div key={i} style={{ position: "absolute", left: 0, top: y0, width: Wd, opacity: Math.min(1, g * 4) }}>
              <div style={{ fontFamily: t.font, fontSize: labelPx, color: isHi(d, i) ? t.ink : t.muted, lineHeight: 1.2, marginBottom: labelPx * 0.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.label}</div>
              <div style={{ display: "flex", alignItems: "center", height: barH }}>
                <div style={{ width: w, height: barH, background: colorOf(d, i), borderRadius: `0 ${radius}px ${radius}px 0` }} />
                {p.showValues === false ? null : (
                  <div style={{ ...numStyle, fontSize: valuePx, marginLeft: valuePx * 0.3 }}>{num(atGrow(d.value, g, p.decimals))}</div>
                )}
              </div>
            </div>
          );
        })}
        {p.baseline === false ? null : <div style={{ position: "absolute", left: 0, top: 0, width: 3, height: Hd, background: t.grid }} />}
      </div>
    );
  }

  // column
  const labelBand = labelPx * 2.7;
  const valueBand = valuePx * 1.5;
  const plotH = Hd - labelBand - valueBand;
  const xb = scaleBand<number>().domain(data.map((_, i) => i)).range([0, Wd]).paddingInner(p.gap ?? 0.28).paddingOuter(0.08);
  const y = scaleLinear().domain([minV, maxV]).range([plotH, 0]);
  const zeroY = valueBand + y(0);
  // Один кегль на все подписи (по самой длинной), иначе ряд подписей «пляшет» по размеру.
  const labelFit = Math.min(...data.map((d) => fitLabelPx(d.label, labelPx, xb.bandwidth() * 1.24)));
  return (
    <div style={{ position: "relative", width: Wd, height: Hd }}>
      {data.map((d, i) => {
        const s = start + i * stagger;
        const g = grow(frame, s, dur);
        const full = Math.abs(y(d.value) - y(0));
        const h = full * g;
        const left = xb(i)!, bw = xb.bandwidth();
        const up = d.value >= 0;
        const top = up ? zeroY - h : zeroY;
        return (
          <React.Fragment key={i}>
            <div style={{ position: "absolute", left, top, width: bw, height: h, background: colorOf(d, i), borderRadius: up ? `${radius}px ${radius}px 0 0` : `0 0 ${radius}px ${radius}px` }} />
            {p.showValues === false ? null : (
              <div style={{ position: "absolute", left: left - bw * 0.3, width: bw * 1.6, top: up ? top - valuePx * 1.3 : top + h + valuePx * 0.1, textAlign: "center", ...numStyle, fontSize: valuePx, lineHeight: 1.1, opacity: Math.min(1, g * 3), color: isHi(d, i) ? t.ink : t.muted }}>
                {num(atGrow(d.value, g, p.decimals))}
              </div>
            )}
            <div style={{ position: "absolute", left: left - bw * 0.12, width: bw * 1.24, top: Hd - labelBand + labelPx * 0.45, textAlign: "center", fontFamily: t.font, fontSize: labelFit, lineHeight: 1.15, color: isHi(d, i) ? t.ink : t.muted, opacity: Math.min(1, g * 3), overflow: "hidden", maxHeight: labelPx * 2.4 }}>
              {d.label}
            </div>
          </React.Fragment>
        );
      })}
      {p.baseline === false ? null : <div style={{ position: "absolute", left: 0, width: Wd, top: zeroY - 1.5, height: 3, background: t.grid }} />}
    </div>
  );
};

// ---------- линия ----------
export type Pt = { x: number; y: number };

// Линия рисуется по длине (evolvePath) за dur кадров; точка на конце едет с ней; заливка под
// линией открывается вместе с ней; метки markers появляются, когда линия до них дошла.
// zero — ось Y с нуля (для величин, где важен масштаб); иначе домен по данным с полями.
export const LineChart: React.FC<{
  id?: string; data: Array<number | Pt>; width: number; height: number; theme: VizTheme;
  start?: number; dur?: number; color?: string; strokeWidth?: number; curve?: "smooth" | "linear";
  area?: boolean; zero?: boolean; yDomain?: [number, number]; grid?: number; dot?: boolean;
  xLabels?: string[]; labelPx?: number; endLabel?: string | ((v: number) => string); endLabelPx?: number;
  markers?: Array<{ index: number; label: string }>;
}> = (p) => {
  const frame = useCurrentFrame();
  const t = p.theme;
  const pts: Pt[] = p.data.map((d, i) => (typeof d === "number" ? { x: i, y: d } : d));
  const labelPx = p.labelPx ?? 34;
  useVizCheck(p.id ?? "line", { labelPx: p.xLabels || p.markers ? labelPx : undefined });
  const padT = (p.endLabelPx ?? 56) * 1.6, padB = p.xLabels ? labelPx * 2 : 8, padL = 8, padR = (p.endLabelPx ?? 56) * 0.6;
  const ys = pts.map((q) => q.y);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (p.zero) lo = Math.min(0, lo);
  else { const m = (hi - lo || 1) * 0.12; lo -= m; hi += m; }
  const [y0, y1] = p.yDomain ?? [lo, hi];
  const x = scaleLinear().domain([pts[0].x, pts[pts.length - 1].x]).range([padL, p.width - padR]);
  const y = scaleLinear().domain([y0, y1]).range([p.height - padB, padT]);
  const curve = p.curve === "linear" ? curveLinear : curveMonotoneX;
  const d = d3line<Pt>().x((q) => x(q.x)).y((q) => y(q.y)).curve(curve)(pts) ?? "";
  const ad = d3area<Pt>().x((q) => x(q.x)).y0(y(y0)).y1((q) => y(q.y)).curve(curve)(pts) ?? "";
  const g = grow(frame, p.start ?? 0, p.dur ?? 45);
  const len = getLength(d);
  const ev = evolvePath(g, d);
  const tip = getPointAtLength(d, Math.max(0.01, len * g)) ?? { x: 0, y: 0 };
  const col = p.color ?? t.accent;
  const sw = p.strokeWidth ?? 10;
  const gid = `lg-${p.id ?? "line"}`;
  const end = pts[pts.length - 1];
  const endText = typeof p.endLabel === "function" ? p.endLabel(end.y) : p.endLabel;
  const endOn = grow(frame, (p.start ?? 0) + (p.dur ?? 45) - 4, 10);
  return (
    <svg width={p.width} height={p.height} style={{ overflow: "visible", display: "block" }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={col} stopOpacity={0.32} />
          <stop offset="100%" stopColor={col} stopOpacity={0} />
        </linearGradient>
        <clipPath id={`${gid}-clip`}><rect x={0} y={0} width={Math.max(0, tip.x)} height={p.height} /></clipPath>
      </defs>
      {Array.from({ length: p.grid ?? 4 }, (_, i) => {
        const gy = padT + ((p.height - padB - padT) * i) / Math.max(1, (p.grid ?? 4) - 1);
        return <line key={i} x1={padL} x2={p.width - padR} y1={gy} y2={gy} stroke={t.grid} strokeWidth={2} strokeDasharray={i === (p.grid ?? 4) - 1 ? undefined : "2 10"} strokeLinecap="round" />;
      })}
      {p.area ? <path d={ad} fill={`url(#${gid})`} clipPath={`url(#${gid}-clip)`} /> : null}
      <path d={d} fill="none" stroke={col} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={ev.strokeDasharray} strokeDashoffset={ev.strokeDashoffset} />
      {(p.markers ?? []).map((m, i) => {
        const q = pts[m.index];
        if (!q) return null;
        const mx = x(q.x), my = y(q.y);
        const on = interpolate(tip.x - mx, [0, 30], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        return (
          <g key={i} opacity={on}>
            <circle cx={mx} cy={my} r={sw * 0.9} fill={t.ink} />
            <text x={mx} y={my - sw * 2.2} textAnchor="middle" fontFamily={t.font} fontSize={labelPx} fill={t.ink}
              stroke={t.bg} strokeWidth={t.bg ? labelPx * 0.3 : 0} strokeLinejoin="round" paintOrder="stroke">{m.label}</text>
          </g>
        );
      })}
      {p.dot === false || g <= 0 ? null : (
        <g>
          <circle cx={tip.x} cy={tip.y} r={sw * 2.2} fill={col} opacity={0.18} />
          <circle cx={tip.x} cy={tip.y} r={sw * 1.15} fill={col} stroke={t.bg ?? t.track ?? "#fff"} strokeWidth={sw * 0.5} />
        </g>
      )}
      {endText ? (
        <text x={x(end.x)} y={y(end.y) - sw * 2.8} textAnchor="end" fontFamily={t.numFont ?? t.font} fontWeight={t.weight ?? 800} fontSize={p.endLabelPx ?? 56} fill={t.ink} opacity={endOn} style={{ fontVariantNumeric: "tabular-nums" }}>{endText}</text>
      ) : null}
      {(p.xLabels ?? []).map((lb, i, arr) => {
        const xi = pts[0].x + ((end.x - pts[0].x) * i) / Math.max(1, arr.length - 1);
        return <text key={i} x={x(xi)} y={p.height - labelPx * 0.4} textAnchor={i === 0 ? "start" : i === arr.length - 1 ? "end" : "middle"} fontFamily={t.font} fontSize={labelPx} fill={t.muted}>{lb}</text>;
      })}
    </svg>
  );
};

// ---------- кольца ----------
// Кольцо прогресса: доля value ∈ [0, 1] заполняется за dur кадров; children — в центре
// (обычно <Counter … suffix="%" />).
export const Ring: React.FC<{
  value: number; size: number; thickness?: number; start?: number; dur?: number; color?: string; theme: VizTheme;
  roundCap?: boolean; children?: React.ReactNode;
}> = ({ value, size, thickness = size * 0.1, start = 0, dur = 40, color, theme: t, roundCap = true, children }) => {
  const frame = useCurrentFrame();
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const g = grow(frame, start, dur) * Math.max(0, Math.min(1, value));
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={t.track ?? t.grid} strokeWidth={thickness} />
        {g > 0.0005 ? <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color ?? t.accent} strokeWidth={thickness} strokeLinecap={roundCap ? "round" : "butt"} strokeDasharray={`${c * g} ${c}`} /> : null}
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }}>{children}</div>
    </div>
  );
};

// Бублик из долей: сегменты открываются по кругу один за другим (общий ход за dur кадров).
export const Donut: React.FC<{
  segments: Datum[]; size: number; thickness?: number; start?: number; dur?: number; padDeg?: number; theme: VizTheme;
  cornerRadius?: number; children?: React.ReactNode; id?: string;
}> = ({ segments, size, thickness = size * 0.16, start = 0, dur = 45, padDeg = 1.6, theme: t, cornerRadius = 6, children, id }) => {
  const frame = useCurrentFrame();
  useVizCheck(id ?? "donut", { categories: segments.length });
  const sweep = grow(frame, start, dur) * 2 * Math.PI;
  const arcs = d3pie<Datum>().value((d) => Math.max(0, d.value)).sort(null).padAngle((padDeg * Math.PI) / 180)(segments);
  const R = size / 2;
  const mk = d3arc<{ startAngle: number; endAngle: number; padAngle: number }>().innerRadius(R - thickness).outerRadius(R).cornerRadius(cornerRadius);
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ position: "absolute", inset: 0 }}>
        <g transform={`translate(${R},${R})`}>
          {arcs.map((a, i) => {
            if (sweep <= a.startAngle) return null;
            const e = Math.min(a.endAngle, sweep);
            return <path key={i} d={mk({ startAngle: a.startAngle, endAngle: e, padAngle: a.padAngle }) ?? ""} fill={a.data.color ?? seriesColor(t, i)} />;
          })}
        </g>
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }}>{children}</div>
    </div>
  );
};

// Легенда к бублику/рядам: квадратик цвета + подпись (+ значение).
export const Legend: React.FC<{ items: Datum[]; theme: VizTheme; px?: number; start?: number; stagger?: number; decimals?: number; suffix?: string; direction?: "column" | "row" }> = ({ items, theme: t, px = 38, start = 0, stagger = 5, decimals, suffix, direction = "column" }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ display: "flex", flexDirection: direction, gap: px * 0.5, flexWrap: "wrap" }}>
      {items.map((d, i) => {
        const g = grow(frame, start + i * stagger, 14);
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: px * 0.4, opacity: g, transform: `translateY(${(1 - g) * 12}px)`, fontFamily: t.font, fontSize: px, color: t.ink }}>
            <span style={{ width: px * 0.62, height: px * 0.62, borderRadius: px * 0.16, background: d.color ?? seriesColor(t, i), flex: "none" }} />
            <span>{d.label}</span>
            {suffix !== undefined || decimals !== undefined ? <span style={{ marginLeft: "auto", paddingLeft: px * 0.5, fontWeight: t.weight ?? 800, fontFamily: t.numFont ?? t.font, fontVariantNumeric: "tabular-nums" }}>{fmtNum(d.value, { decimals, suffix })}</span> : null}
          </div>
        );
      })}
    </div>
  );
};

// ---------- пиктограмма ----------
// «7 из 10»: сетка иконок, value из total закрашены; закрашивание идёт по одной иконке через
// stagger кадров (может быть дробным). icon — "person" | "dot" | "square" | своя функция.
export const Pictogram: React.FC<{
  total: number; value: number; cols: number; size: number; gap?: number; theme: VizTheme;
  start?: number; stagger?: number; on?: string; off?: string;
  icon?: "person" | "dot" | "square" | ((color: string, size: number) => React.ReactNode);
}> = ({ total, value, cols, size, gap = size * 0.25, theme: t, start = 0, stagger = 2, on, off, icon = "person" }) => {
  const frame = useCurrentFrame();
  const rows = Math.ceil(total / cols);
  const draw = (color: string) => {
    if (typeof icon === "function") return icon(color, size);
    if (icon === "dot") return <svg width={size} height={size}><circle cx={size / 2} cy={size / 2} r={size * 0.42} fill={color} /></svg>;
    if (icon === "square") return <svg width={size} height={size}><rect x={size * 0.08} y={size * 0.08} width={size * 0.84} height={size * 0.84} rx={size * 0.18} fill={color} /></svg>;
    return (
      <svg width={size} height={size} viewBox="0 0 100 100">
        <circle cx={50} cy={22} r={17} fill={color} />
        <path d="M22,96 L22,62 Q22,44 40,44 L60,44 Q78,44 78,62 L78,96 Z" fill={color} />
      </svg>
    );
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, ${size}px)`, gap, width: cols * size + (cols - 1) * gap, height: rows * size + (rows - 1) * gap }}>
      {Array.from({ length: total }, (_, i) => {
        const filled = i < value;
        const g = filled ? grow(frame, start + i * stagger, 10) : 0;
        return (
          <div key={i} style={{ position: "relative", width: size, height: size }}>
            <div style={{ position: "absolute", inset: 0 }}>{draw(off ?? t.track ?? t.grid)}</div>
            {filled ? <div style={{ position: "absolute", inset: 0, opacity: g, transform: `scale(${0.7 + 0.3 * g})` }}>{draw(on ?? t.accent)}</div> : null}
          </div>
        );
      })}
    </div>
  );
};

// Подпись источника данных (мелко, внизу графика).
export const SourceNote: React.FC<{ text: string; theme: VizTheme; px?: number; style?: React.CSSProperties }> = ({ text, theme: t, px = 28, style }) => (
  <div style={{ fontFamily: t.font, fontSize: px, color: t.muted, letterSpacing: 0.3, ...style }}>{text}</div>
);
