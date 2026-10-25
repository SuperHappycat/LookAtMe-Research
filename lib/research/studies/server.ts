/**
 * lib/research/studies/server.ts
 * ================================
 * Server-only glue for the study routes:
 * - `serviceStudyData()`: the service-role implementation of `StudyData` (lib/research/studies/service.ts),
 *   whose functions check the caller before using it;
 * - `rpcAsUser()`: calls a SECURITY DEFINER RPC with the CALLER's token, so the database checks the role again;
 * - `studyRoute()`: maps StudyError and RPC error codes to HTTP responses.
 */

import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getServiceClient, HttpError } from "../supabase/server";
import type { MemberRole, PlanKey } from "../plans";
import { STUDIES_CONFIG } from "./config";
import { studyErrorFor } from "./messages";
import { StudyError, type StudyData, type StudyRowDb } from "./service";
import type { SummarySessionRow } from "./aggregate";
import type { ConsentRow, ExportSessionRow } from "./pseudonym";

const STUDY_COLS = "id, name, lead_org_id, blind_default, created_at";

/** Reads every page (PostgREST caps a response at 1000 rows). */
async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const size = STUDIES_CONFIG.pageSize;
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new HttpError(500, error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < size) return out;
  }
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export function serviceStudyData(): StudyData {
  const svc = getServiceClient();
  return {
    async memberRole(userId, orgId) {
      const { data } = await svc.from("members").select("role").eq("user_id", userId).eq("org_id", orgId).maybeSingle();
      return (data?.role as MemberRole | undefined) ?? null;
    },
    async orgPlan(orgId) {
      // An expired plan counts as no plan (matches org_has_multi_site in the database).
      const { data } = await svc.from("organizations").select("plan, expires_on").eq("id", orgId).maybeSingle();
      if (!data || (data.expires_on as string) < new Date().toISOString().slice(0, 10)) return null;
      return (data.plan as PlanKey | undefined) ?? null;
    },
    async orgNames(ids) {
      const m = new Map<string, string>();
      if (!ids.length) return m;
      const { data, error } = await svc.from("organizations").select("id, name").in("id", ids);
      if (error) throw new HttpError(500, error.message);
      for (const o of data ?? []) m.set(o.id, o.name);
      return m;
    },
    async study(id) {
      const { data } = await svc.from("studies").select(STUDY_COLS).eq("id", id).maybeSingle();
      return (data as StudyRowDb | null) ?? null;
    },
    async studiesForOrg(orgId) {
      const { data: siteRows } = await svc.from("study_sites").select("study_id").eq("org_id", orgId).neq("status", "left");
      const ids = (siteRows ?? []).map((r) => r.study_id as string);
      const { data: led } = await svc.from("studies").select(STUDY_COLS).eq("lead_org_id", orgId);
      const { data: joined } = ids.length ? await svc.from("studies").select(STUDY_COLS).in("id", ids) : { data: [] };
      const all = new Map<string, StudyRowDb>();
      for (const s of [...(led ?? []), ...(joined ?? [])] as StudyRowDb[]) all.set(s.id, s);
      return [...all.values()];
    },
    async sites(studyId) {
      const { data, error } = await svc
        .from("study_sites")
        .select("study_id, org_id, status, joined_at, share_row_data")
        .eq("study_id", studyId);
      if (error) throw new HttpError(500, error.message);
      return (data ?? []) as Awaited<ReturnType<StudyData["sites"]>>;
    },
    async invites(studyId) {
      const { data, error } = await svc
        .from("study_invites")
        .select("id, created_at, expires_at, used_at, used_by_org")
        .eq("study_id", studyId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new HttpError(500, error.message);
      return data ?? [];
    },
    async summarySessions(studyId, orgIds) {
      if (!orgIds.length) return [];
      return fetchAll<SummarySessionRow>((from, to) =>
        svc
          .from("sessions")
          .select("org_id, status, blind, risk_level, overall_score, level1_score, level2_score, level3_score, quality_score")
          .eq("study_id", studyId)
          .in("org_id", orgIds)
          .order("id")
          .range(from, to),
      );
    },
    async exportSessions(studyId, orgIds) {
      if (!orgIds.length) return [];
      return fetchAll<ExportSessionRow>((from, to) =>
        svc
          .from("sessions")
          .select(
            "org_id, child_id, started_at, status, risk_level, overall_score, level1_score, level2_score, level3_score, quality_score, face_found_pct, child:children(birth_month, sex)",
          )
          .eq("study_id", studyId)
          .in("org_id", orgIds)
          .order("id")
          .range(from, to),
      );
    },
    async consents(orgIds, childIds) {
      const out: ConsentRow[] = [];
      for (const part of chunks(childIds, 150)) {
        const rows = await fetchAll<ConsentRow>((from, to) =>
          svc
            .from("consents")
            .select("org_id, child_id, allow_research, signed_at, withdrawn_at")
            .in("org_id", orgIds)
            .in("child_id", part)
            .order("id")
            .range(from, to),
        );
        out.push(...rows);
      }
      return out;
    },
    async audit(orgId, userId, action, target) {
      const { error } = await svc.from("audit_log").insert({ org_id: orgId, user_id: userId, action, target });
      if (error) throw new HttpError(500, error.message);
    },
  };
}

/** Database error codes from the study RPCs → HttpError (unknown errors become a plain 500). */
export function rpcErrorToHttp(message: string): HttpError {
  const m = studyErrorFor(message);
  return m ? new HttpError(m.status, m.text) : new HttpError(500, "Server error.");
}

/** Calls an RPC as the caller (anon key + the caller's access token), so RLS and auth.uid() apply. */
export async function rpcAsUser<T>(req: Request, fn: string, args: Record<string, unknown>): Promise<T> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new HttpError(500, "Supabase is not configured on the server.");
  const auth = req.headers.get("authorization") ?? "";
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: auth } },
  });
  const { data, error } = await client.rpc(fn, args);
  if (error) throw rpcErrorToHttp(error.message);
  return data as T;
}

/** Converts StudyError (from the pure service functions) to HttpError for `handle()`. */
export async function studyRoute<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof StudyError) throw new HttpError(err.status, err.message);
    throw err;
  }
}
