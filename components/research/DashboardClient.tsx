"use client";

/**
 * /r/dashboard — all screenings of the organization, with filters and
 * spreadsheet export (admins only; every export is written to the audit log).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import styles from "@/styles/shared.module.css";
import rs from "@/styles/research.module.css";
import { friendlyError, getSupabase } from "@/lib/research/supabase/client";
import { ageInMonths } from "@/lib/research/screening";
import { downloadText, gazeExportCsv, sessionsCsv, type ExportSession } from "@/lib/research/exportCsv";
import { useResearch } from "./ResearchShell";
import RiskBadge from "./RiskBadge";

const today = () => new Date().toISOString().slice(0, 10);

export default function DashboardClient() {
  const { active } = useResearch();
  const orgId = active?.org.id;
  const isAdmin = active?.role === "admin";
  const [sessions, setSessions] = useState<ExportSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [risk, setRisk] = useState("all");
  const [status, setStatus] = useState("all");
  const [code, setCode] = useState("");
  const [exporting, setExporting] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    const { data, error: err } = await getSupabase()
      .from("sessions")
      .select(
        "id, started_at, completed_at, status, engine, overall_score, risk_level, level1_score, level2_score, level3_score, quality_score, face_found_pct, retest_needed, calibration_error_px, low_accuracy, child:children(code, birth_month, sex)",
      )
      .eq("org_id", orgId)
      .order("started_at", { ascending: false })
      .limit(5000);
    if (err) return setError(friendlyError(err));
    setSessions((data ?? []) as unknown as ExportSession[]);
  }, [orgId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data load; state is set after the request resolves
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const q = code.trim().toLowerCase();
    return (sessions ?? []).filter((s) => {
      const d = s.started_at.slice(0, 10);
      if (from && d < from) return false;
      if (to && d > to) return false;
      if (risk !== "all" && s.risk_level !== risk) return false;
      if (status !== "all" && s.status !== status) return false;
      if (q && !(s.child?.code ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [sessions, from, to, risk, status, code]);

  const counts = useMemo(() => {
    const c = { total: shown.length, completed: 0, retest: 0, Low: 0, Moderate: 0, High: 0 };
    for (const s of shown) {
      if (s.status === "completed") {
        c.completed++;
        if (s.risk_level === "Low" || s.risk_level === "Moderate" || s.risk_level === "High") c[s.risk_level]++;
      }
      if (s.status === "invalid") c.retest++;
    }
    return c;
  }, [shown]);

  async function exportSessions() {
    if (!orgId) return;
    setExporting("sessions");
    await getSupabase().rpc("log_action", { p_org: orgId, p_action: "export_sessions_csv", p_target: `${shown.length} rows` });
    downloadText(`lookatme-sessions-${today()}.csv`, sessionsCsv(shown));
    setExporting(null);
  }

  async function exportGaze() {
    if (!orgId) return;
    const withData = shown.filter((s) => s.status !== "started");
    if (withData.length > 300 && !window.confirm(`${withData.length} sessions — this may take a while. Continue?`)) return;
    setExporting("gaze");
    setError(null);
    try {
      const sb = getSupabase();
      await sb.rpc("log_action", { p_org: orgId, p_action: "export_gaze_csv", p_target: `${withData.length} sessions` });
      const parts: { session: ExportSession; gazeCsv: string }[] = [];
      for (const s of withData) {
        const { data } = await sb.storage.from("gaze").download(`${orgId}/${s.id}.csv`);
        if (data) parts.push({ session: s, gazeCsv: await data.text() });
      }
      downloadText(`lookatme-gaze-${today()}.csv`, gazeExportCsv(parts));
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className={rs.wide}>
      <h1 className={styles.title}>ผลการคัดกรอง / Results</h1>

      <div className={rs.checkGrid}>
        {[
          ["ทั้งหมด / Total", counts.total],
          ["สมบูรณ์ / Completed", counts.completed],
          ["ทดสอบซ้ำ / Retest", counts.retest],
          ["ความเสี่ยงต่ำ / Low", counts.Low],
          ["ปานกลาง / Moderate", counts.Moderate],
          ["สูง / High", counts.High],
        ].map(([label, n]) => (
          <div key={label as string} className={rs.checkItem}>
            <div className={rs.muted} style={{ fontSize: 13 }}>
              {label}
            </div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{n}</div>
          </div>
        ))}
      </div>

      <div className={styles.card}>
        <div className={rs.row}>
          <div className={rs.field}>
            <label htmlFor="f-from">ตั้งแต่ / From</label>
            <input id="f-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className={rs.field}>
            <label htmlFor="f-to">ถึง / To</label>
            <input id="f-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className={rs.field}>
            <label htmlFor="f-risk">ความเสี่ยง / Risk</label>
            <select id="f-risk" value={risk} onChange={(e) => setRisk(e.target.value)}>
              <option value="all">ทั้งหมด / All</option>
              <option value="Low">Low</option>
              <option value="Moderate">Moderate</option>
              <option value="High">High</option>
            </select>
          </div>
          <div className={rs.field}>
            <label htmlFor="f-status">สถานะ / Status</label>
            <select id="f-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">ทั้งหมด / All</option>
              <option value="completed">สมบูรณ์ / Completed</option>
              <option value="invalid">ทดสอบซ้ำ / Retest</option>
              <option value="started">ไม่เสร็จ / Not finished</option>
            </select>
          </div>
          <div className={rs.field}>
            <label htmlFor="f-code">รหัส / Code</label>
            <input id="f-code" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
        </div>
        {isAdmin && (
          <div className={styles.saveRow} style={{ marginTop: 14 }}>
            <button className={styles.primaryButton} onClick={exportSessions} disabled={!!exporting || !shown.length}>
              {exporting === "sessions" ? "…" : "ส่งออกสรุป (CSV) / Export sessions"}
            </button>
            <button className={styles.secondaryButton} onClick={exportGaze} disabled={!!exporting || !shown.length}>
              {exporting === "gaze" ? "กำลังรวมไฟล์… / Building…" : "ส่งออกข้อมูลการมองทั้งหมด / Export all gaze data"}
            </button>
          </div>
        )}
        {isAdmin && (
          <p className={rs.muted} style={{ fontSize: 13, marginBottom: 0 }}>
            การนำข้อมูลไปใช้ในงานวิจัยต้องได้รับอนุมัติจากคณะกรรมการจริยธรรมของหน่วยงาน · Using this data in research needs
            your institution&apos;s ethics committee approval. Exports contain coded IDs only and are logged.
          </p>
        )}
        {error && <p className={styles.errorText}>{error}</p>}
      </div>

      <div className={styles.card} style={{ marginTop: 16 }}>
        <div className={rs.tableWrap}>
          <table className={rs.table}>
            <thead>
              <tr>
                <th>วันที่ / Date</th>
                <th>รหัส / Code</th>
                <th>อายุ (ด.) / Age (m)</th>
                <th>คะแนน / Score</th>
                <th>ความเสี่ยง / Risk</th>
                <th>T1 / T2 / T3</th>
                <th>คุณภาพ / Quality</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id}>
                  <td>{new Date(s.started_at).toLocaleDateString("th-TH")}</td>
                  <td>{s.child?.code}</td>
                  <td>{ageInMonths(s.child?.birth_month ?? null, new Date(s.started_at)) ?? "—"}</td>
                  <td>{s.overall_score !== null ? Math.round(s.overall_score) : "—"}</td>
                  <td>
                    <RiskBadge risk={s.risk_level} status={s.status} />
                  </td>
                  <td className={rs.muted}>
                    {[s.level1_score, s.level2_score, s.level3_score].map((v) => (v === null ? "—" : Math.round(v))).join(" / ")}
                  </td>
                  <td>{s.quality_score !== null ? Math.round(s.quality_score) : "—"}</td>
                  <td>
                    <Link href={`/r/sessions/${s.id}`}>ดู / View →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {sessions && shown.length === 0 && <p className={rs.muted}>ไม่มีข้อมูล / Nothing to show.</p>}
      </div>
    </div>
  );
}
