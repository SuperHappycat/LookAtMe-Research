/** Wave 0 contract tables: studies visibility and AOI sets RLS. Run with: npm test */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, expectError, ID, type TestDb } from "./fixtures/db.ts";

let t: TestDb;
const STUDY = "5d000000-0000-0000-0000-000000000001";

before(async () => {
  t = await createTestDb();
  await t.seed();
  await t.db.exec(`
    insert into public.studies (id, name, lead_org_id) values ('${STUDY}', 'Study 1', '${ID.orgB}');
  `);
});

test("a study is visible to the lead org, and to a site only once it is a site", async () => {
  assert.equal((await t.as(ID.adminB, () => t.rows("select * from public.studies"))).length, 1);
  assert.equal((await t.as(ID.staffA, () => t.rows("select * from public.studies"))).length, 0);
  await t.db.exec(`insert into public.study_sites (study_id, org_id, status) values ('${STUDY}', '${ID.orgA}', 'active')`);
  assert.equal((await t.as(ID.staffA, () => t.rows("select * from public.studies"))).length, 1);
  assert.equal((await t.as(ID.stranger, () => t.rows("select * from public.studies"))).length, 0);
  // no direct writes for users
  await expectError(
    t.as(ID.adminB, () => t.rows("insert into public.studies (name, lead_org_id) values ('x', $1)", [ID.orgB])),
    /row-level security/,
  );
});

test("AOI sets: members read, staff write, viewers can't, other orgs can't see", async () => {
  await t.as(ID.staffA, () =>
    t.rows("insert into public.aoi_sets (org_id, level, video_id, name, boxes) values ($1, 2, 'talking', 'face', '[]')", [ID.orgA]),
  );
  assert.equal((await t.as(ID.viewerA, () => t.rows("select * from public.aoi_sets"))).length, 1);
  assert.equal((await t.as(ID.adminB, () => t.rows("select * from public.aoi_sets"))).length, 0);
  await expectError(
    t.as(ID.viewerA, () =>
      t.rows("insert into public.aoi_sets (org_id, level, video_id, name) values ($1, 1, 'x', 'y')", [ID.orgA]),
    ),
    /row-level security/,
  );
  await t.db.exec(`insert into public.members (user_id, org_id, role) values ('${ID.staffA}', '${ID.orgB}', 'staff')`);
  await expectError(
    t.as(ID.staffA, () => t.rows("update public.aoi_sets set org_id = $1", [ID.orgB])),
    /org_change_not_allowed/,
  );
});
