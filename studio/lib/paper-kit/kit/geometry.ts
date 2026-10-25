// Геометрия кита — один источник для рисования и для раскладки.
//
// Кукла, детали, декорации и подпись рисуются по числам из этого файла, и те же числа
// отдаются плану (timeline/: камера кадрирует лицо по faceBox, страховка раздвигает
// детали по itemBox, подпись не перекрывается по captionRect). Раньше размеры жили дважды —
// в отрисовке и отдельно в «примерном» box() — и расходились (карточка 560 и 280, формула
// 760 и 380).
//
// Здесь только форма рисунка (как устроены кукла, ценник, табло) — это «риг» кита, а не
// вкус. Никаких решений «когда и как появиться» здесь нет. Файл чистый, без React: его
// читает и браузер, и node (компиляция плана, тесты).
//
// Координаты: пиксели кадра 1080×1920. Рамка детали — относительно её точки (0,0),
// рамка куклы — относительно точки между ступнями.
import type { CutoutEl, ItemEl, Point, Rect, Style } from "../timeline/types";
import FONT_METRICS from "../data/fontMetrics.json";

// ---------- КАДР ----------
export const W = 1080;
export const H = 1920;
// Линия земли рига: на ней стоят ступни кукол во встроенных декорациях.
export const GROUND = 1450;

// ---------- РАМКИ ----------
export const rect = (x0: number, y0: number, x1: number, y1: number): Rect => ({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
export const centered = (w: number, h: number): Rect => ({ x: -w / 2, y: -h / 2, w, h });
export const union = (...rs: Rect[]): Rect => {
  if (!rs.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rs) {
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
  }
  return rect(x0, y0, x1, y1);
};
export const shift = (r: Rect, dx: number, dy: number): Rect => ({ x: r.x + dx, y: r.y + dy, w: r.w, h: r.h });
export const scaleRect = (r: Rect, k: number): Rect => ({ x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k });
// Рамка прямоугольника, повёрнутого на deg градусов вокруг (0,0).
export const rotateRect = (r: Rect, deg: number): Rect => {
  if (!deg) return r;
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const pts: Point[] = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]
    .map(([x, y]) => ({ x: x * c - y * s, y: x * s + y * c }));
  return rect(Math.min(...pts.map((p) => p.x)), Math.min(...pts.map((p) => p.y)),
    Math.max(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.y)));
};
export const pad = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });
export const intersects = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
export const contains = (outer: Rect, inner: Rect): boolean =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
export const center = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

// ---------- ТЕКСТ ----------
// Ширины символов — из самих файлов шрифтов (scripts/font-metrics.ts), поэтому node меряет
// так же, как браузер рисует. Кернинг не учитывается (для моноширинного шрифта это точно).
type FaceMetrics = { upm: number; asc: number; desc: number; missing: number; adv: Record<string, number> };
const FACES_RAW = FONT_METRICS.faces as Record<string, FaceMetrics>;
export const FONT = {
  mono: "jetbrains-mono:700",
  monoRegular: "jetbrains-mono:500",
  display: "oswald:600",
  displayBold: "oswald:700",
  heavy: "manrope:800",
} as const;
export type FaceKey = (typeof FONT)[keyof typeof FONT];
// Символа нет в шрифте — браузер возьмёт запасной; меряем средней шириной этого шрифта.
const AVG: Record<string, number> = Object.fromEntries(Object.entries(FACES_RAW).map(([k, f]) => {
  const v = Object.values(f.adv);
  return [k, v.reduce((a, b) => a + b, 0) / Math.max(1, v.length)];
}));
export const textWidth = (text: string, face: FaceKey, size: number, letterSpacing = 0): number => {
  const f = FACES_RAW[face];
  let u = 0;
  let n = 0;
  for (const ch of text) { u += f.adv[ch] ?? AVG[face]; n++; }
  return (u / f.upm) * size + letterSpacing * n;
};
// Высота строки шрифта (ascender − descender) при размере size.
export const lineHeight = (face: FaceKey, size: number): number => {
  const f = FACES_RAW[face];
  return ((f.asc - f.desc) / f.upm) * size;
};
// Ширина строки как функция размера шрифта: так её принимают раскладки ниже.
export type TextMeasure = (size: number) => number;
export const measured = (text: string, face: FaceKey, letterSpacing = 0): TextMeasure =>
  (size) => textWidth(text, face, size, letterSpacing);
