/**
 * lib/research/drive/uploaderCore.ts
 * ====================================
 * Browser-side recording upload (spec §4.4 steps 3–4), with injected I/O so it can be tested:
 *   1. POST /api/drive/start-upload → Drive resumable session URL (cached per item for resume)
 *   2. PUT the Blob straight to Google in 8 MiB chunks with Content-Range; resume with "bytes * /size";
 *      retry 5xx with backoff. If the browser blocks it (TypeError = CORS), fall back to
 *      POST /api/drive/upload-chunk in 3.75 MiB chunks.
 *   3. POST /api/drive/finish-upload.
 * Throws NeedsReviewError when a person must act (reconnect, Drive full, not connected, no consent);
 * any other throw means "retry later" (the queue keeps the Blob).
 */

import type { RecordingQueueItem } from "../contracts";
import { contentRange, DIRECT_CHUNK_BYTES, DRIVE_ERR, nextOffsetFromRange, PROXY_CHUNK_BYTES } from "./config";

export interface UploaderDeps {
  /** fetch to our own /api routes with the user's JWT. */
  api: (path: string, init?: RequestInit) => Promise<Response>;
  /** plain fetch (to Google). */
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  /** Small persistent store for the upload session URL (resume after reload). */
  store: { get(k: string): string | null; set(k: string, v: string): void; del(k: string): void };
  online: () => boolean;
  /** contracts.NeedsReviewError (injected so this module loads in Node tests). */
  NeedsReview: new (code: string, message: string) => Error;
}

export class RetryLaterError extends Error {}

interface UploadSession {
  uploadUrl: string;
  uploadSig: string;
  size: number;
}

const storeKey = (id: string) => `lookatme_upload_${id}`;

const REVIEW_CODES = new Set<string>([DRIVE_ERR.needsReconnect, DRIVE_ERR.full, DRIVE_ERR.notConnected, DRIVE_ERR.noConsent]);

export const REVIEW_MESSAGES: Record<string, string> = {
  [DRIVE_ERR.needsReconnect]: "กรุณาเชื่อมต่อ Google Drive อีกครั้ง / Please reconnect Google Drive.",
  [DRIVE_ERR.full]: "Google Drive เต็ม / Google Drive is full.",
  [DRIVE_ERR.notConnected]: "ยังไม่ได้เชื่อมต่อ Google Drive / Google Drive is not connected.",
  [DRIVE_ERR.noConsent]: "ผู้ปกครองไม่ได้ยินยอมให้บันทึกวิดีโอ / No consent for video recording.",
};

/** Level of a recording item: the `level` field if present, else "…:L<n>" in blobKey. */
export function itemLevel(item: RecordingQueueItem & { level?: number }): 1 | 2 | 3 | null {
  const n = item.level ?? Number(/(?:^|[:_])L([123])(?:$|[:_])/.exec(item.blobKey)?.[1]);
  return n === 1 || n === 2 || n === 3 ? n : null;
}

async function apiJson(d: UploaderDeps, path: string, body: unknown): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await d.api(path, { method: "POST", body: JSON.stringify(body) });
  } catch {
    throw new RetryLaterError("offline");
  }
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok) return j;
  const code = typeof j.code === "string" ? j.code : "";
  if (REVIEW_CODES.has(code)) throw new d.NeedsReview(code, REVIEW_MESSAGES[code] ?? String(j.error ?? code));
  if (res.status === 401) throw new RetryLaterError("not_logged_in");
  if (res.status === 403 || res.status === 404 || res.status === 422 || res.status === 400) {
    throw new d.NeedsReview(code || `http_${res.status}`, String(j.error ?? `HTTP ${res.status}`));
  }
  throw new RetryLaterError(String(j.error ?? `HTTP ${res.status}`));
}

type Step = { done: true; fileId: string | null } | { done: false; nextOffset: number };

async function readGoogle(d: UploaderDeps, res: Response): Promise<Step> {
  if (res.status === 200 || res.status === 201) {
    const j = (await res.json().catch(() => ({}))) as { id?: string };
    return { done: true, fileId: j.id ?? null };
  }
  if (res.status === 308) return { done: false, nextOffset: nextOffsetFromRange(res.headers.get("range")) };
  const text = await res.text().catch(() => "");
  if (/storageQuotaExceeded/.test(text)) throw new d.NeedsReview(DRIVE_ERR.full, REVIEW_MESSAGES[DRIVE_ERR.full]);
  if (res.status === 404 || res.status === 410) throw new SessionGone();
  throw new HttpStatusError(res.status);
}

class SessionGone extends Error {}
class HttpStatusError extends Error {
  status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}
class CorsBlocked extends Error {}

/** One PUT straight to Google. A TypeError (network/CORS) becomes CorsBlocked when online. */
async function directPut(d: UploaderDeps, s: UploadSession, range: string, body: Blob | null): Promise<Step> {
  let res: Response;
  try {
    res = await d.fetch(s.uploadUrl, { method: "PUT", headers: { "Content-Range": range }, body });
  } catch (err) {
    if (!d.online()) throw new RetryLaterError("offline");
    if (err instanceof TypeError) throw new CorsBlocked();
    throw err;
  }
  return readGoogle(d, res);
}

