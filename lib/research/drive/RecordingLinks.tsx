"use client";

/**
 * lib/research/drive/RecordingLinks.tsx (spec §4.6–4.7)
 * Lists a session's screen recordings: "เปิดใน Google Drive" links, "saved on this computer",
 * or "ไม่พบไฟล์ใน Google Drive" when the customer deleted the file. Never streams video.
 * Intended for the session page: <RecordingLinks sessionId={id} />.
 */

import { useEffect, useState } from "react";
import a from "@/styles/research-a.module.css";
import { apiFetch } from "../supabase/client";

interface Rec {
  level: number;
  location: string;
  driveFileId: string | null;
  exists: boolean | null;
  viewUrl: string | null;
}

export default function RecordingLinks({ sessionId }: { sessionId: string }) {
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void apiFetch(`/api/drive/files?sessionId=${encodeURIComponent(sessionId)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!live) return;
        if (!res.ok) setErr(data.error ?? `HTTP ${res.status}`);
        else setRecs(data.recordings ?? []);
      })
      .catch(() => live && setErr("ออฟไลน์ / Offline"));
    return () => {
      live = false;
    };
  }, [sessionId]);

  if (err) return <p className={a.small}>{err}</p>;
  if (!recs) return <p className={a.small}>…</p>;
  if (recs.length === 0) return <p className={a.small}>ไม่มีวิดีโอบันทึก / No recordings.</p>;
  return (
    <ul className={a.recList}>
      {recs.map((r) => (
        <li key={r.level}>
          ระดับ / Level {r.level}:{" "}
          {r.location === "local_only" ? (
            <span className={a.small}>บันทึกไว้ในเครื่องที่ใช้คัดกรอง / Saved on the screening computer</span>
          ) : r.exists === false ? (
            <span className={a.missing}>ไม่พบไฟล์ใน Google Drive / File not found in Google Drive</span>
          ) : r.viewUrl ? (
            <a href={r.viewUrl} target="_blank" rel="noopener noreferrer">
              เปิดใน Google Drive / Open in Google Drive
            </a>
          ) : (
            <span className={a.small}>—</span>
          )}
        </li>
      ))}
    </ul>
  );
}
