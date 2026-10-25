"use client";

/**
 * components/research/LoginClient.tsx
 * Email + password login (invite-only: there is no sign-up), plus "forgot password".
 */

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "@/styles/shared.module.css";
import rs from "@/styles/research.module.css";
import { getSupabase, supabaseConfigured } from "@/lib/research/supabase/client";

export default function LoginClient() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/r";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  if (!supabaseConfigured()) {
    return (
      <div className={styles.pageNarrow}>
        <div className={styles.card}>
          <p className={styles.errorText}>Supabase is not configured. See docs/PHASE2_3_NOTES.md.</p>
        </div>
      </div>
    );
  }

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await getSupabase().auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (err) {
      setError("อีเมลหรือรหัสผ่านไม่ถูกต้อง / Wrong email or password.");
      return;
    }
    router.replace(safeNext);
  }

  async function forgot() {
    setError(null);
    if (!email.trim()) {
      setError("กรอกอีเมลก่อน / Enter your email first.");
      return;
    }
    await getSupabase().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/account/set-password`,
    });
    setInfo("ถ้ามีบัญชีนี้ จะได้รับอีเมลตั้งรหัสผ่านใหม่ / If this account exists, a reset email is on its way.");
  }

  return (
    <div className={styles.pageNarrow}>
      <h1 className={styles.titleCentered}>LookAtMe Research</h1>
      <p className={styles.subtitleCentered}>
        สำหรับโรงเรียน ศูนย์พัฒนาการ และโรงพยาบาลที่ได้รับเชิญ
        <br />
        For invited schools, clinics and hospitals
      </p>
      <form className={styles.card} onSubmit={login}>
        <div className={rs.field}>
          <label htmlFor="email">อีเมล / Email</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className={rs.field} style={{ marginTop: 12 }}>
          <label htmlFor="password">รหัสผ่าน / Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <p className={styles.errorText}>{error}</p>}
        {info && <p className={styles.successText}>{info}</p>}
        <div className={styles.saveRow} style={{ marginTop: 16 }}>
          <button className={styles.primaryButton} type="submit" disabled={busy}>
            {busy ? "…" : "เข้าสู่ระบบ / Log in"}
          </button>
          <button type="button" className={rs.linkButton} onClick={forgot}>
            ลืมรหัสผ่าน / Forgot password
          </button>
        </div>
      </form>
      <p className={styles.subtitleCentered} style={{ marginTop: 20, fontSize: 14 }}>
        ใช้คัดกรองเบื้องต้น ไม่ใช่การวินิจฉัย / Screening only, not a diagnosis.
      </p>
    </div>
  );
}
