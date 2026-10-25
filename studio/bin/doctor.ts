// Что подключено к студии и что директор может сделать (бесплатно, без сети, ключи не печатает).
//   studio doctor [--json]
// Провайдеры из .env (озвучка, картинки, тайминги слов) и локальные программы (ffmpeg, Blender,
// whisper.cpp, Claude Code CLI). Директор запускает его первым и строит ролик под то, что есть.
// What is configured and what the director can do. No network, never prints keys.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { DOTENV_KEYS, ENV_FILE } from "./_env";
import { asrPlan, imageConfig, SECRET_VARS, voiceConfig } from "./_providers";
import { blenderBin, claudeBin, which, whisperBin, whisperModel } from "./_tools";
import { parseArgs } from "./_lib";

const a = parseArgs(process.argv.slice(2), ["json"]);
const env = process.env;
const voice = voiceConfig(env);
const img = imageConfig(env);
const wBin = whisperBin(env), wModel = whisperModel(env);
const asr = asrPlan(env, { voiceTimestamps: voice.ready && voice.timestamps, whisper: Boolean(wBin && wModel) });
const version = (bin: string | null, args: string[]) => {
  if (!bin) return null;
  const r = spawnSync(bin, args, { encoding: "utf8", timeout: 15_000 });
  return r.status === 0 ? (r.stdout || r.stderr).split("\n")[0].trim() : null;
};
const ffmpeg = which("ffmpeg"), ffprobe = which("ffprobe");
const blender = blenderBin(env);
const blenderOk = blender ? existsSync(blender) || Boolean(which(blender)) : false;
const claude = claudeBin(env);
const node = process.versions.node;
const nodeMajor = Number(node.split(".")[0]);

const keys = Object.fromEntries(SECRET_VARS.map((k) => [k, Boolean(env[k]?.trim())]));
const can: string[] = [], cannot: string[] = [];
if (voice.ready) can.push(`голос: studio voice через ${voice.provider} (${voice.model}${voice.voice ? `, голос ${voice.voice}` : ""}) — платно, вашим ключом${voice.style ? "; --style работает" : "; --style не поддерживается — подачу задаёт текст"}`);
else cannot.push(voice.provider === "none"
  ? "голоса нет (VOICE_PROVIDER=none): ролик без речи — музыка (studio music) + текст на экране, биты по долям музыки и событиям"
  : `голоса нет: ${voice.problem} — до настройки ролик без речи`);
if (img.ready) {
  can.push(`картинки: studio image через ${img.provider} (${img.model}) — платно, вашим ключом`);
  if (!img.transparency) (img.bgRemover ? can : cannot).push(img.bgRemover
    ? "вырезки: провайдер без прозрачности, фон убирает IMAGE_BG_COMMAND"
    : "прозрачных вырезок нет (провайдер их не умеет, IMAGE_BG_COMMAND не задан): предметы — на однотонном фоне, в карточке или из Blender");
  if (!img.refs) cannot.push("референсов (--ref) нет: тот же герой держится только словами промпта — лучше Blender/paper-2d/код");
} else cannot.push(img.provider === "none"
  ? "картинок нет (IMAGE_PROVIDER=none): кадр — кодом (@studio, kinetic-typography, explainer-cards, data-viz), paper-2d, Blender, фото заказчика"
  : `картинок нет: ${img.problem} — до настройки кадр без генерации`);
if (blenderOk) can.push("3D-ассеты: studio blender (бесплатно)"); else cannot.push("Blender не найден: 3D только в кадре (three.js, @studio/three) — без studio blender");
const timingName: Record<string, string> = { voice: "из ответа озвучки", whisper: "whisper.cpp", openai: "OpenAI transcription (платно)", proportional: "пропорционально длине слов (приблизительно)" };
if (voice.ready) (asr[0] === "proportional" ? cannot : can).push(asr[0] === "proportional"
  ? "точных таймингов слов нет: склейки и субтитры по словам приблизительны (поставьте whisper.cpp или ключ OpenAI)"
  : `тайминги слов: ${asr.filter((s) => s !== "proportional").map((s) => timingName[s]).join(" → ")}`);
