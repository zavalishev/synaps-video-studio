// Тест скилла blender-asset-factory: остров из Blender (GLB) в @remotion/three.
// Один дубль: медленная орбита 30° + наезд, лопасти мельницы крутятся, облака дрейфуют.
import React from "react";
import { AbsoluteFill, getInputProps, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import * as THREE from "three";
import { orbit, tween } from "@studio";
import { AnimatedGltf, CameraRig, enableShadows, fitDistance, glow, InFrame, recolor, spinLocal, StudioLights, ThreeCanvas, Tone } from "@studio/three-d";

// --props '{"winter":1}' — снег (перекраска групп), '{"night":1}' — ночь (свет + окна светятся)
const P = getInputProps() as { winter?: number; night?: number };
import meta from "../public/3d/island.json";

export const Video: React.FC = () => {
  const frame = useCurrentFrame();
  const { width: W, height: H, durationInFrames: D } = useVideoConfig();
  const fov = 30;
  const target: [number, number, number] = [0, 0.35, 0];
  // кадрирование по острову с водой (без облаков): радиус воды 3.6 + высота маяка
  const R0 = fitDistance(3.9, fov, W, H, 0.95);
  const radius = tween(frame, [[0, R0], [D - 1, R0 * 0.9]]);
  const cam = orbit(frame, { start: 0, end: D - 1, azimuth0: 28, dAzimuth: -30, radius, elevation: 38, target });
  return (
    <AbsoluteFill style={{ background: P.night ? "linear-gradient(180deg, #0f1a3a 0%, #24315e 60%, #3a3f6e 100%)" : "linear-gradient(180deg, #9fd3ee 0%, #f7e9d6 62%, #f3dcc4 100%)" }}>
      <ThreeCanvas width={W} height={H} camera={{ fov }} shadows>
        <Tone mode="neutral" />
        <StudioLights preset={P.night ? "night" : "soft"} target={target} scale={1.6} intensity={1.1} />
        <CameraRig position={cam.position} target={cam.target} fov={fov} />
        <InFrame id="island">
          <AnimatedGltf
            src={staticFile("3d/island.glb")}
            setup={(s) => enableShadows(s)}
            animate={(n, f) => {
              if (n === f.root) {
                if (P.winter) recolor(n, /^ground|^roof|^foliage/, "#f2f4f7", 0.82 * P.winter);
                glow(n, /^window_emissive|^lamp_emissive/, "#ffc864", P.night ? 3 : 0);
              }
              if (n.name.startsWith("blades_")) spinLocal(n, f.base, "-z", f.frame * 0.05);
              if (n.name.startsWith("cloud")) n.position.x = f.base.position.x + f.frame * 0.002;
            }}
          />
        </InFrame>
      </ThreeCanvas>
    </AbsoluteFill>
  );
};
