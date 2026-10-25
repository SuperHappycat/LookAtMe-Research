"use client";

/**
 * Shown on /summary during a Research screening. Saves automatically:
 * 1. computes the session quality score,
 * 2. uploads the gaze CSV to Supabase Storage (gaze/<org>/<session>.csv),
 * 3. calls complete_session (scores, quality, retest flag; quota used only if completed).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "@/styles/shared.module.css";
import rs from "@/styles/research.module.css";
import type { ScreeningSession } from "@/lib/sessionState";
import type { RiskLevel } from "@/lib/scoring";
import { friendlyError, getSupabase, supabaseConfigured } from "@/lib/research/supabase/client";
import { endResearchScreening, getResearchContext, type ResearchContext } from "@/lib/research/screening";
import { getGazeLog, gazeRowsToCsv } from "@/lib/research/gazeLog";
import { computeQuality, QUALITY_CONFIG, REASON_TEXT, type QualityResult } from "@/lib/research/quality";
import { getActiveModel, getCalibrationState } from "@/lib/research/gaze/calibrationStore";
import { RESEARCH_CONFIG } from "@/lib/research/config";
import EndCheck, { type EndCheckResult } from "./EndCheck";

type SaveState = "idle" | "saving" | "saved" | "error";

export default function ResearchSaveCard({
  session,
  result,
}: {
  session: ScreeningSession;
  result: { overallScore: number; riskLevel: RiskLevel };
}) {
  const router = useRouter();
  const [ctx] = useState<ResearchContext | null>(() => getResearchContext());
  const [state, setState] = useState<SaveState>("idle");
  const [status, setStatus] = useState<string | null>(null);
  const [quality, setQuality] = useState<QualityResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const complete = !!(session.test1 && session.test2 && session.test3);
  // MediaPipe sessions get a short end-of-session accuracy check before saving.
  const [needsEndCheck] = useState(() => !!ctx && ctx.engine === "mediapipe" && getActiveModel() !== null);
  const [endCheck, setEndCheck] = useState<EndCheckResult | null>(null);
  const ready = complete && (!needsEndCheck || endCheck !== null);

  const save = useCallback(async () => {
    if (!ctx || !ready) return;
    setState("saving");
    setError(null);
    try {
      const log = getGazeLog();
      const cal = getCalibrationState();
      const calRec = cal.state === "ready" ? cal.record : null;
      const q = computeQuality({
        faceFound: log.rows.map((r) => r.face_found),
        luma: log.luma.map((l) => l.value),
        faceScale: log.rows.map((r) => r.face_scale).filter((v): v is number => v !== null),
        calibration:
          ctx.engine === "mediapipe" && calRec
            ? { meanErrorPx: calRec.meanErrorPx, ok: calRec.ok, lowAccuracy: calRec.lowAccuracy }
            : null,
        endCheckDeg: endCheck && !endCheck.skipped ? endCheck.meanErrorDeg : null,
        maxEndCheckDeg: RESEARCH_CONFIG.maxEndCheckErrorDeg,
      });
      setQuality(q);

      const sb = getSupabase();
      const csv = gazeRowsToCsv(ctx.sessionId, log.rows);
      const path = `${ctx.orgId}/${ctx.sessionId}.csv`;
      const up = await sb.storage.from("gaze").upload(path, new Blob([csv], { type: "text/csv" }), {
        upsert: true,
        contentType: "text/csv",
      });
      if (up.error) throw up.error;

      const data = {
        overall_score: result.overallScore,
        risk_level: result.riskLevel,
        level1_score: session.test1?.humanPct ?? null,
        level2_score: session.test2?.facePct ?? null,
        level3_score: session.test3?.accuracyPct ?? null,
        face_found_pct: q.faceFoundPct,
        quality_score: q.qualityScore,
        retest_needed: q.retestNeeded,
        calibration_error_px: Number.isFinite(calRec?.meanErrorPx) ? calRec?.meanErrorPx : null,
        low_accuracy: calRec?.lowAccuracy ?? false,
        gaze_bytes: csv.length,
        results: {
          test1: session.test1,
          test2: session.test2,
          test3: session.test3,
          cameraCheck: ctx.cameraCheck ?? null,
          calibration: calRec
            ? {
                meanErrorPx: Number.isFinite(calRec.meanErrorPx) ? calRec.meanErrorPx : null,
                meanErrorDeg: calRec.meanErrorDeg ?? null,
                grade: calRec.grade ?? null,
                mode: calRec.mode ?? null,
                pointsUsed: calRec.pointsUsed ?? null,
                attempts: calRec.attempts,
              }
            : null,
          endCheck,
          levels: log.levels,
          samples: log.rows.length,
        },
        quality: { ...q, thresholds: QUALITY_CONFIG },
      };
      const rpc = await sb.rpc("complete_session", { p_session: ctx.sessionId, p_data: data, p_gaze_path: path });
      if (rpc.error) throw rpc.error;
      setStatus(rpc.data as string);
      setState("saved");
    } catch (err) {
      setError(friendlyError(err));
      setState("error");
    }
  }, [ctx, ready, result, session, endCheck]);

  useEffect(() => {
    if (started.current || !ctx || !ready || !supabaseConfigured()) return;
    started.current = true;
    void save();
  }, [ctx, ready, save]);

  if (!ctx) {
    return (
      <div className={styles.card} style={{ textAlign: "center" }}>
        <p style={{ marginTop: 0 }}>
          ผลนี้ไม่ได้ผูกกับเด็กในระบบ จึงไม่ถูกบันทึก / This run isn&apos;t linked to a child, so it isn&apos;t saved.
        </p>
        <button className={styles.primaryButton} onClick={() => router.push("/r")}>
          ไปหน้าเด็ก / Go to children
        </button>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <h2 style={{ marginTop: 0 }}>บันทึกผล / Saving results · {ctx.childCode}</h2>
      {!complete && (
        <p className={styles.errorText}>
          ยังทำแบบทดสอบไม่ครบ 3 ระดับ จึงยังไม่บันทึก / Not all three tests are done, so nothing is saved yet.
        </p>
      )}
      {complete && needsEndCheck && endCheck === null && <EndCheck onDone={setEndCheck} />}
      {endCheck && !endCheck.skipped && endCheck.meanErrorDeg !== null && (
        <p className={rs.muted}>
          ตรวจท้ายสุด / Final check: ≈ {endCheck.meanErrorDeg.toFixed(1)}° ({Math.round(endCheck.meanErrorPx ?? 0)} px)
        </p>
      )}
      {state === "saving" && <p>กำลังบันทึก… / Saving…</p>}
      {state === "error" && (
        <>
          <p className={styles.errorText}>บันทึกไม่สำเร็จ / Save failed: {error}</p>
          <button className={styles.primaryButton} onClick={save}>
            ลองอีกครั้ง / Try again
          </button>
        </>
      )}
      {quality && (
        <p>
          คุณภาพข้อมูล / Data quality: <strong>{Math.round(quality.qualityScore)}</strong> / 100 · เห็นใบหน้า / face visible{" "}
          {Math.round(quality.faceFoundPct)}%
          {quality.lightingOkPct !== null && ` · แสง / lighting ${Math.round(quality.lightingOkPct)}%`}
          {quality.distanceOkPct !== null && ` · ระยะ / distance ${Math.round(quality.distanceOkPct)}%`}
        </p>
      )}
      {quality?.retestNeeded && (
        <div className={styles.errorText}>
          <strong>ควรทดสอบซ้ำ / Retest recommended</strong>
          <ul style={{ margin: "6px 0" }}>
            {quality.reasons.map((r) => (
              <li key={r}>{REASON_TEXT[r] ?? r}</li>
            ))}
          </ul>
          ผลครั้งนี้ไม่นับโควตา / This session does not use quota.
        </div>
      )}
      {state === "saved" && (
        <>
          <p className={styles.successText}>
            บันทึกแล้ว ✓ / Saved ✓ ({status === "completed" ? "สมบูรณ์ / completed" : "ต้องทดสอบซ้ำ / marked for retest"})
          </p>
          <div className={styles.saveRow}>
            <button className={styles.primaryButton} onClick={() => router.push(`/r/sessions/${ctx.sessionId}`)}>
              ดูรายละเอียด / View session
            </button>
            <button
              className={styles.secondaryButton}
              onClick={() => {
                const childId = ctx.childId;
                endResearchScreening();
                router.push(`/r/children/${childId}`);
              }}
            >
              กลับหน้าเด็ก / Back to child
            </button>
          </div>
        </>
      )}
      <p className={rs.muted} style={{ fontSize: 13, marginBottom: 0 }}>
        เกณฑ์คุณภาพยังเป็นค่าชั่วคราว รอปรับจากข้อมูลนำร่อง / Quality thresholds are provisional (TBD from pilot data).
      </p>
    </div>
  );
}
