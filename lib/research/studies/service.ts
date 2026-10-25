/**
 * lib/research/studies/service.ts
 * =================================
 * Route-handler logic for studies, with data access injected (`StudyData`), so the access rules can be
 * unit-tested without Supabase. lib/research/studies/server.ts supplies the service-role implementation;
 * every function here checks the caller BEFORE it asks for any other org's data.
 *
 * Access rules (platform admins get no bypass here: study data belongs to the sites):
 * - list / detail: any member of the acting org, if that org is the lead or a non-left site.
 * - summary: admin or staff of the acting org. Lead → every active site + total. Site → its own block only.
 * - export: admin of the LEAD org only; only sharing sites, only research-consented children.
 */

import { planHas, type MemberRole, type PlanKey } from "../plans";
import { aggregateStudy, type StudySummary, type SummarySessionRow } from "./aggregate";
import { buildStudyExport, type ConsentRow, type ExportSessionRow } from "./pseudonym";
import { STUDIES_CONFIG } from "./config";
import type { StudyRole } from "../contracts";

export class StudyError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface StudyRowDb {
  id: string;
  name: string;
  lead_org_id: string;
  blind_default: boolean;
  created_at: string;
}

export interface SiteRowDb {
  study_id: string;
  org_id: string;
  status: "invited" | "active" | "left";
  joined_at: string | null;
  share_row_data: boolean;
}

export interface InviteRowDb {
  id: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  used_by_org: string | null;
}

