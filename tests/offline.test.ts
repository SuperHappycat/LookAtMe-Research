/** Offline mode: start rules, sync steps, mark_session_offline RPC. Run with: npm test */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { OfflineSessionQueueItem } from "../lib/research/contracts.ts";
import {
  isNetworkError,
  localDate,
  offlineStartCheck,
  planFromOrg,
  replaceSessionId,
  type CachedChild,
  type CachedPlan,
} from "../lib/research/offline/rules.ts";
import { makeSessionUploader, type SyncDeps } from "../lib/research/offline/syncSession.ts";
import { MemoryQueueStore, QueueCore } from "../lib/research/offline/queueCore.ts";
import { createTestDb, expectError, ID, type TestDb } from "./fixtures/db.ts";

const NOW = new Date("2026-10-25T10:00:00");
const child: CachedChild = {
  id: "c1",
  org_id: "o1",
  code: "T-001",
  birth_month: "2023-04-01",
  consent: { allow_recording: false, allow_research: true },
  cachedAt: "2026-10-24T10:00:00Z",
};
const plan: CachedPlan = { orgId: "o1", expiresOn: "2026-10-25", quotaLeft: 5, cachedAt: "2026-10-24T10:00:00Z" };

test("offline start: allowed with cached child + plan, inside the limits", () => {
  assert.deepEqual(offlineStartCheck({ child, plan, pendingOfflineSessions: 0, now: NOW }), { ok: true });
});

test("offline start: refused without cache, after expiry, at the max, or past cached quota", () => {
  const code = (r: ReturnType<typeof offlineStartCheck>) => (r.ok ? "ok" : r.code);
  assert.equal(code(offlineStartCheck({ child: null, plan, pendingOfflineSessions: 0, now: NOW })), "not_cached");
  assert.equal(code(offlineStartCheck({ child, plan: null, pendingOfflineSessions: 0, now: NOW })), "plan_not_cached");
  const tomorrow = new Date("2026-10-26T08:00:00");
  assert.equal(code(offlineStartCheck({ child, plan, pendingOfflineSessions: 0, now: tomorrow })), "plan_expired");
  assert.equal(
    code(offlineStartCheck({ child, plan: { ...plan, quotaLeft: null }, pendingOfflineSessions: 20, now: NOW })),
    "too_many_offline",
  );
  assert.equal(
    code(offlineStartCheck({ child, plan: { ...plan, quotaLeft: null }, pendingOfflineSessions: 19, now: NOW })),
    "ok",
  );
  assert.equal(code(offlineStartCheck({ child, plan, pendingOfflineSessions: 5, now: NOW })), "quota_reached");
  const old = new Date("2026-12-30T10:00:00");
  assert.equal(
    code(offlineStartCheck({ child, plan: { ...plan, expiresOn: "2027-12-31" }, pendingOfflineSessions: 0, now: old })),
    "cache_too_old",
  );
  const r = offlineStartCheck({ child: null, plan, pendingOfflineSessions: 0, now: NOW });
  assert.ok(!r.ok && /\/ This child/.test(r.message), "Thai / English message");
});

test("plan status from an org row", () => {
  assert.deepEqual(
    planFromOrg({ id: "o1", expires_on: "2027-01-31", screening_quota: 10, screenings_used: 12 }, NOW),
    { orgId: "o1", expiresOn: "2027-01-31", quotaLeft: 0, cachedAt: NOW.toISOString() },
  );
  assert.equal(planFromOrg({ id: "o", expires_on: "2027-01-31", screening_quota: null, screenings_used: 3 }).quotaLeft, null);
  assert.equal(localDate(new Date(2026, 0, 5)), "2026-01-05");
});

test("network errors are told apart from refusals", () => {
  assert.ok(isNetworkError({ message: "TypeError: Failed to fetch", details: "" }));
  assert.ok(isNetworkError(new TypeError("fetch failed")));
  assert.ok(isNetworkError({ name: "AuthRetryableFetchError", message: "x" }));
  assert.ok(!isNetworkError({ message: "quota_reached", code: "P0001" }));
  assert.ok(!isNetworkError(null));
});

