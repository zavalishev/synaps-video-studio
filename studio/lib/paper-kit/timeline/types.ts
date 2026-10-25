// Типы бумажного набора (studio/lib/paper-kit): палитра, движение, элементы кадра, словари поз
// и предметов. Достались от раннего движка «партитуры»; студия берёт отсюда только то, что нужно
// куклам, деталям и декорациям (@studio/paper-2d).
//
// ЕДИНИЦЫ: время — секунды; место — доля кадра (x 0..1 ширины, y 0..1 высоты);
// размер — доля ширины кадра; углы — градусы.
import { ANCHORS, GESTURES, MOODS, PROPS, SPOTS, VOICES } from "./vocab";

// ---------- СЛОВАРИ ----------
// Словари поз и предметов: набор умеет рисовать именно их.
export { ANCHORS, GESTURES, MOODS, PROPS, SPOTS, VOICES };
export type Mood = (typeof MOODS)[number];
export type Gesture = (typeof GESTURES)[number];
export type PropPreset = (typeof PROPS)[number];
export type Voice = (typeof VOICES)[number];
// Старые имена точек кадра («top», «upper-left»…, «left», «center»…) — только псевдонимы
// точки: особого смысла у них нет.
export type Anchor = (typeof ANCHORS)[number] | (typeof SPOTS)[number];
export const CHART_PRESETS = ["rise", "fall", "flat", "wave", "boom-bust", "long-wave"] as const;
export type ChartPreset = (typeof CHART_PRESETS)[number];
// Шрифты, которые лежат в public/fonts (кириллица): выбор шрифтов — фаза B.
export const FONT_IDS = ["oswald", "manrope", "jetbrains-mono"] as const;
export type FontId = (typeof FONT_IDS)[number];

// ---------- ВРЕМЯ ----------
//  1.2                секунды от начала сцены после pause.before (там, где начинается речь)
//  "start" | "end" | "end-0.4"
//  "деньги"           начало первого произнесённого слова, совпавшего по heard() 
//  "деньги#2"         n-е вхождение (зажимается к последнему существующему)
//  "деньги.end+0.15"  конец слова ± сдвиг (минус — картинка опережает голос)
//  "@coin.in" | "@coin.out" | "@pay.land" | "@cam:2"   событие другой дорожки ± сдвиг ("@id.in+0.2")
//  Неуслышанное слово -> ближайшее похожее -> начало сцены (пишется в fixes); цикл -> "start";
//  итог всегда зажат в [начало сцены, конец сцены].
export type Time = number | string;

export type Ease =
  | "linear" | "in" | "out" | "inOut" | "hold"
  | { bezier: [number, number, number, number] }
  | { spring: { bounce: number /* 0..0.9 */; dur?: number } };

// amount = доля 0..1 от «конверта безопасности», который движок считает по геометрии:
//   zoom: 1 = самый крупный план, при котором цель целиком в кадре, подпись не закрыта и
//         исходник картинки не растянут; shake: 1 = самая сильная тряска, которую прячет запас
//         кадра; дуга give: 1 = самая высокая вершина ниже подписи; react: 1 = самый высокий
//         прыжок, при котором голова ниже подписи.
export type Amount = { amount: number };

// ---------- ПРОСТРАНСТВО ----------
export type Point = { x: number; y: number };
export type Target =                                    // что кадрирует камера
  | "wide"
  | Point
  | { id: string; part?: "face" | "body" | "hands" | "feet" | "all" }
  | { ids: string[] };
export type Place =
  | Point
  | { on: string; part: "above" | "hand" | "feet" | "head"; dx?: number; dy?: number }  // едет вместе с героем
  | { near: string; side: "left" | "right" | "above" | "below"; gap?: number }
  | { between: [string, string] }
  | Anchor;

