/** Blind mode migration (20261026000301): set_org_blind and start_session copying it. Run with: npm test */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, expectError, ID, type TestDb } from "./fixtures/db.ts";

let t: TestDb;

before(async () => {
  t = await createTestDb();
  await t.seed();
  await t.db.exec(`
    insert into public.consents (org_id, child_id, guardian_relation, consent_version)
    values ('${ID.orgA}', '${ID.childA}', 'mother', 'v1');
  `);
});

const blindOf = async (sid: string) =>
  (await t.rows("select blind from public.sessions where id = $1", [sid]))[0].blind as boolean;

test("only an org admin can switch blind mode, and only on the hospital plan", async () => {
  // org A is a school: admin may not turn it on, but may turn it off
  await t.as(ID.adminA, () => expectError(t.rows("select public.set_org_blind($1, true)", [ID.orgA]), /feature_not_in_plan/));
  await t.as(ID.adminA, () => t.rows("select public.set_org_blind($1, false)", [ID.orgA]));
  await t.as(ID.staffA, () => expectError(t.rows("select public.set_org_blind($1, false)", [ID.orgA]), /not_allowed/));
  await t.as(ID.adminA, () => expectError(t.rows("select public.set_org_blind($1, true)", [ID.orgB]), /not_allowed/));
  await t.as(ID.stranger, () => expectError(t.rows("select public.set_org_blind($1, true)", [ID.orgB]), /not_allowed/));

  const [{ set_org_blind }] = await t.as(ID.adminB, () => t.rows("select public.set_org_blind($1, true)", [ID.orgB]));
  assert.equal(set_org_blind, true);
  const [{ blind_new_sessions }] = await t.rows("select blind_new_sessions from public.organizations where id = $1", [ID.orgB]);
  assert.equal(blind_new_sessions, true);
  // users can't flip the column directly (organizations has no update policy)
  await t.as(ID.adminB, async () => {
    const r = await t.rows("update public.organizations set blind_new_sessions = false where id = $1 returning id", [ID.orgB]);
    assert.equal(r.length, 0);
  });
  const audit = await t.rows("select action, target from public.audit_log where org_id = $1 and action = 'set_blind_mode'", [ID.orgB]);
  assert.deepEqual(audit, [{ action: "set_blind_mode", target: "on" }]);
});

test("new sessions copy the org's blind setting; staff can't see them, admins can", async () => {
  // org B (hospital, blind on): add a staff member to run the session
  const staffB = "20000000-0000-0000-0000-00000000000b";
  await t.db.exec(`insert into auth.users (id, email) values ('${staffB}', 's@b');
    insert into public.members (user_id, org_id, role) values ('${staffB}', '${ID.orgB}', 'staff');`);
  const c = "b1000000-0000-0000-0000-000000000001";
  const [{ start_session: sid }] = await t.as(staffB, () => t.rows("select public.start_session($1, $2)", [ID.childB, c]));
  assert.equal(await blindOf(sid as string), true);
  // idempotent: same client id returns the same session
  const [{ start_session: again }] = await t.as(staffB, () => t.rows("select public.start_session($1, $2)", [ID.childB, c]));
  assert.equal(again, sid);
  assert.equal((await t.as(staffB, () => t.rows("select id from public.sessions where id = $1", [sid]))).length, 0);
  assert.equal((await t.as(ID.adminB, () => t.rows("select id from public.sessions where id = $1", [sid]))).length, 1);
  // staff can still complete their own blind session (RPC is SECURITY DEFINER)
  const [{ complete_session: st }] = await t.as(staffB, () =>
    t.rows("select public.complete_session($1, $2::jsonb)", [sid, JSON.stringify({ risk_level: "High", overall_score: 30 })]),
  );
  assert.equal(st, "completed");

  // turning it off: later sessions are not blind, earlier ones stay blind
  await t.as(ID.adminB, () => t.rows("select public.set_org_blind($1, false)", [ID.orgB]));
  const [{ start_session: sid2 }] = await t.as(staffB, () => t.rows("select public.start_session($1, gen_random_uuid())", [ID.childB]));
  assert.equal(await blindOf(sid2 as string), false);
  assert.equal(await blindOf(sid as string), true);
});

test("a non-hospital org with the flag set (e.g. after a downgrade) does not create blind sessions", async () => {
  await t.db.exec(`update public.organizations set blind_new_sessions = true where id = '${ID.orgA}'`);
  const [{ start_session: sid }] = await t.as(ID.staffA, () => t.rows("select public.start_session($1, gen_random_uuid())", [ID.childA]));
  assert.equal(await blindOf(sid as string), false);
  await t.db.exec(`update public.organizations set blind_new_sessions = false where id = '${ID.orgA}'`);
});

test("start_session keeps its checks after the replacement", async () => {
  await t.as(ID.staffA, () => expectError(t.rows("select public.start_session($1, gen_random_uuid())", [ID.childA2]), /no_consent/));
  await t.as(ID.viewerA, () => expectError(t.rows("select public.start_session($1, gen_random_uuid())", [ID.childA]), /not_allowed/));
  await t.as(ID.staffA, () => expectError(t.rows("select public.start_session($1, gen_random_uuid())", [ID.childB]), /not_allowed/));
  await t.db.exec(`update public.organizations set screenings_used = 2 where id = '${ID.orgA}'`);
  await t.as(ID.staffA, () => expectError(t.rows("select public.start_session($1, gen_random_uuid())", [ID.childA]), /quota_reached/));
  await t.db.exec(`update public.organizations set screenings_used = 0, expires_on = current_date - 1 where id = '${ID.orgA}'`);
  await t.as(ID.staffA, () => expectError(t.rows("select public.start_session($1, gen_random_uuid())", [ID.childA]), /plan_expired/));
  await t.db.exec(`update public.organizations set expires_on = current_date + 365 where id = '${ID.orgA}'`);
});

test("diagnoses: staff add and read their org's rows; viewers and other orgs can't", async () => {
  await t.as(ID.staffA, () =>
    t.rows("insert into public.diagnoses (org_id, child_id, result, diagnosed_on) values ($1, $2, 'asd', current_date)", [
      ID.orgA,
      ID.childA,
    ]),
  );
  assert.equal((await t.as(ID.staffA, () => t.rows("select * from public.diagnoses"))).length, 1);
  assert.equal((await t.as(ID.viewerA, () => t.rows("select * from public.diagnoses"))).length, 0);
  assert.equal((await t.as(ID.adminB, () => t.rows("select * from public.diagnoses"))).length, 0);
  await t.as(ID.viewerA, () =>
    expectError(t.rows("insert into public.diagnoses (org_id, child_id, result) values ($1, $2, 'asd')", [ID.orgA, ID.childA]), /row-level security/),
  );
  await t.as(ID.staffA, () =>
    expectError(t.rows("insert into public.diagnoses (org_id, child_id, result) values ($1, $2, 'asd')", [ID.orgA, ID.childB]), /row-level security/),
  );
});

test("deleting a child (withdrawal, service role) cascades to every child row", async () => {
  await t.asService(() => t.rows("delete from public.children where id = $1", [ID.childA]));
  for (const tb of ["consents", "sessions", "diagnoses"]) {
    const r = await t.rows(`select count(*)::int as n from public.${tb} where child_id = $1`, [ID.childA]);
    assert.equal(r[0].n, 0, tb);
  }
  // users cannot delete children directly (no delete policy)
  await t.as(ID.adminA, async () => {
    const r = await t.rows("delete from public.children where id = $1 returning id", [ID.childA2]);
    assert.equal(r.length, 0);
  });
});
