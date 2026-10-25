"use client";

/** Export for SPSS / R (Hospital, feature raw_export): wide and long CSVs, a codebook and an R snippet. Admins only. */

import { useState } from "react";
import styles from "@/styles/shared.module.css";
import rs from "@/styles/research.module.css";
import cs from "@/styles/research-c.module.css";
import { friendlyError } from "@/lib/research/supabase/client";
import { codebookCsv, longCsv, rSnippet, wideCsv } from "@/lib/research/analysis/exports";
import type { AnalysisSession } from "@/lib/research/analysis/sessions";
import { loggedDownload, today } from "./common";

type Kind = "wide" | "long" | "codebook" | "r";

export default function ExportTab({ orgId, isAdmin, sessions }: { orgId: string; isAdmin: boolean; sessions: AnalysisSession[] }) {
  const [busy, setBusy] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const d = today();
  const names = { wide: `lookatme-wide-${d}.csv`, long: `lookatme-long-${d}.csv`, codebook: `lookatme-codebook-${d}.csv`, r: `lookatme-read-${d}.R` };
  const snippet = rSnippet(names.wide, names.long);

  async function run(kind: Kind) {
    setBusy(kind);
    setError(null);
    try {
      const n = sessions.length;
      if (kind === "wide") await loggedDownload(orgId, `spss/r wide: ${n} sessions`, names.wide, wideCsv(sessions));
      if (kind === "long") await loggedDownload(orgId, `spss/r long: ${n} sessions`, names.long, longCsv(sessions));
      if (kind === "codebook") await loggedDownload(orgId, "spss/r codebook", names.codebook, codebookCsv());
      if (kind === "r") await loggedDownload(orgId, "spss/r R snippet", names.r, snippet, "text/plain;charset=utf-8");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(null);
    }
  }

  if (!isAdmin) {
    return (
      <div className={styles.card}>
        <p className={rs.muted} style={{ margin: 0 }}>
          เฉพาะผู้ดูแลเท่านั้นที่ส่งออกข้อมูลได้ / Only organization admins can export data.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <p style={{ marginTop: 0 }}>
        {sessions.length} ครั้งตามตัวกรองด้านบน / sessions selected by the filters above. ใช้รหัสเท่านั้น ไม่มีชื่อ / Coded IDs only
        (child code and session ID).
      </p>
      <div className={styles.saveRow}>
        <button className={styles.primaryButton} disabled={!!busy || !sessions.length} onClick={() => run("wide")}>
          {busy === "wide" ? "…" : "แบบกว้าง (1 แถว/ครั้ง) / Wide CSV"}
        </button>
        <button className={styles.primaryButton} disabled={!!busy || !sessions.length} onClick={() => run("long")}>
          {busy === "long" ? "…" : "แบบยาว (1 แถว/ครั้ง×ระดับ) / Long CSV"}
        </button>
        <button className={styles.secondaryButton} disabled={!!busy} onClick={() => run("codebook")}>
          {busy === "codebook" ? "…" : "คู่มือตัวแปร / Codebook CSV"}
        </button>
        <button className={styles.secondaryButton} disabled={!!busy} onClick={() => run("r")}>
          {busy === "r" ? "…" : "สคริปต์ R / R script"}
        </button>
      </div>
      {error && <p className={styles.errorText}>{error}</p>}
      <p className={cs.note}>
        ไฟล์เป็น UTF-8 พร้อม BOM ค่าว่าง = ไม่มีข้อมูล ค่าจริง/เท็จ = 1/0 / Files are UTF-8 with a BOM; empty cell = missing; true/false =
        1/0. SPSS: File → Import Data → CSV, encoding UTF-8. ไฟล์การมองรายจุดอยู่ที่หน้าผลการคัดกรอง / Per-sample gaze data is exported from
        the Results page.
      </p>
      <h3 className={rs.sectionTitle}>R</h3>
      <pre className={cs.code}>{snippet}</pre>
    </div>
  );
}
