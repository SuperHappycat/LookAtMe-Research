/**
 * app/api/drive/status/route.ts
 * GET ?orgId → { status: DriveStatus, googleEmail, connectedAt, lastError, hasFolder }
 * Any member (admin / staff / viewer). Never returns tokens.
 */

import { getServiceClient, HttpError, requireOrgRole, requireUser } from "@/lib/research/supabase/server";
import { driveHandle } from "@/lib/research/drive/http";
import { loadConnection, statusOf } from "@/lib/research/drive/service";

export const GET = driveHandle(async (req) => {
  const user = await requireUser(req);
  const orgId = new URL(req.url).searchParams.get("orgId") ?? "";
  await requireOrgRole(user.id, orgId, ["admin", "staff", "viewer"]);
  const svc = getServiceClient();
  const row = await loadConnection(svc, orgId);
  const { data: org, error } = await svc.from("organizations").select("drive_folder_id").eq("id", orgId).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  return Response.json(
    {
      status: statusOf(row),
      googleEmail: row?.google_email ?? null,
      connectedAt: row?.connected_at ?? null,
      lastError: row?.last_error ?? null,
      hasFolder: !!org?.drive_folder_id,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
