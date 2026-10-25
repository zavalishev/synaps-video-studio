// Материалы-«виды» для three (скилл materials) — те же токены, что looks.py в Blender:
// clay, lowpoly, felt, paper, toon, plastic, ceramic, metal, glass, emissive, label.
// Один токен стиля из theme.json ведёт и Blender-ассеты, и @remotion/three, и промпты картинок.
//
//   const m = look("felt", "#7aa874");                     // кэшируется по (стиль, цвет, опции)
//   <mesh material={look("clay", theme.palette.accent)} />
//   applyLook(scene, /^foliage/, "felt", "#7aa874");        // перекрасить узлы GLB по имени
//   recolor(scene, /^ground|^roof/, "#f2f4f7", 0.8);        // «снег»: смешать цвет к белому на 80 %
//   glow(scene, /^window_emissive|^lamp_emissive/, "#ffd27a", 3);  // ночь: окна светятся
//
// Шумовые карты (ворс войлока, волокна бумаги) — из сида, без Math.random: от кадра к кадру
// и между рендерами одинаковы. Металл, лак и стекло без окружения выглядят чёрными —
// добавьте <StudioEnv /> (стенды из three-d/stage).
import * as THREE from "three";
import { random } from "remotion";

export type LookStyle = "clay" | "lowpoly" | "felt" | "paper" | "toon" | "plastic" | "ceramic" | "metal" | "glass" | "emissive" | "label";
export type LookOpts = {
  roughness?: number; metalness?: number; clearcoat?: number; sheen?: number;
  intensity?: number;          // emissive
  steps?: number;              // toon: ступеней света (2–4)
  bump?: number;               // сила шумовой нормали (felt/paper)
  map?: THREE.Texture | null;  // картинка (label и любой стиль)
  opacity?: number; side?: THREE.Side; seed?: string;
};

const cache = new Map<string, THREE.Material>();
const texCache = new Map<string, THREE.Texture>();

// Нормаль-карта из сидированного шума (size² пикселей): ворс/волокна. Детерминированно.
export const noiseNormalMap = (seed: string, size = 128, grain = 1, repeat = 4): THREE.DataTexture => {
  const key = `n|${seed}|${size}|${grain}|${repeat}`;
  const hit = texCache.get(key);
  if (hit) return hit as THREE.DataTexture;
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) h[i] = random(`${seed}-${i}`);
  // лёгкое размытие по grain — «волокна», а не песок
  const blur = (src: Float32Array) => {
    const o = new Float32Array(src.length);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += src[((y + dy + size) % size) * size + ((x + dx + size) % size)];
      o[y * size + x] = s / 9;
    }
    return o;
  };
  let hh = h;
  for (let k = 0; k < grain; k++) hh = blur(hh);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const dx = hh[y * size + ((x + 1) % size)] - hh[y * size + ((x - 1 + size) % size)];
    const dy = hh[((y + 1) % size) * size + x] - hh[((y - 1 + size) % size) * size + x];
    const n = new THREE.Vector3(-dx * 6, -dy * 6, 1).normalize();
    data[i * 4] = Math.round((n.x * 0.5 + 0.5) * 255);
    data[i * 4 + 1] = Math.round((n.y * 0.5 + 0.5) * 255);
    data[i * 4 + 2] = Math.round((n.z * 0.5 + 0.5) * 255);
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.needsUpdate = true;
  texCache.set(key, t);
  return t;
};

