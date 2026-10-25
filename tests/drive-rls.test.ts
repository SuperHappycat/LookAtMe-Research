/** Migration 20261026000201: per-level recordings in session_files, complete_session still correct, RLS. */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, expectError, ID, type TestDb } from "./fixtures/db.ts";

let t: TestDb;
let sid = "";

before(async () => {
  t = await createTestDb();
  await t.seed();
  await t.db.exec(`
    insert into public.consents (org_id, child_id, guardian_relation, consent_version, allow_recording)
    values ('${ID.orgA}', '${ID.childA}', 'mother', 'v1', true);
  `);
  const [{ start_session }] = await t.as(ID.staffA, () =>
    t.rows("select public.start_session($1, gen_random_uuid(), 'mediapipe')", [ID.childA]),
  );
  sid = String(start_session);
});

const recRow = (level: number, location = "google_drive", fileId: string | null = `f${level}`) =>
  t.rows(
    `insert into public.session_files (org_id, session_id, kind, level, location, drive_file_id, size_bytes)
     values ($1, $2, 'recording', $3, $4, $5, 100)`,
    [ID.orgA, sid, level, location, fileId],
  );

test("three recordings per session (one per level); a level can't be duplicated", async () => {
  await t.asService(async () => {
    await recRow(1);
    await recRow(2);
    await recRow(3, "local_only", null);
  });
  assert.equal((await t.rows("select * from public.session_files where session_id = $1 and kind = 'recording'", [sid])).length, 3);
  await expectError(t.asService(() => recRow(2)), /duplicate key|unique/);
  await expectError(t.asService(() => recRow(4)), /check constraint|session_files_level_check/);
  await expectError(t.asService(() => recRow(0, "google_drive", null)), /check constraint|drive_location/);
});

test("complete_session still upserts the gaze CSV (level 0) and keeps recordings", async () => {
  const path = `${ID.orgA}/${sid}.csv`;
  const data = JSON.stringify({ risk_level: "Low", gaze_bytes: 10 });
  const [{ complete_session: st }] = await t.as(ID.staffA, () =>
    t.rows("select public.complete_session($1, $2::jsonb, $3)", [sid, data, path]),
  );
  assert.equal(st, "completed");
  await t.as(ID.staffA, () => t.rows("select public.complete_session($1, $2::jsonb, $3)", [sid, JSON.stringify({ gaze_bytes: 20 }), path]));
  const gaze = await t.rows("select * from public.session_files where session_id = $1 and kind = 'gaze_csv'", [sid]);
  assert.equal(gaze.length, 1);
  assert.equal(gaze[0].level, 0);
  assert.equal(Number(gaze[0].size_bytes), 20);
  assert.equal((await t.rows("select * from public.session_files where session_id = $1", [sid])).length, 4);
  await expectError(t.as(ID.staffA, () => t.rows("select public.complete_session($1, '{}'::jsonb, $2)", [sid, `${ID.orgB}/x.csv`])), /bad_path/);
  await expectError(t.as(ID.adminB, () => t.rows("select public.complete_session($1, '{}'::jsonb)", [sid])), /not_allowed/);
  // quota used once
  const [org] = await t.rows("select screenings_used from public.organizations where id = $1", [ID.orgA]);
  assert.equal(org.screenings_used, 1);
});

test("RLS: members see recordings; other orgs don't; users can't write session_files or read drive tokens", async () => {
  assert.equal((await t.as(ID.viewerA, () => t.rows("select * from public.session_files where kind = 'recording'"))).length, 3);
  assert.equal((await t.as(ID.adminB, () => t.rows("select * from public.session_files"))).length, 0);
  assert.equal((await t.as(ID.stranger, () => t.rows("select * from public.session_files"))).length, 0);
  await expectError(
    t.as(ID.adminA, () =>
      t.rows(
        "insert into public.session_files (org_id, session_id, kind, level, location, drive_file_id) values ($1, $2, 'recording', 1, 'google_drive', 'evil')",
        [ID.orgA, sid],
      ),
    ),
    /row-level security|duplicate/,
  );
  const updated = await t.as(ID.adminA, () => t.rows("update public.session_files set drive_file_id = 'evil' returning id"));
  assert.equal(updated.length, 0);

  await t.asService(() =>
    t.rows("insert into public.drive_connections (org_id, refresh_token_enc, status) values ($1, 'iv:tag:ct', 'active')", [ID.orgA]),
  );
  for (const u of [ID.adminA, ID.staffA, ID.viewerA, ID.adminB]) {
    assert.equal((await t.as(u, () => t.rows("select * from public.drive_connections"))).length, 0);
  }
  await expectError(
    t.as(ID.adminA, () => t.rows("update public.drive_connections set status = 'active' returning org_id")).then((r) => {
      if (r.length === 0) throw new Error("row-level security: no rows");
    }),
    /row-level security/,
  );
});

test("blind sessions: recordings hidden from staff, visible to admins", async () => {
  await t.db.exec(`update public.sessions set blind = true where id = '${sid}'`);
  assert.equal((await t.as(ID.staffA, () => t.rows("select * from public.session_files"))).length, 0);
  assert.equal((await t.as(ID.adminA, () => t.rows("select * from public.session_files"))).length, 4);
  await t.db.exec(`update public.sessions set blind = false where id = '${sid}'`);
});
