/**
 * lib/research/gaze/calibrationCore.ts
 * ======================================
 * Pure helpers behind calibration v2 (unit-tested in tests/calibration.test.ts).
 *
 * Why these choices (see docs/CALIBRATION_V2.md for sources):
 * - Collect only while the eyes are *still* (a fixation), not on a fixed timer. Saccades while
 *   the child finds the dot were the main source of error in v1.
 * - Drop outliers per point (median ± 3 MAD) before fitting.
 * - Report error in approximate visual degrees as well as px, and grade it the way infant
 *   webcam studies do (high < 2.5°, medium < 3.75°, low < 5°, fail ≥ 5°; Bánki et al., 2022).
 */

import { median, type FeatureVector } from "./regression";

export type CalibrationMode = "child" | "adult";

/** True when the last `window` frames' eye features barely move: the eyes are fixating. */
export function isFixating(recent: FeatureVector[], window: number, maxSpread: number): boolean {
  if (recent.length < window) return false;
  const w = recent.slice(-window);
  const spread = (k: "ex" | "ey") => Math.max(...w.map((f) => f[k])) - Math.min(...w.map((f) => f[k]));
  return spread("ex") <= maxSpread && spread("ey") <= maxSpread;
}

/** Removes samples whose eye features are more than k median-absolute-deviations from the point's median. */
export function dropOutliers(samples: FeatureVector[], k = 3): FeatureVector[] {
  if (samples.length < 5) return samples;
  const keep = new Array<boolean>(samples.length).fill(true);
  for (const key of ["ex", "ey"] as const) {
    const vals = samples.map((s) => s[key]);
    const med = median(vals);
    const mad = median(vals.map((v) => Math.abs(v - med))) || 1e-9;
    vals.forEach((v, i) => {
      if (Math.abs(v - med) / mad > k) keep[i] = false;
    });
  }
  const kept = samples.filter((_, i) => keep[i]);
  return kept.length >= 3 ? kept : samples;
}

/**
 * Approximate visual angle of an on-screen distance. Uses CSS px at the nominal 96 px/inch and an
 * assumed viewing distance, so it is an estimate (real screens and distances vary).
 */
export function pxToDeg(px: number, viewingDistanceCm: number): number {
  const cm = (px / 96) * 2.54;
  return (2 * Math.atan(cm / 2 / viewingDistanceCm) * 180) / Math.PI;
}

export type AccuracyGrade = "high" | "medium" | "low" | "fail";

export function gradeDeg(deg: number): AccuracyGrade {
  if (!Number.isFinite(deg)) return "fail";
  if (deg < 2.5) return "high";
  if (deg < 3.75) return "medium";
  if (deg < 5) return "low";
  return "fail";
}

/** Child mode for children under `childModeUnderMonths` (or unknown age when a child is being screened). */
export function chooseMode(ageMonths: number | null, childModeUnderMonths: number): CalibrationMode {
  if (ageMonths === null) return "child";
  return ageMonths < childModeUnderMonths ? "child" : "adult";
}

/** Indices of the `n` validation points with the largest error. */
export function worstIndices(errors: number[], n: number): number[] {
  return errors
    .map((e, i) => [e, i] as const)
    .sort((a, b) => b[0] - a[0])
    .slice(0, n)
    .map(([, i]) => i);
}

/** The calibration point nearest to (x, y) in viewport fractions. */
export function nearestPoint(points: ReadonlyArray<readonly [number, number]>, x: number, y: number): number {
  let best = 0;
  let bestD = Infinity;
  points.forEach(([px, py], i) => {
    const d = (px - x) ** 2 + (py - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** Fisher–Yates shuffle with the centre point (if present) kept first; varied order keeps children interested. */
export function orderPoints<T>(points: readonly T[], isCentre: (p: T) => boolean, rand: () => number = Math.random): T[] {
  const centre = points.filter(isCentre);
  const rest = points.filter((p) => !isCentre(p));
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [...centre, ...rest];
}

/**
 * Hint when the face sits near the edge of the camera picture or too close (landmarks get worse; real
 * data had the nose at 92% of the picture height). px/py: nose position 0..1; s: face width / picture width.
 */
export function facePositionHint(f: { px: number; py: number; s: number }): string | null {
  if (f.py > 0.8) return "ใบหน้าอยู่ต่ำเกินไป ยกจอขึ้นหรือให้นั่งสูงขึ้น / Face is low in the camera: tilt the screen forward or raise the seat";
  if (f.py < 0.2) return "ใบหน้าอยู่สูงเกินไป เอียงจอไปด้านหลัง / Face is high in the camera: tilt the screen back";
  if (f.px < 0.2 || f.px > 0.8) return "ให้อยู่กลางจอ / Move to the middle, in front of the camera";
  if (f.s > 0.4) return "ใกล้จอเกินไป ถอยห่างเล็กน้อย / Too close: sit a little further back";
  return null;
}
