"use client";

/** Age comparison tab (all plans): per age band summaries and one session's percentile within its band. */

import { useMemo, useState } from "react";
import styles from "@/styles/shared.module.css";
import rs from "@/styles/research.module.css";
import cs from "@/styles/research-c.module.css";
import { ageComparison, sessionPercentile } from "@/lib/research/analysis/ageComparison";
import { ANALYSIS_CONFIG } from "@/lib/research/analysis/config";
import { RISKS, SCORE_FIELDS, firstPerChild, sessionAge, type AnalysisSession, type ScoreKey } from "@/lib/research/analysis/sessions";
import { fmt } from "@/lib/research/analysis/stats";
import { BoxPlotChart } from "./Charts";

const NOT_ENOUGH = "ข้อมูลยังไม่พอ / not enough data";

export default function AgeTab({ sessions }: { sessions: AnalysisSession[] }) {
  const [firstOnly, setFirstOnly] = useState(true);
  const [score, setScore] = useState<ScoreKey>("overall_score");
  const [q, setQ] = useState("");
  const [pickedId, setPickedId] = useState<string | null>(null);

  const completed = useMemo(() => sessions.filter((s) => s.status === "completed"), [sessions]);
  const reference = useMemo(() => (firstOnly ? firstPerChild(completed) : completed), [completed, firstOnly]);
  const ac = useMemo(() => ageComparison(reference), [reference]);
  const minN = ANALYSIS_CONFIG.minNAgeBand;

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return completed
      .filter((s) => (s.child?.code ?? "").toLowerCase().includes(t))
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .slice(0, 50);
  }, [q, completed]);
  const picked = completed.find((s) => s.id === pickedId) ?? null;
  // The picked session is compared with the reference sessions, excluding itself.
  const pct = useMemo(() => (picked ? sessionPercentile(picked, reference) : null), [picked, reference]);
  const bandIndex = pct?.band ? ac.bands.findIndex((b) => b.band.key === pct.band!.key) : -1;
  const pickedScore = picked?.[score] ?? null;

  return (
    <>
      <div className={styles.card}>
        <div className={rs.row} style={{ gap: 18 }}>
          <label className={cs.checkbox}>
            <input type="checkbox" checked={firstOnly} onChange={(e) => setFirstOnly(e.target.checked)} />
            ใช้ครั้งแรกของเด็กแต่ละคนเท่านั้น / First session per child only
          </label>
          <span className={rs.muted} style={{ fontSize: 13 }}>
            {reference.length} ครั้งที่สมบูรณ์ / completed sessions
            {ac.outside > 0 && ` · ${ac.outside} อยู่นอกช่วงอายุหรือไม่มีเดือนเกิด / outside the bands or no birth month`}
          </span>
        </div>
        <div className={rs.tableWrap} style={{ marginTop: 12 }}>
          <table className={rs.table}>
            <thead>
              <tr>
                <th>อายุ (เดือน) / Age (m)</th>
                <th className={cs.num}>n</th>
                {SCORE_FIELDS.map((f) => (
                  <th key={f.key} className={cs.num}>
                    {f.th} / {f.en}
                    <div style={{ fontWeight: 400 }}>median [IQR]</div>
                  </th>
                ))}
                <th>ความเสี่ยง / Risk (Low · Mod · High)</th>
              </tr>
            </thead>
            <tbody>
              {ac.bands.map((b) => (
                <tr key={b.band.key} className={b.enough ? undefined : cs.dimRow}>
                  <td>{b.band.key}</td>
                  <td className={cs.num}>{b.n}</td>
                  {b.enough ? (
                    <>
                      {SCORE_FIELDS.map((f) => {
                        const d = b.scores[f.key];
                        return (
                          <td key={f.key} className={cs.num}>
                            {fmt(d.median, 0)} [{fmt(d.q1, 0)}–{fmt(d.q3, 0)}]
                          </td>
                        );
                      })}
                      <td>
                        {RISKS.map((r) => `${b.risk[r]} (${b.n ? Math.round((b.risk[r] / b.n) * 100) : 0}%)`).join(" · ")}
                      </td>
                    </>
                  ) : (
                    <td colSpan={SCORE_FIELDS.length + 1}>{NOT_ENOUGH}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={cs.note}>
          เปรียบเทียบกับข้อมูลของหน่วยงานนี้เท่านั้น ไม่ใช่เกณฑ์มาตรฐาน · Compared with this organization&apos;s own completed
          sessions only; this is not a population norm and not a diagnosis. Bands with fewer than {minN} sessions show “{NOT_ENOUGH}”
          (threshold TBD – tune with pilot data). ไม่ใช้ตัวกรองด้านบน / The filters above do not apply here.
        </p>
      </div>

      <div className={styles.card} style={{ marginTop: 16 }}>
        <h2 className={rs.sectionTitle} style={{ marginTop: 0 }}>
          เทียบเด็กหนึ่งคนกับเด็กวัยเดียวกัน / Compare one session with its age band
        </h2>
        <div className={rs.row}>
          <div className={rs.field}>
            <label htmlFor="age-q">ค้นหารหัส / Find code</label>
            <input id="age-q" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className={rs.field}>
            <label htmlFor="age-score">คะแนน / Score</label>
            <select id="age-score" value={score} onChange={(e) => setScore(e.target.value as ScoreKey)}>
              {SCORE_FIELDS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.th} / {f.en}
                </option>
              ))}
            </select>
          </div>
        </div>
        {matches.length > 0 && (
          <div className={cs.pickList}>
            {matches.map((s) => (
              <button key={s.id} className={s.id === pickedId ? cs.pickItemActive : cs.pickItem} onClick={() => setPickedId(s.id)}>
                {s.child?.code} · {new Date(s.started_at).toLocaleDateString("th-TH")} · {sessionAge(s) ?? "—"} เดือน / m · score{" "}
                {fmt(s.overall_score, 0)}
              </button>
            ))}
          </div>
        )}
        {q.trim() && matches.length === 0 && <p className={rs.muted}>ไม่พบ / No completed session found.</p>}

        {picked && pct && (
          <div style={{ marginTop: 14 }}>
            {!pct.band ? (
              <p className={rs.muted}>อายุไม่อยู่ในช่วงที่กำหนด / Age outside the configured bands (or birth month missing).</p>
            ) : !pct.enough ? (
              <p>
                <strong>{NOT_ENOUGH}</strong>{" "}
                <span className={rs.muted}>
                  ({pct.referenceN} ครั้งในช่วง {pct.band.key} เดือน / sessions in the {pct.band.key} months band; need {minN})
                </span>
              </p>
            ) : (
              <>
                <p className={rs.muted}>
                  ช่วงอายุ / Band {pct.band.key} เดือน / months · เทียบกับ / compared with {pct.referenceN} ครั้ง / sessions
                </p>
                <div className={rs.checkGrid}>
                  {SCORE_FIELDS.map((f) => (
                    <div key={f.key} className={rs.checkItem}>
                      <div className={rs.muted} style={{ fontSize: 13 }}>
                        {f.th} / {f.en}
                      </div>
                      <div style={{ fontSize: 22, fontWeight: 700 }}>
                        {pct.percentiles[f.key] === null ? "—" : `P${Math.round(pct.percentiles[f.key]!)}`}
                      </div>
                      <div className={rs.muted} style={{ fontSize: 12 }}>
                        คะแนน / score {fmt(picked[f.key], 0)}
                      </div>
                    </div>
                  ))}
                </div>
                <p className={cs.note}>
                  P50 = อยู่กลางกลุ่ม / in the middle of the band. เปอร์เซ็นไทล์ = ร้อยละของครั้งในช่วงอายุที่คะแนนต่ำกว่า (นับเท่ากันครึ่งหนึ่ง)
                  / Percentile = % of the band&apos;s sessions with a lower score (ties count half).
                </p>
              </>
            )}
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <BoxPlotChart
            title={`${SCORE_FIELDS.find((f) => f.key === score)!.en} — by age band`}
            rows={ac.bands.map((b) => ({ label: `${b.band.key} m (n=${b.n})`, ...b.scores[score], dim: !b.enough }))}
            marker={
              picked && pct?.enough && bandIndex >= 0 && pickedScore !== null
                ? { row: bandIndex, value: pickedScore, label: `${picked.child?.code}: ${pickedScore.toFixed(0)}` }
                : null
            }
          />
        </div>
      </div>
    </>
  );
}
