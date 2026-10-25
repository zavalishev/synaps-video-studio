// Реестр стилей и сборка промпта — без React (работает и в node: skills/generated-imagery/prompt.ts).
import stylesJson from "./styles.json";

export type ImageStyle = (typeof stylesJson.styles)[number];
export const STYLES: ImageStyle[] = stylesJson.styles;
export const ROLES = stylesJson.roles as Record<"cutout" | "prop" | "backdrop" | "sheet" | "same-character", string>;
export const styleById = (id: string): ImageStyle => {
  const s = STYLES.find((x) => x.id === id);
  if (!s) throw new Error(`стиль «${id}» не найден; есть: ${STYLES.map((x) => x.id).join(", ")}`);
  return s;
};

// Промпт = субъект + действие/поза + окружение (что пишет директор) + роль + стиль + «нет …».
// Возвращает английскую строку для `studio image --prompt-file`. Стиль можно передать своим
// текстом (гибрид) вместо id.
export const stylePrompt = (o: { subject: string; role: keyof typeof ROLES; style: string; extra?: string; palette?: string; sameCharacter?: boolean }) => {
  const st = STYLES.find((x) => x.id === o.style);
  const suffix = st ? st.prompt_suffix : o.style;
  const avoid = st ? st.avoid : "text";
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  return [
    o.sameCharacter ? cap(ROLES["same-character"]) + "." : "",
    cap(o.subject.trim().replace(/\.$/, "")) + ".",
    o.extra ? cap(o.extra.trim().replace(/\.$/, "")) + "." : "",
    cap(ROLES[o.role]) + ".",
    `Style: ${suffix}.`,
    o.palette ? `Color palette: ${o.palette}.` : "",
    `Avoid: ${avoid}, watermark, signature, letters.`,
  ].filter(Boolean).join(" ");
};

