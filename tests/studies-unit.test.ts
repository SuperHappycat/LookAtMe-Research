/** Multi-site studies: aggregation, pseudonymisation, export filter and route logic (fake data access). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateBlock, aggregateStudy, mean, median, type SummarySessionRow } from "../lib/research/studies/aggregate.ts";
import {
  buildStudyExport,
  researchConsentedChildren,
  safeCell,
  studyPseudonym,
  STUDY_EXPORT_COLUMNS,
  type ConsentRow,
  type ExportSessionRow,
} from "../lib/research/studies/pseudonym.ts";
import {
  listStudies,
  studyDetail,
  studyExport,
  studySummary,
  StudyError,
  type SiteRowDb,
  type StudyData,
  type StudyRowDb,
} from "../lib/research/studies/service.ts";
import { looksLikeInviteCode, normalizeInviteCode } from "../lib/research/studies/codes.ts";
import type { MemberRole, PlanKey } from "../lib/research/plans.ts";

const SECRET = "x".repeat(40);
const STUDY = "aaaaaaaa-0000-4000-8000-000000000001";
const LEAD = "bbbbbbbb-0000-4000-8000-000000000001";
const SITE = "cccccccc-0000-4000-8000-000000000001";
const LEFT = "dddddddd-0000-4000-8000-000000000001";
const OUTSIDER = "eeeeeeee-0000-4000-8000-000000000001";

const row = (over: Partial<SummarySessionRow> = {}): SummarySessionRow => ({
  org_id: LEAD,
  status: "completed",
  blind: false,
  risk_level: "Low",
  overall_score: 50,
  level1_score: 60,
  level2_score: 40,
  level3_score: 70,
  quality_score: 80,
  ...over,
});

// ---------------------------------------------------------------- aggregation

test("mean and median", () => {
  assert.equal(mean([]), null);
  assert.equal(median([]), null);
  assert.equal(mean([1, 2, 4]), 2.33);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test("aggregateBlock: counts, risk from completed only, quality from all, numeric strings accepted", () => {
  const b = aggregateBlock(
    "X",
    [
      row({ overall_score: "10", risk_level: "High", quality_score: 50 }),
      row({ overall_score: 20, risk_level: "Moderate" }),
      row({ overall_score: 30, risk_level: null }),
      row({ status: "invalid", overall_score: 99, risk_level: "High", quality_score: 20 }),
      row({ status: "started", overall_score: null, risk_level: null, quality_score: null }),
    ],
    { minCellN: 3, hideBlindScores: false },
  );
  assert.equal(b.n, 5);
  assert.equal(b.completed, 3);
  assert.equal(b.invalid, 1);
  assert.equal(b.started, 1);
  assert.equal(b.suppressed, false);
  assert.deepEqual(b.risk, { Low: 0, Moderate: 1, High: 1, none: 1 });
  assert.deepEqual(b.overall, { n: 3, mean: 20, median: 20 });
  assert.deepEqual(b.level1, { n: 3, mean: 60, median: 60 });
  assert.deepEqual(b.quality, { n: 4, mean: 57.5, median: 65 });
});

test("aggregateBlock: small cells are suppressed; blind scores hidden for non-admins", () => {
  const small = aggregateBlock("X", [row(), row(), row({ status: "invalid" })], { minCellN: 3, hideBlindScores: false });
  assert.equal(small.suppressed, true);
  assert.equal(small.n, 3);
  assert.equal(small.overall, null);
  assert.equal(small.risk, null);

  const rows = [row(), row(), row(), row({ blind: true, overall_score: 100, risk_level: "High" })];
  const admin = aggregateBlock("X", rows, { minCellN: 3, hideBlindScores: false });
  const staff = aggregateBlock("X", rows, { minCellN: 3, hideBlindScores: true });
  assert.equal(admin.overall?.n, 4);
  assert.equal(admin.risk?.High, 1);
  assert.equal(staff.n, 4);
  assert.equal(staff.blinded, 1);
  assert.equal(staff.overall?.n, 3);
  assert.equal(staff.overall?.mean, 50);
  assert.equal(staff.risk?.High, 0);
});

test("aggregateStudy: per site + total, drops rows of orgs that are not listed", () => {
  const rows = [row(), row(), row(), row({ org_id: SITE, overall_score: 10 }), row({ org_id: SITE, overall_score: 20 }),
    row({ org_id: SITE, overall_score: 30 }), row({ org_id: OUTSIDER, overall_score: 1000 })];
  const s = aggregateStudy(rows, [{ orgId: LEAD, label: "Lead H" }, { orgId: SITE, label: "Site H" }], {
    minCellN: 3,
    hideBlindScores: false,
    includeTotal: true,
  });
  assert.deepEqual(s.sites.map((x) => [x.label, x.n, x.overall?.mean]), [["Lead H", 3, 50], ["Site H", 3, 20]]);
  assert.equal(s.total?.n, 6);
  assert.equal(s.total?.overall?.mean, 35);
  const siteOnly = aggregateStudy(rows, [{ orgId: SITE, label: "Site H" }], { minCellN: 1, hideBlindScores: false, includeTotal: false });
  assert.equal(siteOnly.total, null);
  assert.equal(siteOnly.sites.length, 1);
});

// ---------------------------------------------------------------- pseudonyms and export

test("studyPseudonym: stable per study, differs across studies and secrets, not the child id", () => {
  const a = studyPseudonym(SECRET, STUDY, "child-1");
  assert.match(a, /^P-[A-Z2-7]{10}$/);
  assert.equal(a, studyPseudonym(SECRET, STUDY, "child-1"));
  assert.notEqual(a, studyPseudonym(SECRET, STUDY, "child-2"));
  assert.notEqual(a, studyPseudonym(SECRET, "other-study", "child-1"));
  assert.notEqual(a, studyPseudonym("y".repeat(40), STUDY, "child-1"));
  assert.throws(() => studyPseudonym("short", STUDY, "child-1"), /at least 32/);
  // no collisions in a realistic study size
  const ids = new Set(Array.from({ length: 5000 }, (_, i) => studyPseudonym(SECRET, STUDY, `c${i}`)));
  assert.equal(ids.size, 5000);
});

test("researchConsentedChildren: latest non-withdrawn consent must allow research", () => {
  const c = (child: string, allow: boolean, signed: string, withdrawn: string | null = null, org = SITE): ConsentRow => ({
    org_id: org,
    child_id: child,
    allow_research: allow,
    signed_at: signed,
    withdrawn_at: withdrawn,
  });
  const ok = researchConsentedChildren([
    c("k1", true, "2026-01-01"),
    c("k2", true, "2026-01-01"),
    c("k2", false, "2026-03-01"), // newer consent says no
    c("k3", true, "2026-01-01", "2026-02-01"), // withdrawn
    c("k4", false, "2026-01-01"),
    c("k4", true, "2026-02-01"),
    c("k5", true, "2026-01-01", null, LEAD), // consent at another org doesn't count for SITE
  ]);
  assert.deepEqual([...ok].sort(), [`${LEAD}:k5`, `${SITE}:k1`, `${SITE}:k4`]);
});

test("buildStudyExport: only sharing sites + consented children; no codes, birth dates or session ids", () => {
  const s = (org: string, child: string, started: string, over: Partial<ExportSessionRow> = {}): ExportSessionRow => ({
    org_id: org,
    child_id: child,
    started_at: started,
    status: "completed",
    risk_level: "Low",
    overall_score: 42,
    level1_score: 1,
    level2_score: 2,
    level3_score: 3,
    quality_score: 90,
    face_found_pct: 95,
    child: { birth_month: "2023-05-01", sex: "F" },
    ...over,
  });
  const out = buildStudyExport({
    secret: SECRET,
    studyId: STUDY,
    sharingSites: [{ orgId: SITE, label: "=HYPERLINK(\"x\")" }],
    sessions: [
      s(SITE, "kid-1", "2026-06-15T12:00:00Z"),
      s(SITE, "kid-1", "2026-03-15T12:00:00Z"),
      s(SITE, "kid-2", "2026-06-15T12:00:00Z"), // no research consent
      s(LEAD, "kid-9", "2026-06-15T12:00:00Z"), // lead not sharing
    ],
    consents: [
      { org_id: SITE, child_id: "kid-1", allow_research: true, signed_at: "2026-01-01", withdrawn_at: null },
      { org_id: SITE, child_id: "kid-2", allow_research: false, signed_at: "2026-01-01", withdrawn_at: null },
      { org_id: LEAD, child_id: "kid-9", allow_research: true, signed_at: "2026-01-01", withdrawn_at: null },
    ],
  });
  assert.equal(out.rows, 2);
  assert.deepEqual([...out.perSite], [[SITE, 2]]);
  const lines = out.csv.replace(/^﻿/, "").trim().split("\n");
  assert.equal(lines[0], STUDY_EXPORT_COLUMNS.join(","));
  const pid = studyPseudonym(SECRET, STUDY, "kid-1");
  // oldest first, visit numbers per child; age in months at session start
  assert.ok(lines[1].startsWith(`${pid},1,"'=HYPERLINK(""x"")",34,F,completed,Low,42`), lines[1]);
  assert.ok(lines[2].startsWith(`${pid},2,`) && lines[2].includes(",37,F,"), lines[2]);
  for (const bad of ["kid-1", "kid-2", "kid-9", "2023-05", "2026-06-15", "2026-03-15"]) {
    assert.ok(!out.csv.includes(bad), `export must not contain ${bad}`);
  }
});

test("safeCell: quotes and neutralises spreadsheet formulas", () => {
  assert.equal(safeCell(null), "");
  assert.equal(safeCell(-3.5), "-3.5");
  assert.equal(safeCell("a,b"), '"a,b"');
  assert.equal(safeCell("=1+1"), "'=1+1");
  assert.equal(safeCell("@cmd"), "'@cmd");
  assert.equal(safeCell("-x"), "'-x");
});

test("invite code normalisation", () => {
  assert.equal(normalizeInviteCode(" abcd-efgh jkmn "), "ABCDEFGHJKMN");
  assert.ok(looksLikeInviteCode("2345-6789-ABCD"));
  assert.ok(!looksLikeInviteCode("0000-0000-0000")); // ambiguous characters are not in the alphabet
  assert.ok(!looksLikeInviteCode("2345-6789"));
});

// ---------------------------------------------------------------- route logic with fake data access

interface FakeWorld {
  members: Record<string, Record<string, MemberRole>>; // user -> org -> role
  plans: Record<string, PlanKey>;
  names: Record<string, string>;
  study: StudyRowDb;
  sites: SiteRowDb[];
  sessions: (SummarySessionRow & ExportSessionRow & { id: string; study_id: string; child_code: string })[];
  consents: ConsentRow[];
}

function fake(w: FakeWorld) {
  const calls: string[] = [];
  const audits: [string, string, string][] = [];
  const d: StudyData = {
    async memberRole(u, o) {
      return w.members[u]?.[o] ?? null;
    },
    async orgPlan(o) {
      return w.plans[o] ?? null;
    },
    async orgNames(ids) {
      calls.push(`orgNames:${[...ids].sort().join("|")}`);
      return new Map(ids.map((i) => [i, w.names[i]]));
    },
    async study(id) {
      return id === w.study.id ? w.study : null;
    },
    async studiesForOrg(o) {
      return w.study.lead_org_id === o || w.sites.some((s) => s.org_id === o && s.status !== "left") ? [w.study] : [];
    },
    async sites() {
      return w.sites;
    },
    async invites() {
      return [{ id: "i1", created_at: "2026-10-01", expires_at: "2026-10-15", used_at: "2026-10-02", used_by_org: SITE }];
    },
    async summarySessions(studyId, orgIds) {
      calls.push(`summarySessions:${[...orgIds].sort().join("|")}`);
      return w.sessions.filter((s) => s.study_id === studyId && orgIds.includes(s.org_id));
    },
    async exportSessions(studyId, orgIds) {
      calls.push(`exportSessions:${[...orgIds].sort().join("|")}`);
      return w.sessions.filter((s) => s.study_id === studyId && orgIds.includes(s.org_id));
    },
    async consents(orgIds) {
      return w.consents.filter((c) => orgIds.includes(c.org_id));
    },
    async audit(o, u, a, target) {
      audits.push([o, a, target]);
      void u;
    },
  };
  return { d, calls, audits };
}

function world(): FakeWorld {
  const sess = (id: string, org: string, child: string, score: number) => ({
    id,
    study_id: STUDY,
    org_id: org,
    child_id: child,
    child_code: `CODE-${child}`,
    started_at: "2026-09-01T00:00:00Z",
    status: "completed",
    blind: false,
    risk_level: "Low",
    overall_score: score,
    level1_score: 1,
    level2_score: 2,
    level3_score: 3,
    quality_score: 90,
    face_found_pct: 99,
    child: { birth_month: "2023-01-01", sex: "M" },
  });
  return {
    members: {
      leadAdmin: { [LEAD]: "admin" },
      leadStaff: { [LEAD]: "staff" },
      leadViewer: { [LEAD]: "viewer" },
      siteAdmin: { [SITE]: "admin" },
      siteStaff: { [SITE]: "staff" },
      leftAdmin: { [LEFT]: "admin" },
      outsider: { [OUTSIDER]: "admin" },
    },
    plans: { [LEAD]: "hospital", [SITE]: "hospital", [LEFT]: "hospital", [OUTSIDER]: "hospital" },
    names: { [LEAD]: "Lead Hospital", [SITE]: "Site Hospital", [LEFT]: "Left Hospital", [OUTSIDER]: "Outsider" },
    study: { id: STUDY, name: "Pilot ศึกษา", lead_org_id: LEAD, blind_default: false, created_at: "2026-10-01" },
    sites: [
      { study_id: STUDY, org_id: LEAD, status: "active", joined_at: "2026-10-01", share_row_data: false },
      { study_id: STUDY, org_id: SITE, status: "active", joined_at: "2026-10-02", share_row_data: true },
      { study_id: STUDY, org_id: LEFT, status: "left", joined_at: "2026-10-02", share_row_data: false },
    ],
    sessions: [
      sess("s1", LEAD, "L1", 10), sess("s2", LEAD, "L2", 20), sess("s3", LEAD, "L3", 30),
      sess("s4", SITE, "S1", 40), sess("s5", SITE, "S2", 50), sess("s6", SITE, "S3", 60),
      sess("s7", LEFT, "X1", 99),
    ],
    consents: [
      { org_id: SITE, child_id: "S1", allow_research: true, signed_at: "2026-01-01", withdrawn_at: null },
      { org_id: SITE, child_id: "S2", allow_research: false, signed_at: "2026-01-01", withdrawn_at: null },
      { org_id: LEAD, child_id: "L1", allow_research: true, signed_at: "2026-01-01", withdrawn_at: null },
    ],
  };
}

const rejects = (p: Promise<unknown>, status: number) =>
  assert.rejects(p, (e: unknown) => e instanceof StudyError && e.status === status);

test("summary: lead admin/staff get every ACTIVE site + total, aggregates only, audited", async () => {
  const { d, audits } = fake(world());
  const s = await studySummary(d, "leadStaff", STUDY, LEAD);
  assert.equal(s.role, "lead");
  assert.deepEqual(s.sites.map((x) => [x.label, x.n, x.overall?.mean]), [["Lead Hospital", 3, 20], ["Site Hospital", 3, 50]]);
  assert.equal(s.total?.n, 6); // the site that left is not included
  const text = JSON.stringify(s);
  for (const bad of ["CODE-", "2023-01", "\"s1\"", "\"s4\"", "S1", "L1", "Left Hospital", "child"]) {
    assert.ok(!text.includes(bad), `summary must not contain ${bad}`);
  }
  assert.deepEqual(audits, [[LEAD, "view_study_summary", `study:${STUDY}`]]);
});

test("summary: a site sees only its own block; others are refused before any data is read", async () => {
  const { d, calls } = fake(world());
  const s = await studySummary(d, "siteStaff", STUDY, SITE);
  assert.equal(s.role, "site");
  assert.equal(s.total, null);
  assert.deepEqual(s.sites.map((x) => x.label), ["Site Hospital"]);
  assert.deepEqual(calls.filter((c) => c.startsWith("summarySessions")), [`summarySessions:${SITE}`]);

  for (const [user, org, status] of [
    ["leadViewer", LEAD, 403], // viewers can't
    ["outsider", OUTSIDER, 404], // not in the study: looks like "not found"
    ["leftAdmin", LEFT, 404], // left the study
    ["outsider", LEAD, 403], // not a member of the org it claims
    ["siteAdmin", "not-a-uuid", 400],
  ] as const) {
    const f = fake(world());
    await rejects(studySummary(f.d, user, STUDY, org), status);
    assert.equal(f.calls.filter((c) => c.startsWith("summarySessions")).length, 0, `${user} read no sessions`);
    assert.equal(f.audits.length, 0);
  }
  await rejects(studySummary(fake(world()).d, "leadAdmin", "aaaaaaaa-0000-4000-8000-000000000999", LEAD), 404);
});

test("summary: the lead loses access if its plan no longer has multi_site", async () => {
  const w = world();
  w.plans[LEAD] = "school";
  await rejects(studySummary(fake(w).d, "leadAdmin", STUDY, LEAD), 403);
});

test("export: lead ADMIN only; sharing sites and consented children only; audited for lead and site", async () => {
  for (const [user, org, status] of [
    ["leadStaff", LEAD, 403],
    ["siteAdmin", SITE, 403],
    ["outsider", OUTSIDER, 404],
  ] as const) {
    const f = fake(world());
    await rejects(studyExport(f.d, user, STUDY, org, SECRET), status);
    assert.equal(f.calls.filter((c) => c.startsWith("exportSessions")).length, 0);
  }
  await rejects(studyExport(fake(world()).d, "leadAdmin", STUDY, LEAD, undefined), 500);

  const { d, calls, audits } = fake(world());
  const out = await studyExport(d, "leadAdmin", STUDY, LEAD, SECRET);
  assert.deepEqual(calls.filter((c) => c.startsWith("exportSessions")), [`exportSessions:${SITE}`]); // lead not sharing
  assert.equal(out.rows, 1); // S1 only (S2 said no, S3 has no consent)
  assert.ok(out.csv.includes(studyPseudonym(SECRET, STUDY, "S1")));
  assert.ok(!out.csv.includes("CODE-") && !out.csv.includes("S1,") && !out.csv.includes("2023-01"));
  assert.match(out.filename, /^study_[A-Za-z0-9_-]+_\d{4}-\d{2}-\d{2}\.csv$/);
  assert.deepEqual(audits, [
    [LEAD, "export_study_csv", `study:${STUDY} rows:1`],
    [SITE, "export_study_csv", `study:${STUDY} rows:1 by_lead`],
  ]);
});

test("detail and list: a site sees only the lead and itself; invites (no codes) for lead admins", async () => {
  const { d } = fake(world());
  const lead = await studyDetail(d, "leadAdmin", STUDY, LEAD);
  assert.equal(lead.role, "lead");
  assert.equal(lead.sites.length, 3);
  assert.deepEqual(lead.invites, [{ id: "i1", createdAt: "2026-10-01", expiresAt: "2026-10-15", usedAt: "2026-10-02", usedBy: "Site Hospital" }]);
  assert.equal((await studyDetail(d, "leadStaff", STUDY, LEAD)).invites, null);

  const site = await studyDetail(d, "siteStaff", STUDY, SITE);
  assert.equal(site.role, "site");
  assert.deepEqual(site.sites.map((s) => s.name).sort(), ["Lead Hospital", "Site Hospital"]);
  assert.equal(site.myShareRowData, true);
  assert.equal(site.invites, null);
  await rejects(studyDetail(d, "outsider", STUDY, OUTSIDER), 404);
  await rejects(studyDetail(d, "leftAdmin", STUDY, LEFT), 404);

  assert.deepEqual((await listStudies(d, "siteStaff", SITE)).map((s) => [s.role, s.leadName]), [["site", "Lead Hospital"]]);
  assert.deepEqual((await listStudies(d, "leadViewer", LEAD)).map((s) => s.role), ["lead"]);
  assert.deepEqual(await listStudies(d, "outsider", OUTSIDER), []);
  await rejects(listStudies(d, "outsider", SITE), 403);
});
