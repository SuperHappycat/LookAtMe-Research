/**
 * lib/research/offline/config.ts
 * ================================
 * Tunable numbers for offline mode and the upload queue (agent E).
 * These are operational limits, not clinical cut-offs.
 */

export const OFFLINE_CONFIG = {
  /** At most this many offline screenings may wait to sync on one device. TBD – tune with pilot data. */
  maxOfflineSessions: 20,
  /** First retry delay after a failed upload (ms); doubles each attempt. TBD – tune with pilot data. */
  backoffBaseMs: 5_000,
  /** Longest delay between retries (ms). TBD – tune with pilot data. */
  backoffMaxMs: 15 * 60_000,
  /** After this many failed attempts an item is marked "needs review" (kept, never dropped). TBD. */
  maxAttemptsBeforeReview: 12,
  /** Background sync interval while the app is open (ms). TBD – tune with pilot data. */
  syncIntervalMs: 60_000,
  /** A cached child / plan status older than this is not used to start offline (ms). TBD. */
  maxCacheAgeMs: 30 * 24 * 60 * 60_000,
} as const;

/**
 * Server refusals that will not fix themselves by retrying: the item is kept and shown as
 * "ต้องตรวจสอบ / needs review" (spec §5.4).
 */
export const REVIEW_ERROR_CODES = [
  "quota_reached",
  "plan_expired",
  "no_consent",
  "not_allowed",
  "bad_path",
  "bad_risk_level",
  "drive_needs_reconnect",
  "storageQuotaExceeded",
] as const;

/** IndexedDB names (one database per browser profile and origin). */
export const OFFLINE_DB = {
  name: "lookatme-offline",
  version: 1,
  /** Queue items (recordings and offline sessions), keyed by item.id. */
  queue: "queue",
  /** Recording Blobs, keyed by RecordingQueueItem.blobKey. */
  blobs: "blobs",
  /**
   * Small { key, value } records: "child:<id>" (code, birth month, consent flags for offline start),
   * "plan:<orgId>" (cached plan status), "session:<clientSessionId>" (server session id once synced).
   */
  meta: "meta",
} as const;