// Регистр из style.case (нет = как написано).
export const applyCase = (text: string, c: Style["case"] | undefined): string =>
  c === "upper" ? text.toUpperCase()
  : c === "sentence" ? text.charAt(0).toUpperCase() + text.slice(1)
  : text;
// Размер шрифта, при котором строка шириной measure(size) влезает в maxW (не больше want).
// Ширина строки линейна по размеру: measure(s) = a·s + b (b — межбуквенные отступы).
export const fitSize = (measure: TextMeasure, want: number, maxW: number): number => {
  const b = measure(0);
  const a = measure(1) - b;
  return Math.min(want, (maxW - b) / Math.max(1, a));
};

// ---------- КУКЛА ----------
// Риг бумажной куклы в её собственных координатах (масштаб 1, начало — между ступнями,
// y вверх отрицательный). По этим числам кукла рисуется (Puppet.tsx) и по ним же план
// считает лицо, руки, макушку.
export const RIG = {
  shoulder: { x: 72, y: -470 },
  arm: 175,          // длина руки
  hand: 15,          // радиус кисти
  limb: 10,          // толщина руки
  head: { y: -585, r: 62 },
  body: { w: 158, h: 270, top: -505 },
  hip: { x: 30, y: -240 },
  leg: { len: 234, endDx: 4, width: 11 },
  foot: { y: 236, dx: 8, rx: 18, ry: 8 },
  shadow: { rx: 90, ry: 12, cy: 2 },
} as const;

// Кисть руки: side −1 — левая рука (на экране слева), +1 — правая; deg — угол от вертикали
// вниз, наружу плюс. Та же формула рисует руку.
export const armEnd = (side: -1 | 1, deg: number): Point => {
  const a = (deg * Math.PI) / 180;
  return { x: side * RIG.shoulder.x + side * Math.sin(a) * RIG.arm, y: RIG.shoulder.y + Math.cos(a) * RIG.arm };
};

export type Rig = {
  scale: number;
  headTop: number;                                   // y макушки
  faceBox: Rect;                                     // голова-кружок
  bodyBox: Rect;                                     // тело-бумажка
  feetBox: Rect;                                     // ступни
  handPos: (deg: number, side: -1 | 1) => Point;     // центр кисти
  handsBox: (left: number, right: number) => Rect;   // обе кисти при этих углах рук
  allBox: (left: number, right: number) => Rect;     // вся кукла при этих углах рук
};

export const rig = (scale: number): Rig => {
  const s = (r: Rect) => scaleRect(r, scale);
  const { head, body, hip, leg, foot, shadow, hand } = RIG;
  const faceBox = s(rect(-head.r, head.y - head.r, head.r, head.y + head.r));
  const bodyBox = s(rect(-body.w / 2, body.top, body.w / 2, body.top + body.h));
  const feetX = hip.x + leg.endDx + foot.dx + foot.rx;
  const feetBox = s(rect(-feetX, hip.y + foot.y - foot.ry, feetX, hip.y + foot.y + foot.ry));
  const shadowBox = s(rect(-shadow.rx, shadow.cy - shadow.ry, shadow.rx, shadow.cy + shadow.ry));
  const handPos = (deg: number, side: -1 | 1): Point => {
    const p = armEnd(side, deg);
    return { x: p.x * scale, y: p.y * scale };
  };
  const handBox = (deg: number, side: -1 | 1): Rect => {
    const p = handPos(deg, side);
    const r = (hand + 1.5) * scale;
    return rect(p.x - r, p.y - r, p.x + r, p.y + r);
  };
  const handsBox = (left: number, right: number) => union(handBox(left, -1), handBox(right, 1));
  return {
    scale,
    headTop: (head.y - head.r) * scale,
    faceBox, bodyBox, feetBox, handPos, handsBox,
    allBox: (left, right) => union(faceBox, bodyBox, feetBox, shadowBox, handsBox(left, right)),
  };
};

