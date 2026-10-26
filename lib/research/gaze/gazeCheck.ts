/**
 * lib/research/gaze/gazeCheck.ts
 * ================================
 * Pure logic for the live "gaze check" page (/r/gaze-check): where the 3×3 targets are, which
 * target the gaze point is dwelling in and for how long, and the mean distance between the gaze
 * point and the target while it is being looked at. No DOM, no React — unit tested in
 * tests/gaze-check.test.ts. Numbers come from RESEARCH_CONFIG.gazeCheck.
 */

export interface Pt {
  x: number;
  y: number;
}

export interface DwellOptions {
  /** A point within this many px of a target's centre is "in" it. */
  radiusPx: number;
  /** Continuous time in a target before it lights up. */
  dwellMs: number;
  /** Missing points (blinks) or brief exits shorter than this do not break a dwell. */
  maxGapMs: number;
}

export interface DwellState {
  /** Target currently dwelt in, or -1. */
  index: number;
  startMs: number;
  /** Last time a point was inside `index`. */
  lastInMs: number;
  /** Already lit during this dwell (fires once per dwell). */
  fired: boolean;
  /** Sum and count of point-to-target distances during this dwell (including brief exits). */
  sumDist: number;
  n: number;
}

export const INITIAL_DWELL: DwellState = { index: -1, startMs: 0, lastInMs: 0, fired: false, sumDist: 0, n: 0 };

export interface DwellStep {
  state: DwellState;
  /** Index of the target that lit up on this step, or -1. */
  lit: number;
  /** 0..1 progress towards lighting the current target (1 once lit, 0 when none). */
  progress: number;
}

/** 3×3 (or n×m) target centres in viewport px from fractions of the width/height. */
export function gridTargets(w: number, h: number, fractions: ReadonlyArray<number>): Pt[] {
  const out: Pt[] = [];
  for (const fy of fractions) for (const fx of fractions) out.push({ x: fx * w, y: fy * h });
  return out;
}

/**
 * Target radius: a fraction of the smallest gap between neighbouring grid columns/rows, so the
 * circles never overlap whatever the window shape. The drawn circle uses the same radius.
 */
export function gridRadius(w: number, h: number, fractions: ReadonlyArray<number>, fractionOfGap: number): number {
  let gap = Infinity;
  for (let i = 1; i < fractions.length; i++) gap = Math.min(gap, Math.abs(fractions[i] - fractions[i - 1]));
  if (!Number.isFinite(gap)) gap = 1;
  return fractionOfGap * gap * Math.min(w, h);
}

export function distance(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Nearest target whose centre is within `radiusPx` of the point, or -1. */
export function hitTarget(p: Pt, targets: ReadonlyArray<Pt>, radiusPx: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < targets.length; i++) {
    const d = distance(p, targets[i]);
    if (d <= radiusPx && d < bestD) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

function progressOf(s: DwellState, tMs: number, dwellMs: number): number {
  if (s.index < 0) return 0;
  if (s.fired) return 1;
  return Math.max(0, Math.min(1, (tMs - s.startMs) / dwellMs));
}

/**
 * Advances the dwell tracker by one gaze sample (`point` null = no point: blink or face lost).
 * Rules: entering a target starts a dwell; staying in it for `dwellMs` lights it once; a missing
 * point or leaving to empty space for up to `maxGapMs` keeps the dwell (blinks, jitter); moving
 * into another target starts a new dwell straight away.
 */
export function stepDwell(
  s: DwellState,
  point: Pt | null,
  tMs: number,
  targets: ReadonlyArray<Pt>,
  o: DwellOptions,
): DwellStep {
  const hit = point ? hitTarget(point, targets, o.radiusPx) : -1;
  let next: DwellState;

  if (hit >= 0 && hit === s.index) {
    next = { ...s, lastInMs: tMs };
  } else if (hit >= 0) {
    next = { index: hit, startMs: tMs, lastInMs: tMs, fired: false, sumDist: 0, n: 0 };
  } else if (s.index >= 0 && tMs - s.lastInMs <= o.maxGapMs) {
    next = s; // brief blink / exit: keep the dwell but do not count the time as "in"
  } else {
    next = INITIAL_DWELL;
  }

  if (point && next.index >= 0) {
    next = { ...next, sumDist: next.sumDist + distance(point, targets[next.index]), n: next.n + 1 };
  }

  let lit = -1;
  if (hit >= 0 && hit === next.index && !next.fired && tMs - next.startMs >= o.dwellMs) {
    next = { ...next, fired: true };
    lit = hit;
  }
  return { state: next, lit, progress: progressOf(next, tMs, o.dwellMs) };
}

/** Mean point-to-target distance (px) over the current dwell, or null with no samples. */
export function dwellMeanDistance(s: DwellState): number | null {
  return s.index >= 0 && s.n > 0 ? s.sumDist / s.n : null;
}

/** Random target index different from `current` (when there is more than one). */
export function pickNextTarget(current: number, count: number, rand: () => number = Math.random): number {
  if (count <= 1) return 0;
  if (current < 0 || current >= count) return Math.min(count - 1, Math.floor(rand() * count));
  const k = Math.min(count - 2, Math.floor(rand() * (count - 1)));
  return k >= current ? k + 1 : k;
}

/** Keeps the last `max` points (oldest first) for the fading trail. */
export function pushTrail(trail: ReadonlyArray<Pt>, p: Pt, max: number): Pt[] {
  const next = [...trail, p];
  return next.length > max ? next.slice(next.length - max) : next;
}
