/**
 * app/api/drive/files/route.ts (spec §4.6 "customer deleted a video", §4.7)
 * GET ?sessionId → { recordings: [{ level, location, driveFileId, sizeBytes, exists, viewUrl }], driveStatus }
 * exists: true / false ("ไม่พบไฟล์ใน Google Drive") / null (unknown: Drive not connected or unreachable).
 * Same visibility as the session's files (members; blind sessions admins only). No video is proxied.
 */

import { getServiceClient, HttpError, requireOrgRole, requireUser } from "@/lib/research/supabase/server";
import type { DriveStatus } from "@/lib/research/contracts";
import { driveViewUrl } from "@/lib/research/drive/config";
import { DriveApiError, getFile, oauthClientFromEnv } from "@/lib/research/drive/google";
import { driveHandle, UUID_RE } from "@/lib/research/drive/http";
import { DriveFlowError, getAccessToken, loadConnection, statusOf } from "@/lib/research/drive/service";

export const GET = driveHandle(async (req) => {
  const user = await requireUser(req);
  const sessionId = new URL(req.url).searchParams.get("sessionId") ?? "";
  if (!UUID_RE.test(sessionId)) throw new HttpError(400, "Bad session id.");
  const svc = getServiceClient();
  const { data: s } = await svc.from("sessions").select("id, org_id, blind").eq("id", sessionId).maybeSingle();
  if (!s) throw new HttpError(404, "Session not found.");
  await requireOrgRole(user.id, s.org_id, s.blind ? ["admin"] : ["admin", "staff", "viewer"]);

  const { data: files, error } = await svc
    .from("session_files")
    .select("level, location, drive_file_id, size_bytes")
    .eq("session_id", sessionId)
    .eq("kind", "recording")
    .order("level");
  if (error) throw new HttpError(500, error.message);

  const driveStatus: DriveStatus = statusOf(await loadConnection(svc, s.org_id));
  let token: string | null = null;
  let tokenFailed = false;
  if (driveStatus === "active" && (files ?? []).some((f) => f.drive_file_id)) {
    try {
      token = await getAccessToken(svc, fetch, oauthClientFromEnv(), s.org_id);
    } catch (err) {
      if (!(err instanceof DriveFlowError || err instanceof DriveApiError)) throw err;
      tokenFailed = true;
    }
  }

  const recordings = await Promise.all(
    (files ?? []).map(async (f) => {
      let exists: boolean | null = null;
      if (f.drive_file_id && token) {
        try {
          const m = await getFile(fetch, token, f.drive_file_id, "id,trashed");
          exists = !m.trashed;
        } catch (err) {
          exists = err instanceof DriveApiError && err.code === "not_found" ? false : null;
        }
      }
      return {
        level: f.level as number,
        location: f.location as string,
        driveFileId: (f.drive_file_id as string | null) ?? null,
        sizeBytes: (f.size_bytes as number | null) ?? null,
        exists,
        viewUrl: f.drive_file_id ? driveViewUrl(f.drive_file_id) : null,
      };
    }),
  );
  const finalStatus = tokenFailed ? statusOf(await loadConnection(svc, s.org_id)) : driveStatus;
  return Response.json({ recordings, driveStatus: finalStatus });
});
