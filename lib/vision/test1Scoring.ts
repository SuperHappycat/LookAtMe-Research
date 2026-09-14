/**
 * lib/vision/test1Scoring.ts
 * ===========================
 * Port of gui/test1.py's region mapping + result computation
 * (Human vs Geometric preference test) and the shared
 * compute_switches_and_fixation() helper from gui/video_test_base.py.
 */

import type { GazeDirection } from "./types";

export type Test1Region = "Human" | "Geometric" | "Other";

export function mapDirectionToRegion(direction: GazeDirection, humanSide: "left" | "right"): Test1Region {
  if (direction === "Center" || direction === "Unknown") return "Other";
  const lookingLeft = direction === "Left";
  if (humanSide === "left") return lookingLeft ? "Human" : "Geometric";
  return lookingLeft ? "Geometric" : "Human";
}

export interface Test1Results {
  humanPct: number;
  geometricPct: number;
  switches: number;
  avgFixationMs: number;
}

export function computeSwitchesAndFixation(
  log: string[],
  validLabels: readonly string[],
  sampleDurationMs: number,
): { switches: number; avgFixationMs: number } {
  const filtered = log.filter((r) => validLabels.includes(r));
  if (filtered.length === 0) return { switches: 0, avgFixationMs: 0 };

  const runs: string[] = [];
  for (const r of filtered) {
    if (runs.length === 0 || runs[runs.length - 1] !== r) runs.push(r);
  }
  const switches = Math.max(0, runs.length - 1);

  const runLengths: number[] = [];
  let currentLen = 0;
  let prev: string | null = null;
  for (const r of filtered) {
    if (r === prev) {
      currentLen += 1;
    } else {
      if (prev !== null) runLengths.push(currentLen);
      currentLen = 1;
      prev = r;
    }
  }
  if (currentLen) runLengths.push(currentLen);

  const avgFixationMs = runLengths.length
    ? (runLengths.reduce((s, n) => s + n, 0) / runLengths.length) * sampleDurationMs
    : 0;

  return { switches, avgFixationMs };
}

export function finalizeTest1Results(regionLog: Test1Region[], sampleDurationMs: number): Test1Results {
  const total = regionLog.filter((r) => r === "Human" || r === "Geometric");
  const n = total.length || 1;
  const humanPct = (100 * total.filter((r) => r === "Human").length) / n;
  const geometricPct = (100 * total.filter((r) => r === "Geometric").length) / n;
  const { switches, avgFixationMs } = computeSwitchesAndFixation(regionLog, ["Human", "Geometric"], sampleDurationMs);
  return { humanPct, geometricPct, switches, avgFixationMs };
}
