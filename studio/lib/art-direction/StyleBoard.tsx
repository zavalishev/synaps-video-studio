// Лист стиля: палитра с контрастами, шрифты на кириллице, образец подписи и тёмной секции,
// замечания проверки. Рендерится инструментом board.ts (скилл art-direction) в PNG, чтобы
// директор увидел стиль-библию глазами до первых ассетов.
import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { contrast } from "../paper-kit/kit/color";
import { checkTheme, fontEntry, shapeStyle, type FontRef, type Theme } from "./theme";

type Fonts = Partial<Record<keyof Theme["fonts"], string>>;

const css = (fonts: Fonts, role: keyof Theme["fonts"], t: Theme): React.CSSProperties => {
  const f = t.fonts[role] ?? t.fonts.display;
  const fam = fonts[role] ?? fonts.display;
  return { fontFamily: fam, fontWeight: Number(f.weight), fontStyle: f.style ?? "normal", letterSpacing: f.letterSpacingEm ? `${f.letterSpacingEm}em` : undefined, textTransform: f.uppercase ? "uppercase" : undefined };
};

export const StyleBoard: React.FC<{ theme: Theme; fonts: Fonts }> = ({ theme: t, fonts }) => {
  const { width: W, height: H } = useVideoConfig();
  const u = W / 1080; // единица масштаба
  const p = t.palette;
  const ink = p.ink, muted = p.muted ?? ink, surface = p.surface ?? p.bg;
  const issues = checkTheme(t);
  const pad = 64 * u;
  const sample = t.sample ?? "Дорогая аренда — а прибыль выше";
  // Короткие служебные слова — неразрывно со следующим (не висят в конце строки).
  const words = sample.replace(/(^|\s)([аивкосуАИВКОСУ]|на|не|за|по|из|до|от)\s+/g, "$1$2\u00a0").split(/ +/);
  const cut = Math.max(1, words.length - 2);
  const swatches = Object.entries(p).filter(([, v]) => typeof v === "string") as Array<[string, string]>;
  const roleName = (r: string, f?: FontRef) => f ? `${r} · ${fontEntry(f.module)?.family ?? f.module} ${f.weight}${f.style === "italic" ? " italic" : ""}` : r;
  const capLook = t.captions?.look ?? "shadow";
  return (
    <AbsoluteFill style={{ background: p.bg, color: ink, padding: pad, display: "flex", flexDirection: "column", gap: 36 * u }}>
      <div style={{ ...css(fonts, "mono", t), fontSize: 24 * u, letterSpacing: "0.14em", textTransform: "uppercase", color: muted }}>
        Стиль-библия · {t.register ?? t.material ?? "—"}
      </div>
      <div style={{ ...css(fonts, "display", t), fontSize: 92 * u, lineHeight: 1.0, maxWidth: W - 2 * pad }}>
        {words.slice(0, cut).join(" ")}{" "}
        <span style={{ ...css(fonts, t.fonts.accent ? "accent" : "display", t), color: p.accent }}>{words.slice(cut).join(" ")}</span>
      </div>
      <div style={{ ...css(fonts, "mono", t), fontSize: 18 * u, color: muted, marginBottom: -24 * u }}>палитра · число на образце — контраст с bg</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16 * u }}>
        {swatches.map(([k, v]) => (
          <div key={k} style={{ display: "flex", flexDirection: "column", gap: 8 * u }}>
            <div style={{ height: 120 * u, borderRadius: 18 * u, background: v, boxShadow: `inset 0 0 0 ${2 * u}px rgba(0,0,0,.08)`, display: "flex", alignItems: "flex-end", padding: 10 * u }}>
              <span style={{ ...css(fonts, "mono", t), fontSize: 18 * u, color: contrast("#000000", v) > contrast("#ffffff", v) ? "#000" : "#fff", opacity: 0.8 }}>{contrast(v, p.bg).toFixed(1)}</span>
            </div>
            <div style={{ ...css(fonts, "mono", t), fontSize: 18 * u, color: muted, lineHeight: 1.3 }}>{k}<br />{v.toUpperCase()}</div>
          </div>
        ))}
      </div>
      {/* Подпись на кадре: как будет читаться поверх картинки/тёмного фона */}
      <div style={{ position: "relative", height: 260 * u, flexShrink: 0, borderRadius: 28 * u, overflow: "hidden", background: `linear-gradient(135deg, ${p.dark ?? "#222"} 0%, ${p.accent2 ?? p.accent} 140%)` }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: "50%", transform: "translateY(-50%)", textAlign: "center", ...css(fonts, "caption", t), fontSize: 64 * u, lineHeight: 1.1, color: p.onDark ?? "#fff", textShadow: capLook === "shadow" ? "0 2px 3px rgba(0,0,0,.35), 0 6px 24px rgba(0,0,0,.45)" : undefined }}>
          <span style={capLook === "plate" ? { background: "rgba(17,17,17,.78)", borderRadius: 24 * u, padding: `${10 * u}px ${24 * u}px` } : undefined}>
            так читается{" "}
            <span style={{ background: p.accent, color: p.onAccent ?? "#fff", borderRadius: 14 * u, padding: `0 ${12 * u}px` }}>подпись</span>
          </span>
        </div>
        <div style={{ position: "absolute", left: 24 * u, top: 20 * u, ...css(fonts, "mono", t), fontSize: 18 * u, color: "rgba(255,255,255,.7)" }}>captions · {capLook}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 * u, background: surface, borderRadius: 28 * u, padding: 32 * u }}>
        {(Object.keys(t.fonts) as Array<keyof Theme["fonts"]>).map((r) => (
          <div key={r} style={{ display: "flex", flexDirection: "column", gap: 4 * u }}>
            <div style={{ ...css(fonts, "mono", t), fontSize: 18 * u, color: muted }}>{roleName(r, t.fonts[r])}</div>
            <div style={{ ...css(fonts, r, t), fontSize: (r === "display" ? 56 : r === "mono" ? 32 : 44) * u, lineHeight: 1.1, color: r === "accent" ? p.accent : ink }}>
              {r === "mono" ? "STEP 01 / 06 · 1 234 567 · 09:41" : "Съешь ещё этих мягких булок, 2026"}
            </div>
          </div>
        ))}
      </div>
      {t.shapes ? (
        <div style={{ display: "flex", gap: 28 * u, alignItems: "center" }}>
          <div style={{ ...css(fonts, "mono", t), fontSize: 18 * u, color: muted, width: 140 * u }}>форма · {t.shapes.corner ?? "—"} / {t.shapes.shadow ?? "—"} / {t.shapes.plate ?? "—"}</div>
          {[p.accent, surface, p.dark ?? ink].map((bgc, i) => (
            <div key={i} style={{ ...css(fonts, "caption", t), fontSize: 40 * u, padding: `${14 * u}px ${26 * u}px`, background: t.shapes?.plate === "none" ? "transparent" : bgc, color: t.shapes?.plate === "none" ? (i === 0 ? p.accent : ink) : i === 0 ? (p.onAccent ?? "#fff") : i === 1 ? ink : (p.onDark ?? "#fff"), ...shapeStyle(t.shapes, { size: 70 * u, ink }) }}>
              {["Акция", "Шаг 2", "Итог"][i]}
            </div>
          ))}
        </div>
      ) : null}
      {t.paletteAlt ? (
        // Две палитры рядом: одна и та же строка на обеих — выбор глазами, а не словами.
        <div style={{ display: "flex", gap: 16 * u }}>
          {([["основная", p.bg, p.ink, p.accent], ["paletteAlt", t.paletteAlt.bg, t.paletteAlt.ink, t.paletteAlt.accent]] as const).map(([name, bg, fg, ac]) => (
            <div key={name} style={{ flex: 1, background: bg, borderRadius: 18 * u, padding: 24 * u, boxShadow: `inset 0 0 0 ${2 * u}px rgba(127,127,127,.3)` }}>
              <div style={{ ...css(fonts, "mono", t), fontSize: 16 * u, color: fg, opacity: 0.7 }}>{name}</div>
              <div style={{ ...css(fonts, "display", t), fontSize: 54 * u, lineHeight: 1.05, color: fg }}>{words.slice(0, cut).join(" ")} <span style={{ color: ac }}>{words.slice(cut).join(" ")}</span></div>
            </div>
          ))}
        </div>
      ) : null}
      <div style={{ ...css(fonts, "text", t), fontSize: 30 * u, lineHeight: 1.35, color: muted }}>
        {t.why ?? ""}{t.material ? ` · материал: ${t.material}` : ""}{t.motion?.temperament ? ` · темп: ${t.motion.temperament}` : ""}
      </div>
      {issues.length ? (
        <div style={{ ...css(fonts, "mono", t), fontSize: 22 * u, lineHeight: 1.4, color: "#fff", background: issues.some((i) => i.level === "FAIL") ? "#C62828" : "#9A6A00", borderRadius: 18 * u, padding: 20 * u }}>
          {issues.map((i, k) => <div key={k}>{i.level}: {i.msg}</div>)}
        </div>
      ) : null}
      <div style={{ flex: 1 }} />
      <div style={{ ...css(fonts, "mono", t), fontSize: 18 * u, color: muted }}>{t.name} · {W}×{H}</div>
    </AbsoluteFill>
  );
};
