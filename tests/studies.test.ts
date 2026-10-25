/**
 * Multi-site studies: RLS and RPC tests on the real migrations (PGlite). Run with: npm test
 *
 * Orgs: A = school (no multi_site), B = hospital (lead), C = hospital (joins), D = hospital (never joins),
 * E = hospital with an expired plan.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createTestDb, expectError, ID, type TestDb } from "./fixtures/db.ts";
import { PLANS, planHas, type PlanKey } from "../lib/research/plans.ts";
import { looksLikeInviteCode, normalizeInviteCode } from "../lib/research/studies/codes.ts";

let t: TestDb;
const X = {
  orgC: "00000000-0000-0000-0000-00000000000c",
  orgD: "00000000-0000-0000-0000-00000000000d",
  orgE: "00000000-0000-0000-0000-00000000000e",
  adminC: "10000000-0000-0000-0000-00000000000c",
  staffC: "20000000-0000-0000-0000-00000000000c",
  viewerC: "30000000-0000-0000-0000-00000000000c",
  adminD: "10000000-0000-0000-0000-00000000000d",
  adminE: "10000000-0000-0000-0000-00000000000e",
  staffB: "20000000-0000-0000-0000-00000000000b",
  childC: "c0000000-0000-0000-0000-00000000000c",
  childD: "c0000000-0000-0000-0000-00000000000d",
  sessB: "5e000000-0000-0000-0000-00000000000b",
  sessC1: "5e000000-0000-0000-0000-0000000000c1",
  sessC2: "5e000000-0000-0000-0000-0000000000c2",
  sessCBlind: "5e000000-0000-0000-0000-0000000000cb",
  sessD: "5e000000-0000-0000-0000-00000000000d",
};

const one = async <T = unknown>(user: string, sql: string, params: unknown[] = []): Promise<T> => {
  const rows = await t.as(user, () => t.rows(sql, params));
  return Object.values(rows[0] ?? {})[0] as T;
};
const count = async (user: string, sql: string, params: unknown[] = []) =>
  (await t.as(user, () => t.rows(sql, params))).length;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

let study = "";

before(async () => {
  t = await createTestDb();
  await t.seed();
  await t.db.exec(`
    insert into auth.users (id, email) values
      ('${X.adminC}', 'a@c'), ('${X.staffC}', 's@c'), ('${X.viewerC}', 'v@c'), ('${X.adminD}', 'a@d'),
      ('${X.adminE}', 'a@e'), ('${X.staffB}', 's@b');
    insert into public.organizations (id, name, type, plan, screening_quota, seats, expires_on) values
      ('${X.orgC}', 'Hospital C', 'hospital', 'hospital', null, 15, current_date + 365),
      ('${X.orgD}', 'Hospital D', 'hospital', 'hospital', null, 15, current_date + 365),
      ('${X.orgE}', 'Hospital E', 'hospital', 'hospital', null, 15, current_date - 1);
    insert into public.members (user_id, org_id, role) values
      ('${X.adminC}', '${X.orgC}', 'admin'), ('${X.staffC}', '${X.orgC}', 'staff'), ('${X.viewerC}', '${X.orgC}', 'viewer'),
      ('${X.adminD}', '${X.orgD}', 'admin'), ('${X.adminE}', '${X.orgE}', 'admin'), ('${X.staffB}', '${ID.orgB}', 'staff');
    insert into public.children (id, org_id, code) values
      ('${X.childC}', '${X.orgC}', 'C-001'), ('${X.childD}', '${X.orgD}', 'D-001');
    insert into public.sessions (id, client_session_id, org_id, child_id, status, overall_score, risk_level) values
      ('${X.sessB}', gen_random_uuid(), '${ID.orgB}', '${ID.childB}', 'completed', 50, 'Low'),
      ('${X.sessC1}', gen_random_uuid(), '${X.orgC}', '${X.childC}', 'completed', 40, 'Moderate'),
      ('${X.sessC2}', gen_random_uuid(), '${X.orgC}', '${X.childC}', 'invalid', null, null),
      ('${X.sessD}', gen_random_uuid(), '${X.orgD}', '${X.childD}', 'completed', 60, 'Low');
    insert into public.sessions (id, client_session_id, org_id, child_id, status, blind) values
      ('${X.sessCBlind}', gen_random_uuid(), '${X.orgC}', '${X.childC}', 'completed', true);
  `);
});

test("plans.ts and org_has_multi_site() agree: multi_site is hospital-only", async () => {
  const withFeature = (Object.keys(PLANS) as PlanKey[]).filter((p) => planHas(p, "multi_site"));
  assert.deepEqual(withFeature, ["hospital"]);
  const has = async (org: string) => (await t.rows("select public.org_has_multi_site($1) as v", [org]))[0].v;
  assert.equal(await has(ID.orgB), true);
  assert.equal(await has(ID.orgA), false);
  assert.equal(await has(X.orgE), false); // expired
  // internal helper: not callable by users
  await expectError(t.as(ID.adminB, () => t.rows("select public.org_has_multi_site($1)", [ID.orgB])), /permission denied/);
});

test("create_study: hospital admins only; lead becomes an active site", async () => {
  await expectError(t.as(ID.adminA, () => t.rows("select public.create_study($1, 'S')", [ID.orgA])), /feature_not_in_plan/);
  await expectError(t.as(X.adminE, () => t.rows("select public.create_study($1, 'S')", [X.orgE])), /feature_not_in_plan/);
  await expectError(t.as(X.staffB, () => t.rows("select public.create_study($1, 'S')", [ID.orgB])), /not_allowed/);
  await expectError(t.as(X.adminC, () => t.rows("select public.create_study($1, 'S')", [ID.orgB])), /not_allowed/);
  await expectError(t.as(ID.adminB, () => t.rows("select public.create_study($1, '   ')", [ID.orgB])), /bad_name/);

  study = await one<string>(ID.adminB, "select public.create_study($1, ' Multi-site pilot ')", [ID.orgB]);
  const rows = await t.as(X.staffB, () => t.rows("select name from public.studies"));
  assert.deepEqual(rows, [{ name: "Multi-site pilot" }]);
  const sites = await t.as(ID.adminB, () => t.rows("select org_id, status from public.study_sites where study_id = $1", [study]));
  assert.deepEqual(sites, [{ org_id: ID.orgB, status: "active" }]);
});

test("a non-site org can't see the study, its sites or any invite", async () => {
  for (const u of [X.adminC, X.adminD, ID.adminA, ID.stranger]) {
    assert.equal(await count(u, "select * from public.studies"), 0);
    assert.equal(await count(u, "select * from public.study_sites"), 0);
  }
  await expectError(
    t.as(X.adminC, () => t.rows("insert into public.study_sites (study_id, org_id, status) values ($1, $2, 'active')", [study, X.orgC])),
    /row-level security/,
  );
});

test("invite codes: lead admin only, random, stored as SHA-256 hash only, invisible to users", async () => {
  await expectError(t.as(X.staffB, () => t.rows("select public.create_study_invite($1)", [study])), /not_allowed/);
  await expectError(t.as(X.adminC, () => t.rows("select public.create_study_invite($1)", [study])), /not_allowed/);

  const code = await one<string>(ID.adminB, "select public.create_study_invite($1, 14)", [study]);
  assert.match(code, /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
  assert.ok(looksLikeInviteCode(code));
  const code2 = await one<string>(ID.adminB, "select public.create_study_invite($1)", [study]);
  assert.notEqual(code, code2);

  const stored = await t.rows("select * from public.study_invites where study_id = $1 order by created_at", [study]);
  assert.equal(stored.length, 2);
  const hashes = stored.map((r) => r.code_hash);
  assert.ok(hashes.includes(sha(normalizeInviteCode(code))));
  for (const r of stored) {
    assert.ok(!JSON.stringify(r).includes(normalizeInviteCode(code)), "plain code must not be stored");
    const days = (new Date(r.expires_at as string).getTime() - Date.now()) / 86_400_000;
    assert.ok(days > 13.9 && days <= 14.01, `expires in ~14 days, got ${days}`);
  }
  // No user, not even the lead admin, can read invites or join attempts directly.
  assert.equal(await count(ID.adminB, "select * from public.study_invites"), 0);
  assert.equal(await count(ID.adminB, "select * from public.study_join_attempts"), 0);
  // Expiry is clamped to 1..30 days.
  await t.as(ID.adminB, () => t.rows("select public.create_study_invite($1, 365)", [study]));
  const max = await t.rows("select max(expires_at) - now() < interval '30 days 1 minute' as ok from public.study_invites");
  assert.equal(max[0].ok, true);
});

test("redeeming: single-use, case/separator-insensitive, same answer for unknown/used/expired", async () => {
  const code = await one<string>(ID.adminB, "select public.create_study_invite($1)", [study]);
  const typed = normalizeInviteCode(code).toLowerCase().replace(/(.{4})/g, "$1 ");

  await expectError(t.as(X.staffC, () => t.rows("select public.redeem_study_invite($1, $2)", [code, X.orgC])), /not_allowed/);
  await expectError(t.as(ID.adminA, () => t.rows("select public.redeem_study_invite($1, $2)", [code, ID.orgA])), /feature_not_in_plan/);
  // admin of D can't redeem on behalf of C
  await expectError(t.as(X.adminD, () => t.rows("select public.redeem_study_invite($1, $2)", [code, X.orgC])), /not_allowed/);

  assert.equal(await one(X.adminC, "select public.redeem_study_invite($1, $2)", [typed, X.orgC]), study);
  assert.equal(await count(X.staffC, "select * from public.studies"), 1);
  // retry by the same org: same answer
  assert.equal(await one(X.adminC, "select public.redeem_study_invite($1, $2)", [code, X.orgC]), study);
  // another org: the code is used up
  assert.equal(await one(X.adminD, "select public.redeem_study_invite($1, $2)", [code, X.orgD]), null);
  assert.equal(await count(X.adminD, "select * from public.studies"), 0);
  // unknown code
  assert.equal(await one(X.adminD, "select public.redeem_study_invite('ABCD-EFGH-JKMN', $1)", [X.orgD]), null);
  // expired code
  const old = await one<string>(ID.adminB, "select public.create_study_invite($1)", [study]);
  await t.db.exec(`update public.study_invites set expires_at = now() - interval '1 second' where code_hash = '${sha(normalizeInviteCode(old))}'`);
  assert.equal(await one(X.adminD, "select public.redeem_study_invite($1, $2)", [old, X.orgD]), null);
  // revoked code
  const rev = await one<string>(ID.adminB, "select public.create_study_invite($1)", [study]);
  const revId = (await t.rows("select id from public.study_invites where code_hash = $1", [sha(normalizeInviteCode(rev))]))[0].id;
  await expectError(t.as(X.adminC, () => t.rows("select public.revoke_study_invite($1)", [revId])), /not_allowed/);
  await t.as(ID.adminB, () => t.rows("select public.revoke_study_invite($1)", [revId]));
  assert.equal(await one(X.adminD, "select public.redeem_study_invite($1, $2)", [rev, X.orgD]), null);

  // The lead redeeming its own code doesn't use it up.
  const own = await one<string>(ID.adminB, "select public.create_study_invite($1)", [study]);
  assert.equal(await one(ID.adminB, "select public.redeem_study_invite($1, $2)", [own, ID.orgB]), study);
  const ownRow = await t.rows("select used_at from public.study_invites where code_hash = $1", [sha(normalizeInviteCode(own))]);
  assert.equal(ownRow[0].used_at, null);

  const sites = await t.rows("select org_id, status, share_row_data from public.study_sites where study_id = $1 order by org_id", [study]);
  assert.deepEqual(sites, [
    { org_id: ID.orgB, status: "active", share_row_data: false },
    { org_id: X.orgC, status: "active", share_row_data: false },
  ]);
});

test("redeeming: failures are recorded and rate-limited per org", async () => {
  await t.db.exec(`delete from public.study_join_attempts`);
  for (let i = 0; i < 10; i++) {
    assert.equal(await one(X.adminD, "select public.redeem_study_invite($1, $2)", [`WRONG${i}`, X.orgD]), null);
  }
  const good = await one<string>(ID.adminB, "select public.create_study_invite($1)", [study]);
  await expectError(t.as(X.adminD, () => t.rows("select public.redeem_study_invite($1, $2)", [good, X.orgD])), /too_many_attempts/);
  // the code was not used up by the blocked attempt, and other orgs are not blocked
  const row = await t.rows("select used_at from public.study_invites where code_hash = $1", [sha(normalizeInviteCode(good))]);
  assert.equal(row[0].used_at, null);
  assert.equal((await t.rows("select count(*)::int as n from public.study_join_attempts where org_id = $1", [X.orgD]))[0].n, 10);
  await t.db.exec(`update public.study_join_attempts set at = now() - interval '2 hours'`);
  await t.as(ID.adminB, () => t.rows("select public.revoke_study_invite(id) from public.study_invites where used_at is null"));
});

test("a site can't see other sites' sessions; users can't set study_id directly", async () => {
  await t.as(X.staffC, () => t.rows("select public.set_session_study($1, $2)", [X.sessC1, study]));
  await t.as(X.staffC, () => t.rows("select public.set_sessions_study(array[$1::uuid], $2)", [X.sessC2, study]));
  // lead staff/admin see only their own org's sessions, even tagged ones
  assert.equal(await count(ID.adminB, "select * from public.sessions where study_id = $1", [study]), 0);
  assert.equal(await count(ID.adminB, "select * from public.sessions where org_id = $1", [X.orgC]), 0);
  assert.equal(await count(ID.adminB, "select * from public.children where org_id = $1", [X.orgC]), 0);
  assert.equal(await count(ID.adminB, "select * from public.organizations where id = $1", [X.orgC]), 0);
  assert.equal(await count(X.staffC, "select * from public.sessions where study_id = $1", [study]), 2);
  // no update policy on sessions: a direct write changes nothing
  await t.as(X.adminD, () => t.rows("update public.sessions set study_id = $1 where id = $2", [study, X.sessD]));
  await t.as(X.adminC, () => t.rows("update public.sessions set study_id = null where id = $1", [X.sessC1]));
  const r = await t.rows("select id, study_id from public.sessions where id in ($1, $2) order by id", [X.sessC1, X.sessD]);
  assert.deepEqual(Object.fromEntries(r.map((x) => [x.id, x.study_id])), { [X.sessC1]: study, [X.sessD]: null });
});

test("set_session_study refuses foreign sessions, non-site studies, viewers and blind sessions for staff", async () => {
  // foreign session (B's) by C's staff
  await expectError(t.as(X.staffC, () => t.rows("select public.set_session_study($1, $2)", [X.sessB, study])), /not_allowed/);
  // D is not a site: can't tag its own session to the study
  await expectError(t.as(X.adminD, () => t.rows("select public.set_session_study($1, $2)", [X.sessD, study])), /not_a_site/);
  // unknown session / study
  await expectError(t.as(X.staffC, () => t.rows("select public.set_session_study(gen_random_uuid(), $1)", [study])), /not_allowed/);
  await expectError(t.as(X.staffC, () => t.rows("select public.set_session_study($1, gen_random_uuid())", [X.sessC1])), /not_a_site/);
  // viewers can't tag
  await expectError(t.as(X.viewerC, () => t.rows("select public.set_session_study($1, null)", [X.sessC1])), /not_allowed/);
  // blind session: staff no, admin yes
  await expectError(t.as(X.staffC, () => t.rows("select public.set_session_study($1, $2)", [X.sessCBlind, study])), /not_allowed/);
  await t.as(X.adminC, () => t.rows("select public.set_session_study($1, $2)", [X.sessCBlind, study]));
  // lead can tag its own session
  await t.as(X.staffB, () => t.rows("select public.set_session_study($1, $2)", [X.sessB, study]));
  // bulk is all-or-nothing: one foreign id rolls back the lot
  await expectError(
    t.as(X.staffC, () => t.rows("select public.set_sessions_study(array[$1::uuid, $2::uuid], null)", [X.sessC1, X.sessB])),
    /not_allowed/,
  );
  assert.equal((await t.rows("select study_id from public.sessions where id = $1", [X.sessC1]))[0].study_id, study);
  // removing a tag
  assert.equal(await one(X.staffC, "select public.set_sessions_study(array[$1::uuid], null)", [X.sessC2]), 1);
  assert.equal((await t.rows("select study_id from public.sessions where id = $1", [X.sessC2]))[0].study_id, null);
});

test("share_row_data: only the site's own admin can switch it", async () => {
  await expectError(t.as(ID.adminB, () => t.rows("select public.set_study_share_row_data($1, $2, true)", [study, X.orgC])), /not_allowed/);
  await expectError(t.as(X.staffC, () => t.rows("select public.set_study_share_row_data($1, $2, true)", [study, X.orgC])), /not_allowed/);
  await expectError(t.as(X.adminD, () => t.rows("select public.set_study_share_row_data($1, $2, true)", [study, X.orgD])), /not_a_site/);
  await t.as(X.adminC, () => t.rows("select public.set_study_share_row_data($1, $2, true)", [study, X.orgC]));
  assert.equal((await t.rows("select share_row_data from public.study_sites where org_id = $1", [X.orgC]))[0].share_row_data, true);
  // no update policy on study_sites: a direct write changes nothing
  await t.as(X.adminC, () => t.rows("update public.study_sites set share_row_data = false, status = 'active' where study_id = $1", [study]));
  assert.equal((await t.rows("select share_row_data from public.study_sites where org_id = $1", [X.orgC]))[0].share_row_data, true);
});

test("leave / remove: lead can't leave; leaving hides the study and stops sharing and tagging", async () => {
  await expectError(t.as(ID.adminB, () => t.rows("select public.leave_study($1, $2)", [study, ID.orgB])), /lead_cannot_leave/);
  await expectError(t.as(X.staffC, () => t.rows("select public.leave_study($1, $2)", [study, X.orgC])), /not_allowed/);
  await expectError(t.as(X.adminC, () => t.rows("select public.remove_study_site($1, $2)", [study, X.orgC])), /not_allowed/);
  await expectError(t.as(ID.adminB, () => t.rows("select public.remove_study_site($1, $2)", [study, ID.orgB])), /lead_cannot_leave/);

  await t.as(X.adminC, () => t.rows("select public.leave_study($1, $2)", [study, X.orgC]));
  const s = await t.rows("select status, share_row_data from public.study_sites where org_id = $1", [X.orgC]);
  assert.deepEqual(s, [{ status: "left", share_row_data: false }]);
  assert.equal(await count(X.staffC, "select * from public.studies"), 0);
  await expectError(t.as(X.staffC, () => t.rows("select public.set_session_study($1, $2)", [X.sessC2, study])), /not_a_site/);
  // untagging is still allowed after leaving
  await t.as(X.staffC, () => t.rows("select public.set_session_study($1, null)", [X.sessC1]));
  await expectError(t.as(X.adminC, () => t.rows("select public.leave_study($1, $2)", [study, X.orgC])), /not_a_site/);

  // re-join with a new code; then the lead removes the site
  const code = await one<string>(ID.adminB, "select public.create_study_invite($1)", [study]);
  assert.equal(await one(X.adminC, "select public.redeem_study_invite($1, $2)", [code, X.orgC]), study);
  assert.equal(await count(X.staffC, "select * from public.studies"), 1);
  await t.as(ID.adminB, () => t.rows("select public.remove_study_site($1, $2)", [study, X.orgC]));
  assert.equal(await count(X.staffC, "select * from public.studies"), 0);
});

test("study RPCs are not callable by anon", async () => {
  await t.db.exec(`set role anon`);
  try {
    await expectError(t.rows("select public.redeem_study_invite('x', $1)", [X.orgC]), /permission denied/);
    await expectError(t.rows("select public.create_study_invite($1)", [study]), /permission denied/);
  } finally {
    await t.db.exec(`reset role`);
  }
});

test("study_sites: a site sees only its own row; the lead sees every site", async () => {
  const all = await t.rows("select org_id from public.study_sites where study_id = $1", [study]);
  assert.ok(all.length > 1, "needs at least one non-lead site");
  const lead = await t.as(ID.adminB, () => t.rows("select org_id from public.study_sites where study_id = $1", [study]));
  assert.equal(lead.length, (await t.rows("select 1 from public.study_sites where study_id = $1", [study])).length);
  for (const r of all) {
    if (r.org_id === ID.orgB) continue;
    const orgId = r.org_id as string;
    const [m] = await t.rows("select user_id from public.members where org_id = $1 limit 1", [orgId]);
    const seen = await t.as(m.user_id as string, () => t.rows("select org_id from public.study_sites where study_id = $1", [study]));
    assert.deepEqual(seen.map((x) => x.org_id), [orgId], "a site must not list the other sites");
  }
});
