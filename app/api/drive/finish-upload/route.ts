/**
 * app/api/drive/finish-upload/route.ts (spec §4.4 step 4)
 * POST { session_id, level, drive_file_id, size? }        → verifies the file in Drive
 *      (appProperties.lookatme_session must match) and saves a session_files row (google_drive).
 * POST { session_id, level, location: "local_only", size? } → records "saved on this computer".
 */

import { getServiceClient, requireUser } from "@/lib/research/supabase/server";
import { oauthClientFromEnv } from "@/lib/research/drive/google";
import { driveHandle, loadUploadSession, parseLevel } from "@/lib/research/drive/http";
import { finishUpload, recordLocalOnly } from "@/lib/research/drive/upload";

export const POST = driveHandle(async (req) => {
  const user = await requireUser(req);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const level = parseLevel(body.level);
  const size = Number.isInteger(body.size) && (body.size as number) > 0 ? (body.size as number) : undefined;
  const svc = getServiceClient();
  const s = await loadUploadSession(svc, user.id, String(body.session_id ?? ""));
  if (body.location === "local_only") {
    await recordLocalOnly(svc, s, level, size ?? null);
    return Response.json({ ok: true, location: "local_only" });
  }
  const out = await finishUpload({ svc, f: fetch, client: oauthClientFromEnv() }, s, {
    driveFileId: String(body.drive_file_id ?? ""),
    level,
    size,
  });
  return Response.json({ ok: true, location: "google_drive", ...out });
});
