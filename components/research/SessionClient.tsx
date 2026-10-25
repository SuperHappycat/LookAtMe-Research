"use client";

/** /r/sessions/[id] — one screening: scores, quality, calibration, replay with gaze dot. */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import styles from "@/styles/shared.module.css";
import rs from "@/styles/research.module.css";
import { friendlyError, getSupabase } from "@/lib/research/supabase/client";
import { parseGazeCsv, type GazeRow } from "@/lib/research/gazeLog";
import { REASON_TEXT } from "@/lib/research/quality";
import { ageInMonths } from "@/lib/research/screening";
import { useResearch } from "./ResearchShell";
import RiskBadge from "./RiskBadge";
import GazeReplay from "./GazeReplay";
import RecordingLinks from "@/lib/research/drive/RecordingLinks";

interface SessionDetail {
  id: string;
  org_id: string;
  child_id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  engine: string;
  overall_score: number | null;
  risk_level: string | null;
  level1_score: number | null;
  level2_score: number | null;
  level3_score: number | null;
  quality_score: number | null;
  face_found_pct: number | null;
  calibration_error_px: number | null;
  low_accuracy: boolean;
  results: {
    test1?: { humanPct: number; geometricPct: number; switches: number; avgFixationMs: number; humanSide: "left" | "right" };
    test2?: { facePct: number; objectPct: number };
    test3?: { blockPct: number; facePct: number; accuracyPct: number; latencyMs: number | null };
    cameraCheck?: { faceFoundPct: number | null; meanLuma: number | null; medianFaceScale: number | null; passed: boolean } | null;
    calibration?: { meanErrorDeg: number | null; grade: string | null; mode: string | null; pointsUsed: number | null; attempts: number } | null;
    endCheck?: { meanErrorDeg: number | null; skipped: boolean } | null;
  } | null;
  quality: { lightingOkPct: number | null; distanceOkPct: number | null; reasons: string[] } | null;
  child: { code: string; birth_month: string | null; sex: string | null } | null;
}

const fmt = (v: number | null | undefined, unit = "") => (v === null || v === undefined ? "—" : `${Math.round(v)}${unit}`);

