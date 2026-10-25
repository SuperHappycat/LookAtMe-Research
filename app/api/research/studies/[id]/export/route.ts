/**
 * app/api/research/studies/[id]/export/route.ts
 * ===============================================
 * GET ?orgId=…  row-level CODED export (CSV), LEAD ADMIN only.
 *   Rows only from active sites whose admin turned on share_row_data, and only for children whose latest active
 *   consent allows research. Study-scoped pseudonymous IDs (HMAC with STUDY_PSEUDONYM_SECRET), never child
 *   codes, birth dates or session ids. Logged as 'export_study_csv' for the lead and for each site.
 */

import { handle, requireUser } from "@/lib/research/supabase/server";
import { studyExport } from "@/lib/research/studies/service";
import { serviceStudyData, studyRoute } from "@/lib/research/studies/server";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(async (r) => {
    const user = await requireUser(r);
    const orgId = new URL(r.url).searchParams.get("orgId");
    const out = await studyRoute(() =>
      studyExport(serviceStudyData(), user.id, id, orgId, process.env.STUDY_PSEUDONYM_SECRET),
    );
    return new Response(out.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${out.filename}"`,
        "Cache-Control": "no-store",
        "X-Row-Count": String(out.rows),
      },
    });
  })(req);
}
