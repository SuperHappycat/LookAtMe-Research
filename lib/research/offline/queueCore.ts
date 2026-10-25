/**
 * lib/research/offline/queueCore.ts
 * ===================================
 * The upload queue's logic, kept free of browser APIs so it can be unit-tested
 * (tests/queue.test.ts). Storage sits behind QueueStore: MemoryQueueStore here
 * for tests, IdbQueueStore (./idb.ts) in the browser.
 *
 * Rules (spec §5.4):
 * - Items are never dropped silently. A failed upload is retried with exponential
 *   backoff; a server refusal (quota_reached, plan_expired, no_consent, …) or too many
 *   failures marks the item `needsReview` and keeps it until a person retries or deletes it.
 * - Offline sessions sync before recordings. A recording whose sessionId is still null
 *   waits until its offline session has synced (linkSession), matched by clientSessionId.
 * - Items of a kind with no registered uploader wait.
 * - One sync pass at a time; an item is never uploaded twice in parallel.
 */

import type { QueueItem, QueueItemKind, Uploader } from "../contracts";
import { OFFLINE_CONFIG, REVIEW_ERROR_CODES } from "./config";

export interface QueueRecord {
  id: string;
  item: QueueItem;
  /** Epoch ms; the item is not tried before this time (backoff). */
  nextAttemptAt: number;
  /** Insertion order, used as a tie-breaker. */
  seq: number;
}

export interface QueueStore {
  all(): Promise<QueueRecord[]>;
  get(id: string): Promise<QueueRecord | undefined>;
  put(rec: QueueRecord): Promise<void>;
  remove(id: string): Promise<void>;
  putBlob(key: string, blob: Blob): Promise<void>;
  getBlob(key: string): Promise<Blob | null>;
  removeBlob(key: string): Promise<void>;
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  removeMeta(key: string): Promise<void>;
  /** All meta values whose key starts with prefix. */
  metaEntries<T>(prefix: string): Promise<{ key: string; value: T }[]>;
  /** Removes every queue item, blob and meta record. */
  clear(): Promise<void>;
}

export interface QueueOptions {
  now?: () => number;
  isOnline?: () => boolean;
  /** Checked once per pass (e.g. "is someone signed in?"); false → wait without counting an attempt. */
  canSync?: () => Promise<boolean>;
  /** Returns the review code when err is a NeedsReviewError (injected: contracts.ts is browser-side). */
  reviewCode?: (err: unknown) => string | null;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  maxAttemptsBeforeReview?: number;
}

const KIND_ORDER: Record<QueueItemKind, number> = { offline_session: 0, recording: 1 };
export const SESSION_LINK_PREFIX = "session:";

/** Delay before the next try after `attempts` failures: base · 2^(attempts−1), capped. */
export function backoffDelay(
  attempts: number,
  base: number = OFFLINE_CONFIG.backoffBaseMs,
  max: number = OFFLINE_CONFIG.backoffMaxMs,
): number {
  if (attempts <= 0) return 0;
  return Math.min(max, base * 2 ** Math.min(attempts - 1, 30));
}

export function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}

/** A refusal that retrying won't fix → its code; otherwise null (retry later). */
export function reviewCodeFor(err: unknown, reviewCode?: (err: unknown) => string | null): string | null {
  const direct = reviewCode?.(err);
  if (direct) return direct;
  const msg = errorMessage(err);
  for (const code of REVIEW_ERROR_CODES) if (msg.includes(code)) return code;
  if (msg.includes("row-level security")) return "not_allowed";
  return null;
}

/** Sync order: offline sessions first, then recordings; oldest first inside each kind. */
export function sortRecords(recs: QueueRecord[]): QueueRecord[] {
  return [...recs].sort(
    (a, b) =>
      KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind] ||
      a.item.createdAt.localeCompare(b.item.createdAt) ||
      a.seq - b.seq,
  );
}

export interface QueueCounts {
  pending: number;
  needsReview: number;
  offlineSessions: number;
}

export class QueueCore {
  private uploaders = new Map<QueueItemKind, Uploader>();
  private listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private again = false;
  private seq = 0;
  private readonly now: () => number;
  private readonly isOnline: () => boolean;
  private readonly base: number;
  private readonly max: number;
  private readonly maxAttempts: number;

  private readonly store: QueueStore;
  private readonly opts: QueueOptions;