export default function SessionClient() {
  const { id } = useParams<{ id: string }>();
  const { active } = useResearch();
  const [s, setS] = useState<SessionDetail | null | undefined>(undefined);
  const [rows, setRows] = useState<GazeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const sb = getSupabase();
      const { data, error: err } = await sb
        .from("sessions")
        .select(
          "id, org_id, child_id, started_at, completed_at, status, engine, overall_score, risk_level, level1_score, level2_score, level3_score, quality_score, face_found_pct, calibration_error_px, low_accuracy, results, quality, child:children(code, birth_month, sex)",
        )
        .eq("id", id)
        .maybeSingle();
      if (err) setError(friendlyError(err));
      const detail = (data ?? null) as unknown as SessionDetail | null;
      setS(detail);
      if (!detail) return;
      void sb.rpc("log_action", { p_org: detail.org_id, p_action: "view_session", p_target: detail.id });
      const file = await sb.storage.from("gaze").download(`${detail.org_id}/${detail.id}.csv`);
      setRows(file.data ? parseGazeCsv(await file.data.text()) : []);
    })();
  }, [id]);

  if (s === undefined) return <div className={rs.wide}>…</div>;
  if (s === null)
    return (
      <div className={rs.wide}>
        <div className={styles.card}>ไม่พบ หรือไม่มีสิทธิ์ดู / Not found or not allowed. {error}</div>
      </div>
    );

  const r = s.results ?? {};
  const cc = r.cameraCheck;
  return (
    <div className={rs.wide}>
      <p>
        <Link href={`/r/children/${s.child_id}`}>← {s.child?.code}</Link>
      </p>
      <h1 className={styles.title}>
        {s.child?.code} · {new Date(s.started_at).toLocaleString("th-TH")}
      </h1>
      <p className={rs.muted} style={{ marginTop: -8 }}>
        อายุ / Age {ageInMonths(s.child?.birth_month ?? null, new Date(s.started_at)) ?? "—"} เดือน / months · engine:{" "}
        {s.engine} · {active?.org.name}
      </p>

      <div className={rs.checkGrid}>
        <div className={rs.checkItem}>
          <div className={rs.muted}>คะแนนรวม / Overall</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{fmt(s.overall_score)}</div>
          <RiskBadge risk={s.risk_level} status={s.status} />
        </div>
        <div className={rs.checkItem}>
          <div className={rs.muted}>T1 ชอบมองคน / Human preference</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{fmt(s.level1_score, "%")}</div>
          <div className={rs.muted} style={{ fontSize: 13 }}>
            switches {r.test1?.switches ?? "—"} · fixation {fmt(r.test1?.avgFixationMs, " ms")}
          </div>
        </div>
        <div className={rs.checkItem}>
          <div className={rs.muted}>T2 มองหน้า / Face attention</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{fmt(s.level2_score, "%")}</div>
          <div className={rs.muted} style={{ fontSize: 13 }}>object {fmt(r.test2?.objectPct, "%")}</div>
        </div>
        <div className={rs.checkItem}>
          <div className={rs.muted}>T3 ร่วมความสนใจ / Joint attention</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{fmt(s.level3_score, "%")}</div>
          <div className={rs.muted} style={{ fontSize: 13 }}>
            block {fmt(r.test3?.blockPct, "%")} · latency {fmt(r.test3?.latencyMs ?? null, " ms")}
          </div>
        </div>
      </div>

      <h2 className={rs.sectionTitle}>คุณภาพข้อมูล / Data quality</h2>
      <div className={styles.card}>
        คะแนนคุณภาพ / Quality score <strong>{fmt(s.quality_score)}</strong> · เห็นใบหน้า / face visible {fmt(s.face_found_pct, "%")} ·
        แสง / lighting {fmt(s.quality?.lightingOkPct ?? null, "%")} · ระยะ / distance {fmt(s.quality?.distanceOkPct ?? null, "%")}
        <br />
        ปรับเทียบ / Calibration error: {fmt(s.calibration_error_px, " px")}
        {r.calibration?.meanErrorDeg != null && ` ≈ ${r.calibration.meanErrorDeg.toFixed(1)}°`}
        {r.calibration?.grade && ` · ${r.calibration.grade}`}
        {r.calibration?.mode && ` · ${r.calibration.mode === "child" ? "โหมดเด็ก / child mode" : "adult mode"}`}
        {r.calibration && ` · ${r.calibration.attempts} attempt(s)`}
        {s.low_accuracy && " (ความแม่นยำต่ำ / low accuracy)"}
        {r.endCheck && (
          <>
            <br />
            ตรวจท้ายสุด / Final check:{" "}
            {r.endCheck.skipped || r.endCheck.meanErrorDeg === null ? "ข้าม / skipped" : `≈ ${r.endCheck.meanErrorDeg.toFixed(1)}°`}
          </>
        )}
        {cc && (
          <>
            <br />
            ตรวจกล้องก่อนทดสอบ / Camera check: {cc.passed ? "ผ่าน / passed" : "ไม่ผ่าน / not passed"} (face{" "}
            {fmt(cc.faceFoundPct, "%")}, light {fmt(cc.meanLuma)})
          </>
        )}
        {(s.quality?.reasons ?? []).length > 0 && (
          <ul className={styles.errorText}>
            {s.quality!.reasons.map((x) => (
              <li key={x}>{REASON_TEXT[x] ?? x}</li>
            ))}
          </ul>
        )}
      </div>

      <h2 className={rs.sectionTitle}>วิดีโอบันทึก / Recordings</h2>
      <RecordingLinks sessionId={s.id} />

      <h2 className={rs.sectionTitle}>เล่นซ้ำพร้อมจุดการมอง / Replay with gaze dot</h2>
      {rows === null ? (
        <div className={styles.card}>…</div>
      ) : rows.length === 0 ? (
        <div className={styles.card}>
          <span className={rs.muted}>ไม่มีไฟล์ข้อมูลการมอง / No gaze file for this session.</span>
        </div>
      ) : (
        <GazeReplay rows={rows} humanSide={r.test1?.humanSide ?? null} />
      )}

      <p className={rs.muted} style={{ fontSize: 13, marginTop: 20 }}>
        ใช้คัดกรองเบื้องต้น ไม่ใช่การวินิจฉัย / Screening only, not a diagnosis.
      </p>
    </div>
  );
}
