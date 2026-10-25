// Картинки и звук: дождаться загрузки до снимка кадра.
//   • Img (из remotion) уже ждёт картинку сам — для <img> берите его;
//   • SvgImage — <image> внутри SVG, который тоже ждёт (иначе вспышка без картинки на
//     переходах и при concurrency > 1);
//   • useImageSize — размеры исходника (для coverRect/containRect), кадр ждёт;
//   • usePreload — заранее загрузить список картинок (например, все кадры секвенции Blender).
import { useEffect, useState } from "react";
import { cancelRender, continueRender, delayRender } from "remotion";

export { Img, staticFile, OffthreadVideo, Audio, Sequence, Series, AbsoluteFill } from "remotion";
export { SvgImage } from "./paper-kit/kit/SvgImage";

const sizes = new Map<string, { w: number; h: number }>();

const loadImage = (src: string) => new Promise<{ w: number; h: number }>((res, rej) => {
  const im = new Image();
  im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
  im.onerror = () => rej(new Error(`картинка не загрузилась: ${src}`));
  im.src = src;
});

// null — ничего не грузить (удобно, когда размер уже известен).
export const useImageSize = (src: string | null): { w: number; h: number } | null => {
  const [size, setSize] = useState(() => (src ? sizes.get(src) ?? null : null));
  const [handle] = useState(() => (src && !sizes.has(src) ? delayRender(`size ${src}`, { timeoutInMilliseconds: 60000 }) : null));
  useEffect(() => {
    if (!src || handle === null) return;
    loadImage(src).then((s) => { sizes.set(src, s); setSize(s); continueRender(handle); }).catch((e) => cancelRender(e));
  }, [src, handle]);
  return size;
};

export const usePreload = (srcs: string[]): boolean => {
  const [done, setDone] = useState(false);
  const [handle] = useState(() => delayRender(`preload ${srcs.length}`, { timeoutInMilliseconds: 120000 }));
  useEffect(() => {
    Promise.all(srcs.map(async (s) => { const v = await loadImage(s); sizes.set(s, v); }))
      .then(() => { setDone(true); continueRender(handle); })
      .catch((e) => cancelRender(e));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return done;
};

// Кадр секвенции (Blender -o //frames/name_#### → public/frames/name_0001.png).
export const seqFrame = (prefix: string, frame: number, pad = 4, first = 1, ext = "png") =>
  `${prefix}${String(frame + first).padStart(pad, "0")}.${ext}`;
