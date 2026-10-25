/**
 * lib/research/quality.ts
 * =========================
 * Session quality score (spec §5.1) and camera-check verdicts. Pure functions
 * so they can be unit-tested. All thresholds come from QUALITY_CONFIG and are
 * TBD – tune with pilot data. They are NOT clinical cut-offs.
 */

export const QUALITY_CONFIG = {
  /** Below this % of frames with a face, the session is flagged "retest". TBD. */
  minFaceFoundPct: 70,
  /** Acceptable mean frame brightness (0–255). TBD. */
  lumaMin: 50,
  lumaMax: 220,
  /** Acceptable face width as a fraction of the camera image width (distance proxy). TBD. */
  faceScaleMin: 0.15,
  faceScaleMax: 0.6,
  /** Weights of the three parts of the quality score (re-normalised if a part is missing). TBD. */
  weights: { face: 0.6, lighting: 0.2, distance: 0.2 },
} as const;

export interface QualityInput {
  faceFound: boolean[];
  /** Mean brightness samples (about 1 per second). */
  luma: number[];
  /** Face scale per frame where a face was found (MediaPipe only). */
  faceScale: number[];
  calibration: { meanErrorPx: number; ok: boolean; lowAccuracy: boolean } | null;
  /** Approximate degrees of error at the end-of-session check (null if not done). */
  endCheckDeg?: number | null;
  /** Threshold for endCheckDeg (from RESEARCH_CONFIG.maxEndCheckErrorDeg). */
  maxEndCheckDeg?: number;
}

export interface QualityResult {
  faceFoundPct: number;
  lightingOkPct: number | null;
  distanceOkPct: number | null;
  qualityScore: number;
  retestNeeded: boolean;
  reasons: string[];
}

const pct = (n: number, d: number) => (d > 0 ? (100 * n) / d : 0);
const round1 = (v: number) => Math.round(v * 10) / 10;

export function lumaOk(v: number): boolean {
  return v >= QUALITY_CONFIG.lumaMin && v <= QUALITY_CONFIG.lumaMax;
}

export function faceScaleOk(v: number): boolean {
  return v >= QUALITY_CONFIG.faceScaleMin && v <= QUALITY_CONFIG.faceScaleMax;
}

export function computeQuality(input: QualityInput): QualityResult {
  const faceFoundPct = pct(input.faceFound.filter(Boolean).length, input.faceFound.length);
  const lightingOkPct = input.luma.length ? pct(input.luma.filter(lumaOk).length, input.luma.length) : null;
  const distanceOkPct = input.faceScale.length ? pct(input.faceScale.filter(faceScaleOk).length, input.faceScale.length) : null;

  const w = QUALITY_CONFIG.weights;
  let sum = w.face * faceFoundPct;
  let weight = w.face;
  if (lightingOkPct !== null) {
    sum += w.lighting * lightingOkPct;
    weight += w.lighting;
  }
  if (distanceOkPct !== null) {
    sum += w.distance * distanceOkPct;
    weight += w.distance;
  }
  const qualityScore = weight > 0 ? sum / weight : 0;

  const reasons: string[] = [];
  if (input.faceFound.length === 0) reasons.push("no_samples");
  else if (faceFoundPct < QUALITY_CONFIG.minFaceFoundPct) reasons.push("face_not_found_often");
  if (input.calibration && !input.calibration.ok) reasons.push("calibration_failed");
  if (
    input.endCheckDeg !== undefined &&
    input.endCheckDeg !== null &&
    input.maxEndCheckDeg !== undefined &&
    !(input.endCheckDeg <= input.maxEndCheckDeg)
  ) {
    reasons.push("drift_after_tests");
  }

  return {
    faceFoundPct: round1(faceFoundPct),
    lightingOkPct: lightingOkPct === null ? null : round1(lightingOkPct),
    distanceOkPct: distanceOkPct === null ? null : round1(distanceOkPct),
    qualityScore: round1(qualityScore),
    retestNeeded: reasons.length > 0,
    reasons,
  };
}

export const REASON_TEXT: Record<string, string> = {
  no_samples: "ไม่มีข้อมูลการมอง / No gaze data was recorded",
  face_not_found_often: "กล้องมองไม่เห็นใบหน้าบ่อยเกินไป / The face was often not visible",
  calibration_failed: "การปรับเทียบไม่ผ่าน (ความแม่นยำต่ำ) / Calibration did not pass (low accuracy)",
  drift_after_tests:
    "ตรวจท้ายสุดพบว่าความแม่นยำลดลง (เด็กอาจขยับ) / Accuracy dropped by the end (the child may have moved)",
};
