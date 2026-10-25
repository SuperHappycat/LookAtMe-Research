import "server-only";
import { appUrl, audit, findUserByEmail, getServiceClient, HttpError } from "./server";
import type { MemberRole } from "../plans";

/**
 * Adds `email` to an organization with `role`, checking seats.
 * New people get a Supabase invite email (link → /account/set-password);
 * people who already have an account are just added.
 */
export async function inviteMember(
  req: Request,
  orgId: string,
  email: string,
  role: MemberRole,
  inviterId: string,
): Promise<{ userId: string; invited: boolean }> {
  const svc = getServiceClient();
  const { data: org, error: orgErr } = await svc.from("organizations").select("id, seats").eq("id", orgId).maybeSingle();
  if (orgErr) throw new HttpError(500, orgErr.message);
  if (!org) throw new HttpError(404, "Organization not found.");

  const { count } = await svc.from("members").select("user_id", { count: "exact", head: true }).eq("org_id", orgId);
  if ((count ?? 0) >= org.seats) {
    throw new HttpError(409, `ที่นั่งเต็มแล้ว (${org.seats}) / All ${org.seats} staff seats are used.`);
  }

  let userId: string;
  let invited = false;
  const existing = await findUserByEmail(email);
  if (existing) {
    userId = existing.id;
  } else {
    const { data, error } = await svc.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${appUrl(req)}/account/set-password`,
    });
    if (error || !data.user) throw new HttpError(502, `Invite email failed: ${error?.message ?? "unknown error"}`);
    userId = data.user.id;
    invited = true;
  }

  const { error: memErr } = await svc
    .from("members")
    .upsert({ user_id: userId, org_id: orgId, role }, { onConflict: "user_id,org_id" });
  if (memErr) throw new HttpError(500, memErr.message);
  await audit(orgId, inviterId, "invite", role);
  return { userId, invited };
}
