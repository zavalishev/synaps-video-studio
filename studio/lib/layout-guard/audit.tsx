// <FrameAudit/> — проверка готового кадра по DOM, без знания о том, как сцена написана.
// Кладётся последним ребёнком <Stage> (или любого корня во весь кадр). На каждом кадре
// меряет видимые элементы (картинки, svg, canvas, видео, текст, плашки с фоном/тенью) с
// учётом всех трансформов и обрезки родителями и пишет нарушения в лог страховки
// ([studio-guard] → out/*.guard.json, studio probe, самопроверка):
//   • edge-cut  — видимый предмет обрезан краем кадра с одной стороны (уезжает за край,
//                 торчит из кадра). Фон, покрывающий кадр, и полосы во всю ширину/высоту
//                 (земля, небо) — не нарушение;
//   • text-cut  — текст обрезан краем кадра;
//   • text-outside-safe — текст вне безопасной зоны (под интерфейсом площадки);
//   • text-tiny — кегль на экране меньше minTextFrac·H (по умолчанию 3 %: на телефоне в ленте
//                 читается с трудом; самопроверка: < 1.8 % — FAIL, 1.8–3 % — WARN). Нарочно мелкий текст
//                 (декор, сноска) помечайте data-decor — тогда он не проверяется;
//   • empty-plate — видна плашка/карточка с текстом внутри, а весь текст погашен (смена
//                 текста через «пустую карточку»);
//   • text-overflow — буквы вылезают за свою плашку/карточку (градус «+7°» за правым краем);
//                 text-tight — буквы почти касаются края плашки (поле < 0.08 кегля).
// Отметки (kind «note:…», не нарушения): на этом кадре есть data-bleed / data-acting /
// data-world / картинка во весь кадр — probe по ним понижает свои пиксельные догадки.
// Нарочно уходящий за край слой (мотивированный выход/вход через край, декор «навылет»)
// помечайте data-bleed — нарушений по нему нет, но в треке он есть (самопроверка видит, что
// выход — нарочный). data-audit-skip — служебные слои, не меряются вовсе.
// data-id="имя" на элементе — имя в отчёте (иначе alt/src/текст). Без data-id одинаковые имена
// различаются путём в DOM (а не порядковым номером), чтобы ключ не «перескакивал» между
// элементами, когда соседний появляется или исчезает.
// data-world — 3D-холст или мир во весь кадр, который продолжается за краем (остров, город,
//               комната): край кадра режет мир, а не предмет — edge-cut по нему не ставится,
//               в треке он считается заполнением кадра.
// data-role="offer|support|decor" на тексте — смысл строки для самопроверки иерархии
//               (предложение должно быть крупнее поддержки).
// Роли для самопроверки ленты (по желанию, не обязательно):
//   data-hero   — главный предмет/герой бита: самопроверка меряет, какую долю кадра он
//                 занимает и когда впервые появился (крючок в первую секунду);
//   data-acting — игра персонажа (прыжок, падение, сжатие при приземлении): скорость и
//                 перелёты такого слоя не считаются «прыгает кадр» — лимиты кадра для камеры.
//   data-hero на ПУСТОЙ прозрачной обёртке (коробка 3D-героя, спроецированная из холста) и на
//                 <g> ВНУТРИ svg (кукла в сцене-svg) тоже меряется — отдельным элементом трека;
//                 (в треке — px: 1: это замер, его скорость не проверяется — движение 3D ведёт probe);
//   data-over-hero на тексте — текст поверх героя нарочно (обложка: надпись на разбитом стекле);
//                 иначе самопроверка спросит text-on-hero;
//   data-accent — нарочный акцент на весь кадр (вспышка, засветка экрана, флеш-кадр): probe не
//                 считает скачок яркости ±3 кадра от него склейкой (unplanned-cut, cut-rate).
// Ещё нарушения: text-under-ui — текст в колонке кнопок справа (нижняя половина кадра 9:16);
//   text-clipped — буквы срезаны по горизонтали родителем с overflow (подпись шире своей плашки).
//
// Режим трека (inputProps.audit = true; его включает самопроверка review.ts): кроме
// нарушений, на каждом кадре пишет коробки всех видимых элементов ([studio-track]) —
// по ним самопроверка меряет скорость, отскоки, дрожь ширины и «выскакивания» каждого
// элемента отдельно (пиксельный probe видит только кадр целиком).
import React, { useLayoutEffect, useRef } from "react";
import { continueRender, delayRender, getInputProps, useCurrentFrame } from "remotion";
import { type Box, feedRightColumn, overflowPx, reportGuard } from "../layout";
import { useStage } from "../stage";

