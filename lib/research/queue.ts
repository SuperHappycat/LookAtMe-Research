"use client";

/**
 * lib/research/queue.ts
 * =======================
 * The device's upload queue (spec §5.4): offline screenings and screen recordings wait here,
 * in IndexedDB, until they are uploaded. Logic: ./offline/queueCore.ts. Storage:
 * ./offline/idb.ts (in-memory fallback when IndexedDB is unavailable).
 *
 * Other agents only call: enqueue(), registerUploader(), pending(), onChange(), syncNow().
 * Sync runs on the `online` event, at app start and on a timer (startSyncLoop(), called by
 * components/research/offline/OfflineBoot.tsx).
 */

import { NeedsReviewError, type QueueItem, type QueueItemKind, type Uploader } from "./contracts";
import { OFFLINE_CONFIG } from "./offline/config";
import { idbAvailable, IdbQueueStore } from "./offline/idb";
import { MemoryQueueStore, QueueCore, type QueueCounts, type QueueStore } from "./offline/queueCore";

let store: QueueStore | null = null;
let core: QueueCore | null = null;
let gate: (() => Promise<boolean>) | null = null;
let owner: (() => Promise<string | null>) | null = null;

/** Who is signed in (set by offline/boot.ts). Items are stamped with it and only synced/listed for them. */
export function setQueueOwner(fn: () => Promise<string | null>): void {
  owner = fn;
}

/** Sync waits while this returns false (set by offline/boot.ts: "is a user signed in?"). */
export function setSyncGate(fn: () => Promise<boolean>): void {
  gate = fn;
}

export function queueStore(): QueueStore {
  if (!store) store = idbAvailable() ? new IdbQueueStore() : new MemoryQueueStore();
  return store;
}

function q(): QueueCore {
  if (!core) {
    core = new QueueCore(queueStore(), {
      isOnline: () => typeof navigator === "undefined" || navigator.onLine !== false,
      canSync: async () => (gate ? gate() : true),
      owner: async () => (owner ? owner() : null),
      reviewCode: (err) => (err instanceof NeedsReviewError ? err.code || "needs_review" : null),
    });
  }
  return core;
}

/** Adds an item (and optional blob) to the queue, then tries to sync. */
export async function enqueue(item: QueueItem, blob: Blob | null = null): Promise<void> {
  await q().enqueue(item, blob);
  void syncNow();
}

/** Registers the function that uploads one kind of item. */
export function registerUploader<K extends QueueItemKind>(kind: K, fn: Uploader<Extract<QueueItem, { kind: K }>>): void {
  q().registerUploader(kind, fn as Uploader);
  void syncNow();
}

/** Every item still on this device (waiting and needs-review), sessions first, oldest first. */
export async function pending(): Promise<QueueItem[]> {
  return q().pending();
}

/** Subscribe to queue changes; returns an unsubscribe function. */
export function onChange(cb: () => void): () => void {
  return q().onChange(cb);
}

/** Tries to upload everything that is due. Never throws. */
export async function syncNow(): Promise<void> {
  try {
    await q().syncNow();
  } catch (err) {
    console.warn("[queue] sync failed", err);
  }
}

// ---------------------------------------------------------------- extra exports (E)

export function counts(): Promise<QueueCounts> {
  return q().counts();
}

/** Clears "needs review"/backoff for one item and syncs. */
export async function retryItem(id: string): Promise<void> {
  await q().retry(id);
  void syncNow();
}

/** Deletes one item and its blob. Callers must confirm with the user first. */
export function removeItem(id: string): Promise<void> {
  return q().remove(id);
}

/** Links an offline session's clientSessionId to its server session id (fills waiting recordings). */
export function linkSession(clientSessionId: string, sessionId: string): Promise<void> {
  return q().linkSession(clientSessionId, sessionId);
}

/** Server session id for a clientSessionId once its offline session has synced, else null. */
export function linkedSessionId(clientSessionId: string): Promise<string | null> {
  return q().linkedSessionId(clientSessionId);
}

/** Every item on this device, including other users' (logout warning). */
export function allItems(): Promise<QueueItem[]> {
  return q().allItems();
}

/** Logout: removes the signed-in user's items and cached children (see QueueCore.clearMine). */
export function clearMyQueue(): Promise<number> {
  return q().clearMine();
}

/** Removes all queue items, blobs and cached offline data from this device. */
export function clearQueue(): Promise<void> {
  return q().clear();
}

let loopStarted = false;

/** Sync now, on every `online` event, when the tab becomes visible, and on a timer. Idempotent. */
export function startSyncLoop(): void {
  if (loopStarted || typeof window === "undefined") return;
  loopStarted = true;
  window.addEventListener("online", () => void syncNow());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncNow();
  });
  window.setInterval(() => void syncNow(), OFFLINE_CONFIG.syncIntervalMs);
  void syncNow();
}
