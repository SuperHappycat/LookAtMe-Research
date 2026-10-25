/**
 * lib/research/drive/google.ts
 * ==============================
 * Thin Google OAuth + Drive v3 REST client (spec §4.3–4.4) with an injectable `fetch`
 * so everything is testable without network access. Server-side only: it handles
 * refresh and access tokens, which must never reach the browser or the logs.
 *
 * Errors are DriveApiError with a stable `code`:
 *   invalid_grant      refresh token expired / revoked  → set needs_reconnect
 *   storage_quota      Drive is full (storageQuotaExceeded)
 *   not_found          file or folder gone (404) or no access
 *   no_refresh_token   Google did not return a refresh token
 *   http               anything else
 */

import {
  DRIVE_FILES_URL,
  DRIVE_UPLOAD_URL,
  FOLDER_MIME,
  GOOGLE_AUTH_URL,
  GOOGLE_REVOKE_URL,
  GOOGLE_TOKEN_URL,
  OAUTH_SCOPES,
} from "./config";

export type Fetch = typeof fetch;

export type DriveErrorCode = "invalid_grant" | "storage_quota" | "not_found" | "no_refresh_token" | "http";

// (No TS parameter properties: tests run with Node's strip-only TypeScript.)
export class DriveApiError extends Error {
  code: DriveErrorCode;
  status: number;
  constructor(code: DriveErrorCode, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function oauthClientFromEnv(): OAuthClient {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? "";
  if (!clientId || !clientSecret || !redirectUri) {
    throw new DriveApiError("http", 500, "Google Drive is not configured on the server (GOOGLE_CLIENT_ID / SECRET / REDIRECT_URI).");
  }
  return { clientId, clientSecret, redirectUri };
}

export function buildAuthUrl(c: Pick<OAuthClient, "clientId" | "redirectUri">, state: string): string {
  const u = new URL(GOOGLE_AUTH_URL);
  u.search = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    response_type: "code",
    scope: OAUTH_SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  }).toString();
  return u.toString();
}

/** Reads a Google error body and classifies it. Never includes tokens in the message. */
async function toError(res: Response, what: string): Promise<DriveApiError> {
  let text = "";
  try {
    text = await res.text();
  } catch {
    // ignore
  }
  if (/invalid_grant/.test(text)) return new DriveApiError("invalid_grant", res.status, `${what}: invalid_grant`);
  if (/storageQuotaExceeded|quotaExceeded.*storage/i.test(text)) {
    return new DriveApiError("storage_quota", res.status, `${what}: storageQuotaExceeded`);
  }
  if (res.status === 404) return new DriveApiError("not_found", 404, `${what}: not found`);
  let reason = "";
  try {
    const j = JSON.parse(text);
    reason = j?.error?.message ?? j?.error_description ?? j?.error ?? "";
  } catch {
    // ignore
  }
  return new DriveApiError("http", res.status, `${what}: HTTP ${res.status}${reason ? ` ${String(reason).slice(0, 200)}` : ""}`);
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  expiresIn: number;
}

async function tokenRequest(f: Fetch, body: Record<string, string>, what: string): Promise<TokenSet> {
  const res = await f(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) throw await toError(res, what);
  const j = (await res.json()) as Record<string, unknown>;
  if (typeof j.access_token !== "string") throw new DriveApiError("http", 502, `${what}: no access token`);
  return {
    accessToken: j.access_token,
    refreshToken: typeof j.refresh_token === "string" ? j.refresh_token : null,
    idToken: typeof j.id_token === "string" ? j.id_token : null,
    expiresIn: typeof j.expires_in === "number" ? j.expires_in : 3600,
  };
}

export function exchangeCode(f: Fetch, c: OAuthClient, code: string): Promise<TokenSet> {
  return tokenRequest(
    f,
    { code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: c.redirectUri, grant_type: "authorization_code" },
    "token exchange",
  );
}

export async function refreshAccessToken(f: Fetch, c: OAuthClient, refreshToken: string): Promise<string> {
  const t = await tokenRequest(
    f,
    { refresh_token: refreshToken, client_id: c.clientId, client_secret: c.clientSecret, grant_type: "refresh_token" },
    "token refresh",
  );
  return t.accessToken;
}

/** Best effort: a token that is already invalid counts as revoked. */
export async function revokeToken(f: Fetch, token: string): Promise<boolean> {
  try {
    const res = await f(GOOGLE_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
    return res.ok || res.status === 400;
  } catch {
    return false;
  }
}

/**
 * Email from the id_token. The token came straight from Google's token endpoint over TLS,
 * so (per Google's guidance) its signature need not be re-verified here.
 */
export function emailFromIdToken(idToken: string | null): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

const auth = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });

export interface DriveFileMeta {
  id: string;
  name?: string;
  size?: string;
  mimeType?: string;
  trashed?: boolean;
  appProperties?: Record<string, string>;
}

export async function getFile(f: Fetch, accessToken: string, fileId: string, fields = "id,name,size,mimeType,trashed,appProperties"): Promise<DriveFileMeta> {
  const res = await f(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}`, {
    headers: auth(accessToken),
  });
  if (!res.ok) throw await toError(res, "files.get");
  return (await res.json()) as DriveFileMeta;
}

/** Deletes a file. A file that is already gone counts as deleted (returns true). */
export async function deleteFile(f: Fetch, accessToken: string, fileId: string): Promise<boolean> {
  const res = await f(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}`, { method: "DELETE", headers: auth(accessToken) });
  if (res.ok || res.status === 404) return true;
  throw await toError(res, "files.delete");
}

