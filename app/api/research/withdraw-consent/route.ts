/**
 * app/api/research/withdraw-consent/route.ts
 * ============================================
 * POST { childId, reason, confirmCode, force? }   org admin of the child's organization (spec §5.3)
 *
 * Deletes the child's Drive recordings, gaze CSVs and all rows (children cascade), then writes the audit log
 * with the reason category only. Steps and failure handling: lib/research/followup/withdraw.ts.
 */

import { audit, getServiceClient, handle, HttpError, requireOrgRole, requireUser } from "@/lib/research/supabase/server";
import { deleteChildDriveFolder, deleteDriveFiles } from "@/lib/research/drive/server";
import { withdrawConsent, WithdrawError, type WithdrawFile } from "@/lib/research/followup/withdraw";

function check<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new HttpError(500, r.error.message);
  return r.data;
}

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const svc = getServiceClient();
  try {
    const summary = await withdrawConsent(body, {
      async loadChild(childId) {
        return check(await svc.from("children").select("id, org_id, code").eq("id", childId).maybeSingle());
      },
      requireAdmin: (orgId) => requireOrgRole(user.id, orgId, ["admin"]),
      async loadSessionIds(childId) {
        const rows = check(await svc.from("sessions").select("id").eq("child_id", childId));
        return (rows ?? []).map((r: { id: string }) => r.id);
      },
      async loadFiles(sessionIds) {
        const rows = check(
          await svc
            .from("session_files")
            .select("session_id, kind, location, path, drive_file_id")
            .in("session_id", sessionIds),
        );
        return (rows ?? []) as WithdrawFile[];
      },
      async markWithdrawn(childId, reason) {
        check(
          await svc
            .from("consents")
            .update({ withdrawn_at: new Date().toISOString(), withdrawn_reason: reason })
            .eq("child_id", childId)
            .is("withdrawn_at", null),
        );
      },
      deleteDriveFiles,
      deleteChildFolder: deleteChildDriveFolder,
      async removeGaze(paths) {
        for (let i = 0; i < paths.length; i += 100) {
          const { error } = await svc.storage.from("gaze").remove(paths.slice(i, i + 100));
          if (error) throw error;
        }
      },
      async deleteChild(childId) {
        check(await svc.from("children").delete().eq("id", childId));
      },
      audit: (orgId, target) => audit(orgId, user.id, "withdraw_consent", target),
    });
    return Response.json(summary);
  } catch (err) {
    if (err instanceof WithdrawError) {
      if (err.driveFailed) return Response.json({ error: err.message, code: "drive_delete_failed", driveFailed: err.driveFailed }, { status: err.status });
      throw new HttpError(err.status, err.message);
    }
    throw err;
  }
});
