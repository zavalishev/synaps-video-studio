// Реестр облика роликов студии — обезличенный: только признаки темы (шрифты, цвета, форма,
// подача, свет фото), без брифа, текста и картинок. Пишется при полном `studio render`;
// board.ts сравнивает новую тему не только с соседними папками jobs/, но и со всем, что студия
// уже выпускала (у многих пользователей похожий бриф не должен давать «тот же ролик»).
// Файл: $STUDIO_REGISTRY или .cache/studio-registry.jsonl в корне репо (не в git).
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ROOT } from "./_lib";
import voices from "../lib/font-voices.json";
import { layoutOf, lookCell, type Layout } from "../lib/art-direction/looks";

export const REGISTRY = process.env.STUDIO_REGISTRY ?? join(ROOT, ".cache", "studio-registry.jsonl");

// Штампы «AI-стока»: тёплый янтарный свет из окна, малая глубина резкости, боке, дерево.
export const AMBER_TOKENS = ["golden", "amber", "warm", "window light", "shallow depth of field", "bokeh", "wood", "cozy", "candlelight", "rustic"];
export const amberHits = (suffix?: string) => AMBER_TOKENS.filter((t) => (suffix ?? "").toLowerCase().includes(t));

type T = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type Fingerprint = {
  id: string; at: string;
  display?: string; displayStyle?: string; accent?: string; accentStyle?: string;
  bg?: string; ink?: string; accentColor?: string;
  temperament?: string; plate?: string; lockup?: string; align?: string;
  storyForm?: string; endCard?: string; material?: string; photoLight?: string; amber: string[];
  voice?: string; layout?: Layout; cell?: string;
  note?: string; // одна фраза директора «что видит зритель» (studio looks --note) — журнал облика
};

// Голос шрифта по имени модуля (font-voices.json): «Sofia Sans Extra Condensed» и «Alumni
// Sans» — один голос poster-condensed, хотя семейства разные.
export const voiceOf = (module?: string): string | undefined => {
  if (!module) return undefined;
  for (const [v, ms] of Object.entries(voices as Record<string, string[]>)) if (ms.includes(module)) return v;
  return undefined;
};

export const fingerprintOf = (theme: T, key: string): Fingerprint => ({
  id: createHash("sha1").update(key).digest("hex").slice(0, 12),
  at: new Date().toISOString(),
  display: theme.fonts?.display?.module, displayStyle: theme.fonts?.display?.style,
  accent: theme.fonts?.accent?.module, accentStyle: theme.fonts?.accent?.style,
  bg: theme.palette?.bg, ink: theme.palette?.ink, accentColor: theme.palette?.accent,
  temperament: theme.motion?.temperament, plate: theme.shapes?.plate ?? theme.captions?.look,
  lockup: theme.type?.lockup, align: theme.type?.align,
  storyForm: theme.story?.form, endCard: theme.story?.endCard,
  material: theme.material, photoLight: theme.photo?.light,
  amber: amberHits(theme.imagePromptSuffix),
  voice: voiceOf(theme.fonts?.display?.module), layout: layoutOf(theme), cell: lookCell(theme.palette?.bg, theme.palette?.accent)?.key,
});

export const appendRegistry = (dir: string) => {
  const tf = join(dir, "theme.json");
  if (!existsSync(tf)) return;
  try {
    const fp = fingerprintOf(JSON.parse(readFileSync(tf, "utf8")), dir);
    mkdirSync(dirname(REGISTRY), { recursive: true });
    appendFileSync(REGISTRY, JSON.stringify(fp) + "\n");
  } catch { /* реестр — подсказка, не повод ронять рендер */ }
};

export const registryId = (key: string) => createHash("sha1").update(key).digest("hex").slice(0, 12);

// Последние записи (по одной на ролик — последняя версия, в порядке последнего обновления),
// кроме своей. Заметка облика (note) переживает новые записи того же ролика.
export const readRegistry = (exceptKey?: string, limit = 40): Fingerprint[] => {
  if (!existsSync(REGISTRY)) return [];
  const me = exceptKey ? registryId(exceptKey) : "";
  const byId = new Map<string, Fingerprint>();
  for (const line of readFileSync(REGISTRY, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const fp = JSON.parse(line) as Fingerprint;
      if (fp.id === me) continue;
      const prev = byId.get(fp.id);
      byId.delete(fp.id);
      byId.set(fp.id, { ...fp, note: fp.note ?? prev?.note });
    } catch { /* битая строка */ }
  }
  return [...byId.values()].slice(-limit);
};

// Журнал облика: директор дописывает одной фразой, что зритель видит в этом ролике
// («сине-сланцевый фон, лаймовая шкала, узкий капслок слева сверху»). Следующие ролики читают
// это в studio looks до выбора направлений.
export const noteRegistry = (dir: string, note: string) => {
  const tf = join(dir, "theme.json");
  const base: Fingerprint = existsSync(tf) ? fingerprintOf(JSON.parse(readFileSync(tf, "utf8")), dir) : { id: registryId(dir), at: new Date().toISOString(), amber: [] };
  mkdirSync(dirname(REGISTRY), { recursive: true });
  appendFileSync(REGISTRY, JSON.stringify({ ...base, note: note.trim().slice(0, 200) }) + "\n");
};
