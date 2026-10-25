// Корень ролика: одна композиция "Video". Размер и fps — из job.json.
// Длина: job.durationInFrames, а если его нет — длина job.audio (файл в public/) + tailSec.
import React from "react";
import { Composition, staticFile } from "remotion";
import { getAudioDurationInSeconds } from "@remotion/media-utils";
import jobJson from "../job.json";
import { Video } from "./Video";

type Job = { width: number; height: number; fps: number; durationInFrames?: number; audio?: string; tailSec?: number };
const job = jobJson as Job;

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Video"
    component={Video}
    width={job.width}
    height={job.height}
    fps={job.fps}
    durationInFrames={job.durationInFrames ?? job.fps * 2}
    defaultProps={{}}
    calculateMetadata={async () => {
      if (job.durationInFrames || !job.audio) return {};
      const sec = await getAudioDurationInSeconds(staticFile(job.audio));
      return { durationInFrames: Math.ceil((sec + (job.tailSec ?? 0.5)) * job.fps) };
    }}
  />
);
