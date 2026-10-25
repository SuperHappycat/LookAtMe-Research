/**
 * app/api/drive/upload-chunk/route.ts (spec §4.4 CORS fallback)
 * POST raw bytes (≤ 3.75 MiB = 15 × 256 KiB, under Vercel's ~4.5 MB body limit) with headers
 *   X-Session-Id, X-Upload-Url, X-Upload-Sig (from start-upload), X-Upload-Range ("bytes a-b/total" or "bytes * /total")
 * → { done: true, fileId } | { done: false, nextOffset }
 * Only forwards to the Drive session URL start-upload signed for this session.
 */

import { getServiceClient, HttpError, requireUser } from "@/lib/research/supabase/server";
import { PROXY_CHUNK_BYTES } from "@/lib/research/drive/config";
import { verifyUploadUrl } from "@/lib/research/drive/crypto";
import { driveHandle, loadUploadSession } from "@/lib/research/drive/http";
import { forwardChunk, validateProxyChunk } from "@/lib/research/drive/upload";

export const POST = driveHandle(async (req) => {
  const user = await requireUser(req);
  const sessionId = req.headers.get("x-session-id") ?? "";
  const uploadUrl = req.headers.get("x-upload-url") ?? "";
  const sig = req.headers.get("x-upload-sig") ?? "";
  const range = req.headers.get("x-upload-range") ?? "";
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > PROXY_CHUNK_BYTES) throw new HttpError(413, "Chunk too large (max 3.75 MiB).");

  await loadUploadSession(getServiceClient(), user.id, sessionId);
  if (!uploadUrl || !sig || !verifyUploadUrl(uploadUrl, sessionId, sig)) throw new HttpError(403, "Unknown upload session.");

  const body = new Uint8Array(await req.arrayBuffer());
  validateProxyChunk(range, body.byteLength);
  const out = await forwardChunk(fetch, uploadUrl, range, body);
  return Response.json(out, { headers: { "Cache-Control": "no-store" } });
});