/** Escapes a value for a Drive `q` string literal. */
export function qEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function findFolder(f: Fetch, accessToken: string, name: string, parentId: string): Promise<string | null> {
  const q = `name='${qEscape(name)}' and '${qEscape(parentId)}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`;
  const url = `${DRIVE_FILES_URL}?q=${encodeURIComponent(q)}&fields=${encodeURIComponent("files(id,name)")}&pageSize=10&spaces=drive`;
  const res = await f(url, { headers: auth(accessToken) });
  if (!res.ok) throw await toError(res, "files.list");
  const j = (await res.json()) as { files?: { id: string }[] };
  return j.files?.[0]?.id ?? null;
}

export async function createFolder(f: Fetch, accessToken: string, name: string, parentId?: string): Promise<string> {
  const res = await f(`${DRIVE_FILES_URL}?fields=id`, {
    method: "POST",
    headers: { ...auth(accessToken), "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) }),
  });
  if (!res.ok) throw await toError(res, "folder create");
  const j = (await res.json()) as { id?: string };
  if (!j.id) throw new DriveApiError("http", 502, "folder create: no id");
  return j.id;
}

/** Is this folder still usable (exists, not trashed)? Moved folders still work by id. */
export async function folderUsable(f: Fetch, accessToken: string, folderId: string | null): Promise<boolean> {
  if (!folderId) return false;
  try {
    const m = await getFile(f, accessToken, folderId, "id,trashed,mimeType");
    return !m.trashed && (!m.mimeType || m.mimeType === FOLDER_MIME);
  } catch (err) {
    if (err instanceof DriveApiError && err.code === "not_found") return false;
    throw err;
  }
}

/** Returns a usable root folder id, creating a new one if missing, deleted or trashed (spec §4.6). */
export async function ensureRootFolder(
  f: Fetch,
  accessToken: string,
  currentId: string | null,
  name: string,
): Promise<{ id: string; created: boolean }> {
  if (await folderUsable(f, accessToken, currentId)) return { id: currentId!, created: false };
  return { id: await createFolder(f, accessToken, name), created: true };
}

export async function ensureChildFolder(f: Fetch, accessToken: string, rootId: string, childCode: string): Promise<string> {
  return (await findFolder(f, accessToken, childCode, rootId)) ?? (await createFolder(f, accessToken, childCode, rootId));
}

export interface ResumableStart {
  name: string;
  parentId: string;
  size: number;
  mimeType: string;
  origin: string;
  appProperties: Record<string, string>;
}

/** Starts a resumable upload; returns the session URL (Location header). */
export async function startResumableUpload(f: Fetch, accessToken: string, s: ResumableStart): Promise<string> {
  const res = await f(`${DRIVE_UPLOAD_URL}?uploadType=resumable&fields=id,size,appProperties`, {
    method: "POST",
    headers: {
      ...auth(accessToken),
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": s.mimeType,
      "X-Upload-Content-Length": String(s.size),
      // Google allows CORS on the session URL for this origin (the browser PUTs the bytes).
      Origin: s.origin,
    },
    body: JSON.stringify({ name: s.name, parents: [s.parentId], appProperties: s.appProperties }),
  });
  if (!res.ok) throw await toError(res, "resumable start");
  const loc = res.headers.get("location");
  if (!loc) throw new DriveApiError("http", 502, "resumable start: no session URL");
  return loc;
}

export type ChunkResult = { done: true; fileId: string | null } | { done: false; nextOffset: number };

/** Interprets a resumable-upload PUT response (used by the proxy and the browser uploader). */
export async function readChunkResponse(res: Response): Promise<ChunkResult> {
  if (res.status === 200 || res.status === 201) {
    let id: string | null = null;
    try {
      id = ((await res.json()) as { id?: string }).id ?? null;
    } catch {
      // body not readable
    }
    return { done: true, fileId: id };
  }
  if (res.status === 308) {
    const m = /bytes=0-(\d+)/.exec(res.headers.get("range") ?? "");
    return { done: false, nextOffset: m ? Number(m[1]) + 1 : 0 };
  }
  throw await toError(res, "chunk upload");
}

/**
 * Checks that an uploaded file is the recording for this session (spec §4.4 step 4).
 * Returns null if it matches, else a short reason.
 */
export function verifyRecordingFile(
  meta: DriveFileMeta,
  expected: { sessionId: string; orgId: string; level?: number; size?: number },
): string | null {
  if (meta.trashed) return "file_trashed";
  const ap = meta.appProperties ?? {};
  if (ap.lookatme_session !== expected.sessionId) return "session_mismatch";
  if (ap.lookatme_org !== expected.orgId) return "org_mismatch";
  if (expected.level !== undefined && ap.lookatme_level !== undefined && ap.lookatme_level !== String(expected.level)) {
    return "level_mismatch";
  }
  if (expected.size !== undefined && meta.size !== undefined && Number(meta.size) !== expected.size) return "size_mismatch";
  return null;
}
