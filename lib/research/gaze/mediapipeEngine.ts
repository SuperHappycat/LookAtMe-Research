"use client";

/**
 * lib/research/gaze/mediapipeEngine.ts
 * ======================================
 * MediaPipe Face Landmarker (iris landmarks) running on the main thread.
 * The WASM files and the model are self-hosted under /public/mediapipe
 * (copied/downloaded by scripts/setup-mediapipe.mjs) so the app does not
 * depend on a CDN and can later work offline.
 *
 * Frames arrive at the same 100 ms cadence as the OpenCV engine (the test
 * runner's DETECTION_INTERVAL_MS), so the original scoring's
 * "one sample = 100 ms" assumption still holds.
 */

import type { FaceLandmarker as FaceLandmarkerType } from "@mediapipe/tasks-vision";
import { RESEARCH_CONFIG } from "../config";
import { getActiveModel } from "./calibrationStore";
import { extractFeatures, type FrameFeatures } from "./features";
import { predictGaze } from "./regression";
import type { EngineListener, EngineMessage, EngineStatus, GazeEngine, GazePoint } from "./types";

let landmarker: FaceLandmarkerType | null = null;
let status: EngineStatus = "loading";
let initError: string | null = null;
let initPromise: Promise<void> | null = null;
let lastTimestamp = 0;
let smoothed: GazePoint | null = null;
const listeners = new Set<EngineListener>();

function emit(msg: EngineMessage) {
  listeners.forEach((l) => l(msg));
}

async function init(): Promise<void> {
  const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks(RESEARCH_CONFIG.mediapipeWasmPath);
  const options = (delegate: "GPU" | "CPU") => ({
    baseOptions: { modelAssetPath: RESEARCH_CONFIG.mediapipeModelPath, delegate },
    runningMode: "VIDEO" as const,
    numFaces: 1,
  });
  try {
    landmarker = await FaceLandmarker.createFromOptions(fileset, options("GPU"));
  } catch {
    landmarker = await FaceLandmarker.createFromOptions(fileset, options("CPU"));
  }
}

function ensureInit() {
  if (initPromise) return initPromise;
  status = "loading";
  initError = null;
  initPromise = init()
    .then(() => {
      status = "ready";
      emit({ type: "ready" });
    })
    .catch((err: unknown) => {
      status = "error";
      initError = err instanceof Error ? err.message : String(err);
      initPromise = null; // allow a retry
      emit({ type: "error", message: initError });
    });
  return initPromise;
}

/** Runs the landmarker on one canvas frame. Shared by the live engine and the calibration page. */
export function detectFeatures(canvas: HTMLCanvasElement): FrameFeatures | null {
  if (!landmarker) return null;
  const ts = Math.max(performance.now(), lastTimestamp + 1);
  lastTimestamp = ts;
  const result = landmarker.detectForVideo(canvas, ts);
  const face = result.faceLandmarks?.[0];
  if (!face) return null;
  return extractFeatures(face, canvas.width, canvas.height);
}

export function isBlink(f: FrameFeatures): boolean {
  return f.openness < RESEARCH_CONFIG.blinkOpennessMin;
}

export const mediapipeEngine: GazeEngine = {
  name: "mediapipe",
  requiresCalibration: true,
  preload() {
    if (typeof window !== "undefined") void ensureInit();
  },
  getStatus() {
    return { status, error: initError };
  },
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  reset() {
    smoothed = null;
  },
  submitFrame(canvas, tMs) {
    if (status !== "ready" || !landmarker) {
      void ensureInit();
      return false;
    }
    let f: FrameFeatures | null;
    try {
      f = detectFeatures(canvas);
    } catch (err) {
      emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
      return false;
    }
    const model = getActiveModel();
    const faceFound = f !== null;
    const eyesOpen = f !== null && !isBlink(f);
    let point: GazePoint | null = null;
    if (f && eyesOpen && model) {
      const raw = predictGaze(model, f.features);
      const a = RESEARCH_CONFIG.smoothingAlpha;
      smoothed = smoothed ? { x: a * smoothed.x + (1 - a) * raw.x, y: a * smoothed.y + (1 - a) * raw.y } : raw;
      point = smoothed;
    }
    emit({
      type: "result",
      sample: {
        // The test runner replaces this with a layout-based direction when `point` is set.
        direction: "Unknown",
        eyesDetected: eyesOpen,
        confidence: eyesOpen ? 1 : faceFound ? 0.2 : 0,
        faceFound,
        point,
        tMs,
      },
    });
    return true;
  },
};
