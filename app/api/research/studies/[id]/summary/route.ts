/**
 * app/api/research/studies/[id]/summary/route.ts
 * ================================================
 * GET ?orgId=…  combined summary, AGGREGATES ONLY (no child codes, birth dates or session ids).
 *   - admin/staff of the LEAD org: every active site + total;
 *   - admin/staff of a site: its own block only.
 * Logged as 'view_study_summary'. See lib/research/studies/service.ts for the rules.
 */

import { handle, requireUser } from "@/lib/research/supabase/server";
import { studySummary } from "@/lib/research/studies/service";
import { serviceStudyData, studyRoute } from "@/lib/research/studies/server";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(async (r) => {
    const user = await requireUser(r);
    const orgId = new URL(r.url).searchParams.get("orgId");
    const summary = await studyRoute(() => studySummary(serviceStudyData(), user.id, id, orgId));
    return Response.json({ summary }, { headers: { "Cache-Control": "no-store" } });
  })(req);
}
