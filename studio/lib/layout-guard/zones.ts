// Зоны кадра под площадку: где интерфейс приложения перекрывает ролик (верхняя панель,
// кнопки справа, подпись и звук снизу) и где читаются субтитры. Цифры — приблизительные
// стартовые точки для 9:16 (замеры по скриншотам интерфейсов, 2025–2026), не стандарт:
// директор может сдвинуть, но тогда пусть посмотрит кадр в режиме проверки.
import type { Box, Margins } from "../layout";

export type Platform = "reels" | "tiktok" | "shorts" | "story" | "feed45" | "square" | "landscape" | "none";

// Доли кадра: сверху, справа, снизу, слева — занято интерфейсом.
const UI: Record<Platform, [number, number, number, number]> = {
  // Справа — поле как слева: колонка кнопок ленты (12–13 %) только в НИЖНЕЙ половине кадра —
  // она в zones().buttons и вычтена из полосы субтитров (= FEED_UI в layout.ts). Раньше 12 %
  // резались по всей высоте, и герой с заголовком теряли ширину там, где кнопок нет.
  reels: [0.08, 0.055, 0.2, 0.055],
  tiktok: [0.09, 0.055, 0.22, 0.055],
  shorts: [0.08, 0.055, 0.19, 0.055],
  story: [0.12, 0.055, 0.15, 0.055],
  feed45: [0.05, 0.05, 0.06, 0.05],
  square: [0.05, 0.05, 0.06, 0.05],
  landscape: [0.06, 0.05, 0.1, 0.05],
  none: [0.03, 0.03, 0.03, 0.03],
};

// Колонка кнопок справа (лайк, комментарии, звук) — нижняя половина кадра.
const BUTTONS: Partial<Record<Platform, number>> = { reels: 0.12, tiktok: 0.13, shorts: 0.13 };
export const buttonsColumn = (platform: Platform, W: number, H: number): Box | null => {
  const r = BUTTONS[platform];
  return r ? { x: Math.round(W * (1 - r)), y: Math.round(H * 0.5), w: Math.round(W * r), h: Math.round(H * 0.5) } : null;
};

export const platformMargins = (platform: Platform, W: number, H: number): Margins => {
  const [t, r, b, l] = UI[platform];
  return { top: Math.round(H * t), right: Math.round(W * r), bottom: Math.round(H * b), left: Math.round(W * l) };
};

export type Zones = {
  safe: Box;      // всё важное — здесь (передайте margins в <Stage margins={…}>)
  caption: Box;   // полоса субтитров: нижняя часть безопасной зоны, над интерфейсом
  title: Box;     // верхняя треть безопасной зоны — заголовки, крючок
  hero: Box;      // центр — герой, предмет, график (между заголовком и субтитрами)
  heroMax: Box;   // самое большое место героя: вся безопасная зона под заголовком (без полосы
                  // субтитров, если их нет). Поля интерфейса запрещают ТЕКСТ и важную деталь —
                  // тело героя, фон и реквизит могут уходить в них и за край кадра (data-bleed).
  buttons: Box | null; // колонка кнопок ленты (нижняя половина справа): текст и CTA — не сюда
};

// Зоны кадра. captionAt — где центр полосы субтитров по высоте безопасной зоны (0 — верх,
// 1 — низ); captionH — высота полосы в долях высоты кадра; captions: false — субтитров нет,
// hero занимает и их полосу; titleH — доля безопасной зоны под заголовок (0 — без заголовка).
// theme — theme.json ролика: если captions не задан явно, он берётся из theme.captions (нет
// подписей в теме — полоса не резервируется, герой получает её высоту).
// Это стартовая разметка, а не сетка: на телефоне герой должен быть крупным — если он
// не помещается в hero, берите heroMax или ведите текст поверх свободного места героя.
export const zones = (W: number, H: number, platform: Platform = W / H < 0.7 ? "reels" : "none", o: { captionAt?: number; captionH?: number; captions?: boolean; titleH?: number; theme?: { captions?: unknown } } = {}): Zones => {
  const m = platformMargins(platform, W, H);
  const caps = o.captions ?? (o.theme ? Boolean(o.theme.captions) : true);
  const safe: Box = { x: m.left, y: m.top, w: W - m.left - m.right, h: H - m.top - m.bottom };
  const ch = H * (o.captionH ?? (W / H < 0.7 ? 0.16 : 0.18));
  const at = o.captionAt ?? 0.84;
  const cy = Math.min(safe.y + safe.h - ch / 2, Math.max(safe.y + ch / 2, safe.y + safe.h * at));
  const buttons = buttonsColumn(platform, W, H);
  // Полоса субтитров в нижней половине — левее колонки кнопок.
  const capW = buttons && cy + ch / 2 > buttons.y ? Math.min(safe.w, buttons.x - safe.x) : safe.w;
  const caption: Box = { x: safe.x, y: cy - ch / 2, w: capW, h: ch };
  const tH = o.titleH ?? 0.3;
  const title: Box = { x: safe.x, y: safe.y, w: safe.w, h: safe.h * tH };
  const top = safe.y + safe.h * Math.min(0.22, tH);
  const bottom = caps === false ? safe.y + safe.h : caption.y;
  const hero: Box = { x: safe.x, y: top, w: safe.w, h: Math.max(0, bottom - top) };
  const heroMax: Box = { x: safe.x, y: safe.y + safe.h * tH * 0.6, w: safe.w, h: Math.max(0, (caps === false ? safe.y + safe.h : caption.y) - (safe.y + safe.h * tH * 0.6)) };
  return { safe, caption, title, hero, heroMax, buttons };
};
