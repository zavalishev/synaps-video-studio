// Blender без окна: запустить bpy-скрипт и получить PNG / секвенцию / GLB.
//   studio blender script.py [--out public/3d/hero.png] [--timeout 600] [-- <свои аргументы скрипта>]
// Запуск: blender -b --factory-startup -noaudio, в sys.path добавлен studio/lib/blender
// (import sx — помощник: reset, camera, sun, material, setup_render, render_still,
// render_frames, export_glb; см. docstring sx.py). Скрипту передаются «--out <абсолютный путь>»
// и всё после «--». Сторож по времени убивает зависший Blender. Пути — от папки ролика.
// Печатает созданные файлы (строки SX_OUT из скрипта) и время.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { die, ensureDir, inJob, jobDir, LIB, num, parseArgs, str } from "./_lib";

const a = parseArgs();
const dir = jobDir(a);
const script = a._[0] ? inJob(dir, a._[0]) : die("нужен скрипт: studio blender script.py");
if (!existsSync(script)) die(`нет файла ${script}`);
const out = inJob(dir, str(a, "out", "public/3d/render.png")!);
ensureDir(dirname(out));
const timeoutSec = num(a, "timeout", 600)!;
// Blender: $BLENDER, иначе первый найденный (Homebrew, приложение macOS, Linux), иначе из PATH.
const BLENDER = process.env.BLENDER ?? ["/opt/homebrew/bin/blender", "/usr/local/bin/blender", "/Applications/Blender.app/Contents/MacOS/Blender", "/usr/bin/blender", "/snap/bin/blender"].find((p) => existsSync(p)) ?? "blender";
const pre = `import sys; sys.path.insert(0, ${JSON.stringify(join(LIB, "blender"))})`;
const extra = (a["--"] as string[] | undefined) ?? [];
const argv = ["-b", "--factory-startup", "-noaudio", "--python-exit-code", "1", "--python-expr", pre, "--python", script, "--", "--out", out, ...extra];

const t = Date.now();
const p = spawn(BLENDER, argv, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
const outs: string[] = [];
let log = "";
const onData = (b: Buffer) => {
  const s = b.toString();
  log += s;
  if (log.length > 400_000) log = log.slice(-200_000);
  for (const line of s.split("\n")) {
    if (line.startsWith("SX_OUT ")) outs.push(line.slice(7).trim());
    else if (/^SX_(WARN|STATS|INFO) /.test(line)) process.stderr.write(line + "\n");
    else if (/Error|Traceback|error:/i.test(line)) process.stderr.write(line + "\n");
  }
};
p.stdout.on("data", onData);
p.stderr.on("data", onData);
const timer = setTimeout(() => { console.error(`сторож: Blender дольше ${timeoutSec} с — убиваю`); p.kill("SIGKILL"); }, timeoutSec * 1000);
p.on("close", (code) => {
  clearTimeout(timer);
  const sec = ((Date.now() - t) / 1000).toFixed(1);
  if (code !== 0) {
    console.error(log.split("\n").slice(-40).join("\n"));
    die(`Blender завершился с кодом ${code} за ${sec} с`);
  }
  const files = outs.length ? outs : existsSync(out) ? [out] : [];
  for (const f of files) {
    if (existsSync(f) && statSync(f).isFile()) console.log(f);
    else {
      // секвенция: префикс → перечислить кадры
      const d = dirname(f), base = f.slice(d.length + 1);
      const seq = existsSync(d) ? readdirSync(d).filter((x) => x.startsWith(base)).sort() : [];
      console.log(seq.length ? `${join(d, seq[0])} … ${seq[seq.length - 1]} (${seq.length} кадров)` : `${f} (нет файлов!)`);
    }
  }
  console.error(`Blender: ${sec} с`);
});