  // (No TypeScript parameter properties: tests run with Node's strip-only TypeScript.)
  constructor(store: QueueStore, opts: QueueOptions = {}) {
    this.store = store;
    this.opts = opts;
    this.now = opts.now ?? Date.now;
    this.isOnline = opts.isOnline ?? (() => true);
    this.base = opts.backoffBaseMs ?? OFFLINE_CONFIG.backoffBaseMs;
    this.max = opts.backoffMaxMs ?? OFFLINE_CONFIG.backoffMaxMs;
    this.maxAttempts = opts.maxAttemptsBeforeReview ?? OFFLINE_CONFIG.maxAttemptsBeforeReview;
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private notify() {
    for (const l of this.listeners) {
      try {
        l();
      } catch {
        // a listener's error must not break the queue
      }
    }
  }

  registerUploader(kind: QueueItemKind, fn: Uploader): void {
    this.uploaders.set(kind, fn);
  }

  /** Adds (or replaces, same id) an item. Re-enqueueing keeps its order and attempt count. */
  async enqueue(item: QueueItem, blob: Blob | null = null): Promise<void> {
    if (blob && item.kind === "recording") await this.store.putBlob(item.blobKey, blob);
    const existing = await this.store.get(item.id);
    let next: QueueItem = { ...item, attempts: existing?.item.attempts ?? item.attempts ?? 0 };
    if (next.kind === "recording" && !next.sessionId) {
      const linked = await this.store.getMeta<string>(SESSION_LINK_PREFIX + next.clientSessionId);
      if (linked) next = { ...next, sessionId: linked };
    }
    await this.store.put({ id: item.id, item: next, nextAttemptAt: 0, seq: existing?.seq ?? this.nextSeq() });
    this.notify();
  }

  private nextSeq() {
    this.seq += 1;
    return this.now() * 1000 + (this.seq % 1000);
  }

  async pending(): Promise<QueueItem[]> {
    return sortRecords(await this.store.all()).map((r) => r.item);
  }

  async counts(): Promise<QueueCounts> {
    const items = await this.pending();
    return {
      pending: items.filter((i) => !i.needsReview).length,
      needsReview: items.filter((i) => i.needsReview).length,
      offlineSessions: items.filter((i) => i.kind === "offline_session").length,
    };
  }

  /** Records the server session id of an offline session and fills it into waiting recordings. */
  async linkSession(clientSessionId: string, sessionId: string): Promise<void> {
    await this.store.setMeta(SESSION_LINK_PREFIX + clientSessionId, sessionId);
    for (const rec of await this.store.all()) {
      const it = rec.item;
      if (it.kind === "recording" && !it.sessionId && it.clientSessionId === clientSessionId) {
        await this.store.put({ ...rec, item: { ...it, sessionId } });
      }
    }
    this.notify();
  }

  async linkedSessionId(clientSessionId: string): Promise<string | null> {
    return (await this.store.getMeta<string>(SESSION_LINK_PREFIX + clientSessionId)) ?? null;
  }

  /** Clears needsReview and backoff so the item is tried on the next pass. */
  async retry(id: string): Promise<void> {
    const rec = await this.store.get(id);
    if (!rec) return;
    await this.store.put({ ...rec, nextAttemptAt: 0, item: { ...rec.item, needsReview: false } });
    this.notify();
  }

  /** Deletes one item and its blob (a person chose this; the UI asks for confirmation). */
  async remove(id: string): Promise<void> {
    const rec = await this.store.get(id);
    await this.store.remove(id);
    if (rec?.item.kind === "recording") await this.store.removeBlob(rec.item.blobKey);
    this.notify();
  }

  async clear(): Promise<void> {
    await this.store.clear();
    this.notify();
  }

  /** Runs one sync pass (or joins the running one and repeats it once afterwards). */
  syncNow(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.pass();
        } while (this.again);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async pass(): Promise<void> {
    if (!this.isOnline()) return;
    if (this.opts.canSync && !(await this.opts.canSync())) return;
    for (const rec of sortRecords(await this.store.all())) {
      if (!this.isOnline()) return;
      let item = rec.item;
      if (item.needsReview || rec.nextAttemptAt > this.now()) continue;
      const up = this.uploaders.get(item.kind);
      if (!up) continue;
      if (item.kind === "recording" && !item.sessionId) {
        const linked = await this.linkedSessionId(item.clientSessionId);
        if (!linked) continue; // its offline session hasn't synced yet
        item = { ...item, sessionId: linked };
        await this.store.put({ ...rec, item });
      }
      let blob: Blob | null = null;
      if (item.kind === "recording") {
        blob = await this.store.getBlob(item.blobKey);
        if (!blob) {
          await this.fail(rec, item, new Error("blob_missing: the recording file is no longer on this device"), true);
          continue;
        }
      }
      try {
        await up(item, blob);
        await this.store.remove(rec.id);
        if (item.kind === "recording") await this.store.removeBlob(item.blobKey);
        this.notify();
      } catch (err) {
        await this.fail(rec, item, err, false);
      }
    }
  }

  private async fail(rec: QueueRecord, item: QueueItem, err: unknown, forceReview: boolean) {
    // The item may have been deleted by a person while it was uploading.
    if (!(await this.store.get(rec.id))) return;
    const attempts = (item.attempts ?? 0) + 1;
    const code = reviewCodeFor(err, this.opts.reviewCode);
    const needsReview = forceReview || code !== null || attempts >= this.maxAttempts;
    await this.store.put({
      ...rec,
      nextAttemptAt: needsReview ? 0 : this.now() + backoffDelay(attempts, this.base, this.max),
      item: { ...item, attempts, lastError: errorMessage(err).slice(0, 500), needsReview },
    });
    this.notify();
  }
}

/** In-memory store (tests, and the fallback when IndexedDB is unavailable, e.g. some private windows). */
export class MemoryQueueStore implements QueueStore {
  items = new Map<string, QueueRecord>();
  blobs = new Map<string, Blob>();
  meta = new Map<string, unknown>();
  async all() {
    return [...this.items.values()].map((r) => structuredClone(r));
  }
  async get(id: string) {
    const r = this.items.get(id);
    return r ? structuredClone(r) : undefined;
  }
  async put(rec: QueueRecord) {
    this.items.set(rec.id, structuredClone(rec));
  }
  async remove(id: string) {
    this.items.delete(id);
  }
  async putBlob(key: string, blob: Blob) {
    this.blobs.set(key, blob);
  }
  async getBlob(key: string) {
    return this.blobs.get(key) ?? null;
  }
  async removeBlob(key: string) {
    this.blobs.delete(key);
  }
  async getMeta<T>(key: string) {
    return this.meta.get(key) as T | undefined;
  }
  async setMeta(key: string, value: unknown) {
    this.meta.set(key, structuredClone(value));
  }
  async removeMeta(key: string) {
    this.meta.delete(key);
  }
  async metaEntries<T>(prefix: string) {
    return [...this.meta.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .map(([key, value]) => ({ key, value: value as T }));
  }
  async clear() {
    this.items.clear();
    this.blobs.clear();
    this.meta.clear();
  }
}
