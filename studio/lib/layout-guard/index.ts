// Скилл layout-guard: дополнения к страховке кадра из @studio (Stage, Guarded, CoverImage…).
//   import { FrameAudit, zones, FitText, useFontReady, wrapWords } from "@studio/layout-guard";
export { FrameAudit, isAuditTrack, TRACK_TAG, type TrackItem } from "./audit";
export { zones, platformMargins, buttonsColumn, type Platform, type Zones } from "./zones";
export { FitText } from "./FitText";
export { useFontReady, splitWords, measureWidth, wrapWords, wrapWidths, fitFontSize, isHanging, type FontSpec, type PlacedWord, type WrapResult } from "./text";
