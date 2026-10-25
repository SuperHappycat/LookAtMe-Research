"use client";

/**
 * components/research/DriveSpikeClient.tsx
 * ==========================================
 * DEV-ONLY page for the Google Drive CORS spike (spec §4.4).
 *
 * Answers one question: can the browser upload bytes straight to a Drive
 * resumable-upload URL that our server created? It uploads a 2 MiB test file
 * in two chunks (1 MiB + 1 MiB, each a multiple of 256 KiB) with
 * Content-Range, exactly like real recordings will.
 *
 * - Both chunks succeed  -> direct browser upload works (preferred design).
 * - A TypeError / network error on PUT -> CORS blocked; use the server
 *   chunk-proxy fallback (spec §4.4, 3.75 MiB chunks).
 */

import { useState } from "react";
import styles from "@/styles/shared.module.css";
import rs from "@/styles/research.module.css";

const CHUNK = 1024 * 1024; // 1 MiB = 4 × 256 KiB
const TOTAL = 2 * CHUNK;

export default function DriveSpikeClient() {
  const [token, setToken] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const add = (line: string) => setLog((l) => [...l, line]);

  async function run() {
    setBusy(true);
    setLog([]);
    try {
      add("1. Asking our server to start a resumable upload session…");
      const startRes = await fetch("/api/dev/drive-spike", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: token, size: TOTAL }),
      });
      const start = await startRes.json();
      if (!startRes.ok) {
        add(`   FAILED: ${start.error ?? startRes.status} ${start.detail ?? ""}`);
        return;
      }
      add(`   OK. Session created for origin ${start.origin}.`);

      const bytes = new Uint8Array(TOTAL);
      crypto.getRandomValues(bytes.subarray(0, 65536));
      const blob = new Blob([bytes], { type: "application/octet-stream" });

      for (let offset = 0; offset < TOTAL; offset += CHUNK) {
        const end = Math.min(offset + CHUNK, TOTAL) - 1;
        add(`2. Browser PUT bytes ${offset}-${end}/${TOTAL} directly to Google…`);
        let res: Response;
        try {
          res = await fetch(start.uploadUrl, {
            method: "PUT",
            headers: { "Content-Range": `bytes ${offset}-${end}/${TOTAL}` },
            body: blob.slice(offset, end + 1),
          });
        } catch (err) {
          add(`   BLOCKED by the browser (${err instanceof Error ? err.message : String(err)}).`);
          add("RESULT: direct browser upload does NOT work -> use the server chunk-proxy fallback (spec §4.4).");
          return;
        }
        add(`   HTTP ${res.status}`);
        if (res.status === 308) continue; // more chunks expected
        if (res.ok) {
          const file = await res.json().catch(() => ({}));
          add(`RESULT: direct browser upload WORKS. Drive file id: ${file.id ?? "(not readable)"}.`);
          add("You can delete the test file (lookatme-cors-test-….bin) from your Drive.");
          return;
        }
        add(`RESULT: unexpected status ${res.status}: ${(await res.text()).slice(0, 300)}`);
        return;
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.pageNarrow}>
      <h1 className={styles.titleCentered}>Drive upload test (dev only)</h1>
      <div className={styles.card}>
        <ol className={rs.steps}>
          <li>
            Open Google&apos;s OAuth 2.0 Playground, choose scope{" "}
            <code>https://www.googleapis.com/auth/drive.file</code>, authorize with a test Google account, then
            &quot;Exchange authorization code for tokens&quot;.
          </li>
          <li>Paste the access token below and run the test. The token is used once and not stored.</li>
        </ol>
        <label htmlFor="tok">Access token</label>
        <input
          id="tok"
          className={rs.textInput}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="ya29.…"
          autoComplete="off"
        />
        <button className={styles.primaryButton} disabled={!token || busy} onClick={run}>
          {busy ? "Running…" : "Run upload test"}
        </button>
        {log.length > 0 && <div className={rs.log}>{log.join("\n")}</div>}
      </div>
    </div>
  );
}
