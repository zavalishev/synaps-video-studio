# Synaps Video Studio

**An agentic AI motion-design studio for short vertical videos: Reels, Shorts, TikTok.**
You write a brief, an AI agent runs as the director on your own subscription, and you get a
finished MP4. The director can be **Claude Code** (Claude subscription) or **Codex** (ChatGPT
subscription) — use whichever you have.

> Made by the Synaps team — [synapschat.com](https://synapschat.com)

[Русская версия](README.md)

The director doesn't fill in a template. It reads the brief and the studio guide
(`studio/CLAUDE.md`), comes up with a concept, picks style, typeface, palette, camera and pace,
builds the scenes in [Remotion](https://www.remotion.dev), looks at the frames, checks its own
work and renders the video. The studio's twenty skills give it knowledge, helpers and checks,
not ready-made recipes.

You bring your own voice and image providers: OpenAI, ElevenLabs (including your own cloned
voice), Google Gemini, or any program of your own such as Kimi-Audio, Piper, Silero or ComfyUI.
With a ChatGPT subscription, Codex can generate the images for free — no API key. You can also
connect nothing. You then get a video without narration or generated images, built
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

You need macOS (primary platform) or Linux, Node 22+ (tested on 24, see `.nvmrc`), ffmpeg, an
internet connection (rendering fetches Google Fonts) and **one of the agents**:

- [Claude Code](https://claude.com/claude-code) with a Claude Pro or Max subscription;
- [Codex CLI](https://github.com/openai/codex) with a ChatGPT Plus or Pro subscription.

You can install both and pick per video. On a Mac, install
[Homebrew](https://brew.sh) first if you don't have it: it also installs the Xcode Command Line
Tools that `git` needs.

```bash
# 1. Tools (Linux: see below)
brew install node ffmpeg
# the agent — one or both:
curl -fsSL https://claude.ai/install.sh | bash   # Claude Code; installs to ~/.local/bin — add it to PATH if `claude` isn't found
npm i -g @openai/codex                           # Codex CLI

# 2. The studio
git clone https://github.com/zavalishev/synaps-video-studio && cd synaps-video-studio
npm run setup                                    # packages, tool check, .env, whisper model, doctor

# 3. Sign in with your subscription, once
claude                                           # Claude Code: inside, /login
codex login                                      # Codex: sign in with ChatGPT
```

Then either:

- **4a. In a session.** Start `claude` or `codex -s danger-full-access` in the repository root
  and say: "make a video from examples/briefs/07-en-bakery.md". Codex runs without its sandbox
  because rendering needs a browser that doesn't start inside the Codex sandbox (see Security);
  in a plain `codex` session you'll approve leaving the sandbox for every render.
- **4b. Headless.** `npm run make -- --brief examples/briefs/07-en-bakery.md` — the installed
  agent becomes the director (Claude Code if both are installed). Pick explicitly with
  `--agent codex` or `--agent claude`, or permanently with `STUDIO_AGENT=codex` in `.env`.

A run takes 10–20 minutes and prints its progress; don't interrupt it (an interrupted run
continues with `--resume`, see below). At the end it prints JSON: the video path is in the
`final` field, usually `jobs/<name>/out/final.mp4`, where the folder name comes from the brief's
title.

**Free voice on a Mac.** No keys yet? The built-in macOS synthesizer is enough for a first
video. Put this in `.env`:

```bash
VOICE_PROVIDER=command
VOICE_COMMAND=say -v Samantha -f {text_file} -o {out_wav} --data-format=LEI16@22050
```

(For Russian use `-v Milena`.) A voice may need downloading first: System Settings →
Accessibility → Spoken Content → System voice → Manage Voices. Check with `npm run doctor`.

**Free images with a ChatGPT subscription.** If you've signed in to Codex (`codex login`), put
`IMAGE_PROVIDER=codex` in `.env`: Codex's built-in generator makes the images — with transparent
backgrounds and references, about 30–60 seconds per image, counted against your subscription.
It works with either director, including Claude Code.

**Optional:** `brew install --cask blender` for 3D assets (tested on Blender 5.2; older versions
may not work) and `brew install whisper-cpp` for precise word timings in captions.
`npm run setup` offers to download a whisper model (about 0.5 GB, free, SHA-256 verified).

**Linux.** Install Node 24 with [nvm](https://github.com/nvm-sh/nvm) (`nvm install 24`) or
NodeSource: apt usually ships Node 18 or 20, which is too old. ffmpeg: `sudo apt install ffmpeg`.
Chrome Headless Shell, which Remotion renders with, needs system libraries:
<https://www.remotion.dev/docs/miscellaneous/linux-dependencies>. Blender:
`sudo snap install blender --classic`.

### Example briefs

| Example | What it needs |
|---|---|
| `01-coffee-promo` … `05-event` (Russian) | nothing required; voice and images make it better |
| `06-3d-product` (Russian) | Blender |
| `07-en-bakery` (English) | same as 01–05; an English brief gives an English video |

## How to use it

### As a skill, in a Claude Code or Codex session

`make-video` is a project skill: it works when `claude` or `codex` is started in this
repository's root (Claude Code reads it from `.claude/skills`, Codex from `.agents/skills`), and
there is nothing to install in your home folder. You can also call it explicitly: `/make-video`
in Claude Code, `$make-video` in Codex.

Run `claude` or `codex` in the repository root and ask in plain words: "make a reel for a flower shop
about five plant-care mistakes", "fix the ending of the last video". The
[`make-video`](.claude/skills/make-video/SKILL.md) skill turns your request into a brief, creates
a job folder and starts the director in one of two modes.

- **Solo** (default). The director works headless in the background in two stages with a clean
  context each: build, then polish. You get the file, the concept in one line, time, cost and
  the "questions for the client".
- **Together**. Say "let's do it together" or "show me concepts". The session itself becomes
  the director: it shows three directions to choose from, a contact sheet and the check
  results. This mode is also the handy way to revise a finished video.

Claude Code asks for permission before terminal commands. Launching a video (`npm run make`) and
`npm run doctor` are pre-approved in `.claude/settings.json`; approve the rest yourself (you can
choose "always for this project"). Codex started with its sandbox asks to leave it to launch
the director and render: they need the network and a browser. While a question waits for an
answer, the work stalls.

### One command

```bash
npm run make -- --brief path/to/brief.md  # or --brief "brief text"
```

| Flag | What it does |
|---|---|
| `--agent claude\|codex` | who directs (default: `STUDIO_AGENT` from `.env`, else the installed one; Claude Code if both) |
| `--slug name` | job folder name (`jobs/<slug>/`) |
| `--brand dir` | client materials: `logo.svg/png`, `photos/`, `refs/`, `brand.json` (`{colors, fonts, words: {use, avoid}}`) |
| `--author "@handle"` | sign-off in the ending |
| `--size 1080x1920`, `--fps 30` | format |
| `--model`, `--effort` | director model and effort (default: the agent's default for your account; the director does not read your personal `~/.claude` settings or `~/.codex/config.toml`) |
| `--max-budget-usd 6` | hard cap for the whole run, at API prices (Claude Code only: Codex doesn't report prices) |
| `--timeout-min 90` | wall-clock cap — for either agent |
| `--resume --slug name` | continue an interrupted run in `jobs/<name>/` |
| `--dry-run` | only create the job folder |

The job folder ends up with `out/final.mp4`, `notes.md` (the director's decisions, what was
checked, "questions for the client"), `director.log` and `director.result.json` (time, turns,
and cost with Claude Code or tokens with Codex). If the director left major issues open, you get `out/candidate.mp4` with status
`needs-stage-2` instead of `final.mp4`. Continue with `npm run make -- --resume --slug <folder name>`.

### By hand

```bash
studio/bin/studio new cafe --brief path/to/brief.md
cd jobs/cafe && PATH="$PWD/../../studio/bin:$PATH" claude    # or codex -s danger-full-access
```

The job folder already contains `CLAUDE.md` and `AGENTS.md` (the same director's guide, for
Claude Code and for Codex) and the skills in `.claude/skills/` and `.agents/skills/`.
`studio help` lists the tools.

## Providers

All settings live in `.env`. It is git-ignored; a commented template is in
[`.env.example`](.env.example). `npm run doctor` shows what is connected and what the director
can do.

| Step | Variable | Options | Without it |
|---|---|---|---|
| Voice | `VOICE_PROVIDER` | `openai` · `elevenlabs` · `command` · `none` | music plus on-screen text |
| Images | `IMAGE_PROVIDER` | `openai` · `gemini` · `codex` · `command` · `none` | code graphics, paper, 3D, your photos |
| Word timings | `ASR_PROVIDER` | `auto` · `whisper` · `openai` · `none` | estimate from word length, with a warning |

| Provider | Capabilities | Keys in `.env` |
|---|---|---|
| OpenAI TTS | speaking instructions (`--style`), 13 voices | `OPENAI_API_KEY`, `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE` |
| ElevenLabs | your own cloned voice, word timings returned with the audio | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL` |
| OpenAI Images | transparent background, `--ref` reference images | `OPENAI_API_KEY`, `OPENAI_IMAGE_MODEL` |
| Google Gemini | references; no transparency (remove backgrounds with `IMAGE_BG_COMMAND`, e.g. rembg) | `GEMINI_API_KEY`, `GEMINI_IMAGE_MODEL` |
| Codex (ChatGPT subscription) | transparent backgrounds, `--ref` references; no key, uses your plan's limit | — (sign in: `codex login`) |
| `command` | any program of your own for voice or images | `VOICE_COMMAND`, `IMAGE_COMMAND` |

### Your own voice with ElevenLabs

Voice cloning needs a paid ElevenLabs plan: Instant Voice Clone from Starter, Professional Voice
Clone from Creator.

1. In ElevenLabs open Voices → Add voice → Instant or Professional Voice Clone and record a
   sample of your voice.
2. Copy the new voice's Voice ID.
3. Create an API key (Developers → API Keys) with the **Text to Speech** permission: new keys
   have scoped permissions chosen at creation.
4. Put it in `.env`:

```bash
VOICE_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=your_key
ELEVENLABS_VOICE_ID=your_voice_id
ELEVENLABS_MODEL=eleven_multilingual_v2
```

ElevenLabs returns word timings together with the audio, so captions don't need whisper.

### Your own model: Piper, Silero, Kimi-Audio… (`command`)

The studio runs your command and fills in the paths. The line's text is passed only as a file,
and every placeholder becomes an already-quoted environment variable, so quotes and special
characters can't break the command. **Don't put placeholders in quotes yourself**: write
`say -v {voice}`, not `say -v "{voice}"` (`npm run doctor` will point it out).

| Placeholder | Meaning |
|---|---|
| `{text_file}` | file with the line's text (UTF-8) |
| `{out_wav}` | where to write audio (wav, mp3 or anything ffmpeg reads) |
| `{voice}`, `{lang}` | voice and language (`ru` by default) |
| `{style_file}` | speaking instructions, may be empty |
| `{words_json}` | optional: write `[{"text","start","end"}]` in seconds here and ASR is skipped |

```bash
VOICE_PROVIDER=command
# macOS, free:    VOICE_COMMAND=say -v Samantha -f {text_file} -o {out_wav} --data-format=LEI16@22050
# Piper:          VOICE_COMMAND=piper --model ~/piper/en_US-amy-medium.onnx --output_file {out_wav} < {text_file}
# your server:    VOICE_COMMAND=curl -sf -X POST http://localhost:8020/tts --data-binary @{text_file} -o {out_wav}
# your wrapper:   VOICE_COMMAND=python3 ~/tts/my_tts.py --text-file {text_file} --out {out_wav}
```

On a Mac without an NVIDIA GPU, `say`, Piper, Silero and F5-TTS (MLX build) work well.
Kimi-Audio and other large models expect an NVIDIA GPU: run them on a separate server and call
it with `curl`, as above.

A wrapper for your own model is an ordinary script: read the text from `--text-file`,
synthesize speech, write a wav to `--out`. Below is **a template, not a working program**: you
write `synthesize()` for your model.

```python
# ~/tts/my_tts.py: wrapper template — replace synthesize() with your model call
import argparse, soundfile as sf
p = argparse.ArgumentParser(); p.add_argument("--text-file"); p.add_argument("--out")
a = p.parse_args()
text = open(a.text_file, encoding="utf-8").read()
audio, sr = synthesize(text)      # yours to write: Silero, XTTS, F5-TTS, Kimi-Audio…
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

- **The director** is Claude Code or Codex. Both follow one guide (`studio/CLAUDE.md`; inside a
  job folder it's `CLAUDE.md` and `AGENTS.md`), which sets the bar: the video is
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

- **Claude Code director:** one video is roughly **$2–4** at API prices and **10–20 minutes** on an Apple
  Silicon Mac. That's a ballpark from our runs, not a promise: it depends on the director model
  (Opus costs noticeably more than Sonnet), the brief and the number of revisions. On a Claude
  subscription this uses your plan's usage limit rather than a separate bill. How many videos fit
  in a Pro usage window is hard to predict (our rough guess: one or two); Max is more comfortable
  for regular work.
- **Codex director:** Codex doesn't report an API-price equivalent, so the run summary shows
  tokens; on a ChatGPT subscription that's also usage of your plan's limit, not a separate bill.
  The cap is time (`--timeout-min`).
- **Cap:** for Claude Code, `--max-budget-usd` (default 6) caps a run. When it's reached, Claude Code stops the
  director; the work so far stays in the job folder, and
  `npm run make -- --resume --slug <folder name>` continues it (with a fresh cap).
- **Heads-up:** if `ANTHROPIC_API_KEY` is set in your environment, Claude Code bills the API
  account instead of your subscription. The launcher warns about it.
- **Voice and images** are billed to your own keys at the providers' prices. A typical video
  uses up to 12 images and a few lines of narration, and repeats are free thanks to the cache.
  `command` and `none` cost nothing; with `IMAGE_PROVIDER=codex` images count against your
  ChatGPT subscription.
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
- The directors are Claude Code and Codex. Other agents that read `AGENTS.md` can run a video in
  their own interactive session, but haven't been tested.
- Rendering needs internet access: Google Fonts are fetched at render time. The first render
  also downloads Chrome Headless Shell for Remotion (`npm run setup` does this ahead of time).

## Licensing

- **Studio code: Apache License 2.0** ([`LICENSE`](LICENSE), [`NOTICE`](NOTICE)). You may use,
  modify and redistribute it, including in commercial products. When you copy or fork it, keep
  `LICENSE` and `NOTICE` (attribution: Alik Zavalishev / Synaps) and mark your changes in the
  modified files.
- **Remotion has its own license, not Apache.** It is free for individuals, non-profits and
  companies of **up to 3 people**. Larger companies need a paid company license:
  <https://www.remotion.dev/license>.
- **Sound effects** in `public/sfx`: Kenney, CC0.
- **Music** in `public/music`: CC0 from OpenGameArt, authors and links in
  [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
- **Fonts** are not bundled. Google Fonts are fetched at render time; nearly all are SIL Open
  Font License 1.1.
- **Generated** voice and images are governed by the terms of the provider you choose.

The full list of third-party components is in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## Security

The director is Claude Code or Codex with terminal access. **It acts with your macOS or Linux
user's rights**: it can run commands, read your files and reach the network. That's how the studio
works: the director writes and runs scenes, Blender scripts and checks itself.

What the studio does to reduce the risk:

- Provider keys live only in `.env` (git-ignored). The studio tools (`studio voice`,
  `studio image`) read it and never print keys: error output masks the values of every variable
  with `KEY`, `TOKEN`, `SECRET`, `PASS` or `AUTH` in its name, plus common key formats.
- A director started by `npm run make` (and in Solo mode) gets no keys in its environment —
  neither from `.env` nor from your shell (`OPENAI_API_KEY`, `*_TOKEN` etc. from `~/.zshrc`).
  Only the agent's own sign-in is kept. In Together mode the director is your own `claude` or
  `codex` session with your own environment.
- **Claude Code:** the Read/Edit/Write tools are denied `.env` and the `studio/` folder (guide,
  skills, tools); git is unavailable. The tool set is trimmed, and MCP servers and your personal
  `~/.claude` settings are not loaded.
- **Codex:** your personal `~/.codex/config.toml` (model, MCP, plugins, notifications) is not
  loaded, and git inside the job folder can't see the studio repository. The Codex sandbox is
  off: the browser Remotion renders with doesn't start inside it, so the rights are the same as
  Claude Code's terminal. For Codex, staying out of `.env` and `studio/` rests on the guide, not
  on permissions.
- After a run, `npm run make` compares `studio/` with its state before the run and warns if the
  director changed anything (the `studioChanged` field in the summary).
- Studio tools read and write files only inside the job folder: a prompt file, reference image
  or lines file from elsewhere never reaches a provider. No value can turn a `VOICE_COMMAND` /
  `IMAGE_COMMAND` placeholder into a command.
- `--brand` copies only images and `brand.json`, skipping symlinks and hidden files.

What this does **not** give you: full isolation. Through the terminal either director can
technically still `cat .env`. So:

- keep only the studio's provider keys in `.env` and set a spending limit in each provider's
  dashboard;
- briefs, client materials and images from strangers can carry text aimed at the AI ("prompt
  injection"). Make such videos under a separate macOS user, in a virtual machine or in a
  container that has none of your personal files or keys.

### Responsibility

- The repository contains no keys and no third-party data. Job folders (`jobs/`) and the cache
  (`.cache/`) are git-ignored.
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
.claude/skills/make-video/   "make a video…" skill (Claude Code; Codex sees it via .agents/skills)
studio/CLAUDE.md             director's guide (CLAUDE.md and AGENTS.md inside a job folder)
studio/bin/                  studio tools (studio <tool>), providers, launcher helpers
studio/lib/                  @studio scene library: frame, motion, fonts, 3D, paper
studio/skills/               20 skills: knowledge, helpers, checks
studio/template/             job folder template
studio/make.ts               headless director launcher (npm run make; agents in studio/bin/_agents.ts)
scripts/setup.mjs            npm run setup
public/sfx, public/music     CC0 sound effects and music
examples/briefs/             example briefs (01–06 in Russian, 07 in English; any language works)
tests/                       studio tests (npm test)
```

Development: `npm run typecheck && npm test`. Improvements to the guide and skills are welcome.
The director writes its own suggestions into each job's `notes.md`, which is a good source of
ideas.
