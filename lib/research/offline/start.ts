"use client";

/**
 * lib/research/offline/start.ts
 * ===============================
 * Starting a screening, online or offline (spec §5.4). Agent B's child page calls
 * startScreening() and cacheChildForOffline(); /r/offline lists the cached children.
 *
 * Online  → start_session RPC (checks plan, quota, consent), as before.
 * Offline → (no connection, or the RPC fails with a network error) allowed only when this
 *           child + an active consent are cached on the device, the cached plan hasn't expired,
 *           and fewer than OFFLINE_CONFIG.maxOfflineSessions offline screenings are waiting.
 *           The context gets sessionId "" and offline: true; ResearchSaveCard queues the result
 *           and the queue later calls start_session with the SAME clientSessionId (idempotent).
 */

import { getSupabase } from "../supabase/client";
import { beginResearchScreening } from "../screening";
import { counts, queueStore } from "../queue";
import { isNetworkError, offlineStartCheck, planFromOrg, type CachedChild, type CachedPlan } from "./rules";

export interface StartScreeningArgs {
  child: { id: string; org_id: string; code: string; birth_month: string | null };
  ageMonths: number | null;
  engine: string;
  allowRecording: boolean;
  blind: boolean;
}

export interface StartScreeningResult {
  sessionId: string; // "" when started offline
  clientSessionId: string;
  offline: boolean;
}

const CHILD_PREFIX = "child:";
const PLAN_PREFIX = "plan:";

function online(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/**
 * Starts a screening and sets the screening context. Throws with the RPC error on refusal
 * (use friendlyError()), or an Error with a Thai/English message when offline start isn't allowed.
 */
export async function startScreening(a: StartScreeningArgs): Promise<StartScreeningResult> {
  const clientSessionId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  if (online()) {
    try {
      const { data, error } = await getSupabase().rpc("start_session", {
        p_child: a.child.id,
        p_client_session_id: clientSessionId,
        p_engine: a.engine,
      });
      if (error) throw error;
      const sessionId = data as string;
      begin(a, sessionId, clientSessionId, startedAt, false, a.allowRecording);
      return { sessionId, clientSessionId, offline: false };
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      // fall through: no connection after all
    }
  }

  const store = queueStore();
  const [cached, plan, c] = await Promise.all([
    store.getMeta<CachedChild>(CHILD_PREFIX + a.child.id),
    store.getMeta<CachedPlan>(PLAN_PREFIX + a.child.org_id),
    counts(),
  ]);
  const check = offlineStartCheck({ child: cached, plan, pendingOfflineSessions: c.offlineSessions });
  if (!check.ok) throw Object.assign(new Error(check.message), { code: check.code });
  // Recording only if the cached consent allowed it too.
  begin(
    { ...a, blind: a.blind || !!cached?.blind },
    "",
    clientSessionId,
    startedAt,
    true,
    a.allowRecording && !!cached?.consent.allow_recording,
  );
  return { sessionId: "", clientSessionId, offline: true };
}

function begin(
  a: StartScreeningArgs,
  sessionId: string,
  clientSessionId: string,
  startedAt: string,
  offline: boolean,
  allowRecording: boolean,
) {
  beginResearchScreening(
    {
      orgId: a.child.org_id,
      childId: a.child.id,
      childCode: a.child.code,
      sessionId,
      clientSessionId,
      engine: a.engine,
      startedAt,
      ageMonths: a.ageMonths,
      allowRecording,
      blind: a.blind,
      offline,
    },
    a.child.birth_month,
  );
}

/**
 * Remembers a child + active consent on this device so it can be screened offline, and caches
 * the org's plan status (expires_on, quota left). With consent === null the child is forgotten
 * (no consent → no offline screening). Best-effort: never throws.
 */
export async function cacheChildForOffline(
  child: StartScreeningArgs["child"],
  consent: { allow_recording: boolean; allow_research: boolean } | null,
  opts: { blind?: boolean } = {},
): Promise<void> {
  try {
    const store = queueStore();
    if (!consent) {
      await store.removeMeta(CHILD_PREFIX + child.id);
      return;
    }
    const rec: CachedChild = {
      id: child.id,
      org_id: child.org_id,
      code: child.code,
      birth_month: child.birth_month,
      consent: { allow_recording: !!consent.allow_recording, allow_research: !!consent.allow_research },
      blind: opts.blind === true,
      cachedAt: new Date().toISOString(),
    };
    await store.setMeta(CHILD_PREFIX + child.id, rec);
    if (online()) await refreshPlanStatus(child.org_id);
  } catch (err) {
    console.warn("[offline] could not cache child", err);
  }
}

/** Reads the org's plan status from the database and caches it. Best-effort. */
export async function refreshPlanStatus(orgId: string): Promise<void> {
  try {
    const { data, error } = await getSupabase()
      .from("organizations")
      .select("id, expires_on, screening_quota, screenings_used")
      .eq("id", orgId)
      .maybeSingle();
    if (error || !data) return;
    await queueStore().setMeta(PLAN_PREFIX + orgId, planFromOrg(data));
  } catch {
    // offline or blocked: keep the older cache
  }
}

/** Caches plan status from an org row already loaded (e.g. ResearchShell memberships at login). */
export async function cachePlanStatus(org: {
  id: string;
  expires_on: string;
  screening_quota: number | null;
  screenings_used: number;
}): Promise<void> {
  try {
    await queueStore().setMeta(PLAN_PREFIX + org.id, planFromOrg(org));
  } catch {
    // ignore
  }
}

export async function cachedChildren(orgId?: string): Promise<CachedChild[]> {
  try {
    const rows = await queueStore().metaEntries<CachedChild>(CHILD_PREFIX);
    return rows
      .map((r) => r.value)
      .filter((c) => !orgId || c.org_id === orgId)
      .sort((x, y) => x.code.localeCompare(y.code));
  } catch {
    return [];
  }
}

export async function cachedPlan(orgId: string): Promise<CachedPlan | null> {
  try {
    return (await queueStore().getMeta<CachedPlan>(PLAN_PREFIX + orgId)) ?? null;
  } catch {
    return null;
  }
}

export async function forgetCachedChild(childId: string): Promise<void> {
  await queueStore().removeMeta(CHILD_PREFIX + childId);
}
