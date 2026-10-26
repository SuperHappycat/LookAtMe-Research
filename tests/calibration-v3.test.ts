/**
 * Calibration v3: the compact gaze model and leave-one-point-out accuracy, on simulated children whose head
 * moves and turns between targets (eye-in-head angle + head pose + head position → screen point).
 * Run with: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fitGazeModel, leaveOnePointOut, median, predictGaze, type FeatureVector } from "../lib/research/gaze/regression.ts";

let seed = 11;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const gauss = () => {
  let u = 0;
  while (!u) u = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
};

const W = 1440;
const H = 900;
const D = 1900; // ≈ 50 cm in CSS px
type Pt = { x: number; y: number; features: FeatureVector[] };

/** A restless child: head wanders and partly turns toward each target; iris landmarks are noisy. */
function look(fx: number, fy: number, n = 12): Pt {
  const tx = fx * W;
  const ty = fy * H;
  const h = {
    x: 150 * gauss(),
    y: 80 * gauss(),
    yaw: 0.3 * Math.atan2(tx - W / 2, D) + 0.06 * gauss(),
    pitch: 0.3 * Math.atan2(ty - H * 0.35, D) + 0.05 * gauss(),
    dist: 1 + 0.12 * gauss(),
  };
  const features = Array.from({ length: n }, () => {
    const ax = Math.atan2(tx - (W / 2 + h.x), D * h.dist) - h.yaw;
    const ay = Math.atan2(ty - (H * 0.35 + h.y), D * h.dist) - h.pitch;
    return {
      ex: 0.45 * Math.sin(ax) + 0.015 * gauss(),
      ey: 0.3 * Math.sin(ay) + 0.015 * gauss(),
      hx: 0.8 * Math.sin(h.yaw) + 0.01 * gauss(),
      hy: 0.8 * Math.sin(h.pitch) + 0.01 * gauss(),
      px: 0.5 - h.x / 2400 + 0.003 * gauss(),
      py: 0.45 + h.y / 2400 + 0.003 * gauss(),
      s: 0.28 / h.dist + 0.003 * gauss(),
      yaw: h.yaw + 0.01 * gauss(),
      pitch: h.pitch + 0.01 * gauss(),
    };
  });
  return { x: tx, y: ty, features };
}

const samples = (pts: Pt[]) => pts.flatMap((p) => p.features.map((features) => ({ features, x: p.x, y: p.y })));
const meanErr = (m: ReturnType<typeof fitGazeModel>, pts: Pt[]) =>
  pts.reduce((a, p) => {
    const ps = p.features.map((f) => predictGaze(m, f));
    return a + Math.hypot(median(ps.map((q) => q.x)) - p.x, median(ps.map((q) => q.y)) - p.y);
  }, 0) / pts.length;

const V2_CHILD = [[0.5, 0.5], [0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]];
const V3_CHILD = [...V2_CHILD, [0.3, 0.3], [0.7, 0.3], [0.5, 0.75]];
const GRID: number[][] = [];
for (const gx of [0.2, 0.4, 0.6, 0.8]) for (const gy of [0.25, 0.5, 0.75]) GRID.push([gx, gy]);

test("v3 (8 points, compact model) is far more accurate than v2 (5 points, full model) for a moving child", () => {
  let v2 = 0;
  let v3 = 0;
  const R = 30;
  for (let r = 0; r < R; r++) {
    const grid = GRID.map(([x, y]) => look(x, y));
    v2 += meanErr(fitGazeModel(samples(V2_CHILD.map(([x, y]) => look(x, y))), 0.01, "full"), grid);
    v3 += meanErr(fitGazeModel(samples(V3_CHILD.map(([x, y]) => look(x, y))), 0.01), grid);
  }
  v2 /= R;
  v3 /= R;
  assert.ok(v3 < v2 * 0.5, `v3 ${v3.toFixed(0)} px should be under half of v2 ${v2.toFixed(0)} px`);
  assert.ok(v3 < 198, `v3 ${v3.toFixed(0)} px should be under ~5° (198 px at 60 cm)`);
});

