"use client";

/**
 * /r/stats — ★ diagnosis follow-up statistics (spec §5.2, hospital plan), org admins only.
 * Each child's FIRST completed (non-invalid) session against the most recent diagnosis: 2×2 table,
 * sensitivity / specificity / PPV / NPV with 95% Wilson intervals, CSV export. Also the blind-mode switch.
 * Maths: lib/research/stats.ts. Minimum n: lib/research/followup/config.ts (TBD – tune with pilot data).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "@/styles/shared.module.css";
import rs from "@/styles/research.module.css";
import b from "@/styles/research-b.module.css";
import { friendlyError, getSupabase } from "@/lib/research/supabase/client";
import { planHas } from "@/lib/research/plans";
import { downloadText } from "@/lib/research/exportCsv";
import { DIAGNOSIS_LABELS, FOLLOWUP_CONFIG } from "@/lib/research/followup/config";
import {
  buildFollowup,
  codedRowsCsv,
  metrics,
  POSITIVE_LABELS,
  twoByTwoCsv,
  type Metric,
  type PositiveDef,
  type StatsChild,
  type StatsDiagnosis,
  type StatsSession,
} from "@/lib/research/stats";
import { useResearch } from "./ResearchShell";

const PAGE = 1000;

/** Reads every row of a query in pages (PostgREST returns at most ~1000 rows per request). */
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

const EXCLUSION_LABELS: Record<string, string> = {
  other_or_pending: "วินิจฉัยอื่นหรือรอผล / Other diagnosis or pending",
  no_completed_session: "ไม่มีการคัดกรองที่สมบูรณ์ / No completed screening",
  no_risk_result: "ไม่มีผลความเสี่ยง / No risk result",
  no_diagnosis: "ยังไม่มีผลวินิจฉัย / No diagnosis yet",
};

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

function MetricTile({ name, hint, m }: { name: string; hint: string; m: Metric }) {
  return (
    <div className={b.metricTile}>
      <div className={b.metricName}>{name}</div>
      {m.enough && m.ci ? (
        <>
          <div className={b.metricValue}>{pct(m.ci.est)}</div>
          <div className={b.metricCi}>
            95% CI {pct(m.ci.lo)} – {pct(m.ci.hi)}
          </div>
        </>
      ) : (
        <div className={b.notEnough}>ข้อมูลยังไม่พอ / Not enough data</div>
      )}
      <div className={b.metricCi}>
        {hint} = {m.x} / {m.n}
        {!m.enough && ` (ต้องการอย่างน้อย / needs ≥ ${FOLLOWUP_CONFIG.minNForStats})`}
      </div>
    </div>
  );
}

function BlindToggle({ orgId }: { orgId: string }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    getSupabase()
      .from("organizations")
      .select("blind_new_sessions")
      .eq("id", orgId)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (!live) return;
        if (err) setError(friendlyError(err));
        setOn(!!(data as { blind_new_sessions?: boolean } | null)?.blind_new_sessions);
      });
    return () => {
      live = false;
    };
  }, [orgId]);

  async function toggle() {
    if (on === null) return;
    setBusy(true);
    setError(null);
    const { data, error: err } = await getSupabase().rpc("set_org_blind", { p_org: orgId, p_on: !on });
    setBusy(false);
    if (err) return setError(friendlyError(err));
    setOn(!!data);
  }

  return (
    <div className={styles.card}>
      <div className={b.toggleRow}>
        <div>
          <strong>โหมดปกปิดผล (Blind mode)</strong>{" "}
          {on !== null && <span className={b.blindNote}>{on ? "เปิด / On" : "ปิด / Off"}</span>}
          <p className={rs.muted} style={{ margin: "6px 0 0" }}>
            เมื่อเปิด การคัดกรองใหม่จะซ่อนผลจากเจ้าหน้าที่และผู้ดู เห็นได้เฉพาะผู้ดูแล (การคัดกรองเดิมไม่เปลี่ยน) · When on, new
            screenings hide their result from staff and viewers; only admins can see them. Earlier screenings don&apos;t change.
          </p>
        </div>
        <button className={on ? styles.secondaryButton : styles.primaryButton} disabled={on === null || busy} onClick={toggle}>
          {busy ? "…" : on ? "ปิดโหมดปกปิดผล / Turn off" : "เปิดโหมดปกปิดผล / Turn on"}
        </button>
      </div>
      {error && <p className={styles.errorText}>{error}</p>}
    </div>
  );
}

