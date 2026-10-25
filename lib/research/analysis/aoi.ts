/**
 * lib/research/analysis/aoi.ts
 * ==============================
 * Areas-of-interest (AOI) metrics computed from a session's gaze rows (pure functions).
 *
 * Coordinates
 *   Gaze rows store x_norm / y_norm relative to the UNION box of the level's stimulus video(s).
 *   AOI boxes (lib/research/contracts.ts AoiBox) are stored in fractions of ONE video frame
 *   (the set's video_id).
 *   - Levels 2 and 3 show one video, so video frame ≈ union box: boxes are used as they are.
 *   - Level 1 shows human.mp4 and geometric.mp4 side by side; the order comes from
 *     results.test1.humanSide. APPROXIMATION: each video is taken to be exactly half of the
 *     union box (left half / right half). This ignores the gap between the two videos, any
 *     letterboxing inside each <video>, unequal widths (max-width), and narrow screens where the
 *     two videos wrapped onto two rows. Expect an error of a few % of the width near the middle.
 *     Sessions without humanSide are skipped for level 1.
 *
 * Definitions (one AOI, one session)
 *   valid sample  face_found and both x_norm and y_norm present, inside the AOI's time window
 *                 (window = video position tStartS ≤ video_pos_s < tEndS; videos loop, so the
 *                 window repeats on every loop).
 *   pctInside     valid samples inside the box / valid samples × 100.
 *   dwellMs       Σ sample duration for valid inside samples. A sample lasts until the next
 *                 row, capped at aoiMaxGapMs (the last row gets the median interval).
 *   ttflMs        time to first look: t_ms of the first valid inside sample minus the reference
 *                 time = level start (t_ms 0) without a window, or the first sample inside the
 *                 window when a window is set. Null if never looked.
 *   visits        runs of valid inside samples. A run ends on a valid sample outside the box,
 *                 on leaving the window, or when the time between two valid samples exceeds
 *                 aoiMaxGapMs. Invalid samples (face lost) in a short gap do not end a visit.
 *   meanVisitMs   dwellMs / visits.
 *   AOIs may overlap; each is computed on its own.
 */

import type { AoiBox } from "../contracts";
import type { GazeRow } from "../gazeLog";
import { ANALYSIS_CONFIG } from "./config";
import { mean, median } from "./stats";

export type Level = 1 | 2 | 3;

/** Stimulus videos per level (ids as written in the gaze CSV; files in /public/videos). */
export const LEVEL_VIDEO_IDS: Record<Level, readonly string[]> = {
  1: ["human", "geometric"],
  2: ["talking"],
  3: ["rja"],
};

export const VIDEO_LABELS: Record<string, string> = {
  human: "T1 · คน / Human",
  geometric: "T1 · รูปทรง / Geometric",
  talking: "T2 · หน้าและของ / Face vs object",
  rja: "T3 · ร่วมความสนใจ / Joint attention",
};

export interface AoiSet {
  id: string;
  org_id: string;
  level: Level;
  video_id: string;
  name: string;
  boxes: AoiBox[];
  created_at?: string;
}

/** Converts a box in one video's frame to union-box fractions (see the level 1 approximation above). */
export function boxToUnion(box: AoiBox, level: Level, videoId: string, humanSide: "left" | "right" | null): AoiBox | null {
  if (level !== 1) return box;
  if (humanSide !== "left" && humanSide !== "right") return null;
  const onLeft = (videoId === "human") === (humanSide === "left");
  return { ...box, x: (onLeft ? 0 : 0.5) + box.x * 0.5, w: box.w * 0.5 };
}

export function inBox(x: number, y: number, b: Pick<AoiBox, "x" | "y" | "w" | "h">): boolean {
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}

function inWindow(r: GazeRow, b: AoiBox): boolean {
  if (b.tStartS !== undefined && b.tStartS !== null && r.video_pos_s < b.tStartS) return false;
  if (b.tEndS !== undefined && b.tEndS !== null && r.video_pos_s >= b.tEndS) return false;
  return true;
}

const hasWindow = (b: AoiBox) =>
  (b.tStartS !== undefined && b.tStartS !== null) || (b.tEndS !== undefined && b.tEndS !== null);

export interface AoiMetrics {
  label: string;
  validSamples: number;
  insideSamples: number;
  pctInside: number | null;
  dwellMs: number;
  ttflMs: number | null;
  visits: number;
  meanVisitMs: number | null;
}

/** Per-sample duration (ms): time to the next row, capped; the last row gets the median interval. */
export function sampleDurations(rows: readonly GazeRow[], maxGapMs: number = ANALYSIS_CONFIG.aoiMaxGapMs): number[] {
  const gaps: number[] = [];
  for (let i = 0; i + 1 < rows.length; i++) gaps.push(Math.max(0, rows[i + 1].t_ms - rows[i].t_ms));
  const last = Math.min(median(gaps) ?? 0, maxGapMs);
  return rows.map((_, i) => (i + 1 < rows.length ? Math.min(gaps[i], maxGapMs) : last));
}

/**
 * Metrics for one AOI over one level's rows. `box` must already be in union-box fractions
 * (use boxToUnion). Rows of other levels are ignored.
 */
