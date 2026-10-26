"use client";

/**
 * /r/offline — what this device holds for offline mode (spec §5.4):
 * children saved for offline screening, screenings/recordings waiting to upload, items that
 * need review (retry / delete), and "clear offline data on this device".
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "@/styles/shared.module.css";
import rs from "@/styles/research.module.css";
import type { QueueItem } from "@/lib/research/contracts";
import { pending, onChange, removeItem, retryItem, syncNow } from "@/lib/research/queue";
import { cachedChildren, cachedPlan, forgetCachedChild, pruneCachedChildren, startScreening } from "@/lib/research/offline/start";
import { clearOfflineData } from "@/lib/research/offline/boot";
import type { CachedChild, CachedPlan } from "@/lib/research/offline/rules";
import { OFFLINE_CONFIG } from "@/lib/research/offline/config";
import { ageInMonths } from "@/lib/research/screening";
import { getGazeEngine } from "@/lib/research/gaze";
import { friendlyError } from "@/lib/research/supabase/client";
import { canWrite, useResearch } from "../ResearchShell";
import SyncStatusChip, { useOnline } from "./SyncStatusChip";
import { useAssent } from "../AssentDialog";
import css from "./offline.module.css";

const fmt = (iso: string) => {
  try {
    return new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
};

export default function OfflineClient() {
  const router = useRouter();
  const { ask: askAssent, dialog: assentDialog } = useAssent();
  const { active } = useResearch();
  const orgId = active?.org.id;
  const online = useOnline();
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [kids, setKids] = useState<CachedChild[]>([]);
  const [plan, setPlan] = useState<CachedPlan | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    await pruneCachedChildren();
    const [p, k, pl] = await Promise.all([pending(), cachedChildren(orgId), orgId ? cachedPlan(orgId) : null]);
    setItems(p);
    setKids(k);
    setPlan(pl);
  }, [orgId]);

  // Keep the camera-check route ready so "start offline" can navigate without the network.
  useEffect(() => {
    router.prefetch("/r/check");
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- IndexedDB load; state is set after it resolves
    void load();
    return onChange(() => void load());
  }, [load]);

  const codeFor = (it: QueueItem) =>
    it.kind === "recording" ? it.childCode : (kids.find((k) => k.id === it.childId)?.code ?? "—");

  async function start(c: CachedChild) {
    const assent = await askAssent(c.code);
    if (!assent) return;
    setBusy(c.id);
    setError(null);
    try {
      await startScreening({
        child: { id: c.id, org_id: c.org_id, code: c.code, birth_month: c.birth_month },
        ageMonths: ageInMonths(c.birth_month),
        engine: getGazeEngine().name,
        allowRecording: c.consent.allow_recording,
        blind: !!c.blind,
        assent,
      });
      router.push("/r/check");
    } catch (err) {
      setError(friendlyError(err));
      setBusy(null);
    }
  }

  async function del(it: QueueItem) {
    const what = it.kind === "recording" ? "วิดีโอบันทึกหน้าจอ / screen recording" : "ผลการคัดกรอง / screening result";
    if (
      !window.confirm(
        `ลบ${what} (${codeFor(it)}) ออกจากเครื่องนี้? ข้อมูลที่ยังไม่ได้ส่งจะหายไปถาวร\nDelete this ${what.split(" / ")[1]} from this device? Data not yet uploaded is lost for good.`,
      )
    )
      return;
    await removeItem(it.id);
  }

  async function clearAll() {
    const n = items?.length ?? 0;
    const warn =
      n > 0
        ? `มี ${n} รายการที่ยังไม่ได้ส่ง ซึ่งจะหายไปถาวร\n${n} item(s) not yet uploaded will be lost for good.\n\n`
        : "";
    if (!window.confirm(`${warn}ล้างข้อมูลออฟไลน์ทั้งหมดในเครื่องนี้? / Clear all offline data on this device?`)) return;
    await clearOfflineData();
    setNotice("ล้างข้อมูลออฟไลน์ในเครื่องแล้ว / Offline data cleared from this device.");
    void load();
  }

  async function syncAll() {
    setBusy("sync");
    await syncNow();
    setBusy(null);
  }

  const waiting = (items ?? []).filter((i) => !i.needsReview);
  const review = (items ?? []).filter((i) => i.needsReview);
  const offlineCount = (items ?? []).filter((i) => i.kind === "offline_session").length;
  const writer = canWrite(active);

  const row = (it: QueueItem) => (
    <li key={it.id} className={`${css.listItem} ${it.needsReview ? css.review : ""}`}>
      <div className={css.grow}>
        <strong>{codeFor(it)}</strong> ·{" "}
        {it.kind === "recording" ? "วิดีโอบันทึกหน้าจอ / Screen recording" : "ผลการคัดกรอง / Screening"}
        <div className={css.small}>
          {fmt(it.createdAt)} · พยายามส่ง / attempts {it.attempts}
          {it.lastError && <> · {friendlyError({ message: it.lastError })}</>}
        </div>
      </div>
      <div className={css.actions}>
        <button className={styles.secondaryButton} onClick={() => retryItem(it.id)} disabled={!online}>
          ลองส่งอีกครั้ง / Retry
        </button>
        <button className={styles.dangerButton} onClick={() => del(it)}>
          ลบ / Delete
        </button>
      </div>
    </li>
  );

  return (
    <div className={rs.wide}>
      {assentDialog}
      <div className={css.headerRow}>
        <h1 style={{ fontSize: 26 }}>ข้อมูลออฟไลน์ / Offline data</h1>
        <SyncStatusChip />
        <button className={styles.secondaryButton} onClick={syncAll} disabled={!online || busy === "sync"}>
          {busy === "sync" ? "กำลังส่ง… / Uploading…" : "ส่งข้อมูลตอนนี้ / Upload now"}
        </button>
      </div>
      {error && <p className={styles.errorText}>{error}</p>}
      {notice && <p className={styles.successText}>{notice}</p>}

      {review.length > 0 && (
        <>
          <h2 className={rs.sectionTitle}>ต้องตรวจสอบ / Needs review ({review.length})</h2>
          <p className={rs.muted} style={{ marginBottom: 10 }}>
            เซิร์ฟเวอร์ไม่รับรายการเหล่านี้ (เช่น ใช้โควตาครบ แผนหมดอายุ หรือไม่มีใบยินยอม) ข้อมูลยังเก็บไว้ในเครื่อง
            แก้ไขปัญหาแล้วกด &ldquo;ลองส่งอีกครั้ง&rdquo; / The server refused these (e.g. quota used up, plan expired,
            no consent). The data is still on this device: fix the cause, then press Retry.
          </p>
          <ul className={css.list}>{review.map(row)}</ul>
        </>
      )}

      <h2 className={rs.sectionTitle}>รอส่งข้อมูล / Waiting to upload ({waiting.length})</h2>
      {items === null ? (
        <p>กำลังโหลด… / Loading…</p>
      ) : waiting.length === 0 ? (
        <p className={rs.muted}>ไม่มีรายการรอส่ง / Nothing waiting.</p>
      ) : (
        <ul className={css.list}>{waiting.map(row)}</ul>
      )}

      <h2 className={rs.sectionTitle}>เด็กที่บันทึกไว้สำหรับคัดกรองออฟไลน์ / Children saved for offline screening</h2>
      <p className={rs.muted} style={{ marginBottom: 10 }}>
        เปิดหน้าเด็กขณะออนไลน์เพื่อบันทึกไว้ในเครื่อง · คัดกรองออฟไลน์ได้สูงสุด {OFFLINE_CONFIG.maxOfflineSessions} ครั้งก่อนส่งข้อมูล
        (รออยู่ {offlineCount}) / Open a child&apos;s page while online to save it here · up to{" "}
        {OFFLINE_CONFIG.maxOfflineSessions} offline screenings before uploading ({offlineCount} waiting).
        {plan && (
          <>
            {" "}
            · แผนหมดอายุ / plan expires {plan.expiresOn}
            {plan.quotaLeft !== null && ` · โควตาคงเหลือ / quota left ${plan.quotaLeft}`} (ณ / as of {fmt(plan.cachedAt)})
          </>
        )}
      </p>
      {kids.length === 0 ? (
        <p className={rs.muted}>ยังไม่มีเด็กที่บันทึกไว้ในเครื่องนี้ / No children saved on this device yet.</p>
      ) : (
        <ul className={css.list}>
          {kids.map((c) => {
            const age = ageInMonths(c.birth_month);
            return (
              <li key={c.id} className={css.listItem}>
                <div className={css.grow}>
                  <strong>{c.code}</strong>
                  {age !== null && <> · {age} เดือน / months</>}
                  <div className={css.small}>
                    ยินยอม / consent ✓{c.consent.allow_recording ? " · บันทึกวิดีโอได้ / recording OK" : ""} · บันทึกเมื่อ /
                    saved {fmt(c.cachedAt)}
                  </div>
                </div>
                <div className={css.actions}>
                  {writer && (
                    <button className={styles.primaryButton} onClick={() => start(c)} disabled={busy !== null}>
                      {busy === c.id
                        ? "กำลังเริ่ม… / Starting…"
                        : online
                          ? "เริ่มคัดกรอง / Start screening"
                          : "เริ่มคัดกรองแบบออฟไลน์ / Start offline screening"}
                    </button>
                  )}
                  <button
                    className={rs.linkButton}
                    onClick={async () => {
                      await forgetCachedChild(c.id);
                      void load();
                    }}
                  >
                    เอาออกจากเครื่อง / Remove from device
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className={css.note}>
        <strong>ความเป็นส่วนตัว / Privacy:</strong> ข้อมูลออฟไลน์ (รหัสเด็ก เดือนเกิด สถานะใบยินยอม ผลการคัดกรอง
        ข้อมูลการมอง และวิดีโอที่ยังไม่ได้ส่ง) เก็บในเบราว์เซอร์ของเครื่องนี้เท่านั้น จนกว่าจะส่งสำเร็จ ไม่มีชื่อเด็ก
        ใช้เครื่องร่วมกันให้ล้างข้อมูลหลังใช้งาน ข้อมูลจะถูกล้างเมื่อออกจากระบบ / Offline data (child codes, birth months,
        consent flags, results, gaze data and recordings not yet uploaded) is kept only in this browser on this device
        until it uploads. No child names. On a shared device, clear it after use; it is also cleared when you log out.
        <div style={{ marginTop: 10 }}>
          <button className={styles.dangerButton} onClick={clearAll}>
            ล้างข้อมูลออฟไลน์ในเครื่องนี้ / Clear offline data on this device
          </button>
        </div>
      </div>
    </div>
  );
}