export interface StudyData {
  memberRole(userId: string, orgId: string): Promise<MemberRole | null>;
  orgPlan(orgId: string): Promise<PlanKey | null>;
  orgNames(orgIds: string[]): Promise<Map<string, string>>;
  study(studyId: string): Promise<StudyRowDb | null>;
  /** Studies where the org is lead or has a site row that is not 'left'. */
  studiesForOrg(orgId: string): Promise<StudyRowDb[]>;
  sites(studyId: string): Promise<SiteRowDb[]>;
  invites(studyId: string): Promise<InviteRowDb[]>;
  /** Sessions with study_id = studyId and org_id in orgIds. Aggregate fields only. */
  summarySessions(studyId: string, orgIds: string[]): Promise<SummarySessionRow[]>;
  exportSessions(studyId: string, orgIds: string[]): Promise<ExportSessionRow[]>;
  consents(orgIds: string[], childIds: string[]): Promise<ConsentRow[]>;
  audit(orgId: string, userId: string, action: string, target: string): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuid(v: unknown, what: string): string {
  if (typeof v !== "string" || !UUID.test(v)) throw new StudyError(400, `Bad ${what} id.`);
  return v;
}

const NOT_FOUND = "ไม่พบโครงการวิจัย / Study not found.";
const NO_PERMISSION = "ไม่มีสิทธิ์ทำรายการนี้ / You don't have permission for this.";
const NOT_IN_PLAN = "แผนนี้ไม่มีโครงการหลายสถานที่ / Multi-site studies need the Hospital plan.";

async function requireRole(d: StudyData, userId: string, orgId: string, roles: MemberRole[]): Promise<MemberRole> {
  const role = await d.memberRole(userId, orgId);
  if (!role || !roles.includes(role)) throw new StudyError(403, NO_PERMISSION);
  return role;
}

export async function requireMultiSite(d: StudyData, orgId: string): Promise<void> {
  const plan = await d.orgPlan(orgId);
  if (!plan || !planHas(plan, "multi_site")) throw new StudyError(403, NOT_IN_PLAN);
}

/** Loads the study and works out the acting org's place in it. Unknown and not-visible look the same (404). */
async function studyFor(d: StudyData, studyId: string, orgId: string) {
  const study = await d.study(studyId);
  if (!study) throw new StudyError(404, NOT_FOUND);
  const sites = await d.sites(studyId);
  const mine = sites.find((s) => s.org_id === orgId);
  const role: StudyRole | null =
    study.lead_org_id === orgId ? "lead" : mine && mine.status !== "left" ? "site" : null;
  if (!role) throw new StudyError(404, NOT_FOUND);
  return { study, sites, mine, role };
}

// ---------------------------------------------------------------- list

export interface StudyListItem {
  id: string;
  name: string;
  role: StudyRole;
  leadName: string;
  status: SiteRowDb["status"] | "lead";
  createdAt: string;
}

export async function listStudies(d: StudyData, userId: string, orgIdRaw: unknown): Promise<StudyListItem[]> {
  const orgId = requireUuid(orgIdRaw, "organization");
  await requireRole(d, userId, orgId, ["admin", "staff", "viewer"]);
  const studies = await d.studiesForOrg(orgId);
  const names = await d.orgNames([...new Set(studies.map((s) => s.lead_org_id))]);
  const out: StudyListItem[] = [];
  for (const s of studies) {
    const isLead = s.lead_org_id === orgId;
    let status: StudyListItem["status"] = "lead";
    if (!isLead) {
      const site = (await d.sites(s.id)).find((x) => x.org_id === orgId);
      if (!site || site.status === "left") continue;
      status = site.status;
    }
    out.push({
      id: s.id,
      name: s.name,
      role: isLead ? "lead" : "site",
      leadName: names.get(s.lead_org_id) ?? "",
      status,
      createdAt: s.created_at,
    });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---------------------------------------------------------------- detail

export interface StudyDetail {
  id: string;
  name: string;
  role: StudyRole;
  blindDefault: boolean;
  leadOrgId: string;
  leadName: string;
  /** Lead: every site. Site: the lead and itself only. */
  sites: { orgId: string; name: string; status: SiteRowDb["status"]; joinedAt: string | null; shareRowData: boolean }[];
  myShareRowData: boolean;
  /** Lead admins only. Codes are never returned (only their hash is stored). */
  invites: { id: string; createdAt: string; expiresAt: string; usedAt: string | null; usedBy: string | null }[] | null;
}

export async function studyDetail(d: StudyData, userId: string, studyIdRaw: unknown, orgIdRaw: unknown): Promise<StudyDetail> {
  const studyId = requireUuid(studyIdRaw, "study");
  const orgId = requireUuid(orgIdRaw, "organization");
  const myRole = await requireRole(d, userId, orgId, ["admin", "staff", "viewer"]);
  const { study, sites, mine, role } = await studyFor(d, studyId, orgId);
  const visible = role === "lead" ? sites : sites.filter((s) => s.org_id === orgId || s.org_id === study.lead_org_id);
  const invites = role === "lead" && myRole === "admin" ? await d.invites(studyId) : null;
  const names = await d.orgNames([
    ...new Set([study.lead_org_id, ...visible.map((s) => s.org_id), ...(invites ?? []).flatMap((i) => (i.used_by_org ? [i.used_by_org] : []))]),
  ]);
  return {
    id: study.id,
    name: study.name,
    role,
    blindDefault: study.blind_default,
    leadOrgId: study.lead_org_id,
    leadName: names.get(study.lead_org_id) ?? "",
    sites: visible.map((s) => ({
      orgId: s.org_id,
      name: names.get(s.org_id) ?? "",
      status: s.status,
      joinedAt: s.joined_at,
      shareRowData: s.share_row_data,
    })),
    myShareRowData: !!mine?.share_row_data,
    invites:
      invites?.map((i) => ({
        id: i.id,
        createdAt: i.created_at,
        expiresAt: i.expires_at,
        usedAt: i.used_at,
        usedBy: i.used_by_org ? (names.get(i.used_by_org) ?? "") : null,
      })) ?? null,
  };
}

// ---------------------------------------------------------------- summary

export interface StudySummaryResponse extends StudySummary {
  role: StudyRole;
  minCellN: number;
  hideBlindScores: boolean;
}

export async function studySummary(
  d: StudyData,
  userId: string,
  studyIdRaw: unknown,
  orgIdRaw: unknown,
): Promise<StudySummaryResponse> {
  const studyId = requireUuid(studyIdRaw, "study");
  const orgId = requireUuid(orgIdRaw, "organization");
  const myRole = await requireRole(d, userId, orgId, ["admin", "staff"]);
  const { sites, mine, role } = await studyFor(d, studyId, orgId);

  let siteIds: string[];
  if (role === "lead") {
    await requireMultiSite(d, orgId);
    siteIds = sites.filter((s) => s.status === "active").map((s) => s.org_id);
  } else {
    if (mine?.status !== "active") throw new StudyError(403, NO_PERMISSION);
    siteIds = [orgId];
  }
  // Only after the checks above: read other sites' rows (aggregate fields only).
  const [rows, names] = await Promise.all([d.summarySessions(studyId, siteIds), d.orgNames(siteIds)]);
  const hideBlindScores = myRole !== "admin";
  const summary = aggregateStudy(
    rows,
    siteIds.map((id) => ({ orgId: id, label: names.get(id) ?? "" })),
    { minCellN: STUDIES_CONFIG.minCellN, hideBlindScores, includeTotal: role === "lead" },
  );
  await d.audit(orgId, userId, "view_study_summary", `study:${studyId}`);
  return { ...summary, role, minCellN: STUDIES_CONFIG.minCellN, hideBlindScores };
}

// ---------------------------------------------------------------- export

export async function studyExport(
  d: StudyData,
  userId: string,
  studyIdRaw: unknown,
  orgIdRaw: unknown,
  secret: string | undefined,
): Promise<{ csv: string; rows: number; filename: string }> {
  const studyId = requireUuid(studyIdRaw, "study");
  const orgId = requireUuid(orgIdRaw, "organization");
  await requireRole(d, userId, orgId, ["admin"]);
  const { study, sites, role } = await studyFor(d, studyId, orgId);
  if (role !== "lead") throw new StudyError(403, NO_PERMISSION);
  await requireMultiSite(d, orgId);
  if (!secret || secret.length < 32) {
    throw new StudyError(500, "STUDY_PSEUDONYM_SECRET is not configured on the server.");
  }

  const sharing = sites.filter((s) => s.status === "active" && s.share_row_data).map((s) => s.org_id);
  const names = await d.orgNames(sharing);
  const sessions = sharing.length ? await d.exportSessions(studyId, sharing) : [];
  const consents = sessions.length
    ? await d.consents(sharing, [...new Set(sessions.map((s) => s.child_id))])
    : [];
  const result = buildStudyExport({
    secret,
    studyId,
    sharingSites: sharing.map((id) => ({ orgId: id, label: names.get(id) ?? "" })),
    sessions,
    consents,
  });
  await d.audit(orgId, userId, "export_study_csv", `study:${studyId} rows:${result.rows}`);
  // Each site sees in its own audit log that its coded rows left for the lead.
  for (const [siteOrg, n] of result.perSite) {
    if (siteOrg !== orgId) await d.audit(siteOrg, userId, "export_study_csv", `study:${studyId} rows:${n} by_lead`);
  }
  const safeName = study.name.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 60) || "study";
  return { csv: result.csv, rows: result.rows, filename: `study_${safeName}_${new Date().toISOString().slice(0, 10)}.csv` };
}
