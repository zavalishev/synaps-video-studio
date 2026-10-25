// Сцена @remotion/three: тон, окружение, свет, пол/циклорама, поворотный стол, страховка кадра.
// Всё внутри <ThreeCanvas>. Камеру ставит <CameraRig> из "@studio/three" (orbit/dolly от кадра).
//
//   <ThreeCanvas width={W} height={H} camera={{ fov: 30 }} shadows>
//     <Tone mode="neutral" />                       // как s3.tone("neutral") в Blender — цвета ≈ hex
//     <StudioEnv intensity={0.6} />                 // отражения для лака/металла/стекла
//     <StudioLights preset="soft" target={[0, 0.5, 0]} scale={1} />
//     <CameraRig position={cam.position} target={cam.target} fov={30} />
//     <InFrame id="hero"><Turntable start={0} end={150} degrees={40}><Gltf src=… /></Turntable></InFrame>
//     <ShadowFloor opacity={0.28} />                // только тень на 2D-фоне (холст прозрачный)
//   </ThreeCanvas>
//
// Холст прозрачный: фон рисуйте в Remotion ПОД ним (тот же цвет/градиент, что у 2D-сцен) — так
// 2D и 3D становятся одним миром, а тень от ShadowFloor ложится на ваш фон.
import React, { useLayoutEffect, useMemo, useRef } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { defaultMargins, reportGuard, safeArea, type Box } from "../layout";
import { EASE, MOTION_LIMITS } from "../camera";
import { look } from "./looks";

type V3 = [number, number, number];

// ---------- тон-маппинг: те же режимы, что s3.tone() в Blender ----------
export type ToneMode = "neutral" | "flat" | "film" | "aces";
export const Tone: React.FC<{ mode?: ToneMode; exposure?: number }> = ({ mode = "neutral", exposure = 1 }) => {
  const gl = useThree((s) => s.gl);
  useLayoutEffect(() => {
    gl.toneMapping = { neutral: THREE.NeutralToneMapping, flat: THREE.NoToneMapping, film: THREE.AgXToneMapping, aces: THREE.ACESFilmicToneMapping }[mode];
    gl.toneMappingExposure = exposure;
  }, [gl, mode, exposure]);
  return null;
};

// ---------- окружение для отражений (PMREM из RoomEnvironment; детерминированно) ----------
export const StudioEnv: React.FC<{ intensity?: number }> = ({ intensity = 0.6 }) => {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useLayoutEffect(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = intensity;
    return () => { scene.environment = null; env.dispose(); pm.dispose(); };
  }, [gl, scene, intensity]);
  return null;
};

// ---------- свет: те же пресеты, что LIGHT_PRESETS в scene3d.py ----------
type LightDef = { az: number; el: number; i: number; color: string };
export const LIGHT_PRESETS: Record<string, { key: LightDef; fill: LightDef; rim: LightDef; hemi: [string, string, number] }> = {
  soft:    { key: { az: -40, el: 45, i: 2.4, color: "#fff4e6" }, fill: { az: 50, el: 20, i: 0.7, color: "#e6f0ff" }, rim: { az: 160, el: 35, i: 1.2, color: "#ffffff" }, hemi: ["#ffffff", "#d8cbb8", 0.6] },
  product: { key: { az: -35, el: 40, i: 2.8, color: "#ffffff" }, fill: { az: 55, el: 15, i: 0.8, color: "#f2f6ff" }, rim: { az: 170, el: 45, i: 2.0, color: "#ffffff" }, hemi: ["#ffffff", "#cfc8bf", 0.5] },
  golden:  { key: { az: -60, el: 18, i: 2.6, color: "#ffb36b" }, fill: { az: 60, el: 25, i: 0.5, color: "#9fb6ff" }, rim: { az: 150, el: 20, i: 1.6, color: "#ffd2a1" }, hemi: ["#ffd9b0", "#6b5a7a", 0.5] },
  night:   { key: { az: -30, el: 50, i: 0.7, color: "#9fb6ff" }, fill: { az: 60, el: 20, i: 0.25, color: "#6f7fb8" }, rim: { az: 170, el: 30, i: 0.9, color: "#bcd0ff" }, hemi: ["#3a4a7a", "#141a2e", 0.35] },
};

