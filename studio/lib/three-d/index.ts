// 3D-скиллы студии (blender-asset-factory, object-scene-3d, materials, typography-3d):
//   import { look, Tone, StudioLights, InFrame, AnimatedGltf, BlenderSeq } from "@studio/three-d";
// Базовые <ThreeCanvas>, <Gltf>, <CameraRig> — из "@studio/three" (реэкспорт ниже для удобства).
// Blender-сторона тех же скиллов — studio/lib/blender/{poly,looks,scene3d,text3d}.py.
export * from "./looks";
export * from "./stage";
export * from "./anim";
export { ThreeCanvas, Gltf, useGltf, loadGltf, CameraRig } from "../three";