async function proxyPut(d: UploaderDeps, sessionId: string, s: UploadSession, range: string, body: Blob | null): Promise<Step> {
  let res: Response;
  try {
    res = await d.api("/api/drive/upload-chunk", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Session-Id": sessionId,
        "X-Upload-Url": s.uploadUrl,
        "X-Upload-Sig": s.uploadSig,
        "X-Upload-Range": range,
      },
      body: body ?? new Blob([]),
    });
  } catch {
    throw new RetryLaterError("offline");
  }
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok) return j.done ? { done: true, fileId: (j.fileId as string) ?? null } : { done: false, nextOffset: Number(j.nextOffset) || 0 };
  if (j.code === DRIVE_ERR.full) throw new d.NeedsReview(DRIVE_ERR.full, REVIEW_MESSAGES[DRIVE_ERR.full]);
  if (j.code === "upload_session_expired") throw new SessionGone();
  throw new HttpStatusError(res.status);
}

/** Runs `fn` with retries on 5xx / 429 (exponential backoff). */
async function withRetry<T>(d: UploaderDeps, fn: () => Promise<T>, tries = 4): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const retryable = err instanceof HttpStatusError && (err.status >= 500 || err.status === 429);
      if (!retryable || i >= tries - 1) throw err;
      await d.sleep(Math.min(16_000, 1000 * 2 ** i));
    }
  }
}

/** Uploads all bytes; returns the Drive file id (null if Google's final response wasn't readable). */
export async function sendBytes(
  d: UploaderDeps,
  sessionId: string,
  s: UploadSession,
  blob: Blob,
  mode: { proxy: boolean },
): Promise<string | null> {
  const size = blob.size;
  const put = (range: string, body: Blob | null) =>
    withRetry(d, () => (mode.proxy ? proxyPut(d, sessionId, s, range, body) : directPut(d, s, range, body)));

  // Where are we? (resume: "bytes */size")
  let step: Step;
  try {
    step = await put(`bytes */${size}`, null);
  } catch (err) {
    if (err instanceof CorsBlocked && !mode.proxy) {
      mode.proxy = true;
      step = await put(`bytes */${size}`, null);
    } else throw err;
  }
  while (!step.done) {
    const chunk = mode.proxy ? PROXY_CHUNK_BYTES : DIRECT_CHUNK_BYTES;
    const start = step.nextOffset;
    if (start >= size) throw new RetryLaterError("upload_incomplete");
    const end = Math.min(start + chunk, size) - 1;
    try {
      step = await put(contentRange(start, end, size), blob.slice(start, end + 1));
    } catch (err) {
      if (err instanceof CorsBlocked && !mode.proxy) {
        mode.proxy = true;
        step = await put(`bytes */${size}`, null);
        continue;
      }
      throw err;
    }
  }
  return step.fileId;
}

export async function uploadRecordingItem(
  d: UploaderDeps,
  item: RecordingQueueItem & { level?: number },
  blob: Blob | null,
): Promise<{ fileId: string }> {
  // Offline sessions get their id after the session syncs (agent E); retry then.
  if (!item.sessionId) throw new RetryLaterError("waiting_for_session_sync");
  if (!blob) throw new d.NeedsReview("blob_missing", "ไม่พบไฟล์วิดีโอในเครื่อง / Recording file is missing on this device.");
  const level = itemLevel(item);
  if (!level) throw new d.NeedsReview("bad_item", "Recording item has no level.");
  if (!d.online()) throw new RetryLaterError("offline");

  const key = storeKey(item.id);
  const mode = { proxy: false };
  for (let attempt = 0; attempt < 2; attempt++) {
    let s: UploadSession | null = null;
    try {
      const cached = d.store.get(key);
      if (cached) {
        const c = JSON.parse(cached) as UploadSession;
        if (c.size === blob.size && c.uploadUrl) s = c;
      }
    } catch {
      s = null;
    }
    if (!s) {
      const j = await apiJson(d, "/api/drive/start-upload", {
        session_id: item.sessionId,
        level,
        size: blob.size,
        mimeType: item.mimeType || blob.type || "video/webm",
      });
      s = { uploadUrl: String(j.uploadUrl), uploadSig: String(j.uploadSig ?? ""), size: blob.size };
      d.store.set(key, JSON.stringify(s));
    }
    let fileId: string | null;
    try {
      fileId = await sendBytes(d, item.sessionId, s, blob, mode);
    } catch (err) {
      if (err instanceof SessionGone) {
        // Upload session expired (they last ~1 week): start a new one.
        d.store.del(key);
        continue;
      }
      if (err instanceof HttpStatusError) throw new RetryLaterError(err.message);
      throw err;
    }
    if (!fileId) throw new d.NeedsReview("file_id_unreadable", "Uploaded, but the Drive file id could not be read.");
    await apiJson(d, "/api/drive/finish-upload", { session_id: item.sessionId, level, drive_file_id: fileId, size: blob.size });
    d.store.del(key);
    return { fileId };
  }
  throw new RetryLaterError("upload_session_expired");
}
