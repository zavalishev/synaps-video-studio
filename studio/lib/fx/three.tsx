// Частицы для 3D-сцены (внутри <ThreeCanvas>): дождь, снег, звёзды, облака.
// Импорт: import { Rain3D, Snow3D, Stars3D, Clouds3D } from "@studio/fx/three";
// Всё считается от useCurrentFrame() прямо в рендере (никакого useFrame/clock): матрицы
// InstancedMesh обновляются до того, как @remotion/three перерисует холст.
// Перенос по модулю — по высоте объёма (капля уходит под «пол» объёма и возвращается сверху),
// поэтому объём делайте выше кадра камеры, тогда перенос не виден.
import React, { useMemo } from "react";
import { random, useCurrentFrame, useVideoConfig } from "remotion";
import * as THREE from "three";

type V3 = [number, number, number];
const rnd = (seed: string, i: number, k: string) => random(`${seed}|${i}|${k}`);
const wrap = (v: number, m: number) => ((v % m) + m) % m;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

type Volume = { center?: V3; size?: V3 }; // объём частиц (м): центр и размер по x, y, z

const useInstanced = (geo: THREE.BufferGeometry, mat: THREE.Material, count: number) =>
  useMemo(() => {
    const m = new THREE.InstancedMesh(geo, mat, count);
    m.frustumCulled = false;
    return m;
  }, [geo, mat, count]);

// ---------------------------------------------------------------- дождь
export const Rain3D: React.FC<Volume & { count?: number; speed?: number; length?: number; color?: string; opacity?: number; wind?: number; seed?: string }> = ({
  center = [0, 3, 0], size = [14, 8, 14], count = 1400, speed = 9, length = 0.32, color = "#cfdcf0", opacity = 0.45, wind = 0.15, seed = "rain3d",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const geo = useMemo(() => new THREE.BoxGeometry(0.012, length, 0.012), [length]);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }), []);
  mat.color.set(color);
  mat.opacity = opacity;
  const mesh = useInstanced(geo, mat, count);
  mesh.visible = opacity > 0.01;
  const base = useMemo(() => Array.from({ length: count }, (_, i) => [rnd(seed, i, "x"), rnd(seed, i, "y"), rnd(seed, i, "z"), lerp(0.8, 1.2, rnd(seed, i, "v"))]), [seed, count]);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -Math.atan(wind)));
  const t = frame / fps;
  for (let i = 0; i < count; i++) {
    const [x0, y0, z0, v] = base[i];
    const y = center[1] + size[1] / 2 - wrap(y0 * size[1] + t * speed * v, size[1]);
    const x = center[0] - size[0] / 2 + wrap(x0 * size[0] + t * speed * v * wind, size[0]);
    m4.compose(new THREE.Vector3(x, y, center[2] - size[2] / 2 + z0 * size[2]), q, new THREE.Vector3(1, 1, 1));
    mesh.setMatrixAt(i, m4);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return <primitive object={mesh} />;
};

// ---------------------------------------------------------------- снег
export const Snow3D: React.FC<Volume & { count?: number; speed?: number; size3?: number; sway?: number; color?: string; opacity?: number; seed?: string }> = ({
  center = [0, 3, 0], size = [14, 8, 14], count = 900, speed = 0.7, size3 = 0.035, sway = 0.25, color = "#ffffff", opacity = 0.92, seed = "snow3d",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const geo = useMemo(() => new THREE.IcosahedronGeometry(size3, 0), [size3]);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true }), []);
  mat.color.set(color);
  mat.opacity = opacity;
  const mesh = useInstanced(geo, mat, count);
  mesh.visible = opacity > 0.01;
  const base = useMemo(() => Array.from({ length: count }, (_, i) => [rnd(seed, i, "x"), rnd(seed, i, "y"), rnd(seed, i, "z"), lerp(0.7, 1.3, rnd(seed, i, "v")), rnd(seed, i, "p") * 6.283, lerp(0.6, 1.4, rnd(seed, i, "s"))]), [seed, count]);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  const t = frame / fps;
  for (let i = 0; i < count; i++) {
    const [x0, y0, z0, v, ph, s] = base[i];
    const y = center[1] + size[1] / 2 - wrap(y0 * size[1] + t * speed * v, size[1]);
    const x = center[0] - size[0] / 2 + x0 * size[0] + Math.sin(t * 0.9 + ph) * sway;
    const z = center[2] - size[2] / 2 + z0 * size[2] + Math.cos(t * 0.7 + ph) * sway * 0.6;
    m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s));
    mesh.setMatrixAt(i, m4);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return <primitive object={mesh} />;
};

