"use client";

/**
 * lib/research/gaze/opencvEngine.ts
 * ===================================
 * Adapter that exposes the original app's OpenCV worker
 * (lib/gazeWorkerClient.ts + public/gaze-worker.js) through the GazeEngine
 * seam. Behaviour is identical to the original: one RGBA frame in flight at
 * a time, direction/eyesDetected/confidence passed straight through.
 */

import {
  getGazeWorker,
  getGazeWorkerStatus,
  preloadGazeWorker,
  subscribeGazeWorker,
} from "../../gazeWorkerClient";
import type { EngineListener, GazeEngine } from "./types";

const listeners = new Set<EngineListener>();
let attached = false;
let inFlight = false;
let lastSubmitT = 0;

function attach() {
  if (attached) return;
  attached = true;
  subscribeGazeWorker((msg) => {
    if (msg.type === "result") {
      inFlight = false;
      const s = msg.sample;
      listeners.forEach((l) =>
        l({
          type: "result",
          sample: {
            direction: s.direction,
            eyesDetected: s.eyesDetected,
            confidence: s.confidence,
            faceFound: s.eyesDetected,
            point: null,
            tMs: lastSubmitT,
          },
        }),
      );
    } else {
      if (msg.type === "skipped" || msg.type === "error") inFlight = false;
      listeners.forEach((l) => l(msg));
    }
  });
}

export const opencvEngine: GazeEngine = {
  name: "opencv",
  requiresCalibration: false,
  preload() {
    attach();
    preloadGazeWorker();
  },
  getStatus() {
    return getGazeWorkerStatus();
  },
  subscribe(listener) {
    attach();
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  reset() {
    inFlight = false;
    getGazeWorker().postMessage({ type: "reset" });
  },
  submitFrame(canvas, tMs) {
    attach();
    if (inFlight) return false;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    inFlight = true;
    lastSubmitT = tMs;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    getGazeWorker().postMessage(
      { type: "frame", width: canvas.width, height: canvas.height, buffer: imageData.data.buffer },
      [imageData.data.buffer],
    );
    return true;
  },
};