// Направление «азимут/высота» → точка (Y вверх; камера по умолчанию смотрит из +Z).
const dirPos = (az: number, el: number, d: number, t: V3): V3 => {
  const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
  return [t[0] + d * Math.cos(e) * Math.sin(a), t[1] + d * Math.sin(e), t[2] + d * Math.cos(e) * Math.cos(a)];
};

export const StudioLights: React.FC<{ preset?: keyof typeof LIGHT_PRESETS; target?: V3; scale?: number; shadows?: boolean; intensity?: number; shadowSize?: number }> = ({
  preset = "soft", target = [0, 0, 0], scale = 1, shadows = true, intensity = 1, shadowSize = 2048,
}) => {
  const p = LIGHT_PRESETS[preset];
  const tgt = useMemo(() => { const o = new THREE.Object3D(); o.position.set(...target); return o; }, [target[0], target[1], target[2]]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = 6 * scale;
  const ext = 3 * scale;
  return (
    <>
      <primitive object={tgt} />
      <hemisphereLight args={[p.hemi[0], p.hemi[1], p.hemi[2] * intensity]} />
      <directionalLight
        position={dirPos(p.key.az, p.key.el, d, target)} target={tgt} color={p.key.color} intensity={p.key.i * intensity} castShadow={shadows}
        shadow-mapSize={[shadowSize, shadowSize]} shadow-bias={-0.0005} shadow-normalBias={0.02} shadow-radius={6}
        shadow-camera-left={-ext} shadow-camera-right={ext} shadow-camera-top={ext} shadow-camera-bottom={-ext} shadow-camera-near={0.1} shadow-camera-far={d * 3}
      />
      <directionalLight position={dirPos(p.fill.az, p.fill.el, d, target)} target={tgt} color={p.fill.color} intensity={p.fill.i * intensity} />
      <directionalLight position={dirPos(p.rim.az, p.rim.el, d, target)} target={tgt} color={p.rim.color} intensity={p.rim.i * intensity} />
    </>
  );
};

// ---------- пол и фон ----------
// Только тень (пол невидим): холст прозрачный, тень ложится на 2D-фон Remotion.
export const ShadowFloor: React.FC<{ size?: number; y?: number; opacity?: number; color?: string }> = ({ size = 40, y = 0, opacity = 0.25, color = "#000000" }) => (
  <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} receiveShadow>
    <planeGeometry args={[size, size]} />
    <shadowMaterial transparent opacity={opacity} color={color} />
  </mesh>
);

// Контактная тень: мягкое тёмное пятно прямо под предметом (радиальный градиент, без карты
// теней) — «стоит, а не парит». Вместе с ShadowFloor: контакт + падающая тень.
const contactCache = new Map<number, THREE.DataTexture>();
// Пятно: полная плотность до inner (доля радиуса — под предметом), дальше мягкий спад к краю.
const contactTex = (inner: number) => {
  const hit = contactCache.get(inner);
  if (hit) return hit;
  const n = 128, d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const r = Math.hypot(x - n / 2 + 0.5, y - n / 2 + 0.5) / (n / 2);
    const t = Math.min(1, Math.max(0, (r - inner) / Math.max(1e-3, 1 - inner)));
    const a = r <= inner ? 1 : (1 - t) ** 2 * (1 + 2 * t) * (1 - t);
    d.set([255, 255, 255, Math.round(a * 255)], (y * n + x) * 4);
  }
  const tex = new THREE.DataTexture(d, n, n, THREE.RGBAFormat);
  tex.needsUpdate = true;
  contactCache.set(inner, tex);
  return tex;
};

// radius — внешний радиус пятна (≈ 1.4–1.7 радиуса основания), inner — доля радиуса со сплошной тенью
// (≈ радиус основания / radius).
export const ContactShadow: React.FC<{ radius?: number; inner?: number; y?: number; opacity?: number; color?: string; stretch?: number }> = ({ radius = 0.6, inner = 0.6, y = 0.002, opacity = 0.45, color = "#000000", stretch = 1 }) => (
  <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} scale={[stretch, 1, 1]} renderOrder={-1}>
    <planeGeometry args={[radius * 2, radius * 2]} />
    <meshBasicMaterial map={contactTex(inner)} color={color} transparent opacity={opacity} depthWrite={false} toneMapped={false} />
  </mesh>
);

