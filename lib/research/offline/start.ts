"use client";

/**
 * lib/research/offline/start.ts — Wave 0 STUB. Agent E implements offline support behind
 * these signatures; agent B's child page calls them. Keep the signatures.
 */

import { getSupabase } from "../supabase/client";
import { beginResearchScreening } from "../screening";

export interface StartScreeningArgs {
  child: { id: string; org_id: string; code: string; birth_month: string | null };
  ageMonths: number | null;
  engine: string;
  allowRecording: boolean;
  blind: boolean;
}

export interface StartScreeningResult {
  sessionId: string; // "" when started offline (E)
  clientSessionId: string;
  offline: boolean;
}

/**
 * Starts a screening: online → start_session RPC (checks plan, quota, consent);
 * offline (E) → allowed within cached plan limits, synced later. Then sets the screening
 * context. Throws with the RPC error message on refusal (use friendlyError()).
 */
export async function startScreening(a: StartScreeningArgs): Promise<StartScreeningResult> {
  const clientSessionId = crypto.randomUUID();
  const { data, error } = await getSupabase().rpc("start_session", {
    p_child: a.child.id,
    p_client_session_id: clientSessionId,
    p_engine: a.engine,
  });
  if (error) throw error;
  const sessionId = data as string;
  beginResearchScreening(
    {
      orgId: a.child.org_id,
      childId: a.child.id,
      childCode: a.child.code,
      sessionId,
      clientSessionId,
      engine: a.engine,
      startedAt: new Date().toISOString(),
      ageMonths: a.ageMonths,
      allowRecording: a.allowRecording,
      blind: a.blind,
      offline: false,
    },
    a.child.birth_month,
  );
  return { sessionId, clientSessionId, offline: false };
}

/** Remembers a child + active consent on this device so it can be screened offline (E implements). */
export async function cacheChildForOffline(
  child: StartScreeningArgs["child"],
  consent: { allow_recording: boolean; allow_research: boolean } | null,
): Promise<void> {
  void child;
  void consent;
}
