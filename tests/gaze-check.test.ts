/**
 * Gaze check page logic (lib/research/gaze/gazeCheck.ts): grid layout, hit testing, dwell
 * timing with blink tolerance, mean distance, random next target, trail.
 * Run with: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INITIAL_DWELL,
  dwellMeanDistance,
  gridRadius,
  gridTargets,
  hitTarget,
  pickNextTarget,
  pushTrail,
  stepDwell,
  type DwellState,
  type Pt,
} from "../lib/research/gaze/gazeCheck.ts";
import { RESEARCH_CONFIG } from "../lib/research/config.ts";

const F = [0.15, 0.5, 0.85];
const W = 1000;
const H = 800;
const targets = gridTargets(W, H, F);
const opts = { radiusPx: 100, dwellMs: 1000, maxGapMs: 300 };

/** Feeds points every 100 ms starting at t0; returns the final step and every lit index. */
function run(points: (Pt | null)[], start: DwellState = INITIAL_DWELL, t0 = 0) {
  let s = start;
  const lit: number[] = [];
  let progress = 0;
  points.forEach((p, k) => {
    const r = stepDwell(s, p, t0 + k * 100, targets, opts);
    s = r.state;
    progress = r.progress;
    if (r.lit >= 0) lit.push(r.lit);
  });
  return { s, lit, progress };
}

test("grid: 9 targets row by row, centre in the middle", () => {
  assert.equal(targets.length, 9);
  assert.deepEqual(targets[0], { x: 150, y: 120 });
  assert.deepEqual(targets[4], { x: 500, y: 400 });
  assert.deepEqual(targets[8], { x: 850, y: 680 });
});

test("radius: fraction of the gap on the smaller side, circles never overlap", () => {
  const r = gridRadius(W, H, F, 0.4);
  assert.ok(Math.abs(r - 0.4 * 0.35 * 800) < 1e-9);
  const cfg = RESEARCH_CONFIG.gazeCheck;
  for (const [w, h] of [[1440, 900], [800, 1280], [1280, 720]]) {
    const t = gridTargets(w, h, cfg.gridFractions);
    const rr = gridRadius(w, h, cfg.gridFractions, cfg.targetRadiusOfGap);
    assert.ok(2 * rr < Math.abs(t[1].x - t[0].x));
    assert.ok(2 * rr < Math.abs(t[3].y - t[0].y));
  }
});

test("hitTarget: inside → nearest index, outside → -1", () => {
  assert.equal(hitTarget({ x: 520, y: 390 }, targets, 100), 4);
  assert.equal(hitTarget({ x: 320, y: 260 }, targets, 100), -1);
  assert.equal(hitTarget({ x: 150, y: 120 }, targets, 0), 0);
});

test("dwell: lights once after 1 s inside, not before", () => {
  const c = { x: 510, y: 405 };
  const short = run(Array(10).fill(c)); // t = 0..900 ms
  assert.deepEqual(short.lit, []);
  assert.ok(short.progress > 0.85 && short.progress < 1);
  const long = run(Array(25).fill(c)); // t = 0..2400 ms
  assert.deepEqual(long.lit, [4]);
  assert.equal(long.progress, 1);
});

test("dwell: a blink (null points) shorter than maxGapMs does not reset", () => {
  const c = targets[2];
  const pts: (Pt | null)[] = [c, c, c, c, c, null, null, c, c, c, c, c];
  assert.deepEqual(run(pts).lit, [2]);
});

test("dwell: leaving for longer than maxGapMs resets the timer", () => {
  const c = targets[2];
  const away = { x: 320, y: 260 };
  const pts: Pt[] = [c, c, c, c, c, c, away, away, away, away, away, c, c, c, c, c];
  const r = run(pts);
  assert.deepEqual(r.lit, []);
  assert.equal(r.s.index, 2);
  assert.equal(r.s.startMs, 1100);
});

test("dwell: jumping straight into another target restarts there", () => {
  const pts = [...Array(6).fill(targets[0]), ...Array(11).fill(targets[8])];
  const r = run(pts);
  assert.deepEqual(r.lit, [8]);
});

test("mean distance: average over the dwell samples, reset for a new dwell", () => {
  const t = targets[4];
  const pts = [
    { x: t.x + 30, y: t.y },
    { x: t.x, y: t.y + 40 },
    { x: t.x - 50, y: t.y },
  ];
  const r = run(pts);
  assert.equal(dwellMeanDistance(r.s), 40);
  assert.equal(dwellMeanDistance(INITIAL_DWELL), null);
  const r2 = run([targets[0]], r.s, 1000);
  assert.equal(dwellMeanDistance(r2.s), 0);
  assert.equal(r2.s.n, 1);
});

test("pickNextTarget: never repeats the current one, covers all others", () => {
  const seen = new Set<number>();
  for (let i = 0; i < 9; i++) {
    for (const u of [0, 0.3, 0.5, 0.99]) {
      const k = pickNextTarget(i, 9, () => u);
      assert.notEqual(k, i);
      assert.ok(k >= 0 && k < 9);
    }
  }
  for (let j = 0; j < 8; j++) seen.add(pickNextTarget(4, 9, () => j / 8));
  assert.equal(seen.size, 8);
  assert.equal(pickNextTarget(-1, 9, () => 0.999), 8);
  assert.equal(pickNextTarget(0, 1), 0);
});

test("pushTrail keeps the newest points", () => {
  let tr: Pt[] = [];
  for (let i = 0; i < 12; i++) tr = pushTrail(tr, { x: i, y: i }, 8);
  assert.equal(tr.length, 8);
  assert.equal(tr[0].x, 4);
  assert.equal(tr[7].x, 11);
});
