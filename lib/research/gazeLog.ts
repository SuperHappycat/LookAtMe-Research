/**
 * lib/research/gazeLog.ts
 * =========================
 * Collects every gaze sample of a Research screening, per level, so it can be
 * saved as the session's gaze CSV (spec §5.5) and used for the quality score
 * and replay. Kept in memory and mirrored to sessionStorage after each level,
 * so a page reload between tests doesn't lose earlier levels.
 */

import type { GazeDirection } from "./gaze/types";

export interface GazeRow {
  level: 1 | 2 | 3;
  video_id: string;
  t_ms: number;
  video_pos_s: number;
  x_px: number | null;
  y_px: number | null;
  x_norm: number | null;
  y_norm: number | null;
  direction: GazeDirection;
  face_found: boolean;
  eyes_detected: boolean;
  confidence: number;
  face_scale: number | null;
}

export interface LevelMeta {
  level: 1 | 2 | 3;
  videoIds: string[];
  startedAt: number;
  viewport: { w: number; h: number };
  /** Union of the stimulus video boxes (viewport px) when the level ran; x_norm/y_norm are relative to it. */
  stimulusBox: { left: number; top: number; width: number; height: number } | null;
  /** Pause-when-looking-away (lib/research/lookAway.ts): how often and how long the stimulus was paused. */
  pauses?: { count: number; totalMs: number };
}

interface LogState {
  rows: GazeRow[];
  luma: { level: number; value: number }[];
  levels: LevelMeta[];
}

const KEY = "lookatme_research_gazelog";
let state: LogState = { rows: [], luma: [], levels: [] };
let loaded = false;

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw) state = JSON.parse(raw) as LogState;
  } catch {
    // keep empty
  }
}

export function persistGazeLog() {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // storage full or unavailable: the in-memory copy still works for this page visit
  }
}

export function clearGazeLog() {
  state = { rows: [], luma: [], levels: [] };
  loaded = true;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** Starts (or restarts, on "Run again") a level: drops that level's earlier samples. */
export function startLevel(meta: LevelMeta) {
  load();
  state.rows = state.rows.filter((r) => r.level !== meta.level);
  state.luma = state.luma.filter((l) => l.level !== meta.level);
  state.levels = [...state.levels.filter((l) => l.level !== meta.level), meta];
}

export function setLevelStimulusBox(level: number, box: LevelMeta["stimulusBox"]) {
  const meta = state.levels.find((l) => l.level === level);
  if (meta && box && box.width > 0 && box.height > 0) meta.stimulusBox = box;
}

export function setLevelPauses(level: number, pauses: { count: number; totalMs: number }) {
  const meta = state.levels.find((l) => l.level === level);
  if (meta) meta.pauses = pauses;
}

export function getLevelMeta(level: number): LevelMeta | undefined {
  load();
  return state.levels.find((l) => l.level === level);
}

export function addRow(row: GazeRow) {
  state.rows.push(row);
}

export function addLuma(level: number, value: number) {
  state.luma.push({ level, value });
}

export function getGazeLog(): LogState {
  load();
  return state;
}

const CSV_COLUMNS = [
  "session_id",
  "level",
  "video_id",
  "t_ms",
  "video_pos_s",
  "x_px",
  "y_px",
  "x_norm",
  "y_norm",
  "direction",
  "face_found",
  "eyes_detected",
  "confidence",
  "face_scale",
] as const;

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : "";
  if (typeof v === "boolean") return v ? "1" : "0";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Gaze CSV exactly as stored in Supabase Storage (spec §5.5). */
export function gazeRowsToCsv(sessionId: string, rows: GazeRow[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of rows) {
    const rec: Record<string, unknown> = { ...r, session_id: sessionId };
    lines.push(CSV_COLUMNS.map((c) => cell(rec[c])).join(","));
  }
  return lines.join("\n") + "\n";
}

/** Parses the stored gaze CSV back into rows (for replay and export). */
export function parseGazeCsv(text: string): (GazeRow & { session_id: string })[] {
  const lines = text.trim().split(/\r?\n/);
  const header = lines.shift()?.split(",") ?? [];
  const idx = (name: string) => header.indexOf(name);
  const num = (v: string) => (v === "" ? null : Number(v));
  return lines.map((line) => {
    const c = line.split(",");
    return {
      session_id: c[idx("session_id")],
      level: Number(c[idx("level")]) as 1 | 2 | 3,
      video_id: c[idx("video_id")],
      t_ms: Number(c[idx("t_ms")]),
      video_pos_s: Number(c[idx("video_pos_s")]),
      x_px: num(c[idx("x_px")]),
      y_px: num(c[idx("y_px")]),
      x_norm: num(c[idx("x_norm")]),
      y_norm: num(c[idx("y_norm")]),
      direction: c[idx("direction")] as GazeDirection,
      face_found: c[idx("face_found")] === "1",
      eyes_detected: c[idx("eyes_detected")] === "1",
      confidence: Number(c[idx("confidence")]),
      face_scale: num(c[idx("face_scale")]),
    };
  });
}

export { CSV_COLUMNS, cell as csvCell };
