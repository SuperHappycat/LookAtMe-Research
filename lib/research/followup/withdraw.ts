/**
 * lib/research/followup/withdraw.ts
 * ===================================
 * Consent withdrawal (spec §5.3) as a plain function with injected dependencies, so the order of steps and
 * the failure handling can be unit-tested without Supabase or Google (tests/followup.test.ts).
 * The route app/api/research/withdraw-consent/route.ts wires the real service client into it.
 *
 * Order:
 *   0. caller must be an admin of the child's organization; the typed code must match;
 *   1. mark active consents withdrawn (so no new screening can start while we delete);
 *   2. delete Drive recordings, then the child's Drive folder. If any recording could not be deleted we STOP
 *      (409) before deleting rows, so the file ids are not lost; the admin can reconnect Drive and retry, or
 *      send force=true to go ahead and delete the listed files by hand;
 *   3. delete the gaze CSVs from the `gaze` bucket (a failure STOPS here, so nothing is orphaned without a
 *      way to retry: the child row still exists and the admin can run it again);
 *   4. delete the child row (cascades to consents, sessions, session_files, diagnoses);
 *   5. audit log with the reason category only (no child code, no ids).
 * screenings_used is not refunded.
 */

import { WITHDRAW_REASONS, type WithdrawReason } from "./config";

export interface WithdrawChild {
  id: string;
  org_id: string;
  code: string;
}
export interface WithdrawFile {
  session_id: string;
  kind: string;
  location: string;
  path: string | null;
  drive_file_id: string | null;
}

export interface WithdrawDeps {
  loadChild(childId: string): Promise<WithdrawChild | null>;
  /** Throws (HttpError 403) unless the caller is an admin of orgId. */
  requireAdmin(orgId: string): Promise<void>;
  loadSessionIds(childId: string): Promise<string[]>;
  loadFiles(sessionIds: string[]): Promise<WithdrawFile[]>;
  markWithdrawn(childId: string, reason: WithdrawReason): Promise<void>;
  deleteDriveFiles(orgId: string, fileIds: string[]): Promise<{ deleted: number; failed: string[] }>;
  /** Deletes the child's Drive folder (catches recordings still uploading). True if gone; never throws. */
  deleteChildFolder?(orgId: string, childCode: string): Promise<boolean>;
  /** Removes these object paths from the gaze bucket; throws on failure. Missing objects are fine. */
  removeGaze(paths: string[]): Promise<void>;
  deleteChild(childId: string): Promise<void>;
  audit(orgId: string, target: string): Promise<void>;
}

export interface WithdrawInput {
  childId?: unknown;
  reason?: unknown;
  confirmCode?: unknown;
  /** Go ahead even though some Drive files could not be deleted (they are returned in driveFailed). */
  force?: unknown;
}

export interface WithdrawSummary {
  ok: true;
  sessionsDeleted: number;
  gazeFilesDeleted: number;
  driveDeleted: number;
  /** Drive file ids that could not be deleted: the admin must delete them by hand. */
  driveFailed: string[];
  /** Recordings that were only saved on a device ("save on this computer"): not reachable from the server. */
  localOnlyRecordings: number;
  /** False when the child's Drive folder could not be removed (or Drive is not connected). */
  driveFolderDeleted: boolean;
}

export class WithdrawError extends Error {
  status: number;
  /** Drive file ids that could not be deleted (409 drive_delete_failed). */
  driveFailed?: string[];
  constructor(status: number, message: string, driveFailed?: string[]) {
    super(message);
    this.status = status;
    this.driveFailed = driveFailed;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function withdrawConsent(input: WithdrawInput, deps: WithdrawDeps): Promise<WithdrawSummary> {
  const childId = typeof input.childId === "string" ? input.childId : "";
  if (!UUID.test(childId)) throw new WithdrawError(400, "Bad child id.");
  const reason = (typeof input.reason === "string" ? input.reason : "") as WithdrawReason;
  if (!(reason in WITHDRAW_REASONS)) throw new WithdrawError(400, "Unknown reason.");

  const child = await deps.loadChild(childId);
  if (!child) throw new WithdrawError(404, "ไม่พบ / Not found.");
  await deps.requireAdmin(child.org_id);
  if (typeof input.confirmCode !== "string" || input.confirmCode.trim() !== child.code) {
    throw new WithdrawError(400, "รหัสเด็กไม่ตรงกัน / The child code you typed does not match.");
  }

  await deps.markWithdrawn(child.id, reason);

  const sessionIds = await deps.loadSessionIds(child.id);
  const files = sessionIds.length ? await deps.loadFiles(sessionIds) : [];

  const driveIds = [
    ...new Set(
      files
        .filter((f) => f.kind === "recording" && f.location === "google_drive" && f.drive_file_id)
        .map((f) => f.drive_file_id as string),
    ),
  ];
  const localOnlyRecordings = files.filter((f) => f.kind === "recording" && f.location === "local_only").length;
  const drive = driveIds.length ? await deps.deleteDriveFiles(child.org_id, driveIds) : { deleted: 0, failed: [] };
  if (drive.failed.length && input.force !== true) {
    throw new WithdrawError(
      409,
      `ลบวิดีโอใน Google Drive ไม่สำเร็จ ${drive.failed.length} ไฟล์ ยังไม่ได้ลบข้อมูลเด็ก กรุณาเชื่อมต่อ Google Drive ใหม่แล้วลองอีกครั้ง / ${drive.failed.length} Drive recording(s) could not be deleted. The child's data was not deleted yet; reconnect Google Drive and try again.`,
      drive.failed,
    );
  }
  const driveFolderDeleted = deps.deleteChildFolder ? await deps.deleteChildFolder(child.org_id, child.code).catch(() => false) : false;

  // Gaze CSV paths: the recorded ones plus the standard "<org>/<session>.csv" (covers uploads whose
  // complete_session never ran). Only paths inside this organization's folder.
  const prefix = `${child.org_id}/`;
  const gazePaths = [
    ...new Set([
      ...files.filter((f) => f.kind === "gaze_csv" && f.location === "supabase" && f.path).map((f) => f.path as string),
      ...sessionIds.map((id) => `${prefix}${id}.csv`),
    ]),
  ].filter((p) => p.startsWith(prefix) && !p.includes(".."));
  if (gazePaths.length) {
    try {
      await deps.removeGaze(gazePaths);
    } catch {
      throw new WithdrawError(
        502,
        "ลบไฟล์ข้อมูลการมองไม่สำเร็จ ยังไม่ได้ลบข้อมูลเด็ก กรุณาลองอีกครั้ง / Could not delete the gaze files. The child's data was not deleted yet; please try again.",
      );
    }
  }

  await deps.deleteChild(child.id);
  // Reason category only: no child code, ids or counts that could identify the child.
  await deps.audit(child.org_id, `reason:${reason}`);

  return {
    ok: true,
    sessionsDeleted: sessionIds.length,
    gazeFilesDeleted: files.filter((f) => f.kind === "gaze_csv").length,
    driveDeleted: drive.deleted,
    driveFailed: drive.failed,
    localOnlyRecordings,
    driveFolderDeleted,
  };
}
