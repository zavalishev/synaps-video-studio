// Тест скилла typography-3d: «СКИДКА −30%» из Blender (буквы char_*/num_* в GLB) в three.
// Буквы поднимаются и встают по очереди (без перелёта), камера медленно наезжает и доворачивает.
import React from "react";
import { AbsoluteFill, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { orbit, tween } from "@studio";
import { AnimatedGltf, CameraRig, fitBox, InFrame, stagger, StudioEnv, StudioLights, ThreeCanvas, Tone } from "@studio/three-d";
import meta from "../public/3d/title.json";

const idx = (name: string) => {
  const m = /^(char|num)_(\d+)/.exec(name);
  return m ? { group: m[1], i: Number(m[2]) } : null;
};

export const Video: React.FC = () => {
  const frame = useCurrentFrame();
  const { width: W, height: H, durationInFrames: D } = useVideoConfig();
  const fov = 24;
  const c = meta.center as [number, number, number];
  const target: [number, number, number] = [0, c[1], 0];
  const R = fitBox(meta.bbox, fov, W, H, 0.9);
  const cam = orbit(frame, { start: 0, end: D - 1, azimuth0: -10, dAzimuth: 8, radius: tween(frame, [[0, R * 1.06], [D - 1, R]]), elevation: 6, target });
  return (
    <AbsoluteFill style={{ background: "radial-gradient(120% 80% at 50% 45%, #fff6ea 0%, #ffe1cf 60%, #f9c9b6 100%)" }}>
      <ThreeCanvas width={W} height={H} camera={{ fov }}>
        <Tone mode="neutral" />
        <StudioEnv intensity={0.35} />
        <StudioLights preset="product" target={target} scale={2} shadows={false} intensity={0.85} />
        <CameraRig position={cam.position} target={cam.target} fov={fov} />
        <InFrame id="title">
          <AnimatedGltf
            src={staticFile("3d/title.glb")}
            animate={(n, f) => {
              const k = idx(n.name);
              if (!k) return;
              const p = k.group === "char" ? stagger(f.frame, k.i, { start: 6, step: 3, dur: 20 }) : stagger(f.frame, k.i, { start: 34, step: 4, dur: 24 });
              n.position.y = f.base.position.y - (1 - p) * 0.5;
              n.rotation.x = f.base.rotation.x - (1 - p) * 1.2;
              n.scale.setScalar(Math.max(0.001, p));
            }}
          />
        </InFrame>
      </ThreeCanvas>
    </AbsoluteFill>
  );
};
