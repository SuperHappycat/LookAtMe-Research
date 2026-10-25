/**
 * lib/research/drive/service.ts
 * ===============================
 * Drive operations that touch the database (service role). Used only by /api/drive/* routes
 * and lib/research/drive/server.ts. `svc` and `f` are injected so tests can run without
 * Supabase or Google. Callers must have checked the user's role first.
 *
 * Refresh tokens are decrypted only here, used once, and never returned or logged.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DriveStatus } from "../contracts";
import { DRIVE_ERR, rootFolderName } from "./config";
import { decryptToken } from "./crypto";
import { DriveApiError, ensureRootFolder, refreshAccessToken, type Fetch, type OAuthClient } from "./google";

export class DriveFlowError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const MSG = {
  notConnected: "ยังไม่ได้เชื่อมต่อ Google Drive / Google Drive is not connected.",
  needsReconnect: "กรุณาเชื่อมต่อ Google Drive อีกครั้ง / Please reconnect Google Drive.",
  full: "Google Drive เต็ม / Google Drive is full.",
  noConsent: "ผู้ปกครองไม่ได้ยินยอมให้บันทึกวิดีโอ / No parent consent for video recording.",
  notFound: "ไม่พบไฟล์ใน Google Drive / File not found in Google Drive.",
};

export interface DriveConnectionRow {
  org_id: string;
  google_email: string | null;
  refresh_token_enc: string | null;
  status: "active" | "needs_reconnect" | "revoked";
  connected_at: string | null;
  last_error: string | null;
}

export async function loadConnection(svc: SupabaseClient, orgId: string): Promise<DriveConnectionRow | null> {
  const { data, error } = await svc
    .from("drive_connections")
    .select("org_id, google_email, refresh_token_enc, status, connected_at, last_error")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new DriveFlowError(500, "db_error", error.message);
  return (data as DriveConnectionRow | null) ?? null;
}

export function statusOf(row: DriveConnectionRow | null): DriveStatus {
  if (!row) return "not_connected";
  if (row.status === "active" && !row.refresh_token_enc) return "needs_reconnect";
  return row.status;
}

async function setStatus(svc: SupabaseClient, orgId: string, status: DriveConnectionRow["status"], lastError: string | null) {
  await svc.from("drive_connections").update({ status, last_error: lastError }).eq("org_id", orgId);
}

/** Records a non-fatal error (e.g. Drive full) for the admin, keeping the connection active. */
export async function noteError(svc: SupabaseClient, orgId: string, lastError: string) {
  await svc.from("drive_connections").update({ last_error: lastError }).eq("org_id", orgId);
}

/**
 * Gets a short-lived access token for the org's Drive.
 * Not connected / revoked → 409 drive_not_connected; needs_reconnect or invalid_grant → 409 drive_needs_reconnect
 * (and the connection is marked needs_reconnect so admins see the banner).
 */
export async function getAccessToken(svc: SupabaseClient, f: Fetch, client: OAuthClient, orgId: string): Promise<string> {
  const row = await loadConnection(svc, orgId);
  const st = statusOf(row);
  if (st === "not_connected" || st === "revoked") throw new DriveFlowError(409, DRIVE_ERR.notConnected, MSG.notConnected);
  if (st === "needs_reconnect") throw new DriveFlowError(409, DRIVE_ERR.needsReconnect, MSG.needsReconnect);
  let refresh: string;
  try {
    refresh = decryptToken(row!.refresh_token_enc!);
  } catch {
    // Wrong/rotated key or a damaged value: the admin must reconnect.
    await setStatus(svc, orgId, "needs_reconnect", "token_decrypt_failed");
    throw new DriveFlowError(409, DRIVE_ERR.needsReconnect, MSG.needsReconnect);
  }
  try {
    return await refreshAccessToken(f, client, refresh);
  } catch (err) {
    if (err instanceof DriveApiError && err.code === "invalid_grant") {
      await setStatus(svc, orgId, "needs_reconnect", "invalid_grant");
      throw new DriveFlowError(409, DRIVE_ERR.needsReconnect, MSG.needsReconnect);
    }
    throw err;
  }
}

/** Ensures organizations.drive_folder_id points at a usable folder; recreates it if deleted/trashed. */
export async function ensureOrgRoot(svc: SupabaseClient, f: Fetch, accessToken: string, orgId: string): Promise<string> {
  const { data: org, error } = await svc.from("organizations").select("id, name, drive_folder_id").eq("id", orgId).maybeSingle();
  if (error || !org) throw new DriveFlowError(404, "org_not_found", "Organization not found.");
  const root = await ensureRootFolder(f, accessToken, (org.drive_folder_id as string | null) ?? null, rootFolderName(org.name as string));
  if (root.created || root.id !== org.drive_folder_id) {
    const { error: upErr } = await svc.from("organizations").update({ drive_folder_id: root.id }).eq("id", orgId);
    if (upErr) throw new DriveFlowError(500, "db_error", upErr.message);
  }
  return root.id;
}

/** Maps Google errors to user-facing route errors (Drive full, file not found). */
export async function mapDriveError(svc: SupabaseClient, orgId: string, err: unknown): Promise<never> {
  if (err instanceof DriveApiError) {
    if (err.code === "storage_quota") {
      await noteError(svc, orgId, "storage_quota");
      throw new DriveFlowError(507, DRIVE_ERR.full, MSG.full);
    }
    if (err.code === "invalid_grant") {
      await setStatus(svc, orgId, "needs_reconnect", "invalid_grant");
      throw new DriveFlowError(409, DRIVE_ERR.needsReconnect, MSG.needsReconnect);
    }
    if (err.code === "not_found") throw new DriveFlowError(404, DRIVE_ERR.notFound, MSG.notFound);
    throw new DriveFlowError(502, "drive_error", err.message);
  }
  throw err;
}