// ---------- ДВИЖЕНИЕ ----------
export type Sfx = {
  name: string;                 // id из каталога («pop3») или семейство («pop» — вариант выбирается сидом)
  volume?: number;              // 0..1
  offset?: number;              // секунды от своего события
  on?: "start" | "land" | "end" | "each";
};
export type Motion = {          // вход (from -> покой) или уход (покой -> to). Именованных сокращений нет.
  from?: "left" | "right" | "top" | "bottom"
    | "offscreen-left" | "offscreen-right" | "offscreen-top" | "offscreen-bottom"
    | { dx: number; dy: number };
  scale?: number; rotate?: number; opacity?: number;   // поза в начале входа / в конце ухода
  fade?: number;                                       // секунды нарастания прозрачности; 0/нет = сразу
  dur?: number;                                        // нет/0 = мгновенно (пишется в defaulted[])
  ease?: Ease; overshoot?: number;
  stagger?: number;                                    // буквы (title), строки (formula), столбцы (compare), частицы
  sfx?: Sfx | null;
};
export type Key = {             // свободный ключ дорожки элемента
  t: Time;
  to?: Place; scale?: number; rotate?: number; opacity?: number;
  move?: "cut" | { dur: number; ease?: Ease; path?: "line" | "arc"; arc?: number | Amount };   // arc: вершина дуги, доля высоты кадра (+ вверх)
  intent?: string;              // <= 120 символов, только для критика и сводки
};

// ---------- ЭЛЕМЕНТЫ ----------
// id: буквы, цифры, «_», «-». Знак «~» зарезервирован за id, которые движок создаёт сам
// (когда модель id не написала) — такие элементы между сценами не переносятся.
export type Shell = {
  id: string;                   // тот же id в следующей сцене = тот же элемент (без повторного входа)
  at?: Time; until?: Time;      // появление / начало ухода. Нет at = начало сцены; нет until = конец сцены
  place?: Place; scale?: number; rotate?: number; opacity?: number;
  layer?: "back" | "behind-actors" | "front" | "top";  // нет = "front"
  enter?: Motion; exit?: Motion; keys?: Key[];
  // нет = неподвижно. amp: sway — градусы, bob — пиксели кадра 1080, breathe — проценты масштаба; period — секунды.
  idle?: { kind: "sway" | "bob" | "breathe"; amp: number; period: number } | null;
  jitter?: number;              // множитель style.jitter для этого элемента
  overlap?: boolean; overCaption?: boolean;            // явный отказ от раздвигания и от защиты подписи
};
export type FaceParams = {
  eyes?: number; gaze?: Point | string; brow?: number; browRaise?: number;
  mouth?: number; open?: number; blush?: number; sweat?: boolean; tilt?: number;
};
export type ArmKey = { t: Time; left?: number; right?: number; dur?: number; ease?: Ease };  // градусы, -30..180
// size: доля высоты кадра (у swell — прибавка масштаба той же долей); нет — реакции не видно.
export type Reaction = { kind: "hop" | "flinch" | "sink" | "tremble" | "swell"; size?: number | Amount; dur?: number; at?: Time };
export type ActorEl = Shell & {
  type: "actor"; cast: string;
  facing?: "left" | "right" | "camera" | { toward: string };  // нет = к центру кадра (запасной вариант)
  mood?: Mood; gesture?: Gesture;                             // словарь поз лица и рук, не времени
  face?: FaceParams;
  arms?: ArmKey[];
  pointAt?: string | Point;
  talking?: boolean | { from: Time; to: Time };
  react?: Reaction[];                                            // нет = без реакции (смена mood больше не подпрыгивает)
  gait?: { style: "stroll" | "walk" | "run" | "tiptoe"; energy?: number };
  energy?: number;                                            // дыхание/покачивание; нет = 0 (стоит)
  ghost?: number;                                             // прозрачность, страховка >= 0.2
};
export type CounterEl = { type: "counter"; value: number; from?: number | null; label?: string; unit?: string; prefix?: string;
  roll?: { at?: Time; dur?: number; ease?: Ease }; trend?: "good" | "bad" | "none"; look?: "led" | "paper" | "plain" };
