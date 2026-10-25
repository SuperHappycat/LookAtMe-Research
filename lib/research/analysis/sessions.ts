/**
 * lib/research/analysis/sessions.ts
 * ===================================
 * The session shape the analysis tools load, plus age-band and filter helpers.
 * Sessions hidden by RLS (blind mode, other orgs) are simply never loaded.
 */

import { ageInMonths } from "../screening";
import { AGE_BANDS, type AgeBand } from "./config";

export type Risk = "Low" | "Moderate" | "High";
export const RISKS: readonly Risk[] = ["Low", "Moderate", "High"];

export interface AnalysisSession {
  id: string;
  child_id: string;
  started_at: string;
  completed_at: string | null;
  status: "started" | "completed" | "invalid" | string;
  engine: string;
  overall_score: number | null;
  risk_level: Risk | null;
  level1_score: number | null;
  level2_score: number | null;
  level3_score: number | null;
  quality_score: number | null;
  face_found_pct: number | null;
  retest_needed: boolean;
  calibration_error_px: number | null;
  low_accuracy: boolean;
  results: {
    test1?: { humanPct?: number; geometricPct?: number; switches?: number; avgFixationMs?: number; humanSide?: "left" | "right" };
    test2?: { facePct?: number; objectPct?: number };
    test3?: { blockPct?: number; facePct?: number; accuracyPct?: number; latencyMs?: number | null };
    calibration?: { meanErrorDeg?: number | null } | null;
  } | null;
  quality: { lightingOkPct?: number | null; distanceOkPct?: number | null } | null;
  child: {
    code: string;
    birth_month: string | null;
    sex: "M" | "F" | "U" | null;
    consents?: { allow_research: boolean; withdrawn_at: string | null }[];
  } | null;
}

/** Columns selected from Supabase for AnalysisSession. */
export const ANALYSIS_SELECT =
  "id, child_id, started_at, completed_at, status, engine, overall_score, risk_level, level1_score, level2_score, level3_score, quality_score, face_found_pct, retest_needed, calibration_error_px, low_accuracy, results, quality, child:children(code, birth_month, sex, consents(allow_research, withdrawn_at))";

export function sessionAge(s: Pick<AnalysisSession, "started_at" | "child">): number | null {
  return ageInMonths(s.child?.birth_month ?? null, new Date(s.started_at));
}

export function bandOf(ageMonths: number | null, bands: readonly AgeBand[] = AGE_BANDS): AgeBand | null {
  if (ageMonths === null) return null;
  return bands.find((b) => ageMonths >= b.minMonths && ageMonths <= b.maxMonths) ?? null;
}

/** True when the child has at least one research consent that has not been withdrawn. */
export function hasResearchConsent(s: Pick<AnalysisSession, "child">): boolean {
  return (s.child?.consents ?? []).some((c) => c.allow_research && !c.withdrawn_at);
}

export interface SessionFilter {
  from?: string; // YYYY-MM-DD inclusive
  to?: string; // YYYY-MM-DD inclusive
  risk?: "all" | Risk;
  code?: string;
  statuses?: readonly string[];
  researchConsentOnly?: boolean;
}

export function filterSessions<T extends AnalysisSession>(sessions: readonly T[], f: SessionFilter): T[] {
  const q = (f.code ?? "").trim().toLowerCase();
  return sessions.filter((s) => {
    const d = s.started_at.slice(0, 10);
    if (f.from && d < f.from) return false;
    if (f.to && d > f.to) return false;
    if (f.risk && f.risk !== "all" && s.risk_level !== f.risk) return false;
    if (f.statuses && !f.statuses.includes(s.status)) return false;
    if (q && !(s.child?.code ?? "").toLowerCase().includes(q)) return false;
    if (f.researchConsentOnly && !hasResearchConsent(s)) return false;
    return true;
  });
}

/** Keeps each child's earliest session only (input order does not matter). */
export function firstPerChild<T extends AnalysisSession>(sessions: readonly T[]): T[] {
  const best = new Map<string, T>();
  for (const s of sessions) {
    const cur = best.get(s.child_id);
    if (!cur || s.started_at < cur.started_at) best.set(s.child_id, s);
  }
  return [...best.values()];
}

/** 1 for a child's first session, 2 for the second, … (by started_at, across the given sessions). */
export function sessionNumbers(sessions: readonly AnalysisSession[]): Map<string, number> {
  const byChild = new Map<string, AnalysisSession[]>();
  for (const s of sessions) byChild.set(s.child_id, [...(byChild.get(s.child_id) ?? []), s]);
  const out = new Map<string, number>();
  for (const list of byChild.values()) {
    list.sort((a, b) => a.started_at.localeCompare(b.started_at)).forEach((s, i) => out.set(s.id, i + 1));
  }
  return out;
}

export const SCORE_FIELDS = [
  { key: "overall_score", th: "คะแนนรวม", en: "Overall" },
  { key: "level1_score", th: "T1 ชอบมองคน", en: "T1 human preference" },
  { key: "level2_score", th: "T2 มองหน้า", en: "T2 face attention" },
  { key: "level3_score", th: "T3 ร่วมความสนใจ", en: "T3 joint attention" },
] as const;
export type ScoreKey = (typeof SCORE_FIELDS)[number]["key"];
