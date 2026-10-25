// <Counter> — число, которое досчитывает от from до to. Ширина коробки фиксирована по самой
// широкой строке и цифры табличные: строка не дрожит при счёте (одна из причин «прыгает»).
// <Pill> — плашка-акцент с текстом (ключевое слово, статус, метка), входит шторкой.
import React, { useMemo } from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { countAt } from "../data-viz";
import { type FontSpec, measureWidth, useFontReady } from "../layout-guard/text";

const fmtRu = (n: number, digits = 0) => new Intl.NumberFormat("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);

export const Counter: React.FC<{
  from?: number; to: number; start?: number; dur?: number; digits?: number;
  format?: (n: number) => string; prefix?: string; suffix?: string;
  font: FontSpec; size: number; color: string; align?: "left" | "center" | "right"; step?: number | "auto";
  style?: React.CSSProperties; id?: string;
}> = ({ from = 0, to, start = 0, dur = 30, digits = 0, format, prefix = "", suffix = "", font, size, color, align = "center", step = "auto", style, id = "counter" }) => {
  const frame = useCurrentFrame();
  const ready = useFontReady(font);
  const fmt = format ?? ((n: number) => fmtRu(n, digits));
  // Промежуточные значения — круглым шагом (1/10 порядка разницы) по направлению счёта, в
  // кадре start — ровно from, в конце — точное число; назад не идёт (countAt из data-viz).
  const v = countAt(frame, { start, dur, from, to, ease: Easing.out(Easing.cubic), decimals: digits, step });
  // Ширина — по самой длинной строке с цифрами «0» (табличные цифры одной ширины).
  const width = useMemo(() => {
    if (!ready) return 0;
    const cands = [fmt(from), fmt(to), fmt((from + to) / 2)].map((s) => `${prefix}${s}${suffix}`.replace(/\d/g, "0"));
    return Math.ceil(Math.max(...cands.map((c) => measureWidth(c, font, size))) * 1.04);
  }, [ready, from, to, prefix, suffix, font, size]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ready) return null;
  return (
    <div data-id={id} style={{ width, textAlign: align, whiteSpace: "nowrap", fontFamily: font.family, fontWeight: font.weight, fontStyle: font.style, fontSize: size, lineHeight: 1, color, fontVariantNumeric: "tabular-nums", ...style }}>
      {prefix}{fmt(digits ? v : Math.round(v))}{suffix}
    </div>
  );
};

export const Pill: React.FC<{
  text: string; font: FontSpec; size: number; color: string; background: string;
  start?: number; dur?: number; radius?: number; padX?: number; padY?: number; style?: React.CSSProperties; id?: string;
}> = ({ text, font, size, color, background, start = 0, dur = 8, radius, padX = 0.5, padY = 0.22, style, id }) => {
  const frame = useCurrentFrame();
  const k = interpolate(frame, [start, start + dur], [0, 1], { easing: Easing.out(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const r = radius ?? size * 0.6;
  return (
    <div data-id={id ?? `pill:${text}`} style={{
      display: "inline-block", whiteSpace: "nowrap", padding: `${padY * size}px ${padX * size}px`, borderRadius: r, background, color,
      fontFamily: font.family, fontWeight: font.weight, fontStyle: font.style, fontSize: size, lineHeight: 1.1,
      letterSpacing: font.letterSpacingEm ? `${font.letterSpacingEm}em` : undefined,
      clipPath: `inset(0 ${(1 - k) * 100}% 0 0 round ${r}px)`, ...style,
    }}>{text}</div>
  );
};
