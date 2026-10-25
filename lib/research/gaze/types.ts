/**
 * lib/research/gaze/types.ts
 * ============================
 * The single seam between the test pages and whichever gaze engine runs
 * (OpenCV worker from the original app, or MediaPipe for Research).
 *
 * Scoring keeps reading only `direction` / `eyesDetected` (decision recorded
 * in docs/ORIGINAL_APP_MAP.md §9.4), so the scoring formula is unchanged for
 * both engines. MediaPipe additionally fills `point` (viewport CSS px); the
 * test runner turns that point into a direction using the stimulus layout.
 */

import type { GazeDirection } from "../../vision/types";

export type { GazeDirection };

export interface GazePoint {
  x: number; // viewport CSS px
  y: number;
}

export interface EngineSample {
  direction: GazeDirection;
  eyesDetected: boolean;
  confidence: number;
  /** Was a face found in this frame? */
  faceFound: boolean;
  /** Calibrated gaze point (MediaPipe only); null when unknown or not supported. */
  point: GazePoint | null;
  /** performance.now() when the frame was submitted. */
  tMs: number;
}

export type EngineStatus = "loading" | "ready" | "error";

export type EngineMessage =
  | { type: "ready" }
  | { type: "error"; message: string }
  | { type: "skipped" }
  | { type: "result"; sample: EngineSample };

export type EngineListener = (msg: EngineMessage) => void;

export interface GazeEngine {
  readonly name: "opencv" | "mediapipe";
  /** True when the engine can only produce gaze points after calibration. */
  readonly requiresCalibration: boolean;
  /** Start loading the engine in the background (safe to call many times). */
  preload(): void;
  getStatus(): { status: EngineStatus; error: string | null };
  subscribe(listener: EngineListener): () => void;
  /** Clear any per-run state (smoothing, self-calibration). */
  reset(): void;
  /**
   * Submit one frame from the mirrored capture canvas. The result arrives
   * through subscribe(). Returns false if the frame was not accepted
   * (engine busy or not ready).
   */
  submitFrame(canvas: HTMLCanvasElement, tMs: number): boolean;
}
