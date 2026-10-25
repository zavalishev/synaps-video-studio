// Страховка кадра (layout-guard). Это инструмент директора, а не шаблон: вкуса здесь нет,
// только «не сломано».
//   • safeArea — безопасная зона кадра (поля под интерфейс соцсетей);
//   • coverRect / kenBurns — картинка-фон, которая ВСЕГДА покрывает кадр: масштаб не меньше
//     cover, сдвиг ограничен запасом, край картинки никогда не заходит внутрь кадра
//     (лечит «картинки уезжают за правый край»);
//   • containRect — картинка целиком внутри области;
//   • guardBox — проверка коробки слоя: внутри зоны (inside) или покрывает кадр (cover).
//     Возвращает исправленную коробку и пишет нарушение в лог браузера с меткой
//     [studio-guard]; инструменты still/render собирают их в out/guard.json, probe и
//     самопроверка их показывают;
//   • textCheck — подпись читается: кегль не меньше доли высоты кадра, контраст ≥ 4.5.
// Положение каждого слоя — чистая функция кадра. Никаких Math.random / Date.now.
import { contrastOver } from "./paper-kit/kit/color";

export type Box = { x: number; y: number; w: number; h: number };
export type Margins = { top: number; right: number; bottom: number; left: number };

export const GUARD_TAG = "[studio-guard]";

// Интерфейс ленты 9:16 (Reels/Shorts/TikTok) — ЕДИНЫЙ источник для Stage, FrameAudit и
// самопроверки (feed.ts): сверху панель (~8 %), снизу подпись, ник и звук (~20 %), справа
// колонка кнопок (~12 %) — в нижней половине кадра. Раньше Stage считал низ 13 %, а лента —
// 20 %: страховка пропускала адрес и призыв, которые закрывает подпись ролика.
export const FEED_UI = { top: 0.08, bottom: 0.2, side: 0.055, right: 0.12 } as const;
// Колонка кнопок справа: текст в ней (в нижней половине кадра) закрыт интерфейсом.
export const feedRightColumn = (W: number, H: number): Box => ({ x: Math.round(W * (1 - FEED_UI.right)), y: Math.round(H * 0.5), w: Math.round(W * FEED_UI.right), h: Math.round(H * 0.5) });

// Поля по умолчанию: доли кадра. Вертикаль — интерфейс ленты (FEED_UI); фон, мир и тело героя
// могут уходить в поля и за край, текст и важная деталь — нет.
export const defaultMargins = (W: number, H: number): Margins => {
  const vertical = H / W > 1.3;
  return vertical
    ? { top: Math.round(H * FEED_UI.top), bottom: Math.round(H * FEED_UI.bottom), left: Math.round(W * FEED_UI.side), right: Math.round(W * FEED_UI.side) }
    : { top: Math.round(H * 0.05), bottom: Math.round(H * 0.06), left: Math.round(W * 0.04), right: Math.round(W * 0.04) };
};

export const safeArea = (W: number, H: number, m: Margins = defaultMargins(W, H)): Box =>
  ({ x: m.left, y: m.top, w: W - m.left - m.right, h: H - m.top - m.bottom });

export const insideBox = (outer: Box, inner: Box, eps = 0.5) =>
  inner.x >= outer.x - eps && inner.y >= outer.y - eps &&
  inner.x + inner.w <= outer.x + outer.w + eps && inner.y + inner.h <= outer.y + outer.h + eps;

// На сколько пикселей коробка вылезает из зоны (0 — внутри).
export const overflowPx = (area: Box, b: Box) => Math.max(0,
  area.x - b.x, area.y - b.y, b.x + b.w - (area.x + area.w), b.y + b.h - (area.y + area.h));

// Сдвинуть коробку внутрь зоны; если она больше зоны — уменьшить вокруг центра.
export const clampInto = (b: Box, area: Box): Box => {
  const k = Math.min(1, area.w / b.w, area.h / b.h);
  const w = b.w * k, h = b.h * k;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  let x = cx - w / 2, y = cy - h / 2;
  x = Math.min(Math.max(x, area.x), area.x + area.w - w);
  y = Math.min(Math.max(y, area.y), area.y + area.h - h);
  return { x, y, w, h };
};

// Сколько кадра НЕ покрыто коробкой (px по худшему краю). 0 — покрывает целиком.
export const coverGapPx = (W: number, H: number, b: Box) =>
  Math.max(0, b.x, b.y, W - (b.x + b.w), H - (b.y + b.h));

// Растянуть/сдвинуть коробку, чтобы она покрывала кадр (для фонов).
export const forceCover = (W: number, H: number, b: Box): Box => {
  const k = Math.max(1, W / b.w, H / b.h);
  let w = b.w * k, h = b.h * k;
  let x = b.x + b.w / 2 - w / 2, y = b.y + b.h / 2 - h / 2;
  x = Math.min(0, Math.max(x, W - w));
  y = Math.min(0, Math.max(y, H - h));
  return { x, y, w, h };
};

// ---------- картинки ----------
// Картинка imgW×imgH, покрывающая кадр W×H. zoom ≥ 1 поверх cover; pan ∈ [-1, 1] —
// доля доступного запаса (−1 — виден левый/верхний край картинки, 1 — правый/нижний).
// Гарантия: результат всегда покрывает кадр, при любых pan и zoom.
export const coverRect = (imgW: number, imgH: number, W: number, H: number, zoom = 1, panX = 0, panY = 0): Box => {
  const s = Math.max(W / imgW, H / imgH) * Math.max(1, zoom);
  const w = imgW * s, h = imgH * s;
  const cx = Math.max(-1, Math.min(1, panX)), cy = Math.max(-1, Math.min(1, panY));
  return { x: -((w - W) / 2) * (1 + cx), y: -((h - H) / 2) * (1 + cy), w, h };
};

