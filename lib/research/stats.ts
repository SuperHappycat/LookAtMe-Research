/**
 * lib/research/stats.ts
 * =======================
 * Diagnosis follow-up statistics (spec §5.2): the gaze screening result of each child's FIRST completed
 * (non-invalid) session against the final diagnosis, as a 2×2 table with sensitivity, specificity, PPV and NPV
 * and 95% Wilson intervals. Pure functions, unit-tested in tests/stats.test.ts.
 */

import { FOLLOWUP_CONFIG, type DiagnosisResult } from "./followup/config";

export type PositiveDef = "high" | "moderate_high";

export const POSITIVE_LABELS: Record<PositiveDef, string> = {
  high: "เสี่ยงสูงเท่านั้น / High only",
  moderate_high: "เสี่ยงปานกลางหรือสูง / Moderate or High",
};

export interface StatsChild {
  id: string;
  code: string;
}
export interface StatsSession {
  id: string;
  child_id: string;
  started_at: string;
  status: string;
  risk_level: string | null;
  overall_score: number | null;
}
export interface StatsDiagnosis {
  child_id: string;
  result: DiagnosisResult;
  diagnosed_on: string | null;
  created_at: string;
}

export interface Interval {
  /** Point estimate x / n. */
  est: number;
  lo: number;
  hi: number;
}

