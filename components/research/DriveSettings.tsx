"use client";

/**
 * components/research/DriveSettings.tsx — /r/settings (org admins).
 * Google Drive connection (spec §4.3, §4.6) and this device's recording target.
 */

import { useCallback, useEffect, useState } from "react";
import styles from "@/styles/shared.module.css";
import rs from "@/styles/research.module.css";
import a from "@/styles/research-a.module.css";
import { apiFetch } from "@/lib/research/supabase/client";
import type { DriveStatus, QueueItem } from "@/lib/research/contracts";
import { readRecordingTarget, writeRecordingTarget, type RecordingTarget } from "@/lib/research/drive/config";
import { onChange, pending, syncNow } from "@/lib/research/queue";
import "@/lib/research/recordingUploader";
import { useResearch } from "./ResearchShell";

interface StatusInfo {
  status: DriveStatus;
  googleEmail: string | null;
  connectedAt: string | null;
  lastError: string | null;
  hasFolder: boolean;
}

const REASONS: Record<string, string> = {
  access_denied: "ยกเลิกการอนุญาตใน Google / Permission was not granted in Google.",
  no_refresh_token:
    "Google ไม่ได้ส่งสิทธิ์ระยะยาวมา กรุณาเชื่อมต่ออีกครั้ง / Google did not grant offline access. Please connect again.",
  state_expired: "หมดเวลา กรุณาลองใหม่ / The connect link expired. Please try again.",
  bad_state: "ลิงก์ไม่ถูกต้อง กรุณาลองใหม่จากหน้านี้ / Invalid connect link. Please start again from this page.",
  not_admin: "เฉพาะผู้ดูแล / Admins only.",
  folder_failed:
    "เชื่อมต่อแล้ว แต่สร้างโฟลเดอร์ไม่สำเร็จ ระบบจะลองใหม่ตอนอัปโหลด / Connected, but the folder could not be created yet; it will be retried on upload.",
};

const STATUS_LABEL: Record<DriveStatus, string> = {
  not_connected: "ยังไม่ได้เชื่อมต่อ / Not connected",
  active: "เชื่อมต่อแล้ว / Connected",
  needs_reconnect: "ต้องเชื่อมต่อใหม่ / Needs reconnecting",
  revoked: "ยกเลิกการเชื่อมต่อแล้ว / Disconnected",
};