test("leave-one-point-out on the inner points tracks the true error", () => {
  const inner = [0, 5, 6, 7];
  let est = 0;
  let truth = 0;
  const R = 30;
  for (let r = 0; r < R; r++) {
    const pts = V3_CHILD.map(([x, y]) => look(x, y));
    const loo = leaveOnePointOut(pts, 0.01, (i) => inner.includes(i));
    assert.equal(loo.length, inner.length);
    est += loo.reduce((a, b) => a + b, 0) / loo.length;
    truth += meanErr(fitGazeModel(samples(pts), 0.01), GRID.map(([x, y]) => look(x, y)));
  }
  assert.ok(Math.abs(est - truth) / truth < 0.35, `estimate ${(est / R).toFixed(0)} px vs true ${(truth / R).toFixed(0)} px`);
});

test("records saved before v3 (no design) still predict with the full design", () => {
  const pts = V3_CHILD.map(([x, y]) => look(x, y));
  const full = fitGazeModel(samples(pts), 0.01, "full");
  const legacy = { ...full };
  delete legacy.design;
  const f = pts[0].features[0];
  assert.deepEqual(predictGaze(legacy, f), predictGaze(full, f));
});

test("fitBestModel: picks a design per person and stays accurate for a moving child", async () => {
  const { fitBestModel } = await import("../lib/research/gaze/regression.ts");
  let err = 0;
  const R = 15;
  for (let r = 0; r < R; r++) {
    const pts = V3_CHILD.map(([x, y]) => look(x, y));
    const best = fitBestModel(pts, 0.01);
    assert.ok(["eyes", "compact", "compact_int"].includes(best.design));
    assert.equal(best.looErrors.length, pts.length);
    err += meanErr(best.model, GRID.map(([x, y]) => look(x, y)));
  }
  assert.ok(err / R < 198, `chosen model ${(err / R).toFixed(0)} px should be under ~5°`);
});

test("fitBestModel: a still head with tilted-eye geometry prefers a model with the eye-x × eye-y term", async () => {
  const { fitBestModel } = await import("../lib/research/gaze/regression.ts");
  // Real data showed the iris's sideways offset shrinking when looking down: ex = gx·(1 − 1.2·gy).
  const pts = V3_CHILD.map(([fx, fy]) => {
    const gx = fx - 0.5;
    const gy = fy - 0.5;
    const features = Array.from({ length: 12 }, () => ({
      ex: 0.25 * gx * (1 - 1.2 * gy) + 0.002 * gauss(),
      ey: 0.09 * gy + 0.002 * gauss(),
      hx: 0.001 * gauss(), hy: 0.1 + 0.001 * gauss(), px: 0.48 + 0.002 * gauss(), py: 0.91 + 0.002 * gauss(),
      s: 0.45 + 0.001 * gauss(), yaw: -0.015 + 0.003 * gauss(), pitch: 0.05 + 0.003 * gauss(),
    }));
    return { x: fx * W, y: fy * H, features };
  });
  const best = fitBestModel(pts, 0.01);
  assert.ok(best.design === "eyes" || best.design === "compact_int", `got ${best.design}`);
  assert.ok((best.tried[best.design] ?? Infinity) <= (best.tried.compact ?? Infinity));
});

test("facePositionHint: warns for a low, off-centre or too-close face", async () => {
  const { facePositionHint } = await import("../lib/research/gaze/calibrationCore.ts");
  assert.match(facePositionHint({ px: 0.5, py: 0.92, s: 0.3 }) ?? "", /low/);
  assert.match(facePositionHint({ px: 0.1, py: 0.5, s: 0.3 }) ?? "", /middle/);
  assert.match(facePositionHint({ px: 0.5, py: 0.5, s: 0.45 }) ?? "", /close/);
  assert.equal(facePositionHint({ px: 0.5, py: 0.5, s: 0.25 }), null);
});
