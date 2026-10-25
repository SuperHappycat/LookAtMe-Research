/**
 * app/api/drive/disconnect/route.ts (spec §4.6 "Disconnect")
 * POST { orgId } (org admin) → revoke the refresh token at Google, set status 'revoked',
 * wipe refresh_token_enc. Files stay in the customer's Drive.
 */

import { audit, getServiceClient, HttpError, requireOrgRole, requireUser } from "@/lib/research/supabase/server";
import { decryptToken } from "@/lib/research/drive/crypto";
import { revokeToken } from "@/lib/research/drive/google";
import { driveHandle } from "@/lib/research/drive/http";
import { loadConnection } from "@/lib/research/drive/service";

export const POST = driveHandle(async (req) => {
  const user = await requireUser(req);
  const body = (await req.json().catch(() => ({}))) as { orgId?: string };
  const orgId = body.orgId ?? "";
  await requireOrgRole(user.id, orgId, ["admin"]);
  const svc = getServiceClient();
  const row = await loadConnection(svc, orgId);
  if (!row) return Response.json({ ok: true, status: "not_connected" });

  let revoked = false;
  if (row.refresh_token_enc) {
    try {
      revoked = await revokeToken(fetch, decryptToken(row.refresh_token_enc));
    } catch {
      revoked = false; // undecryptable: nothing usable to revoke; wipe it anyway
    }
  }
  const { error } = await svc
    .from("drive_connections")
    .update({ status: "revoked", refresh_token_enc: null, last_error: revoked ? null : "revoke_failed" })
    .eq("org_id", orgId);
  if (error) throw new HttpError(500, error.message);
  await audit(orgId, user.id, "drive_disconnect");
  return Response.json({ ok: true, status: "revoked", revokedAtGoogle: revoked });
});