// Поза рук для жеста — словарь поз кукол (углы [левая, правая] при взгляде вправо; при
// взгляде влево руки меняются местами). Это форма позы, а не анимация: покачивания и
// маханья рисует кукла.
export const GESTURE_ARMS = {
  idle: [14, 14], wave: [14, 150], point: [12, 92], hold: [14, 62], shrug: [64, 64], cheer: [150, 150],
} as const satisfies Record<string, readonly [number, number]>;
export const gestureArms = (g: keyof typeof GESTURE_ARMS | undefined, facing: 1 | -1 | 0): [number, number] => {
  const [l, r] = GESTURE_ARMS[g ?? "idle"];
  return facing === -1 ? [r, l] : [l, r];
};
// Длина шага куклы: шаг — длина ноги. Шаги ходьбы считаются от пройденного пути (страховка
// «ноги не скользят»), а не от постоянной частоты.
export const strideLen = (scale: number) => RIG.leg.len * scale;
// Размах ног на шаге — геометрия рига, а не вкус: шаг длиной в ногу разводит ступни на
// длину ноги, то есть каждая нога отходит от вертикали на asin(1/2) = 30°.
export const WALK_LEG_DEG = (Math.asin(0.5) * 180) / Math.PI;
// Словарь походок gait.style (как позы жестов — форма, а не время): наклон корпуса на ходу,
// градусы (+ вперёд). Перечислить в полевом руководстве партитуры.
export type GaitStyle = "stroll" | "walk" | "run" | "tiptoe";
export const GAIT_LOOK: Record<GaitStyle, { lean: number }> = {
  stroll: { lean: 0 }, walk: { lean: 0 }, run: { lean: 8 }, tiptoe: { lean: -3 },
};
// Единица живости куклы (energy = 1): дыхание, покачивание знака на голове, моргание и кивок
// при речи — как у стоящей куклы (те же амплитуды; периоды переведены в секунды при
// 30 кадрах). energy 0 (нет поля) — кукла стоит, не дышит и не моргает; 2 — вдвое живее.
export const ENERGY_UNIT = {
  breathe: { amp: 0.012, period: (2 * Math.PI * 18) / 30 },   // доля роста тела, секунды
  sway: { amp: 0.7, period: (2 * Math.PI * 7) / 30 },          // градусы качания знака
  blink: { period: 110 / 30, dur: 4 / 30 },                     // секунды
  nod: 3,                                                       // px рига кивка на полную громкость
} as const;

// Слои глубины диорамы (дальний фон, средний план, герои). Множитель слоя в партитуре 0.4 —
// 1 − (1 − DEPTH)·parallax: parallax 0 — плоская картинка, 1 — эти глубины.
export const DEPTH = { far: 0.35, mid: 0.75, near: 1 } as const;

// ---------- ДЕТАЛИ ----------
// Каждая функция — раскладка одной детали: её рисует Items.tsx, её же меряет itemBox.
// Входы — то, что зависит от текста (ширина строки как функция размера шрифта): так можно
// подставить настоящий замер по шрифту.

// Ценник: шрифт уменьшается, пока строка не влезет в TAG.fit.
export const TAG = { size: 40, fit: 850, minW: 120, padX: 50, padY: 34, letterSpacing: 1 } as const;
export const tagGeom = (measure: TextMeasure, want: number) => {
  const size = fitSize(measure, want, TAG.fit);
  const w = Math.max(TAG.minW, measure(size) + TAG.padX);
  const h = size + TAG.padY;
  return { size, w, h, box: centered(w, h) };
};

// Штамп: двойная рамка вокруг строки.
export const STAMP = { size: 96, padX: 70, padY: 50, letterSpacing: 6 } as const;
export const stampGeom = (measure: TextMeasure, want: number, fit?: number) => {
  const size = fit === undefined ? want : fitSize(measure, want, fit - STAMP.padX);
  const w = measure(size) + STAMP.padX;
  const h = size + STAMP.padY;
  return { size, w, h, box: centered(w, h) };
};

