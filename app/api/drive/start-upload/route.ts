/**
 * app/api/drive/start-upload/route.ts (spec §4.4 steps 1–2)
 * POST { session_id, level, size, mimeType } (admin/staff of the session's org)
 *  → { uploadUrl, uploadSig } — a Drive resumable-upload session URL the browser PUTs to,
 *    and a signature that lets /api/drive/upload-chunk proxy to that URL if CORS blocks it.
 * 409 drive_not_connected / drive_needs_reconnect, 403 no_recording_consent, 507 drive_full.
 */

import { getServiceClient, requireUser } from "@/lib/research/supabase/server";
import { signUploadUrl } from "@/lib/research/drive/crypto";
import { oauthClientFromEnv } from "@/lib/research/drive/google";
import { driveHandle, loadUploadSession, parseLevel, uploadOrigin } from "@/lib/research/drive/http";
import { startUpload, validateUploadRequest } from "@/lib/research/drive/upload";

export const POST = driveHandle(async (req) => {
  const user = await requireUser(req);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const level = parseLevel(body.level);
  const { size, mimeType } = validateUploadRequest(body.size, body.mimeType);
  const svc = getServiceClient();
  const s = await loadUploadSession(svc, user.id, String(body.session_id ?? ""));
  const { uploadUrl } = await startUpload(
    { svc, f: fetch, client: oauthClientFromEnv() },
    s,
    { size, mimeType, level, origin: uploadOrigin(req) },
  );
  return Response.json({ uploadUrl, uploadSig: signUploadUrl(uploadUrl, s.id) }, { headers: { "Cache-Control": "no-store" } });
});