export type TagEl = { type: "tag"; text: string; color?: string; size?: number };
export type StampEl = { type: "stamp"; text: string; color?: string; size?: number };
export type TitleEl = { type: "title"; text?: string; lines?: string[]; sub?: string; look?: "ransom" | "clean"; size?: number };
export type CardEl = { type: "card"; title?: string; lines: string[]; width?: number; align?: "left" | "center" };
export type ChartEl = { type: "chart"; points?: number[]; shape?: ChartPreset; title?: string;
  marks?: Array<{ x: number; text: string; at?: Time }>; draw?: { at?: Time; dur?: number; ease?: Ease }; pen?: boolean; color?: string };
export type CalendarEl = { type: "calendar"; top: string; text: string; color?: string };
export type CompareEl = { type: "compare"; bars: Array<{ label: string; value: number; color?: string }>;
  grow?: { which: "all" | "last" | "none"; at?: Time; dur?: number; ease?: Ease } };
export type FormulaEl = { type: "formula"; lines: Array<{ text: string; color?: string; at?: Time }>; header?: string | null;
  look?: "receipt" | "board" | "plain" };
export type CutoutEl = { type: "cutout"; subject?: string; ref?: string /* id из objects{} */; label?: string; size?: number };
export type PropEl = { type: "prop"; name: PropPreset; count?: number; arrange?: "row" | "stack" | "scatter"; size?: number };
export type ItemBody = CounterEl | TagEl | StampEl | TitleEl | CardEl | ChartEl | CalendarEl | CompareEl | FormulaEl | CutoutEl | PropEl;
export type ItemEl = Shell & ItemBody;
export type ItemType = ItemBody["type"];
export const ITEM_TYPES = ["counter", "tag", "stamp", "title", "card", "chart", "calendar", "compare", "formula", "cutout", "prop"] as const satisfies readonly ItemType[];
export type Element = ActorEl | ItemEl;

// ---------- ДЕЙСТВИЯ ----------
// Необязательный id действия — чтобы на его события можно было сослаться во времени ("@pay.land").
// Нет give.dur / rain.spread / shake.dur => 1 кадр (по сути мгновенно) + запись в defaulted[]; нет sfx => тишина.
export type GiveAction = { type: "give"; id?: string; from: string; to: string; what: string /* id элемента | id из objects{} | PropPreset */;
  at?: Time; dur?: number; arc?: number | Amount; spin?: number; size?: number; ease?: Ease;
  after?: "keep" | "drop" | "vanish"; sfx?: Sfx | null; land?: Sfx | null };
export type RainAction = { type: "rain"; id?: string; what: string; at?: Time; count?: number; spread?: number;
  area?: "full" | { x0: number; x1: number } | { around: string };
  gravity?: number; bounce?: number; size?: number; until?: Time; sfx?: Sfx | null; land?: Sfx | null };
// give.arc — доля высоты кадра; rain.gravity — высот кадра в секунду² (нет — предмет просто
// появляется на полу); shake.strength — доля ширины кадра (нет — тряски нет).
export type ShakeAction = { type: "shake"; id?: string; at?: Time; strength?: number | Amount; dur?: number; decay?: Ease; sfx?: Sfx | null };
export type MoveAction = { type: "move"; id: string /* элемент, который движется */; keys: Key[] };
export type Action = GiveAction | RainAction | ShakeAction | MoveAction;
export const ACTION_TYPES = ["give", "rain", "shake", "move"] as const satisfies readonly Action["type"][];

