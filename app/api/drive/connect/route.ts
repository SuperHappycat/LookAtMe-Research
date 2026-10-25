/**
 * app/api/drive/connect/route.ts (spec §4.3 step 2)
 * POST { orgId } with the Supabase JWT (org admin) → { url } of Google's consent screen.
 *
 * POST instead of GET ?token=… so the Supabase access token never appears in a URL.
 * Sets a short-lived HttpOnly nonce cookie that the callback must match (binds the OAuth
 * round trip to this browser).
 */

import { requireOrgRole, requireUser } from "@/lib/research/supabase/server";
import { NONCE_COOKIE, STATE_TTL_MS } from "@/lib/research/drive/config";
import { signState } from "@/lib/research/drive/crypto";
import { buildAuthUrl, oauthClientFromEnv } from "@/lib/research/drive/google";
import { driveHandle } from "@/lib/research/drive/http";

export const POST = driveHandle(async (req) => {
  const user = await requireUser(req);
  const body = (await req.json().catch(() => ({}))) as { orgId?: string };
  const orgId = body.orgId ?? "";
  await requireOrgRole(user.id, orgId, ["admin"]);
  const client = oauthClientFromEnv();
  const { state, nonce } = signState({ org_id: orgId, user_id: user.id });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return Response.json(
    { url: buildAuthUrl(client, state) },
    {
      headers: {
        "Set-Cookie": `${NONCE_COOKIE}=${nonce}; Path=/api/drive/callback; HttpOnly; SameSite=Lax; Max-Age=${STATE_TTL_MS / 1000}${secure}`,
        "Cache-Control": "no-store",
      },
    },
  );
});
