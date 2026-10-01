"use client";

/**
 * lib/gazeWorkerClient.ts
 * =========================
 * One vision worker (public/gaze-worker.js) shared by the whole tab.
 * Test 1 -> 2 -> 3 are client-side navigations, so keeping the worker
 * alive at module scope means opencv.js's ~10MB WASM is downloaded and
 * compiled once per visit instead of once per test page. The intake
 * page calls preloadGazeWorker() so that work overlaps with form entry.
 */

import type { GazeDirection } from "@/lib/vision/types";

export interface WorkerSample {
  direction: GazeDirection;
  eyesDetected: boolean;
  confidence: number;
}

export type WorkerMessage =
  | { type: "ready" }
  | { type: "error"; message: string }
  | { type: "skipped" }
  | { type: "result"; sample: WorkerSample };

export type WorkerStatus = "loading" | "ready" | "error";

type Listener = (msg: WorkerMessage) => void;

let worker: Worker | null = null;
let status: WorkerStatus = "loading";
let initError: string | null = null;
const listeners = new Set<Listener>();

function emit(msg: WorkerMessage) {
  listeners.forEach((l) => l(msg));
}

/** Returns the shared worker, creating it (or retrying a failed init) on demand. */
export function getGazeWorker(): Worker {
  if (worker && status !== "error") return worker;
  worker?.terminate();

  const w = new Worker("/gaze-worker.js");
  worker = w;
  status = "loading";
  initError = null;

  w.onmessage = (e: MessageEvent<WorkerMessage>) => {
    const msg = e.data;
    if (msg.type === "ready") {
      status = "ready";
    } else if (msg.type === "error" && status === "loading") {
      status = "error";
      initError = msg.message;
    }
    emit(msg);
  };
  w.onerror = (event) => {
    status = "error";
    initError = event.message;
    emit({ type: "error", message: event.message });
  };
  w.postMessage({ type: "init" });
  return w;
}

export function preloadGazeWorker() {
  if (typeof Worker !== "undefined") getGazeWorker();
}

export function getGazeWorkerStatus(): { status: WorkerStatus; error: string | null } {
  return { status, error: initError };
}

export function subscribeGazeWorker(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
