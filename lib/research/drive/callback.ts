/**
 * lib/research/drive/callback.ts — testable core of GET /api/drive/callback (spec §4.3 step 3).
 * Returns the settings-page query to redirect to; never throws for Google/user errors.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { encryptToken, safeEqual, verifyState } from "./crypto";
import { emailFromIdToken, exchangeCode, DriveApiError, type Fetch, type OAuthClient } from "./google";
import { ensureOrgRoot } from "./service";

export type CallbackOutcome =
  | { ok: true; orgId: string; userId: string; googleEmail: string | null }
  | { ok: false; reason: string; orgId?: string; userId?: string };

export interface CallbackDeps {
  svc: SupabaseClient;
  f: Fetch;
  client: OAuthClient;
  /** Throws unless userId is (still) an admin of orgId. */
  checkAdmin: (userId: string, orgId: string) => Promise<void>;
  now?: number;
}

export async function handleCallback(
  params: { code: string | null; state: string | null; error: string | null; nonceCookie: string | null },
  d: CallbackDeps,
): Promise<CallbackOutcome> {
  if (!params.state) return { ok: false, reason: "bad_state" };
  let st;
  try {
    st = verifyState(params.state, { now: d.now });
  } catch (err) {
    return { ok: false, reason: err instanceof Error && err.message === "state_expired" ? "state_expired" : "bad_state" };
  }
  if (!params.nonceCookie || !safeEqual(params.nonceCookie, st.nonce)) return { ok: false, reason: "bad_state" };
  const ids = { orgId: st.org_id, userId: st.user_id };
  if (params.error) return { ok: false, reason: params.error === "access_denied" ? "access_denied" : "google_error", ...ids };
  if (!params.code) return { ok: false, reason: "no_code", ...ids };

  try {
    await d.checkAdmin(st.user_id, st.org_id);
  } catch {
    return { ok: false, reason: "not_admin", ...ids };
  }

  let tokens;
  try {
    tokens = await exchangeCode(d.f, d.client, params.code);
  } catch (err) {
    return { ok: false, reason: err instanceof DriveApiError && err.code === "invalid_grant" ? "code_expired" : "token_exchange_failed", ...ids };
  }
  if (!tokens.refreshToken) {
    // Spec: require a refresh token; if missing, ask to reconnect (and log it, without tokens).
    console.warn("drive callback: Google returned no refresh_token for org", st.org_id);
    return { ok: false, reason: "no_refresh_token", ...ids };
  }

  const googleEmail = emailFromIdToken(tokens.idToken);
  const { error } = await d.svc.from("drive_connections").upsert(
    {
      org_id: st.org_id,
      google_email: googleEmail,
      refresh_token_enc: encryptToken(tokens.refreshToken),
      status: "active",
      connected_by: st.user_id,
      connected_at: new Date(d.now ?? Date.now()).toISOString(),
      last_error: null,
    },
    { onConflict: "org_id" },
  );
  if (error) return { ok: false, reason: "db_error", ...ids };

  try {
    await ensureOrgRoot(d.svc, d.f, tokens.accessToken, st.org_id);
  } catch {
    // Connected, but the folder could not be made; start-upload will try again.
    return { ok: false, reason: "folder_failed", ...ids };
  }
  return { ok: true, ...ids, googleEmail };
}
