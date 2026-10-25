/**
 * lib/research/drive/upload.ts — testable cores of start-upload, finish-upload and upload-chunk
 * (spec §4.4). The routes check the caller and load the session (http.ts) before calling these.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { DRIVE_ERR, driveFileName, isDriveUploadUrl, MAX_RECORDING_BYTES, PROXY_CHUNK_BYTES, CHUNK_UNIT } from "./config";
import {
  ensureChildFolder,
  getFile,
  readChunkResponse,
  startResumableUpload,
  verifyRecordingFile,
  type ChunkResult,
  type Fetch,
  type OAuthClient,
} from "./google";
import { DriveFlowError, ensureOrgRoot, getAccessToken, mapDriveError, MSG } from "./service";

export interface SessionRef {
  id: string;
  orgId: string;
  childCode: string;
  startedAt: string;
}

export interface Deps {
  svc: SupabaseClient;
  f: Fetch;
  client: OAuthClient;
}

const MIME_RE = /^video\/webm(;\s*codecs=[a-z0-9.,]+)?$/i;

export function validateUploadRequest(size: unknown, mimeType: unknown): { size: number; mimeType: string } {
  const n = Number(size);
  if (!Number.isInteger(n) || n <= 0 || n > MAX_RECORDING_BYTES) {
    throw new DriveFlowError(400, "bad_size", "size must be 1 B – 200 MB.");
  }
  const m = typeof mimeType === "string" && MIME_RE.test(mimeType) ? mimeType : "video/webm";
  return { size: n, mimeType: m };
}

export async function startUpload(
  d: Deps,
  s: SessionRef,
  req: { size: number; mimeType: string; level: number; origin: string },
): Promise<{ uploadUrl: string }> {
  const token = await getAccessToken(d.svc, d.f, d.client, s.orgId);
  try {
    const root = await ensureOrgRoot(d.svc, d.f, token, s.orgId);
    const childFolder = await ensureChildFolder(d.f, token, root, s.childCode);
    const uploadUrl = await startResumableUpload(d.f, token, {
      name: driveFileName(s.childCode, new Date(s.startedAt), req.level, s.id),
      parentId: childFolder,
      size: req.size,
      // Drive stores the container type; codecs go in the browser's Blob type only.
      mimeType: "video/webm",
      origin: req.origin,
      appProperties: { lookatme_session: s.id, lookatme_org: s.orgId, lookatme_level: String(req.level) },
    });
    return { uploadUrl };
  } catch (err) {
    if (err instanceof DriveFlowError) throw err;
    return mapDriveError(d.svc, s.orgId, err);
  }
}

export async function finishUpload(
  d: Deps,
  s: SessionRef,
  req: { driveFileId: string; level: number; size?: number },
): Promise<{ fileId: string; sizeBytes: number | null }> {
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(req.driveFileId)) throw new DriveFlowError(400, "bad_file_id", "Bad Drive file id.");
  const token = await getAccessToken(d.svc, d.f, d.client, s.orgId);
  let meta;
  try {
    meta = await getFile(d.f, token, req.driveFileId);
  } catch (err) {
    return mapDriveError(d.svc, s.orgId, err);
  }
  const why = verifyRecordingFile(meta, { sessionId: s.id, orgId: s.orgId, level: req.level, size: req.size });
  if (why) throw new DriveFlowError(422, "file_mismatch", `The Drive file does not belong to this session (${why}).`);
  const sizeBytes = meta.size !== undefined ? Number(meta.size) : (req.size ?? null);
  const { error } = await d.svc.from("session_files").upsert(
    {
      org_id: s.orgId,
      session_id: s.id,
      kind: "recording",
      level: req.level,
      location: "google_drive",
      drive_file_id: meta.id,
      path: null,
      size_bytes: sizeBytes,
    },
    { onConflict: "session_id,kind,level" },
  );
  if (error) throw new DriveFlowError(500, "db_error", error.message);
  return { fileId: meta.id, sizeBytes };
}

/** "Saved on this computer": records location='local_only' with no file id. */
export async function recordLocalOnly(svc: SupabaseClient, s: SessionRef, level: number, size: number | null): Promise<void> {
  const { error } = await svc.from("session_files").upsert(
    { org_id: s.orgId, session_id: s.id, kind: "recording", level, location: "local_only", drive_file_id: null, path: null, size_bytes: size },
    { onConflict: "session_id,kind,level" },
  );
  if (error) throw new DriveFlowError(500, "db_error", error.message);
}

const RANGE_RE = /^bytes (\d+)-(\d+)\/(\d+)$/;
const QUERY_RE = /^bytes \*\/(\d+)$/;

/**
 * Validates a proxied chunk: Content-Range must be "bytes a-b/total" with b-a+1 = body length,
 * each non-final chunk exactly PROXY_CHUNK_BYTES aligned to it, or "bytes * /total" with an empty body (status query).
 */
export function validateProxyChunk(contentRange: string, bodyLength: number): { query: boolean; start: number; end: number; total: number } {
  const q = QUERY_RE.exec(contentRange);
  if (q) {
    if (bodyLength !== 0) throw new DriveFlowError(400, "bad_range", "A status query has no body.");
    return { query: true, start: 0, end: -1, total: Number(q[1]) };
  }
  const m = RANGE_RE.exec(contentRange);
  if (!m) throw new DriveFlowError(400, "bad_range", "Bad Content-Range.");
  const [start, end, total] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (end < start || end >= total || total > MAX_RECORDING_BYTES) throw new DriveFlowError(400, "bad_range", "Bad Content-Range.");
  if (end - start + 1 !== bodyLength) throw new DriveFlowError(400, "bad_range", "Body length does not match Content-Range.");
  if (bodyLength > PROXY_CHUNK_BYTES) throw new DriveFlowError(413, "chunk_too_large", "Chunk too large (max 3.75 MiB).");
  if (start % CHUNK_UNIT !== 0) throw new DriveFlowError(400, "bad_range", "Chunk start must be a multiple of 256 KiB.");
  const last = end === total - 1;
  if (!last && bodyLength % CHUNK_UNIT !== 0) throw new DriveFlowError(400, "bad_range", "Chunks must be multiples of 256 KiB.");
  return { query: false, start, end, total };
}

/** Forwards one chunk (or a status query) to the Drive session URL. */
export async function forwardChunk(f: Fetch, uploadUrl: string, contentRange: string, body: Uint8Array): Promise<ChunkResult> {
  if (!isDriveUploadUrl(uploadUrl)) throw new DriveFlowError(400, "bad_upload_url", "Not a Google Drive upload URL.");
  const res = await f(uploadUrl, {
    method: "PUT",
    headers: { "Content-Range": contentRange, "Content-Length": String(body.byteLength) },
    body: body.byteLength ? (body as BodyInit) : null,
  });
  if (res.status === 404 || res.status === 410) throw new DriveFlowError(410, "upload_session_expired", "Upload session expired.");
  try {
    return await readChunkResponse(res);
  } catch (err) {
    if (err instanceof Error && /storageQuotaExceeded/.test(err.message)) throw new DriveFlowError(507, DRIVE_ERR.full, MSG.full);
    throw err;
  }
}
