/**
 * lib/vision/test2Scoring.ts
 * ============================
 * Port of gui/test2.py: Face vs Held-Up-Object attention. The stimulus
 * clip (talking.mp4) has two phases -- 0-11s a person talks to camera
 * (face phase), 11s+ they hold an object up (object phase). Every gaze
 * sample is classified "on target" (attending, roughly centered) or
 * not, labeled by whichever phase the clip is currently in.
 */

import type { GazeDirection } from "./types";

export const TEST2_PHASE1_END_SEC = 11.0;

export type Test2Region = "OnFace" | "OffFace" | "OnObject" | "OffObject";

export function mapTest2Region(
  direction: GazeDirection,
  eyesDetected: boolean,
  videoPosSec: number,
): Test2Region {
  const onTarget = eyesDetected && direction === "Center";
  if (videoPosSec < TEST2_PHASE1_END_SEC) {
    return onTarget ? "OnFace" : "OffFace";
  }
  return onTarget ? "OnObject" : "OffObject";
}

export interface Test2Results {
  facePct: number;
  objectPct: number;
}

export function finalizeTest2Results(regionLog: Test2Region[]): Test2Results {
  const faceLog = regionLog.filter((r) => r === "OnFace" || r === "OffFace");
  const objectLog = regionLog.filter((r) => r === "OnObject" || r === "OffObject");
  const faceN = faceLog.length || 1;
  const objectN = objectLog.length || 1;
  const facePct = (100 * faceLog.filter((r) => r === "OnFace").length) / faceN;
  const objectPct = (100 * objectLog.filter((r) => r === "OnObject").length) / objectN;
  return { facePct, objectPct };
}