export default function StatsClient() {
  const { active } = useResearch();
  const orgId = active?.org.id ?? "";
  const isAdmin = active?.role === "admin";
  const hasFeature = !!active && planHas(active.org.plan, "diagnosis_follow_up");
  const [data, setData] = useState<{ children: StatsChild[]; sessions: StatsSession[]; diagnoses: StatsDiagnosis[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [def, setDef] = useState<PositiveDef>(FOLLOWUP_CONFIG.defaultPositive);
  const [showRows, setShowRows] = useState(false);
  const logged = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setData(null);
    setError(null);
    try {
      const sb = getSupabase();
      const [children, sessions, diagnoses] = await Promise.all([
        fetchAll<StatsChild>((f, t) => sb.from("children").select("id, code").eq("org_id", orgId).order("id").range(f, t)),
        fetchAll<StatsSession>((f, t) =>
          sb
            .from("sessions")
            .select("id, child_id, started_at, status, risk_level, overall_score")
            .eq("org_id", orgId)
            .eq("status", "completed")
            .order("id")
            .range(f, t),
        ),
        fetchAll<StatsDiagnosis>((f, t) =>
          sb.from("diagnoses").select("child_id, result, diagnosed_on, created_at").eq("org_id", orgId).order("id").range(f, t),
        ),
      ]);
      setData({ children, sessions, diagnoses });
    } catch (err) {
      setError(friendlyError(err));
    }
  }, [orgId]);

  useEffect(() => {
    if (!isAdmin || !hasFeature) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data load; state is set after the request resolves
    void load();
    if (logged.current !== orgId) {
      logged.current = orgId;
      void getSupabase().rpc("log_action", { p_org: orgId, p_action: "view_stats", p_target: "stats" });
    }
  }, [isAdmin, hasFeature, orgId, load]);

  const res = useMemo(() => (data ? buildFollowup(data.children, data.sessions, data.diagnoses, def) : null), [data, def]);
  const m = useMemo(() => (res ? metrics(res.table) : null), [res]);

  if (!hasFeature) {
    return (
      <div className={rs.wide}>
        <div className={styles.card}>
          ฟังก์ชันนี้มีในแผนโรงพยาบาล / Diagnosis follow-up is part of the Hospital plan.
        </div>
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className={rs.wide}>
        <h1 className={styles.title}>ความแม่นยำ / Accuracy</h1>
        <div className={styles.card}>
          หน้านี้สำหรับผู้ดูแลองค์กรเท่านั้น / This page is for organization admins only. เจ้าหน้าที่บันทึกผลวินิจฉัยได้ที่หน้าของเด็กแต่ละคน
          / Staff can record diagnoses on each child&apos;s page.
        </div>
      </div>
    );
  }

  async function exportCsv(kind: "table" | "rows") {
    if (!res) return;
    const day = new Date().toISOString().slice(0, 10);
    if (kind === "table") downloadText(`lookatme-accuracy-2x2-${def}-${day}.csv`, twoByTwoCsv(res, def));
    else downloadText(`lookatme-accuracy-rows-${def}-${day}.csv`, codedRowsCsv(res.rows));
    await getSupabase().rpc("log_action", {
      p_org: orgId,
      p_action: "export_stats_csv",
      p_target: kind === "table" ? "2x2" : `${res.rows.length} rows`,
    });
  }

  const t = res?.table;
  const excludedTotal = res ? res.excluded.other_or_pending + res.excluded.no_completed_session + res.excluded.no_risk_result : 0;

  return (
    <div className={rs.wide}>
      <h1 className={styles.title}>ความแม่นยำเทียบกับผลวินิจฉัย / Accuracy against diagnosis</h1>
      <p className={rs.muted} style={{ marginTop: -8 }}>
        ใช้การคัดกรองครั้งแรกที่สมบูรณ์ของเด็กแต่ละคน เทียบกับผลวินิจฉัยล่าสุด (ASD / ไม่ใช่ ASD) · Uses each child&apos;s first completed
        screening against their most recent diagnosis (ASD / not ASD). LookAtMe is a screening aid, not a diagnosis.
      </p>
      {error && <p className={styles.errorText}>{error}</p>}

      {planHas(active!.org.plan, "blind_mode") && <BlindToggle orgId={orgId} />}

      <h2 className={rs.sectionTitle}>ตาราง 2×2 / 2×2 table</h2>
      <div className={styles.card}>
        <div className={b.toggleRow}>
          <div className={rs.field}>
            <label htmlFor="posdef">ผลบวกคือ / Screen positive means</label>
            <select id="posdef" value={def} onChange={(e) => setDef(e.target.value as PositiveDef)}>
              {(Object.keys(POSITIVE_LABELS) as PositiveDef[]).map((k) => (
                <option key={k} value={k}>
                  {POSITIVE_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.saveRow}>
            <button className={styles.secondaryButton} disabled={!res} onClick={() => exportCsv("table")}>
              ส่งออกตาราง 2×2 (CSV) / Export 2×2 (CSV)
            </button>
            <button className={styles.secondaryButton} disabled={!res} onClick={() => exportCsv("rows")}>
              ส่งออกข้อมูลรายเด็ก (CSV) / Export coded rows (CSV)
            </button>
          </div>
        </div>

        {!res || !t || !m ? (
          <p>{error ? "" : "กำลังโหลด… / Loading…"}</p>
        ) : (
          <>
            <div className={rs.tableWrap}>
              <table className={b.grid2}>
                <thead>
                  <tr>
                    <th />
                    <th>ASD</th>
                    <th>ไม่ใช่ ASD / Not ASD</th>
                    <th>รวม / Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th>ผลคัดกรองบวก / Screen +</th>
                    <td>
                      <span className={b.cellLabel}>TP</span>
                      <span className={b.cellValue}>{t.tp}</span>
                    </td>
                    <td>
                      <span className={b.cellLabel}>FP</span>
                      <span className={b.cellValue}>{t.fp}</span>
                    </td>
                    <td>{t.tp + t.fp}</td>
                  </tr>
                  <tr>
                    <th>ผลคัดกรองลบ / Screen −</th>
                    <td>
                      <span className={b.cellLabel}>FN</span>
                      <span className={b.cellValue}>{t.fn}</span>
                    </td>
                    <td>
                      <span className={b.cellLabel}>TN</span>
                      <span className={b.cellValue}>{t.tn}</span>
                    </td>
                    <td>{t.fn + t.tn}</td>
                  </tr>
                  <tr>
                    <th>รวม / Total</th>
                    <td>{t.tp + t.fn}</td>
                    <td>{t.fp + t.tn}</td>
                    <td>{t.tp + t.fp + t.fn + t.tn}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className={rs.muted}>
              ไม่นำมาคิด / Excluded: {excludedTotal} คน / children
              {Object.entries(res.excluded)
                .filter(([k, v]) => v > 0 && k !== "no_diagnosis")
                .map(([k, v]) => ` · ${EXCLUSION_LABELS[k]}: ${v}`)
                .join("")}
              <br />
              {EXCLUSION_LABELS.no_diagnosis}: {res.excluded.no_diagnosis} คน / children
            </p>

            <div className={b.metricGrid}>
              <MetricTile name="ความไว / Sensitivity" hint="TP / (TP + FN)" m={m.sensitivity} />
              <MetricTile name="ความจำเพาะ / Specificity" hint="TN / (TN + FP)" m={m.specificity} />
              <MetricTile name="PPV" hint="TP / (TP + FP)" m={m.ppv} />
              <MetricTile name="NPV" hint="TN / (TN + FN)" m={m.npv} />
            </div>
            <p className={rs.muted} style={{ marginBottom: 0 }}>
              ช่วงความเชื่อมั่น 95% แบบ Wilson · 95% Wilson score intervals. แสดงเมื่อตัวหารมีอย่างน้อย {FOLLOWUP_CONFIG.minNForStats} คน
              (ค่านี้ยังต้องปรับด้วยข้อมูลนำร่อง) / Shown when the denominator is at least {FOLLOWUP_CONFIG.minNForStats} (TBD – tune
              with pilot data).
            </p>
          </>
        )}
      </div>

      {res && (
        <>
          <h2 className={rs.sectionTitle}>ข้อมูลรายเด็ก / Coded rows</h2>
          <div className={styles.card}>
            <button className={rs.linkButton} onClick={() => setShowRows(!showRows)}>
              {showRows ? "ซ่อน / Hide" : `แสดง ${res.rows.length} แถว / Show ${res.rows.length} rows`}
            </button>
            {showRows && (
              <div className={rs.tableWrap}>
                <table className={rs.table}>
                  <thead>
                    <tr>
                      <th>รหัส / Code</th>
                      <th>คัดกรองครั้งแรก / First screening</th>
                      <th>ความเสี่ยง / Risk</th>
                      <th>ผลวินิจฉัย / Diagnosis</th>
                      <th>ช่อง / Cell</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.rows.map((r) => (
                      <tr key={r.child_code}>
                        <td>{r.child_code}</td>
                        <td>{r.session_date ? new Date(r.session_date).toLocaleDateString("th-TH") : "—"}</td>
                        <td>{r.risk_level ?? "—"}</td>
                        <td>{r.diagnosis ? DIAGNOSIS_LABELS[r.diagnosis] : "—"}</td>
                        <td>{r.cell ?? (r.exclusion ? <span className={rs.muted}>{EXCLUSION_LABELS[r.exclusion]}</span> : "—")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
