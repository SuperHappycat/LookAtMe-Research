/**
 * lib/research/config.ts
 * ========================
 * Every tunable number for the Research app lives here.
 *
 * Values marked "TBD – tune with pilot data" are placeholders chosen only
 * so the prototype runs. They are NOT clinical cut-offs and must be set by
 * the clinical lead after a pilot. Do not hard-code these numbers anywhere
 * else.
 */

export type GazeEngineName = "mediapipe" | "opencv";

function readEngine(): GazeEngineName {
  const v = process.env.NEXT_PUBLIC_GAZE_ENGINE;
  return v === "opencv" ? "opencv" : "mediapipe";
}

export const RESEARCH_CONFIG = {
  /** Which gaze engine the Research app uses. Set NEXT_PUBLIC_GAZE_ENGINE=opencv to fall back. */
  gazeEngine: readEngine(),

  /** Where the self-hosted MediaPipe files are served from (see scripts/setup-mediapipe.mjs). */
  mediapipeWasmPath: "/mediapipe/wasm",
  mediapipeModelPath: "/mediapipe/face_landmarker.task",

  // ---- Calibration (TBD – tune with pilot data) ----
  /** Calibration passes when the mean validation error is at or below this many CSS px. */
  maxCalibrationErrorPx: 150,
  /** How many times "recalibrate" is offered before allowing "continue with low accuracy". */
  maxRecalibrations: 2,
  /** Time the child gets to look at a new dot before samples are collected. */
  calibrationSettleMs: 700,
  /** Time samples are collected per dot. */
  calibrationCollectMs: 1200,
  /** Dot positions as fractions of the viewport (9-point grid). */
  calibrationPoints: [
    [0.1, 0.1], [0.5, 0.1], [0.9, 0.1],
    [0.1, 0.5], [0.5, 0.5], [0.9, 0.5],
    [0.1, 0.9], [0.5, 0.9], [0.9, 0.9],
  ] as ReadonlyArray<readonly [number, number]>,
  /** Extra dots used only to measure accuracy after fitting. */
  validationPoints: [
    [0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7],
  ] as ReadonlyArray<readonly [number, number]>,
  /** Ridge regularisation for the gaze mapping. */
  ridgeLambda: 0.01,
  /** Calibration is discarded if the browser window size changes by more than this fraction. */
  maxViewportChange: 0.05,

  // ---- Live gaze (TBD – tune with pilot data) ----
  /** Eye openness (lid gap / eye width) below this counts as a blink: no gaze point for that frame. */
  blinkOpennessMin: 0.1,
  /** Exponential smoothing of the gaze point (0 = none, closer to 1 = smoother but slower). */
  smoothingAlpha: 0.5,
  /** A gaze point within this many px outside a stimulus video still counts as looking at it. */
  aoiMarginPx: 40,
} as const;