/** 95% (by default) Wilson score interval for x successes out of n. Null when n = 0. */
export function wilson(x: number, n: number, z: number = FOLLOWUP_CONFIG.z95): Interval | null {
  if (!Number.isFinite(n) || n <= 0 || x < 0 || x > n) return null;
  const p = x / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { est: p, lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

export function isPositive(risk: string | null, def: PositiveDef): boolean | null {
  if (risk === "High") return true;
  if (risk === "Moderate") return def === "moderate_high";
  if (risk === "Low") return false;
  return null;
}

/** The child's first completed session (status 'completed' excludes 'invalid' and unfinished ones). */
export function firstCompletedSession<T extends StatsSession>(sessions: T[]): T | null {
  let best: T | null = null;
  for (const s of sessions) {
    if (s.status !== "completed") continue;
    if (!best || s.started_at < best.started_at) best = s;
  }
  return best;
}

/**
 * The diagnosis that counts: the most recent record (by diagnosis date, then by when it was entered).
 * Diagnoses can't be edited, so a correction or a later final diagnosis is a new row.
 */
export function currentDiagnosis<T extends StatsDiagnosis>(list: T[]): T | null {
  let best: T | null = null;
  for (const d of list) {
    if (!best) {
      best = d;
      continue;
    }
    const a = d.diagnosed_on ?? "";
    const b = best.diagnosed_on ?? "";
    if (a > b || (a === b && d.created_at > best.created_at)) best = d;
  }
  return best;
}

export type Exclusion = "no_diagnosis" | "other_or_pending" | "no_completed_session" | "no_risk_result";

export interface CodedRow {
  child_code: string;
  session_id: string | null;
  session_date: string | null;
  risk_level: string | null;
  overall_score: number | null;
  test_positive: boolean | null;
  diagnosis: DiagnosisResult | null;
  diagnosed_on: string | null;
  included: boolean;
  exclusion: Exclusion | null;
  cell: "TP" | "FP" | "FN" | "TN" | null;
}

export interface TwoByTwo {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

export interface FollowupResult {
  rows: CodedRow[];
  table: TwoByTwo;
  excluded: Record<Exclusion, number>;
}

export function buildFollowup(
  children: StatsChild[],
  sessions: StatsSession[],
  diagnoses: StatsDiagnosis[],
  def: PositiveDef,
): FollowupResult {
  const sessByChild = groupBy(sessions, (s) => s.child_id);
  const diagByChild = groupBy(diagnoses, (d) => d.child_id);
  const table: TwoByTwo = { tp: 0, fp: 0, fn: 0, tn: 0 };
  const excluded: Record<Exclusion, number> = {
    no_diagnosis: 0,
    other_or_pending: 0,
    no_completed_session: 0,
    no_risk_result: 0,
  };
  const rows: CodedRow[] = [];

  for (const c of [...children].sort((a, b) => a.code.localeCompare(b.code))) {
    const d = currentDiagnosis(diagByChild.get(c.id) ?? []);
    const s = firstCompletedSession(sessByChild.get(c.id) ?? []);
    const positive = s ? isPositive(s.risk_level, def) : null;
    let exclusion: Exclusion | null = null;
    if (!d) exclusion = "no_diagnosis";
    else if (d.result !== "asd" && d.result !== "not_asd") exclusion = "other_or_pending";
    else if (!s) exclusion = "no_completed_session";
    else if (positive === null) exclusion = "no_risk_result";

    let cell: CodedRow["cell"] = null;
    if (exclusion) excluded[exclusion]++;
    else {
      const asd = d!.result === "asd";
      cell = positive ? (asd ? "TP" : "FP") : asd ? "FN" : "TN";
      table[cell.toLowerCase() as keyof TwoByTwo]++;
    }
    rows.push({
      child_code: c.code,
      session_id: s?.id ?? null,
      session_date: s?.started_at ?? null,
      risk_level: s?.risk_level ?? null,
      overall_score: s?.overall_score ?? null,
      test_positive: positive,
      diagnosis: d?.result ?? null,
      diagnosed_on: d?.diagnosed_on ?? null,
      included: !exclusion,
      exclusion,
      cell,
    });
  }
  return { rows, table, excluded };
}

export interface Metric {
  x: number;
  n: number;
  /** Null when n < minN ("not enough data") or n = 0. */
  ci: Interval | null;
  enough: boolean;
}

export interface Metrics {
  sensitivity: Metric;
  specificity: Metric;
  ppv: Metric;
  npv: Metric;
}

export function metrics(t: TwoByTwo, minN: number = FOLLOWUP_CONFIG.minNForStats): Metrics {
  const m = (x: number, n: number): Metric => {
    const enough = n >= Math.max(1, minN);
    return { x, n, enough, ci: enough ? wilson(x, n) : null };
  };
  return {
    sensitivity: m(t.tp, t.tp + t.fn),
    specificity: m(t.tn, t.tn + t.fp),
    ppv: m(t.tp, t.tp + t.fp),
    npv: m(t.tn, t.tn + t.fn),
  };
}

// ---------------------------------------------------------------- CSV

const BOM = "﻿";

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const line = (vals: unknown[]) => vals.map(cell).join(",");
const r4 = (v: number | undefined) => (v === undefined ? "" : Math.round(v * 10000) / 10000);

export function twoByTwoCsv(res: FollowupResult, def: PositiveDef, minN: number = FOLLOWUP_CONFIG.minNForStats): string {
  const { tp, fp, fn, tn } = res.table;
  const m = metrics(res.table, minN);
  const out = [
    line(["positive_definition", def]),
    line(["min_n_for_stats", minN]),
    "",
    line(["", "diagnosis_asd", "diagnosis_not_asd", "total"]),
    line(["screen_positive", tp, fp, tp + fp]),
    line(["screen_negative", fn, tn, fn + tn]),
    line(["total", tp + fn, fp + tn, tp + fp + fn + tn]),
    "",
    line(["measure", "x", "n", "estimate", "ci95_low", "ci95_high", "enough_data"]),
    ...(["sensitivity", "specificity", "ppv", "npv"] as const).map((k) =>
      line([k, m[k].x, m[k].n, r4(m[k].ci?.est), r4(m[k].ci?.lo), r4(m[k].ci?.hi), m[k].enough]),
    ),
    "",
    line(["excluded_reason", "children"]),
    ...Object.entries(res.excluded).map(([k, v]) => line([k, v])),
  ];
  return BOM + out.join("\n") + "\n";
}

export const CODED_COLUMNS = [
  "child_code",
  "session_id",
  "session_date",
  "risk_level",
  "overall_score",
  "test_positive",
  "diagnosis",
  "diagnosed_on",
  "included",
  "exclusion",
  "cell",
] as const;

export function codedRowsCsv(rows: CodedRow[]): string {
  const out = [line([...CODED_COLUMNS]), ...rows.map((r) => line(CODED_COLUMNS.map((k) => r[k])))];
  return BOM + out.join("\n") + "\n";
}

function groupBy<T>(list: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of list) {
    const k = key(x);
    const arr = m.get(k);
    if (arr) arr.push(x);
    else m.set(k, [x]);
  }
  return m;
}
