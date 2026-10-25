// 3D-помощники для @remotion/three (импорт отдельно: `from "@studio/three"`, чтобы 2D-ролики
// не тащили three в сборку).
//   • <Gltf src={staticFile("3d/x.glb")} position scale rotation /> — модель внутри ThreeCanvas:
//     кадр ждёт загрузку И перерисовку сцены (в рендере R3F рисует только по смене кадра,
//     поэтому после асинхронной загрузки нужен явный advance — иначе модель не попадёт в кадр);
//   • useGltf(url) — то же как хук (только ВНУТРИ ThreeCanvas), вернёт копию сцены GLB;
//   • <CameraRig position target fov /> — ставит камеру каждый кадр (значения — из orbit/dolly
//     по useCurrentFrame, никакого useFrame/clock);
//   • ThreeCanvas — реэкспорт: <ThreeCanvas width={W} height={H} camera={{ fov: 35 }}>.
// Рендер 3D: studio still/render --gl angle (если кадр чёрный — --gl swangle), --concurrency 3.
import React, { useEffect, useLayoutEffect, useState } from "react";
import { cancelRender, continueRender, delayRender } from "remotion";
import { useThree } from "@react-three/fiber";
import type { Group, PerspectiveCamera } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export { ThreeCanvas } from "@remotion/three";

const cache = new Map<string, Promise<Group>>();

export const loadGltf = (url: string): Promise<Group> => {
  let p = cache.get(url);
  if (!p) {
    p = new Promise<Group>((res, rej) => new GLTFLoader().load(url, (g) => res(g.scene), undefined, rej));
    cache.set(url, p);
  }
  return p;
};

export const useGltf = (url: string): Group | null => {
  const [scene, setScene] = useState<Group | null>(null);
  const [handle, setHandle] = useState<number | null>(() => delayRender(`gltf ${url}`, { timeoutInMilliseconds: 60000 }));
  const advance = useThree((s) => s.advance);
  useEffect(() => {
    loadGltf(url).then((g) => setScene(g.clone(true))).catch((e) => cancelRender(e));
  }, [url]);
  // Модель уже в дереве сцены — перерисовать холст и только потом отпустить кадр.
  useEffect(() => {
    if (!scene || handle === null) return;
    advance(0);
    continueRender(handle);
    setHandle(null);
  }, [scene, handle, advance]);
  return scene;
};

export const Gltf: React.FC<{ src: string; position?: [number, number, number]; rotation?: [number, number, number]; scale?: number | [number, number, number] }> = ({ src, ...rest }) => {
  const scene = useGltf(src);
  return scene ? <primitive object={scene} {...rest} /> : null;
};

export const CameraRig: React.FC<{ position: [number, number, number]; target?: [number, number, number]; fov?: number }> = ({ position, target = [0, 0, 0], fov }) => {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  useLayoutEffect(() => {
    camera.position.set(...position);
    if (fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    camera.lookAt(...target);
  }, [camera, position[0], position[1], position[2], target[0], target[1], target[2], fov]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
};
