# AI Video Studio

**An agentic AI motion-design studio for short vertical videos: Reels, Shorts, TikTok.**
You write a brief, Claude Code runs as the director on your own subscription, and you get a
finished MP4.

> Made by: <your name, team or link>

[Русская версия](README.md)

The director doesn't fill in a template. It reads the brief and the studio guide
(`studio/CLAUDE.md`), comes up with a concept, picks style, typeface, palette, camera and pace,
builds the scenes in [Remotion](https://www.remotion.dev), looks at the frames, checks its own
work and renders the video. The studio's twenty skills give it knowledge, helpers and checks,
not ready-made recipes.

You bring your own voice and image providers: OpenAI, ElevenLabs (including your own cloned
voice), Google Gemini, or any program of your own such as Kimi-Audio, Piper, Silero or ComfyUI.
You can also connect nothing. You then get a video without narration or generated images, built
from music, on-screen text, code-drawn graphics and Blender 3D.

> The studio's guide, skills and tool messages are written in Russian, and Russian is the
> best-tested language for the videos too. Claude reads them fine and you can brief it in
> English. See [Limitations](#limitations).

## What it makes

Genres the studio handles today (example briefs live in [`examples/briefs/`](examples/briefs)):

- **Small-business promo.** A café, a workshop, a salon: the offer, price, deadline, address
  and a call to visit. The director makes sure on-screen numbers match the brief.
- **Kids' story.** Paper cut-out or felt, soft night light, a calm pace without flashes.
- **Explainer.** Cards, diagrams, app-screen mockups, one idea in 30 seconds.
- **List or countdown.** "5 mistakes…", "3 ways…" with big numbers and lively typography.
- **Event announcement.** Big date, place and entry info, kinetic typography, bold palette.
- **3D product.** An object modelled in Blender: studio lighting, a camera orbit, modes shown
  as a change in time of day.
- Also: charts and numbers as part of the story, weather and time of day in the scene, 2.5D
  parallax from the client's photos, and a "laptop screen" frame for product demos.

The director makes each video its own way. The studio remembers the look of recent videos and
avoids repeating the same typeface and palette.

## Quick start

You need macOS (primary platform) or Linux, Node 22+ (tested on 24), ffmpeg, and
[Claude Code](https://claude.com/claude-code) with a Claude Pro or Max subscription.

```bash
brew install node ffmpeg                       # 1. on Linux: nodejs 22+ and ffmpeg from your package manager
git clone https://github.com/<owner>/ai-video-studio && cd ai-video-studio   # 2.
npm run setup                                  # 3. packages, tool check, .env, whisper model, doctor
claude                                         # 4. sign in and say: "make a video from examples/briefs/01-coffee-promo.md"
npm run make -- --brief examples/briefs/05-event.md   # 5. or headless: result in jobs/<slug>/out/final.mp4
```

Optional: `brew install --cask blender` for 3D assets and `brew install whisper-cpp` for precise
word timings in captions. `npm run setup` offers to download a whisper model (about 0.5 GB,
free).

## How to use it

### As a skill, in a Claude Code session

Run `claude` in the repository root and ask in plain words: "make a reel for a flower shop
about five plant-care mistakes", "fix the ending of the last video". The
[`make-video`](.claude/skills/make-video/SKILL.md) skill turns your request into a brief, creates
a job folder and starts the director in one of two modes.

- **Solo** (default). The director works headless in the background in two stages with a clean
  context each: build, then polish. You get the file, the concept in one line, time, cost and
  the "questions for the client".
- **Together**. Say "let's do it together" or "show me concepts". The session itself becomes
  the director: it shows three directions to choose from, a contact sheet and the check
  results. This mode is also the handy way to revise a finished video.

### One command

```bash
npm run make -- --brief brief.md          # or --brief "brief text"
```

| Flag | What it does |
|---|---|
| `--slug name` | job folder name (`jobs/<slug>/`) |
| `--brand dir` | client materials: `logo.svg/png`, `photos/`, `refs/`, `brand.json` (`{colors, fonts, words: {use, avoid}}`) |
| `--author "@handle"` | sign-off in the ending |
| `--size 1080x1920`, `--fps 30` | format |
| `--model`, `--effort` | director model and effort (default: Claude Code's default for your account; the director does not read your personal `~/.claude` settings) |
| `--max-budget-usd 6` | hard cap for the whole run, at API prices |
| `--resume` | continue an interrupted run in the same folder |
| `--dry-run` | only create the job folder |

The job folder ends up with `out/final.mp4`, `notes.md` (the director's decisions, what was
checked, "questions for the client"), `director.log` and `director.result.json` (time, turns,
cost). If the director left major issues open, you get `out/candidate.mp4` with status
`needs-stage-2` instead of `final.mp4`. Continue with `--resume`.

### By hand, or with Codex

```bash
studio/bin/studio new cafe --brief brief.md
cd jobs/cafe && PATH="$PWD/../../studio/bin:$PATH" claude    # or codex
```

The job folder already contains `CLAUDE.md` and `AGENTS.md` (the director's guide) and
`.claude/skills/` (all skills). `studio help` lists the tools. The Codex workflow is described in
[`AGENTS.md`](AGENTS.md).

## Providers

All settings live in `.env`. It is git-ignored; a commented template is in
[`.env.example`](.env.example). `npm run doctor` shows what is connected and what the director
can do.

| Step | Variable | Options | Without it |
|---|---|---|---|
| Voice | `VOICE_PROVIDER` | `openai` · `elevenlabs` · `command` · `none` | music plus on-screen text |
| Images | `IMAGE_PROVIDER` | `openai` · `gemini` · `command` · `none` | code graphics, paper, 3D, your photos |
| Word timings | `ASR_PROVIDER` | `auto` · `whisper` · `openai` · `none` | estimate from word length, with a warning |

| Provider | Capabilities | Keys in `.env` |
|---|---|---|
| OpenAI TTS | speaking instructions (`--style`), 13 voices | `OPENAI_API_KEY`, `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE` |
| ElevenLabs | your own cloned voice, word timings returned with the audio | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL` |
| OpenAI Images | transparent background, `--ref` reference images | `OPENAI_API_KEY`, `OPENAI_IMAGE_MODEL` |
| Google Gemini | references; no transparency (remove backgrounds with `IMAGE_BG_COMMAND`, e.g. rembg) | `GEMINI_API_KEY`, `GEMINI_IMAGE_MODEL` |
| `command` | any program of your own for voice or images | `VOICE_COMMAND`, `IMAGE_COMMAND` |

### Your own voice with ElevenLabs

1. In ElevenLabs open Voices → Add voice → Instant or Professional Voice Clone and record a
   sample of your voice.
2. Copy the new voice's Voice ID.
3. Put it in `.env`:

```bash
VOICE_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=your_key
ELEVENLABS_VOICE_ID=your_voice_id
ELEVENLABS_MODEL=eleven_multilingual_v2
```

ElevenLabs returns word timings together with the audio, so captions don't need whisper.

### Kimi-Audio, Piper or any model of your own (`command`)

The studio runs your command and fills in the paths. The line's text is passed only as a file,
so quotes and special characters can't break the command.

| Placeholder | Meaning |
|---|---|
| `{text_file}` | file with the line's text (UTF-8) |
| `{out_wav}` | where to write audio (wav, mp3 or anything ffmpeg reads) |
| `{voice}`, `{lang}` | voice and language (`ru` by default) |
| `{style_file}` | speaking instructions, may be empty |
| `{words_json}` | optional: write `[{"text","start","end"}]` in seconds here and ASR is skipped |

```bash
VOICE_PROVIDER=command
VOICE_COMMAND=python3 ~/tts/kimi_tts.py --text-file {text_file} --out {out_wav}
# Piper:   VOICE_COMMAND=piper --model ~/piper/en_US-amy-medium.onnx --output_file {out_wav} < {text_file}
# macOS:   VOICE_COMMAND=say -v Samantha -f {text_file} -o {out_wav} --data-format=LEI16@22050
```

A wrapper for Kimi-Audio or any other model is an ordinary script: read the text from
`--text-file`, synthesize speech with your model, write a wav to `--out`. Roughly:

```python
# ~/tts/kimi_tts.py: wrapper template, replace synthesize() with your model call
import argparse, soundfile as sf
p = argparse.ArgumentParser(); p.add_argument("--text-file"); p.add_argument("--out")
a = p.parse_args()
text = open(a.text_file, encoding="utf-8").read()
audio, sr = synthesize(text)      # your model: Kimi-Audio, XTTS, F5-TTS, Silero…
sf.write(a.out, audio, sr)
```

Images plug in the same way, through `IMAGE_COMMAND` with `{prompt_file}` `{out_png}` `{width}`
`{height}` `{refs}`. ComfyUI, Stable Diffusion or your own server all work.

Paid requests are cached in `.cache/` by provider, model, voice and text, so repeating the same
request is free. Network failures and 429/5xx responses are retried with a pause.

## How it works

```
brief → doctor (what's connected) → brief facts → three concepts → style (theme.json)
      → voice → beats on words → assets (images, Blender) → Remotion scenes
      → check and frames → review.ts (checks) → fresh-eyes critic
      → gated render → probe → notes.md and "questions for the client"
```

- **The director** is Claude Code. The guide (`studio/CLAUDE.md`) sets the bar: the video is
  watched on a phone in a feed, nothing slides off the edge, text is readable, no jerks and no
  empty frames. How to get there is the director's call.
- **Tools** (`studio/bin`, run as `studio <tool>`): `doctor`, `voice`, `image`, `blender`,
  `still`, `sheet`, `render`, `probe`, `check`, `looks`, `sfx`, `music`, `fonts`, `facts`,
  `skill`, `api`.
- **Checks.** `studio check` catches non-determinism. `review.ts` inspects the draft for
  off-frame elements, contrast, text size, camera jerks and whether numbers match the
  narration. The critic sub-agent sees only the brief and feed-style tiles, without the build
  history. The final file is not released while major issues are open.
- **Skills** (`studio/skills`, card view: `studio skill <name>`):

| Area | Skills |
|---|---|
| Direction | `art-direction` (style bible), `beat-planner` (storyboard from sound), `transitions` (editing without whooshes), `sound-design` (music, ambience, mix) |
| Truth | `claims-and-compliance` (brief facts, claims, regulated categories, client questions) |
| 2D | `kinetic-typography`, `paper-2d`, `explainer-cards`, `data-viz`, `generated-imagery`, `fx-particles`, `presentation-frame` |
| 3D | `blender-asset-factory`, `object-scene-3d`, `typography-3d`, `materials`, `scene-state` |
| Quality | `camera-choreography`, `layout-guard`, `self-review` |

## Cost and time

- **Director:** one video is roughly **$2–4** at API prices and **10–20 minutes** on an Apple
  Silicon Mac (from our runs). On a Claude subscription this uses your plan's usage limit rather
  than a separate bill. On Pro a usage window may cover one or two videos; Max is more
  comfortable for regular work. `--max-budget-usd` (default 6) caps a run.
- **Heads-up:** if `ANTHROPIC_API_KEY` is set in your environment, Claude Code bills the API
  account instead of your subscription. The launcher warns about it.
- **Voice and images** are billed to your own keys at the providers' prices. A typical video
  uses up to 12 images and a few lines of narration, and repeats are free thanks to the cache.
  `command` and `none` cost nothing.
- **Rendering, sound effects, music, Blender and whisper** run locally and are free.

## Limitations

- The studio is tuned for Russian: the guide and skills are in Russian, fonts are picked for
  Cyrillic, and narration defaults to `ru`. Other languages work (`--lang`, `"lang"` in
  `lines.json`) but are less tested.
- Format: short videos up to about 60 seconds, vertical 1080×1920 by default.
- The studio does not generate video, music or image-to-3D. Motion is built in code and Blender,
  and music comes from a CC0 catalogue.
- The director is an AI. It checks its own work, but watch the video and read the "questions
  for the client" before publishing.
- macOS is the primary platform. Linux should work but is less tested. Windows is not supported
  (WSL2 may work).
- The one-command launcher is built for Claude Code. With Codex and other agents, a video is
  made in an interactive session following `AGENTS.md`.
- The first render downloads Chrome Headless Shell for Remotion. `npm run setup` does this
  ahead of time.

## Licensing

- **Studio code: MIT** ([`LICENSE`](LICENSE)). Fill in your own copyright line.
- **Remotion has its own license, not MIT.** It is free for individuals, non-profits and
  companies of **up to 3 people**. Larger companies need a paid company license:
  <https://www.remotion.dev/license>.
- **Sound effects** in `public/sfx`: Kenney, CC0.
- **Music** in `public/music`: CC0 from OpenGameArt, authors and links in
  [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
- **Fonts** are not bundled. Google Fonts are fetched at render time; nearly all are SIL Open
  Font License 1.1.
- **Generated** voice and images are governed by the terms of the provider you choose.

The full list of third-party components is in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## Safety and responsibility

- The repository contains no keys and no third-party data. Your keys live only in `.env`, which
  stays out of git. Studio tools read it themselves and never print keys. The director doesn't
  receive the keys, and the launch rules forbid it from reading `.env`.
- Job folders (`jobs/`) and the cache (`.cache/`) are git-ignored too.
- You are responsible for the content and publication of your videos. The director doesn't
  invent numbers or promises and lists its assumptions as "questions for the client", but
  checking them is up to you.
- Clone only your own voice or the voice of someone who has agreed to it. Don't use other
  companies' logos and brands, or real people without their consent.
- Ads in regulated categories (medicine, supplements, finance, alcohol, children) follow the
  `claims-and-compliance` skill. It points out the mandatory disclaimers under Russian
  advertising law (38-FZ) and reminds you about ad labelling (erid). This is guidance, not
  legal advice.

## Layout

```
.claude/skills/make-video/   Claude Code skill: "make a video…"
studio/CLAUDE.md             director's guide (CLAUDE.md and AGENTS.md inside a job folder)
studio/bin/                  studio tools (studio <tool>), providers, launcher helpers
studio/lib/                  @studio scene library: frame, motion, fonts, 3D, paper
studio/skills/               20 skills: knowledge, helpers, checks
studio/template/             job folder template
studio/make.ts               headless director launcher (npm run make)
scripts/setup.mjs            npm run setup
public/sfx, public/music     CC0 sound effects and music
examples/briefs/             example briefs (in Russian; any language works for a brief)
tests/                       studio tests (npm test)
```

Development: `npm run typecheck && npm test`. Improvements to the guide and skills are welcome.
The director writes its own suggestions into each job's `notes.md`, which is a good source of
ideas.
