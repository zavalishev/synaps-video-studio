// Тест скилла object-scene-3d: банка мёда (Blender → GLB) — две ступени из скилла.
//   mode "three" (по умолчанию): @remotion/three, поворотный стол 30°, наезд, тень на 2D-фоне.
//   mode "seq": PNG-секвенция поворотного стола из Blender (EEVEE, без фона) + мягкая тень CSS.
import React from "react";
import { AbsoluteFill, getInputProps, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import * as Unbounded from "@remotion/google-fonts/Unbounded";
import { appear, Guarded, orbit, tween, useCyrillicFont, useTextCheck } from "@studio";
import { AnimatedGltf, BlenderSeq, CameraRig, ContactShadow, enableShadows, fitBox, InFrame, ShadowFloor, StudioEnv, StudioLights, ThreeCanvas, Tone, Turntable } from "@studio/three-d";
import meta from "../public/3d/jar.json";

const mode = (getInputProps() as { mode?: string }).mode ?? "three";
const BG = "radial-gradient(90% 60% at 50% 42%, #fbf3e2 0%, #f1e2c6 70%, #e6d2ae 100%)";

const Caption: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const font = useCyrillicFont(Unbounded, { weights: ["700"] });
  const size = Math.round(H * 0.036);
  useTextCheck("caption", { fontSizePx: size, color: "#3b2412", background: "#fbf3e2", words: 2 });
  const a = appear(frame, fps, { delay: 20, from: "up", distance: 24 });
  return (
    <Guarded id="caption" box={{ x: W * 0.1, y: H * 0.1, w: W * 0.8, h: H * 0.1 }}>
      <div style={{ ...a, height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font, fontWeight: 700, fontSize: size, color: "#3b2412", letterSpacing: "0.02em" }}>
        Липовый мёд
      </div>
    </Guarded>
  );
};

export const Video: React.FC = () => {
  const frame = useCurrentFrame();
  const { width: W, height: H, durationInFrames: D } = useVideoConfig();
  if (mode === "seq") {
    const sh = { left: W * 0.24, top: H * 0.755, width: W * 0.52, height: H * 0.035 };
    return (
      <AbsoluteFill style={{ background: BG }}>
        <div style={{ position: "absolute", ...sh, borderRadius: "50%", background: "rgba(60,40,20,.35)", filter: "blur(24px)" }} />
        <BlenderSeq prefix="3d/turn/f_" count={150} mode="clamp" style={{ left: 0, top: 0, width: W, height: H }} />
        <Caption />
      </AbsoluteFill>
    );
  }
  const fov = 26;
  const target: [number, number, number] = [0, 0.5, 0];
  const R = fitBox(meta.bbox, fov, W, H, 0.62);
  const cam = orbit(frame, { start: 0, end: D - 1, azimuth0: 0, dAzimuth: 0, radius: tween(frame, [[0, R * 1.08], [D - 1, R]]), elevation: 14, target });
  return (
    <AbsoluteFill style={{ background: BG }}>
      <ThreeCanvas width={W} height={H} camera={{ fov }} shadows>
        <Tone mode="neutral" />
        <StudioEnv intensity={0.5} />
        <StudioLights preset="product" target={target} scale={0.8} intensity={0.9} />
        <CameraRig position={cam.position} target={cam.target} fov={fov} />
        <InFrame id="jar">
          <Turntable start={0} end={D - 1} degrees={30} from={-15} id="jar-turn">
            <AnimatedGltf src={staticFile("3d/jar.glb")} setup={(s) => enableShadows(s, true, false)} />
          </Turntable>
        </InFrame>
        <ShadowFloor opacity={0.22} color="#5a3a14" />
        <ContactShadow radius={0.6} inner={0.6} opacity={0.6} color="#3b2412" />
      </ThreeCanvas>
      <Caption />
    </AbsoluteFill>
  );
};