// Табло: экран под число, сверху — плашка подписи, справа — стрелка тренда.
export const COUNTER = { minW: 220, padX: 80, digits: 72, screenH: 112, label: { y: -108, h: 44 }, arrow: { dx: 14, w: 36, y0: -6, y1: 24 } } as const;
export const counterGeom = (textW: number, label: boolean, trend: boolean) => {
  const w = Math.max(COUNTER.minW, textW + COUNTER.padX);
  const x1 = trend ? w / 2 + COUNTER.arrow.dx + COUNTER.arrow.w : w / 2;
  const y0 = label ? COUNTER.label.y : -COUNTER.screenH / 2;
  return { w, box: rect(-w / 2, y0, x1, COUNTER.screenH / 2) };
};

// Карточка с гвоздиками: заголовок и строки.
export const CARD = {
  w: 560, titleH: 90, noTitleH: 30, lineH: 52, padBottom: 30,
  // Текст на карточке: заголовок (кегль, базовая линия), строки (кегль, первая базовая линия
  // с заголовком и без), поля слева/справа. Шрифт ужимается, если строка не влезает.
  title: { size: 48, y: 74 }, line: { size: 30, y: 140, yNoTitle: 76 }, padX: 44, pin: { dx: 30, y: 24 },
} as const;
export const cardGeom = (hasTitle: boolean, lines: number, w: number = CARD.w) => {
  const h = (hasTitle ? CARD.titleH : CARD.noTitleH) + lines * CARD.lineH + CARD.padBottom;
  return { w, h, box: centered(w, h) };
};

// График на листе.
export const CHART = {
  w: 880, h: 520, pad: 60, plotTop: 130, plotH: 200,
  // Ось — над нижним краем; кривая и метки — в поле рисунка; линия толщиной stroke.
  axisY: 70, stroke: 9, title: { x: 40, y: 40, size: 36, h: 50, padX: 15 }, mark: { dy: 52, size: 28 },
  // Значения points ложатся в эту долю высоты поля (сверху и снизу — поля под метки).
  span: [0.14, 0.86],
} as const;
export const chartGeom = () => ({ w: CHART.w, h: CHART.h, box: centered(CHART.w, CHART.h) });

// Листок календаря (кольца торчат над листом).
export const CALENDAR = { w: 230, h: 250, ring: 10, band: 64, top: { size: 26, y: 44 }, text: { size: 64, y: 170 }, padX: 20, ringDx: 60 } as const;
export const calendarGeom = () => ({
  w: CALENDAR.w, h: CALENDAR.h,
  box: rect(-CALENDAR.w / 2, -CALENDAR.h / 2 - CALENDAR.ring, CALENDAR.w / 2, CALENDAR.h / 2),
});

// Столбики-чеки: высота по значению, над столбиком — число, под ним — подпись.
export const COMPARE = { scale: 1.25, H0: 520, minH: 60, gap: 280, barW: 180, valueY: 40, labelY: 46, valueSize: 40, labelSize: 28 } as const;
export const compareGeom = (bars: Array<{ value: number; valueW: number; labelW: number }>) => {
  const max = Math.max(...bars.map((b) => b.value), 1);
  const n = bars.length;
  const xs = bars.map((_, i) => (i - (n - 1) / 2) * COMPARE.gap);
  const heights = bars.map((b) => Math.max(COMPARE.minH, (b.value / max) * COMPARE.H0));
  const valueH = COMPARE.valueSize + TAG.padY, labelH = COMPARE.labelSize + TAG.padY;
  const parts = bars.map((b, i) => union(
    rect(xs[i] - COMPARE.barW / 2, -heights[i], xs[i] + COMPARE.barW / 2, 0),
    rect(xs[i] - b.valueW / 2, -heights[i] - COMPARE.valueY - valueH / 2, xs[i] + b.valueW / 2, -heights[i] - COMPARE.valueY + valueH / 2),
    rect(xs[i] - b.labelW / 2, COMPARE.labelY - labelH / 2, xs[i] + b.labelW / 2, COMPARE.labelY + labelH / 2),
  ));
  // Рисунок: scale(1.25) translate(0, H0/2).
  const box = scaleRect(shift(union(...parts), 0, COMPARE.H0 / 2), COMPARE.scale);
  return { max, xs, heights, box };
};