// Циклорама: пол плавно переходит в стену за объектом (−Z) — нет линии горизонта.
export const cycloramaGeometry = (width = 12, depth = 10, height = 6, radius = 2, seg = 16) => {
  const prof: [number, number][] = [[depth, 0]];
  for (let i = 0; i <= seg; i++) { const a = (Math.PI / 2) * (i / seg); prof.push([-radius * Math.sin(a), radius * (1 - Math.cos(a))]); }
  prof.push([-radius, height]);
  const pos: number[] = [], idx: number[] = [];
  prof.forEach(([z, y]) => { pos.push(-width / 2, y, z, width / 2, y, z); });
  for (let i = 0; i < prof.length - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
};

export const Cyclorama: React.FC<{ color?: string; width?: number; depth?: number; height?: number; radius?: number; z?: number }> = ({ color = "#efe6d6", width = 12, depth = 10, height = 6, radius = 2, z = -1.5 }) => {
  const geo = useMemo(() => cycloramaGeometry(width, depth, height, radius), [width, depth, height, radius]);
  return <mesh geometry={geo} position={[0, 0, z]} receiveShadow material={look("clay", color, { roughness: 0.95, side: THREE.DoubleSide })} />;
};

// ---------- поворотный стол ----------
// Угол (°) по кадру: degrees за [start, end] с плавностью; проверка скорости ≤ maxOrbitDegPerSec.
export const turntableAngle = (frame: number, o: { start: number; end: number; degrees: number; from?: number; ease?: (t: number) => number }) => {
  const t = o.end > o.start ? Math.min(1, Math.max(0, (frame - o.start) / (o.end - o.start))) : 1;
  return (o.from ?? 0) + o.degrees * (o.ease ?? EASE)(t);
};

export const Turntable: React.FC<{ start: number; end: number; degrees: number; from?: number; linear?: boolean; children?: React.ReactNode; id?: string }> = ({ start, end, degrees, from = 0, linear, children, id = "turntable" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ease = linear ? (t: number) => t : EASE;
  const a = turntableAngle(frame, { start, end, degrees, from, ease });
  // пиковая скорость: у EASE ≈ 1.9× средней, у линейной — средняя
  const peak = (Math.abs(degrees) / Math.max(1e-6, (end - start) / fps)) * (linear ? 1 : 1.9);
  if (frame === start && peak > MOTION_LIMITS.maxOrbitDegPerSec) reportGuard({ id, kind: "motion-orbit-fast", frame, amount: peak, detail: { limit: MOTION_LIMITS.maxOrbitDegPerSec } });
  return <group rotation={[0, (a * Math.PI) / 180, 0]}>{children}</group>;
};

// ---------- страховка кадра для 3D ----------
// Проекция мирового бокса на экран (px). Для планирования без холста: камера из orbit/dolly.
export const projectBox = (box: { min: V3; max: V3 }, cam: { position: V3; target: V3; fov: number }, W: number, H: number): Box => {
  const c = new THREE.PerspectiveCamera(cam.fov, W / H, 0.01, 1000);
  c.position.set(...cam.position);
  c.lookAt(...cam.target);
  c.updateMatrixWorld();
  return projectWith(new THREE.Box3(new THREE.Vector3(...box.min), new THREE.Vector3(...box.max)), c, W, H);
};

const projectWith = (b: THREE.Box3, c: THREE.Camera, W: number, H: number): Box => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    const v = new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(c);
    const x = (v.x * 0.5 + 0.5) * W, y = (1 - (v.y * 0.5 + 0.5)) * H;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

// Точный экранный прямоугольник: проекция всех вершин мешей (а не углов бокса — у диска
// или шара углы бокса торчат за силуэт). Вершины за камерой пропускаются.
export const projectVertices = (root: THREE.Object3D, camera: THREE.Camera, W: number, H: number, skip?: THREE.Object3D): Box | null => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const v = new THREE.Vector3();
  const cam = new THREE.Vector3();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || o === skip || !o.visible) return;
    const pos = mesh.geometry?.attributes?.position;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      cam.copy(v).applyMatrix4(camera.matrixWorldInverse);
      if (cam.z > -1e-3) continue;
      v.project(camera);
      const x = (v.x * 0.5 + 0.5) * W, y = (1 - (v.y * 0.5 + 0.5)) * H;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  });
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

