/**
 * lib/research/analysis/ageComparison.ts
 * ========================================
 * Age comparison (spec §5, all plans): per age band, n, median and IQR of the
 * overall and level scores, and the risk distribution; plus a session's
 * percentile rank within its band. Uses completed sessions only.
 * A percentile is a description of this organization's data, not a norm.
 */

import { AGE_BANDS, ANALYSIS_CONFIG, type AgeBand } from "./config";
import { RISKS, SCORE_FIELDS, bandOf, sessionAge, type AnalysisSession, type Risk, type ScoreKey } from "./sessions";
import { describe, percentileRank, type Describe } from "./stats";

export interface BandSummary {
  band: AgeBand;
  n: number;
  enough: boolean;
  scores: Record<ScoreKey, Describe>;
  risk: Record<Risk, number>;
}

export interface AgeComparison {
  bands: BandSummary[];
  /** Completed sessions outside every band or without a birth month. */
  outside: number;
}

export function sessionsInBand(sessions: readonly AnalysisSession[], band: AgeBand): AnalysisSession[] {
  return sessions.filter((s) => s.status === "completed" && bandOf(sessionAge(s), [band]) !== null);
}

export function ageComparison(
  sessions: readonly AnalysisSession[],
  bands: readonly AgeBand[] = AGE_BANDS,
  minN: number = ANALYSIS_CONFIG.minNAgeBand,
): AgeComparison {
  const completed = sessions.filter((s) => s.status === "completed");
  const out = bands.map((band) => {
    const list = sessionsInBand(completed, band);
    const scores = Object.fromEntries(SCORE_FIELDS.map((f) => [f.key, describe(list.map((s) => s[f.key]))])) as Record<ScoreKey, Describe>;
    const risk = Object.fromEntries(RISKS.map((r) => [r, list.filter((s) => s.risk_level === r).length])) as Record<Risk, number>;
    return { band, n: list.length, enough: list.length >= minN, scores, risk };
  });
  const outside = completed.filter((s) => bandOf(sessionAge(s), bands) === null).length;
  return { bands: out, outside };
}

export interface SessionPercentile {
  band: AgeBand | null;
  /** Reference sessions: the band's completed sessions, excluding this one. */
  referenceN: number;
  enough: boolean;
  percentiles: Record<ScoreKey, number | null>;
}

/** Percentile rank (mid-rank) of a session's scores among the other completed sessions in its band. */
export function sessionPercentile(
  session: AnalysisSession,
  sessions: readonly AnalysisSession[],
  bands: readonly AgeBand[] = AGE_BANDS,
  minN: number = ANALYSIS_CONFIG.minNAgeBand,
): SessionPercentile {
  const band = bandOf(sessionAge(session), bands);
  const empty = Object.fromEntries(SCORE_FIELDS.map((f) => [f.key, null])) as Record<ScoreKey, number | null>;
  if (!band) return { band: null, referenceN: 0, enough: false, percentiles: empty };
  const ref = sessionsInBand(sessions, band).filter((s) => s.id !== session.id);
  const enough = ref.length >= minN;
  const percentiles = Object.fromEntries(
    SCORE_FIELDS.map((f) => {
      const v = session[f.key];
      return [f.key, enough && v !== null ? percentileRank(ref.map((s) => s[f.key]), v) : null];
    }),
  ) as Record<ScoreKey, number | null>;
  return { band, referenceN: ref.length, enough, percentiles };
}