// Чек-формула: шапка, строки, штрихкод.
export const FORMULA = { w: 760, top: 150, lineH: 120, size: 92, padX: 40, header: { y: 52, size: 22 }, barcode: { dy: 70, h: 34, n: 34, step: 10 } } as const;
export const formulaGeom = (lines: number) => {
  const h = FORMULA.top + lines * FORMULA.lineH;
  return { w: FORMULA.w, h, box: centered(FORMULA.w, h) };
};

// Заголовок из вырезанных букв: слова собираются в строки до 10 знаков, кегль — чтобы
// самая длинная строка влезла в TITLE.fit.
export const TITLE = { maxSize: 118, fit: 940, lineK: 1.18, lineChars: 10, sub: { y: 50, size: 30 } } as const;
export const ransomGeom = (text: string) => {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last !== undefined && (last + " " + w).length <= TITLE.lineChars) lines[lines.length - 1] = last + " " + w;
    else lines.push(w);
  }
  const longest = Math.max(...lines.map((l) => l.length));
  const size = Math.min(TITLE.maxSize, TITLE.fit / longest);
  const totalH = lines.length * size * TITLE.lineK;
  return { lines, longest, size, totalH, box: centered(longest * size, totalH) };
};

// Вырезка: картинка вписана в квадрат side×side, подпись-ценник под ней.
export const CUTOUT = { side: { s: 300, m: 460, l: 680 }, labelGap: 10, labelSize: 30 } as const;
export const fitImage = (side: number, dims?: { w: number; h: number }): [number, number] => {
  const d = dims ?? { w: 1, h: 1 };
  const k = side / Math.max(d.w, d.h);
  return [d.w * k, d.h * k];
};

// Значки предметов (PropIcon в Items.tsx): рамка каждого рисунка в его координатах.
// Сверяется с самими рисунками тестом tests/geometry.test.ts.
export const PROP = { scale: 1.5, gap: 200, stack: 100, scatterCols: 4 } as const;
export const PROP_BOX: Record<string, Rect> = {
  coin: rect(-46, -46, 52, 46),
  coins: rect(-51.5, -41.5, 51.5, 47.5),
  fish: rect(-70, -30, 76, 30),
  boat: rect(-110, -150, 110, 50),
  house: rect(-90, -130, 90, 50),
  bank: rect(-120, -120, 120, 68),
  car: rect(-110, -60, 110, 64),
  crown: rect(-72, -52, 72, 32),
  question: rect(-70, -111, 70, 110),   // знак «?» Manrope 800, 300 px: рамка глифа
  bulb: rect(-60, -90, 60, 62),
  cross: rect(-123, -123, 123, 123),
  heart: rect(-53, -52, 53, 40),
  "arrow-up": rect(-60, -100, 60, 90),
  "arrow-down": rect(-60, -90, 60, 100),
  chest: rect(-82, -52, 82, 52),
};
// Незнакомый предмет рисуется рваным кружком r=40 от (0,0) вправо-вниз.
export const PROP_FALLBACK_BOX = rect(-1.5, -1.5, 81.5, 81.5);
export const propBox = (name: string): Rect => PROP_BOX[name] ?? PROP_FALLBACK_BOX;
// Где лежат центры значков ряда / стопки / россыпи из count штук (относительно точки
// детали). Ряд — шаг PROP.gap. Россыпь занимает прямоугольник, а сами точки
// внутри него рисующий код берёт из сида серии (file_plan 12).
export const propSpread = (count: number, arrange: "row" | "stack" | "scatter"): Rect => {
  const n = Math.max(1, count);
  if (arrange === "stack") return centered(0, (n - 1) * PROP.stack);
  if (arrange === "scatter") return centered(PROP.gap * Math.min(n, PROP.scatterCols), n > 1 ? PROP.gap : 0);
  return centered((n - 1) * PROP.gap, 0);
};

