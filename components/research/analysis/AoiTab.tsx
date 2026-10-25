"use client";

/** Areas of interest tab: AOI set editor (aoi_sets table) and per-AOI gaze metrics with CSV export. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "@/styles/shared.module.css";
import rs from "@/styles/research.module.css";
import cs from "@/styles/research-c.module.css";
import type { AoiBox } from "@/lib/research/contracts";
import { friendlyError, getSupabase } from "@/lib/research/supabase/client";
import {
  LEVEL_VIDEO_IDS,
  VIDEO_LABELS,
  sessionAoiMetrics,
  summarizeAoi,
  validateBoxes,
  type AoiSet,
  type Level,
  type SessionAoiRow,
} from "@/lib/research/analysis/aoi";
import { ANALYSIS_CONFIG } from "@/lib/research/analysis/config";
import { fetchGazeMany, type GazeCache } from "@/lib/research/analysis/gazeFetch";
import { aoiCsv, aoiSummaryCsv } from "@/lib/research/analysis/exports";
import { fmt } from "@/lib/research/analysis/stats";
import type { AnalysisSession } from "@/lib/research/analysis/sessions";
import { loggedDownload, today } from "./common";
import AoiEditor from "./AoiEditor";

interface Draft {
  id: string | null;
  name: string;
  level: Level;
  video_id: string;
  boxes: AoiBox[];
}

const newDraft = (level: Level = 2): Draft => ({ id: null, name: "", level, video_id: LEVEL_VIDEO_IDS[level][0], boxes: [] });

export default function AoiTab({
  orgId,
  canEdit,
  isAdmin,
  sessions,
}: {
  orgId: string;
  canEdit: boolean;
  isAdmin: boolean;
  sessions: AnalysisSession[];
}) {
  const [sets, setSets] = useState<AoiSet[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const loadSets = useCallback(async () => {
    const { data, error: err } = await getSupabase()
      .from("aoi_sets")
      .select("id, org_id, level, video_id, name, boxes, created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: true });
    if (err) return setError(friendlyError(err));
    setSets((data ?? []) as AoiSet[]);
  }, [orgId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data load; state is set after the request resolves
    void loadSets();
  }, [loadSets]);

  async function save() {
    if (!draft) return;
    setError(null);
    setMsg(null);
    const boxes = draft.boxes.map((b) => ({ ...b, label: b.label.trim() }));
    const errs = validateBoxes(boxes);
    if (!draft.name.trim()) errs.unshift("name");
    if (!boxes.length) errs.unshift("no boxes");
    if (errs.length) {
      setError(`กรุณาตรวจสอบ / Please check: ${errs.join(", ")}`);
      return;
    }
    setSaving(true);
    const sb = getSupabase();
    const row = { name: draft.name.trim(), level: draft.level, video_id: draft.video_id, boxes };
    const res = draft.id
      ? await sb.from("aoi_sets").update(row).eq("id", draft.id).select("id").single()
      : await sb.from("aoi_sets").insert({ ...row, org_id: orgId }).select("id").single();
    setSaving(false);
    if (res.error) return setError(friendlyError(res.error));
    setDraft({ ...draft, id: (res.data as { id: string }).id, boxes });
    setMsg("บันทึกแล้ว / Saved.");
    void loadSets();
  }

  async function remove() {
    if (!draft?.id || !window.confirm("ลบชุดกรอบนี้? / Delete this AOI set?")) return;
    const { error: err } = await getSupabase().from("aoi_sets").delete().eq("id", draft.id);
    if (err) return setError(friendlyError(err));
    setDraft(null);
    void loadSets();
  }

  return (
    <>
      <div className={styles.card}>
        <div className={rs.row}>
          <div className={rs.field}>
            <label htmlFor="aoi-set">ชุดกรอบ / AOI set</label>
            <select
              id="aoi-set"
              value={draft?.id ?? (draft ? "__new" : "")}
              onChange={(e) => {
                setMsg(null);
                setError(null);
                const v = e.target.value;
                if (v === "__new") setDraft(newDraft());
                else {
                  const s = sets?.find((x) => x.id === v);
                  setDraft(s ? { id: s.id, name: s.name, level: s.level, video_id: s.video_id, boxes: s.boxes ?? [] } : null);
                }
              }}
            >
              <option value="">— เลือก / Choose —</option>
              {(sets ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {VIDEO_LABELS[s.video_id] ?? s.video_id}
                </option>
              ))}
              {canEdit && <option value="__new">+ ชุดใหม่ / New set</option>}
            </select>
          </div>
          {draft && (
            <>
              <div className={rs.field}>
                <label htmlFor="aoi-name">ชื่อชุด / Set name</label>
                <input
                  id="aoi-name"
                  value={draft.name}
                  maxLength={120}
                  disabled={!canEdit}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div className={rs.field}>
                <label htmlFor="aoi-video">วิดีโอ / Video</label>
                <select
                  id="aoi-video"
                  value={`${draft.level}:${draft.video_id}`}
                  disabled={!canEdit || (draft.id !== null && draft.boxes.length > 0)}
                  onChange={(e) => {
                    const [lv, vid] = e.target.value.split(":");
                    setDraft({ ...draft, level: Number(lv) as Level, video_id: vid, boxes: [] });
                  }}
                >
                  {([1, 2, 3] as Level[]).flatMap((lv) =>
                    LEVEL_VIDEO_IDS[lv].map((vid) => (
                      <option key={vid} value={`${lv}:${vid}`}>
                        {VIDEO_LABELS[vid]}
                      </option>
                    )),
                  )}
                </select>
              </div>
            </>
          )}
        </div>
        {draft?.level === 1 && (
          <p className={cs.note}>
            แบบทดสอบที่ 1 แสดงสองวิดีโอคู่กัน จึงกำหนดกรอบแยกต่อวิดีโอ แล้วแปลงตำแหน่งตามด้านที่วิดีโอคนอยู่ (humanSide)
            โดยประมาณว่าแต่ละวิดีโอกินพื้นที่ครึ่งหนึ่งของกรอบรวม / Test 1 shows two videos side by side, so boxes are defined
            per video and mapped using the side of the human video (humanSide), assuming each video fills half of the combined
            area. This ignores the gap between the videos, so boxes near the middle are approximate.
          </p>
        )}
        {draft && (
          <div style={{ marginTop: 14 }}>
            <AoiEditor
              videoId={draft.video_id}
              boxes={draft.boxes}
              onChange={(boxes) => setDraft({ ...draft, boxes })}
              readOnly={!canEdit}
            />
            {canEdit && (
              <div className={styles.saveRow} style={{ marginTop: 12 }}>
                <button className={styles.primaryButton} onClick={save} disabled={saving}>
                  {saving ? "…" : "บันทึกชุดกรอบ / Save set"}
                </button>
                {draft.id && (
                  <button className={styles.dangerButton} onClick={remove}>
                    ลบชุด / Delete set
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {msg && <p className={styles.successText}>{msg}</p>}
        {error && <p className={styles.errorText}>{error}</p>}
        {sets && sets.length === 0 && !draft && (
          <p className={rs.muted}>
            ยังไม่มีชุดกรอบ{canEdit ? " เลือก “ชุดใหม่” เพื่อเริ่ม" : ""} / No AOI sets yet
            {canEdit ? " — choose “New set” to start." : "."}
          </p>
        )}
      </div>

      {sets && sets.length > 0 && <AoiMetrics orgId={orgId} isAdmin={isAdmin} sets={sets} sessions={sessions} />}
    </>
  );
}

function AoiMetrics({
  orgId,
  isAdmin,
  sets,
  sessions,
}: {
  orgId: string;
  isAdmin: boolean;
  sets: AoiSet[];
  sessions: AnalysisSession[];
}) {
  const [setId, setSetId] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ setId: string; rows: SessionAoiRow[]; missing: number; failed: number } | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cache = useRef<GazeCache>(new Map());
  const cancel = useRef<{ cancelled: boolean } | null>(null);
  const chosen = sets.find((s) => s.id === setId) ?? null;

  useEffect(() => () => {
    if (cancel.current) cancel.current.cancelled = true;
  }, []);

  async function compute() {
    if (!chosen) return;
    const list = sessions;
    if (!list.length) return;
    if (
      list.length > ANALYSIS_CONFIG.gazeDownloadConfirm &&
      !window.confirm(`${list.length} ครั้ง อาจใช้เวลานาน ดำเนินการต่อ? / ${list.length} sessions — this may take a while. Continue?`)
    )
      return;
    setError(null);
    setResult(null);
    const signal = { cancelled: false };
    cancel.current = signal;
    const sb = getSupabase();
    const { rows, failed, cancelled } = await fetchGazeMany(
      list.map((s) => s.id),
      async (id) => {
        const { data, error: err } = await sb.storage.from("gaze").download(`${orgId}/${id}.csv`);
        if (err || !data) return null;
        return data.text();
      },
      cache.current,
      { concurrency: 4, signal, onProgress: (done, total) => setProgress({ done, total }) },
    );
    cancel.current = null;
    setProgress(null);
    if (cancelled) {
      setError("ยกเลิกแล้ว / Cancelled.");
      return;
    }
    let missing = 0;
    const out: SessionAoiRow[] = [];
    for (const s of list) {
      const g = rows.get(s.id);
      if (!g) {
        if (g === null) missing++;
        continue;
      }
      out.push(
        ...sessionAoiMetrics(chosen, { id: s.id, childCode: s.child?.code ?? "", humanSide: s.results?.test1?.humanSide ?? null }, g),
      );
    }
    setResult({ setId: chosen.id, rows: out, missing, failed: failed.length });
  }

  const summary = useMemo(() => (result ? summarizeAoi(result.rows) : []), [result]);
  const resultSet = sets.find((s) => s.id === result?.setId);

  async function exportCsv(kind: "summary" | "detail") {
    if (!result || !resultSet) return;
    setError(null);
    try {
      const name = `lookatme-aoi-${kind}-${today()}.csv`;
      const text = kind === "summary" ? aoiSummaryCsv(summary) : aoiCsv(result.rows);
      await loggedDownload(orgId, `aoi ${kind}: ${resultSet.name} (${new Set(result.rows.map((r) => r.sessionId)).size} sessions)`, name, text);
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  return (
    <div className={styles.card} style={{ marginTop: 16 }}>
      <h2 className={rs.sectionTitle} style={{ marginTop: 0 }}>
        ค่าการมองต่อกรอบ / AOI metrics
      </h2>
      <div className={rs.row}>
        <div className={rs.field}>
          <label htmlFor="aoi-m-set">ชุดกรอบ / AOI set</label>
          <select id="aoi-m-set" value={setId} onChange={(e) => setSetId(e.target.value)}>
            <option value="">— เลือก / Choose —</option>
            {sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {VIDEO_LABELS[s.video_id] ?? s.video_id}
              </option>
            ))}
          </select>
        </div>
        <button className={styles.primaryButton} onClick={compute} disabled={!chosen || !!progress || !sessions.length}>
          คำนวณ {sessions.length} ครั้ง / Compute for {sessions.length} sessions
        </button>
        {progress && (
          <button className={styles.secondaryButton} onClick={() => cancel.current && (cancel.current.cancelled = true)}>
            ยกเลิก / Cancel
          </button>
        )}
      </div>
      <p className={cs.note}>ใช้ครั้งที่ผ่านตัวกรองด้านบน / Uses the sessions selected by the filters above.</p>
      {progress && (
        <>
          <div className={cs.progress}>
            <div className={cs.progressBar} style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
          </div>
          <span className={rs.muted} style={{ fontSize: 13 }}>
            กำลังโหลดไฟล์การมอง / Loading gaze files {progress.done} / {progress.total}
          </span>
        </>
      )}

      {result && resultSet && (
        <>
          <div className={rs.tableWrap} style={{ marginTop: 14 }}>
            <table className={rs.table}>
              <thead>
                <tr>
                  <th>กรอบ / AOI</th>
                  <th className={cs.num}>n</th>
                  <th className={cs.num}>% ในกรอบ / % inside</th>
                  <th className={cs.num}>เวลามอง / Dwell (ms)</th>
                  <th className={cs.num}>มองครั้งแรก / First look (ms, median)</th>
                  <th className={cs.num}>เคยมอง / Looked (%)</th>
                  <th className={cs.num}>จำนวนครั้ง / Visits</th>
                  <th className={cs.num}>นานต่อครั้ง / Visit (ms)</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((a) => {
                  const box = resultSet.boxes.find((b) => b.label === a.label);
                  return (
                    <tr key={a.label}>
                      <td>
                        {a.label}
                        {box && (box.tStartS !== undefined || box.tEndS !== undefined) && (
                          <div className={rs.muted} style={{ fontSize: 12 }}>
                            {box.tStartS ?? 0}–{box.tEndS ?? "end"} s
                          </div>
                        )}
                      </td>
                      <td className={cs.num}>{a.sessions}</td>
                      <td className={cs.num}>{fmt(a.meanPctInside)}</td>
                      <td className={cs.num}>{fmt(a.meanDwellMs, 0)}</td>
                      <td className={cs.num}>{fmt(a.medianTtflMs, 0)}</td>
                      <td className={cs.num}>{fmt(a.lookedPct, 0)}</td>
                      <td className={cs.num}>{fmt(a.meanVisits)}</td>
                      <td className={cs.num}>{fmt(a.meanVisitMs, 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className={cs.note}>
            ค่าเฉลี่ยข้ามครั้ง (เวลามองครั้งแรกใช้มัธยฐานของครั้งที่เคยมอง) · Means across sessions; first look is the median of
            sessions that looked, from the level start or from the start of the box&apos;s time window. % inside = valid gaze
            samples (face found, position known) inside the box ÷ all valid samples in the window.
            {result.missing > 0 && ` ${result.missing} ครั้งไม่มีไฟล์การมอง / sessions had no gaze file.`}
            {result.failed > 0 && ` ${result.failed} ครั้งโหลดไม่สำเร็จ / failed to load.`}
            {(() => {
              const skipped = new Set(result.rows.filter((r) => r.skipped).map((r) => r.sessionId)).size;
              return skipped > 0 ? ` ${skipped} ครั้งไม่มีพิกัดการมองในระดับนี้ / sessions had no gaze positions for this level.` : "";
            })()}
          </p>
          <div className={styles.saveRow} style={{ marginTop: 12 }}>
            <button className={styles.secondaryButton} onClick={() => setShowDetail((v) => !v)}>
              {showDetail ? "ซ่อนรายครั้ง / Hide per session" : "ดูรายครั้ง / Show per session"}
            </button>
            {isAdmin && (
              <>
                <button className={styles.primaryButton} onClick={() => exportCsv("summary")}>
                  ส่งออกสรุป (CSV) / Export summary
                </button>
                <button className={styles.primaryButton} onClick={() => exportCsv("detail")}>
                  ส่งออกรายครั้ง (CSV) / Export per session
                </button>
              </>
            )}
          </div>
          {showDetail && (
            <div className={rs.tableWrap} style={{ marginTop: 12 }}>
              <table className={`${rs.table} ${cs.small}`}>
                <thead>
                  <tr>
                    <th>รหัส / Code</th>
                    <th>กรอบ / AOI</th>
                    <th className={cs.num}>valid</th>
                    <th className={cs.num}>% inside</th>
                    <th className={cs.num}>dwell ms</th>
                    <th className={cs.num}>first look ms</th>
                    <th className={cs.num}>visits</th>
                    <th className={cs.num}>visit ms</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={`${r.sessionId}-${r.label}`} className={r.skipped ? cs.dimRow : undefined}>
                      <td>{r.childCode}</td>
                      <td>{r.label}</td>
                      <td className={cs.num}>{r.skipped ? r.skipped : r.validSamples}</td>
                      <td className={cs.num}>{fmt(r.pctInside)}</td>
                      <td className={cs.num}>{fmt(r.dwellMs, 0)}</td>
                      <td className={cs.num}>{fmt(r.ttflMs, 0)}</td>
                      <td className={cs.num}>{r.visits}</td>
                      <td className={cs.num}>{fmt(r.meanVisitMs, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {error && <p className={styles.errorText}>{error}</p>}
    </div>
  );
}
