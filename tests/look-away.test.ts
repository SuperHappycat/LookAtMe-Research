/** Pause-when-looking-away state machine (lib/research/lookAway.ts). Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isAway, LOOK_AWAY_DEFAULTS, LookAwayTracker } from "../lib/research/lookAway.ts";

/** Feeds samples every 100 ms; `pattern(t)` = away?; returns the events with their times. */
function run(pattern: (t: number) => boolean, ms: number, cfg = LOOK_AWAY_DEFAULTS) {
  const tr = new LookAwayTracker(cfg);
  const ev: [string, number][] = [];
  for (let t = 0; t <= ms; t += 100) {
    const e = tr.update(pattern(t), t);
    if (e) ev.push([e, t]);
  }
  return { tr, ev };
}

test("looks, looks away for 3 s, looks back → one pause, resumes after looking back", () => {
  const { tr, ev } = run((t) => t >= 2000 && t < 5000, 7000);
  assert.deepEqual(ev, [["pause", 3500], ["resume", 5400]]);
  assert.equal(tr.pauses, 1);
  assert.equal(tr.totalPausedMs, 1900);
});

test("short glances away (< 1.5 s) never pause", () => {
  const { ev } = run((t) => Math.floor(t / 1000) % 2 === 1, 10000);
  assert.deepEqual(ev, []);
});

test("no face from the start (never looked) → never pauses", () => {
  const { ev } = run(() => true, 20000);
  assert.deepEqual(ev, []);
});

test("child never comes back → resumes after maxPauseMs and doesn't pause again until they look", () => {
  const { tr, ev } = run((t) => t >= 2000, 30000);
  assert.deepEqual(ev, [["pause", 3500], ["resume", 11500]]);
  assert.equal(tr.pauses, 1);
});

test("total pause time is capped per test", () => {
  // away 3 s, look 2 s, repeated: each pause lasts until the child looks back.
  const cfg = { ...LOOK_AWAY_DEFAULTS, maxTotalPauseMs: 3000 };
  const { tr } = run((t) => t % 5000 < 3000 && t > 1500, 60000, cfg);
  assert.ok(tr.totalPausedMs <= 3000 + 100, `paused ${tr.totalPausedMs} ms`);
});

test("isAway: no face, off-screen point, unknown direction", () => {
  const vp = { w: 1000, h: 800 };
  assert.equal(isAway({ faceFound: false, point: null, direction: "Left" }, vp, 0.1), true);
  assert.equal(isAway({ faceFound: true, point: { x: 500, y: 400 }, direction: "Center" }, vp, 0.1), false);
  assert.equal(isAway({ faceFound: true, point: { x: 1200, y: 400 }, direction: "Right" }, vp, 0.1), true);
  assert.equal(isAway({ faceFound: true, point: { x: 1050, y: 400 }, direction: "Right" }, vp, 0.1), false);
  assert.equal(isAway({ faceFound: true, point: null, direction: "Unknown" }, vp, 0.1), true);
});