test("gaze CSV session id placeholder is swapped at sync", () => {
  const csv = "session_id,level\nabc-1,1\nabc-1,2\n";
  assert.equal(replaceSessionId(csv, "abc-1", "srv"), "session_id,level\nsrv,1\nsrv,2\n");
});

// ---------------------------------------------------------------- sync steps

const CSID = "11111111-2222-3333-4444-555555555555";
const SID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const item = (): OfflineSessionQueueItem => ({
  id: "q1",
  kind: "offline_session",
  createdAt: "2026-10-25T01:00:00Z",
  orgId: "org1",
  attempts: 0,
  clientSessionId: CSID,
  childId: "child1",
  payload: {
    engine: "opencv",
    startedAt: "2026-10-25T00:50:00Z",
    completeData: { overall_score: 50, risk_level: "Low", retest_needed: true },
    gazeCsv: `session_id,level\n${CSID},1\n`,
  },
});

function fakeServer(failOnce: string | null = null) {
  const calls: string[] = [];
  const uploads: { path: string; csv: string }[] = [];
  const links: string[] = [];
  let failed = false;
  const fail = (step: string) => {
    if (failOnce === step && !failed) {
      failed = true;
      return true;
    }
    return false;
  };
  const deps: SyncDeps = {
    hasSession: async () => true,
    rpc: async (name, args) => {
      calls.push(name);
      if (fail(name)) return { data: null, error: { message: "TypeError: Failed to fetch" } };
      if (name === "start_session") return { data: SID, error: null };
      if (name === "complete_session") {
        assert.equal(args.p_gaze_path, `org1/${SID}.csv`);
        return { data: "invalid", error: null };
      }
      return { data: null, error: null };
    },
    uploadGaze: async (path, csv) => {
      calls.push("upload");
      if (fail("upload")) return { error: { message: "Failed to fetch" } };
      uploads.push({ path, csv });
      return { error: null };
    },
    linkSession: async (c, s) => {
      links.push(`${c}=${s}`);
    },
  };
  return { deps, calls, uploads, links };
}

test("offline session uploader: start → mark → upload → complete with the real session id", async () => {
  const s = fakeServer();
  await makeSessionUploader(s.deps)(item());
  assert.deepEqual(s.calls, ["start_session", "mark_session_offline", "upload", "complete_session"]);
  assert.deepEqual(s.links, [`${CSID}=${SID}`]);
  assert.equal(s.uploads[0].path, `org1/${SID}.csv`);
  assert.equal(s.uploads[0].csv, `session_id,level\n${SID},1\n`);
});

test("a failure part-way is retried from the start (each step idempotent) via the queue", async () => {
  const s = fakeServer("upload");
  let t = 0;
  const q = new QueueCore(new MemoryQueueStore(), { now: () => t, backoffBaseMs: 10 });
  q.registerUploader("offline_session", makeSessionUploader(s.deps) as never);
  await q.enqueue(item());
  await q.syncNow();
  assert.equal((await q.pending()).length, 1);
  t += 10;
  await q.syncNow();
  assert.equal((await q.pending()).length, 0);
  assert.deepEqual(s.calls, [
    "start_session", "mark_session_offline", "upload",
    "start_session", "mark_session_offline", "upload", "complete_session",
  ]);
});

test("a refusal (quota_reached) is thrown so the queue keeps it for review", async () => {
  const deps = fakeServer().deps;
  deps.rpc = async () => ({ data: null, error: { message: "quota_reached", code: "P0001" } });
  const q = new QueueCore(new MemoryQueueStore());
  q.registerUploader("offline_session", makeSessionUploader(deps) as never);
  await q.enqueue(item());
  await q.syncNow();
  const [it] = await q.pending();
  assert.equal(it.needsReview, true);
});