export function aoiMetrics(
  allRows: readonly GazeRow[],
  level: Level,
  box: AoiBox,
  maxGapMs: number = ANALYSIS_CONFIG.aoiMaxGapMs,
): AoiMetrics {
  const rows = allRows.filter((r) => r.level === level).sort((a, b) => a.t_ms - b.t_ms);
  const dur = sampleDurations(rows, maxGapMs);
  const windowed = hasWindow(box);
  let valid = 0;
  let inside = 0;
  let dwell = 0;
  let visits = 0;
  let ttfl: number | null = null;
  let refT: number | null = windowed ? null : 0;
  let inVisit = false;
  let lastValidT: number | null = null;

  rows.forEach((r, i) => {
    const win = inWindow(r, box);
    if (!win) {
      inVisit = false;
      return;
    }
    if (refT === null) refT = r.t_ms;
    const isValid = r.face_found && r.x_norm !== null && r.y_norm !== null;
    if (!isValid) return;
    if (lastValidT !== null && r.t_ms - lastValidT > maxGapMs) inVisit = false;
    lastValidT = r.t_ms;
    valid++;
    if (inBox(r.x_norm as number, r.y_norm as number, box)) {
      inside++;
      dwell += dur[i];
      if (!inVisit) {
        visits++;
        inVisit = true;
      }
      if (ttfl === null) ttfl = Math.max(0, r.t_ms - (refT ?? 0));
    } else {
      inVisit = false;
    }
  });

  return {
    label: box.label,
    validSamples: valid,
    insideSamples: inside,
    pctInside: valid ? (inside / valid) * 100 : null,
    dwellMs: dwell,
    ttflMs: ttfl,
    visits,
    meanVisitMs: visits ? dwell / visits : null,
  };
}

export interface SessionAoiRow extends AoiMetrics {
  sessionId: string;
  childCode: string;
  setName: string;
  videoId: string;
  level: Level;
  /** Why the session was skipped for this AOI, if it was. */
  skipped?: "no_gaze" | "no_human_side";
}

/** All AOIs of one set for one session. */
export function sessionAoiMetrics(
  set: Pick<AoiSet, "level" | "video_id" | "name" | "boxes">,
  session: { id: string; childCode: string; humanSide: "left" | "right" | null },
  rows: readonly GazeRow[],
): SessionAoiRow[] {
  const levelRows = rows.filter((r) => r.level === set.level);
  return set.boxes.map((b) => {
    const base = { sessionId: session.id, childCode: session.childCode, setName: set.name, videoId: set.video_id, level: set.level };
    const empty: AoiMetrics = { label: b.label, validSamples: 0, insideSamples: 0, pctInside: null, dwellMs: 0, ttflMs: null, visits: 0, meanVisitMs: null };
    const ub = boxToUnion(b, set.level, set.video_id, session.humanSide);
    if (!ub) return { ...base, ...empty, skipped: "no_human_side" as const };
    if (!levelRows.some((r) => r.x_norm !== null)) return { ...base, ...empty, skipped: "no_gaze" as const };
    return { ...base, ...aoiMetrics(levelRows, set.level, ub) };
  });
}

export interface AoiSummary {
  label: string;
  sessions: number; // sessions with at least one valid sample
  meanPctInside: number | null;
  meanDwellMs: number | null;
  medianTtflMs: number | null;
  lookedPct: number | null; // % of sessions that looked at all
  meanVisits: number | null;
  meanVisitMs: number | null;
}

/** Summary across sessions, per AOI label (sessions without valid samples are left out). */
export function summarizeAoi(rows: readonly SessionAoiRow[]): AoiSummary[] {
  const labels = [...new Set(rows.map((r) => r.label))];
  return labels.map((label) => {
    const used = rows.filter((r) => r.label === label && !r.skipped && r.validSamples > 0);
    return {
      label,
      sessions: used.length,
      meanPctInside: mean(used.map((r) => r.pctInside)),
      meanDwellMs: mean(used.map((r) => r.dwellMs)),
      medianTtflMs: median(used.map((r) => r.ttflMs)),
      lookedPct: used.length ? (used.filter((r) => r.ttflMs !== null).length / used.length) * 100 : null,
      meanVisits: mean(used.map((r) => r.visits)),
      meanVisitMs: mean(used.map((r) => r.meanVisitMs)),
    };
  });
}

/** Checks a box list before saving. Returns error codes (empty when fine). */
export function validateBoxes(boxes: readonly AoiBox[]): string[] {
  const errs: string[] = [];
  const seen = new Set<string>();
  boxes.forEach((b, i) => {
    const n = `#${i + 1}`;
    if (!b.label.trim()) errs.push(`${n}: label`);
    if (seen.has(b.label.trim())) errs.push(`${n}: duplicate label`);
    seen.add(b.label.trim());
    if (!(b.w > 0 && b.h > 0 && b.x >= 0 && b.y >= 0 && b.x + b.w <= 1.0001 && b.y + b.h <= 1.0001)) errs.push(`${n}: box`);
    if (b.tStartS !== undefined && b.tEndS !== undefined && b.tEndS <= b.tStartS) errs.push(`${n}: time window`);
  });
  return errs;
}

/** Normalises a rectangle drawn from (x1,y1) to (x2,y2) into a clamped box. */
export function rectFromPoints(x1: number, y1: number, x2: number, y2: number): Pick<AoiBox, "x" | "y" | "w" | "h"> {
  const c = (v: number) => Math.min(1, Math.max(0, v));
  const [a, b] = [c(Math.min(x1, x2)), c(Math.max(x1, x2))];
  const [d, e] = [c(Math.min(y1, y2)), c(Math.max(y1, y2))];
  return { x: a, y: d, w: b - a, h: e - d };
}
