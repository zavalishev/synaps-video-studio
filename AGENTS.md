# AI Video Studio — for Codex and other coding agents

> Если текущая папка — папка ролика (`jobs/<slug>/`, в ней `job.json`), этот файл не про тебя:
> ты режиссёр, руководство — `AGENTS.md` в папке ролика (это `studio/CLAUDE.md`).
> Inside a job folder you are the director; follow the `AGENTS.md` there.

Студия роликов: агент — режиссёр, `studio/` — инструменты и скиллы. Готовый запуск без окна
(`npm run make`) рассчитан на Claude Code; с Codex ролик делается вручную, в интерактивной сессии:

1. `npm run setup` (один раз), затем `studio/bin/studio doctor` — что подключено.
2. Бриф: `jobs/<slug>.brief.md` — кто публикует, что продвигаем, зритель, площадка, факты дословно,
   допущения. Цифры и обещания не выдумывать.
3. `studio/bin/studio new <slug> --brief jobs/<slug>.brief.md` и работа в `jobs/<slug>/`:
   прочитать `AGENTS.md` этой папки целиком и идти по его производственному циклу. Команды —
   из папки ролика с `PATH="<repo>/studio/bin:$PATH"`; скиллы — `studio skill <имя>`.
4. Критика-субагента в Codex нет — свежий взгляд делается вторым проходом по
   `.claude/skills/self-review/critic.md`: только бриф, текст речи и плитки, без истории сборки.

Разработка студии: `npm run typecheck`, `npm test`. `.env` не читать и не печатать; `jobs/`,
`out/`, `.cache/` не коммитить. Платно — только `studio voice` и `studio image`.
