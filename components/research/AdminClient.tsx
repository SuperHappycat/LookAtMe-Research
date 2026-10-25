"use client";

/** /r/admin — LookAtMe team: create organizations (after payment), renew, see usage. */

import { useCallback, useEffect, useState } from "react";
import styles from "@/styles/shared.module.css";
import rs from "@/styles/research.module.css";
import { apiFetch } from "@/lib/research/supabase/client";
import { PLANS, type PlanKey } from "@/lib/research/plans";
import { useResearch, type Organization } from "./ResearchShell";

function nextYear(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

export default function AdminClient() {
  const { isPlatformAdmin, reloadOrgs } = useResearch();
  const [orgs, setOrgs] = useState<(Organization & { created_at: string })[] | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<PlanKey>("school");
  const [expiresOn, setExpiresOn] = useState(nextYear());
  const [adminEmail, setAdminEmail] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch("/api/research/admin/orgs");
    const data = await res.json();
    if (res.ok) setOrgs(data.organizations);
    else setMsg({ ok: false, text: data.error });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data load; state is set after the request resolves
    if (isPlatformAdmin) void load();
  }, [isPlatformAdmin, load]);

  if (!isPlatformAdmin) {
    return (
      <div className={rs.wide}>
        <div className={styles.card}>LookAtMe team only.</div>
      </div>
    );
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await apiFetch("/api/research/admin/orgs", {
      method: "POST",
      body: JSON.stringify({ name, type, expiresOn, adminEmail }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setMsg({ ok: false, text: data.error });
      return;
    }
    setMsg({ ok: true, text: `Created. ${data.invite.invited ? "Invite email sent" : "Existing user added"} to ${adminEmail}.` });
    setName("");
    setAdminEmail("");
    void load();
    void reloadOrgs();
  }

  async function renew(o: Organization) {
    const value = window.prompt(`New expiry date for ${o.name} (YYYY-MM-DD)`, nextYear());
    if (!value) return;
    const res = await apiFetch("/api/research/admin/orgs", {
      method: "PATCH",
      body: JSON.stringify({ id: o.id, expiresOn: value }),
    });
    if (!res.ok) setMsg({ ok: false, text: (await res.json()).error });
    void load();
  }

  return (
    <div className={rs.wide}>
      <h1 className={styles.title}>LookAtMe admin</h1>
      <form className={styles.card} onSubmit={create}>
        <h2 style={{ marginTop: 0 }}>สร้างองค์กรใหม่ / New organization</h2>
        <div className={rs.row}>
          <div className={rs.field} style={{ flex: "2 1 240px" }}>
            <label htmlFor="o-name">ชื่อ / Name</label>
            <input id="o-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className={rs.field}>
            <label htmlFor="o-type">แผน / Plan</label>
            <select id="o-type" value={type} onChange={(e) => setType(e.target.value as PlanKey)}>
              {(Object.keys(PLANS) as PlanKey[]).map((k) => (
                <option key={k} value={k}>
                  {PLANS[k].labelEn} · {PLANS[k].priceThbPerYear.toLocaleString()} THB
                </option>
              ))}
            </select>
          </div>
          <div className={rs.field}>
            <label htmlFor="o-exp">หมดอายุ / Expires</label>
            <input id="o-exp" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} required />
          </div>
          <div className={rs.field} style={{ flex: "2 1 240px" }}>
            <label htmlFor="o-admin">อีเมลผู้ดูแล / First admin email</label>
            <input id="o-admin" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} required />
          </div>
          <button className={styles.primaryButton} type="submit" disabled={busy}>
            สร้าง / Create
          </button>
        </div>
        <p className={rs.muted} style={{ fontSize: 13 }}>
          {PLANS[type].screeningQuota ?? "Unlimited"} screenings / year · {PLANS[type].seats} seats
        </p>
        {msg && <p className={msg.ok ? styles.successText : styles.errorText}>{msg.text}</p>}
      </form>

      <div className={styles.card} style={{ marginTop: 16 }}>
        <div className={rs.tableWrap}>
          <table className={rs.table}>
            <thead>
              <tr>
                <th>Organization</th>
                <th>Plan</th>
                <th>Used</th>
                <th>Seats</th>
                <th>Expires</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(orgs ?? []).map((o) => (
                <tr key={o.id}>
                  <td>{o.name}</td>
                  <td>{PLANS[o.plan]?.labelEn}</td>
                  <td>
                    {o.screenings_used}
                    {o.screening_quota !== null ? ` / ${o.screening_quota}` : ""}
                  </td>
                  <td>{o.seats}</td>
                  <td style={{ color: o.expires_on < new Date().toISOString().slice(0, 10) ? "var(--danger)" : undefined }}>
                    {o.expires_on}
                  </td>
                  <td>
                    <button className={rs.linkButton} onClick={() => renew(o)}>
                      Renew
                    </button>
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
