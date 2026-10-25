# Third-party notices / Сторонние компоненты

Код этого репозитория распространяется по лицензии MIT (`LICENSE`). Ниже — всё стороннее, что
лежит в репозитории или скачивается при установке и работе, и на каких условиях.
The code in this repository is MIT-licensed (`LICENSE`). Third-party parts and their terms:

## Remotion — собственная лицензия / own license

Студия рендерит ролики на [Remotion](https://www.remotion.dev) (пакеты `remotion`, `@remotion/*`,
ставятся через npm). У Remotion **не MIT, а собственная лицензия**: бесплатно для физических лиц,
некоммерческих организаций и компаний **до 3 сотрудников**; компаниям крупнее нужна платная
лицензия компании. Условия: <https://www.remotion.dev/license>. Лицензия MIT этого репозитория
на Remotion не распространяется.

Remotion is **not** MIT: free for individuals, non-profits and companies of **up to 3 people**;
larger companies need a company license — <https://www.remotion.dev/license>.

## Звуки / Sound effects — `public/sfx/`

Kenney (<https://kenney.nl>), **CC0 1.0** (общественное достояние, можно в коммерческих роликах
без указания автора). Текст лицензии — `public/sfx/LICENSE-kenney.txt`.

## Музыка / Music — `public/music/`

Все треки — **CC0 1.0** с OpenGameArt; лицензия проверена на странице каждого трека
(`public/music/LICENSES.md`, `public/music/catalog.json`). Автора указывать не обязательно,
но это хороший тон.

| Файл | Автор | Лицензия | Источник |
|---|---|---|---|
| `public/music/lofi-chill.mp3` | omfgdude | CC0 1.0 | <https://opengameart.org/content/chill-lofi-inspired> |
| `public/music/bossa-8bit.mp3` | joth | CC0 1.0 | <https://opengameart.org/content/bossa-nova> |
| `public/music/kids-lullaby.mp3` | cynicmusic | CC0 1.0 | <https://opengameart.org/content/happy-lullaby-song17> |
| `public/music/calm-uplifting.mp3` | pauliuw | CC0 1.0 | <https://opengameart.org/content/the-field-of-dreams> |
| `public/music/winter-calm.mp3` | kistol | CC0 1.0 | <https://opengameart.org/content/snowfall> |
| `public/music/warm-gentle.mp3` | joth | CC0 1.0 | <https://opengameart.org/content/next-to-you> |
| `public/music/upbeat-warped.mp3` | tricksntraps | CC0 1.0 | <https://opengameart.org/content/free-music-pack> |
| `public/music/amb-rain-night.mp3` | kindland | CC0 1.0 | <https://opengameart.org/content/rain-and-thunders> |
| `public/music/cozy-town.mp3` | cynicmusic | CC0 1.0 | <https://opengameart.org/content/town-theme-rpg> |
| `public/music/upbeat-electronic.mp3` | mrpoly | CC0 1.0 | <https://opengameart.org/content/menu-music> |
| `public/music/playful-tiki.mp3` | cynicmusic | CC0 1.0 | <https://opengameart.org/content/enchanted-tiki-86> |

## Шрифты / Fonts

Шрифты в репозитории не лежат. Студия берёт семейства Google Fonts через
`@remotion/google-fonts` (при рендере) и скачивает TTF с Google Fonts для объёмных надписей в
Blender. Почти все они — **SIL Open Font License 1.1** (часть — Apache 2.0 / UFL); условия
конкретного семейства — на <https://fonts.google.com> (раздел License). OFL разрешает
использовать шрифт в роликах, в том числе коммерческих.

No font files are bundled; Google Fonts families are fetched at render time and are mostly
SIL OFL 1.1 (some Apache 2.0 / UFL).

## npm-зависимости / npm dependencies

React, three.js, @react-three/fiber, d3, sharp и другие пакеты из `package.json` ставятся
через npm и распространяются по своим лицензиям (в основном MIT, ISC, Apache 2.0, BSD); их
тексты — в `node_modules/<пакет>/LICENSE` после установки. `sharp` скачивает сборку libvips
(LGPL-3.0).

## Внешние программы и сервисы / External tools and services

Не входят в репозиторий, ставятся и подключаются пользователем, каждая — на своих условиях:
ffmpeg (LGPL/GPL), Blender (GPL), whisper.cpp (MIT) и модели whisper (MIT),
Chrome Headless Shell (скачивается Remotion), Claude Code (условия Anthropic), провайдеры
озвучки и картинок из `.env` (OpenAI, ElevenLabs, Google Gemini, ваши программы).
Погодный пример скилла `scene-state` использует Open-Meteo (CC BY 4.0 — атрибуция в кадре
обязательна, скилл её ставит).

## Сгенерированное / Generated content

Голос, картинки и прочее, что создают подключённые вами провайдеры, — по условиям этих
провайдеров (в том числе про клонирование голоса: клонируйте только свой голос или голос с
письменного согласия его владельца).