// ---------- КАМЕРА ----------
export type CamKey = {
  t: Time; frame: Target;
  zoom?: number | Amount;                               // 1 = вся сцена
  tilt?: number;
  move?: "cut" | { dur: number; ease?: Ease };          // как камера приходит к этому ключу; нет = склейка
  drift?: { amp: number | Amount; period: number } | null;  // «с рук» до следующего ключа (amp — доля ширины кадра); фаза от сида; нет = нет
  parallax?: number;                                    // 0 = плоско, 1 = полная глубина слоёв; нет = 1
  intent?: string;
};

// ---------- СЦЕНА ----------
export type TransitionKind = "cut" | "flip" | "fade" | "slide" | "wipe" | "whip" | "zoom";
// dir — куда движется картинка: "left" — новая сцена въезжает справа налево (slide, wipe,
// whip, flip); dim — затемнение уходящей сцены к концу перехода 0..1 (нет = 0).
export type Transition = { kind: TransitionKind; dur?: number; ease?: Ease; dir?: "left" | "right" | "up" | "down"; dim?: number; sfx?: Sfx | null };
export type CaptionSpec = { text?: string; position?: "top" | "bottom" | Point; size?: number; look?: "strip" | "plain"; karaoke?: boolean };
export type Highlight = string | { text: string; color?: string; look?: "ribbon" | "underline" | "color" };
export type SceneSfx = Sfx & { at: Time };
export type Scene = {
  id: string;                   // обязателен и стабилен (его создаёт первый проход)
  say: string;
  voice?: { style?: string; pace?: number /* 0.8..1.6 */ };
  pause?: { before?: number; after?: number };          // длина сцены = before + речь + after; нет = 0
  overlapIn?: number;           // J/L-склейка: картинка начинается на столько секунд раньше (+) / позже (-) голоса
  caption?: string | null | CaptionSpec;
  highlight?: Highlight[];
  set: string | { ref: string };  // свободное описание по-английски или id из places{}
  ground?: number;              // линия пола 0..1; нет = как у рига
  ambient?: number;             // своя жизнь встроенной декорации (множитель скорости 0..3); нет = 0, неподвижна
  transition?: Transition;      // В эту сцену; нет = склейка (без автоматического переворота при смене места)
  elements?: Element[];
  actions?: Action[];
  camera?: CamKey[];            // нет = [{t:"start", frame:"wide", zoom:1, move:"cut"}]
  sfx?: SceneSfx[];
};

// ---------- СЕРИЯ ----------
export type Palette = { ink: string; paper: string; accent: string; positive?: string; negative?: string; highlight?: string; bg?: string };
export type Style = {
  look: string;                 // свободный текст -> промпты вырезок и фонов + ключ кэша картинок
  palette: Palette;
  case?: "upper" | "sentence" | "asis";
  jitter?: { amp: number; step: number } | 0;           // нет = 0 (без «дрожания бумаги»)
  grain?: number; edge?: number;                        // нет = 0 (чисто)
  shadow?: "none" | "soft" | "hard";                    // нет = "none"
  fonts?: { display?: FontId; body?: FontId; mono?: FontId };
  seed?: number;                // нет = hash(пользователь, title, createdAt) — ставит код
};
export type CastMember = { id: string; name: string; look?: string; color?: string; mark?: string; label?: string;
  build?: { height?: number; width?: number } };
export type Outro = { dur: number; transition?: Transition; set?: string; ambient?: number; elements?: ItemEl[] };
export type Episode = {
  engine: "0.4";                // ставит код
  title: string;
  lang?: string;                // нет = "ru": whisper -l, локаль Intl
  intent: string;               // 2–4 предложения: для кого, что почувствовать, визуальная идея, темп
  treatment?: string;           // проза первого прохода: структура, кривая темпа, язык камеры, вид
  style: Style;
  voice?: { name?: Voice; style?: string; pace?: number };
  music?: { track: string; volume?: number; duck?: number } | null;   // фаза B; нет = без музыки
  cast?: CastMember[];
  places?: Record<string, string>;
  objects?: Record<string, string>;
  scenes: Scene[];
  outro?: Outro | null;         // нет = без заставки в конце
};