export const TRACK_TAG = "[studio-track]";

// Режим «только герой» (inputProps.heroOnly; его включает самопроверка): всё, кроме поддерева
// [data-hero], невидимо, фон прозрачный — по альфе кадра самопроверка меряет нарисованного
// героя, а не коробку обёртки.
export const isHeroOnly = (): boolean => {
  try { return Boolean((getInputProps() as { heroOnly?: unknown }).heroOnly); } catch { return false; }
};
const HERO_ONLY_CSS = "html,body{background:transparent!important}*{visibility:hidden!important}[data-hero],[data-hero] *{visibility:visible!important}";

export const isAuditTrack = (): boolean => {
  try { return Boolean((getInputProps() as { audit?: unknown }).audit); } catch { return false; }
};

// c — элемент (или родитель) обрезан clip-path/маской: появляется «шторкой», а не скачком.
// r — роль hero (data-hero), a — игра персонажа (data-acting), b — нарочно за край (data-bleed),
// col — цвет текста, sh — у текста есть тень/обводка (подложка под буквами).
// w — внутри data-world; tx — текст (до 40 знаков); ro — data-role текста.
export type TrackItem = { k: string; t: "img" | "svg" | "canvas" | "video" | "text" | "box"; x: number; y: number; w: number; h: number; o: number; fs?: number; c?: 1; r?: "hero"; a?: 1; b?: 1; wd?: 1; col?: string; sh?: 1; tx?: string; ro?: string; oh?: 1; px?: 1 };

type Opts = { safe?: Box; minTextFrac?: number; tolerancePx?: number; track?: boolean; textSafe?: boolean };

const r1 = (v: number) => Math.round(v * 10) / 10;
const inter = (a: Box, b: Box): Box | null => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  return x2 - x > 0.5 && y2 - y > 0.5 ? { x, y, w: x2 - x, h: y2 - y } : null;
};

const visibleBg = (cs: CSSStyleDeclaration) => {
  const m = cs.backgroundColor.match(/rgba?\(([^)]+)\)/);
  const alpha = m ? Number(m[1].split(/[,/ ]+/).filter(Boolean)[3] ?? 1) : 0;
  return alpha > 0.05 || (cs.backgroundImage && cs.backgroundImage !== "none") || (cs.boxShadow && cs.boxShadow !== "none");
};

const label = (el: Element): string => {
  const d = (el as HTMLElement).dataset?.id ?? el.closest("[data-id]")?.getAttribute("data-id");
  const own = el.getAttribute("alt") || (el.getAttribute("src") ?? el.getAttribute("href") ?? "").split("/").pop()?.split("?")[0];
  const txt = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent ?? "").join("").trim().slice(0, 24);
  const base = own || txt || `${el.tagName.toLowerCase()}`;
  return d && d !== base ? `${d}:${base}` : base;
};

// Путь до ближайшего data-id (или корня): номера среди соседних элементов того же тега.
const domPath = (el: Element, root: Element): string => {
  const parts: string[] = [];
  for (let e: Element | null = el; e && e !== root && parts.length < 6; e = e.parentElement) {
    if (e !== el && e.hasAttribute("data-id")) break;
    const p = e.parentElement;
    const i = p ? Array.from(p.children).filter((c) => c.tagName === e!.tagName).indexOf(e) : 0;
    parts.push(String(i));
  }
  return parts.reverse().join(".");
};

