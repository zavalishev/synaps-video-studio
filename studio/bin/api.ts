// Короткая справка по API библиотеки студии — вместо чтения исходников (дорого по контексту).
//   studio api                      — список модулей
//   studio api studio               — экспорты корня @studio
//   studio api kinetic-typography   — экспорты @studio/kinetic-typography (props компонентов, аргументы)
//   studio api paper-2d Puppet      — только экспорты, в имени которых есть «Puppet»
// Типы печатаются компилятором TypeScript (укороченно); подробности и «зачем» — в SKILL.md скилла.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { LIB, parseArgs, STUDIO } from "./_lib";

const a = parseArgs();
const mod = a._[0];
const filter = a._[1]?.toLowerCase();
const entry = (m: string): string | null => {
  if (m === "studio") return join(LIB, "index.ts");
  for (const f of [`${m}.tsx`, `${m}.ts`, `${m}/index.ts`, `${m}/index.tsx`]) if (existsSync(join(LIB, f))) return join(LIB, f);
  return null;
};
const modules = ["studio", ...readdirSync(LIB, { withFileTypes: true }).filter((d) => d.isDirectory() && (existsSync(join(LIB, d.name, "index.ts")) || existsSync(join(LIB, d.name, "index.tsx")))).map((d) => d.name), "three"];
if (!mod) { console.log(`модули: ${modules.join(", ")}\nstudio api <модуль> [фильтр]`); process.exit(0); }
const file = entry(mod);
if (!file) { console.error(`нет модуля ${mod}; есть: ${modules.join(", ")}`); process.exit(2); }

const cfg = ts.readConfigFile(join(STUDIO, "tsconfig.json"), ts.sys.readFile).config;
const parsed = ts.parseJsonConfigFileContent(cfg, ts.sys, STUDIO);
const program = ts.createProgram([file], { ...parsed.options, noEmit: true });
const checker = program.getTypeChecker();
const sf = program.getSourceFile(file)!;
const sym = checker.getSymbolAtLocation(sf);
const exps = sym ? checker.getExportsOfModule(sym) : [];
const flags = ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope | ts.TypeFormatFlags.WriteArrowStyleSignature | ts.TypeFormatFlags.NoTruncation;
const short = (s0: string, n = 700) => { const s = s0.replace(/ \| undefined/g, ""); return s.length > n ? s.slice(0, n) + " …" : s; };
let out = 0;
for (const e0 of exps.sort((p, q) => p.name.localeCompare(q.name))) {
  if (filter && !e0.name.toLowerCase().includes(filter)) continue;
  const e = e0.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(e0) : e0;
  const decl = e.declarations?.[0];
  if (!decl) continue;
  if (e.flags & (ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Interface)) {
    console.log(`type ${e0.name} = ${short(checker.typeToString(checker.getDeclaredTypeOfSymbol(e), undefined, flags))}`);
  } else {
    const t = checker.getTypeOfSymbolAtLocation(e, decl);
    let s = checker.typeToString(t, undefined, flags);
    // Компонент: показать только props.
    const m = s.match(/^React\.FC<(.*)>$/s) ?? s.match(/^FC<(.*)>$/s);
    if (m) s = `<${e0.name} ${m[1]} />`; else s = `${e0.name}: ${s}`;
    console.log(short(s));
  }
  out++;
}
console.error(`${out} экспортов ${mod === "studio" ? "@studio" : `@studio/${mod}`}`);