// ---------- СТРАХОВКА И ЖУРНАЛ ----------
// Каждое срабатывание страховки: где (JSON-путь вида scenes[2].elements[0].at), какая
// страховка, что было, что стало.
export type Fix = { path: string; rail: string; from: unknown; to: unknown };
export type Rect = { x: number; y: number; w: number; h: number };   // пиксели кадра

// ---------- СКОМПИЛИРОВАННЫЙ ПЛАН ----------
// Всё в кадрах (fps плана) и пикселях кадра 1080×1920. Кадры абсолютные — от начала ролика.
// Как из плана получается картинка в конкретном кадре (интерполяция ключей, дрейф, тряска,
// финальный зажим страховки) — timeline/sample.ts: рендер и проверки читают одну функцию.
//
// Камера: (cx, cy) — точка сцены (слой глубины 1) в центре экрана, z — увеличение.
// Слой с множителем f = max(0, 1 − (1 − DEPTH[layer])·parallax) видит сцену с увеличением
// 1 + (z − 1)·f и центром W/2 + (cx − W/2)·f (так же по y). Дрейф и тряска — смещение
// камеры в пикселях экрана.
export type ResolvedMotion = {
  frame: number; durF: number;                         // начало и длина движения в кадрах
  dx: number; dy: number;                              // смещение позы входа/ухода от позы покоя, px
  scale: number; rotate: number; opacity: number;      // поза входа/ухода: множитель масштаба, +градусы, множитель прозрачности
  fadeF: number; ease: Ease; overshoot: number; staggerF: number;
};
export type ResolvedTransition = { kind: TransitionKind; durF: number; ease: Ease; dir: "left" | "right" | "up" | "down"; dim: number };
export type PlanRain = { x: number; spawnF: number; landF: number; fromY: number; rot: number };
export type ResolvedAction =
  | { type: "give"; id?: string; what: string; whatKind: "element" | "object" | "prop"; subject?: string /* описание вырезки из objects{} */; key?: string /* её файл (нет — заглушка) */; carrier?: string; from: string; to: string;
      frame: number; durF: number; arc: number /* px, + вверх */; spin: number; size: number /* px длинной стороны; 0 = родной */;
      ease: Ease; after: "keep" | "drop" | "vanish" }
  | { type: "rain"; id?: string; what: string; whatKind: "element" | "object" | "prop"; subject?: string; key?: string; frame: number; untilF: number | null;
      count: number; spreadF: number; x0: number; x1: number; groundY: number; gravity: number /* px/кадр² */;
      bounce: number; size: number; seed: number; drops: PlanRain[] }
  | { type: "shake"; id?: string; frame: number; durF: number; amp: number /* px экрана */; decay: Ease; seed: number }
  | { type: "move"; id: string };