export const FrameAudit: React.FC<Opts> = ({ safe, minTextFrac = 0.03, tolerancePx = 2, track, textSafe = true }) => {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useCurrentFrame();
  const st = useStage();
  const doTrack = track ?? isAuditTrack();
  const area = safe ?? st.safe;
  // Меряем в следующем кадре анимации браузера (родители Remotion задают размер корня уже
  // после эффектов детей); delayRender держит снимок кадра до замера.
  useLayoutEffect(() => {
    const h = delayRender(`FrameAudit ${frame}`);
    let id = 0, done = false;
    const finish = () => { if (!done) { done = true; continueRender(h); } };
    const attempt = (n: number) => {
      const root = ref.current?.parentElement;
      const r = root?.getBoundingClientRect();
      if ((!r || r.width < 1) && n < 30) { id = requestAnimationFrame(() => attempt(n + 1)); return; }
      // Картинки без явной высоты до загрузки имеют высоту 0 — ждём их (img.decode()).
      const pending = root ? Array.from(root.querySelectorAll("img")).filter((im) => !(im.complete && im.naturalWidth > 0)) : [];
      if (pending.length && n < 60) {
        Promise.all(pending.map((im) => im.decode().catch(() => undefined))).then(() => { id = requestAnimationFrame(() => attempt(n + 30)); });
        return;
      }
      // Шрифты: замер до загрузки начертания (курсив, второй вес) даёт ширину запасного шрифта —
      // ложные «рывки» и «дрожь ширины». Ждём document.fonts, потом меряем.
      if (typeof document !== "undefined" && document.fonts && document.fonts.status !== "loaded" && n < 90) {
        document.fonts.ready.then(() => { id = requestAnimationFrame(() => attempt(Math.max(n, 60) + 1)); });
        return;
      }
      try { measure(); } finally { finish(); }
    };
    id = requestAnimationFrame(() => attempt(0));
    return () => { cancelAnimationFrame(id); finish(); };
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const measure = () => {
    const marker = ref.current;
    const root = marker?.parentElement;
    if (!marker || !root) return;
    const rr = root.getBoundingClientRect();
    const k = rr.width / st.W;
    if (!(k > 0) || Math.abs(rr.height / k - st.H) > 2) {
      reportGuard({ id: "FrameAudit", kind: "audit-misplaced", frame, amount: 1, detail: { msg: "FrameAudit должен быть прямым ребёнком корня во весь кадр (Stage)", root: [Math.round(rr.width), Math.round(rr.height)] } });
      return;
    }
    const toFrame = (r: DOMRect): Box => ({ x: (r.left - rr.left) / k, y: (r.top - rr.top) / k, w: r.width / k, h: r.height / k });
    const styles = new Map<Element, CSSStyleDeclaration>();
    const cs = (el: Element) => { let s = styles.get(el); if (!s) { s = getComputedStyle(el); styles.set(el, s); } return s; };
    const items: TrackItem[] = [];
    const seen = new Map<string, number>();
    const FRAME: Box = { x: 0, y: 0, w: st.W, h: st.H };
    const visibleTexts: Element[] = [];
    const plates: Array<{ el: Element; key: string; box: Box }> = [];
    const notes = new Set<string>();
    for (const el of Array.from(root.querySelectorAll("*"))) {
      if (el === marker || marker.contains(el)) continue;
      if (el.closest("[data-audit-skip]")) continue;
      const bleed = Boolean(el.closest("[data-bleed]"));
      const world = Boolean(el.closest("[data-world]"));
      if (bleed) notes.add("bleed");
      if (world) notes.add("world");
      if (el.closest("[data-acting]")) notes.add("acting");
      if (el.hasAttribute("data-accent")) notes.add("accent");
      const tag = el.tagName.toLowerCase();
      if (tag !== "svg" && (el as SVGElement).ownerSVGElement) {
        // Внутри svg меряем svg целиком — кроме помеченных ролей: герой-<g> (кукла в сцене-svg),
        // нарочный выход и игра персонажа идут в трек отдельным элементом (getBoundingClientRect
        // у <g> в Chrome — коробка содержимого с трансформами).
        if (doTrack && (el.hasAttribute("data-hero") || el.hasAttribute("data-bleed") || el.hasAttribute("data-acting"))) {
          const bx = toFrame(el.getBoundingClientRect());
          let so = 1;
          for (let p: Element | null = el; p && p !== root; p = p.parentElement) so *= Number(cs(p).opacity || 1);
          if (bx.w >= 1 && bx.h >= 1 && so >= 0.05) items.push({ k: `${label(el.closest("svg") ?? el)}>${el.getAttribute("data-id") ?? (el.hasAttribute("data-hero") ? "hero" : el.hasAttribute("data-acting") ? "acting" : "bleed")}`, t: "svg", x: r1(bx.x), y: r1(bx.y), w: r1(bx.w), h: r1(bx.h), o: Math.round(so * 100) / 100, px: 1 as const, ...(el.closest("[data-hero]") ? { r: "hero" as const } : {}), ...(el.closest("[data-acting]") ? { a: 1 as const } : {}), ...(el.closest("[data-bleed]") ? { b: 1 as const } : {}), ...(world ? { wd: 1 as const } : {}) });
        }
        continue;
      }
      if (tag === "svg" && (el as SVGElement).ownerSVGElement) continue;
      const textNodes = Array.from(el.childNodes).filter((n) => n.nodeType === 3 && (n.textContent ?? "").trim().length > 0);
      let t: TrackItem["t"] | null = null;
      if (tag === "img") t = "img"; else if (tag === "svg") t = "svg"; else if (tag === "canvas") t = "canvas"; else if (tag === "video") t = "video";
      else if (textNodes.length) t = "text";
      else if (el.hasAttribute("data-hero") || el.hasAttribute("data-audit") || visibleBg(cs(el))) t = "box"; // пустая обёртка-герой (3D) — тоже коробка
      // Пустая прозрачная обёртка-герой — замер, а не видимый предмет: край кадра режет сам
      // предмет на холсте (это hero-cut в самопроверке), а не «плашку».
      const proxy = t === "box" && !el.hasAttribute("data-audit") && !visibleBg(cs(el)) && !(el.textContent ?? "").trim();
      if (!t) continue;
      // Прозрачность и видимость по цепочке родителей.
      let o = 1, hidden = false, clipped = false;
      for (let p: Element | null = el; p && p !== root; p = p.parentElement) {
        const s = cs(p);
        if (s.display === "none" || s.visibility === "hidden") { hidden = true; break; }
        o *= Number(s.opacity);
        if ((s.clipPath && s.clipPath !== "none") || (s.maskImage && s.maskImage !== "none")) clipped = true;
      }
      if (hidden || o < 0.05) continue;
      // Коробка: у текста — по самим глифам, иначе — элемент целиком.
      let raw: Box;
      if (t === "text") {
        const rects = textNodes.map((n) => { const rg = document.createRange(); rg.selectNodeContents(n); return rg.getBoundingClientRect(); }).filter((r) => r.width > 0 && r.height > 0);
        if (!rects.length) continue;
        const x0 = Math.min(...rects.map((r) => r.left)), y0 = Math.min(...rects.map((r) => r.top));
        const x1 = Math.max(...rects.map((r) => r.right)), y1 = Math.max(...rects.map((r) => r.bottom));
        raw = toFrame(new DOMRect(x0, y0, x1 - x0, y1 - y0));
      } else raw = toFrame(el.getBoundingClientRect());
      if (raw.w < 1 || raw.h < 1) continue;
      // Обрезка родителями (overflow ≠ visible) — кроме самого корня.
      let vis: Box | null = raw;
      for (let p = el.parentElement; p && p !== root && vis; p = p.parentElement) {
        const s = cs(p);
        if (s.overflowX !== "visible" || s.overflowY !== "visible") vis = inter(vis, toFrame(p.getBoundingClientRect()));
      }
      if (!vis || !inter(vis, FRAME)) continue; // целиком за кадром (ждёт входа) — не нарушение
      const name = label(el);
      const n = (seen.get(name) ?? 0) + 1;
      seen.set(name, n);
      const key = n > 1 ? `${name}#${domPath(el, root)}` : name;
      const L = vis.x < -tolerancePx, R = vis.x + vis.w > st.W + tolerancePx;
      const T = vis.y < -tolerancePx, B = vis.y + vis.h > st.H + tolerancePx;
      const cutH = (L || R) && !(L && R), cutV = (T || B) && !(T && B);
      const cover = L && R && T && B;
      let fs: number | undefined;
      if (t === "text") {
        const he = el as HTMLElement;
        const scaleY = he.offsetHeight > 0 ? el.getBoundingClientRect().height / k / he.offsetHeight : 1;
        fs = parseFloat(cs(el).fontSize) * scaleY;
      }
      // У текста коробка — «область содержимого» шрифта (выше и ниже глифов): прощаем долю кегля.
      const slack = t === "text" && fs ? 0.3 * fs : 0;
      const over0 = Math.max(-vis.x, vis.x + vis.w - st.W, -vis.y, vis.y + vis.h - st.H);
      if (t === "text" && o >= 0.08) visibleTexts.push(el); // гаснущий текст ещё «есть» — не пустая карточка
      if (t === "box" && o >= 0.5 && !bleed && (el.textContent ?? "").trim() && vis.w * vis.h >= 0.004 * st.W * st.H) plates.push({ el, key, box: vis });
      if (t !== "text" && t !== "box" && o >= 0.95 && vis.x <= 1 && vis.y <= 1 && vis.x + vis.w >= st.W - 1 && vis.y + vis.h >= st.H - 1) notes.add("covered");
      const hero = el.closest("[data-hero]") ? { r: "hero" as const } : {};
      const acting = el.closest("[data-acting]") ? { a: 1 as const } : {};
      if (bleed || world) {
        // Нарочно за краем / мир за краем: нарушений нет, но в треке элемент есть со всеми ролями
        // (герой остаётся героем, игра — игрой: самопроверка не путает их с «рывком кадра»).
        if (doTrack) items.push({ k: key, t, x: r1(vis.x), y: r1(vis.y), w: r1(vis.w), h: r1(vis.h), o: Math.round(o * 100) / 100, ...(bleed ? { b: 1 as const } : {}), ...(world ? { wd: 1 as const } : {}), ...(proxy ? { px: 1 as const } : {}), ...hero, ...acting });
        continue;
      }
      if (!proxy && !cover && (cutH || cutV) && o >= 0.3 && over0 > slack * 0.5) {
        const over = Math.max(-vis.x, vis.x + vis.w - st.W, -vis.y, vis.y + vis.h - st.H);
        const edge = [L && !R ? "left" : "", R && !L ? "right" : "", T && !B ? "top" : "", B && !T ? "bottom" : ""].filter(Boolean).join("+");
        reportGuard({ id: key, kind: t === "text" ? "text-cut" : "edge-cut", frame, amount: over, detail: { edge, type: t, box: { x: Math.round(vis.x), y: Math.round(vis.y), w: Math.round(vis.w), h: Math.round(vis.h) } } });
      }
      if (t === "text" && o >= 0.5) {
        if (textSafe) {
          const out = overflowPx(area, vis);
          if (out > tolerancePx + 2 + slack) reportGuard({ id: key, kind: "text-outside-safe", frame, amount: out, detail: { box: { x: Math.round(vis.x), y: Math.round(vis.y), w: Math.round(vis.w), h: Math.round(vis.h) } } });
        }
        // Колонка кнопок ленты справа (нижняя половина вертикального кадра).
        if (st.H / st.W > 1.3 && !el.closest("[data-decor]")) {
          const col = feedRightColumn(st.W, st.H);
          const ov = inter(vis, col);
          if (ov && ov.w * ov.h > 0.2 * vis.w * vis.h && ov.w > 0.25 * (fs ?? 40)) reportGuard({ id: key, kind: "text-under-ui", frame, amount: r1(ov.w), detail: { box: { x: Math.round(vis.x), y: Math.round(vis.y), w: Math.round(vis.w), h: Math.round(vis.h) }, role: el.closest("[data-role]")?.getAttribute("data-role") ?? null } });
        }
        // Буквы срезаны родителем с overflow ≠ visible: по горизонтали — подпись шире своей
        // плашки («10 000 ₽» без «₽»); по вертикали — строки не влезли в плитку фиксированной
        // высоты (пропала нижняя строка «…и ведение»). Игра (прокрутка цифр) и шторки — не брак.
        if (fs && !el.closest("[data-acting]") && !clipped) {
          const cutL = vis.x - raw.x, cutR = raw.x + raw.w - (vis.x + vis.w);
          const cutT = vis.y - raw.y, cutB = raw.y + raw.h - (vis.y + vis.h);
          const atFrame = (cutL > 0 && vis.x <= 1) || (cutR > 0 && vis.x + vis.w >= st.W - 1); // край кадра — это text-cut
          const atFrameV = (cutT > 0 && vis.y <= 1) || (cutB > 0 && vis.y + vis.h >= st.H - 1);
          const cut = Math.max(cutL, cutR);
          // По вертикали у коробки текста есть поля шрифта (выше и ниже глифов) — прощаем 0,4 кегля.
          const cutV = Math.max(cutT, cutB);
          if (cut > 0.15 * fs && vis.w > 0 && !atFrame) reportGuard({ id: key, kind: "text-clipped", frame, amount: r1(cut), detail: { px: r1(cut), side: vis.x - raw.x > 0.15 * fs ? "left" : "right" } });
          else if (cutV > 0.4 * fs && vis.h > 0 && !atFrameV) reportGuard({ id: key, kind: "text-clipped", frame, amount: r1(cutV), detail: { px: r1(cutV), side: cutB >= cutT ? "bottom" : "top" } });
        }
        // amount — нехватка до минимума (px): худшее = самое мелкое; frac — кегль в долях высоты.
        if (fs !== undefined && fs < minTextFrac * st.H && !el.closest("[data-decor]")) reportGuard({ id: key, kind: "text-tiny", frame, amount: r1(minTextFrac * st.H - fs), detail: { px: r1(fs), min: Math.round(minTextFrac * st.H), frac: +(fs / st.H).toFixed(4) } });
      }
      // Текст вылезает за свою плашку: ближайший родитель с видимым фоном (не во весь кадр).
      if (t === "text" && o >= 0.5 && fs) {
        for (let p = el.parentElement; p && p !== root; p = p.parentElement) {
          if (!visibleBg(cs(p))) continue;
          const pb = toFrame(p.getBoundingClientRect());
          if (pb.w >= st.W * 0.98 && pb.h >= st.H * 0.98) break;
          const outL = pb.x - raw.x, outR = raw.x + raw.w - (pb.x + pb.w);
          const over = Math.max(outL, outR);
          // Строки ниже/выше плашки (плитка без overflow: текст свисает с неё) — поля шрифта прощаем.
          const outT = pb.y - raw.y, outB = raw.y + raw.h - (pb.y + pb.h), overV = Math.max(outT, outB) - 0.3 * fs;
          if (over > 1.5) reportGuard({ id: key, kind: "text-overflow", frame, amount: r1(over), detail: { side: outR > outL ? "right" : "left", px: r1(over), plate: label(p) } });
          else if (overV > 1.5) reportGuard({ id: key, kind: "text-overflow", frame, amount: r1(overV), detail: { side: outB >= outT ? "bottom" : "top", px: r1(overV), plate: label(p) } });
          else if (-over < 0.08 * fs && pb.w > raw.w + 2) reportGuard({ id: key, kind: "text-tight", frame, amount: r1(0.08 * fs + over), detail: { side: outR > outL ? "right" : "left", padPx: r1(-over) } });
          break;
        }
      }
      if (doTrack) {
        let textInfo = {};
        if (t === "text") {
          const s2 = cs(el);
          const shadow = (s2.textShadow && s2.textShadow !== "none") || parseFloat(s2.webkitTextStrokeWidth || "0") > 0;
          const role = el.closest("[data-role]")?.getAttribute("data-role");
          const txt = textNodes.map((nd) => nd.textContent ?? "").join(" ").replace(/\s+/g, " ").trim().slice(0, 40);
          textInfo = { col: s2.color, ...(shadow ? { sh: 1 as const } : {}), ...(txt ? { tx: txt } : {}), ...(role ? { ro: role } : {}), ...(el.closest("[data-over-hero]") ? { oh: 1 as const } : {}) };
        }
        items.push({ k: key, t, x: r1(vis.x), y: r1(vis.y), w: r1(vis.w), h: r1(vis.h), o: Math.round(o * 100) / 100, ...(fs ? { fs: r1(fs) } : {}), ...(clipped ? { c: 1 as const } : {}), ...(proxy ? { px: 1 as const } : {}), ...hero, ...acting, ...textInfo });
      }
    }
    for (const nk of notes) reportGuard({ id: "frame", kind: `note:${nk}`, frame, amount: 0 });
    for (const p of plates) {
      if (!visibleTexts.some((te) => p.el.contains(te))) reportGuard({ id: p.key, kind: "empty-plate", frame, amount: 1, detail: { box: { x: Math.round(p.box.x), y: Math.round(p.box.y), w: Math.round(p.box.w), h: Math.round(p.box.h) } } });
    }
    // eslint-disable-next-line no-console
    if (doTrack) console.log(TRACK_TAG + JSON.stringify({ f: frame, W: st.W, H: st.H, S: [Math.round(area.x), Math.round(area.y), Math.round(area.w), Math.round(area.h)], items }));
  };
  return (
    <>
      {isHeroOnly() ? <style data-audit-skip>{HERO_ONLY_CSS}</style> : null}
      <div ref={ref} data-audit-skip style={{ display: "none" }} />
    </>
  );
};
