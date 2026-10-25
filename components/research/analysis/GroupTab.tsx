"use client";

/** Group summary tab (Hospital): compare groups on scores, risk %, retest % and quality, with SVG charts and CSV export. */

import { useMemo, useState } from "react";
import styles from "@/styles/shared.module.css";
import rs from "@/styles/research.module.css";
import cs from "@/styles/research-c.module.css";
import { friendlyError } from "@/lib/research/supabase/client";
import { ANALYSIS_CONFIG } from "@/lib/research/analysis/config";
import { GROUP_BY_LABELS, groupSummary, type GroupBy } from "@/lib/research/analysis/groupSummary";
import { groupSummaryCsv } from "@/lib/research/analysis/exports";
import { SCORE_FIELDS, type AnalysisSession, type ScoreKey } from "@/lib/research/analysis/sessions";
import { fmt, type Describe } from "@/lib/research/analysis/stats";
import { loggedDownload, today } from "./common";
import { MeanBarChart, RiskStackChart } from "./Charts";

const meanSd = (d: Describe) => (d.mean === null ? "—" : `${d.mean.toFixed(1)} ± ${fmt(d.sd)}`);

export default function GroupTab({ orgId, isAdmin, sessions }: { orgId: string; isAdmin: boolean; sessions: AnalysisSession[] }) {
  const [by, setBy] = useState<GroupBy>("age_band");
  const [score, setScore] = useState<ScoreKey>("overall_score");
  const [error, setError] = useState<string | null>(null);
  const { rows, unplaced } = useMemo(() => groupSummary(sessions, by), [sessions, by]);
  const scoreLabel = SCORE_FIELDS.find((f) => f.key === score)!;

  async function exportCsv() {
    setError(null);
    try {
      await loggedDownload(orgId, `group summary by ${by} (${sessions.length} sessions)`, `lookatme-groups-${by}-${today()}.csv`, groupSummaryCsv(by, rows));
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  return (
    <div className={styles.card}>
      <div className={rs.row}>
        <div className={rs.field}>
          <label htmlFor="g-by">จัดกลุ่มตาม / Group by</label>
          <select id="g-by" value={by} onChange={(e) => setBy(e.target.value as GroupBy)}>
            {(Object.keys(GROUP_BY_LABELS) as GroupBy[]).map((k) => (
              <option key={k} value={k}>
                {GROUP_BY_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <div className={rs.field}>
          <label htmlFor="g-score">คะแนนในกราฟ / Chart score</label>
          <select id="g-score" value={score} onChange={(e) => setScore(e.target.value as ScoreKey)}>
            {SCORE_FIELDS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.th} / {f.en}
              </option>
            ))}
          </select>
        </div>
        {isAdmin && (
          <button className={styles.primaryButton} onClick={exportCsv} disabled={!rows.length}>
            ส่งออก (CSV) / Export
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className={rs.muted}>ไม่มีข้อมูล / Nothing to show.</p>
      ) : (
        <>
          <div className={rs.tableWrap} style={{ marginTop: 14 }}>
            <table className={`${rs.table} ${cs.small}`}>
              <thead>
                <tr>
                  <th>กลุ่ม / Group</th>
                  <th className={cs.num}>n</th>
                  {SCORE_FIELDS.map((f) => (
                    <th key={f.key} className={cs.num}>
                      {f.en}
                      <div style={{ fontWeight: 400 }}>mean ± SD · median</div>
                    </th>
                  ))}
                  <th className={cs.num}>Low / Mod / High %</th>
                  <th className={cs.num}>ทดสอบซ้ำ / Retest %</th>
                  <th className={cs.num}>
                    คุณภาพ / Quality
                    <div style={{ fontWeight: 400 }}>mean ± SD</div>
                  </th>
                  <th className={cs.num}>เห็นหน้า / Face %</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((g) => (
                  <tr key={g.key} className={g.enough ? undefined : cs.dimRow}>
                    <td>{g.label}</td>
                    <td className={cs.num}>
                      {g.n}
                      {g.nAll !== g.n && <span className={rs.muted}> ({g.nAll})</span>}
                    </td>
                    {SCORE_FIELDS.map((f) => (
                      <td key={f.key} className={cs.num}>
                        {meanSd(g.scores[f.key])}
                        <div className={rs.muted}>{fmt(g.scores[f.key].median)}</div>
                      </td>
                    ))}
                    <td className={cs.num}>
                      {fmt(g.riskPct.Low, 0)} / {fmt(g.riskPct.Moderate, 0)} / {fmt(g.riskPct.High, 0)}
                    </td>
                    <td className={cs.num}>{fmt(g.retestPct, 0)}</td>
                    <td className={cs.num}>{meanSd(g.quality)}</td>
                    <td className={cs.num}>{fmt(g.faceFound.mean, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={cs.note}>
            n = ครั้งที่สมบูรณ์ (ในวงเล็บ = รวมครั้งที่ต้องทดสอบซ้ำ) / completed sessions (in brackets: including retest sessions,
            when shown by the filter). คะแนนและความเสี่ยงใช้ครั้งที่สมบูรณ์ ส่วนร้อยละทดสอบซ้ำและคุณภาพใช้ทั้งสองแบบ / Scores and risk use
            completed sessions; retest % and quality use completed + retest sessions. แถวสีจาง = น้อยกว่า {ANALYSIS_CONFIG.minNGroup} ครั้ง /
            Faded rows have fewer than {ANALYSIS_CONFIG.minNGroup} sessions (TBD – tune with pilot data).
            {unplaced > 0 && ` ${unplaced} ครั้งจัดกลุ่มไม่ได้ (เช่น ไม่มีเดือนเกิด) / sessions could not be grouped (e.g. no birth month or outside the age bands).`}
            {" "}ไม่ได้ทดสอบนัยสำคัญทางสถิติ / No significance testing is done here — use the SPSS/R export.
          </p>
          <div className={cs.chartGrid}>
            <MeanBarChart
              title={`${scoreLabel.en} (mean ± SD)`}
              rows={rows.map((g) => ({ label: g.label, mean: g.scores[score].mean, sd: g.scores[score].sd, n: g.n, dim: !g.enough }))}
            />
            <RiskStackChart
              title="ความเสี่ยง / Risk distribution"
              rows={rows.map((g) => ({ label: g.label, pct: g.riskPct, n: g.n, dim: !g.enough }))}
            />
          </div>
        </>
      )}
      {error && <p className={styles.errorText}>{error}</p>}
    </div>
  );
}
