"use client";

/**
 * /r/children/[id] — one child: consent, past screenings, start a screening.
 * Starting calls the start_session RPC (checks plan, quota and consent), then
 * runs: camera check → calibration → Test 1–3 → summary (saves results).
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import styles from "@/styles/shared.module.css";
import rs from "@/styles/research.module.css";
import { friendlyError, getSupabase } from "@/lib/research/supabase/client";
import { ageInMonths, beginResearchScreening } from "@/lib/research/screening";
import { getGazeEngine } from "@/lib/research/gaze";
import { canWrite, useResearch } from "./ResearchShell";
import RiskBadge from "./RiskBadge";

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
}

export default function ChildClient() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { active } = useResearch();
  const [child, setChild] = useState<Child | null | undefined>(undefined);
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
        .select("id, started_at, status, overall_score, risk_level, quality_score, engine")
        .eq("child_id", id)
        .order("started_at", { ascending: false }),
    ]);
    if (c.error) setError(friendlyError(c.error));
    setChild(c.data ?? null);
    setConsent(k.data?.[0] ?? null);
    setSessions(s.data ?? []);
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

  async function startScreening() {
    if (!child) return;
    setBusy(true);
    setError(null);
    const clientSessionId = crypto.randomUUID();
    const engine = getGazeEngine().name;
    const { data, error: err } = await getSupabase().rpc("start_session", {
      p_child: child.id,
      p_client_session_id: clientSessionId,
      p_engine: engine,
    });
    setBusy(false);
    if (err) return setError(friendlyError(err));
    beginResearchScreening(
      {
        orgId: child.org_id,
        childId: child.id,
        childCode: child.code,
        sessionId: data as string,
        clientSessionId,
        engine,
        startedAt: new Date().toISOString(),
      },
      child.birth_month,
    );
    router.push("/r/check");
  }

  if (child === undefined) return <div className={rs.wide}>…</div>;
  if (child === null)
    return (
      <div className={rs.wide}>
        <div className={styles.card}>ไม่พบ / Not found. {error}</div>
      </div>
    );

  return (
    <div className={rs.wide}>
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
      ) : canWrite(active) ? (
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
      {canWrite(active) && (
        <div className={styles.saveRow} style={{ marginBottom: 12 }}>
          <button className={styles.primaryButton} disabled={!consent || busy} onClick={startScreening}>
            {busy ? "…" : "เริ่มคัดกรอง / Start screening"}
          </button>
          {!consent && <span className={rs.muted}>ต้องมีใบยินยอมก่อน / Consent needed first</span>}
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
    </div>
  );
}
