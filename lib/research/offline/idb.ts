/**
 * lib/research/offline/idb.ts
 * =============================
 * IndexedDB implementation of QueueStore (raw IndexedDB API, no dependencies).
 *
 * PRIVACY: this database lives on the device and holds child codes, birth months, consent
 * flags, screening results, gaze CSVs and (from agent A) screen-recording Blobs until they
 * are uploaded. It never holds auth tokens (supabase-js keeps its own session). It is wiped
 * by clearOfflineData() (logout, and the "clear offline data" button on /r/offline).
 */

import { OFFLINE_DB } from "./config";
import type { QueueRecord, QueueStore } from "./queueCore";

let dbPromise: Promise<IDBDatabase> | null = null;

export function idbAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_DB.name, OFFLINE_DB.version);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(OFFLINE_DB.queue)) db.createObjectStore(OFFLINE_DB.queue, { keyPath: "id" });
      if (!db.objectStoreNames.contains(OFFLINE_DB.blobs)) db.createObjectStore(OFFLINE_DB.blobs);
      if (!db.objectStoreNames.contains(OFFLINE_DB.meta)) db.createObjectStore(OFFLINE_DB.meta, { keyPath: "key" });
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgraded the schema: close so it can proceed; reopen on next use.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error("indexeddb_open_failed"));
    };
    req.onblocked = () => {
      // keep waiting; resolves once other tabs close their connection
    };
  });
  return dbPromise;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(
  stores: string | string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(stores, mode);
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("indexeddb_aborted"));
  });
  const result = await fn(tx);
  await done;
  return result;
}

export class IdbQueueStore implements QueueStore {
  all() {
    return run(OFFLINE_DB.queue, "readonly", (tx) =>
      promisify(tx.objectStore(OFFLINE_DB.queue).getAll() as IDBRequest<QueueRecord[]>),
    );
  }
  get(id: string) {
    return run(OFFLINE_DB.queue, "readonly", (tx) =>
      promisify(tx.objectStore(OFFLINE_DB.queue).get(id) as IDBRequest<QueueRecord | undefined>),
    );
  }
  async put(rec: QueueRecord) {
    await run(OFFLINE_DB.queue, "readwrite", (tx) => promisify(tx.objectStore(OFFLINE_DB.queue).put(rec)));
  }
  async remove(id: string) {
    await run(OFFLINE_DB.queue, "readwrite", (tx) => promisify(tx.objectStore(OFFLINE_DB.queue).delete(id)));
  }
  async putBlob(key: string, blob: Blob) {
    await run(OFFLINE_DB.blobs, "readwrite", (tx) => promisify(tx.objectStore(OFFLINE_DB.blobs).put(blob, key)));
  }
  async getBlob(key: string) {
    const b = await run(OFFLINE_DB.blobs, "readonly", (tx) =>
      promisify(tx.objectStore(OFFLINE_DB.blobs).get(key) as IDBRequest<Blob | undefined>),
    );
    return b ?? null;
  }
  async removeBlob(key: string) {
    await run(OFFLINE_DB.blobs, "readwrite", (tx) => promisify(tx.objectStore(OFFLINE_DB.blobs).delete(key)));
  }
  async getMeta<T>(key: string) {
    const r = await run(OFFLINE_DB.meta, "readonly", (tx) =>
      promisify(tx.objectStore(OFFLINE_DB.meta).get(key) as IDBRequest<{ key: string; value: T } | undefined>),
    );
    return r?.value;
  }
  async setMeta(key: string, value: unknown) {
    await run(OFFLINE_DB.meta, "readwrite", (tx) => promisify(tx.objectStore(OFFLINE_DB.meta).put({ key, value })));
  }
  async removeMeta(key: string) {
    await run(OFFLINE_DB.meta, "readwrite", (tx) => promisify(tx.objectStore(OFFLINE_DB.meta).delete(key)));
  }
  async metaEntries<T>(prefix: string) {
    return run(OFFLINE_DB.meta, "readonly", (tx) =>
      promisify(
        tx.objectStore(OFFLINE_DB.meta).getAll(IDBKeyRange.bound(prefix, prefix + "￿")) as IDBRequest<
          { key: string; value: T }[]
        >,
      ),
    );
  }
  async clear() {
    const names = [OFFLINE_DB.queue, OFFLINE_DB.blobs, OFFLINE_DB.meta];
    await run(names, "readwrite", (tx) => Promise.all(names.map((n) => promisify(tx.objectStore(n).clear()))));
  }
}
