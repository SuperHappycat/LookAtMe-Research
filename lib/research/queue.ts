"use client";

/**
 * lib/research/queue.ts — STUB from Wave 0. Agent E replaces the implementation
 * (IndexedDB + sync loop) but MUST keep these exported signatures.
 *
 * Other agents only call: enqueue(), registerUploader(), pending(), onChange(), syncNow().
 */

import type { QueueItem, QueueItemKind, Uploader } from "./contracts";

const items = new Map<string, { item: QueueItem; blob: Blob | null }>();
const uploaders = new Map<QueueItemKind, Uploader>();
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((l) => l());

/** Adds an item (and optional blob) to the queue, then tries to sync. */
export async function enqueue(item: QueueItem, blob: Blob | null = null): Promise<void> {
  items.set(item.id, { item, blob });
  notify();
  void syncNow();
}

/** Registers the function that uploads one kind of item. */
export function registerUploader<K extends QueueItemKind>(kind: K, fn: Uploader<Extract<QueueItem, { kind: K }>>): void {
  uploaders.set(kind, fn as Uploader);
}

export async function pending(): Promise<QueueItem[]> {
  return [...items.values()].map((v) => v.item);
}

/** Subscribe to queue changes; returns an unsubscribe function. */
export function onChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Tries to upload everything pending (stub: in memory, one pass). */
export async function syncNow(): Promise<void> {
  for (const [id, { item, blob }] of items) {
    const up = uploaders.get(item.kind);
    if (!up) continue;
    try {
      await up(item, blob);
      items.delete(id);
    } catch (err) {
      item.attempts += 1;
      item.lastError = err instanceof Error ? err.message : String(err);
    }
  }
  notify();
}
