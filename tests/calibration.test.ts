/** Calibration v2 helpers + a simulation showing why fixation filtering helps. Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chooseMode,
  dropOutliers,
  gradeDeg,
  isFixating,
  nearestPoint,
  orderPoints,
  pxToDeg,
  worstIndices,
} from "../lib/research/gaze/calibrationCore.ts";
import { fitGazeModel, predictGaze, type FeatureVector } from "../lib/research/gaze/regression.ts";
import { headPose } from "../lib/research/gaze/features.ts";
import { computeQuality } from "../lib/research/quality.ts";

const fv = (ex: number, ey: number, extra: Partial<FeatureVector> = {}): FeatureVector => ({
  ex, ey, hx: 0, hy: 0, px: 0.5, py: 0.45, s: 0.3, yaw: 0, pitch: 0, ...extra,
});

test("isFixating: still eyes yes, moving eyes no", () => {
  const still = [fv(0.1, 0.05), fv(0.101, 0.051), fv(0.099, 0.05), fv(0.1, 0.049)];
  const moving = [fv(0.0, 0.0), fv(0.03, 0.01), fv(0.07, 0.02), fv(0.1, 0.05)];
  assert.equal(isFixating(still, 4, 0.035), true);
  assert.equal(isFixating(moving, 4, 0.035), false);
  assert.equal(isFixating(still.slice(0, 2), 4, 0.035), false);
});

test("dropOutliers removes a stray sample", () => {
  const s = [fv(0.1, 0.05), fv(0.102, 0.05), fv(0.099, 0.051), fv(0.1, 0.049), fv(0.101, 0.05), fv(0.4, 0.3)];
  const kept = dropOutliers(s);
  assert.equal(kept.length, 5);
  assert.ok(kept.every((f) => f.ex < 0.2));
});

test("pxToDeg / gradeDeg", () => {
  // 1 cm at 60 cm ≈ 0.955°; 96 CSS px = 2.54 cm ≈ 2.42°
  assert.ok(Math.abs(pxToDeg(96, 60) - 2.425) < 0.01);
  assert.equal(gradeDeg(2), "high");
  assert.equal(gradeDeg(3), "medium");
  assert.equal(gradeDeg(4.5), "low");
  assert.equal(gradeDeg(6), "fail");
  assert.equal(gradeDeg(Infinity), "fail");
});

test("chooseMode by age", () => {
  assert.equal(chooseMode(30, 72), "child");
  assert.equal(chooseMode(80, 72), "adult");
  assert.equal(chooseMode(null, 72), "child");
});

test("worstIndices / nearestPoint / orderPoints", () => {
  assert.deepEqual(worstIndices([10, 80, 30, 50], 2), [1, 3]);
  const pts = [[0.5, 0.5], [0.15, 0.15], [0.85, 0.15]] as const;
  assert.equal(nearestPoint(pts, 0.8, 0.2), 2);
  let i = 0;
  const seq = [0.9, 0.1, 0.5];
  const ordered = orderPoints([0, 1, 2, 3], (p) => p === 2, () => seq[i++ % seq.length]);
  assert.equal(ordered[0], 2, "centre first");
  assert.deepEqual([...ordered].sort(), [0, 1, 2, 3]);
});

test("headPose reads yaw/pitch from a column-major rotation matrix", () => {
  const yaw = 0.3;
  // rotation about Y, column-major 4x4
  const m = [Math.cos(yaw), 0, -Math.sin(yaw), 0, 0, 1, 0, 0, Math.sin(yaw), 0, Math.cos(yaw), 0, 0, 0, 0, 1];
  const p = headPose(m);
  assert.ok(Math.abs(p.yaw - yaw) < 1e-9);
  assert.ok(Math.abs(p.pitch) < 1e-9);
  assert.deepEqual(headPose(null), { yaw: 0, pitch: 0 });
});

test("simulation: fixation-only samples beat fixed-time samples (saccades + noise)", () => {
  let seed = 11;
  const rand = () => ((seed = (seed * 48271) % 2147483647) / 2147483647) - 0.5;
  const W = 1280, H = 800;
  const points = [[0.5, 0.5], [0.1, 0.1], [0.5, 0.1], [0.9, 0.1], [0.1, 0.5], [0.9, 0.5], [0.1, 0.9], [0.5, 0.9], [0.9, 0.9]];
  // Ground truth eye feature for a screen position (inverse of what the model learns).
  const eyeFor = (x: number, y: number) => ({ ex: (x / W - 0.5) * 0.4, ey: (y / H - 0.5) * 0.25 });
  const v1: { features: FeatureVector; x: number; y: number }[] = [];
  const v2: { features: FeatureVector; x: number; y: number }[] = [];
  let prev = eyeFor(W / 2, H / 2);
  for (const [fx, fy] of points) {
    const x = fx * W, y = fy * H;
    const tgt = eyeFor(x, y);
    const frames: FeatureVector[] = [];
    // first ~6 frames: the eyes are still travelling from the previous target (saccade / search)
    for (let k = 0; k < 6; k++) {
      const t = (k + 1) / 7;
      frames.push(fv(prev.ex + (tgt.ex - prev.ex) * t + rand() * 0.01, prev.ey + (tgt.ey - prev.ey) * t + rand() * 0.01));
    }
    for (let k = 0; k < 18; k++) frames.push(fv(tgt.ex + rand() * 0.012, tgt.ey + rand() * 0.012));
    frames.forEach((f) => v1.push({ features: f, x, y })); // v1: everything in the time window
    const fix: FeatureVector[] = [];
    for (let k = 3; k < frames.length; k++) if (isFixating(frames.slice(0, k + 1), 4, 0.035)) fix.push(frames[k]);
    dropOutliers(fix).forEach((f) => v2.push({ features: f, x, y }));
    prev = tgt;
  }
  const evalErr = (model: ReturnType<typeof fitGazeModel>) => {
    let sum = 0;
    const val = [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]];
    for (const [fx, fy] of val) {
      const e = eyeFor(fx * W, fy * H);
      const p = predictGaze(model, fv(e.ex, e.ey));
      sum += Math.hypot(p.x - fx * W, p.y - fy * H);
    }
    return sum / val.length;
  };
  const e1 = evalErr(fitGazeModel(v1, 0.01, "full"));
  const e2 = evalErr(fitGazeModel(v2, 0.01, "full"));
  assert.ok(e2 < e1 * 0.6, `fixation-filtered error ${e2.toFixed(1)} px should be well below fixed-time ${e1.toFixed(1)} px`);
});

test("quality: drift at the final check flags a retest", () => {
  const base = { faceFound: Array(50).fill(true), luma: [120], faceScale: [0.3], calibration: null, maxEndCheckDeg: 6 };
  assert.deepEqual(computeQuality({ ...base, endCheckDeg: 3 }).reasons, []);
  assert.deepEqual(computeQuality({ ...base, endCheckDeg: 8 }).reasons, ["drift_after_tests"]);
  assert.deepEqual(computeQuality({ ...base, endCheckDeg: null }).reasons, []);
});
