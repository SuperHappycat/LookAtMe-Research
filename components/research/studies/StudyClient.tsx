"use client";

/**
 * /r/studies/[id] — one study, as seen by the active organization.
 * Lead: all sites, invite codes, combined summary (aggregates only), coded export (admins).
 * Site: the lead and itself, its own figures, row-sharing switch (admins), leave (admins).
 * Both: tag their own sessions to the study (admin/staff).
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import styles from "@/styles/shared.module.css";
import rs from "@/styles/research.module.css";
import ds from "@/styles/research-d.module.css";
import { apiFetch, getSupabase } from "@/lib/research/supabase/client";
import { downloadText } from "@/lib/research/exportCsv";
import { STUDIES_CONFIG } from "@/lib/research/studies/config";
import { studyErrorText } from "@/lib/research/studies/messages";
import type { StudyDetail, StudySummaryResponse } from "@/lib/research/studies/service";
import { useResearch } from "../ResearchShell";
import { RiskBars, RoleBadge, SummaryTable } from "./StudyBits";
import SessionTagger from "./SessionTagger";

const STATUS: Record<string, string> = {
  active: "ร่วมอยู่ / Active",
  invited: "เชิญแล้ว / Invited",
  left: "ออกแล้ว / Left",
};

export default function StudyClient() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { active } = useResearch();
  const orgId = active?.org.id;
  const role = active?.role;
  const isAdmin = role === "admin";
  const canTag = role === "admin" || role === "staff";
  const [study, setStudy] = useState<StudyDetail | null>(null);
  const [summary, setSummary] = useState<StudySummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadStudy = useCallback(async () => {
    if (!orgId || !id) return;
    const res = await apiFetch(`/api/research/studies/${id}?orgId=${orgId}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.error ?? "Error");
    setError(null);
    setStudy(data.study);
  }, [id, orgId]);

  const loadSummary = useCallback(async () => {
    if (!orgId || !id || !canTag) return;
    const res = await apiFetch(`/api/research/studies/${id}/summary?orgId=${orgId}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setSummaryError(data.error ?? "Error");
    setSummaryError(null);
    setSummary(data.summary);
  }, [id, orgId, canTag]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data load; state is set after the request resolves
    void loadStudy();
  }, [loadStudy]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data load; state is set after the request resolves
    void loadSummary();
  }, [loadSummary]);

  async function rpc(name: string, args: Record<string, unknown>, okText?: string): Promise<unknown> {
    setBusy(name);
    setMsg(null);
    const { data, error: err } = await getSupabase().rpc(name, args);
    setBusy(null);
    if (err) {
      setMsg({ ok: false, text: studyErrorText(err) });
      return undefined;
    }
    if (okText) setMsg({ ok: true, text: okText });
    return data ?? true;
  }

  async function newCode() {
    const c = await rpc("create_study_invite", { p_study: id, p_days: STUDIES_CONFIG.inviteDays });
    if (typeof c === "string") setCode(c);
    void loadStudy();
  }

  async function revoke(inviteId: string) {
    if (await rpc("revoke_study_invite", { p_invite: inviteId }, "ยกเลิกรหัสแล้ว / Code revoked.")) void loadStudy();
  }

  async function removeSite(siteOrg: string, name: string) {
    if (!window.confirm(`นำ ${name} ออกจากโครงการ? / Remove ${name} from the study?`)) return;
    if (await rpc("remove_study_site", { p_study: id, p_org: siteOrg }, "นำสถานที่ออกแล้ว / Site removed.")) {
      void loadStudy();
      void loadSummary();
    }
  }

  async function leave() {
    if (!window.confirm("ออกจากโครงการนี้? ผู้นำจะไม่เห็นข้อมูลขององค์กรนี้อีก / Leave this study? The lead will no longer see this organization's figures.")) return;
    if (await rpc("leave_study", { p_study: id, p_org: orgId })) router.push("/r/studies");
  }

  async function setShare(on: boolean) {
    if (
      on &&
      !window.confirm(
        "ยืนยันว่าองค์กรนี้มีการอนุมัติจริยธรรมและข้อตกลงแบ่งปันข้อมูลกับผู้นำโครงการแล้ว? / Confirm this site has its own ethics approval and a data-sharing agreement with the lead.",
      )
    ) {
      return;
    }
    if (await rpc("set_study_share_row_data", { p_study: id, p_org: orgId, p_share: on }, on ? "เปิดการแบ่งปันแล้ว / Sharing on." : "ปิดการแบ่งปันแล้ว / Sharing off.")) {
      void loadStudy();
    }
  }

  async function exportCsv() {
    setBusy("export");
    setMsg(null);
    const res = await apiFetch(`/api/research/studies/${id}/export?orgId=${orgId}`);
    setBusy(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return setMsg({ ok: false, text: data.error ?? "Error" });
    }
    const text = await res.text();
    const rows = res.headers.get("X-Row-Count") ?? "?";
    const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "study.csv";
    downloadText(name, text);
    setMsg({ ok: true, text: `ส่งออก ${rows} แถว / Exported ${rows} rows.` });
  }

  if (error) {
    return (
      <div className={rs.wide}>
        <div className={styles.card}>
          <p className={styles.errorText}>{error}</p>
          <Link href="/r/studies">← โครงการวิจัย / Studies</Link>
        </div>
      </div>
    );
  }
  if (!study) {
    return (
      <div className={rs.wide}>
        <div className={styles.card}>กำลังโหลด… / Loading…</div>
      </div>
    );
  }

  const lead = study.role === "lead";

  return (
    <div className={rs.wide}>
      <p>
        <Link href="/r/studies" className={rs.muted}>
          ← โครงการวิจัย / Studies
        </Link>
      </p>
      <div className={ds.titleRow}>
        <h1 className={styles.title}>{study.name}</h1>
        <RoleBadge role={study.role} />
      </div>
      <p className={styles.subtitle}>
        ผู้นำโครงการ / Lead: {study.leadName}
        {study.blindDefault ? " · ปกปิดผลเป็นค่าเริ่มต้น / Blind by default" : ""}
      </p>
      {msg && <p className={msg.ok ? styles.successText : styles.errorText}>{msg.text}</p>}

      <div className={ds.stack}>
        <div className={ds.grid2} style={{ marginBottom: 0 }}>
          <div className={styles.card}>
            <h2 className={rs.sectionTitle}>สถานที่ / Sites</h2>
            <div className={rs.tableWrap}>
              <table className={rs.table}>
                <thead>
                  <tr>
                    <th>องค์กร / Organization</th>
                    <th>สถานะ / Status</th>
                    <th>แบ่งปันรายแถว / Row sharing</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {study.sites.map((s) => (
                    <tr key={s.orgId}>
                      <td>
                        {s.name}
                        {s.orgId === study.leadOrgId && <span className={rs.muted}> (ผู้นำ / lead)</span>}
                      </td>
                      <td>{STATUS[s.status] ?? s.status}</td>
                      <td>{s.status === "active" ? (s.shareRowData ? "เปิด / On" : "ปิด / Off") : "—"}</td>
                      <td>
                        {lead && isAdmin && s.orgId !== study.leadOrgId && s.status !== "left" && (
                          <button className={ds.dangerLink} disabled={busy !== null} onClick={() => removeSite(s.orgId, s.name)}>
                            นำออก / Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!lead && <p className={ds.note}>สถานที่ร่วมเห็นเฉพาะผู้นำและตนเอง / Sites see only the lead and themselves.</p>}
            {!lead && isAdmin && (
              <p style={{ marginTop: 10 }}>
                <button className={styles.dangerButton} disabled={busy !== null} onClick={leave}>
                  ออกจากโครงการ / Leave study
                </button>
              </p>
            )}
          </div>

          {lead && isAdmin && (
            <div className={styles.card}>
              <h2 className={rs.sectionTitle}>เชิญสถานที่ / Invite a site</h2>
              <p className={ds.note}>
                สร้างรหัสใช้ครั้งเดียว อายุ {STUDIES_CONFIG.inviteDays} วัน แล้วส่งให้ผู้ดูแลของโรงพยาบาลที่ร่วมโครงการทางช่องทางที่ปลอดภัย
                ระบบเก็บเฉพาะค่าแฮช จึงแสดงรหัสได้ครั้งเดียว / Create a one-time code (valid {STUDIES_CONFIG.inviteDays}{" "}
                days) and send it to the other hospital&apos;s admin over a safe channel. Only a hash is stored, so the code
                is shown once.
              </p>
              {code && (
                <div style={{ margin: "12px 0" }}>
                  <div className={ds.codeBox} aria-live="polite">
                    {code}
                  </div>
                  <div className={ds.toolbar}>
                    <button className={ds.smallButton} onClick={() => navigator.clipboard?.writeText(code)}>
                      คัดลอก / Copy
                    </button>
                    <button className={ds.smallButton} onClick={() => setCode(null)}>
                      ซ่อน / Hide
                    </button>
                  </div>
                </div>
              )}
              <button className={styles.primaryButton} disabled={busy !== null} onClick={newCode}>
                สร้างรหัสเชิญ / New invite code
              </button>
              {!!study.invites?.length && (
                <div className={rs.tableWrap} style={{ marginTop: 12 }}>
                  <table className={rs.table}>
                    <thead>
                      <tr>
                        <th>สร้าง / Created</th>
                        <th>หมดอายุ / Expires</th>
                        <th>สถานะ / Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {study.invites.map((i) => {
                        const expired = i.expired;
                        return (
                          <tr key={i.id}>
                            <td>{i.createdAt.slice(0, 10)}</td>
                            <td>{i.expiresAt.slice(0, 10)}</td>
                            <td>
                              {i.usedAt
                                ? `ใช้แล้ว / Used by ${i.usedBy ?? "—"}`
                                : expired
                                  ? "หมดอายุ / Expired"
                                  : "ยังไม่ใช้ / Unused"}
                            </td>
                            <td>
                              {!i.usedAt && !expired && (
                                <button className={ds.dangerLink} disabled={busy !== null} onClick={() => revoke(i.id)}>
                                  ยกเลิก / Revoke
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {isAdmin && (
            <div className={styles.card}>
              <h2 className={rs.sectionTitle}>แบ่งปันข้อมูลรายแถว / Row-level data sharing</h2>
              <label className={ds.toggle}>
                <input
                  type="checkbox"
                  checked={study.myShareRowData}
                  disabled={busy !== null}
                  onChange={(e) => setShare(e.target.checked)}
                />
                <span>
                  อนุญาตให้ผู้นำโครงการส่งออกข้อมูลรายแถวแบบรหัสแฝงของ {active?.org.name} / Let the lead export coded rows
                  of {active?.org.name}
                </span>
              </label>
              <SharingNotice />
            </div>
          )}
        </div>

        {canTag && (
          <div className={styles.card}>
            <h2 className={rs.sectionTitle}>
              {lead ? "สรุปรวมทุกสถานที่ / Combined summary" : "ตัวเลขของสถานที่นี้ / This site's figures"}
            </h2>
            <p className={ds.note}>
              เฉพาะค่าสรุป ไม่มีรหัสเด็ก วันเกิด หรือรหัสการคัดกรอง คะแนนและระดับความเสี่ยงนับจากการคัดกรองที่เสร็จสมบูรณ์
              กลุ่มที่มีน้อยกว่า {summary?.minCellN ?? STUDIES_CONFIG.minCellN} รายการจะไม่แสดงค่าเฉลี่ย / Aggregates only: no
              child codes, birth dates or session IDs. Scores and risk use completed sessions; groups with fewer than{" "}
              {summary?.minCellN ?? STUDIES_CONFIG.minCellN} are hidden.
              {summary?.hideBlindScores ? " ผลแบบปกปิดไม่รวมในคะแนน / Blind sessions are left out of scores." : ""}
            </p>
            {summaryError && <p className={styles.errorText}>{summaryError}</p>}
            {summary && (
              <>
                <SummaryTable sites={summary.sites} total={summary.total} minCellN={summary.minCellN} />
                <h3 className={rs.sectionTitle} style={{ marginTop: 16 }}>
                  สัดส่วนระดับความเสี่ยง / Risk level share
                </h3>
                <RiskBars blocks={[...summary.sites, ...(summary.total ? [summary.total] : [])]} />
              </>
            )}
            <div className={ds.toolbar}>
              <button className={ds.smallButton} onClick={() => void loadSummary()}>
                โหลดใหม่ / Refresh
              </button>
              {lead && isAdmin && (
                <button className={styles.secondaryButton} disabled={busy !== null} onClick={exportCsv}>
                  {busy === "export" ? "กำลังส่งออก… / Exporting…" : "ส่งออกข้อมูลรายแถว (รหัสแฝง) / Export coded rows (CSV)"}
                </button>
              )}
            </div>
            {lead && isAdmin && (
              <p className={ds.note}>
                ส่งออกเฉพาะสถานที่ที่เปิดการแบ่งปัน และเด็กที่ผู้ปกครองยินยอมให้ใช้ในงานวิจัย ใช้รหัสแฝงเฉพาะโครงการ
                (ไม่ใช่รหัสเด็กของแต่ละสถานที่) ทุกการส่งออกบันทึกในประวัติของผู้นำและของสถานที่ / Only sites that turned
                sharing on, only children whose parents allowed research use. Study-specific pseudonymous IDs (never the
                site&apos;s child codes). Every export is logged for the lead and for each site.
              </p>
            )}
          </div>
        )}

        {canTag && orgId && <SessionTagger studyId={study.id} orgId={orgId} onChanged={() => void loadSummary()} />}
      </div>
    </div>
  );
}

function SharingNotice() {
  return (
    <div className={ds.notice} style={{ marginTop: 10 }}>
      <strong>ก่อนเปิด / Before turning this on:</strong>
      <ul>
        <li>
          สถานที่นี้ต้องได้รับอนุมัติจากคณะกรรมการจริยธรรมของตนเองสำหรับโครงการนี้ / This site needs its own ethics
          committee approval for this study.
        </li>
        <li>
          ต้องมีข้อตกลงแบ่งปันข้อมูล (DSA) กับผู้นำโครงการ / A data-sharing agreement with the lead must be in place.
        </li>
        <li>
          ส่งออกเฉพาะเด็กที่ใบยินยอมล่าสุดอนุญาตให้ใช้ในงานวิจัย ข้อมูล: รหัสแฝง อายุ (เดือน) เพศ คะแนน คุณภาพ ชื่อสถานที่ /
          Only children whose latest consent allows research use. Columns: pseudonymous ID, age in months, sex, scores,
          quality, site name.
        </li>
        <li>ปิดได้ทุกเมื่อ (ไม่ลบไฟล์ที่ส่งออกไปแล้ว) / You can turn it off any time (files already exported are not recalled).</li>
      </ul>
    </div>
  );
}
