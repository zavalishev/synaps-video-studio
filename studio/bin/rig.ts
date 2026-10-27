// Скелетная анимация: части героя из листа и проверка поз (бесплатно, локально, sharp).
//   studio rig cut <лист.png> [--name bear] [--alpha 0.5] [--min 0.002]
//       лист частей (studio image --bg transparent, части отдельно, с промежутками) → по связным
//       областям непрозрачности: public/rig/<name>/<часть>.png, черновик public/rig/<name>/rig.json
//       (роли угаданы по раскладке листа: головы — верхний ряд слева направо = head, head-blink,
//       head-talk; самая крупная в середине — torso; слева/справа от неё — armL/armR; ниже — legL/legR;
//       остальное — extraN) и лист частей с номерами out/rig-<name>-parts.png — открыть Read-ом.
//   studio rig cut <лист.png> --object [--name bean] [--limb "#3b2416"]
//       предмет-персонаж (зерно, круассан, зуб): на листе в ряд три версии тела с лицом — обычное,
//       глаза закрыты, рот открыт; ручки и ножки — резиновые, рисуются кодом (hose) цветом --limb.
//   studio rig check [public/rig/<name>/rig.json] [--poses rest,walk,wave,hop,cheer,talk,surprise,sleep]
//       [--out out/rig-<name>-check.png] [--joints]
//       лист поз скелета (та же математика, что <Rig> в кадре): части на месте, суставы не рвутся,
//       руки вверх/в стороны выглядят живо. --joints — точки суставов красным.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import sharp from "sharp";
import { apply, drawList, evaluate, restBounds, rootMatrix, validateRig, type RigAction, type RigDef, type RigPart, type Vec } from "../lib/rig/pose";
import { die, ensureDir, inJob, jobDir, num, parseArgs, str } from "./_lib";

const a = parseArgs(process.argv.slice(2), ["joints", "object"]);
const dir = jobDir(a);
const sub = a._[0];

type Comp = { id: number; n: number; x0: number; y0: number; x1: number; y1: number; cx: number; cy: number };

