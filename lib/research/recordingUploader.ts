"use client";

/**
 * lib/research/recordingUploader.ts
 * ===================================
 * Registers the "recording" uploader with the upload queue (lib/research/queue.ts) and decides
 * what happens to a finished level recording:
 *  - device preference "local_only", or the org has no Drive connected → download the .webm
 *    (<childCode>_<YYYYMMDD-HHmm>_L<level>.webm) and record location='local_only';
 *  - otherwise → enqueue a RecordingQueueItem with the Blob (the queue keeps it until uploaded).
 *
 * Import this module once on any page that should sync recordings (it registers on import).
 */

import { NeedsReviewError, type DriveStatus, type RecordingQueueItem, type RecordingResult } from "./contracts";
import { enqueue, registerUploader } from "./queue";
import { apiFetch } from "./supabase/client";
import type { ResearchContext } from "./screening";
import { localFileName, readRecordingTarget } from "./drive/config";
import { uploadRecordingItem, type UploaderDeps } from "./drive/uploaderCore";

const browserDeps: UploaderDeps = {
  api: apiFetch,
  fetch: (...a) => fetch(...a),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  store: {
    get: (k) => {
      try {
        return window.localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k, v) => {
      try {
        window.localStorage.setItem(k, v);
      } catch {
        // ignore
      }
    },
    del: (k) => {
      try {
        window.localStorage.removeItem(k);
      } catch {
        // ignore
      }
    },
  },
  online: () => (typeof navigator === "undefined" ? true : navigator.onLine !== false),
  NeedsReview: NeedsReviewError,
};

/** A recording item with its level (contracts.RecordingQueueItem has no level field yet; also encoded in blobKey). */
export type LevelRecordingItem = RecordingQueueItem & { level: 1 | 2 | 3 };

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function recordLocalOnly(sessionId: string | null, level: number, size: number) {
  if (!sessionId) return; // offline session: nothing to record yet (file is on this computer)
  try {
    await apiFetch("/api/drive/finish-upload", {
      method: "POST",
      body: JSON.stringify({ session_id: sessionId, level, location: "local_only", size }),
    });
  } catch {
    // best effort
  }
}

export const recordingUploader = async (item: RecordingQueueItem, blob: Blob | null): Promise<void> => {
  if (item.target === "local_only") {
    // The queue should never hold these, but if it does: save locally and finish.
    const level = (item as Partial<LevelRecordingItem>).level ?? 0;
    if (blob) downloadBlob(blob, localFileName(item.childCode, new Date(item.createdAt), level));
    await recordLocalOnly(item.sessionId, level, item.size);
    return;
  }
  await uploadRecordingItem(browserDeps, item, blob);
};

registerUploader("recording", recordingUploader);

/** Drive status for the org, or null when unknown (offline / error). */
async function driveStatus(orgId: string): Promise<DriveStatus | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    const res = await apiFetch(`/api/drive/status?orgId=${encodeURIComponent(orgId)}`, { signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return ((await res.json()) as { status: DriveStatus }).status;
  } catch {
    return null;
  }
}

function uuid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

/** Called by researchLogger when a level's recording has stopped. */
export async function handleFinishedRecording(result: RecordingResult, ctx: ResearchContext, level: 1 | 2 | 3): Promise<void> {
  const sessionId = ctx.sessionId || null;
  const now = new Date();
  let target = readRecordingTarget();
  if (target === "google_drive") {
    const st = await driveStatus(ctx.orgId);
    // No Drive connected (or disconnected) → save on this computer (spec §4.6).
    // needs_reconnect / unknown (offline) → keep it queued for Drive.
    if (st === "not_connected" || st === "revoked") target = "local_only";
  }
  if (target === "local_only") {
    downloadBlob(result.blob, localFileName(ctx.childCode, now, level));
    await recordLocalOnly(sessionId, level, result.blob.size);
    return;
  }
  const id = uuid();
  const item: LevelRecordingItem = {
    id,
    kind: "recording",
    createdAt: now.toISOString(),
    orgId: ctx.orgId,
    attempts: 0,
    sessionId,
    clientSessionId: ctx.clientSessionId,
    childCode: ctx.childCode,
    blobKey: `rec:${ctx.clientSessionId}:L${level}:${id}`,
    mimeType: result.mimeType,
    size: result.blob.size,
    target: "google_drive",
    level,
  };
  await enqueue(item, result.blob);
}