test("signed out: retry later, not needs review; missing mark RPC is tolerated", async () => {
  const s = fakeServer();
  s.deps.hasSession = async () => false;
  await assert.rejects(makeSessionUploader(s.deps)(item()), /not_signed_in/);
  const s2 = fakeServer();
  const rpc = s2.deps.rpc;
  s2.deps.rpc = async (n, a) =>
    n === "mark_session_offline" ? { data: null, error: { message: "Could not find the function", code: "PGRST202" } } : rpc(n, a);
  await makeSessionUploader(s2.deps)(item());
  assert.equal(s2.uploads.length, 1);
  // an online-started session that fell back to the queue isn't marked offline
  const s3 = fakeServer();
  await makeSessionUploader(s3.deps)({ ...item(), startedOffline: false });
  assert.ok(!s3.calls.includes("mark_session_offline"));
});

// ---------------------------------------------------------------- RPC on the real schema

let t: TestDb;
const CS1 = "cccccccc-0000-0000-0000-000000000001";
before(async () => {
  t = await createTestDb();
  await t.seed();
  await t.db.exec(`insert into public.consents (org_id, child_id, guardian_relation, consent_version) values ('${ID.orgA}', '${ID.childA}', 'mother', 'v1')`);
});

test("mark_session_offline: sets flags once, backdates start only within 30 days, staff/admin of the org only", async () => {
  await t.rows("update public.consents set signed_at = now() - interval '2 days' where child_id = $1", [ID.childA]);
  const [{ start_session: sid }] = (await t.as(ID.staffA, () =>
    t.rows("select public.start_session($1, $2, 'opencv')", [ID.childA, CS1]),
  )) as { start_session: string }[];
  // same client id → same session (sync idempotency)
  const again = await t.as(ID.staffA, () => t.rows("select public.start_session($1, $2, 'opencv') as id", [ID.childA, CS1]));
  assert.equal(again[0].id, sid);

  await expectError(t.as(ID.viewerA, () => t.rows("select public.mark_session_offline($1, null)", [sid])), /not_allowed/);
  await expectError(t.as(ID.adminB, () => t.rows("select public.mark_session_offline($1, null)", [sid])), /not_allowed/);

  const [before0] = await t.rows("select started_at from public.sessions where id = $1", [sid]);
  const earlier = new Date(new Date(before0.started_at as string).getTime() - 3600_000).toISOString();
  await t.as(ID.staffA, () => t.rows("select public.mark_session_offline($1, $2)", [sid, earlier]));
  const [r1] = await t.rows("select created_offline, offline_synced_at, started_at from public.sessions where id = $1", [sid]);
  assert.equal(r1.created_offline, true);
  assert.ok(r1.offline_synced_at);
  assert.equal(new Date(r1.started_at as string).toISOString(), earlier);

  // later calls don't move offline_synced_at, and a far-past or future start is ignored
  await t.as(ID.adminA, () => t.rows("select public.mark_session_offline($1, '2020-01-01')", [sid]));
  await t.as(ID.adminA, () => t.rows("select public.mark_session_offline($1, now() + interval '1 day')", [sid]));
  const [r2] = await t.rows("select offline_synced_at, started_at from public.sessions where id = $1", [sid]);
  assert.equal(String(r2.offline_synced_at), String(r1.offline_synced_at));
  assert.equal(new Date(r2.started_at as string).toISOString(), earlier);
});

test("mark_session_offline: the start time is never moved before the consent was signed", async () => {
  await t.rows("update public.consents set signed_at = now() - interval '10 minutes' where child_id = $1", [ID.childA]);
  const cs = "c5000000-0000-4000-8000-000000000099";
  const [{ start_session: sid }] = (await t.as(ID.staffA, () =>
    t.rows("select public.start_session($1, $2, 'opencv')", [ID.childA, cs]),
  )) as { start_session: string }[];
  const [b] = await t.rows("select started_at from public.sessions where id = $1", [sid]);
  const hourEarlier = new Date(new Date(b.started_at as string).getTime() - 3600_000).toISOString();
  await t.as(ID.staffA, () => t.rows("select public.mark_session_offline($1, $2)", [sid, hourEarlier]));
  const [a] = await t.rows("select created_offline, started_at from public.sessions where id = $1", [sid]);
  assert.equal(a.created_offline, true);
  assert.equal(String(a.started_at), String(b.started_at));
});