const cut = async () => {
  const srcArg = a._[1] ?? die("нужен лист: studio rig cut public/rig/bear-parts.png --name bear");
  const src = [inJob(dir, srcArg), inJob(dir, join("public", srcArg))].find((f) => existsSync(f)) ?? die(`нет файла ${srcArg}`);
  const name = str(a, "name", basename(src).replace(/[-_]?parts?\.png$/i, "").replace(/\.png$/i, "") || "hero")!;
  const thr = Math.round(255 * num(a, "alpha", 0.5)!);
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const lab = new Int32Array(W * H);
  const comps: Comp[] = [];
  const stack = new Int32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (lab[i] || data[i * 4 + 3] < thr) continue;
    const id = comps.length + 1;
    const c: Comp = { id, n: 0, x0: W, y0: H, x1: 0, y1: 0, cx: 0, cy: 0 };
    let sp = 0; stack[sp++] = i; lab[i] = id;
    while (sp) {
      const j = stack[--sp], x = j % W, y = (j - x) / W;
      c.n++; c.cx += x; c.cy += y;
      if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      for (const k of [j - 1, j + 1, j - W, j + W]) {
        if (k < 0 || k >= W * H || lab[k] || data[k * 4 + 3] < thr) continue;
        if ((k === j - 1 && x === 0) || (k === j + 1 && x === W - 1)) continue;
        lab[k] = id; stack[sp++] = k;
      }
    }
    c.cx /= c.n; c.cy /= c.n;
    comps.push(c);
  }
  const minN = num(a, "min", 0.002)! * W * H;
  // Мелкие области (отдельные шерстинки, блики) приклеиваем к ближайшей крупной, если рядом; иначе выкидываем.
  const big = comps.filter((c) => c.n >= minN);
  const owner = new Map<number, number>();
  for (const c of comps) {
    if (c.n >= minN) { owner.set(c.id, c.id); continue; }
    const near = big.find((b) => c.cx > b.x0 - 12 && c.cx < b.x1 + 12 && c.cy > b.y0 - 12 && c.cy < b.y1 + 12);
    if (near) { owner.set(c.id, near.id); near.x0 = Math.min(near.x0, c.x0); near.y0 = Math.min(near.y0, c.y0); near.x1 = Math.max(near.x1, c.x1); near.y1 = Math.max(near.y1, c.y1); }
  }
  if (big.length < 2) die(`на листе ${big.length} часть(ей): нужен лист, где части лежат отдельно с промежутками (прозрачный фон). Переделайте studio image (см. studio skill rig-2d)`);
  if (big.length > 24) die(`на листе ${big.length} частей — похоже, фон не прозрачный или части рассыпались; переделайте лист`);

  // Роли по раскладке листа (промпт из скилла rig-2d кладёт части именно так).
  const roles = new Map<number, string>();
  if (a.object) {
    const row = [...big].sort((p, q) => q.n - p.n).slice(0, 3).sort((p, q) => p.cx - q.cx);
    ["torso", "torso-blink", "torso-talk"].forEach((r, i) => { if (row[i]) roles.set(row[i].id, r); });
  }
  const byArea = [...big].sort((p, q) => q.n - p.n);
  const top = big.filter((c) => c.cy < H * 0.36).sort((p, q) => p.cx - q.cx);
  const heads = top.filter((c) => c.n > byArea[0].n * 0.25);
  ["head", "head-blink", "head-talk"].forEach((r, i) => { if (heads[i]) roles.set(heads[i].id, r); });
  const torso = a.object ? undefined : byArea.find((c) => !roles.has(c.id) && c.cy >= H * 0.3);
  if (torso) {
    roles.set(torso.id, "torso");
    const rest = big.filter((c) => !roles.has(c.id));
    const arms = rest.filter((c) => c.cy < torso.y1 && c.cy > torso.y0 - (torso.y1 - torso.y0) * 0.2);
    const armL = arms.filter((c) => c.cx < torso.x0 + 4).sort((p, q) => q.n - p.n)[0];
    const armR = arms.filter((c) => c.cx > torso.x1 - 4).sort((p, q) => q.n - p.n)[0];
    if (armL) roles.set(armL.id, "armL");
    if (armR) roles.set(armR.id, "armR");
    const legs = big.filter((c) => !roles.has(c.id) && c.cy > torso.cy).sort((p, q) => q.n - p.n).slice(0, 2).sort((p, q) => p.cx - q.cx);
    if (legs.length === 2) { roles.set(legs[0].id, "legL"); roles.set(legs[1].id, "legR"); }
  }
  let ex = 0;
  for (const c of big) if (!roles.has(c.id)) roles.set(c.id, `extra${++ex}`);

  const outDir = ensureDir(inJob(dir, join("public", "rig", name)));
  const pad = 6;
  const sizes: Record<string, { w: number; h: number }> = {};
  for (const c of big) {
    const role = roles.get(c.id)!;
    const x0 = Math.max(0, c.x0 - pad), y0 = Math.max(0, c.y0 - pad), x1 = Math.min(W - 1, c.x1 + pad), y1 = Math.min(H - 1, c.y1 + pad);
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const buf = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const si = (y0 + y) * W + (x0 + x), di = (y * w + x) * 4;
      // Пиксель принадлежит части, если он её или рядом с ней (мягкий край), но не чужой части.
      const l = lab[si];
      const mine = l ? owner.get(l) === c.id : nearOwn(lab, owner, W, H, x0 + x, y0 + y, c.id, 3);
      if (!mine) continue;
      const al = data[si * 4 + 3];
      const ch = Math.max(0, Math.min(255, Math.round(((al - 0.2 * 255) / (0.8 * 255)) * 255))); // ореол генерации — прочь
      buf[di] = data[si * 4]; buf[di + 1] = data[si * 4 + 1]; buf[di + 2] = data[si * 4 + 2]; buf[di + 3] = ch;
    }
    await sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png().toFile(join(outDir, `${role}.png`));
    sizes[role] = { w, h };
  }

  // Черновик скелета: суставы угаданы по пропорциям; поправьте по листу поз (studio rig check).
  const rel = (r: string) => `rig/${name}/${r}.png`;
  const parts: Record<string, RigPart> = {};
  const sz = (r: string) => sizes[r];
  if (sz("torso")) {
    const t = sz("torso");
    parts.torso = { src: rel("torso"), ...t, pivot: [Math.round(t.w / 2), Math.round(t.h * 0.88)], z: 0 };
    if (sz("head")) {
      const h = sz("head");
      parts.head = { src: rel("head"), ...h, parent: "torso", at: [Math.round(t.w / 2), Math.round(t.h * 0.08)], pivot: [Math.round(h.w / 2), Math.round(h.h * 0.9)], z: 2 };
      const alt: Record<string, string> = {};
      if (sz("head-blink")) alt.blink = rel("head-blink");
      if (sz("head-talk")) alt.talk = rel("head-talk");
      if (Object.keys(alt).length) parts.head.alt = alt;
    }
    for (const [r, ax] of [["armL", 0.14], ["armR", 0.86]] as const) {
      const p = sz(r); if (!p) continue;
      parts[r] = { src: rel(r), ...p, parent: "torso", at: [Math.round(t.w * ax), Math.round(t.h * 0.17)], pivot: [Math.round(p.w / 2), Math.round(Math.min(p.w * 0.45, p.h * 0.2))], z: -1 };
    }
    for (const [r, ax] of [["legL", 0.32], ["legR", 0.68]] as const) {
      const p = sz(r); if (!p) continue;
      parts[r] = { src: rel(r), ...p, parent: "torso", at: [Math.round(t.w * ax), Math.round(t.h * 0.86)], pivot: [Math.round(p.w / 2), Math.round(Math.min(p.w * 0.45, p.h * 0.18))], z: -2 };
    }
  }
  if (a.object && sz("torso")) {
    const t = sz("torso"), col = str(a, "limb", "#3b2416")!, wd = Math.max(8, Math.round(t.w * 0.05));
    parts.torso = { src: rel("torso"), ...t, pivot: [Math.round(t.w / 2), Math.round(t.h * 0.9)], z: 0 };
    const alt: Record<string, string> = {};
    if (sz("torso-blink")) alt.blink = rel("torso-blink");
    if (sz("torso-talk")) alt.talk = rel("torso-talk");
    if (Object.keys(alt).length) parts.torso.alt = alt;
    const arm = Math.round(t.h * 0.32), leg = Math.round(t.h * 0.3);
    parts.armL = { parent: "torso", at: [Math.round(t.w * 0.1), Math.round(t.h * 0.55)], rest: 25, z: -1, hose: { len: arm, width: wd, color: col, endR: Math.round(wd * 1.1) } };
    parts.armR = { parent: "torso", at: [Math.round(t.w * 0.9), Math.round(t.h * 0.55)], rest: -25, z: -1, hose: { len: arm, width: wd, color: col, endR: Math.round(wd * 1.1) } };
    parts.legL = { parent: "torso", at: [Math.round(t.w * 0.36), Math.round(t.h * 0.9)], z: -2, hose: { len: leg, width: wd, color: col, endR: Math.round(wd * 1.3) } };
    parts.legR = { parent: "torso", at: [Math.round(t.w * 0.64), Math.round(t.h * 0.9)], z: -2, hose: { len: leg, width: wd, color: col, endR: Math.round(wd * 1.3) } };
  }
  const extras = Object.keys(sizes).filter((r) => r.startsWith("extra"));
  const rig = { name, view: "front", sheet: srcArg, parts, ...(extras.length ? { unused: Object.fromEntries(extras.map((r) => [r, { src: rel(r), ...sizes[r] }])) } : {}) };
  const rigFile = join(outDir, "rig.json");
  // Части — по строке на часть: черновик правится руками, и так его удобно читать.
  const json = JSON.stringify(rig, null, 1).replace(/\[\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]/g, "[$1, $2]");
  writeFileSync(rigFile, json + "\n");

  // Лист частей с подписями.
  const outPng = inJob(dir, str(a, "out", `out/rig-${name}-parts.png`)!);
  ensureDir(dirname(outPng));
  const scale = Math.min(1, 1400 / W);
  const labels = big.map((c) => `<rect x="${c.x0 * scale}" y="${c.y0 * scale}" width="${(c.x1 - c.x0) * scale}" height="${(c.y1 - c.y0) * scale}" fill="none" stroke="#e33" stroke-width="2"/><text x="${c.x0 * scale + 4}" y="${c.y0 * scale + 22}" font-family="sans-serif" font-size="20" font-weight="700" fill="#e33" stroke="#fff" stroke-width="4" paint-order="stroke">${roles.get(c.id)} ${c.x1 - c.x0}×${c.y1 - c.y0}</text>`).join("");
  const sw = Math.round(W * scale), sh = Math.round(H * scale);
  const bg = await sharp({ create: { width: sw, height: sh, channels: 4, background: "#9aa0a6" } }).png().toBuffer();
  const img = await sharp(src).resize(sw, sh).png().toBuffer();
  await sharp(bg).composite([{ input: img }, { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${sw}" height="${sh}">${labels}</svg>`) }]).png().toFile(outPng);

  console.log(`частей: ${big.length} → public/rig/${name}/ (${[...roles.values()].join(", ")})`);
  console.log(`скелет-черновик: public/rig/${name}/rig.json${extras.length ? `; не привязаны: ${extras.join(", ")} (в unused — назначьте роль или удалите)` : ""}`);
  const miss = (a.object ? ["torso"] : ["torso", "head", "armL", "armR", "legL", "legR"]).filter((r) => !sizes[r]);
  if (miss.length) console.log(`ВНИМАНИЕ: не нашлись ${miss.join(", ")} — посмотрите лист и назначьте роли в rig.json вручную (или переделайте лист)`);
  console.log(`лист частей: ${outPng} — откройте Read-ом; дальше studio rig check`);
};

const nearOwn = (lab: Int32Array, owner: Map<number, number>, W: number, H: number, x: number, y: number, id: number, r: number) => {
  let mine = false;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const xx = x + dx, yy = y + dy;
    if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
    const l = lab[yy * W + xx];
    if (!l) continue;
    if (owner.get(l) === id) mine = true; else return false;
  }
  return mine;
};

const POSES: Record<string, { t: number; acts: RigAction[] }> = {
  rest: { t: 0.5, acts: [] },
  walk: { t: 0.42, acts: [{ do: "walk", at: 0, to: [400, 0], dur: 2 }] },
  "walk-2": { t: 0.7, acts: [{ do: "walk", at: 0, to: [400, 0], dur: 2 }] },
  wave: { t: 0.6, acts: [{ do: "wave", at: 0, arm: "R" }] },
  point: { t: 0.6, acts: [{ do: "point", at: 0, arm: "L" }] },
  hop: { t: 0.38, acts: [{ do: "hop", at: 0 }] },
  land: { t: 0.66, acts: [{ do: "hop", at: 0 }] },
  cheer: { t: 0.5, acts: [{ do: "cheer", at: 0 }] },
  talk: { t: 0.5, acts: [{ do: "talk", at: 0, dur: 2 }] },
  surprise: { t: 0.2, acts: [{ do: "surprise", at: 0 }] },
  sleep: { t: 1, acts: [{ do: "sleep", at: 0, dur: 2 }] },
};

const check = async () => {
  const file = a._[1] ? [inJob(dir, a._[1]), inJob(dir, join("public", a._[1]))].find((f) => existsSync(f)) : undefined;
  const rigFile = file ?? die("нужен скелет: studio rig check public/rig/<name>/rig.json");
  const rig = JSON.parse(readFileSync(rigFile, "utf8")) as RigDef;
  const err = validateRig(rig);
  if (err.length) die(`скелет с ошибками:\n  ${err.join("\n  ")}`);
  const names = (str(a, "poses", "rest,walk,walk-2,wave,hop,land,cheer,talk,surprise,sleep")!).split(",").map((s) => s.trim()).filter((s) => POSES[s]);
  const CW = 300, CH = 420, HGT = 320, cols = Math.min(5, names.length), rows = Math.ceil(names.length / cols);
  const rest = restBounds(rig);
  const b64 = new Map<string, string>();
  const href = (src: string) => {
    if (!b64.has(src)) {
      const f = inJob(dir, join("public", src));
      if (!existsSync(f)) die(`нет картинки части ${src}`);
      b64.set(src, `data:image/png;base64,${readFileSync(f).toString("base64")}`);
    }
    return b64.get(src)!;
  };
  let body = "";
  names.forEach((nm, i) => {
    const ox = (i % cols) * CW, oy = Math.floor(i / cols) * CH;
    const { t, acts } = POSES[nm];
    const gx = ox + CW / 2, gy = oy + CH - 40;
    const shifted = acts.map((x) => ("to" in x ? { ...x, to: [gx + 120, gy] as Vec } : x));
    const st = evaluate(rig, shifted, t, { x: gx, y: gy, height: HGT });
    const items = drawList(rig, { ...st.pose, dx: nm.startsWith("walk") ? 0 : st.pose.dx }, rootMatrix(rig, rest, nm.startsWith("walk") ? gx : st.x, st.y, HGT, st.pose));
    body += `<rect x="${ox + 2}" y="${oy + 2}" width="${CW - 4}" height="${CH - 4}" fill="${i % 2 ? "#e9e4da" : "#dfe6ea"}"/><line x1="${ox + 10}" y1="${gy}" x2="${ox + CW - 10}" y2="${gy}" stroke="#999" stroke-dasharray="6 6"/>`;
    for (const it of items) {
      const m = it.m.map((v) => v.toFixed(4)).join(" ");
      if (it.kind === "img") body += `<image href="${href(it.src)}" width="${it.w}" height="${it.h}" transform="matrix(${m})"/>`;
      else body += `<g transform="matrix(${m})">${it.outline ? `<path d="${it.d}" fill="none" stroke="${it.outline}" stroke-width="${it.width + 6}" stroke-linecap="round"/>` : ""}<path d="${it.d}" fill="none" stroke="${it.color}" stroke-width="${it.width}" stroke-linecap="round"/>${it.endR ? `<circle cx="0" cy="${it.len}" r="${it.endR}" fill="${it.endColor ?? it.color}"/>` : ""}</g>`;
      if (a.joints && it.kind === "img") {
        const part = rig.parts[it.name];
        const [jx, jy] = apply(it.m, (part.pivot ?? [0, 0]) as Vec);
        body += `<circle cx="${jx}" cy="${jy}" r="4" fill="#e11" stroke="#fff" stroke-width="1.5"/>`;
      }
    }
    body += `<text x="${ox + 12}" y="${oy + 28}" font-family="sans-serif" font-size="20" font-weight="700" fill="#333">${nm}</text>`;
  });
  const W = cols * CW, H = rows * CH;
  const out = inJob(dir, str(a, "out", `out/rig-${rig.name ?? "hero"}-check.png`)!);
  ensureDir(dirname(out));
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}">${body}</svg>`)).png().toFile(out);
  console.log(`лист поз: ${out} (${names.join(", ")}) — откройте Read-ом: части на месте, суставы не рвутся, руки вверх и в стороны без «оторванных» плеч`);
};

if (sub === "cut") cut().catch((e) => die(String(e?.message ?? e)));
else if (sub === "check") check().catch((e) => die(String(e?.message ?? e)));
else die("studio rig cut <лист.png> [--name x] | studio rig check public/rig/<x>/rig.json [--poses …] [--joints]");
