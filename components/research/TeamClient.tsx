"use client";

/** /r/team — org admins invite and remove staff (seat limit enforced by the server). */

import { useCallback, useEffect, useState } from "react";
import styles from "@/styles/shared.module.css";
import rs from "@/styles/research.module.css";
import { apiFetch } from "@/lib/research/supabase/client";
import { ROLE_LABELS, type MemberRole } from "@/lib/research/plans";
import { useResearch } from "./ResearchShell";

interface Member {
  userId: string;
  email: string;
  role: MemberRole;
  joined: boolean;
}

export default function TeamClient() {
  const { active, session } = useResearch();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("staff");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const orgId = active?.org.id;

  const load = useCallback(async () => {
    if (!orgId) return;
    const res = await apiFetch(`/api/research/members?orgId=${orgId}`);
    const data = await res.json();
    if (!res.ok) {
      setMsg({ ok: false, text: data.error });
      return;
    }
    setMembers(data.members);
  }, [orgId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data load; state is set after the request resolves
    void load();
  }, [load]);

  if (active?.role !== "admin") {
    return (
      <div className={rs.wide}>
        <div className={styles.card}>เฉพาะผู้ดูแล / Admins only.</div>
      </div>
    );
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await apiFetch("/api/research/members", {
      method: "POST",
      body: JSON.stringify({ orgId, email, role }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setMsg({ ok: false, text: data.error });
      return;
    }
    setMsg({
      ok: true,
      text: data.invited
        ? "ส่งอีเมลเชิญแล้ว / Invite email sent."
        : "เพิ่มผู้ใช้ที่มีบัญชีอยู่แล้ว / Existing user added.",
    });
    setEmail("");
    void load();
  }

  async function remove(m: Member) {
    if (!window.confirm(`Remove ${m.email}?`)) return;
    const res = await apiFetch("/api/research/members", {
      method: "DELETE",
      body: JSON.stringify({ orgId, userId: m.userId }),
    });
    const data = await res.json();
    if (!res.ok) setMsg({ ok: false, text: data.error });
    void load();
  }

  return (
    <div className={rs.wide}>
      <h1 className={styles.title}>ทีม / Team</h1>
      <p className={rs.muted}>
        ใช้ที่นั่ง {members?.length ?? "…"} / {active.org.seats} · Seats used {members?.length ?? "…"} of {active.org.seats}
      </p>

      <form className={styles.card} onSubmit={invite}>
        <div className={rs.row}>
          <div className={rs.field} style={{ flex: "1 1 260px" }}>
            <label htmlFor="inv-email">อีเมล / Email</label>
            <input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className={rs.field}>
            <label htmlFor="inv-role">บทบาท / Role</label>
            <select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as MemberRole)}>
              {(Object.keys(ROLE_LABELS) as MemberRole[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          <button className={styles.primaryButton} type="submit" disabled={busy}>
            เชิญ / Invite
          </button>
        </div>
        {msg && <p className={msg.ok ? styles.successText : styles.errorText}>{msg.text}</p>}
      </form>

      <div className={styles.card} style={{ marginTop: 16 }}>
        <div className={rs.tableWrap}>
          <table className={rs.table}>
            <thead>
              <tr>
                <th>อีเมล / Email</th>
                <th>บทบาท / Role</th>
                <th>สถานะ / Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(members ?? []).map((m) => (
                <tr key={m.userId}>
                  <td>{m.email}</td>
                  <td>{ROLE_LABELS[m.role]}</td>
                  <td>{m.joined ? "ใช้งานแล้ว / Active" : "รอตอบรับ / Invited"}</td>
                  <td>
                    {m.userId !== session.user.id && (
                      <button className={rs.linkButton} onClick={() => remove(m)}>
                        ลบ / Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
