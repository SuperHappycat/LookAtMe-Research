/**
 * lib/research/drive/config.ts
 * ==============================
 * Constants and small pure helpers for Google Drive recordings (spec §4).
 * Safe to import from both server and client code (no secrets here).
 */

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const OAUTH_SCOPES = ["openid", "email", DRIVE_SCOPE].join(" ");
export const FOLDER_MIME = "application/vnd.google-apps.folder";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
export const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";

/** Drive requires every chunk except the last to be a multiple of 256 KiB. */
export const CHUNK_UNIT = 256 * 1024;
/** Direct browser → Google chunks: 8 MiB (32 × 256 KiB). */
export const DIRECT_CHUNK_BYTES = 32 * CHUNK_UNIT;
/** Proxied chunks through /api/drive/upload-chunk: 3.75 MiB (15 × 256 KiB), under Vercel's ~4.5 MB body limit. */
export const PROXY_CHUNK_BYTES = 15 * CHUNK_UNIT;
export const VERCEL_BODY_LIMIT_BYTES = 4_500_000;

/** Largest recording we accept (a 3 × 20 s test is ~5 MB; this leaves lots of room). */
export const MAX_RECORDING_BYTES = 200 * 1024 * 1024;

/** OAuth state lifetime. */
export const STATE_TTL_MS = 10 * 60 * 1000;
export const NONCE_COOKIE = "lookatme_drive_nonce";

/** Device preference for where recordings go. */
export const RECORDING_TARGET_KEY = "lookatme_recording_target";
export type RecordingTarget = "google_drive" | "local_only";

export function readRecordingTarget(): RecordingTarget {
  try {
    return window.localStorage.getItem(RECORDING_TARGET_KEY) === "local_only" ? "local_only" : "google_drive";
  } catch {
    return "google_drive";
  }
}

export function writeRecordingTarget(t: RecordingTarget): void {
  try {
    window.localStorage.setItem(RECORDING_TARGET_KEY, t);
  } catch {
    // private mode etc.: the default (Drive) stays
  }
}

export function rootFolderName(orgName: string): string {
  return `LookAtMe Recordings – ${orgName}`.slice(0, 250);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** YYYYMMDD-HHmm in the given IANA time zone (default: the runtime's local zone). */
export function stamp(d: Date, timeZone?: string): string {
  if (!timeZone) {
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}`;
}

/** Child codes are free text: keep file names safe for every OS. */
export function safeCode(code: string): string {
  return code.replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 40) || "child";
}

/** Local download name: <childCode>_<YYYYMMDD-HHmm>_L<level>.webm */
export function localFileName(childCode: string, at: Date, level: number): string {
  return `${safeCode(childCode)}_${stamp(at)}_L${level}.webm`;
}

/** Drive file name: <childCode>_<YYYYMMDD-HHmm>_L<level>_<sessionId>.webm (Thai time). */
export function driveFileName(childCode: string, at: Date, level: number, sessionId: string): string {
  return `${safeCode(childCode)}_${stamp(at, "Asia/Bangkok")}_L${level}_${sessionId}.webm`;
}

/**
 * Splits `size` bytes into upload chunks of `chunk` bytes starting at `offset`.
 * Every chunk but the last is exactly `chunk` (a multiple of 256 KiB).
 */
export function chunkRanges(size: number, chunk: number, offset = 0): { start: number; end: number }[] {
  if (chunk <= 0 || chunk % CHUNK_UNIT !== 0) throw new Error("chunk must be a positive multiple of 256 KiB");
  const out: { start: number; end: number }[] = [];
  for (let start = offset; start < size; start += chunk) out.push({ start, end: Math.min(start + chunk, size) - 1 });
  return out;
}

/** Content-Range for bytes [start, end] of `size`. */
export function contentRange(start: number, end: number, size: number): string {
  return `bytes ${start}-${end}/${size}`;
}

/**
 * Next byte to send after a 308 "Resume Incomplete": Google's `Range: bytes=0-N` means 0..N are stored.
 * No Range header means nothing is stored yet.
 */
export function nextOffsetFromRange(range: string | null): number {
  const m = range ? /bytes=0-(\d+)/.exec(range) : null;
  return m ? Number(m[1]) + 1 : 0;
}

/** Only real Drive resumable-session URLs may be proxied (prevents SSRF through upload-chunk). */
export function isDriveUploadUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return (
      url.protocol === "https:" &&
      url.hostname === "www.googleapis.com" &&
      url.pathname === "/upload/drive/v3/files" &&
      url.searchParams.get("uploadType") === "resumable" &&
      !!url.searchParams.get("upload_id") &&
      !url.username &&
      !url.password &&
      !url.port
    );
  } catch {
    return false;
  }
}

export const driveViewUrl = (fileId: string) => `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;

/** Error codes shared by the routes and the uploader. */
export const DRIVE_ERR = {
  notConnected: "drive_not_connected",
  needsReconnect: "drive_needs_reconnect",
  full: "drive_full",
  noConsent: "no_recording_consent",
  notFound: "drive_file_not_found",
} as const;
