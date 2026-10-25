// Скилл kinetic-typography: живой текст и субтитры.
//   import { Captions, Headline, Counter, Pill, SwapText, paginate } from "@studio/kinetic-typography";
//   удар без прыжка: maskReveal, scaleStep, Flash/flashAt, RollNumber, holdFrames;
//   текст без плашки: typeOnImage, markerHighlight.
export { Captions, type CaptionsProps, type CaptionLook } from "./Captions";
export { Headline, type Segment } from "./Headline";
export { Counter, Pill } from "./Counter";
export { paginate, pageAt, keywordIndices, keywordSet, isKeyword, normWord, type CapPage, type CapWord, type PaginateOpts } from "./paginate";
export { SwapText } from "./SwapText";
export { maskReveal, scaleStep, flashAt, Flash, holdFrames, RollNumber, typeOnImage, markerHighlight } from "./impact";
