"use client";

/**
 * lib/research/offline/boot.ts
 * ==============================
 * App-start wiring for offline mode: registers the "offline_session" uploader and starts the
 * sync loop. Loaded lazily by components/research/offline/OfflineBoot.tsx (rendered in
 * app/layout.tsx) so pages that never use Research don't pay for supabase-js up front.
 */

import { getSupabase, supabaseConfigured } from "../supabase/client";
import { clearMyQueue, linkSession, registerUploader, setQueueOwner, setSyncGate, startSyncLoop, syncNow } from "../queue";
import { makeSessionUploader } from "./syncSession";

let booted = false;

export function bootOffline(): void {
  if (booted || typeof window === "undefined" || !supabaseConfigured()) return;
  booted = true;
  const sb = getSupabase();
  const signedIn = async () => {
    try {
      return !!(await sb.auth.getSession()).data.session;
    } catch {
      return false;
    }
  };
  setSyncGate(signedIn);
  setQueueOwner(async () => {
    try {
      return (await sb.auth.getSession()).data.session?.user.id ?? null;
    } catch {
      return null;
    }
  });
  // Sync as soon as someone signs in (e.g. after logging in again online).
  sb.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") void syncNow();
  });
  registerUploader(
    "offline_session",
    makeSessionUploader({
      hasSession: signedIn,
      rpc: async (name, args) => {
        const r = await sb.rpc(name, args);
        return { data: r.data, error: r.error };
      },
      uploadGaze: async (path, csv) => {
        const r = await sb.storage
          .from("gaze")
          .upload(path, new Blob([csv], { type: "text/csv" }), { upsert: true, contentType: "text/csv" });
        return { error: r.error };
      },
      linkSession,
    }),
  );
  // Agent A's "recording" uploader registers itself on import; load it at app start so
  // recordings queued earlier (or offline) upload from any page.
  void import("../recordingUploader").catch((err) => console.warn("[offline] recording uploader failed to load", err));
  startSyncLoop();
}

/**
 * Logout: wipes this user's offline records (waiting uploads, recordings, cached children). Other
 * users' unsent items on a shared device are kept. Returns how many items were deleted (unsent data
 * is lost — callers should warn first when pending() is non-empty).
 */
export async function clearOfflineData(): Promise<number> {
  try {
    return await clearMyQueue();
  } catch (err) {
    console.warn("[offline] clear failed", err);
    return 0;
  }
}
