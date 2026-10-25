# AI Video Studio — for Codex and other coding agents

> Если текущая папка — папка ролика (`jobs/<slug>/`, в ней `job.json`), этот файл не про тебя:
> ты режиссёр, руководство — `AGENTS.md` в папке ролика (это `studio/CLAUDE.md`).
> Inside a job folder you are the director; follow the `AGENTS.md` there.

Студия роликов: агент — режиссёр, `studio/` — инструменты и скиллы. Режиссёром работает
Claude Code или Codex — по подписке пользователя. Просьба «сделай ролик / рилс / видео про …» —
это скилл `make-video` (`.agents/skills/make-video/SKILL.md`): он соберёт бриф и запустит
режиссёра.

**Песочница Codex.** Рендер запускает браузер (Chrome Headless Shell), а в песочнице Codex он не
стартует; озвучке и картинкам нужна сеть. Команды `npm run make`, `studio still`, `studio render`,
`studio image`, `studio voice` запускай с выходом из песочницы (с разрешения пользователя) или
в сессии `codex -s danger-full-access`.

Коротко:

1. `npm run setup` (один раз), затем `studio/bin/studio doctor` — что подключено.
2. Бриф: `jobs/<slug>.brief.md` — кто публикует, что продвигаем, зритель, площадка, факты дословно,
   допущения. Цифры и обещания не выдумывать.
3. Сам, без окна: `npm run make -- --agent codex --brief jobs/<slug>.brief.md --slug <slug>`
   (два этапа с чистым контекстом, 10–20 минут; итог — JSON с путём к ролику).
4. Вместе, в этой сессии: `studio/bin/studio new <slug> --brief jobs/<slug>.brief.md`, затем работа
   в `jobs/<slug>/` — прочитать `AGENTS.md` этой папки целиком и идти по его производственному
   циклу. Команды — из папки ролика с `PATH="<repo>/studio/bin:$PATH"`; скиллы — `studio skill <имя>`.
   Критик со свежим взглядом — субагент (`spawn_agent`) по `.agents/skills/self-review/critic.md`:
   только бриф, текст речи и плитки, без истории сборки.

Картинки без ключа API: `IMAGE_PROVIDER=codex` в `.env` — встроенный генератор Codex по подписке.

Разработка студии: `npm run typecheck`, `npm test`. `.env` не читать и не печатать; `jobs/`,
`out/`, `.cache/` не коммитить. Платно — только `studio voice` и `studio image`.
