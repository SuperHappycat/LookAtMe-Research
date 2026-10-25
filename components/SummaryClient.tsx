"use client";

/**
 * components/SummaryClient.tsx
 * ==============================
 * Web port of gui/summary.py: combines the three sub-test scores into
 * one Overall Screening Score + Risk Level (lib/scoring.ts), and saves
 * the complete session to Google Sheets (via /api/save-result) instead
 * of the desktop app's SQLite database + PDF report.
 *
 * Sub-scores default to 50 (neutral) for any test that wasn't actually
 * run, same as the desktop app's `session.human_preference_pct or 50.0`
 * fallback -- so visiting this page directly never crashes, it just
 * flags which tests are missing.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "@/styles/shared.module.css";
import { computeOverallScore, type RiskLevel } from "@/lib/scoring";
import { clearSession, getSession, type ScreeningSession } from "@/lib/sessionState";
import ResearchSaveCard from "@/components/research/ResearchSaveCard";

const RISK_COLORS: Record<RiskLevel, string> = { Low: "var(--success)", Moderate: "var(--warning)", High: "var(--danger)" };

export default function SummaryClient() {
  const router = useRouter();
  const [session, setSession] = useState<ScreeningSession | null>(null);

  useEffect(() => {
    // sessionStorage doesn't exist during this component's server render,
    // so `session === null` above has to be the universal first-render
    // output on both server and client (avoiding a hydration mismatch);
    // this effect reads the real value right after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession(getSession());
  }, []);

  // Computed unconditionally (before the early returns below) so both
  // handleSave and the JSX can use the same value -- guards internally
  // for a session/patient that isn't loaded yet.
  const result = useMemo(
    () =>
      computeOverallScore({
        humanPreference: session?.test1?.humanPct ?? 50,
        faceAttention: session?.test2?.facePct ?? 50,
        jointAttention: session?.test3?.accuracyPct ?? 50,
      }),
    [session],
  );

  const handleStartOver = useCallback(() => {
    clearSession();
    router.push("/");
  }, [router]);

  if (session === null) {
    return (
      <div className={styles.pageNarrow}>
        <div className={styles.card}>Loading…</div>
      </div>
    );
  }

  if (!session.patient) {
    return (
      <div className={styles.pageNarrow}>
        <h1 className={styles.titleCentered}>Screening Summary</h1>
        <div className={styles.card}>
          <p className={styles.errorText}>No patient info found for this session.</p>
          <div className={styles.saveRow}>
            <button className={styles.primaryButton} onClick={() => router.push("/intake")}>
              Go to Patient Intake
            </button>
          </div>
        </div>
      </div>
    );
  }

  const missing: string[] = [];
  if (!session.test1) missing.push("Test 1");
  if (!session.test2) missing.push("Test 2");
  if (!session.test3) missing.push("Test 3");

  return (
    <div className={styles.pageNarrow}>
      <h1 className={styles.titleCentered}>Screening Summary</h1>
      <p className={styles.subtitleCentered}>
        {session.patient.name}{session.patient.province ? ` • ${session.patient.province}` : ""}
      </p>

      {missing.length > 0 && (
        <p className={styles.errorText} style={{ textAlign: "center" }}>
          Not completed yet: {missing.join(", ")} (using a neutral 50% placeholder for each in the score
          below).
        </p>
      )}

      <div className={styles.overallCard}>
        <div className={styles.overallScore}>
          Overall Score: {result.overallScore.toFixed(0)} / 100
        </div>
        <span className={styles.riskBadge} style={{ background: RISK_COLORS[result.riskLevel] }}>
          {result.riskLevel} Risk
        </span>
      </div>

      <div className={styles.resultsGrid}>
        <div className={styles.statTile}>
          <div className={styles.statValue}>
            {session.test1 ? `${session.test1.humanPct.toFixed(0)}%` : "—"}
          </div>
          <div className={styles.statLabel}>Test 1: Human Preference</div>
        </div>
        <div className={styles.statTile}>
          <div className={styles.statValue}>
            {session.test2 ? `${session.test2.facePct.toFixed(0)}%` : "—"}
          </div>
          <div className={styles.statLabel}>Test 2: Face Attention</div>
        </div>
        <div className={styles.statTile}>
          <div className={styles.statValue}>
            {session.test3 ? `${session.test3.accuracyPct.toFixed(0)}%` : "—"}
          </div>
          <div className={styles.statLabel}>Test 3: Joint Attention</div>
        </div>
      </div>

      {/* Research app: results are saved to Supabase for the selected child
          (the original Google Sheet / Gmail buttons are removed). */}
      <ResearchSaveCard session={session} result={result} />
      <div className={styles.saveRow} style={{ justifyContent: "center" }}>
        <button className={styles.secondaryButton} onClick={handleStartOver}>
          Start Over
        </button>
      </div>

      <p className={styles.subtitleCentered} style={{ marginTop: 24 }}>
        This is a preliminary screening tool, not a diagnostic instrument. Discuss results with a
        qualified healthcare professional.
      </p>
    </div>
  );
}
