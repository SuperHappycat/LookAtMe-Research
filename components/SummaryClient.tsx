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
import { endResearchScreening, getResearchContext } from "@/lib/research/screening";
import { demoResult } from "@/lib/research/demo";
import NextSteps from "@/components/research/NextSteps";
import report from "@/components/research/report.module.css";
import { NOT_DIAGNOSTIC } from "@/lib/research/nextSteps";

const RISK_COLORS: Record<RiskLevel, string> = { Low: "var(--success)", Moderate: "var(--warning)", High: "var(--danger)" };
const RISK_TH: Record<RiskLevel, string> = { Low: "เสี่ยงต่ำ", Moderate: "เสี่ยงปานกลาง", High: "เสี่ยงสูง" };

export default function SummaryClient() {
  const router = useRouter();
  const [session, setSession] = useState<ScreeningSession | null>(null);
  // Blind mode (hospital): the result is saved as usual but not shown on this screen.
  const [blind, setBlind] = useState(false);
  // Demo mode: show the presenter's chosen result; nothing is saved.
  const [demoScore, setDemoScore] = useState<number | null>(null);
  /** Data too poor to interpret (from the save card's quality check): show "retest" instead of advice. */
  const [retest, setRetest] = useState(false);

  useEffect(() => {
    // sessionStorage doesn't exist during this component's server render,
    // so `session === null` above has to be the universal first-render
    // output on both server and client (avoiding a hydration mismatch);
    // this effect reads the real value right after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession(getSession());
    setBlind(!!getResearchContext()?.blind);
    setDemoScore(getResearchContext()?.demo?.score ?? null);
  }, []);

  // Computed unconditionally (before the early returns below) so both
  // handleSave and the JSX can use the same value -- guards internally
  // for a session/patient that isn't loaded yet.
  const demo = useMemo(() => (demoScore === null ? null : demoResult(demoScore)), [demoScore]);
  const result = useMemo(
    () =>
      demo ??
      computeOverallScore({
        humanPreference: session?.test1?.humanPct ?? 50,
        faceAttention: session?.test2?.facePct ?? 50,
        jointAttention: session?.test3?.accuracyPct ?? 50,
      }),
    [session, demo],
  );
  const tile = (real: number | undefined, demoValue: number) =>
    demo ? `${demoValue.toFixed(0)}%` : real === undefined ? "—" : `${real.toFixed(0)}%`;

  const handleQuality = useCallback((q: { retestNeeded: boolean }) => setRetest(q.retestNeeded), []);

  const handleStartOver = useCallback(() => {
    if (demoScore !== null) {
      endResearchScreening();
      router.push("/r/demo");
      return;
    }
    clearSession();
    router.push("/");
  }, [router, demoScore]);

  if (session === null) {
    return (
      <div className={styles.pageNarrow}>
        <div className={styles.card}>กำลังโหลด… / Loading…</div>
      </div>
    );
  }

  if (!session.patient) {
    return (
      <div className={styles.pageNarrow}>
        <h1 className={styles.titleCentered}>สรุปผลการคัดกรอง / Screening Summary</h1>
        <div className={styles.card}>
          <p className={styles.errorText}>ไม่พบข้อมูลผู้รับการทดสอบ / No patient info found for this session.</p>
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

  const today = new Date().toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" });

  return (
    <div className={styles.pageNarrow}>
      <div className={report.printHeader}>
        <h1>LookAtMe — รายงานผลการคัดกรอง / Screening report</h1>
        <p>
          รหัสเด็ก / Child code: <strong>{session.patient.name}</strong>
          {session.patient.dateOfBirth ? ` · เกิด / Born: ${session.patient.dateOfBirth.slice(0, 7)}` : ""} · วันที่ / Date: {today}
        </p>
      </div>
      <h1 className={`${styles.titleCentered} ${report.noPrint}`}>สรุปผลการคัดกรอง / Screening Summary</h1>
      <p className={`${styles.subtitleCentered} ${report.noPrint}`}>
        {session.patient.name}{session.patient.province ? ` • ${session.patient.province}` : ""}
      </p>

      {demo && (
        <p style={{ textAlign: "center", margin: "0 0 8px" }}>
          <span className={styles.riskBadge} style={{ background: "var(--muted)" }}>
            สาธิต / Demo
          </span>
        </p>
      )}

      {!demo && missing.length > 0 && (
        <p className={styles.errorText} style={{ textAlign: "center" }}>
          ยังทำไม่ครบ / Not completed yet: {missing.join(", ")} (ใช้ค่า 50% แทน / using a neutral 50% placeholder for each in
          the score below).
        </p>
      )}

      {blind ? (
        <div className={styles.overallCard}>
          <div className={styles.overallScore} style={{ fontSize: 20 }}>
            ผลถูกปิดไว้ (blind mode) / Result hidden
          </div>
          <p className={styles.subtitleCentered} style={{ margin: 0 }}>
            ผลจะเห็นได้เฉพาะผู้ดูแลองค์กร / Only organization admins can see this result.
          </p>
        </div>
      ) : (
        <>
          <div className={styles.overallCard}>
            <div className={styles.overallScore}>
              คะแนนรวม / Overall Score: {result.overallScore.toFixed(0)} / 100
            </div>
            {retest ? (
              <span className={styles.riskBadge} style={{ background: "var(--muted)" }}>
                แปลผลไม่ได้ ต้องทดสอบซ้ำ / Not interpretable — retest
              </span>
            ) : (
              <span className={styles.riskBadge} style={{ background: RISK_COLORS[result.riskLevel] }}>
                {RISK_TH[result.riskLevel]} / {result.riskLevel} Risk
              </span>
            )}
          </div>

          <div className={styles.resultsGrid}>
            <div className={styles.statTile}>
              <div className={styles.statValue}>{tile(session.test1?.humanPct, demo?.sub.humanPreference ?? 0)}</div>
              <div className={styles.statLabel}>แบบทดสอบที่ 1: ความสนใจคน / Test 1: Human Preference</div>
            </div>
            <div className={styles.statTile}>
              <div className={styles.statValue}>{tile(session.test2?.facePct, demo?.sub.faceAttention ?? 0)}</div>
              <div className={styles.statLabel}>แบบทดสอบที่ 2: ความสนใจใบหน้า / Test 2: Face Attention</div>
            </div>
            <div className={styles.statTile}>
              <div className={styles.statValue}>{tile(session.test3?.accuracyPct, demo?.sub.jointAttention ?? 0)}</div>
              <div className={styles.statLabel}>แบบทดสอบที่ 3: การมองตามร่วมกัน / Test 3: Joint Attention</div>
            </div>
          </div>

          {retest ? (
            <section className={report.retest}>
              <h2>ควรทดสอบซ้ำ / Retest needed</h2>
              <p>
                ข้อมูลการมองครั้งนี้ไม่พอที่จะแปลผลได้ (เช่น กล้องเห็นใบหน้าไม่ชัด) กรุณาทดสอบใหม่ อย่าใช้คะแนนข้างบนแปลผล
                <br />
                <span className={report.en}>
                  This session&apos;s gaze data were not good enough to interpret (for example, the face was often not
                  visible). Please repeat the test; don&apos;t use the score above.
                </span>
              </p>
            </section>
          ) : (
            <NextSteps risk={result.riskLevel} />
          )}

          <div className={`${styles.saveRow} ${report.noPrint}`} style={{ justifyContent: "center" }}>
            <button className={styles.primaryButton} onClick={() => window.print()}>
              พิมพ์ / บันทึกเป็น PDF · Print / Save as PDF
            </button>
          </div>
        </>
      )}

      {/* Research app: results are saved to Supabase for the selected child
          (the original Google Sheet / Gmail buttons are removed). */}
      <div className={report.noPrint}>
        {demo ? (
          <p className={styles.subtitleCentered}>โหมดสาธิต: ไม่ได้บันทึกผล / Demo mode: nothing was saved.</p>
        ) : (
          <ResearchSaveCard session={session} result={result} onQuality={handleQuality} />
        )}
        <div className={styles.saveRow} style={{ justifyContent: "center" }}>
          <button className={styles.secondaryButton} onClick={handleStartOver}>
            เริ่มใหม่ / Start Over
          </button>
        </div>
      </div>

      <p className={styles.subtitleCentered} style={{ marginTop: 24 }}>
        {NOT_DIAGNOSTIC.th} ควรปรึกษาผลกับบุคลากรทางการแพทย์
        <br />
        {NOT_DIAGNOSTIC.en} Discuss results with a qualified healthcare professional.
      </p>
    </div>
  );
}
