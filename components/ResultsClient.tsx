"use client";

/**
 * components/ResultsClient.tsx
 * ==============================
 * Web port of gui/results_viewer.py's "Previous Results" page. Reads
 * back saved sessions via GET /api/list-results (Google Sheets) instead
 * of listing SQLite `sessions` rows. No PDF report to open here (the
 * desktop app's "Open Report" button has no web equivalent yet).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "@/styles/shared.module.css";
import type { ResultRow } from "@/app/api/list-results/route";

const RISK_COLORS: Record<string, string> = { Low: "#2e7d32", Moderate: "#f9a825", High: "#c62828" };

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; rows: ResultRow[] };

export default function ResultsClient() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/list-results")
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setState({ status: "error", message: data.error || "Failed to load results." });
        } else {
          setState({ status: "ready", rows: data.results });
        }
      })
      .catch((err) => {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={styles.page}>
      <h1 className={styles.titleCentered}>Previous Results</h1>

      {state.status === "loading" && <div className={styles.card}>Loading…</div>}

      {state.status === "error" && (
        <div className={styles.card}>
          <p className={styles.errorText}>{state.message}</p>
        </div>
      )}

      {state.status === "ready" && state.rows.length === 0 && (
        <div className={styles.card}>No previous sessions yet.</div>
      )}

      {state.status === "ready" &&
        state.rows.map((row, i) => (
          <div key={i} className={styles.sessionRow}>
            <strong>{new Date(row.timestamp).toLocaleString()}</strong>
            <span>{row.name}</span>
            <span>{row.province}</span>
            <span>Score: {row.overallScore ? `${row.overallScore}/100` : "N/A"}</span>
            {row.riskLevel && (
              <span
                className={styles.riskBadge}
                style={{ background: RISK_COLORS[row.riskLevel] ?? "#607d8b" }}
              >
                {row.riskLevel}
              </span>
            )}
          </div>
        ))}

      <div className={styles.navRow}>
        <Link href="/" className={styles.navButton} style={{ background: "#90a4ae" }}>
          Back to Home
        </Link>
      </div>
    </div>
  );
}
