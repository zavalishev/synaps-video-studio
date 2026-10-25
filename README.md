# AI Video Studio

Агентная студия коротких вертикальных роликов (Reels, Shorts, TikTok). Режиссёр — Claude Code
по вашей подписке: он читает бриф и руководство студии (`studio/CLAUDE.md`), сам выбирает
концепт, стиль, камеру и инструменты, собирает сцены на Remotion, проверяет кадры и выпускает
`out/final.mp4`. Скиллы (`studio/skills/`) — знания, помощники и проверки, а не шаблоны.

Озвучку и картинки вы подключаете свои: OpenAI, ElevenLabs (в том числе свой клонированный
голос), Google Gemini или любую свою программу (Kimi-Audio, Silero, Piper, XTTS, ComfyUI…).
Без них студия тоже работает: ролик без голоса и без сгенерированных картинок — музыка, текст,
графика кодом, 3D в Blender.

*An agentic short-video studio. Claude Code (your own subscription) is the director; Remotion
and the skills are the crew. Bring your own voice/image providers, or none at all.*

## Что нужно

- macOS (основная платформа) или Linux; Node 22+ (проверено на 24), ffmpeg.
- [Claude Code](https://claude.com/claude-code) CLI с вашей подпиской — это режиссёр.
- По желанию: Blender (3D-ассеты), whisper.cpp (точные тайминги слов для субтитров).

```bash
# macOS
brew install node ffmpeg
brew install whisper-cpp          # по желанию
brew install --cask blender       # по желанию
```

## Установка

```bash
git clone <этот репозиторий> ai-video-studio && cd ai-video-studio
npm install
cp .env.example .env              # впишите своих провайдеров (или оставьте none)
studio/bin/studio doctor          # что подключено и что режиссёр сможет сделать
npm run typecheck && npm test
```

## Провайдеры (`.env`)

Все настройки — в `.env` (он в `.gitignore`; образец с комментариями — `.env.example`).
Ключи читают только инструменты студии, в вывод они не попадают, а сессии Claude не передаются.

| Шаг | Переменная | Варианты |
|---|---|---|
| Озвучка | `VOICE_PROVIDER` | `openai` · `elevenlabs` · `command` · `none` |
| Картинки | `IMAGE_PROVIDER` | `openai` · `gemini` · `command` · `none` |
| Тайминги слов | `ASR_PROVIDER` | `auto` · `whisper` · `openai` · `none` |

**Озвучка**

- `openai` — `OPENAI_API_KEY`, `OPENAI_TTS_MODEL` (по умолчанию `gpt-4o-mini-tts`, понимает
  указания диктору `--style`), `OPENAI_TTS_VOICE` (`onyx`, `nova`, `coral`…).
- `elevenlabs` — `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL`
  (`eleven_multilingual_v2`). Свой голос: в ElevenLabs Voices → Add voice → Voice Clone, затем
  его Voice ID в `.env`. Тайминги слов приходят вместе с аудио — whisper не нужен.
- `command` — любая программа: `VOICE_COMMAND` с подстановками `{text_file}` (текст реплики),
  `{out_wav}` (куда писать аудио), `{voice}`, `{lang}`, `{style_file}`, по желанию
  `{words_json}` (тайминги слов `[{"text","start","end"}]`). Например:

  ```bash
  VOICE_COMMAND=python3 ~/tts/kimi_tts.py --text-file {text_file} --out {out_wav}
  VOICE_COMMAND=piper --model ~/piper/ru_RU-irina-medium.onnx --output_file {out_wav} < {text_file}
  VOICE_COMMAND=say -v Milena -f {text_file} -o {out_wav} --data-format=LEI16@22050   # macOS, бесплатно
  ```

  Текст передаётся только файлом, подстановки экранируются — в командную строку он не попадает.
- `none` — без голоса: режиссёр делает ролик на музыке и тексте на экране.

**Картинки**

- `openai` — тот же `OPENAI_API_KEY`, `OPENAI_IMAGE_MODEL` (`gpt-image-1`: прозрачный фон и
  референсы `--ref`; `dall-e-3` — без них).
- `gemini` — `GEMINI_API_KEY`, `GEMINI_IMAGE_MODEL` (`gemini-2.5-flash-image`). Референсы — да;
  прозрачного фона нет: для вырезок студия просит белый фон, а убрать его можно своей программой
  `IMAGE_BG_COMMAND=rembg i {in_png} {out_png}` (`pip install "rembg[cli]"`). Размер — только
  соотношением сторон.
- `command` — `IMAGE_COMMAND` с `{prompt_file}` `{out_png}` `{width}` `{height}` `{size}`
  `{quality}` `{background}` `{refs}` (ComfyUI, Stable Diffusion, свой сервер).
- `none` — без генерации: кадр собирается кодом, бумагой (paper-2d), в Blender или из ваших фото.

**Тайминги слов** (`auto`): из ответа озвучки (ElevenLabs, `command` с `{words_json}`) →
whisper.cpp локально (`WHISPER_CPP_MODEL=…/ggml-small.bin`, модели —
[whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp)) → OpenAI transcription, если есть
ключ (платно, копейки) → пропорционально длине слов (с предупреждением).

Платные вызовы кэшируются в `.cache/` по провайдеру, модели, голосу и тексту/промпту: повтор
того же запроса бесплатен. Сетевые сбои и 429/5xx повторяются с паузой.

## Как пользоваться

**Целиком, одной командой** (режиссёр работает сам, 10–20 минут):

```bash
npx tsx studio/make.ts --brief "Ролик для кофейни у моря: осенний сезон, тыквенный латте"
# или --brief brief.md; --author "@handle"; --brand папка_с_logo_photos_brand.json
```

Папка ролика — `jobs/<slug>/`, итог — `jobs/<slug>/out/final.mp4` и `notes.md` с решениями
режиссёра и вопросами заказчику.

**Вместе с режиссёром, как со скиллом** — в обычной интерактивной сессии Claude Code:

```bash
studio/bin/studio new kofeinya --brief "Ролик для кофейни у моря…"
export PATH="$PWD/studio/bin:$PATH"
cd jobs/kofeinya && claude
# > Сделай ролик по brief.md
```

В папке ролика лежат `CLAUDE.md` (руководство режиссёра) и `.claude/skills/` (все скиллы),
поэтому Claude Code сразу ведёт себя как режиссёр студии; вы смотрите кадры и правите по ходу.
Список инструментов — `studio help`.

## Лицензии

- Код студии — лицензия будет указана владельцем репозитория.
- **Remotion** имеет собственную лицензию: бесплатно для физических лиц и компаний до 3 человек;
  остальным нужна коммерческая лицензия компании — см. <https://www.remotion.dev/license>.
- Звуки `public/sfx` — Kenney, CC0 (`public/sfx/LICENSE-kenney.txt`).
- Музыка `public/music` — CC0 с OpenGameArt, источники в `public/music/catalog.json`
  (`public/music/LICENSES.md`).
- Сгенерированные голос и картинки — по условиям выбранного вами провайдера.
