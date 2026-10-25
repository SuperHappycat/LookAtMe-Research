"use client";

/**
 * lib/research/researchLogger.ts
 * ================================
 * Called by hooks/useGazeTestRunner.ts at test start, on every sample and at
 * stop. Does nothing unless a Research screening is active (see
 * lib/research/screening.ts), so the original test flow is unaffected.
 */

import { addLuma, addRow, persistGazeLog, setLevelStimulusBox, startLevel } from "./gazeLog";
import { getResearchContext } from "./screening";
import { startRecording, type RecordingHandle } from "./recording";
import { handleFinishedRecording } from "./recordingUploader";
import type { Box } from "./gaze/direction";
import type { EngineSample } from "./gaze/types";

let active = false;
let level: 1 | 2 | 3 = 1;
let t0 = 0;
let lumaTimer: number | null = null;
let lastBox: { left: number; top: number; width: number; height: number } | null = null;
let lumaCanvas: HTMLCanvasElement | null = null;
let currentVideoId = "";
// Screen recording (agent A, spec §4.4): one per level, only with recording consent.
let recorder: RecordingHandle | null = null;
let lastPoint: { x: number; y: number } | null = null;

function levelFromPath(): 1 | 2 | 3 | null {
  const m = /\/test([123])\b/.exec(window.location.pathname);
  return m ? (Number(m[1]) as 1 | 2 | 3) : null;
}

function union(boxes: Box[]) {
  if (boxes.length === 0) return null;
  const left = Math.min(...boxes.map((b) => b.left));
  const top = Math.min(...boxes.map((b) => b.top));
  const right = Math.max(...boxes.map((b) => b.right));
  const bottom = Math.max(...boxes.map((b) => b.bottom));
  return { left, top, width: right - left, height: bottom - top };
}

/** Mean brightness (0–255) of a 32×24 thumbnail of the capture canvas. */
function measureLuma(src: HTMLCanvasElement): number | null {
  lumaCanvas ??= Object.assign(document.createElement("canvas"), { width: 32, height: 24 });
  const ctx = lumaCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, 32, 24);
  const d = ctx.getImageData(0, 0, 32, 24).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return sum / (d.length / 4);
}

function videoId(v: HTMLVideoElement | null): string {
  const src = v?.currentSrc || v?.getAttribute("src") || "";
  return src.split("/").pop()?.replace(/\.[a-z0-9]+$/i, "") ?? "";
}

export const researchLogger = {
  start(videos: (HTMLVideoElement | null)[], getCanvas: () => HTMLCanvasElement | null) {
    this.stop();
    const lv = typeof window !== "undefined" ? levelFromPath() : null;
    active = !!lv && !!getResearchContext();
    if (!active || !lv) return;
    level = lv;
    t0 = performance.now();
    lastBox = null;
    const ids = videos.map(videoId).filter(Boolean);
    currentVideoId = ids.join("+");
    startLevel({
      level,
      videoIds: ids,
      startedAt: Date.now(),
      viewport: { w: window.innerWidth, h: window.innerHeight },
      stimulusBox: null,
    });
    lumaTimer = window.setInterval(() => {
      const c = getCanvas();
      const v = c ? measureLuma(c) : null;
      if (v !== null) addLuma(level, v);
    }, 1000);
    lastPoint = null;
    if (getResearchContext()?.allowRecording === true) {
      try {
        recorder = startRecording({ videos, webcam: getCanvas, gaze: () => lastPoint });
      } catch (err) {
        console.warn("recording failed to start:", err instanceof Error ? err.message : err);
        recorder = null;
      }
    }
  },

  sample(s: EngineSample, videoPosSec: number, boxes: Box[]) {
    if (!active) return;
    const box = union(boxes);
    if (box && box.width > 0) lastBox = box;
    const p = s.point;
    lastPoint = p ? { x: p.x, y: p.y } : null;
    addRow({
      level,
      video_id: currentVideoId,
      t_ms: Math.round(performance.now() - t0),
      video_pos_s: videoPosSec,
      x_px: p ? p.x : null,
      y_px: p ? p.y : null,
      x_norm: p && box && box.width > 0 ? (p.x - box.left) / box.width : null,
      y_norm: p && box && box.height > 0 ? (p.y - box.top) / box.height : null,
      direction: s.direction,
      face_found: s.faceFound,
      eyes_detected: s.eyesDetected,
      confidence: s.confidence,
      face_scale: s.faceScale ?? null,
    });
  },

  stop() {
    if (lumaTimer !== null) window.clearInterval(lumaTimer);
    lumaTimer = null;
    if (!active) return;
    setLevelStimulusBox(level, lastBox);
    persistGazeLog();
    active = false;
    const rec = recorder;
    recorder = null;
    const ctx = getResearchContext();
    if (rec && ctx) {
      const lv = level;
      void rec
        .stop()
        .then((result) => (result ? handleFinishedRecording(result, ctx, lv) : undefined))
        .catch((err) => console.warn("recording not saved:", err instanceof Error ? err.message : err));
    } else {
      rec?.cancel();
    }
  },
};