// ---------- itemBox: рамка детали 0.4 ----------
// Рамка детали относительно её точки, с учётом element.scale и element.rotate. Размеры
// по умолчанию — родной размер рисунка кита (как «масштаб 1» у куклы), size из партитуры
// его заменяет: у текстовых деталей size — кегль в долях ширины кадра, у вырезки и
// предмета — длинная сторона в долях ширины кадра.
// dims — пиксели исходной картинки вырезки (если есть); style — для регистра текста.
export const itemBox = (el: ItemEl, dims?: { w: number; h: number }, style?: Pick<Style, "case">): Rect => {
  const cased = (s: string) => applyCase(s, style?.case);
  const px = (size: number | undefined, native: number) => (size === undefined ? native : size * W);
  let box: Rect;
  switch (el.type) {
    case "tag":
      box = tagGeom(measured(cased(el.text), FONT.display, TAG.letterSpacing), px(el.size, TAG.size)).box;
      break;
    case "stamp":
      box = stampGeom(measured(cased(el.text), FONT.displayBold, STAMP.letterSpacing), px(el.size, STAMP.size), W).box;
      break;
    case "counter": {
      const text = `${el.prefix ?? ""}${el.value.toLocaleString("ru-RU")}${el.unit ?? ""}`;
      const from = el.from ?? el.value;
      const trend = el.trend !== undefined && el.trend !== "none" && from !== el.value;
      box = counterGeom(textWidth(text, FONT.mono, COUNTER.digits), !!el.label, trend).box;
      break;
    }
    case "card": {
      const w = el.width === undefined ? CARD.w : el.width * W;
      box = cardGeom(!!el.title, el.lines.length, w).box;
      break;
    }
    case "chart":
      box = chartGeom().box;
      break;
    case "calendar":
      box = calendarGeom().box;
      break;
    case "compare": {
      const tagW = (text: string, size: number) => tagGeom(measured(cased(text), FONT.display, TAG.letterSpacing), size).w;
      box = compareGeom(el.bars.map((b) => ({
        value: b.value,
        valueW: tagW(b.value.toLocaleString("ru-RU"), COMPARE.valueSize),
        labelW: tagW(b.label, COMPARE.labelSize),
      }))).box;
      break;
    }
    case "formula":
      box = formulaGeom(el.lines.length).box;
      break;
    case "title": {
      const lines = el.lines?.length ? el.lines : el.text ? [el.text] : [""];
      const size = px(el.size, TITLE.maxSize);
      if (el.look === "ransom") {
        const g = ransomGeom(cased(lines.join(" ")));
        const k = el.size === undefined ? 1 : size / g.size;
        box = scaleRect(g.box, k);
      } else {
        const widths = lines.map((l) => textWidth(cased(l), FONT.displayBold, size));
        const h = lines.length * size * TITLE.lineK;
        box = centered(Math.max(...widths), h);
      }
      if (el.sub) {
        const sub = tagGeom(measured(cased(el.sub), FONT.display, TAG.letterSpacing), TITLE.sub.size);
        box = union(box, shift(sub.box, 0, box.y + box.h + TITLE.sub.y));
      }
      break;
    }
    case "cutout":
      box = cutoutBox(el, dims, cased);
      break;
    case "prop": {
      const icon = propBox(el.name);
      const k = el.size === undefined ? PROP.scale : (el.size * W) / Math.max(icon.w, icon.h);
      const one = scaleRect(icon, k);
      const spread = propSpread(el.count ?? 1, el.arrange ?? "row");
      box = rect(spread.x + one.x, spread.y + one.y, spread.x + spread.w + one.x + one.w, spread.y + spread.h + one.y + one.h);
      break;
    }
  }
  return rotateRect(scaleRect(box, el.scale ?? 1), el.rotate ?? 0);
};

const cutoutBox = (el: CutoutEl, dims: { w: number; h: number } | undefined, cased: (s: string) => string): Rect => {
  const side = el.size === undefined ? CUTOUT.side.m : el.size * W;
  const [w, h] = fitImage(side, dims);
  let box = centered(w, h);
  if (el.label) {
    const t = tagGeom(measured(cased(el.label), FONT.display, TAG.letterSpacing), CUTOUT.labelSize);
    box = union(box, shift(t.box, 0, h / 2 + CUTOUT.labelGap));
  }
  return box;
};