// Картинка целиком внутри области (letterbox), по центру или с выравниванием align ∈ [-1, 1].
export const containRect = (imgW: number, imgH: number, area: Box, alignX = 0, alignY = 0): Box => {
  const s = Math.min(area.w / imgW, area.h / imgH);
  const w = imgW * s, h = imgH * s;
  return { x: area.x + ((area.w - w) / 2) * (1 + alignX), y: area.y + ((area.h - h) / 2) * (1 + alignY), w, h };
};

export type KenBurnsKey = { zoom?: number; panX?: number; panY?: number };
// Медленный наезд/панорама по картинке-фону между кадрами start и end (дальше держит).
// Значения по умолчанию — нейтральные (zoom 1.06, без сдвига); темп и направление выбирает
// директор. Безопасность — от coverRect.
export const kenBurns = (
  frame: number,
  o: { imgW: number; imgH: number; W: number; H: number; start: number; end: number; from?: KenBurnsKey; to?: KenBurnsKey; ease?: (t: number) => number },
): Box => {
  const t0 = o.end > o.start ? Math.min(1, Math.max(0, (frame - o.start) / (o.end - o.start))) : 1;
  const t = (o.ease ?? smooth)(t0);
  const a = { zoom: 1.06, panX: 0, panY: 0, ...o.from };
  const b = { ...a, ...o.to };
  const lerp = (p: number, q: number) => p + (q - p) * t;
  return coverRect(o.imgW, o.imgH, o.W, o.H, lerp(a.zoom, b.zoom), lerp(a.panX, b.panX), lerp(a.panY, b.panY));
};

const smooth = (t: number) => t * t * (3 - 2 * t);

// ---------- проверка и лог ----------
export type GuardMode = "inside" | "cover";
export type GuardResult = { box: Box; ok: boolean; amount: number };

export const reportGuard = (v: { id: string; kind: string; frame: number; amount: number; detail?: unknown }) => {
  // eslint-disable-next-line no-console
  console.warn(GUARD_TAG + JSON.stringify({ ...v, amount: Math.round(v.amount * 10) / 10 }));
};

// Чистая проверка (без React): mode "inside" — коробка внутри area; "cover" — покрывает кадр.
// fix=true возвращает исправленную коробку (сдвиг внутрь / растяжение до cover).
export const guardBox = (
  id: string, frame: number, box: Box,
  o: { mode?: GuardMode; area: Box; W: number; H: number; fix?: boolean; tolerancePx?: number; silent?: boolean },
): GuardResult => {
  const mode = o.mode ?? "inside";
  const tol = o.tolerancePx ?? 1;
  if (mode === "cover") {
    const gap = coverGapPx(o.W, o.H, box);
    const ok = gap <= tol;
    if (!ok && !o.silent) reportGuard({ id, kind: "cover-gap", frame, amount: gap, detail: { box: rnd(box) } });
    return { box: ok || o.fix === false ? box : forceCover(o.W, o.H, box), ok, amount: gap };
  }
  const over = overflowPx(o.area, box);
  const ok = over <= tol;
  if (!ok && !o.silent) reportGuard({ id, kind: "outside-safe", frame, amount: over, detail: { box: rnd(box), area: rnd(o.area) } });
  return { box: ok || o.fix === false ? box : clampInto(box, o.area), ok, amount: over };
};

// Подпись/текст: кегль ≥ minFrac·H (по умолчанию 3.5 % высоты кадра) и контраст ≥ 4.5,
// если фон известен. Цвета — любой CSS (#hex с альфой, rgba(), hsl()); полупрозрачный фон
// (плашка с альфой) проверяется по худшему случаю — поверх чёрного и белого, либо поверх
// backdrop, если он известен. Это ЗАЯВЛЕННЫЙ фон: самопроверка (review.ts) отдельно меряет
// контраст по пикселям готового кадра — заявленный фон не всегда то, что под текстом.
// Возвращает список проблем (пустой — всё хорошо) и пишет их в лог.
export const textCheck = (
  id: string, frame: number,
  o: { fontSizePx: number; H: number; color?: string; background?: string; backdrop?: string; minFrac?: number; minContrast?: number; words?: number; maxWords?: number; silent?: boolean },
): string[] => {
  const issues: string[] = [];
  const min = (o.minFrac ?? 0.035) * o.H;
  if (o.fontSizePx < min) issues.push(`caption-small:${Math.round(o.fontSizePx)}<${Math.round(min)}`);
  if (o.color && o.background) {
    const c = contrastOver(o.color, o.background, o.backdrop);
    if (c < (o.minContrast ?? 4.5)) issues.push(`caption-contrast:${c.toFixed(2)}`);
  }
  if (o.words !== undefined && o.words > (o.maxWords ?? 7)) issues.push(`caption-words:${o.words}`);
  if (!o.silent) for (const k of issues) reportGuard({ id, kind: k.split(":")[0], frame, amount: Number(k.split(":")[1]?.split("<")[0]) || 1, detail: k });
  return issues;
};

const rnd = (b: Box): Box => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) });
