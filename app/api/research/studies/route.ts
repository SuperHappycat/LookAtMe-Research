/**
 * app/api/research/studies/route.ts
 * ===================================
 * GET  ?orgId=…                       studies of the org (lead or site), with the lead's name   (any member)
 * POST { orgId, name, blindDefault }  create a study; the org becomes lead and an active site   (org admin, multi_site)
 *
 * The create goes through the create_study RPC with the caller's own token, so the database checks the role and
 * plan again.
 */

import { handle, requireUser } from "@/lib/research/supabase/server";
import { listStudies, requireMultiSite, requireUuid, StudyError } from "@/lib/research/studies/service";
import { rpcAsUser, serviceStudyData, studyRoute } from "@/lib/research/studies/server";

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  const orgId = new URL(req.url).searchParams.get("orgId");
  const studies = await studyRoute(() => listStudies(serviceStudyData(), user.id, orgId));
  return Response.json({ studies });
});

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const body = (await req.json().catch(() => ({}))) as { orgId?: string; name?: string; blindDefault?: boolean };
  const id = await studyRoute(async () => {
    const orgId = requireUuid(body.orgId, "organization");
    const d = serviceStudyData();
    if ((await d.memberRole(user.id, orgId)) !== "admin") {
      throw new StudyError(403, "เฉพาะผู้ดูแล / Admins only.");
    }
    await requireMultiSite(d, orgId);
    const name = (body.name ?? "").trim();
    if (!name || name.length > 200) throw new StudyError(400, "กรุณาใส่ชื่อโครงการ / Please enter a study name.");
    return rpcAsUser<string>(req, "create_study", { p_org: orgId, p_name: name, p_blind: !!body.blindDefault });
  });
  return Response.json({ id });
});