// ---------- ДЕКОРАЦИИ ----------
// Встроенные декорации нарисованы под BASE и опущены на SET_DY до линии земли.
export const SET_BASE = 1320;
export const SET_DY = GROUND - SET_BASE;
// Лавка: стойки, вывеска, полосатый навес и прилавок перед героями.
export const STALL = {
  x0: 60, x1: 500, stripes: 9,
  sign: { inset: 20, y: 470, h: 80, text: { y: 526, size: 46, letterSpacing: 3 } },
  awning: { y: 560, y1: 640, wave: 680, waveAmp: 7 },
  posts: { y: 600, w: 14, inset: 10 },
  front: { x: 60, y: 1010, w: 400, top: 1000, bar: 16, text: { x: 260, y: 1190, size: 30 } },
} as const;

export type Obstacle = { id: string; rect: Rect; kind: "text" | "solid"; layer: "mid" | "front" };
// Что в декорации нельзя закрывать деталями (вывеска) и что стоит перед героями. ground —
// линия пола сцены (px): встроенная декорация 0.4 опускается/поднимается вместе с ней.
export const obstacles = (set: string, ground: number = GROUND): Obstacle[] => {
  if (set !== "stall") return [];
  const s = STALL;
  const dy = SET_DY + (ground - GROUND);
  return [
    { id: "stall-sign", kind: "text", layer: "mid",
      rect: rect(s.x0, s.sign.y + dy, s.x1, s.awning.wave + s.awning.waveAmp + dy) },
    { id: "stall-counter", kind: "solid", layer: "front",
      rect: rect(s.front.x, s.front.y + dy, s.front.x + s.front.w, s.front.y + (SET_BASE - s.front.top) + dy) },
  ];
};

// Задник должен закрывать кадр с запасом overscan по каждому краю (камера ездит, трясётся,
// приближает) — иначе виден край декорации.
export const backdropRect = (overscan: number): Rect => rect(-overscan, -overscan, W + overscan, H + overscan);
// Картинка-фон с пропорциями aspect = w/h, растянутая «с обрезкой» на backdropRect.
export const backdropImageRect = (overscan: number, aspect: number): Rect => {
  const r = backdropRect(overscan);
  const k = Math.max(r.w / aspect, r.h);
  const w = k * aspect, h = k;
  return { x: W / 2 - w / 2, y: H / 2 - h / 2, w, h };
};

// ---------- ПОДПИСЬ ----------
// Подпись — бумажная полоска с текстом по строкам. fits решает, влезает ли строка;
// measure — ширина строки текста. Раскладку рисует Caption.tsx, рамку берёт план.
export type CaptionLayoutOpts = {
  size: number;                         // кегль, px
  fits: (line: string) => boolean;      // строка ещё влезает
  measure: (line: string) => number;    // ширина строки, px
  lineGap: number; padX: number; padY: number;
};
export const captionLayout = (text: string, o: CaptionLayoutOpts) => {
  const tokens = text.split(/\s+/).filter(Boolean);
  const lines: string[][] = [[]];
  for (const tok of tokens) {
    const cur = lines[lines.length - 1];
    if (cur.length && !o.fits([...cur, tok].join(" "))) lines.push([tok]);
    else cur.push(tok);
  }
  const textW = Math.max(...lines.map((l) => o.measure(l.join(" "))));
  const w = textW + 2 * o.padX;
  const h = lines.length * (o.size + o.lineGap) + o.padY;
  return { tokens, lines, textW, w, h };
};

// Страховка читаемости (rails, не вкус): кегль подписи не меньше CAPTION_MIN_PX на кадре
// 1080 px, и подпись не заходит в зоны интерфейса площадок (шапка сверху, подписи
// и кнопки снизу, отступы по бокам).
export const CAPTION_MIN_PX = 40;
export const SAFE = { top: 150, bottom: 384, side: 60 } as const;
export const CAPTION_BOX = { lineGap: 14, padX: 30, padY: 30 } as const;

