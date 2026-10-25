"use client";

/**
 * /r/studies — multi-site studies of the active organization (Hospital plan).
 * Lists studies with a lead/site badge; admins create a study or join one with an invite code.
 * Orgs never see a list of other orgs: joining needs a code from the lead.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "@/styles/shared.module.css";
import rs from "@/styles/research.module.css";
import ds from "@/styles/research-d.module.css";
import { apiFetch } from "@/lib/research/supabase/client";
import { planHas } from "@/lib/research/plans";
import { looksLikeInviteCode, normalizeInviteCode } from "@/lib/research/studies/codes";
import type { StudyListItem } from "@/lib/research/studies/service";
import { useResearch } from "../ResearchShell";
import { RoleBadge } from "./StudyBits";

export default function StudiesClient() {
  const { active } = useResearch();
  const router = useRouter();
  const orgId = active?.org.id;
  const isAdmin = active?.role === "admin";
  const enabled = !!active && planHas(active.org.plan, "multi_site");
  const [studies, setStudies] = useState<StudyListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [blind, setBlind] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!orgId || !enabled) return;
    const res = await apiFetch(`/api/research/studies?orgId=${orgId}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.error ?? "Error");
    setError(null);
    setStudies(data.studies);
  }, [orgId, enabled]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data load; state is set after the request resolves
    void load();
  }, [load]);

  if (!enabled) {
    return (
      <div className={rs.wide}>
        <div className={styles.card}>
          โครงการวิจัยหลายสถานที่มีในแผนโรงพยาบาลเท่านั้น / Multi-site studies are part of the Hospital plan.
        </div>
      </div>
    );
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy("create");
    setMsg(null);
    const res = await apiFetch("/api/research/studies", {
      method: "POST",
      body: JSON.stringify({ orgId, name, blindDefault: blind }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setMsg({ ok: false, text: data.error ?? "Error" });
    router.push(`/r/studies/${data.id}`);
  }

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setBusy("join");
    setMsg(null);
    const res = await apiFetch("/api/research/studies/join", {
      method: "POST",
      body: JSON.stringify({ orgId, code: normalizeInviteCode(code) }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setMsg({ ok: false, text: data.error ?? "Error" });
    setCode("");
    router.push(`/r/studies/${data.studyId}`);
  }

  return (
    <div className={rs.wide}>
      <h1 className={styles.title}>โครงการวิจัย / Studies</h1>
      <p className={styles.subtitle}>
        หลายโรงพยาบาลในโครงการเดียว แต่ละแห่งเห็นเฉพาะข้อมูลของตนเอง ผู้นำโครงการเห็นสรุปรวม / Several hospitals in one
        study: each site sees only its own data; the lead sees a combined summary.
      </p>

      {msg && <p className={msg.ok ? styles.successText : styles.errorText}>{msg.text}</p>}

      <div className={`${styles.card} ${ds.spaced}`}>
        <h2 className={rs.sectionTitle}>โครงการของ {active?.org.name} / Studies of this organization</h2>
        {error && <p className={styles.errorText}>{error}</p>}
        {studies === null && !error && <p className={rs.muted}>กำลังโหลด… / Loading…</p>}
        {studies?.length === 0 && <p className={rs.muted}>ยังไม่มีโครงการ / No studies yet.</p>}
        {!!studies?.length && (
          <div className={rs.tableWrap}>
            <table className={rs.table}>
              <thead>
                <tr>
                  <th>ชื่อโครงการ / Study</th>
                  <th>บทบาท / Role</th>
                  <th>ผู้นำโครงการ / Lead</th>
                  <th>สร้างเมื่อ / Created</th>
                </tr>
              </thead>
              <tbody>
                {studies.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link className={ds.listLink} href={`/r/studies/${s.id}`}>
                        {s.name}
                      </Link>
                    </td>
                    <td>
                      <RoleBadge role={s.role} />
                    </td>
                    <td>{s.leadName}</td>
                    <td>{s.createdAt.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isAdmin ? (
        <div className={ds.grid2}>
          <form className={styles.card} onSubmit={create}>
            <h2 className={rs.sectionTitle}>สร้างโครงการ / Create a study</h2>
            <p className={ds.note}>
              องค์กรนี้จะเป็นผู้นำโครงการ และเชิญสถานที่อื่นด้วยรหัส / This organization becomes the lead and invites other
              sites with a code.
            </p>
            <label className={rs.field}>
              ชื่อโครงการ / Study name
              <input className={rs.textInput} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label className={ds.toggle} style={{ margin: "10px 0" }}>
              <input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} />
              <span>ค่าเริ่มต้นแบบปกปิดผล / Blind by default (recorded with the study)</span>
            </label>
            <button className={styles.primaryButton} disabled={busy !== null || !name.trim()}>
              {busy === "create" ? "กำลังสร้าง… / Creating…" : "สร้าง / Create"}
            </button>
          </form>

          <form className={styles.card} onSubmit={join}>
            <h2 className={rs.sectionTitle}>เข้าร่วมด้วยรหัส / Join with a code</h2>
            <p className={ds.note}>
              ใส่รหัสเชิญ 12 ตัวที่ได้จากผู้นำโครงการ (ใช้ได้ครั้งเดียว) / Enter the 12-character one-time code from the
              study lead.
            </p>
            <label className={rs.field}>
              รหัสเชิญ / Invite code
              <input
                className={`${rs.textInput} ${ds.codeInput}`}
                value={code}
                placeholder="XXXX-XXXX-XXXX"
                autoComplete="off"
                spellCheck={false}
                maxLength={20}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <div style={{ marginTop: 10 }}>
              <button className={styles.primaryButton} disabled={busy !== null || !looksLikeInviteCode(code)}>
                {busy === "join" ? "กำลังตรวจสอบ… / Checking…" : "เข้าร่วม / Join"}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <p className={rs.muted}>
          ผู้ดูแลองค์กรเป็นผู้สร้างหรือเข้าร่วมโครงการ / Only organization admins can create or join studies.
        </p>
      )}
    </div>
  );
}
