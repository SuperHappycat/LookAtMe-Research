/**
 * Runs the real Supabase migration on an in-memory Postgres (PGlite) with
 * minimal stand-ins for Supabase's `auth` and `storage` schemas, then checks
 * that Row Level Security keeps organisations apart and that the screening
 * RPCs enforce consent, plan expiry and quota (spec §3.3 "write a test").
 *
 * Run with: npm test
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const MIGRATIONS = join(import.meta.dirname, "..", "supabase", "migrations");

// Minimal Supabase stand-ins (only what the migration and policies use).
const SUPABASE_STUBS = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid default auth.uid()
);
alter table storage.objects enable row level security;
`;

// What Supabase grants to API roles by default (RLS still applies).
const SUPABASE_GRANTS = `
grant usage on schema public, auth, storage to anon, authenticated;
grant all on all tables in schema public to authenticated;
grant all on all sequences in schema public to authenticated;
grant select, insert, update on storage.objects to authenticated;
grant execute on function auth.uid() to anon, authenticated;
`;

const ID = {
  orgA: "00000000-0000-0000-0000-00000000000a",
  orgB: "00000000-0000-0000-0000-00000000000b",
  adminA: "10000000-0000-0000-0000-00000000000a",
  staffA: "20000000-0000-0000-0000-00000000000a",
  viewerA: "30000000-0000-0000-0000-00000000000a",
  adminB: "10000000-0000-0000-0000-00000000000b",
  stranger: "90000000-0000-0000-0000-000000000000",
  childA: "c0000000-0000-0000-0000-00000000000a",
  childA2: "c0000000-0000-0000-0000-0000000000a2",
  childB: "c0000000-0000-0000-0000-00000000000b",
};

let db: PGlite;

async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`select set_config('request.jwt.claim.sub', '${user}', false); set role authenticated;`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

async function rows(sql: string, params: unknown[] = []) {
  return (await db.query(sql, params)).rows as Record<string, unknown>[];
}

async function expectError(p: Promise<unknown>, match: RegExp) {
  await assert.rejects(p, (err: Error) => match.test(err.message));
}

before(async () => {
  db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STUBS);
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  }
  await db.exec(SUPABASE_GRANTS);
  await db.exec(`
    insert into auth.users (id, email) values
      ('${ID.adminA}', 'a@a'), ('${ID.staffA}', 's@a'), ('${ID.viewerA}', 'v@a'),
      ('${ID.adminB}', 'a@b'), ('${ID.stranger}', 'x@x');
    insert into public.organizations (id, name, type, plan, screening_quota, seats, expires_on) values
      ('${ID.orgA}', 'School A', 'school', 'school', 2, 3, current_date + 365),
      ('${ID.orgB}', 'Hospital B', 'hospital', 'hospital', null, 15, current_date + 365);
    insert into public.members (user_id, org_id, role) values
      ('${ID.adminA}', '${ID.orgA}', 'admin'), ('${ID.staffA}', '${ID.orgA}', 'staff'),
      ('${ID.viewerA}', '${ID.orgA}', 'viewer'), ('${ID.adminB}', '${ID.orgB}', 'admin');
    insert into public.children (id, org_id, code) values
      ('${ID.childA}', '${ID.orgA}', 'A-001'), ('${ID.childA2}', '${ID.orgA}', 'A-002'),
      ('${ID.childB}', '${ID.orgB}', 'B-001');
    insert into public.consents (org_id, child_id, guardian_relation, consent_version) values
      ('${ID.orgB}', '${ID.childB}', 'mother', 'v1');
    insert into public.drive_connections (org_id, refresh_token_enc) values ('${ID.orgA}', 'secret');
  `);
});

test("members only see their own organisation's rows", async () => {
  await as(ID.staffA, async () => {
    assert.deepEqual((await rows("select name from public.organizations")).map((r) => r.name), ["School A"]);
    const codes = (await rows("select code from public.children order by code")).map((r) => r.code);
    assert.deepEqual(codes, ["A-001", "A-002"]);
    assert.equal((await rows("select * from public.members")).length, 3);
    assert.equal((await rows("select * from public.consents")).length, 0); // org B's consent hidden
  });
  await as(ID.adminB, async () => {
    assert.deepEqual((await rows("select code from public.children")).map((r) => r.code), ["B-001"]);
  });
  await as(ID.stranger, async () => {
    for (const t of ["organizations", "members", "children", "consents", "sessions", "session_files", "audit_log"]) {
      assert.equal((await rows(`select * from public.${t}`)).length, 0, t);
    }
  });
});

test("drive tokens and platform admins are never readable by users", async () => {
  await as(ID.adminA, async () => {
    assert.equal((await rows("select * from public.drive_connections")).length, 0);
    assert.equal((await rows("select * from public.platform_admins")).length, 0);
  });
});

test("writes are limited by organisation and role", async () => {
  await as(ID.staffA, async () => {
    await rows("insert into public.children (org_id, code) values ($1, 'A-003')", [ID.orgA]);
    await expectError(rows("insert into public.children (org_id, code) values ($1, 'X')", [ID.orgB]), /row-level security/);
    // consent for another org's child is refused
    await expectError(
      rows("insert into public.consents (org_id, child_id, guardian_relation, consent_version) values ($1, $2, 'm', 'v1')", [
        ID.orgA,
        ID.childB,
      ]),
      /row-level security/,
    );
    // sessions can't be written directly, only through the RPCs
    await expectError(
      rows("insert into public.sessions (client_session_id, org_id, child_id) values (gen_random_uuid(), $1, $2)", [ID.orgA, ID.childA]),
      /row-level security/,
    );
  });
  await as(ID.viewerA, async () => {
    await expectError(rows("insert into public.children (org_id, code) values ($1, 'V')", [ID.orgA]), /row-level security/);
  });
});

test("start_session enforces consent, role, quota and expiry", async () => {
  const c1 = "a1000000-0000-0000-0000-000000000001";
  await as(ID.staffA, async () => {
    await expectError(rows("select public.start_session($1, $2)", [ID.childA, c1]), /no_consent/);
    await rows(
      "insert into public.consents (org_id, child_id, guardian_relation, consent_version) values ($1, $2, 'mother', 'v1')",
      [ID.orgA, ID.childA],
    );
    const [{ start_session: s1 }] = await rows("select public.start_session($1, $2)", [ID.childA, c1]);
    const [{ start_session: again }] = await rows("select public.start_session($1, $2)", [ID.childA, c1]);
    assert.equal(again, s1, "same client_session_id returns the same session");
    await expectError(rows("select public.start_session($1, gen_random_uuid())", [ID.childB]), /not_allowed/);
  });
  await as(ID.viewerA, async () => {
    await expectError(rows("select public.start_session($1, gen_random_uuid())", [ID.childA]), /not_allowed/);
  });

  await db.exec(`update public.organizations set screenings_used = 2 where id = '${ID.orgA}'`);
  await as(ID.staffA, async () => {
    await expectError(rows("select public.start_session($1, gen_random_uuid())", [ID.childA]), /quota_reached/);
  });
  await db.exec(`update public.organizations set screenings_used = 0, expires_on = current_date - 1 where id = '${ID.orgA}'`);
  await as(ID.staffA, async () => {
    await expectError(rows("select public.start_session($1, gen_random_uuid())", [ID.childA]), /plan_expired/);
  });
  await db.exec(`update public.organizations set expires_on = current_date + 365 where id = '${ID.orgA}'`);
});

test("complete_session uses quota once, and not for retests", async () => {
  const used = async () =>
    (await rows("select screenings_used from public.organizations where id = $1", [ID.orgA]))[0].screenings_used as number;
  const before0 = await used();
  await as(ID.staffA, async () => {
    const [{ start_session: s }] = await rows("select public.start_session($1, gen_random_uuid())", [ID.childA]);
    const data = JSON.stringify({ overall_score: 55, risk_level: "Moderate", level1_score: 60, retest_needed: false });
    const path = `${ID.orgA}/${s}.csv`;
    const [{ complete_session: st }] = await rows("select public.complete_session($1, $2::jsonb, $3)", [s, data, path]);
    assert.equal(st, "completed");
    await rows("select public.complete_session($1, $2::jsonb, $3)", [s, data, path]);
    assert.equal((await rows("select * from public.session_files where session_id = $1", [s])).length, 1);
    await expectError(rows("select public.complete_session($1, $2::jsonb, $3)", [s, data, `${ID.orgB}/x.csv`]), /bad_path/);
    await expectError(rows("select public.complete_session($1, $2::jsonb, $3)", [s, data, `${ID.orgA}/other.csv`]), /bad_path/);

    const [{ start_session: r }] = await rows("select public.start_session($1, gen_random_uuid())", [ID.childA]);
    const [{ complete_session: st2 }] = await rows("select public.complete_session($1, $2::jsonb)", [
      r,
      JSON.stringify({ retest_needed: true, risk_level: "Low" }),
    ]);
    assert.equal(st2, "invalid");
    const [{ start_session: f }] = await rows("select public.start_session($1, gen_random_uuid())", [ID.childA]);
    await expectError(
      rows("select public.complete_session($1, $2::jsonb)", [f, JSON.stringify({ risk_level: "low" })]),
      /bad_risk_level/,
    );
  });
  assert.equal(await used(), before0 + 1);
  await as(ID.adminB, async () => {
    const [{ id }] = await rows("select id from public.sessions where org_id = $1 limit 1", [ID.orgA]).then((r) =>
      r.length ? r : [{ id: null }],
    );
    assert.equal(id, null, "org B cannot see org A sessions");
  });
});

test("blind sessions are hidden from staff but visible to admins", async () => {
  await db.exec(`update public.sessions set blind = true where org_id = '${ID.orgA}'`);
  const staffSees = await as(ID.staffA, () => rows("select id from public.sessions"));
  const adminSees = await as(ID.adminA, () => rows("select id from public.sessions"));
  assert.equal(staffSees.length, 0);
  assert.ok(adminSees.length > 0);
  await db.exec(`update public.sessions set blind = false`);
});

test("gaze files: only <org>/<own session>.csv can be written; blind files hidden", async () => {
  const [{ start_session: sid }] = await as(ID.staffA, () =>
    rows("select public.start_session($1, gen_random_uuid())", [ID.childA]),
  );
  const own = `${ID.orgA}/${sid}.csv`;
  await as(ID.staffA, async () => {
    await rows("insert into storage.objects (bucket_id, name) values ('gaze', $1)", [own]);
    for (const bad of [`${ID.orgB}/${sid}.csv`, `${ID.orgA}/s1.csv`, "not-a-uuid/x.csv", `${ID.orgA}/${sid}.txt`]) {
      await expectError(rows("insert into storage.objects (bucket_id, name) values ('gaze', $1)", [bad]), /row-level security/);
    }
  });
  // another staff member of the same org can't overwrite it, a viewer can't write at all
  await db.exec(`insert into auth.users (id, email) values ('40000000-0000-0000-0000-00000000000a', 's2@a')`);
  await db.exec(`update public.organizations set seats = 10 where id = '${ID.orgA}'`);
  await db.exec(`insert into public.members (user_id, org_id, role) values ('40000000-0000-0000-0000-00000000000a', '${ID.orgA}', 'staff')`);
  await as("40000000-0000-0000-0000-00000000000a", async () => {
    await expectError(rows("insert into storage.objects (bucket_id, name) values ('gaze', $1)", [own]), /row-level security/);
    assert.equal((await rows("update storage.objects set name = name where name = $1 returning id", [own])).length, 0);
    await expectError(rows("select public.complete_session($1, '{}'::jsonb)", [sid]), /not_allowed/);
  });
  await as(ID.viewerA, async () => {
    await expectError(rows("insert into storage.objects (bucket_id, name) values ('gaze', $1)", [`${ID.orgA}/${sid}.csv`]), /row-level security/);
  });
  await db.exec(`insert into storage.objects (bucket_id, name) values ('gaze', '${ID.orgB}/${ID.childB}.csv')`);
  const seenA = await as(ID.viewerA, () => rows("select name from storage.objects"));
  assert.deepEqual(seenA.map((r) => r.name), [own], "org A viewer sees only org A's file");

  // blind: file row and object hidden from staff/viewer, visible to admin
  await as(ID.staffA, () => rows("select public.complete_session($1, $2::jsonb, $3)", [sid, JSON.stringify({ risk_level: "Low" }), own]));
  await db.exec(`update public.sessions set blind = true where id = '${sid}'`);
  for (const u of [ID.staffA, ID.viewerA]) {
    assert.equal((await as(u, () => rows("select * from public.session_files where session_id = $1", [sid]))).length, 0);
    assert.equal((await as(u, () => rows("select * from storage.objects where name = $1", [own]))).length, 0);
  }
  assert.equal((await as(ID.adminA, () => rows("select * from storage.objects where name = $1", [own]))).length, 1);
  await db.exec(`update public.sessions set blind = false`);
});

test("a child can't be moved to another organization", async () => {
  await db.exec(`insert into public.members (user_id, org_id, role) values ('${ID.staffA}', '${ID.orgB}', 'staff')`);
  await as(ID.staffA, async () => {
    await expectError(rows("update public.children set org_id = $1 where id = $2", [ID.orgB, ID.childA]), /org_change_not_allowed/);
  });
  await db.exec(`delete from public.members where user_id = '${ID.staffA}' and org_id = '${ID.orgB}'`);
});

test("seat limit is enforced in the database", async () => {
  await db.exec(`insert into auth.users (id, email) values ('50000000-0000-0000-0000-00000000000b', 'x@b')`);
  await db.exec(`update public.organizations set seats = 1 where id = '${ID.orgB}'`);
  await expectError(
    db.exec(`insert into public.members (user_id, org_id, role) values ('50000000-0000-0000-0000-00000000000b', '${ID.orgB}', 'staff')`),
    /seats_full/,
  );
  await db.exec(`update public.organizations set seats = 15 where id = '${ID.orgB}'`);
});

test("log_action only works for members", async () => {
  await as(ID.staffA, () => rows("select public.log_action($1, 'export_sessions_csv', 'sessions')", [ID.orgA]));
  await as(ID.staffA, () => expectError(rows("select public.log_action($1, 'invite')", [ID.orgA]), /bad_action/));
  await as(ID.stranger, () => expectError(rows("select public.log_action($1, 'x')", [ID.orgA]), /not_allowed/));
  const seen = await as(ID.adminA, () => rows("select action from public.audit_log"));
  assert.deepEqual(seen.map((r) => r.action), ["export_sessions_csv"]);
  assert.equal((await as(ID.staffA, () => rows("select * from public.audit_log"))).length, 0, "staff can't read audit log");
});
