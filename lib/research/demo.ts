/**
 * lib/research/demo.ts
 * ======================
 * Demo mode, for presentations: the full screening runs as usual (camera, calibration, Tests 1–3), but the
 * summary shows a result the presenter chose in advance, and NOTHING is saved (no database session, no quota
 * used, no gaze file, no recording). The summary is marked "Demo" so it can't be mistaken for a real result.
 */

import { computeOverallScore, type RiskLevel, type SubScores } from "../scoring";
import { beginResearchScreening, type Assent } from "./screening";

export type DemoPreset = "Low" | "Moderate" | "High";

/** Overall score used for each preset (inside the band of lib/scoring.ts RISK_THRESHOLDS). */
export const DEMO_PRESETS: Record<DemoPreset, number> = { Low: 22, Moderate: 55, High: 84 };

/**
 * Sub-scores that give exactly `overall` with the real weights (40/35/25), varied a little so the three
 * tiles don't all show the same number. Each stays within 0–100.
 */
export function demoSubScores(overall: number): SubScores {
  const t = Math.max(0, Math.min(100, Math.round(overall)));
  const spread = Math.min(6, t, 100 - t);
  // 0.4·(+s) + 0.35·(−s) + 0.25·(−0.2s) = 0
  return { humanPreference: t + spread, faceAttention: t - spread, jointAttention: t - 0.2 * spread };
}

export function demoResult(overall: number): { sub: SubScores; overallScore: number; riskLevel: RiskLevel } {
  const sub = demoSubScores(overall);
  return { sub, ...computeOverallScore(sub) };
}

/** Starts a demo screening for the active organization. No server call. */
export function startDemoScreening(a: { orgId: string; engine: string; ageMonths: number; score: number; assent?: Assent }): void {
  beginResearchScreening(
    {
      orgId: a.orgId,
      childId: "",
      childCode: "DEMO",
      sessionId: "",
      clientSessionId: crypto.randomUUID(),
      engine: a.engine,
      startedAt: new Date().toISOString(),
      ageMonths: a.ageMonths,
      allowRecording: false,
      blind: false,
      demo: { score: Math.max(0, Math.min(100, Math.round(a.score))) },
      ...(a.assent ? { assent: a.assent } : {}),
    },
    null,
  );
}
