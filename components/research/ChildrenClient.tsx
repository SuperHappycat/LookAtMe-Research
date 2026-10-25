"use client";

/** /r — children of the active organization (coded IDs only) and "add child". */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import styles from "@/styles/shared.module.css";
import rs from "@/styles/research.module.css";
import { friendlyError, getSupabase } from "@/lib/research/supabase/client";
import { ageInMonths } from "@/lib/research/screening";
import { canWrite, useResearch } from "./ResearchShell";
import RiskBadge from "./RiskBadge";

interface ChildRow {
  id: string;
  code: string;
  birth_month: string | null;
  sex: string | null;
  created_at: string;
}
interface SessionLite {
  child_id: string;
  started_at: string;
  status: string;
  risk_level: string | null;
}

export default function ChildrenClient() {
  const { active } = useResearch();
  const orgId = active?.org.id;
  const [children, setChildren] = useState<ChildRow[] | null>(null);
  const [consented, setConsented] = useState<Set<string>>(new Set());
  const [lastSession, setLastSession] = useState<Map<string, SessionLite>>(new Map());
  const [query, setQuery] = useState("");
  const [code, setCode] = useState("");
  const [birthMonth, setBirthMonth] = useState("");
  const [sex, setSex] = useState("U");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    const sb = getSupabase();
    const [c, k, s] = await Promise.all([
      sb.from("children").select("id, code, birth_month, sex, created_at").eq("org_id", orgId).order("code"),
      sb.from("consents").select("child_id").eq("org_id", orgId).is("withdrawn_at", null),
      sb
        .from("sessions")
        .select("child_id, started_at, status, risk_level")
        .eq("org_id", orgId)
        .order("started_at", { ascending: false })
        .limit(2000),
    ]);
    if (c.error) return setError(friendlyError(c.error));
    setChildren(c.data);
    setConsented(new Set((k.data ?? []).map((r) => r.child_id)));
    const m = new Map<string, SessionLite>();
    for (const r of s.data ?? []) if (!m.has(r.child_id)) m.set(r.child_id, r);
    setLastSession(m);
  }, [orgId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data load; state is set after the request resolves
    void load();
  }, [load]);

  const shown = useMemo(
    () => (children ?? []).filter((c) => c.code.toLowerCase().includes(query.trim().toLowerCase())),
    [children, query],
  );

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { error: err } = await getSupabase()
      .from("children")
      .insert({
        org_id: orgId,
        code: code.trim(),
        birth_month: birthMonth ? `${birthMonth}-01` : null,
        sex,
      });
    if (err) return setError(friendlyError(err));
    setCode("");
    setBirthMonth("");
    setSex("U");
    void load();
  }

  return (
    <div className={rs.wide}>
      <h1 className={styles.title}>เด็ก / Children</h1>
      <p className={rs.muted} style={{ marginTop: -8 }}>
        ใช้รหัสเท่านั้น ห้ามใส่ชื่อจริง / Use codes only — never real names. Keep your own list that links codes to names.
      </p>

      {canWrite(active) && (
        <form className={styles.card} onSubmit={add}>
          <div className={rs.row}>
            <div className={rs.field}>
              <label htmlFor="c-code">รหัสเด็ก / Child code</label>
              <input
                id="c-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="เช่น / e.g. CMU-0042"
                maxLength={40}
                required
              />
            </div>
            <div className={rs.field}>
              <label htmlFor="c-bm">เดือนปีเกิด / Birth month</label>
              <input id="c-bm" type="month" value={birthMonth} onChange={(e) => setBirthMonth(e.target.value)} />
            </div>
            <div className={rs.field}>
              <label htmlFor="c-sex">เพศ / Sex</label>
              <select id="c-sex" value={sex} onChange={(e) => setSex(e.target.value)}>
                <option value="M">ชาย / Male</option>
                <option value="F">หญิง / Female</option>
                <option value="U">ไม่ระบุ / Not stated</option>
              </select>
            </div>
            <button className={styles.primaryButton} type="submit">
              เพิ่ม / Add
            </button>
          </div>
          {error && <p className={styles.errorText}>{error}</p>}
        </form>
      )}

      <div className={styles.card} style={{ marginTop: 16 }}>
        <div className={rs.row} style={{ marginBottom: 8 }}>
          <div className={rs.field} style={{ flex: "1 1 240px" }}>
            <label htmlFor="c-q">ค้นหารหัส / Search code</label>
            <input id="c-q" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <span className={rs.muted}>{children ? `${shown.length} / ${children.length}` : "…"}</span>
        </div>
        <div className={rs.tableWrap}>
          <table className={rs.table}>
            <thead>
              <tr>
                <th>รหัส / Code</th>
                <th>อายุ (เดือน) / Age (months)</th>
                <th>เพศ / Sex</th>
                <th>ใบยินยอม / Consent</th>
                <th>คัดกรองล่าสุด / Last screening</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => {
                const last = lastSession.get(c.id);
                return (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.code}</strong>
                    </td>
                    <td>{ageInMonths(c.birth_month) ?? "—"}</td>
                    <td>{c.sex ?? "—"}</td>
                    <td>{consented.has(c.id) ? "✓" : <span className={rs.muted}>ยังไม่มี / none</span>}</td>
                    <td>
                      {last ? (
                        <>
                          {last.started_at.slice(0, 10)} <RiskBadge risk={last.risk_level} status={last.status} />
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <Link href={`/r/children/${c.id}`}>เปิด / Open →</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {children && children.length === 0 && <p className={rs.muted}>ยังไม่มีเด็ก / No children yet.</p>}
      </div>
    </div>
  );
}
