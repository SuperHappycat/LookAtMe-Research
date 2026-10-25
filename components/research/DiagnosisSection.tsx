"use client";

/**
 * components/research/DiagnosisSection.tsx
 * ==========================================
 * ★ Diagnosis follow-up on a child's page (spec §5.2, hospital plan): admin/staff record the final
 * diagnosis later (result + date) and see the history. Records can't be edited (RLS has no update policy),
 * so a correction is a new record; the most recent one counts on the statistics page.
 */

import { useCallback, useEffect, useState } from "react";
import styles from "@/styles/shared.module.css";
import rs from "@/styles/research.module.css";
import { friendlyError, getSupabase } from "@/lib/research/supabase/client";
import { DIAGNOSIS_LABELS, type DiagnosisResult } from "@/lib/research/followup/config";
import { currentDiagnosis } from "@/lib/research/stats";

interface DiagnosisRow {
  id: string;
  result: DiagnosisResult;
  diagnosed_on: string | null;
  created_at: string;
  recorded_by: string | null;
}

export default function DiagnosisSection({ child, userId }: { child: { id: string; org_id: string }; userId: string }) {
  const [rows, setRows] = useState<DiagnosisRow[] | null>(null);
  const [result, setResult] = useState<DiagnosisResult>("asd");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error: err } = await getSupabase()
      .from("diagnoses")
      .select("id, result, diagnosed_on, created_at, recorded_by")
      .eq("child_id", child.id)
      .order("diagnosed_on", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (err) setError(friendlyError(err));
    setRows((data as DiagnosisRow[]) ?? []);
  }, [child.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data load; state is set after the request resolves
    void load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (result !== "pending" && !date) return setError("กรุณาใส่วันที่วินิจฉัย / Please enter the diagnosis date.");
    if (date && date > new Date().toISOString().slice(0, 10))
      return setError("วันที่ต้องไม่เกินวันนี้ / The date can't be in the future.");
    setBusy(true);
    const { error: err } = await getSupabase()
      .from("diagnoses")
      .insert({ org_id: child.org_id, child_id: child.id, result, diagnosed_on: date || null, recorded_by: userId });
    setBusy(false);
    if (err) return setError(friendlyError(err));
    void load();
  }

  const current = rows ? currentDiagnosis(rows) : null;

  return (
    <div className={styles.card}>
      <p className={rs.muted} style={{ marginTop: 0 }}>
        บันทึกผลการวินิจฉัยสุดท้ายจากแพทย์ เพื่อคำนวณความไว/ความจำเพาะ ผลล่าสุดจะถูกใช้ ·{" "}
        Record the clinician&apos;s final diagnosis for the accuracy statistics. The most recent record counts.
      </p>
      {error && <p className={styles.errorText}>{error}</p>}
      {rows === null ? (
        <span className={rs.muted}>…</span>
      ) : rows.length === 0 ? (
        <p className={rs.muted}>ยังไม่มีผลการวินิจฉัย / No diagnosis recorded yet.</p>
      ) : (
        <div className={rs.tableWrap} style={{ marginBottom: 12 }}>
          <table className={rs.table}>
            <thead>
              <tr>
                <th>ผลวินิจฉัย / Diagnosis</th>
                <th>วันที่วินิจฉัย / Diagnosed on</th>
                <th>บันทึกเมื่อ / Recorded</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td>{DIAGNOSIS_LABELS[d.result] ?? d.result}</td>
                  <td>{d.diagnosed_on ?? "—"}</td>
                  <td>{new Date(d.created_at).toLocaleString("th-TH")}</td>
                  <td>{current?.id === d.id && <span className={`${rs.badge} ${rs.badgeMuted}`}>ใช้ผลนี้ / Current</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form className={rs.row} onSubmit={add}>
        <div className={rs.field}>
          <label htmlFor="dx-result">ผลวินิจฉัย / Diagnosis</label>
          <select id="dx-result" value={result} onChange={(e) => setResult(e.target.value as DiagnosisResult)}>
            {(Object.keys(DIAGNOSIS_LABELS) as DiagnosisResult[]).map((k) => (
              <option key={k} value={k}>
                {DIAGNOSIS_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <div className={rs.field}>
          <label htmlFor="dx-date">วันที่วินิจฉัย / Date</label>
          <input id="dx-date" type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} />
        </div>
        <button className={styles.primaryButton} type="submit" disabled={busy}>
          {busy ? "…" : "เพิ่มผลวินิจฉัย / Add diagnosis"}
        </button>
      </form>
    </div>
  );
}
