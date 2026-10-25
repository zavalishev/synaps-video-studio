// Скилл art-direction: стиль-библия ролика.
//   import { checkTheme, type Theme, StyleBoard } from "@studio/art-direction";
// Шрифты темы в сцене подключаются явно (импорт модуля — статический):
//   import theme from "../theme.json";
//   import * as Manrope from "@remotion/google-fonts/Manrope";
//   const display = useCyrillicFont(Manrope, { weights: [theme.fonts.display.weight] });
export { checkTheme, colorDistance, fontEntry, mixOk, shapeStyle, type FontRef, type Shapes, type Theme, type ThemeIssue } from "./theme";
export { StyleBoard } from "./StyleBoard";
