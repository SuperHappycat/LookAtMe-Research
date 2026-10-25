/**
 * app/api/research/studies/join/route.ts
 * ========================================
 * POST { code, orgId }  redeem a one-time invite code; the org becomes an active site   (org admin, multi_site)
 *
 * Unknown, used and expired codes all get the same answer. The database records failures and blocks an org
 * after 10 wrong codes in an hour (redeem_study_invite).
 */

import { handle, HttpError, requireUser } from "@/lib/research/supabase/server";
import { requireMultiSite, requireUuid, StudyError } from "@/lib/research/studies/service";
import { normalizeInviteCode } from "@/lib/research/studies/codes";
import { rpcAsUser, serviceStudyData, studyRoute } from "@/lib/research/studies/server";

const BAD_CODE = "รหัสไม่ถูกต้อง ใช้ไปแล้ว หรือหมดอายุ / This code is wrong, already used or expired.";

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const body = (await req.json().catch(() => ({}))) as { orgId?: string; code?: string };
  const studyId = await studyRoute(async () => {
    const orgId = requireUuid(body.orgId, "organization");
    const d = serviceStudyData();
    if ((await d.memberRole(user.id, orgId)) !== "admin") throw new StudyError(403, "เฉพาะผู้ดูแล / Admins only.");
    await requireMultiSite(d, orgId);
    const code = normalizeInviteCode(String(body.code ?? ""));
    // Malformed input still goes to the database, so it counts towards the rate limit like any wrong code.
    return rpcAsUser<string | null>(req, "redeem_study_invite", { p_code: code.slice(0, 64), p_org: orgId });
  });
  if (!studyId) throw new HttpError(400, BAD_CODE);
  return Response.json({ studyId });
});
