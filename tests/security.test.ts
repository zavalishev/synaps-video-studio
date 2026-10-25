// Границы безопасности студии: шаблоны своих команд (подстановка без разбора shell),
// голос и язык от режиссёра, маскировка ключей, пути только внутри папки ролика,
// импорт материалов заказчика без ссылок и лишних файлов.
import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deps, fill, ProviderNotConfigured, redact, runCommand, templateProblem } from "../studio/bin/_http";
import { imageConfig, tts, voiceConfig } from "../studio/bin/_providers";
import { jobPath } from "../studio/bin/_lib";
import { importBrand } from "../studio/bin/_job";

const tmp = () => mkdtempSync(join(tmpdir(), "studio-sec-"));

describe("шаблоны команд", () => {
  it("значение не становится командой: $(…), ; и кавычки остаются текстом", () => {
    const d = tmp(), pwned = join(d, "PWNED"), out = join(d, "out.txt");
    for (const evil of [`$(touch ${pwned})`, `x;touch ${pwned};`, `'; touch ${pwned}; '`, `\`touch ${pwned}\``]) {
      runCommand("тест", "printf %s {voice} > {out}", { voice: evil, out }, deps(), 10_000);
      expect(readFileSync(out, "utf8")).toBe(evil);
      expect(existsSync(pwned)).toBe(false);
    }
  });
  it("плейсхолдер в кавычках — ошибка настройки, а не выполнение", () => {
    for (const tpl of [`say -v "{voice}" -o {out}`, `say -v '{voice}' -o {out}`, `sh -c "x {voice}"`]) {
      expect(() => fill(tpl, { voice: "a", out: "b" })).toThrow(ProviderNotConfigured);
    }
    expect(templateProblem("VOICE_COMMAND", `say -v "{voice}" -f {text_file}`, ["voice", "text_file"])).toMatch(/кавычки вокруг \{voice\}/);
    expect(voiceConfig({ VOICE_PROVIDER: "command", VOICE_COMMAND: `say -v '{voice}' -o {out_wav}` }).ready).toBe(false);
    expect(imageConfig({ IMAGE_PROVIDER: "command", IMAGE_COMMAND: `gen --p "{prompt_file}" {out_png}` }).ready).toBe(false);
    // кавычки вокруг другого текста и неизвестные {имена} — можно
    expect(fill(`printf '[{"a":1}]' > {out}; echo {HOME}`, { out: "o" }).cmd).toBe(`printf '[{"a":1}]' > "\${STUDIO_CMD_OUT}"; echo {HOME}`);
  });
  it("голос и язык от режиссёра проверяются до запуска провайдера", async () => {
    const env = { VOICE_PROVIDER: "command", VOICE_COMMAND: "printf a > {out_wav}" };
    await expect(tts({ text: "a", voice: "$(id)" }, { env })).rejects.toThrow(/недопустимое имя голоса/);
    await expect(tts({ text: "a", lang: "ru;id" }, { env })).rejects.toThrow(/недопустимый код языка/);
    const ok = await tts({ text: "a", voice: "Milena (Enhanced)", lang: "pt-BR" }, { env });
    expect(ok.audio.toString()).toBe("a");
  });
});

describe("маскировка ключей", () => {
  it("значения любых *KEY/*TOKEN/*SECRET из окружения и типовые форматы", () => {
    const env = { KIMI_TOKEN: "kimi-0123456789abcdef", MY_SECRET: "hunter22hunter" };
    const s = redact([
      "token kimi-0123456789abcdef and hunter22hunter",
      "Authorization: Bearer abc.def-ghi_jkl",
      "xi-api-key: 0123456789abcdef0123",
      "sk_0123456789abcdefghijABCD hf_0123456789abcdefghijABCD r8_0123456789abcdefghijABCD",
    ].join("\n"), env);
    expect(s).not.toMatch(/kimi-0123|hunter22|abc\.def|0123456789abcdef0123|sk_0123|hf_0123|r8_0123/);
  });
});

describe("пути только внутри папки ролика", () => {
  it("абсолютные, «..» и ссылки наружу не проходят", () => {
    const root = tmp(), job = join(root, "job"), outside = join(root, "secret.txt");
    mkdirSync(join(job, "public"), { recursive: true });
    writeFileSync(outside, "x");
    writeFileSync(join(job, "public", "a.png"), "x");
    symlinkSync(outside, join(job, "public", "link.png"));
    symlinkSync(join(root, "nowhere"), join(job, "public", "dangling.png"));
    expect(jobPath(job, "public/a.png")).toBe(join(job, "public", "a.png"));
    expect(jobPath(job, "public/new/b.png")).toBe(join(job, "public", "new", "b.png"));
    expect(jobPath(job, outside)).toBeNull();
    expect(jobPath(job, "../secret.txt")).toBeNull();
    expect(jobPath(job, "public/../../secret.txt")).toBeNull();
    expect(jobPath(job, "public/link.png")).toBeNull();
    expect(jobPath(job, "public/dangling.png")).toBeNull();
  });
});

describe("материалы заказчика (--brand)", () => {
  it("копируются только картинки и brand.json, без ссылок и скрытых файлов", () => {
    const root = tmp(), src = join(root, "brand"), job = join(root, "job");
    mkdirSync(join(src, "photos"), { recursive: true });
    mkdirSync(join(src, "other"), { recursive: true });
    mkdirSync(join(job, "public"), { recursive: true });
    writeFileSync(join(root, "secret.png"), "s");
    writeFileSync(join(src, "logo.svg"), "<svg/>");
    writeFileSync(join(src, "brand.json"), JSON.stringify({ colors: ["#000"] }));
    writeFileSync(join(src, ".env"), "KEY=1");
    writeFileSync(join(src, "notes.txt"), "t");
    writeFileSync(join(src, "photos", "p1.jpg"), "j");
    writeFileSync(join(src, "other", "x.png"), "o");
    symlinkSync(join(root, "secret.png"), join(src, "photos", "p2.png"));
    const b = importBrand(job, src);
    expect(b).toMatchObject({ logo: "brand/logo.svg", photos: ["brand/photos/p1.jpg"], refs: [], colors: ["#000"] });
    expect(readdirSync(join(job, "public", "brand")).sort()).toEqual(["brand.json", "logo.svg", "photos"]);
    expect(readdirSync(join(job, "public", "brand", "photos"))).toEqual(["p1.jpg"]);
  });
});
