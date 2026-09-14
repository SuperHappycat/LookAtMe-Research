/**
 * lib/vision/test3Scoring.ts
 * ============================
 * Port of gui/test3.py: Block vs Face joint attention. The stimulus
 * clip (rja.mp4) has two phases -- 0-5s two children play with blocks
 * (block phase), 5s+ the blocks topple and they turn to look at each
 * other (face phase). Same "on target" classification as Test 2, just
 * with different phase boundaries/labels.
 */

import type { GazeDirection } from "./types";

export const TEST3_PHASE1_END_SEC = 5.0;

export type Test3Region = "OnBlock" | "OffBlock" | "OnFace" | "OffFace";

export function mapTest3Region(
  direction: GazeDirection,
  eyesDetected: boolean,
  videoPosSec: number,
): Test3Region {
  const onTarget = eyesDetected && direction === "Center";
  if (videoPosSec < TEST3_PHASE1_END_SEC) {
    return onTarget ? "OnBlock" : "OffBlock";
  }
  return onTarget ? "OnFace" : "OffFace";
}

export interface Test3Results {
  blockPct: number;
  facePct: number;
  accuracyPct: number;
  latencyMs: number | null;
}

export function finalizeTest3Results(regionLog: Test3Region[], sampleDurationMs: number): Test3Results {
  const blockLog = regionLog.filter((r) => r === "OnBlock" || r === "OffBlock");
  const faceLog = regionLog.filter((r) => r === "OnFace" || r === "OffFace");
  const blockN = blockLog.length || 1;
  const faceN = faceLog.length || 1;
  const blockPct = (100 * blockLog.filter((r) => r === "OnBlock").length) / blockN;
  const facePct = (100 * faceLog.filter((r) => r === "OnFace").length) / faceN;

  const combinedN = blockLog.length + faceLog.length;
  const combinedOn = blockLog.filter((r) => r === "OnBlock").length + faceLog.filter((r) => r === "OnFace").length;
  const accuracyPct = combinedN ? (100 * combinedOn) / combinedN : 0;

  // Latency: how long after the face phase begins until the first
  // "OnFace" sample -- i.e. how quickly attention follows the shift
  // from blocks to faces.
  let firstOnFaceIndex: number | null = null;
  let phase2Started = false;
  let phase2SampleOffset = 0;
  for (let i = 0; i < regionLog.length; i++) {
    const r = regionLog[i];
    if (r === "OnFace" || r === "OffFace") {
      if (!phase2Started) {
        phase2Started = true;
        phase2SampleOffset = i;
      }
      if (r === "OnFace") {
        firstOnFaceIndex = i;
        break;
      }
    }
  }
  const latencyMs = firstOnFaceIndex !== null ? (firstOnFaceIndex - phase2SampleOffset) * sampleDurationMs : null;

  return { blockPct, facePct, accuracyPct, latencyMs };
}
