// scene-state для @remotion/three: свет, небо, дымка и перекраска модели из Look.
// Импорт: import { StateLights, SkyDome, StateModel, useLookOnModel } from "@studio/scene-state/three";
//
//   const look = lookAt(frame, [{ f: 0, state: { time: "day" } }, { f: 120, state: { time: "night", weather: "rain" }, dur: 36 }]);
//   <ThreeCanvas width={W} height={H} shadows camera={{ fov: 35 }}>
//     <StateLights look={look} scale={8} />   // небо-купол, дымка, полусферный свет, солнце/луна, экспозиция
//     <StateModel src={staticFile("3d/island.glb")} look={look} />
//   </ThreeCanvas>
//
// Перекраска по ИМЕНАМ материалов модели (так их называет blender-asset-factory):
//   ground* — земля (сезон + снег), foliage* — листва (сезон + снег), roof* — крыши (снег),
//   water* — вода, window*/glow*/lamp* — свечение (look.windowGlow), snow* — видно только зимой.
// Остальные материалы не трогаются. Исходные цвета сохраняются; материалы клонируются один раз.
import React, { useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useGltf } from "../three";
import { hexToLinear, type Look, mixColor, SNOW_COLOR, sunDirection } from "./state";

const col = (h: string) => new THREE.Color(h);

// range — высоты (y направления взгляда, −1..1), между которыми идёт градиент низ → верх.
// Камера смотрит сверху вниз и видит небо только у горизонта — сдвиньте range ниже (например
// [−0.25, 0.05]), чтобы градиент попал в кадр.
export const SkyDome: React.FC<{ look: Look; radius?: number; range?: [number, number] }> = ({ look, radius = 80, range = [-0.12, 0.38] }) => {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Vector3() }, bottom: { value: new THREE.Vector3() }, fogc: { value: new THREE.Vector3() }, haze: { value: 0 }, r0: { value: -0.12 }, r1: { value: 0.38 } },
    vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    // Цвета передаются уже линейными; выход — линейный, тонмаппинг делает рендерер.
    fragmentShader: "uniform vec3 top; uniform vec3 bottom; uniform vec3 fogc; uniform float haze; uniform float r0; uniform float r1; varying vec3 vP;" +
      "void main(){ float h = clamp(vP.y, -1.0, 1.0); float t = smoothstep(r0, r1, h); vec3 c = mix(bottom, top, t);" +
      "c = mix(c, fogc, haze * (1.0 - smoothstep(r0, r0 + (r1 - r0) * 0.6, h))); gl_FragColor = vec4(c, 1.0);\n" +
      "#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}",
  }), []);
  mat.uniforms.top.value.set(...hexToLinear(look.skyTop));
  mat.uniforms.bottom.value.set(...hexToLinear(look.skyBottom));
  mat.uniforms.fogc.value.set(...hexToLinear(look.fogColor));
  mat.uniforms.haze.value = Math.min(1, look.fog * 1.4);
  mat.uniforms.r0.value = range[0];
  mat.uniforms.r1.value = range[1];
  return <mesh material={mat} renderOrder={-1}><sphereGeometry args={[radius, 32, 16]} /></mesh>;
};

