// Тест скилла materials: те же 10 стилей, что в Blender (assets/swatches.py), но в three.
// Сверка: out/compare.png — слева Blender (EEVEE), справа @remotion/three.
import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import * as THREE from "three";
import { CameraRig, InFrame, look, StudioEnv, StudioLights, ThreeCanvas, Tone, type LookStyle } from "@studio/three-d";

const STY: [LookStyle, string][] = [["clay", "#e07a5f"], ["lowpoly", "#81b29a"], ["felt", "#7aa874"], ["paper", "#f2cc8f"], ["toon", "#3d85c6"],
  ["plastic", "#e63946"], ["ceramic", "#f1faee"], ["metal", "#c9a227"], ["glass", "#bfe3f2"], ["emissive", "#ffb703"]];

export const Video: React.FC = () => {
  const { width: W, height: H } = useVideoConfig();
  const fov = 22;
  return (
    <AbsoluteFill style={{ background: "#efe6d6" }}>
      <ThreeCanvas width={W} height={H} camera={{ fov }} shadows>
        <Tone mode="neutral" />
        <StudioEnv intensity={0.5} />
        <StudioLights preset="soft" target={[0, 0.6, 0]} scale={2.2} />
        <CameraRig position={[0, 0.3, 19.5]} target={[0, 0.3, 0]} fov={fov} />
        <InFrame id="swatches">
          {STY.map(([st, col], i) => (
            <mesh key={st} position={[(i % 2) * 1.3 - 0.65, 3.0 - Math.floor(i / 2) * 1.2, 0]} castShadow material={look(st, col, { intensity: 1.5 })}>
              {st === "lowpoly" ? <icosahedronGeometry args={[0.5, 0]} /> : <sphereGeometry args={[0.5, 64, 32]} />}
            </mesh>
          ))}
        </InFrame>
        <mesh position={[0, 0, -1.2]} receiveShadow material={look("clay", "#efe6d6", { roughness: 0.95, side: THREE.DoubleSide })}>
          <planeGeometry args={[30, 30]} />
        </mesh>
      </ThreeCanvas>
    </AbsoluteFill>
  );
};
