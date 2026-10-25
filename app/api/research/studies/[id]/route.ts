/**
 * app/api/research/studies/[id]/route.ts
 * ========================================
 * GET ?orgId=…  the study as seen by the acting org: lead → all sites (+ invite list for admins);
 *               site → only the lead and itself. Never returns invite codes (only hashes are stored).
 */

import { handle, requireUser } from "@/lib/research/supabase/server";
import { studyDetail } from "@/lib/research/studies/service";
import { serviceStudyData, studyRoute } from "@/lib/research/studies/server";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(async (r) => {
    const user = await requireUser(r);
    const orgId = new URL(r.url).searchParams.get("orgId");
    const study = await studyRoute(() => studyDetail(serviceStudyData(), user.id, id, orgId));
    return Response.json({ study });
  })(req);
}
