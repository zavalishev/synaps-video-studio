// Картинка внутри SVG (<image>), которую Remotion дожидается перед снимком кадра.
// Предзагрузка только кладёт файлы в кэш браузера; свежесмонтированный
// <image> рисуется асинхронно даже из кэша. Сцена монтируется заново на каждом переходе и
// когда вкладка рендера перескакивает на чужой кусок ролика (concurrency > 1) — без этой
// задержки кадр иногда снимался без задника и вырезок (вспышка на 1–3 кадра, кадр ролика ≠
// still того же кадра). Ошибка загрузки тоже отпускает кадр: заглушки — дело плана.
import React, { useEffect, useRef, useState } from "react";
import { continueRender, delayRender } from "remotion";

type Props = React.SVGProps<SVGImageElement> & { href: string };

export const SvgImage: React.FC<Props> = (props) => {
  const [handle] = useState(() => delayRender(`image ${props.href}`));
  const done = useRef(false);
  const release = () => {
    if (done.current) return;
    done.current = true;
    continueRender(handle);
  };
  // Размонтировали до загрузки — кадр не ждёт картинку, которой уже нет.
  useEffect(() => release, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <image {...props} onLoad={release} onError={release} />;
};
