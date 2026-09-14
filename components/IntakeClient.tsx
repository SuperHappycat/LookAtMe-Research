"use client";

/**
 * components/IntakeClient.tsx
 * =============================
 * Web port of gui/intake.py: collects Name, Email, Date of Birth
 * (day/month/year selects), and Province before starting the
 * screening. Writes into sessionStorage (lib/sessionState.ts) and
 * navigates to Test 1, mirroring the desktop app's
 * App.create_patient_session().
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "@/styles/shared.module.css";
import { MONTH_NAMES, THAI_PROVINCES, daysInMonth } from "@/lib/provinces";
import { startNewSession } from "@/lib/sessionState";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function IntakeClient() {
  const router = useRouter();
  const today = useMemo(() => new Date(), []);
  const years = useMemo(() => {
    const list: number[] = [];
    for (let y = today.getFullYear(); y >= today.getFullYear() - 100; y--) list.push(y);
    return list;
  }, [today]);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [day, setDay] = useState(1);
  const [month, setMonth] = useState(1); // 1-12
  const [year, setYear] = useState(Math.max(today.getFullYear() - 5, years[years.length - 1]));
  const [province, setProvince] = useState<string>(THAI_PROVINCES[0]);
  const [error, setError] = useState<string | null>(null);

  const maxDay = daysInMonth(year, month);
  const dayOptions = Array.from({ length: maxDay }, (_, i) => i + 1);
  const effectiveDay = Math.min(day, maxDay);

  function handleSubmit() {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    if (!trimmedName) {
      setError("Please enter the patient's name.");
      return;
    }
    if (!EMAIL_RE.test(trimmedEmail)) {
      setError("Please enter a valid email address.");
      return;
    }

    const dob = new Date(year, month - 1, effectiveDay);
    if (dob > today) {
      setError("Date of birth cannot be in the future.");
      return;
    }
    setError(null);

    const iso = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${effectiveDay
      .toString()
      .padStart(2, "0")}`;
    startNewSession({ name: trimmedName, email: trimmedEmail, dateOfBirth: iso, province });
    router.push("/test1");
  }

  return (
    <div className={styles.pageNarrow}>
      <h1 className={styles.titleCentered}>Patient Information</h1>
      <p className={styles.subtitleCentered}>Enter the patient&apos;s details before starting the screening.</p>

      <div className={styles.card}>
        <div className={styles.field}>
          <label htmlFor="name">Name</label>
          <input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
        </div>

        <div className={styles.field}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
          />
        </div>

        <div className={styles.field}>
          <label>Date of Birth</label>
          <div className={styles.inlineSelectRow}>
            <select value={effectiveDay} onChange={(e) => setDay(Number(e.target.value))}>
              {dayOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MONTH_NAMES.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.field}>
          <label htmlFor="province">Province</label>
          <select id="province" value={province} onChange={(e) => setProvince(e.target.value)}>
            {THAI_PROVINCES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        {error && <p className={styles.errorText}>{error}</p>}

        <div className={styles.saveRow} style={{ marginTop: 8 }}>
          <button className={styles.primaryButton} onClick={handleSubmit}>
            Start Screening
          </button>
          <button className={styles.secondaryButton} onClick={() => router.push("/")}>
            Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}
