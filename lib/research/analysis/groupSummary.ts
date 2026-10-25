/**
 * lib/research/analysis/groupSummary.ts
 * =======================================
 * Group summary (spec §5, Hospital): compare groups (age band, sex, date period)
 * on n, mean ± SD and median of scores, risk %, retest % and data quality.
 *
 * Scores and risk use completed sessions; retest % = invalid / (completed + invalid);
 * quality uses completed + invalid sessions. "started" sessions are ignored.
 */

import { AGE_BANDS, ANALYSIS_CONFIG } from "./config";
import { RISKS, SCORE_FIELDS, bandOf, sessionAge, type AnalysisSession, type Risk, type ScoreKey } from "./sessions";
import { describe, type Describe } from "./stats";

export type GroupBy = "age_band" | "sex" | "month" | "quarter" | "year";

export const GROUP_BY_LABELS: Record<GroupBy, string> = {
  age_band: "ช่วงอายุ / Age band",
  sex: "เพศ / Sex",
  month: "เดือน / Month",
  quarter: "ไตรมาส / Quarter",
  year: "ปี / Year",
};

export const SEX_LABELS: Record<string, string> = { M: "ชาย / Male", F: "หญิง / Female", U: "ไม่ระบุ / Unknown" };

/** Group key for a session, or null when it can't be placed (e.g. no birth month for age band). */
export function groupKey(s: AnalysisSession, by: GroupBy): string | null {
  const d = new Date(s.started_at);
  switch (by) {
    case "age_band":
      return bandOf(sessionAge(s))?.key ?? null;
    case "sex":
      return s.child?.sex ?? "U";
    case "month":
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    case "quarter":
      return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
    case "year":
      return String(d.getFullYear());
  }
}

export interface GroupRow {
  key: string;
  label: string;
  n: number; // completed sessions
  nAll: number; // completed + invalid
  enough: boolean;
  scores: Record<ScoreKey, Describe>;
  riskPct: Record<Risk, number | null>;
  retestPct: number | null;
  quality: Describe;
  faceFound: Describe;
}

export function groupLabel(by: GroupBy, key: string): string {
  if (by === "sex") return SEX_LABELS[key] ?? key;
  if (by === "age_band") return `${key} เดือน / months`;
  return key;
}

function orderKeys(by: GroupBy, keys: string[]): string[] {
  if (by === "age_band") return AGE_BANDS.map((b) => b.key).filter((k) => keys.includes(k));
  if (by === "sex") return ["M", "F", "U"].filter((k) => keys.includes(k));
  return [...keys].sort();
}

export function groupSummary(
  sessions: readonly AnalysisSession[],
  by: GroupBy,
  minN: number = ANALYSIS_CONFIG.minNGroup,
): { rows: GroupRow[]; unplaced: number } {
  const used = sessions.filter((s) => s.status === "completed" || s.status === "invalid");
  const groups = new Map<string, AnalysisSession[]>();
  let unplaced = 0;
  for (const s of used) {
    const k = groupKey(s, by);
    if (k === null) {
      unplaced++;
      continue;
    }
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  const rows = orderKeys(by, [...groups.keys()]).map((key) => {
    const all = groups.get(key)!;
    const done = all.filter((s) => s.status === "completed");
    const withRisk = done.filter((s) => s.risk_level !== null);
    const scores = Object.fromEntries(SCORE_FIELDS.map((f) => [f.key, describe(done.map((s) => s[f.key]))])) as Record<ScoreKey, Describe>;
    const riskPct = Object.fromEntries(
      RISKS.map((r) => [r, withRisk.length ? (withRisk.filter((s) => s.risk_level === r).length / withRisk.length) * 100 : null]),
    ) as Record<Risk, number | null>;
    return {
      key,
      label: groupLabel(by, key),
      n: done.length,
      nAll: all.length,
      enough: done.length >= minN,
      scores,
      riskPct,
      retestPct: all.length ? (all.filter((s) => s.status === "invalid").length / all.length) * 100 : null,
      quality: describe(all.map((s) => s.quality_score)),
      faceFound: describe(all.map((s) => s.face_found_pct)),
    };
  });
  return { rows, unplaced };
}
