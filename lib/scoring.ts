/**
 * lib/scoring.ts
 * ================
 * Port of scoring.py: combines the three sub-test scores (Human
 * Preference from Test 1, Face Attention from Test 2, Joint Attention
 * from Test 3 -- each 0-100) into one Overall Screening Score (0-100),
 * then maps that to a qualitative Risk Level. Same fixed weights and
 * thresholds as the desktop app (config.py's ScoringWeights/RiskThresholds
 * defaults) -- not exposed as a Settings page here, so they're inlined
 * rather than threaded through a config object.
 */

export const SCORING_WEIGHTS = {
  humanPreference: 0.4,
  faceAttention: 0.35,
  jointAttention: 0.25,
} as const;

export const RISK_THRESHOLDS = {
  lowMax: 39,
  moderateMax: 69,
} as const;

export type RiskLevel = "Low" | "Moderate" | "High";

export interface SubScores {
  humanPreference: number;
  faceAttention: number;
  jointAttention: number;
}

export interface ScoreResult {
  overallScore: number;
  riskLevel: RiskLevel;
}

export function riskBandFor(score: number): RiskLevel {
  if (score <= RISK_THRESHOLDS.lowMax) return "Low";
  if (score <= RISK_THRESHOLDS.moderateMax) return "Moderate";
  return "High";
}

export function computeOverallScore(sub: SubScores): ScoreResult {
  const overall =
    sub.humanPreference * SCORING_WEIGHTS.humanPreference +
    sub.faceAttention * SCORING_WEIGHTS.faceAttention +
    sub.jointAttention * SCORING_WEIGHTS.jointAttention;
  const clamped = Math.max(0, Math.min(100, overall));
  return { overallScore: clamped, riskLevel: riskBandFor(clamped) };
}
