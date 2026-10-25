// Оживление GLB по узлам и секвенции Blender.
//
//   <AnimatedGltf src={staticFile("3d/island.glb")} animate={(node, f) => {
//     if (node.name.startsWith("blades_")) node.rotation.y = f.base.rotation.y + f.frame * 0.03;
//   }} setup={(scene) => enableShadows(scene)} />
//
//   // буквы из Blender (text3d.letters → узлы char_00, char_01 …): появление по очереди
//   <AnimatedGltf src={staticFile("3d/title.glb")} animate={(n, f) => {
//     const i = letterIndex(n.name); if (i < 0) return;
//     const p = stagger(f.frame, i, { start: 10, step: 3, dur: 18 });
//     n.position.y = f.base.position.y + (1 - p) * -0.4; n.scale.setScalar(0.001 + p); }} />
//
//   // 2D: PNG-секвенция из Blender (s3.turntable / render_sequence) как слой Remotion
//   <BlenderSeq prefix="3d/turn/f_" count={90} start={0} mode="clamp" style={{ … }} />
//
// animate() зовётся на каждом кадре до отрисовки (useLayoutEffect), base — исходные позиция,
// поворот и масштаб узла из GLB (не накапливается). Никакого useFrame/clock.
import React, { useLayoutEffect } from "react";
import { Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import * as THREE from "three";
import { useGltf } from "../three";
import { EASE } from "../camera";

export type NodeBase = { position: THREE.Vector3; rotation: THREE.Euler; quaternion: THREE.Quaternion; scale: THREE.Vector3 };
export type AnimCtx = { frame: number; fps: number; base: NodeBase; root: THREE.Object3D };

const baseOf = (n: THREE.Object3D): NodeBase => {
  const ud = n.userData as { __base?: NodeBase };
  if (!ud.__base) ud.__base = { position: n.position.clone(), rotation: n.rotation.clone(), quaternion: n.quaternion.clone(), scale: n.scale.clone() };
  return ud.__base;
};

// Вращение узла вокруг ЕГО локальной оси на angle (рад) от исходного положения: лопасти,
// колёса, вентилятор. Ось Blender → three: X→X, Y→−Z, Z→Y (экспорт glTF, Y вверх).
export const spinLocal = (node: THREE.Object3D, base: NodeBase, axis: "x" | "y" | "z" | "-z", angle: number) => {
  const v = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], "-z": [0, 0, -1] }[axis];
  const r = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(v[0], v[1], v[2]), angle);
  node.quaternion.copy(base.quaternion).multiply(r);
};

export const useAnimatedScene = (
  scene: THREE.Object3D | null,
  animate?: (node: THREE.Object3D, f: AnimCtx) => void,
  setup?: (scene: THREE.Object3D) => void,
) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  useLayoutEffect(() => {
    if (!scene) return;
    const ud = scene.userData as { __setup?: boolean };
    if (setup && !ud.__setup) { setup(scene); ud.__setup = true; }
    if (!animate) return;
    scene.traverse((n) => {
      const base = baseOf(n);
      animate(n, { frame, fps, base, root: scene });
    });
  });
};

export const AnimatedGltf: React.FC<{
  src: string;
  animate?: (node: THREE.Object3D, f: AnimCtx) => void;
  setup?: (scene: THREE.Object3D) => void;
  position?: [number, number, number]; rotation?: [number, number, number]; scale?: number | [number, number, number];
}> = ({ src, animate, setup, ...rest }) => {
  const scene = useGltf(src);
  useAnimatedScene(scene, animate, setup);
  return scene ? <primitive object={scene} {...rest} /> : null;
};

// Номер буквы из имени узла char_07 → 7 (иначе −1).
export const letterIndex = (name: string) => {
  const m = /^char_(\d+)/.exec(name);
  return m ? Number(m[1]) : -1;
};

// Прогресс 0..1 i-го элемента: старт start + i·step, длительность dur, плавность без перелёта.
export const stagger = (frame: number, i: number, o: { start: number; step: number; dur: number; ease?: (t: number) => number }) => {
  const t = Math.min(1, Math.max(0, (frame - o.start - i * o.step) / Math.max(1, o.dur)));
  return (o.ease ?? EASE)(t);
};

// PNG-секвенция Blender как слой. prefix — путь в public без номера (3d/turn/f_), count — кадров,
// first — номер первого файла (Blender: 1), start — кадр ролика, с которого играть, speed — скорость.
// mode: clamp — стоп на последнем; loop — по кругу (петля turntable 360°); pingpong — туда-обратно
// (не для движения с инерцией: разворот = рывок).
export const seqIndex = (frame: number, o: { count: number; start?: number; speed?: number; mode?: "clamp" | "loop" | "pingpong" }) => {
  const k = Math.max(0, Math.floor((frame - (o.start ?? 0)) * (o.speed ?? 1)));
  const n = o.count;
  if (o.mode === "loop") return k % n;
  if (o.mode === "pingpong") { const p = k % (2 * n - 2 || 1); return p < n ? p : 2 * n - 2 - p; }
  return Math.min(n - 1, k);
};

export const BlenderSeq: React.FC<{
  prefix: string; count: number; first?: number; pad?: number; start?: number; speed?: number; mode?: "clamp" | "loop" | "pingpong";
  style?: React.CSSProperties;
}> = ({ prefix, count, first = 1, pad = 4, start, speed, mode, style }) => {
  const frame = useCurrentFrame();
  const i = seqIndex(frame, { count, start, speed, mode });
  return <Img src={staticFile(`${prefix}${String(i + first).padStart(pad, "0")}.png`)} style={{ position: "absolute", ...style }} />;
};
