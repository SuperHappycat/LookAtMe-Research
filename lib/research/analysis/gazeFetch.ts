/**
 * lib/research/analysis/gazeFetch.ts
 * ====================================
 * Downloads many sessions' gaze CSVs with a small concurrency limit, progress
 * reports, a cache and cancellation. The downloader is injected so this can be
 * tested without Supabase. A missing file (null) is not an error.
 */

import { parseGazeCsv, type GazeRow } from "../gazeLog";

export type GazeCache = Map<string, GazeRow[] | null>;

export interface FetchOptions {
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: { cancelled: boolean };
}

export async function fetchGazeMany(
  ids: readonly string[],
  download: (id: string) => Promise<string | null>,
  cache: GazeCache,
  opts: FetchOptions = {},
): Promise<{ rows: Map<string, GazeRow[] | null>; failed: string[]; cancelled: boolean }> {
  const todo = ids.filter((id) => !cache.has(id));
  const total = ids.length;
  let done = total - todo.length;
  const failed: string[] = [];
  opts.onProgress?.(done, total);
  let next = 0;
  const worker = async () => {
    while (next < todo.length && !opts.signal?.cancelled) {
      const id = todo[next++];
      try {
        const text = await download(id);
        cache.set(id, text === null ? null : parseGazeCsv(text));
      } catch {
        failed.push(id);
      }
      done++;
      opts.onProgress?.(done, total);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 4, todo.length)) }, worker));
  const rows = new Map<string, GazeRow[] | null>();
  for (const id of ids) if (cache.has(id)) rows.set(id, cache.get(id)!);
  return { rows, failed, cancelled: !!opts.signal?.cancelled };
}