export type PlanDrift = { amp: number /* px экрана */; periodF: number; phase: number; phaseY: number };
export type PlanCamKey = {
  frame: number; cx: number; cy: number; z: number; tilt: number;
  mode: "cut" | "ease"; durF: number; ease: Ease;
  drift?: PlanDrift; parallax: number;
  target: string;                                      // что кадрирует (для сводки критика)
  path: string;                                        // JSON-путь ключа в партитуре (для fixes)
};
export type PlanShake = { frame: number; amp: number; durF: number; decay: Ease; seed: number };
// Куда привязана точка элемента: свободная точка (x, y) или живая точка другого элемента
// (рука, макушка, ступни героя) со смещением.
export type PlanAnchor = { to: string; part: "above" | "hand" | "feet" | "head"; dx: number; dy: number };
export type PlanTrackKey = {
  frame: number;
  x: number; y: number; anchor?: PlanAnchor;           // anchor есть — x, y игнорируются (точка едет за целью)
  scale: number; rotate: number; opacity: number;
  durF: number; ease: Ease; arc: number;               // переезд к этому ключу: 0 кадров = склейка; arc — вершина дуги, px
};
export type PlanIdle = { kind: "sway" | "bob" | "breathe"; amp: number; periodF: number; phase: number };
export type PlanJitter = { amp: number /* px */; rot: number /* градусы */; stepF: number; seed: number };
export type PlanLayer = "back" | "behind-actors" | "actors" | "front" | "top";
export type PlanElement = {
  id: string; kind: "actor" | ItemType; layer: PlanLayer;
  inF: number; outF: number | null;                    // появление / начало ухода (null — до конца картинки сцены)
  track: PlanTrackKey[]; enter?: ResolvedMotion; exit?: ResolvedMotion;
  hide: Array<[number, number]>;                       // окна, когда элемент летит в действии give
  idle: PlanIdle | null; jitter: PlanJitter | null;
  box: Rect;                                           // рамка рисунка относительно точки элемента, масштаб 1, без поворота
  overlap: boolean; overCaption: boolean;
  persisted: boolean;                                  // перешёл из прошлой сцены без повторного входа
  path: string;                                        // JSON-путь элемента в партитуре (у созданных движком — путь действия)
  data: Record<string, unknown>;                       // поля своего типа с временами в кадрах (см. compile.ts)
};
export type PlanCaption = {
  text: string; lines: string[][]; size: number; rect: Rect;
  position: "top" | "bottom" | Point; look: "strip" | "plain"; karaoke: boolean;
  fg: string; bg: string;
  highlight: Array<{ text: string; color: string; look: "ribbon" | "underline" | "color" }>;
  words: Array<{ text: string; from: number; to: number }>;
  from: number; to: number;                            // подпись идёт за голосом своей сцены
  // Страховка: подпись не влезла в безопасную зону и на минимальном кегле — идёт страницами
  // (каждая — своё время по словам голоса). Нет — одна страница (lines/rect).
  pages?: Array<{ lines: string[][]; rect: Rect; from: number; to: number; words: Array<{ text: string; from: number; to: number }> }>;
};
// ambient — множитель скорости своей жизни встроенной декорации (0 — неподвижна).
export type PlanSet = { kind: "builtin" | "place"; name: string; key?: string; missing: boolean; ambient: number };
export type PlanScene = {
  id: string; kind: "scene" | "outro"; path: string;
  start: number; end: number;                          // картинка сцены
  voiceStart: number; voiceEnd: number;                // её реплика (с паузами модели)
  set: PlanSet; ground: number;                        // линия пола, px
  transitionIn: ResolvedTransition;
  cam: PlanCamKey[];
  shakes: PlanShake[];
  elements: PlanElement[];
  actions: ResolvedAction[];
  caption: PlanCaption | null;
};
export type PlanCue = { frame: number; file: string; volume: number; durF: number; source: string };
export type Fingerprint = {
  shotLenHist: number[]; shotLenMedian: number; zoomHist: number[]; moveShare: number;
  transitions: Record<string, number>; enterKinds: Record<string, number>; wordsPerSec: number; palette: string[];
};
export type Plan = {
  engine: "0.4"; fps: number; seed: number;
  width: number; height: number;
  style: { case: "upper" | "sentence" | "asis"; palette: Palette; jitter: { amp: number; step: number } | 0; grain: number; edge: number; shadow: "none" | "soft" | "hard" };
  cast: CastMember[];
  scenes: PlanScene[];                                 // сцены и (если модель её написала) финальная заставка kind "outro"
  durationInFrames: number;
  cues: PlanCue[];                                     // durF = настоящая длина файла из public/sfx/catalog.json
  overscan: number;                                    // запас кадра по краю, px: сколько просит серия, не больше OVERSCAN_MAX
  fixes: Fix[];
  defaulted: string[];                                 // JSON-пути, где сработал нулевой ход
  defaultable: number;                                 // сколько полей проверено (знаменатель доли)
  fingerprint: Fingerprint;
};