// Свет сцены из Look. scale — размер сцены в метрах (под него дымка и тени).
export const StateLights: React.FC<{ look: Look; scale?: number; sky?: boolean; skyRange?: [number, number]; shadows?: boolean; target?: [number, number, number]; moonLight?: number }> = ({ look, scale = 8, sky = true, skyRange, shadows = true, target = [0, 0, 0], moonLight = 1 }) => {
  const gl = useThree((s) => s.gl);
  gl.toneMappingExposure = Math.pow(2, look.exposure);
  const d = sunDirection(look);
  const dist = scale * 2.5;
  const sunPos: [number, number, number] = [target[0] + d[0] * dist, target[1] + Math.max(0.15, d[1]) * dist, target[2] + d[2] * dist];
  const near = scale * (2.2 - 1.6 * look.fog), far = scale * (9 - 6.5 * look.fog);
  const light = useMemo(() => {
    const l = new THREE.DirectionalLight();
    l.castShadow = shadows;
    l.shadow.mapSize.set(2048, 2048);
    l.shadow.bias = -0.0005;
    l.shadow.normalBias = 0.02;
    const c = l.shadow.camera as THREE.OrthographicCamera;
    c.left = -scale; c.right = scale; c.top = scale; c.bottom = -scale; c.near = 0.1; c.far = dist * 3;
    return l;
  }, [shadows, scale, dist]);
  light.position.set(...sunPos);
  light.target.position.set(...target);
  light.target.updateMatrixWorld();
  light.color.set(look.sunColor);
  light.intensity = look.sunIntensity * (look.moon > 0.5 ? moonLight : 1);
  return (
    <>
      {sky ? <SkyDome look={look} radius={scale * 10} range={skyRange} /> : <color attach="background" args={[col(look.skyBottom)]} />}
      <fog attach="fog" args={[col(look.fogColor), near, far]} />
      <hemisphereLight args={[col(look.hemiSky), col(look.hemiGround), look.hemiIntensity]} />
      <primitive object={light} />
      <primitive object={light.target} />
    </>
  );
};

type Base = { color?: THREE.Color; emissive?: THREE.Color; emissiveIntensity?: number; opacity?: number };

// Перекрасить загруженную модель под Look (вызывать в рендере, каждый кадр — это дёшево).
export const useLookOnModel = (root: THREE.Object3D | null, look: Look, o: { glow?: number; keepBase?: number } = {}) => {
  if (!root) return;
  const keep = o.keepBase ?? 0.25; // сколько исходного цвета сохранить (разнообразие оттенков листвы)
  const snow = col(SNOW_COLOR);
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[];
    const next = mats.map((m) => {
      if (!m.userData.__ss) {
        const c = m.clone();
        c.userData.__ss = true;
        c.userData.base = { color: c.color?.clone(), emissive: c.emissive?.clone(), emissiveIntensity: c.emissiveIntensity, opacity: c.opacity } as Base;
        return c;
      }
      return m;
    });
    if (next.some((m, i) => m !== mats[i])) mesh.material = Array.isArray(mesh.material) ? next : next[0];
    for (const m of next) {
      const b = m.userData.base as Base;
      const n = (m.name || mesh.name || "").toLowerCase();
      if (!b.color) continue;
      if (n.startsWith("foliage")) {
        m.color.copy(b.color).lerp(col(look.foliage), 1 - keep).lerp(snow, look.snowCover * 0.55);
      } else if (n.startsWith("ground")) {
        m.color.copy(b.color).lerp(col(look.ground), 1 - keep).lerp(snow, look.snowCover * 0.9);
      } else if (n.startsWith("roof")) {
        m.color.copy(b.color).lerp(snow, look.snowCover * 0.85);
      } else if (n.startsWith("water")) {
        m.color.copy(col(look.water));
      } else if (n.startsWith("snow")) {
        m.transparent = true;
        m.opacity = look.snowCover;
        m.visible = look.snowCover > 0.02;
      } else if (/^(window|glow|lamp)/.test(n)) {
        const g = look.windowGlow * (o.glow ?? 1);
        if (m.emissive) {
          m.emissive.copy(b.emissive && b.emissive.getHex() !== 0 ? b.emissive : col("#ffb24d"));
          m.emissiveIntensity = (b.emissiveIntensity || 1) * 2.2 * g;
        }
        m.color.copy(b.color).lerp(col("#2a2f45"), (1 - g) * 0.5);
      }
    }
  });
};

// GLB + перекраска под Look одним компонентом.
export const StateModel: React.FC<{ src: string; look: Look; glow?: number; keepBase?: number; position?: [number, number, number]; rotation?: [number, number, number]; scale?: number; shadows?: boolean }> = ({ src, look, glow, keepBase, shadows = true, ...rest }) => {
  const scene = useGltf(src);
  useMemo(() => {
    if (!scene || !shadows) return;
    scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  }, [scene, shadows]);
  useLookOnModel(scene, look, { glow, keepBase });
  return scene ? <primitive object={scene} {...rest} /> : null;
};

export { mixColor };
