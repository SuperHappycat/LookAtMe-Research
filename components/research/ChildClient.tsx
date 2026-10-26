"use client";

/**
 * /r/children/[id] — one child: consent, past screenings, start a screening.
 * Starting goes through startScreening() (lib/research/offline/start.ts: start_session RPC online, cached
 * plan limits offline), then runs: camera check → calibration → Test 1–3 → summary (saves results).
 * Phase 5 (agent B): repeat-screening trend, diagnosis follow-up, blind mode, consent withdrawal.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import styles from "@/styles/shared.module.css";
import rs from "@/styles/research.module.css";
import b from "@/styles/research-b.module.css";
import { apiFetch, friendlyError, getSupabase } from "@/lib/research/supabase/client";
import { ageInMonths } from "@/lib/research/screening";
import { useAssent } from "./AssentDialog";
import { cacheChildForOffline, forgetCachedChild, startScreening as startScreeningFlow } from "@/lib/research/offline/start";
import { getGazeEngine } from "@/lib/research/gaze";
import { planHas } from "@/lib/research/plans";
import { WITHDRAW_REASONS, type WithdrawReason } from "@/lib/research/followup/config";
import type { WithdrawSummary } from "@/lib/research/followup/withdraw";
import { canWrite, useResearch } from "./ResearchShell";
import RiskBadge from "./RiskBadge";
import TrendChart from "./TrendChart";
import DiagnosisSection from "./DiagnosisSection";

const CONSENT_VERSION = "2026-10-v1";
const RELATION_LABELS: Record<string, string> = {
  mother: "มารดา / Mother",
  father: "บิดา / Father",
  guardian: "ผู้ปกครองตามกฎหมาย / Legal guardian",
};

interface Child {
  id: string;
  org_id: string;
  code: string;
  birth_month: string | null;
  sex: string | null;
}
interface Consent {
  id: string;
  guardian_relation: string;
  consent_version: string;
  allow_recording: boolean;
  allow_research: boolean;
  signed_at: string;
}
interface SessionRow {
  id: string;
  started_at: string;
  status: string;
  overall_score: number | null;
  risk_level: string | null;
  quality_score: number | null;
  engine: string;
  level1_score: number | null;
  level2_score: number | null;
  level3_score: number | null;
  blind: boolean;
}

/** Admins only: consent withdrawal (spec §5.3) with a typed confirmation of the child code. */
function WithdrawPanel({ child, onDone }: { child: Child; onDone: (s: WithdrawSummary) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<WithdrawReason>("parent_request");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent, force = false) {
    e.preventDefault();
    if (typed.trim() !== child.code) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch("/api/research/withdraw-consent", {
        method: "POST",
        body: JSON.stringify({ childId: child.id, reason, confirmCode: typed.trim(), force }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 409 && d.code === "drive_delete_failed" && !force) {
        const ok = window.confirm(
          `${d.error}\n\nลบข้อมูลเด็กต่อเลยหรือไม่? คุณจะต้องลบไฟล์ใน Google Drive เอง (รหัสไฟล์: ${(d.driveFailed ?? []).join(", ")})\nDelete the child's data anyway? You will need to delete these Drive files by hand.`,
        );
        setBusy(false);
        if (ok) await submit(e, true);
        else setError(d.error);
        return;
      }
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      onDone(d as WithdrawSummary);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={b.dangerZone}>
      <h3 className={b.dangerTitle}>ถอนความยินยอมและลบข้อมูลทั้งหมด / Withdraw consent and delete all data</h3>
      <p className={rs.muted} style={{ margin: 0 }}>
        ใช้เมื่อผู้ปกครองขอถอนความยินยอม ระบบจะลบวิดีโอใน Google Drive ไฟล์ข้อมูลการมอง ผลการคัดกรอง ผลวินิจฉัย และใบยินยอมของเด็กคนนี้
        ย้อนกลับไม่ได้ และไม่คืนโควตาการคัดกรอง · Use when a parent withdraws consent. Deletes this child&apos;s Drive recordings, gaze
        files, screenings, diagnoses and consents. This can&apos;t be undone, and used screenings are not refunded.
      </p>
      {!open ? (
        <button className={styles.dangerButton} style={{ marginTop: 12 }} onClick={() => setOpen(true)}>
          ถอนความยินยอม… / Withdraw consent…
        </button>
      ) : (
        <form onSubmit={submit} style={{ marginTop: 12 }}>
          <div className={rs.row}>
            <div className={rs.field}>
              <label htmlFor="wd-reason">เหตุผล / Reason</label>
              <select id="wd-reason" value={reason} onChange={(e) => setReason(e.target.value as WithdrawReason)}>
                {(Object.keys(WITHDRAW_REASONS) as WithdrawReason[]).map((k) => (
                  <option key={k} value={k}>
                    {WITHDRAW_REASONS[k]}
                  </option>
                ))}
              </select>
            </div>
            <div className={rs.field}>
              <label htmlFor="wd-code">
                พิมพ์รหัสเด็ก <strong>{child.code}</strong> เพื่อยืนยัน / Type the child code to confirm
              </label>
              <input id="wd-code" value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
            </div>
          </div>
          {error && <p className={styles.errorText}>{error}</p>}
          <div className={styles.saveRow} style={{ marginTop: 12 }}>
            <button className={styles.dangerButton} type="submit" disabled={busy || typed.trim() !== child.code}>
              {busy ? "กำลังลบ… / Deleting…" : "ลบข้อมูลทั้งหมด / Delete all data"}
            </button>
            <button type="button" className={rs.linkButton} onClick={() => setOpen(false)} disabled={busy}>
              ยกเลิก / Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function WithdrawResult({ summary }: { summary: WithdrawSummary }) {
  return (
    <div className={rs.wide}>
      <h1 className={styles.title}>ลบข้อมูลแล้ว / Data deleted</h1>
      <div className={styles.card}>
        <p className={styles.successText} style={{ marginTop: 0 }}>
          ถอนความยินยอมและลบข้อมูลของเด็กคนนี้แล้ว ✓ / Consent withdrawn and this child&apos;s data deleted ✓
        </p>
        <ul>
          <li>การคัดกรอง / Screenings deleted: {summary.sessionsDeleted}</li>
          <li>ไฟล์ข้อมูลการมอง / Gaze files deleted: {summary.gazeFilesDeleted}</li>
          <li>วิดีโอใน Google Drive / Drive recordings deleted: {summary.driveDeleted}</li>
        </ul>
        {summary.driveFailed.length > 0 && (
          <div className={b.warnBox}>
            <strong>
              ลบวิดีโอใน Google Drive ไม่สำเร็จ {summary.driveFailed.length} ไฟล์ กรุณาเปิดลิงก์แล้วลบเองใน Drive ขององค์กร (ลิงก์นี้แสดงครั้งเดียว)
              / {summary.driveFailed.length} Drive recording(s) could not be deleted. Open each link and delete it in your
              organization&apos;s Drive (these links are shown only once).
            </strong>
            <ul className={b.fileList}>
              {summary.driveFailed.map((id) => (
                <li key={id}>
                  <a href={`https://drive.google.com/file/d/${encodeURIComponent(id)}/view`} target="_blank" rel="noopener noreferrer">
                    https://drive.google.com/file/d/{id}/view
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {summary.localOnlyRecordings > 0 && (
          <div className={b.warnBox}>
            มีวิดีโอ {summary.localOnlyRecordings} ไฟล์ที่บันทึกไว้ในเครื่องคอมพิวเตอร์เท่านั้น กรุณาลบไฟล์เหล่านั้นในเครื่องที่ใช้ทดสอบ / {summary.localOnlyRecordings}{" "}
            recording(s) were saved only on a computer. Please delete them on the device used for the screening.
          </div>
        )}
        <p className={rs.muted}>โควตาการคัดกรองที่ใช้ไปแล้วไม่คืน / Used screenings are not refunded.</p>
        <Link href="/r">← เด็กทั้งหมด / All children</Link>
      </div>
    </div>
  );
}

export default function ChildClient() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { ask: askAssent, dialog: assentDialog } = useAssent();
  const { active, memberships, session } = useResearch();
  const [child, setChild] = useState<Child | null | undefined>(undefined);
  const [orgBlind, setOrgBlind] = useState(false);
  const [withdrawn, setWithdrawn] = useState<WithdrawSummary | null>(null);
  const [consent, setConsent] = useState<Consent | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // consent form
  const [relation, setRelation] = useState("mother");
  const [agree, setAgree] = useState(false);
  const [allowResearch, setAllowResearch] = useState(false);
  const [allowRecording, setAllowRecording] = useState(false);

  const load = useCallback(async () => {
    const sb = getSupabase();
    const [c, k, s] = await Promise.all([
      sb.from("children").select("id, org_id, code, birth_month, sex").eq("id", id).maybeSingle(),
      sb
        .from("consents")
        .select("id, guardian_relation, consent_version, allow_recording, allow_research, signed_at")
        .eq("child_id", id)
        .is("withdrawn_at", null)
        .order("signed_at", { ascending: false })
        .limit(1),
      sb
        .from("sessions")
        .select(
          "id, started_at, status, overall_score, risk_level, quality_score, engine, level1_score, level2_score, level3_score, blind",
        )
        .eq("child_id", id)
        .order("started_at", { ascending: false }),
    ]);
    if (c.error) setError(friendlyError(c.error));
    const ch = (c.data as Child | null) ?? null;
    const ks = (k.data?.[0] as Consent | undefined) ?? null;
    setChild(ch);
    setConsent(ks);
    setSessions((s.data as SessionRow[]) ?? []);
    if (ch) {
      // Organization's blind setting (column from migration 20261026000301; treated as off if unavailable).
      const o = await sb.from("organizations").select("blind_new_sessions").eq("id", ch.org_id).maybeSingle();
      setOrgBlind(!o.error && !!(o.data as { blind_new_sessions?: boolean } | null)?.blind_new_sessions);
      const blindNow = !o.error && !!(o.data as { blind_new_sessions?: boolean } | null)?.blind_new_sessions;
      void cacheChildForOffline(
        ch,
        ks ? { allow_recording: ks.allow_recording, allow_research: ks.allow_research } : null,
        { blind: blindNow },
      ).catch(() => undefined);
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data load; state is set after the request resolves
    void load();
  }, [load]);

  async function saveConsent(e: React.FormEvent) {
    e.preventDefault();
    if (!child || !agree) return;
    setError(null);
    const { error: err } = await getSupabase().from("consents").insert({
      org_id: child.org_id,
      child_id: child.id,
      guardian_relation: relation,
      consent_version: CONSENT_VERSION,
      allow_research: allowResearch,
      allow_recording: allowRecording,
    });
    if (err) return setError(friendlyError(err));
    void load();
  }

  // The child's own organization decides role and plan features (it may differ from the selected one).
  const membership = (child && memberships.find((m) => m.org.id === child.org_id)) || active;
  const plan = membership?.org.plan;
  const isAdmin = membership?.role === "admin";
  const blindOn = !!plan && planHas(plan, "blind_mode") && orgBlind;

  async function startScreening() {
    if (!child) return;
    // Child assent first: "not now" cancels before anything is started (no quota used).
    const assent = await askAssent(child.code);
    if (!assent) return;
    setBusy(true);
    setError(null);
    try {
      await startScreeningFlow({
        child: { id: child.id, org_id: child.org_id, code: child.code, birth_month: child.birth_month },
        ageMonths: ageInMonths(child.birth_month),
        engine: getGazeEngine().name,
        allowRecording: !!consent?.allow_recording,
        blind: blindOn,
        assent,
      });
    } catch (err) {
      setBusy(false);
      return setError(friendlyError(err));
    }
    setBusy(false);
    router.push("/r/check");
  }

  if (withdrawn) return <WithdrawResult summary={withdrawn} />;
  if (child === undefined) return <div className={rs.wide}>…</div>;
  if (child === null)
    return (
      <div className={rs.wide}>
        <div className={styles.card}>ไม่พบ / Not found. {error}</div>
      </div>
    );

  return (
    <div className={rs.wide}>
      {assentDialog}
      <p>
        <Link href="/r">← เด็กทั้งหมด / All children</Link>
      </p>
      <h1 className={styles.title}>{child.code}</h1>
      <p className={rs.muted} style={{ marginTop: -8 }}>
        อายุ / Age: {ageInMonths(child.birth_month) ?? "—"} เดือน / months · เพศ / Sex: {child.sex ?? "—"}
      </p>
      {error && <p className={styles.errorText}>{error}</p>}

      <h2 className={rs.sectionTitle}>ใบยินยอม / Consent</h2>
      {consent ? (
        <div className={styles.card}>
          ✓ {RELATION_LABELS[consent.guardian_relation] ?? consent.guardian_relation} · {consent.signed_at.slice(0, 10)} ·{" "}
          {consent.consent_version}
          <br />
          <span className={rs.muted}>
            ใช้ในงานวิจัย / Research use: {consent.allow_research ? "✓" : "✗"} · บันทึกวิดีโอ / Video recording:{" "}
            {consent.allow_recording ? "✓" : "✗"}
          </span>
        </div>
      ) : canWrite(membership) ? (
        <form className={styles.card} onSubmit={saveConsent}>
          <div className={rs.consentText}>
            ข้าพเจ้าในฐานะผู้ปกครอง ยินยอมให้บุตรหลานเข้ารับการคัดกรองด้วยระบบ LookAtMe ซึ่งใช้กล้องเว็บแคมดูการมองของเด็ก
            ขณะดูวิดีโอสั้น 3 ชุด (ชุดละ 20 วินาที) ผลเป็นการคัดกรองเบื้องต้นเท่านั้น ไม่ใช่การวินิจฉัย
            ข้อมูลจะบันทึกด้วยรหัส ไม่มีชื่อเด็ก และสามารถขอลบข้อมูลได้ทุกเมื่อ
            <br />
            <span className={rs.muted}>
              As the parent/guardian, I agree that my child may be screened with LookAtMe, which uses a webcam to see where
              the child looks while watching three 20-second videos. The result is a screening only, not a diagnosis. Data is
              stored under a code without the child&apos;s name, and I can ask for it to be deleted at any time.
            </span>
          </div>
          <div className={rs.row} style={{ marginTop: 12 }}>
            <div className={rs.field}>
              <label htmlFor="rel">ผู้ให้ความยินยอม / Signed by</label>
              <select id="rel" value={relation} onChange={(e) => setRelation(e.target.value)}>
                <option value="mother">มารดา / Mother</option>
                <option value="father">บิดา / Father</option>
                <option value="guardian">ผู้ปกครองตามกฎหมาย / Legal guardian</option>
              </select>
            </div>
          </div>
          <label className={rs.checkLine}>
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>ยินยอมให้คัดกรอง (จำเป็น) / I agree to the screening (required)</span>
          </label>
          <label className={rs.checkLine}>
            <input type="checkbox" checked={allowResearch} onChange={(e) => setAllowResearch(e.target.checked)} />
            <span>ยินยอมให้ใช้ข้อมูลแบบไม่ระบุตัวตนในงานวิจัย / Anonymised data may be used in research studies</span>
          </label>
          <label className={rs.checkLine}>
            <input type="checkbox" checked={allowRecording} onChange={(e) => setAllowRecording(e.target.checked)} />
            <span>ยินยอมให้บันทึกวิดีโอระหว่างทดสอบ / The test may be video-recorded</span>
          </label>
          <button className={styles.primaryButton} type="submit" disabled={!agree}>
            บันทึกใบยินยอม / Save consent
          </button>
        </form>
      ) : (
        <div className={styles.card}>ยังไม่มีใบยินยอม / No consent yet.</div>
      )}

      <h2 className={rs.sectionTitle}>การคัดกรอง / Screenings</h2>
      {canWrite(membership) && (
        <div className={styles.saveRow} style={{ marginBottom: 12 }}>
          <button className={styles.primaryButton} disabled={!consent || busy} onClick={startScreening}>
            {busy ? "…" : "เริ่มคัดกรอง / Start screening"}
          </button>
          {!consent && <span className={rs.muted}>ต้องมีใบยินยอมก่อน / Consent needed first</span>}
          {blindOn && (
            <span className={b.blindNote}>
              โหมดปกปิดผลเปิดอยู่: ผลจะเห็นเฉพาะผู้ดูแล / Blind mode on: results visible to admins only
            </span>
          )}
        </div>
      )}
      <div className={styles.card}>
        {sessions.length === 0 ? (
          <span className={rs.muted}>ยังไม่มี / None yet.</span>
        ) : (
          <div className={rs.tableWrap}>
            <table className={rs.table}>
              <thead>
                <tr>
                  <th>วันที่ / Date</th>
                  <th>คะแนน / Score</th>
                  <th>ความเสี่ยง / Risk</th>
                  <th>คุณภาพ / Quality</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td>{new Date(s.started_at).toLocaleString("th-TH")}</td>
                    <td>{s.overall_score !== null ? Math.round(s.overall_score) : "—"}</td>
                    <td>
                      <RiskBadge risk={s.risk_level} status={s.status} />
                      {s.blind && (
                        <>
                          {" "}
                          <span className={`${rs.badge} ${rs.badgeMuted}`}>blind</span>
                        </>
                      )}
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
        )}
      </div>

      {plan && planHas(plan, "repeat_trend") && (
        <>
          <h2 className={rs.sectionTitle}>แนวโน้มคะแนน / Score trend</h2>
          <div className={styles.card}>
            <TrendChart sessions={sessions} />
          </div>
        </>
      )}

      {plan && planHas(plan, "diagnosis_follow_up") && canWrite(membership) && (
        <>
          <h2 className={rs.sectionTitle}>ผลการวินิจฉัย / Diagnosis follow-up</h2>
          <DiagnosisSection child={child} userId={session.user.id} />
        </>
      )}

      {isAdmin && (
        <>
          <h2 className={rs.sectionTitle}>ความยินยอม / Consent withdrawal</h2>
          <WithdrawPanel
            child={child}
            onDone={(s) => {
              // Also forget the child on this device so it can't be screened offline any more.
              void forgetCachedChild(child.id).catch(() => undefined);
              setWithdrawn(s);
            }}
          />
        </>
      )}
    </div>
  );
}
