/**
 * lib/research/gaze/features.ts
 * ===============================
 * Extracts the regression features from one frame of MediaPipe Face
 * Landmarker output (478 landmarks, including iris points 468–477).
 *
 * Works in pixel space of the capture canvas so x and y have the same scale.
 * Calibration and testing both use the same mirrored canvas, so the fitted
 * mapping absorbs the mirroring automatically.
 */

import type { FeatureVector } from "./regression";

export interface Landmark {
  x: number; // 0..1 of image width
  y: number; // 0..1 of image height
}

// MediaPipe Face Mesh indices.
const EYE_A = { c1: 33, c2: 133, top: 159, bottom: 145, iris: 468 };
const EYE_B = { c1: 263, c2: 362, top: 386, bottom: 374, iris: 473 };
const NOSE_TIP = 1;
const CHEEK_A = 234;
const CHEEK_B = 454;
const FOREHEAD = 10;
const CHIN = 152;

export interface FrameFeatures {
  features: FeatureVector;
  /** Smallest eye openness (lid gap / eye width) of the two eyes. */
  openness: number;
}

function eye(
  P: (i: number) => [number, number],
  e: { c1: number; c2: number; top: number; bottom: number; iris: number },
): { h: number; v: number; openness: number } {
  // Axis always runs image-left -> image-right so both eyes share a sign.
  let [ax, ay] = P(e.c1);
  let [bx, by] = P(e.c2);
  if (ax > bx) [ax, ay, bx, by] = [bx, by, ax, ay];
  const w = Math.hypot(bx - ax, by - ay) || 1;
  const ux = (bx - ax) / w;
  const uy = (by - ay) / w;
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const [ix, iy] = P(e.iris);
  const dx = ix - mx;
  const dy = iy - my;
  const [tx, ty] = P(e.top);
  const [lx, ly] = P(e.bottom);
  return {
    h: (dx * ux + dy * uy) / w,
    v: (-dx * uy + dy * ux) / w,
    openness: Math.hypot(lx - tx, ly - ty) / w,
  };
}

export function extractFeatures(landmarks: Landmark[], imageW: number, imageH: number): FrameFeatures | null {
  if (!landmarks || landmarks.length < 478) return null;
  const P = (i: number): [number, number] => [landmarks[i].x * imageW, landmarks[i].y * imageH];

  const a = eye(P, EYE_A);
  const b = eye(P, EYE_B);

  const [nx, ny] = P(NOSE_TIP);
  const [cax, cay] = P(CHEEK_A);
  const [cbx, cby] = P(CHEEK_B);
  const [fx, fy] = P(FOREHEAD);
  const [chx, chy] = P(CHIN);
  const faceW = Math.hypot(cbx - cax, cby - cay) || 1;
  const faceH = Math.hypot(chx - fx, chy - fy) || 1;
  const midX = (cax + cbx) / 2;
  const midY = (fy + chy) / 2;

  return {
    features: {
      ex: (a.h + b.h) / 2,
      ey: (a.v + b.v) / 2,
      hx: (nx - midX) / faceW,
      hy: (ny - midY) / faceH,
      px: nx / imageW,
      py: ny / imageH,
      s: faceW / imageW,
    },
    openness: Math.min(a.openness, b.openness),
  };
}
