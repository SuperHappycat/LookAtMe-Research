"use client";

/**
 * Offline status chip (spec §5.4): ออนไลน์ / ออฟไลน์ / รอส่งข้อมูล N รายการ / ต้องตรวจสอบ N.
 * Links to /r/offline. Meant for the Research top bar (ResearchShell, owned by the lead).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { counts, onChange } from "@/lib/research/queue";
import type { QueueCounts } from "@/lib/research/offline/queueCore";
import css from "./offline.module.css";

export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

export function useQueueCounts(): QueueCounts {
  const [c, setC] = useState<QueueCounts>({ pending: 0, needsReview: 0, offlineSessions: 0 });
  useEffect(() => {
    let alive = true;
    const load = () =>
      counts()
        .then((v) => alive && setC(v))
        .catch(() => undefined);
    load();
    const off = onChange(load);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return c;
}

export default function SyncStatusChip({ href = "/r/offline" }: { href?: string }) {
  const online = useOnline();
  const c = useQueueCounts();

  let cls = css.chipOnline;
  let label = "ออนไลน์ / Online";
  if (c.needsReview > 0) {
    cls = css.chipReview;
    label = `ต้องตรวจสอบ ${c.needsReview} / Needs review ${c.needsReview}`;
  } else if (c.pending > 0) {
    cls = css.chipPending;
    label = `รอส่งข้อมูล ${c.pending} รายการ / ${c.pending} waiting to upload`;
  } else if (!online) {
    cls = css.chipOffline;
    label = "ออฟไลน์ / Offline";
  }
  if (!online && (c.pending > 0 || c.needsReview > 0)) label = `ออฟไลน์ · ${label}`;

  return (
    <Link href={href} className={`${css.chip} ${cls}`} aria-live="polite" title="ข้อมูลออฟไลน์ / Offline data">
      {label}
    </Link>
  );
}