// Подпись 0.4 с уже выбранными параметрами (что значит пропущенное поле, решает компиляция).
export type CaptionGeom = { size: number /* px */; position: "top" | "bottom" | Point; look: "strip" | "plain" };
// Страница подписи: строки, рамка и номера токенов [с, до) во всём тексте.
export type CaptionPage = { lines: string[][]; rect: Rect; tokens: [number, number] };
export type CaptionFit = {
  size: number; lines: string[][]; rect: Rect;          // rect — рамка всех страниц вместе
  pages: CaptionPage[];                                  // одна, если всё влезло
  shrunk?: { from: number; to: number };                 // кегль уменьшен, чтобы влезть по высоте
  broken: string[];                                      // слова шире строки, разбитые по буквам
};
// Страховка «подпись в безопасной зоне» (rails, не вкус): строки переносятся; слово шире
// строки разбивается по буквам; не влезает по высоте — кегль уменьшается к CAPTION_MIN_PX;
// не влезает и на нём — подпись идёт страницами (какая страница когда — по словам голоса,
// решает компиляция). Рамка каждой страницы — внутри безопасной зоны.
export const captionRect = (text: string, spec: CaptionGeom): CaptionFit => {
  const want = Math.max(CAPTION_MIN_PX, spec.size);
  const maxW = W - 2 * SAFE.side;
  const maxText = maxW - 2 * CAPTION_BOX.padX;
  const maxH = H - SAFE.top - SAFE.bottom;
  const layAt = (size: number) => {
    const measure = (line: string) => textWidth(line, FONT.mono, size);
    const broken: string[] = [];
    const toks: string[] = [];
    for (const tok of text.split(/\s+/).filter(Boolean)) {
      if (measure(tok) <= maxText) { toks.push(tok); continue; }
      broken.push(tok);
      let cur = "";
      for (const ch of Array.from(tok)) {
        if (cur && measure(cur + ch) > maxText) { toks.push(cur); cur = ch; } else cur += ch;
      }
      if (cur) toks.push(cur);
    }
    const lay = captionLayout(toks.join(" "), { size, fits: (l) => measure(l) <= maxText, measure, ...CAPTION_BOX });
    return { lay, broken };
  };
  let size = want;
  let { lay, broken } = layAt(size);
  if (lay.h > maxH && size > CAPTION_MIN_PX) {
    // Самый крупный кегль (целый px), при котором влезает; не влезает и на минимуме — минимум.
    let lo = CAPTION_MIN_PX, hi = Math.floor(size);
    if (layAt(lo).lay.h > maxH) hi = lo;
    else {
      while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (layAt(mid).lay.h <= maxH) lo = mid; else hi = mid; }
      hi = layAt(hi).lay.h <= maxH ? hi : lo;
    }
    size = hi;
    ({ lay, broken } = layAt(size));
  }
  const place = (lines: string[][]): Rect => {
    const h = lines.length * (size + CAPTION_BOX.lineGap) + CAPTION_BOX.padY;
    const tw = Math.max(0, ...lines.map((l) => textWidth(l.join(" "), FONT.mono, size)));
    const w = Math.min(tw + 2 * CAPTION_BOX.padX, maxW);
    let x = W / 2 - w / 2;
    let y: number;
    if (spec.position === "top") y = SAFE.top;
    else if (spec.position === "bottom") y = H - SAFE.bottom - h;
    else {
      x = spec.position.x * W - w / 2;
      y = spec.position.y * H - h / 2;
    }
    // Подпись целиком в безопасной зоне.
    x = Math.min(W - SAFE.side - w, Math.max(SAFE.side, x));
    y = Math.max(SAFE.top, Math.min(H - SAFE.bottom - h, y));
    return { x, y, w, h };
  };
  // Страницы: по столько строк, сколько влезает по высоте.
  const perPage = Math.max(1, Math.floor((maxH - CAPTION_BOX.padY) / (size + CAPTION_BOX.lineGap)));
  const pages: CaptionPage[] = [];
  let tok = 0;
  for (let k = 0; k < lay.lines.length; k += perPage) {
    const lines = lay.lines.slice(k, k + perPage);
    const n = lines.reduce((a, l) => a + l.length, 0);
    pages.push({ lines, rect: place(lines), tokens: [tok, tok + n] });
    tok += n;
  }
  if (!pages.length) pages.push({ lines: lay.lines, rect: place(lay.lines), tokens: [0, 0] });
  const rect = pages.length === 1 ? pages[0].rect : union(...pages.map((p) => p.rect));
  return {
    size, lines: lay.lines, rect, pages, broken,
    ...(size < want ? { shrunk: { from: want, to: size } } : {}),
  };
};
