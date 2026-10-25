"use client";

/**
 * Tag the active organization's own sessions to a study (admin/staff of an active site).
 * Sessions are read with the user's own access (RLS), so only this org's sessions ever appear.
 * Changes go through the set_sessions_study RPC, which checks role and site status again.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "@/styles/shared.module.css";
import rs from "@/styles/research.module.css";
import ds from "@/styles/research-d.module.css";
import { friendlyError, getSupabase } from "@/lib/research/supabase/client";
import { studyErrorText } from "@/lib/research/studies/messages";
import RiskBadge from "../RiskBadge";

interface Row {
  id: string;
  started_at: string;
  status: string;
  risk_level: string | null;
  study_id: string | null;
  child: { code: string } | null;
}

const BATCH = 500;

export default function SessionTagger({ studyId, orgId, onChanged }: { studyId: string; orgId: string; onChanged: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [codes, setCodes] = useState("");
  const [only, setOnly] = useState<"all" | "untagged" | "this">("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    let q = getSupabase()
      .from("sessions")
      .select("id, started_at, status, risk_level, study_id, child:children(code)")
      .eq("org_id", orgId)
      .order("started_at", { ascending: false })
      .limit(1000);
    if (from) q = q.gte("started_at", `${from}T00:00:00`);
    if (to) q = q.lte("started_at", `${to}T23:59:59.999`);
    const { data, error } = await q;
    if (error) return setMsg({ ok: false, text: friendlyError(error) });
    setRows((data ?? []) as unknown as Row[]);
    setPicked(new Set());
  }, [orgId, from, to]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data load; state is set after the request resolves
    void load();
  }, [load]);

  const codeList = useMemo(
    () =>
      codes
        .split(/[\s,;]+/)
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean),
    [codes],
  );

  const shown = useMemo(
    () =>
      (rows ?? []).filter((r) => {
        if (codeList.length && !codeList.includes((r.child?.code ?? "").toLowerCase())) return false;
        if (only === "untagged" && r.study_id) return false;
        if (only === "this" && r.study_id !== studyId) return false;
        return true;
      }),
    [rows, codeList, only, studyId],
  );

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function apply(target: string | null) {
    const ids = [...picked];
    if (!ids.length) return;
    const moving = (rows ?? []).filter((r) => picked.has(r.id) && r.study_id && r.study_id !== studyId).length;
    if (target && moving && !window.confirm(`${moving} รายการอยู่ในโครงการอื่น ย้ายมาโครงการนี้? / ${moving} are in another study. Move them here?`)) {
      return;
    }
    setBusy(true);
    setMsg(null);
    let done = 0;
    for (let i = 0; i < ids.length; i += BATCH) {
      const { data, error } = await getSupabase().rpc("set_sessions_study", {
        p_sessions: ids.slice(i, i + BATCH),
        p_study: target,
      });
      if (error) {
        setBusy(false);
        setMsg({ ok: false, text: studyErrorText(error) });
        void load();
        return;
      }
      done += Number(data ?? 0);
    }
    setBusy(false);
    setMsg({
      ok: true,
      text: target ? `เพิ่ม ${done} รายการ / Added ${done} sessions.` : `นำออก ${done} รายการ / Removed ${done} sessions.`,
    });
    void load();
    onChanged();
  }

  const allShownPicked = shown.length > 0 && shown.every((r) => picked.has(r.id));

  return (
    <div className={styles.card}>
      <h2 className={rs.sectionTitle}>ผูกการคัดกรองกับโครงการ / Tag this site&apos;s sessions</h2>
      <p className={ds.note}>
        เลือกการคัดกรองขององค์กรนี้ตามช่วงวันที่หรือรหัสเด็ก แล้วเพิ่มหรือนำออกจากโครงการ / Pick this organization&apos;s
        sessions by date range or child codes, then add them to or remove them from the study.
      </p>
      <div className={rs.row} style={{ margin: "10px 0" }}>
        <label className={rs.field}>
          ตั้งแต่ / From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className={rs.field}>
          ถึง / To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className={rs.field} style={{ flex: "1 1 220px" }}>
          รหัสเด็ก (คั่นด้วย , หรือเว้นวรรค) / Child codes
          <input value={codes} placeholder="A-001, A-002" onChange={(e) => setCodes(e.target.value)} />
        </label>
        <label className={rs.field}>
          แสดง / Show
          <select value={only} onChange={(e) => setOnly(e.target.value as typeof only)}>
            <option value="all">ทั้งหมด / All</option>
            <option value="untagged">ยังไม่อยู่ในโครงการ / Not in a study</option>
            <option value="this">อยู่ในโครงการนี้ / In this study</option>
          </select>
        </label>
      </div>
      <div className={ds.toolbar}>
        <button
          type="button"
          className={ds.smallButton}
          disabled={!shown.length}
          onClick={() => setPicked(allShownPicked ? new Set() : new Set(shown.map((r) => r.id)))}
        >
          {allShownPicked ? "ไม่เลือกทั้งหมด / Clear" : `เลือกที่แสดง / Select shown (${shown.length})`}
        </button>
        <button type="button" className={styles.primaryButton} disabled={busy || !picked.size} onClick={() => apply(studyId)}>
          เพิ่มเข้าโครงการ / Add {picked.size || ""}
        </button>
        <button type="button" className={styles.secondaryButton} disabled={busy || !picked.size} onClick={() => apply(null)}>
          นำออก / Remove {picked.size || ""}
        </button>
        {msg && <span className={msg.ok ? styles.successText : styles.errorText}>{msg.text}</span>}
      </div>
      {rows === null ? (
        <p className={rs.muted}>กำลังโหลด… / Loading…</p>
      ) : (
        <div className={rs.tableWrap} style={{ maxHeight: 420, overflowY: "auto" }}>
          <table className={rs.table}>
            <thead>
              <tr>
                <th />
                <th>วันที่ / Date</th>
                <th>รหัสเด็ก / Child</th>
                <th>ผล / Result</th>
                <th>โครงการ / Study</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`select ${r.child?.code ?? ""} ${r.started_at.slice(0, 10)}`}
                      checked={picked.has(r.id)}
                      onChange={() => toggle(r.id)}
                    />
                  </td>
                  <td>{r.started_at.slice(0, 16).replace("T", " ")}</td>
                  <td>{r.child?.code ?? "—"}</td>
                  <td>
                    <RiskBadge risk={r.risk_level} status={r.status} />
                  </td>
                  <td>
                    {r.study_id === studyId ? (
                      <span className={`${rs.badge} ${ds.badgeLead}`}>โครงการนี้ / This study</span>
                    ) : r.study_id ? (
                      <span className={`${rs.badge} ${rs.badgeMuted}`}>โครงการอื่น / Other study</span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
              {!shown.length && (
                <tr>
                  <td colSpan={5} className={rs.muted}>
                    ไม่พบการคัดกรอง / No sessions match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
