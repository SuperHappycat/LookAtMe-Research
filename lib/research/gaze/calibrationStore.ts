/**
 * lib/research/gaze/calibrationStore.ts
 * =======================================
 * Keeps the fitted gaze mapping for the current browser tab. Stored in
 * module scope (survives client-side navigation between test pages) and
 * mirrored to sessionStorage (survives a reload, cleared when the tab
 * closes). Discarded if the window size changes, because the mapping is in
 * viewport pixels.
 */

import { RESEARCH_CONFIG } from "../config";
import type { GazeModel } from "./regression";

const KEY = "lookatme_research_calibration";

export interface CalibrationRecord {
  model: GazeModel;
  viewport: { w: number; h: number };
  meanErrorPx: number;
  /** Approximate visual degrees (assumed viewing distance; see config). */
  meanErrorDeg?: number;
  grade?: "high" | "medium" | "low" | "fail";
  mode?: "child" | "adult";
  pointsUsed?: number;
  ok: boolean;
  lowAccuracy: boolean;
  attempts: number;
  createdAt: string;
}

let current: CalibrationRecord | null = null;
let loaded = false;

function load(): void {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw) current = JSON.parse(raw) as CalibrationRecord;
  } catch {
    current = null;
  }
}

export function saveCalibration(rec: CalibrationRecord): void {
  current = rec;
  loaded = true;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(rec));
  } catch {
    // sessionStorage unavailable: keep it in memory only.
  }
}

export function clearCalibration(): void {
  current = null;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export type CalibrationState =
  | { state: "none" }
  | { state: "viewport_changed" }
  | { state: "ready"; record: CalibrationRecord };

export function getCalibrationState(): CalibrationState {
  load();
  if (!current) return { state: "none" };
  if (typeof window !== "undefined") {
    const dw = Math.abs(window.innerWidth - current.viewport.w) / current.viewport.w;
    const dh = Math.abs(window.innerHeight - current.viewport.h) / current.viewport.h;
    if (dw > RESEARCH_CONFIG.maxViewportChange || dh > RESEARCH_CONFIG.maxViewportChange) {
      return { state: "viewport_changed" };
    }
  }
  return { state: "ready", record: current };
}

/** Usable for live gaze: calibrated, window unchanged, and either passed or accepted as low accuracy. */
export function getActiveModel(): GazeModel | null {
  const s = getCalibrationState();
  if (s.state !== "ready") return null;
  return s.record.ok || s.record.lowAccuracy ? s.record.model : null;
}
