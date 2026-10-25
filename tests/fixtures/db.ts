/**
 * Shared test database for RLS tests: the real Supabase migrations on an in-memory Postgres
 * (PGlite) with minimal stand-ins for Supabase's `auth` and `storage` schemas.
 *
 *   const t = await createTestDb();
 *   await t.seed();                       // two orgs, members, children (see ID)
 *   await t.as(ID.staffA, () => t.rows("select * from public.children"));
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "supabase", "migrations");

export const SUPABASE_STUBS = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
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

export const SUPABASE_GRANTS = `
grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant all on all tables in schema public to authenticated, service_role;
grant all on all sequences in schema public to authenticated, service_role;
grant select, insert, update on storage.objects to authenticated;
grant all on storage.objects to service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
`;

export const ID = {
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
} as const;

export interface TestDb {
  db: PGlite;
  /** Runs fn as an authenticated user (RLS applies). */
  as<T>(user: string, fn: () => Promise<T>): Promise<T>;
  /** Runs fn as the service role (bypasses RLS, like the server's service-role key). */
  asService<T>(fn: () => Promise<T>): Promise<T>;
  rows(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  /** Two orgs (A: school, quota 2; B: hospital), members, three children, a consent for childB. */
  seed(): Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STUBS);
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  }
  await db.exec(SUPABASE_GRANTS);

  const rows = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as Record<string, unknown>[];
  return {
    db,
    rows,
    async as(user, fn) {
      await db.exec(`select set_config('request.jwt.claim.sub', '${user}', false); set role authenticated;`);
      try {
        return await fn();
      } finally {
        await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
      }
    },
    async asService(fn) {
      await db.exec(`set role service_role;`);
      try {
        return await fn();
      } finally {
        await db.exec(`reset role;`);
      }
    },
    async seed() {
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
      `);
    },
  };
}

export async function expectError(p: Promise<unknown>, match: RegExp) {
  await assert.rejects(p, (err: Error) => match.test(err.message));
}