can.push("сцены Remotion, кадры, рендер, проверки, звуки (studio sfx) и музыка (studio music) — локально и бесплатно");
const missing: string[] = [];
if (!ffmpeg || !ffprobe) missing.push("ffmpeg/ffprobe — без них нет рендера и звука (macOS: brew install ffmpeg; Linux: apt install ffmpeg)");
if (nodeMajor < 22) missing.push(`Node ${node} — нужен 22+ (лучше 24)`);

const report = {
  envFile: existsSync(ENV_FILE) ? ENV_FILE : null, fromEnvFile: DOTENV_KEYS.length,
  voice: { provider: voice.provider, model: voice.model, voice: voice.voice, ready: voice.ready, problem: voice.problem ?? null, timestamps: voice.timestamps, style: voice.style },
  image: { provider: img.provider, model: img.model, ready: img.ready, problem: img.problem ?? null, transparency: img.transparency, refs: img.refs, bgRemover: img.bgRemover },
  timing: asr, keys,
  tools: { node, ffmpeg, ffprobe, blender: blenderOk ? blender : null, whisper: wBin && wModel ? { bin: wBin, model: wModel } : null, claude },
  can, cannot, missing,
};
if (a.json) { console.log(JSON.stringify(report, null, 1)); process.exit(missing.length ? 1 : 0); }

const yes = (b: unknown) => (b ? "да " : "нет");
const L: string[] = [];
L.push("studio doctor — что подключено");
L.push(`.env: ${report.envFile ? `${report.envFile} (${DOTENV_KEYS.length} перем.)` : "нет — скопируйте .env.example в .env и впишите своих провайдеров"}`);
L.push("");
L.push("Провайдеры (.env)");
L.push(`  озвучка   VOICE_PROVIDER=${voice.provider}  ${voice.ready ? `готово: ${voice.model}, голос ${voice.voice}${voice.timestamps ? ", тайминги слов в ответе" : ""}` : voice.problem}`);
L.push(`  картинки  IMAGE_PROVIDER=${img.provider}  ${img.ready ? `готово: ${img.model}; прозрачность ${img.transparency ? "да" : img.bgRemover ? "через IMAGE_BG_COMMAND" : "нет"}, референсы ${img.refs ? "да" : "нет"}` : img.problem}`);
L.push(`  тайминги  ASR_PROVIDER=${env.ASR_PROVIDER || "auto"}  ${asr.map((s) => timingName[s]).join(" → ")}`);
L.push(`  ключи     ${SECRET_VARS.map((k) => `${k} ${keys[k] ? "задан" : "—"}`).join(", ")}`);
L.push("");
L.push("Локальные программы");
L.push(`  [${yes(nodeMajor >= 22)}] node ${node}`);
L.push(`  [${yes(ffmpeg && ffprobe)}] ffmpeg ${version(ffmpeg, ["-version"])?.replace(/^ffmpeg version /, "").split(" ")[0] ?? ""}`);
L.push(`  [${yes(blenderOk)}] blender ${blenderOk ? blender : "(по желанию: blender.org или brew install --cask blender)"}`);
L.push(`  [${yes(wBin && wModel)}] whisper.cpp ${wBin && wModel ? `${wBin}, модель ${wModel}` : wBin ? "есть, но нет модели — WHISPER_CPP_MODEL=…/ggml-small.bin" : "(по желанию: brew install whisper-cpp + модель ggml-small.bin)"}`);
L.push(`  [${yes(claude)}] claude ${claude ?? "(Claude Code CLI — режиссёр: https://claude.com/claude-code)"}`);
L.push("");
L.push("Директор может");
for (const s of can) L.push(`  + ${s}`);
if (cannot.length) { L.push("Директор не может (строит ролик без этого)"); for (const s of cannot) L.push(`  - ${s}`); }
if (missing.length) { L.push("НЕ ХВАТАЕТ"); for (const s of missing) L.push(`  ! ${s}`); }
console.log(L.join("\n"));
process.exit(missing.length ? 1 : 0);
