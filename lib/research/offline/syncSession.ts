/**
 * lib/research/offline/syncSession.ts
 * =====================================
 * The "offline_session" uploader, written against a tiny Supabase-like interface so it can be
 * unit-tested. Steps (each idempotent, so a retry after any failure is safe):
 *   1. start_session(child, clientSessionId, engine)  → session id (same id on every retry)
 *   2. link the clientSessionId → session id (recordings waiting on it can now upload)
 *   3. mark_session_offline(session, startedAt)       → created_offline, offline_synced_at
 *   4. upload the gaze CSV to gaze/<org>/<session>.csv (upsert)
 *   5. complete_session(session, data, path)
 * Server refusals (quota_reached, plan_expired, no_consent, …) are thrown as-is; the queue
 * marks the item "needs review" and keeps it.
 */

import type { OfflineSessionQueueItem } from "../contracts";
import { replaceSessionId } from "./rules";

/** An offline-session item; startedOffline=false when an online session's save fell back to the queue. */
export type SessionItem = OfflineSessionQueueItem & { startedOffline?: boolean };

interface RpcResult {
  data: unknown;
  error: { message: string; code?: string } | null;
}

export interface SyncDeps {
  hasSession(): Promise<boolean>;
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
  uploadGaze(path: string, csv: string): Promise<{ error: { message: string } | null }>;
  linkSession(clientSessionId: string, sessionId: string): Promise<void>;
}

/** PostgREST "function not found" (e.g. the optional mark_session_offline migration isn't applied). */
function isMissingFunction(err: { message: string; code?: string }): boolean {
  return err.code === "PGRST202" || /could not find the function/i.test(err.message);
}

export function makeSessionUploader(deps: SyncDeps) {
  return async function uploadOfflineSession(item: SessionItem): Promise<void> {
    if (!(await deps.hasSession())) throw new Error("not_signed_in: sign in to upload");

    const start = await deps.rpc("start_session", {
      p_child: item.childId,
      p_client_session_id: item.clientSessionId,
      p_engine: item.payload.engine,
    });
    if (start.error) throw start.error;
    const sessionId = String(start.data);
    if (!sessionId) throw new Error("start_session returned no id");
    await deps.linkSession(item.clientSessionId, sessionId);

    if (item.startedOffline !== false) {
      const mark = await deps.rpc("mark_session_offline", { p_session: sessionId, p_started_at: item.payload.startedAt });
      if (mark.error && !isMissingFunction(mark.error)) throw mark.error;
    }

    const csv = replaceSessionId(item.payload.gazeCsv, item.clientSessionId, sessionId);
    const path = `${item.orgId}/${sessionId}.csv`;
    const up = await deps.uploadGaze(path, csv);
    if (up.error) throw up.error;

    const done = await deps.rpc("complete_session", {
      p_session: sessionId,
      p_data: { ...item.payload.completeData, gaze_bytes: csv.length },
      p_gaze_path: path,
    });
    if (done.error) throw done.error;
  };
}
