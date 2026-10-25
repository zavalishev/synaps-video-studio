# AI Video Studio

Агентная студия коротких вертикальных роликов. Режиссёр — Claude Code (по вашей подписке):
он читает бриф и руководство студии (`studio/CLAUDE.md`), сам выбирает концепт, стиль, камеру и
инструменты, собирает сцены на Remotion, проверяет кадры и выпускает `out/final.mp4`.
Скиллы (`studio/skills/`) — знания, помощники и проверки, а не шаблоны.

> Статус: черновик публичной версии. Платные провайдеры (озвучка, картинки) ещё не подключены —
> `studio voice` и `studio image` сообщают «провайдер не настроен». Остальное работает локально.

## Что нужно

- macOS (основная платформа) или Linux; Node 22+ (проверено на 24), ffmpeg.
- [Claude Code](https://claude.com/claude-code) CLI с вашей подпиской — это режиссёр.
- По желанию: Blender (3D-ассеты), whisper.cpp (тайминги слов для субтитров).

## Быстрый старт

```bash
npm install
npm run typecheck && npm test
npx tsx studio/make.ts --brief "Ролик для кофейни у моря: осенний сезон, тыквенный латте"
```

Папка ролика появится в `jobs/<slug>/`. Инструменты студии — `studio/bin/studio help`.

## Лицензии

- Код студии — лицензия будет указана владельцем репозитория.
- **Remotion** имеет собственную лицензию: бесплатно для физических лиц и компаний до 3 человек;
  остальным нужна коммерческая лицензия компании — см. <https://www.remotion.dev/license>.
- Звуки `public/sfx` — Kenney, CC0 (`public/sfx/LICENSE-kenney.txt`).
- Музыка `public/music` — CC0 с OpenGameArt, источники в `public/music/catalog.json`
  (`public/music/LICENSES.md`).
