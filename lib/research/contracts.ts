/**
 * lib/research/contracts.ts
 * ===========================
 * Shared types for Phase 4+5 (Wave 0). Agents import these; they do NOT change them.
 * If a change is truly needed, note it in docs/agents/<letter>.md for the lead to apply.
 */

// ---------------------------------------------------------------- queue (owned by E)

export type QueueItemKind = "recording" | "offline_session";

interface QueueItemBase {
  /** Random UUID, also the IndexedDB key. */
  id: string;
  kind: QueueItemKind;
  createdAt: string;
  orgId: string;
  attempts: number;
  lastError?: string;
  /** Set by the queue when an item needs a person (e.g. quota_reached, Drive needs reconnect). */
  needsReview?: boolean;
}

/** A screen recording waiting to be uploaded (produced by A, uploaded by A's uploader, stored by E). */
export interface RecordingQueueItem extends QueueItemBase {
  kind: "recording";
  sessionId: string | null; // null until an offline session has synced
  clientSessionId: string;
  childCode: string;
  /** Key of the Blob in the queue's blob store. */
  blobKey: string;
  mimeType: string;
  size: number;
  /** Where it should end up. "local_only" items are downloaded, never uploaded. */
  target: "google_drive" | "local_only";
  /** Test level the recording belongs to (one recording per level). */
  level?: 1 | 2 | 3;
}

/** A whole screening done offline (produced and synced by E). */
export interface OfflineSessionQueueItem extends QueueItemBase {
  kind: "offline_session";
  clientSessionId: string;
  childId: string;
  /** Everything needed to call start_session + complete_session and upload the gaze CSV later. */
  payload: {
    engine: string;
    startedAt: string;
    completeData: Record<string, unknown>;
    gazeCsv: string;
  };
}

export type QueueItem = RecordingQueueItem | OfflineSessionQueueItem;

/** An uploader handles one item kind. Return normally on success; throw to retry later. */
export type Uploader<T extends QueueItem = QueueItem> = (item: T, blob: Blob | null) => Promise<void>;

/** Errors an uploader can throw so the queue marks the item for a person instead of retrying forever. */
export class NeedsReviewError extends Error {
  // No TypeScript parameter property: Node's strip-only test runner can't load those.
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "NeedsReviewError";
  }
}

// ---------------------------------------------------------------- recording (A)

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

export type DriveStatus = "not_connected" | "active" | "needs_reconnect" | "revoked";

// ---------------------------------------------------------------- analysis (C)

/** An area of interest in stimulus-area fractions (0..1), optionally limited to a time window. */
export interface AoiBox {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  tStartS?: number;
  tEndS?: number;
}

// ---------------------------------------------------------------- studies (D)

export type StudyRole = "lead" | "site";