// ---------------------------------------------------------------- звёзды
// Точки на куполе радиуса radius над горизонтом; мерцание — цвет вершин от кадра.
export const Stars3D: React.FC<{ count?: number; radius?: number; size?: number; color?: string; twinkle?: number; opacity?: number; seed?: string }> = ({
  count = 700, radius = 60, size = 0.35, color = "#fff4dc", twinkle = 0.45, opacity = 1, seed = "stars3d",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { points, base } = useMemo(() => {
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
    const b: number[][] = [];
    for (let i = 0; i < count; i++) {
      const az = rnd(seed, i, "az") * Math.PI * 2, el = Math.asin(lerp(0.04, 1, rnd(seed, i, "el")));
      pos.set([radius * Math.cos(el) * Math.sin(az), radius * Math.sin(el), radius * Math.cos(el) * Math.cos(az)], i * 3);
      b.push([lerp(0.35, 1, rnd(seed, i, "b") ** 2), rnd(seed, i, "ph") * 6.283, lerp(2, 5, rnd(seed, i, "per"))]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      const m = new THREE.PointsMaterial({ size, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, fog: false });
    return { points: new THREE.Points(g, m), base: b };
  }, [count, radius, size, seed]);
  const c = new THREE.Color(color);
  const col = points.geometry.getAttribute("color") as THREE.BufferAttribute;
  const t = frame / fps;
  for (let i = 0; i < count; i++) {
    const [b, ph, per] = base[i];
    const v = b * (1 - twinkle / 2 + (twinkle / 2) * Math.sin((6.283 * t) / per + ph));
    col.setXYZ(i, c.r * v, c.g * v, c.b * v);
  }
  col.needsUpdate = true;
  (points.material as THREE.PointsMaterial).opacity = opacity;
  points.visible = opacity > 0.01;
  return <primitive object={points} />;
};

// ---------------------------------------------------------------- облака
// Мягкие low-poly облака из слитых икосфер; дрейф по x от кадра, перенос за пределами span.
// center — центр полосы облаков: ставьте ЗА героем и выше него (облако перед героем закрывает
// главное). span — ширина полосы: шире видимого кадра, иначе перенос по краю заметен.
// glow — доля собственного свечения цвета: ночью облака не проваливаются в чёрные пятна.
export const Clouds3D: React.FC<{ count?: number; center?: V3; height?: number; span?: number; depth?: number; speed?: number; color?: string; opacity?: number; scale?: number; glow?: number; seed?: string }> = ({
  count = 7, center, height = 3.2, span = 18, depth = 10, speed = 0.12, color = "#ffffff", opacity = 0.92, scale = 1, glow = 0.35, seed = "clouds3d",
}) => {
  const c0: V3 = center ?? [0, height, 0];
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true, transparent: true, depthWrite: false }), []);
  const geo = useMemo(() => new THREE.IcosahedronGeometry(1, 1), []);
  const clouds = useMemo(() => Array.from({ length: count }, (_, i) => {
    const g = new THREE.Group();
    const n = 3 + Math.floor(rnd(seed, i, "n") * 3);
    for (let j = 0; j < n; j++) {
      const m = new THREE.Mesh(geo, mat);
      const u = n === 1 ? 0 : j / (n - 1) - 0.5;
      const r = lerp(0.45, 0.8, rnd(seed, i * 10 + j, "r")) * (1 - Math.abs(u) * 0.8) * scale;
      m.position.set(u * 1.6 * scale, (rnd(seed, i * 10 + j, "y") - 0.3) * 0.25 * scale, (rnd(seed, i * 10 + j, "z") - 0.5) * 0.5 * scale);
      m.scale.set(r, r * 0.8, r);
      g.add(m);
    }
    return { g, x0: rnd(seed, i, "x"), y: c0[1] + (rnd(seed, i, "h") - 0.5) * 0.8 * scale, z: c0[2] + (rnd(seed, i, "zz") - 0.5) * depth, v: lerp(0.7, 1.3, rnd(seed, i, "v")) };
  }), [count, seed, geo, mat, c0[1], c0[2], depth, scale]); // eslint-disable-line react-hooks/exhaustive-deps
  mat.color.set(color);
  mat.emissive.set(color).multiplyScalar(glow);
  mat.opacity = opacity;
  mat.visible = opacity > 0.01;
  const t = frame / fps;
  for (const c of clouds) c.g.position.set(c0[0] + wrap(c.x0 * span + t * speed * c.v, span) - span / 2, c.y, c.z);
  return <group>{clouds.map((c, i) => <primitive key={i} object={c.g} />)}</group>;
};
