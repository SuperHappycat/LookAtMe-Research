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

  // ---- Calibration v2 (TBD – tune with pilot data; see docs/CALIBRATION_V2.md) ----
  /** Assumed eye-to-screen distance, used only to convert px errors to approximate degrees. */
  viewingDistanceCm: 60,
  /** Pass when mean validation error ≤ this (approx. degrees). 5° = the exclusion line used for infants online (Bánki et al., 2022). */
  maxCalibrationErrorDeg: 5,
  /** Final check after Test 3: error above this (approx. degrees) flags the session for retest (drift). */
  maxEndCheckErrorDeg: 6,
  /** How many times "recalibrate" is offered before allowing "continue with low accuracy". */
  maxRecalibrations: 2,
  /** Children younger than this (months) get child mode: 8 points, animated animals and sounds. */
  childModeUnderMonths: 72,
  /** Eye-feature spread (fraction of eye width) allowed across the fixation window. */
  fixationMaxSpread: 0.035,
  /** Frames (at ~20 per second) the eyes must stay still before samples count. */
  fixationWindow: 4,
  /**
   * Per mode: points, samples needed per point, re-attract after, give up after (ms).
   * `validation: []` → no separate check dots: accuracy is estimated by leave-one-point-out on the
   * `looPoints` (calibration v3; every target the child looks at also trains the model).
   */
  modes: {
    child: {
      points: [
        [0.5, 0.5], [0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85],
        [0.3, 0.3], [0.7, 0.3], [0.5, 0.75],
      ] as ReadonlyArray<readonly [number, number]>,
      validation: [] as ReadonlyArray<readonly [number, number]>,
      /** Inner points (not corners) used for the leave-one-out accuracy estimate. */
      looPoints: [0, 5, 6, 7] as ReadonlyArray<number>,
      samplesPerPoint: 12,
      validationSamples: 8,
      reattractAfterMs: 2500,
      giveUpAfterMs: 9000,
      minPoints: 6,
    },
    adult: {
      points: [
        [0.5, 0.5], [0.1, 0.1], [0.5, 0.1], [0.9, 0.1], [0.1, 0.5],
        [0.9, 0.5], [0.1, 0.9], [0.5, 0.9], [0.9, 0.9],
      ] as ReadonlyArray<readonly [number, number]>,
      validation: [
        [0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7],
      ] as ReadonlyArray<readonly [number, number]>,
      looPoints: [] as ReadonlyArray<number>,
      samplesPerPoint: 18,
      validationSamples: 10,
      reattractAfterMs: 2000,
      giveUpAfterMs: 6000,
      minPoints: 7,
    },
  },
  /** End-of-session check (after Test 3). */
  endCheckPoints: [
    [0.3, 0.35], [0.7, 0.35], [0.5, 0.7],
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

  // ---- Gaze check page (/r/gaze-check; demo / pilot only, nothing saved) ----
  gazeCheck: {
    /** 3×3 target positions as fractions of the window width/height. */
    gridFractions: [0.15, 0.5, 0.85] as ReadonlyArray<number>,
    /** Target radius as a fraction of the gap between neighbouring targets (smaller window side). */
    targetRadiusOfGap: 0.4,
    /** Time the gaze dot must stay in a target before it lights up. */
    dwellMs: 1000,
    /** Blinks / brief exits shorter than this do not break a dwell. */
    maxGapMs: 300,
    /** Number of past points drawn in the fading trail (one per detection frame, ~100 ms). */
    trailLength: 8,
  },
} as const;