// Ступенчатая карта света для MeshToonMaterial (NearestFilter — без размытия ступеней).
export const toonGradient = (steps = 3): THREE.DataTexture => {
  const key = `toon|${steps}`;
  const hit = texCache.get(key);
  if (hit) return hit as THREE.DataTexture;
  const data = new Uint8Array(steps * 4);
  for (let i = 0; i < steps; i++) {
    const v = Math.round(255 * (0.45 + 0.55 * (i / Math.max(1, steps - 1))));
    data.set([v, v, v, 255], i * 4);
  }
  const t = new THREE.DataTexture(data, steps, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  texCache.set(key, t);
  return t;
};

export const look = (style: LookStyle, color = "#cccccc", o: LookOpts = {}): THREE.Material => {
  const key = `${style}|${color}|${JSON.stringify({ ...o, map: o.map ? o.map.uuid : undefined })}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = new THREE.Color(color);
  const common = { color: c, side: o.side ?? THREE.FrontSide, transparent: o.opacity !== undefined && o.opacity < 1, opacity: o.opacity ?? 1, map: o.map ?? null };
  let m: THREE.Material;
  switch (style) {
    case "clay":
      m = new THREE.MeshPhysicalMaterial({ ...common, roughness: o.roughness ?? 0.85, sheen: o.sheen ?? 0.3, sheenRoughness: 0.8, sheenColor: new THREE.Color("#ffffff") });
      break;
    case "lowpoly":
      m = new THREE.MeshStandardMaterial({ ...common, roughness: o.roughness ?? 0.8, flatShading: true });
      break;
    case "felt":
      m = new THREE.MeshPhysicalMaterial({
        ...common, roughness: o.roughness ?? 1, sheen: o.sheen ?? 1, sheenRoughness: 0.8, sheenColor: c.clone().lerp(new THREE.Color("#ffffff"), 0.35),
        normalMap: noiseNormalMap(o.seed ?? "felt", 128, 1, 10), normalScale: new THREE.Vector2(o.bump ?? 0.3, o.bump ?? 0.3),
      });
      break;
    case "paper":
      m = new THREE.MeshStandardMaterial({ ...common, roughness: o.roughness ?? 1, normalMap: noiseNormalMap(o.seed ?? "paper", 128, 2, 3), normalScale: new THREE.Vector2(o.bump ?? 0.1, o.bump ?? 0.1) });
      break;
    case "toon":
      m = new THREE.MeshToonMaterial({ ...common, gradientMap: toonGradient(o.steps ?? 3) });
      break;
    case "plastic":
      m = new THREE.MeshPhysicalMaterial({ ...common, roughness: o.roughness ?? 0.32, clearcoat: o.clearcoat ?? 0.6, clearcoatRoughness: 0.08 });
      break;
    case "ceramic":
      m = new THREE.MeshPhysicalMaterial({ ...common, roughness: o.roughness ?? 0.18, clearcoat: o.clearcoat ?? 0.4, clearcoatRoughness: 0.05 });
      break;
    case "metal":
      m = new THREE.MeshStandardMaterial({ ...common, roughness: o.roughness ?? 0.3, metalness: o.metalness ?? 1 });
      break;
    case "glass":
      m = new THREE.MeshPhysicalMaterial({ ...common, roughness: o.roughness ?? 0.03, transmission: 1, thickness: 0.5, ior: 1.45, transparent: false });
      break;
    case "emissive":
      m = new THREE.MeshStandardMaterial({ ...common, roughness: 0.6, emissive: c, emissiveIntensity: o.intensity ?? 2 });
      break;
    case "label":
      m = new THREE.MeshStandardMaterial({ ...common, color: o.map ? new THREE.Color("#ffffff") : c, roughness: o.roughness ?? 0.55 });
      break;
    default:
      throw new Error(`look: неизвестный стиль ${style as string}`);
  }
  m.name = `${style}_${color}`;
  cache.set(key, m);
  return m;
};

const matches = (name: string, pat: RegExp | string) => (typeof pat === "string" ? name.startsWith(pat) : pat.test(name));

// Узлы GLB, чьё имя (или имя любого родителя) подходит под шаблон.
export const meshesBy = (root: THREE.Object3D, pat: RegExp | string): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (matches(p.name, pat)) { out.push(o as THREE.Mesh); return; }
  });
  return out;
};

export const applyLook = (root: THREE.Object3D, pat: RegExp | string, style: LookStyle, color: string, o?: LookOpts) => {
  const m = look(style, color, o);
  for (const mesh of meshesBy(root, pat)) mesh.material = m;
};

// Свой экземпляр материала у меша (клон один раз; исходный цвет запомнен) — чтобы перекраска
// одного узла не меняла общий материал GLB и не накапливалась от кадра к кадру.
const ownMaterials = (mesh: THREE.Mesh): THREE.Material[] => {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const own = mats.map((m) => {
    if (m.userData.__own === mesh.uuid) return m;
    const c = m.clone();
    const sm = m as THREE.MeshStandardMaterial;
    c.userData = { __own: mesh.uuid, base: sm.color ? sm.color.clone() : null };
    return c;
  });
  mesh.material = Array.isArray(mesh.material) ? own : own[0];
  return own;
};

// Смешать цвет материалов узлов к color на amount (0..1): снег, ночь, сезон. Считается от
// исходного цвета GLB, поэтому вызывать можно на каждом кадре (не накапливается).
export const recolor = (root: THREE.Object3D, pat: RegExp | string, color: string, amount: number) => {
  const target = new THREE.Color(color);
  for (const mesh of meshesBy(root, pat)) {
    for (const m of ownMaterials(mesh)) {
      const sm = m as THREE.MeshStandardMaterial;
      const base = m.userData.base as THREE.Color | null;
      if (sm.color && base) sm.color.copy(base).lerp(target, Math.min(1, Math.max(0, amount)));
    }
  }
};

// Свечение узлов (окна, лампы): emissive = color × intensity. intensity 0 — погасить.
export const glow = (root: THREE.Object3D, pat: RegExp | string, color: string, intensity: number) => {
  for (const mesh of meshesBy(root, pat)) {
    for (const m of ownMaterials(mesh)) {
      const sm = m as THREE.MeshStandardMaterial;
      if (sm.emissive) { sm.emissive.set(color); sm.emissiveIntensity = intensity; }
    }
  }
};

// Тени: включить отбрасывание/приём у всех мешей (GLB приходит без них).
export const enableShadows = (root: THREE.Object3D, cast = true, receive = true) => {
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = cast; o.receiveShadow = receive; } });
};

// Лицо на скруглённом корпусе (экран телефона, этикетка банки, вывеска): та же форма, что
// корпус, утопленная внутрь на inset (доля меньшей стороны, 2–3 %), — а не прямоугольник
// поверх скруглённых углов («зелёная наклейка торчит за корпус»). UV нормированы в 0…1 по
// самому лицу: CanvasTexture/картинка ложится без растяжения и без смещения.
//   const face = new THREE.Mesh(roundedFace(PW, PL, R), new THREE.MeshBasicMaterial({ map: tex }));
//   face.position.z = depth / 2 + 0.001;
export const roundedFace = (w: number, h: number, r: number, inset = 0.025, segments = 10): THREE.ShapeGeometry => {
  const i = Math.max(0, inset) * Math.min(w, h);
  const iw = Math.max(0.001, w - 2 * i), ih = Math.max(0.001, h - 2 * i);
  const ir = Math.max(0, Math.min(r - i, iw / 2, ih / 2));
  const x0 = -iw / 2, y0 = -ih / 2;
  const s = new THREE.Shape();
  s.moveTo(x0 + ir, y0);
  s.lineTo(x0 + iw - ir, y0);
  s.quadraticCurveTo(x0 + iw, y0, x0 + iw, y0 + ir);
  s.lineTo(x0 + iw, y0 + ih - ir);
  s.quadraticCurveTo(x0 + iw, y0 + ih, x0 + iw - ir, y0 + ih);
  s.lineTo(x0 + ir, y0 + ih);
  s.quadraticCurveTo(x0, y0 + ih, x0, y0 + ih - ir);
  s.lineTo(x0, y0 + ir);
  s.quadraticCurveTo(x0, y0, x0 + ir, y0);
  const g = new THREE.ShapeGeometry(s, segments);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let k = 0; k < pos.count; k++) { uv[k * 2] = (pos.getX(k) - x0) / iw; uv[k * 2 + 1] = (pos.getY(k) - y0) / ih; }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return g;
};
