// Реэкспорт пригодных кусков бумажного набора (lib/paper-kit/kit). Остальной набор (куклы,
// детали) завязан на кадр 1080×1920 — берите его через @studio/paper-2d или напрямую из
// @studio/paper-kit/kit/…, если нужен.
export { contrast, contrastOver, parseCss, flatten, readableOn, mix, lum, CONTRAST_MIN } from "./paper-kit/kit/color";
export { rand, hash, tornRect, receiptRect, circleTorn, PaperDefs, Sheet, Pin, SHADOW_LOOK, PAPER_FILTER } from "./paper-kit/kit/paper";
export type { PaperLook } from "./paper-kit/kit/paper";