// Расстояние камеры, при котором шар радиуса r (вокруг цели) занимает долю fill безопасной зоны.
export const fitDistance = (r: number, fov: number, W: number, H: number, fill = 0.9) => {
  const safe = safeArea(W, H);
  const vf = ((fov * Math.PI) / 180) / 2;
  const hf = Math.atan(Math.tan(vf) * (W / H));
  const fv = (safe.h / H) * fill, fh = (safe.w / W) * fill;
  return Math.max(r / Math.sin(Math.atan(Math.tan(vf) * fv)), r / Math.sin(Math.atan(Math.tan(hf) * fh)));
};

// Расстояние для фронтального кадра по боксу (паспорт GLB из s3.export_glb: meta.bbox):
// плоское и широкое (надпись, витрина) заполняет безопасную зону точнее, чем по радиусу шара.
// Камера смотрит вдоль −Z на центр бокса; при орбите/наклоне оставьте запас (fill 0.85–0.9).
export const fitBox = (box: { min: number[]; max: number[] }, fov: number, W: number, H: number, fill = 0.9) => {
  const safe = safeArea(W, H);
  const hw = (box.max[0] - box.min[0]) / 2, hh = (box.max[1] - box.min[1]) / 2, hd = (box.max[2] - box.min[2]) / 2;
  const tv = Math.tan(((fov * Math.PI) / 180) / 2);
  const th = tv * (W / H);
  return Math.max(hw / (th * (safe.w / W) * fill), hh / (tv * (safe.h / H) * fill)) + hd;
};

// Обёртка: на каждой отрисовке кадра проецирует реальный бокс детей и пишет нарушение
// «outside-safe-3d» в отчёт страховки (guard.json), если объект вылез из безопасной зоны.
// Проверка идёт в момент рендера (невидимый «датчик» с onAfterRender), поэтому видит и GLB,
// загруженный позже первого прохода, и камеру, поставленную <CameraRig>.
// probe не видит, что 3D-объект вылез за кадр на цветном фоне, — эта проверка видит.
export const InFrame: React.FC<{ id: string; children?: React.ReactNode; tolerancePx?: number; area?: Box; onBox?: (b: Box) => void }> = ({ id, children, tolerancePx = 2, area, onBox }) => {
  const ref = useRef<THREE.Group>(null);
  const frame = useCurrentFrame();
  const { width: W, height: H } = useVideoConfig();
  const st = useRef({ frame, W, H, area, tolerancePx, onBox, id });
  st.current = { frame, W, H, area, tolerancePx, onBox, id };
  const sensor = useMemo(() => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1e-4, 1e-4), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false }));
    m.frustumCulled = false;
    m.renderOrder = 1e9;
    m.name = "__inframe_sensor";
    m.onAfterRender = (_r, _s, camera) => {
      const g = ref.current;
      if (!g) return;
      const c = st.current;
      g.updateWorldMatrix(true, true);
      const r = projectVertices(g, camera, c.W, c.H, m);
      if (!r) return;
      c.onBox?.(r);
      const s = c.area ?? safeArea(c.W, c.H, defaultMargins(c.W, c.H));
      const over = Math.max(0, s.x - r.x, s.y - r.y, r.x + r.w - (s.x + s.w), r.y + r.h - (s.y + s.h));
      if (over > c.tolerancePx) reportGuard({ id: c.id, kind: "outside-safe-3d", frame: c.frame, amount: over, detail: { box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) } } });
    };
    return m;
  }, []);
  return <group ref={ref}><primitive object={sensor} />{children}</group>;
};