export default function DriveSettings() {
  const { active } = useResearch();
  const orgId = active?.org.id;
  const [info, setInfo] = useState<StatusInfo | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<RecordingTarget>("google_drive");
  const [queued, setQueued] = useState<QueueItem[]>([]);

  const load = useCallback(async () => {
    if (!orgId) return;
    const res = await apiFetch(`/api/drive/status?orgId=${orgId}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg({ ok: false, text: data.error ?? `HTTP ${res.status}` });
      return;
    }
    setInfo(data as StatusInfo);
  }, [orgId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data load; state is set after the request resolves
    void load();
  }, [load]);

  useEffect(() => {
    // Device preference and the result of the Google redirect (?drive=connected|error&reason=…).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads browser-only state once on mount
    setTarget(readRecordingTarget());
    const q = new URLSearchParams(window.location.search);
    const d = q.get("drive");
    if (d === "connected") setMsg({ ok: true, text: "เชื่อมต่อ Google Drive แล้ว / Google Drive connected." });
    else if (d === "error") {
      const r = q.get("reason") ?? "";
      setMsg({ ok: false, text: REASONS[r] ?? `เชื่อมต่อไม่สำเร็จ / Could not connect (${r || "error"}).` });
    }
    if (d) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  useEffect(() => {
    const refresh = () => void pending().then((p) => setQueued(p.filter((i) => i.kind === "recording")));
    refresh();
    return onChange(refresh);
  }, []);

  if (active?.role !== "admin") {
    return (
      <div className={rs.wide}>
        <div className={styles.card}>เฉพาะผู้ดูแล / Admins only.</div>
      </div>
    );
  }

  async function connect() {
    setBusy(true);
    setMsg(null);
    const res = await apiFetch("/api/drive/connect", { method: "POST", body: JSON.stringify({ orgId }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) {
      setBusy(false);
      setMsg({ ok: false, text: data.error ?? `HTTP ${res.status}` });
      return;
    }
    window.location.href = data.url;
  }

  async function disconnect() {
    if (
      !window.confirm(
        "ยกเลิกการเชื่อมต่อ Google Drive? ไฟล์ที่อัปโหลดแล้วยังอยู่ใน Drive ของคุณ / Disconnect Google Drive? Uploaded files stay in your Drive.",
      )
    )
      return;
    setBusy(true);
    const res = await apiFetch("/api/drive/disconnect", { method: "POST", body: JSON.stringify({ orgId }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: "ยกเลิกการเชื่อมต่อแล้ว / Disconnected." } : { ok: false, text: data.error });
    void load();
  }

  function chooseTarget(t: RecordingTarget) {
    writeRecordingTarget(t);
    setTarget(t);
  }

  const st = info?.status;
  const connected = st === "active";
  const reviewCount = queued.filter((q) => q.needsReview).length;

  return (
    <div className={rs.wide}>
      <h1 className={styles.title}>ตั้งค่า / Settings</h1>

      {st === "needs_reconnect" && (
        <div className={a.bannerWarn} role="alert">
          <strong>กรุณาเชื่อมต่อ Google Drive อีกครั้ง</strong> / Please reconnect Google Drive. วิดีโอที่รออยู่จะยังเก็บไว้ในเครื่อง
          และเจ้าหน้าที่ยังคัดกรองต่อได้ / Waiting recordings stay on the device, and staff can keep screening.
        </div>
      )}
      {connected && info?.lastError === "storage_quota" && (
        <div className={a.bannerWarn} role="alert">
          <strong>Google Drive เต็ม</strong> / Google Drive is full. วิดีโอจะรออยู่ในคิวจนกว่าจะมีพื้นที่ / Recordings stay queued
          until there is space.
        </div>
      )}
      {msg && <div className={msg.ok ? a.bannerOk : a.bannerWarn}>{msg.text}</div>}

      <section className={styles.card}>
        <h2 className={rs.sectionTitle}>Google Drive</h2>
        <p className={a.small}>
          วิดีโอบันทึกหน้าจอเก็บใน Google Drive ขององค์กรคุณเอง ไม่ใช่บนเซิร์ฟเวอร์ LookAtMe แอปเห็นเฉพาะไฟล์ที่แอปสร้างเท่านั้น /
          Screen recordings are stored in your organization&apos;s own Google Drive, never on LookAtMe servers. The app can
          only see files it created.
        </p>
        <div className={a.statusLine}>
          <span className={connected ? a.dotActive : st === "needs_reconnect" ? a.dotWarn : a.dot} aria-hidden />
          <strong>{st ? STATUS_LABEL[st] : "…"}</strong>
          {info?.googleEmail && <span className={a.small}>{info.googleEmail}</span>}
          {info?.connectedAt && connected && (
            <span className={a.small}>ตั้งแต่ / since {new Date(info.connectedAt).toLocaleDateString()}</span>
          )}
        </div>
        <div className={a.actions}>
          <button className={styles.primaryButton} type="button" onClick={connect} disabled={busy || !info}>
            {connected || st === "needs_reconnect"
              ? "เชื่อมต่อใหม่ / Reconnect Google Drive"
              : "เชื่อมต่อ Google Drive / Connect Google Drive"}
          </button>
          {(connected || st === "needs_reconnect") && (
            <button className={styles.secondaryButton} type="button" onClick={disconnect} disabled={busy}>
              ยกเลิกการเชื่อมต่อ / Disconnect
            </button>
          )}
        </div>
        <p className={a.small}>
          ช่วงทดลอง Google ให้สิทธิ์ประมาณ 7 วัน จึงอาจต้องเชื่อมต่อใหม่ทุกสัปดาห์ / During the prototype Google access lasts about
          7 days, so you may need to reconnect weekly.
        </p>
      </section>

      <section className={styles.card} style={{ marginTop: 16 }}>
        <h2 className={rs.sectionTitle}>บันทึกวิดีโอจากเครื่องนี้ / Recordings from this computer</h2>
        <p className={a.small}>
          บันทึกเฉพาะเมื่อผู้ปกครองยินยอมให้บันทึกวิดีโอ ตั้งค่านี้ใช้กับเครื่องนี้เท่านั้น / Recorded only when the parent consented to
          video recording. This setting applies to this computer only.
        </p>
        <label className={target === "google_drive" ? a.choiceOn : a.choice}>
          <input
            type="radio"
            name="rec-target"
            checked={target === "google_drive"}
            onChange={() => chooseTarget("google_drive")}
          />
          <span>
            <strong>Google Drive</strong>
            <br />
            <span className={a.small}>
              อัปโหลดอัตโนมัติ ถ้ายังไม่ได้เชื่อมต่อ Drive จะบันทึกในเครื่องแทน / Uploaded automatically. If Drive is not connected,
              the file is saved on this computer instead.
            </span>
          </span>
        </label>
        <label className={target === "local_only" ? a.choiceOn : a.choice}>
          <input type="radio" name="rec-target" checked={target === "local_only"} onChange={() => chooseTarget("local_only")} />
          <span>
            <strong>บันทึกในเครื่องนี้ / Save on this computer</strong>
            <br />
            <span className={a.small}>
              ดาวน์โหลดไฟล์ .webm หลังแต่ละระดับ (ชื่อไฟล์ใช้รหัสเด็ก ไม่มีชื่อจริง) / Downloads a .webm after each level (file
              names use the child code, never a name).
            </span>
          </span>
        </label>
        {queued.length > 0 && (
          <div className={a.statusLine}>
            <span>
              วิดีโอรออัปโหลด / Recordings waiting: <strong>{queued.length}</strong>
              {reviewCount > 0 && ` · ต้องตรวจสอบ / need attention: ${reviewCount}`}
            </span>
            <button className={styles.secondaryButton} type="button" onClick={() => void syncNow()}>
              ลองอีกครั้ง / Retry now
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
