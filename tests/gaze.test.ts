/**
 * Unit tests for the pure gaze helpers (no browser, no MediaPipe).
 * Run with: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fitGazeModel, predictGaze, solveLinear, median } from "../lib/research/gaze/regression.ts";
import { directionFromPoint } from "../lib/research/gaze/direction.ts";
import { extractFeatures, type Landmark } from "../lib/research/gaze/features.ts";

test("solveLinear solves a 3x3 system", () => {
  const x = solveLinear(
    [
      [2, 1, -1],
      [-3, -1, 2],
      [-2, 1, 2],
    ],
    [8, -11, -3],
  );
  assert.deepEqual(x.map((v) => Math.round(v * 1e6) / 1e6), [2, 3, -1]);
});

test("fitGazeModel recovers a known smooth mapping", () => {
  // Synthetic ground truth: screen position depends on eye offsets plus a head term.
  const truth = (ex: number, ey: number, hx: number) => ({
    x: 700 + 3000 * ex + 400 * ex * ex + 250 * hx,
    y: 400 + 2500 * ey - 150 * ex * ey,
  });
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const samples = Array.from({ length: 300 }, () => {
    const f = { ex: rand() * 0.3, ey: rand() * 0.2, hx: rand() * 0.2, hy: rand() * 0.1, px: 0.5 + rand() * 0.1, py: 0.45 + rand() * 0.1, s: 0.3 + rand() * 0.05, yaw: rand() * 0.2, pitch: rand() * 0.1 };
    return { features: f, ...truth(f.ex, f.ey, f.hx) };
  });
  const model = fitGazeModel(samples, 1e-6, "full");
  const probe = { ex: 0.05, ey: -0.04, hx: 0.03, hy: 0, px: 0.5, py: 0.45, s: 0.3, yaw: 0.02, pitch: 0 };
  const p = predictGaze(model, probe);
  const t = truth(probe.ex, probe.ey, probe.hx);
  assert.ok(Math.abs(p.x - t.x) < 1, `x ${p.x} vs ${t.x}`);
  assert.ok(Math.abs(p.y - t.y) < 1, `y ${p.y} vs ${t.y}`);
});

test("fitGazeModel refuses too few samples", () => {
  assert.throws(() => fitGazeModel([], 0.01));
});

test("median", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

const left = { left: 100, top: 200, right: 500, bottom: 500 };
const right = { left: 600, top: 200, right: 1000, bottom: 500 };
const single = { left: 300, top: 150, right: 900, bottom: 500 };

test("direction: two videos (Test 1)", () => {
  assert.equal(directionFromPoint({ x: 300, y: 300 }, [right, left], 40), "Left");
  assert.equal(directionFromPoint({ x: 50, y: 300 }, [left, right], 40), "Left");
  assert.equal(directionFromPoint({ x: 800, y: 300 }, [left, right], 40), "Right");
  assert.equal(directionFromPoint({ x: 550, y: 300 }, [left, right], 40), "Center");
});

test("direction: one video (Test 2/3)", () => {
  assert.equal(directionFromPoint({ x: 600, y: 300 }, [single], 40), "Center");
  assert.equal(directionFromPoint({ x: 280, y: 300 }, [single], 40), "Center"); // within margin
  assert.equal(directionFromPoint({ x: 100, y: 300 }, [single], 40), "Left");
  assert.equal(directionFromPoint({ x: 1100, y: 300 }, [single], 40), "Right");
  assert.equal(directionFromPoint({ x: 600, y: 700 }, [single], 40), "Right"); // below, right of centre
});

test("direction: no point or no boxes -> Unknown", () => {
  assert.equal(directionFromPoint(null, [single], 40), "Unknown");
  assert.equal(directionFromPoint({ x: 1, y: 1 }, [], 40), "Unknown");
});

test("extractFeatures: iris moving right increases ex", () => {
  const base: Landmark[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  const set = (i: number, x: number, y: number) => (base[i] = { x, y });
  // Eye A corners/lids, eye B corners/lids, face outline.
  set(33, 0.40, 0.40); set(133, 0.46, 0.40); set(159, 0.43, 0.39); set(145, 0.43, 0.41);
  set(362, 0.54, 0.40); set(263, 0.60, 0.40); set(386, 0.57, 0.39); set(374, 0.57, 0.41);
  set(234, 0.35, 0.45); set(454, 0.65, 0.45); set(10, 0.5, 0.30); set(152, 0.5, 0.65); set(1, 0.5, 0.47);
  set(468, 0.43, 0.40); set(473, 0.57, 0.40);
  const centred = extractFeatures(base, 640, 480)!;
  set(468, 0.44, 0.40); set(473, 0.58, 0.40);
  const moved = extractFeatures(base, 640, 480)!;
  assert.ok(Math.abs(centred.features.ex) < 1e-9);
  assert.ok(moved.features.ex > 0.1);
  assert.ok(centred.openness > 0.1);
});

test("extractFeatures: needs all 478 landmarks", () => {
  assert.equal(extractFeatures([{ x: 0, y: 0 }], 640, 480), null);
});
