/**
 * lib/research/drive/http.ts — shared pieces of the /api/drive/* route handlers (server only).
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError, requireOrgRole } from "../supabase/server";
import { DRIVE_ERR } from "./config";
import { DriveConfigError } from "./crypto";
import { DriveApiError } from "./google";
import { DriveFlowError, MSG } from "./service";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Like supabase/server.ts handle(), but also returns a stable `code` for Drive errors. */
export function driveHandle(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      return await fn(req);
    } catch (err) {
      if (err instanceof DriveFlowError) return Response.json({ error: err.message, code: err.code }, { status: err.status });
      if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
      if (err instanceof DriveConfigError) return Response.json({ error: err.message }, { status: 500 });
      if (err instanceof DriveApiError) {
        // The message never contains tokens (see google.ts toError).
        console.error("drive api error:", err.code, err.status, err.message);
        return Response.json({ error: "Google Drive error.", code: "drive_error" }, { status: 502 });
      }
      console.error("drive route error:", err instanceof Error ? err.message : "unknown");
      return Response.json({ error: "Server error." }, { status: 500 });
    }
  };
}

export interface UploadSession {
  id: string;
  orgId: string;
  childId: string;
  childCode: string;
  startedAt: string;
}

/**
 * Loads a session for recording upload: the caller must be admin/staff of the session's org,
 * and the child must have a current (not withdrawn) consent with allow_recording = true.
 */
export async function loadUploadSession(svc: SupabaseClient, userId: string, sessionId: string): Promise<UploadSession> {
  if (!UUID_RE.test(sessionId)) throw new HttpError(400, "Bad session id.");
  const { data: s, error } = await svc
    .from("sessions")
    .select("id, org_id, child_id, started_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!s) throw new HttpError(404, "Session not found.");
  await requireOrgRole(userId, s.org_id, ["admin", "staff"]);

  const { data: child } = await svc.from("children").select("id, code, org_id").eq("id", s.child_id).maybeSingle();
  if (!child || child.org_id !== s.org_id) throw new HttpError(404, "Child not found.");

  const { data: consents } = await svc
    .from("consents")
    .select("allow_recording, signed_at")
    .eq("child_id", s.child_id)
    .eq("org_id", s.org_id)
    .is("withdrawn_at", null)
    .order("signed_at", { ascending: false })
    .limit(1);
  if (!consents?.[0]?.allow_recording) throw new DriveFlowError(403, DRIVE_ERR.noConsent, MSG.noConsent);

  return { id: s.id, orgId: s.org_id, childId: s.child_id, childCode: child.code, startedAt: s.started_at };
}

export function parseLevel(v: unknown): 1 | 2 | 3 {
  const n = Number(v);
  if (n === 1 || n === 2 || n === 3) return n;
  throw new HttpError(400, "level must be 1, 2 or 3.");
}

/** The Origin the browser will PUT from (Google allows CORS for the origin that started the session). */
export function uploadOrigin(req: Request): string {
  if (process.env.APP_URL) return new URL(process.env.APP_URL).origin;
  if (process.env.NODE_ENV === "production") throw new HttpError(500, "APP_URL is not configured on the server.");
  return new URL(req.url).origin;
}
