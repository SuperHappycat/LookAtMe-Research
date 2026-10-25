"use client";

/**
 * components/research/SetPasswordClient.tsx
 * Landing page for invite and password-reset emails. Supabase puts the
 * session in the URL; the client picks it up, then the user chooses a password.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "@/styles/shared.module.css";
import rs from "@/styles/research.module.css";
import { getSupabase, supabaseConfigured } from "@/lib/research/supabase/client";

export default function SetPasswordClient() {
  const router = useRouter();
  const [ready, setReady] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabaseConfigured()) return;
    const sb = getSupabase();
    const apply = (s: { user: { email?: string } } | null) => {
      setReady(!!s);
      setEmail(s?.user.email ?? "");
    };
    sb.auth.getSession().then(({ data }) => apply(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => apply(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw.length < 10) {
      setError("รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร / Use at least 10 characters.");
      return;
    }
    if (pw !== pw2) {
      setError("รหัสผ่านไม่ตรงกัน / Passwords don't match.");
      return;
    }
    setBusy(true);
    const { error: err } = await getSupabase().auth.updateUser({ password: pw });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    router.replace("/r");
  }

  return (
    <div className={styles.pageNarrow}>
      <h1 className={styles.titleCentered}>ตั้งรหัสผ่าน / Set your password</h1>
      {ready === null && <div className={styles.card}>กำลังตรวจสอบลิงก์… / Checking your link…</div>}
      {ready === false && (
        <div className={styles.card}>
          <p className={styles.errorText}>
            ลิงก์หมดอายุหรือใช้ไปแล้ว ขอให้ผู้ดูแลส่งคำเชิญใหม่ หรือใช้ &quot;ลืมรหัสผ่าน&quot;
            <br />
            This link has expired or was already used. Ask your admin to re-invite you, or use &quot;Forgot password&quot;.
          </p>
          <button className={styles.primaryButton} onClick={() => router.replace("/login")}>
            ไปหน้าเข้าสู่ระบบ / Go to login
          </button>
        </div>
      )}
      {ready && (
        <form className={styles.card} onSubmit={save}>
          <p className={rs.muted} style={{ marginTop: 0 }}>{email}</p>
          <div className={rs.field}>
            <label htmlFor="pw">รหัสผ่านใหม่ / New password</label>
            <input id="pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </div>
          <div className={rs.field} style={{ marginTop: 12 }}>
            <label htmlFor="pw2">ยืนยันรหัสผ่าน / Repeat password</label>
            <input id="pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </div>
          {error && <p className={styles.errorText}>{error}</p>}
          <div className={styles.saveRow} style={{ marginTop: 16 }}>
            <button className={styles.primaryButton} type="submit" disabled={busy}>
              บันทึก / Save
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
