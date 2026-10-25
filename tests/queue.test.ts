/** Upload queue logic (lib/research/offline/queueCore.ts). Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { OfflineSessionQueueItem, QueueItem, RecordingQueueItem } from "../lib/research/contracts.ts";
import { backoffDelay, MemoryQueueStore, QueueCore, reviewCodeFor, sortRecords } from "../lib/research/offline/queueCore.ts";

// contracts.ts can't be imported at runtime under strip-only TS (parameter property), so the test
// uses its own class and injects the check, the way lib/research/queue.ts does with NeedsReviewError.
class FakeNeedsReview extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

function setup(opts: { online?: () => boolean } = {}) {
  let t = 1_000_000;
  const store = new MemoryQueueStore();
  const q = new QueueCore(store, {
    now: () => t,
    isOnline: opts.online,
    reviewCode: (e) => (e instanceof FakeNeedsReview ? e.code : null),
    backoffBaseMs: 1000,
    backoffMaxMs: 8000,
    maxAttemptsBeforeReview: 5,
  });
  return { q, store, advance: (ms: number) => (t += ms) };
}

const session = (id: string, csid: string, createdAt = "2026-10-25T01:00:00Z"): OfflineSessionQueueItem => ({
  id,
  kind: "offline_session",
  createdAt,
  orgId: "org",
  attempts: 0,
  clientSessionId: csid,
  childId: "child",
  payload: { engine: "opencv", startedAt: createdAt, completeData: {}, gazeCsv: "h\n" },
});
const recording = (id: string, csid: string, sessionId: string | null = null): RecordingQueueItem => ({
  id,
  kind: "recording",
  createdAt: "2026-10-25T00:00:00Z",
  orgId: "org",
  attempts: 0,
  sessionId,
  clientSessionId: csid,
  childCode: "T-1",
  blobKey: "blob-" + id,
  mimeType: "video/webm",
  size: 3,
  target: "google_drive",
});

test("backoff doubles from the base and is capped", () => {
  assert.equal(backoffDelay(0, 1000, 8000), 0);
  assert.equal(backoffDelay(1, 1000, 8000), 1000);
  assert.equal(backoffDelay(2, 1000, 8000), 2000);
  assert.equal(backoffDelay(4, 1000, 8000), 8000);
  assert.equal(backoffDelay(50, 1000, 8000), 8000);
});

test("review codes come from NeedsReviewError or known server refusals", () => {
  assert.equal(reviewCodeFor(new Error("quota_reached")), "quota_reached");
  assert.equal(reviewCodeFor({ message: "plan_expired" }), "plan_expired");
  assert.equal(reviewCodeFor(new Error("new row violates row-level security policy")), "not_allowed");
  assert.equal(reviewCodeFor(new Error("TypeError: Failed to fetch")), null);
  assert.equal(reviewCodeFor(new FakeNeedsReview("drive_x"), (e) => (e instanceof FakeNeedsReview ? e.code : null)), "drive_x");
});

test("a successful upload removes the item and its blob", async () => {
  const { q, store } = setup();
  const seen: [string, string | null][] = [];
  q.registerUploader("recording", async (item, blob) => {
    seen.push([item.id, blob ? await blob.text() : null]);
  });
  await q.enqueue(recording("r1", "c1", "s1"), new Blob(["abc"]));
  await q.syncNow();
  assert.deepEqual(seen, [["r1", "abc"]]);
  assert.equal((await q.pending()).length, 0);
  assert.equal(store.blobs.size, 0);
});

test("failures retry with backoff, then become needs review (data kept)", async () => {
  const { q, advance } = setup();
  let calls = 0;
  q.registerUploader("offline_session", async () => {
    calls++;
    throw new Error("TypeError: Failed to fetch");
  });
  await q.enqueue(session("s1", "c1"));
  await q.syncNow();
  assert.equal(calls, 1);
  await q.syncNow(); // still inside the 1 s backoff
  assert.equal(calls, 1);
  advance(999);
  await q.syncNow();
  assert.equal(calls, 1);
  advance(1);
  await q.syncNow();
  assert.equal(calls, 2);
  let [it] = await q.pending();
  assert.equal(it.attempts, 2);
  assert.match(it.lastError ?? "", /Failed to fetch/);
  for (let i = 0; i < 5; i++) {
    advance(10_000);
    await q.syncNow();
  }
  [it] = await q.pending();
  assert.equal(calls, 5);
  assert.equal(it.needsReview, true, "after max attempts it needs a person");
  advance(100_000);
  await q.syncNow();
  assert.equal(calls, 5, "needs-review items are not retried automatically");
  await q.retry(it.id);
  await q.syncNow();
  assert.equal(calls, 6, "retry() tries again");
});

test("server refusals and NeedsReviewError mark needs review at once and keep the item", async () => {
  const { q, store } = setup();
  q.registerUploader("offline_session", async () => {
    throw { message: "quota_reached", code: "P0001" };
  });
  q.registerUploader("recording", async () => {
    throw new FakeNeedsReview("drive_needs_reconnect");
  });
  await q.enqueue(session("s1", "c1"));
  await q.enqueue(recording("r1", "c9", "s9"), new Blob(["x"]));
  await q.syncNow();
  const items = await q.pending();
  assert.equal(items.length, 2);
  assert.ok(items.every((i) => i.needsReview));
  assert.equal(store.blobs.size, 1, "the recording blob is kept");
  assert.deepEqual(await q.counts(), { pending: 0, needsReview: 2, offlineSessions: 1 });
});

test("sessions sync before recordings; a recording waits for its session's id", async () => {
  const { q } = setup();
  const order: string[] = [];
  let sessionFails = true;
  q.registerUploader("recording", async (item) => {
    order.push(`rec:${(item as RecordingQueueItem).sessionId}`);
  });
  q.registerUploader("offline_session", async (item) => {
    if (sessionFails) throw new Error("Failed to fetch");
    order.push("session");
    await q.linkSession(item.clientSessionId, "server-1");
  });
  // recording enqueued first, but is older and of a later kind
  await q.enqueue(recording("r1", "c1"), new Blob(["v"]));
  await q.enqueue(session("s1", "c1"));
  await q.syncNow();
  assert.deepEqual(order, [], "recording waits while its session hasn't synced");
  sessionFails = false;
  await q.retry("s1");
  await q.syncNow();
  assert.deepEqual(order, ["session", "rec:server-1"]);
  assert.equal((await q.pending()).length, 0);
});

test("a recording enqueued after its session synced gets the id straight away", async () => {
  const { q } = setup();
  await q.linkSession("c2", "server-2");
  await q.enqueue(recording("r2", "c2"), new Blob(["v"]));
  const [it] = await q.pending();
  assert.equal((it as RecordingQueueItem).sessionId, "server-2");
});

test("items without an uploader wait; offline does nothing", async () => {
  let online = false;
  const { q } = setup({ online: () => online });
  let calls = 0;
  await q.enqueue(session("s1", "c1"));
  await q.syncNow();
  assert.equal((await q.pending()).length, 1);
  q.registerUploader("offline_session", async () => {
    calls++;
  });
  await q.syncNow();
  assert.equal(calls, 0, "offline: no attempt");
  online = true;
  await q.syncNow();
  assert.equal(calls, 1);
});

test("idempotency: same id enqueued twice is one item; concurrent syncs upload once", async () => {
  const { q } = setup();
  await q.enqueue(session("s1", "c1"));
  await q.enqueue(session("s1", "c1"));
  assert.equal((await q.pending()).length, 1);
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  q.registerUploader("offline_session", async () => {
    calls++;
    await gate;
  });
  const a = q.syncNow();
  const b = q.syncNow();
  release();
  await Promise.all([a, b]);
  assert.equal(calls, 1);
  assert.equal((await q.pending()).length, 0);
});

test("ordering helper: kind first, then createdAt", () => {
  const recs = [
    { id: "r", item: recording("r", "x") as QueueItem, nextAttemptAt: 0, seq: 1 },
    { id: "s2", item: session("s2", "y", "2026-10-25T03:00:00Z") as QueueItem, nextAttemptAt: 0, seq: 2 },
    { id: "s1", item: session("s1", "z", "2026-10-25T02:00:00Z") as QueueItem, nextAttemptAt: 0, seq: 3 },
  ];
  assert.deepEqual(sortRecords(recs).map((r) => r.id), ["s1", "s2", "r"]);
});

test("deleting an item mid-upload doesn't resurrect it; onChange fires", async () => {
  const { q } = setup();
  let changes = 0;
  const off = q.onChange(() => changes++);
  q.registerUploader("offline_session", async () => {
    await q.remove("s1");
    throw new Error("Failed to fetch");
  });
  await q.enqueue(session("s1", "c1"));
  await q.syncNow();
  assert.equal((await q.pending()).length, 0);
  assert.ok(changes >= 2);
  off();
  await q.clear();
});

test("a recording whose blob is missing needs review", async () => {
  const { q } = setup();
  q.registerUploader("recording", async () => {});
  await q.enqueue(recording("r1", "c1", "s1")); // no blob
  await q.syncNow();
  const [it] = await q.pending();
  assert.equal(it.needsReview, true);
  assert.match(it.lastError ?? "", /blob_missing/);
});

test("canSync=false (nobody signed in) waits without counting an attempt", async () => {
  let signedIn = false;
  const q = new QueueCore(new MemoryQueueStore(), { canSync: async () => signedIn });
  let calls = 0;
  q.registerUploader("offline_session", async () => {
    calls++;
  });
  await q.enqueue(session("s1", "c1"));
  await q.syncNow();
  const [it] = await q.pending();
  assert.equal(calls, 0);
  assert.equal(it.attempts, 0);
  signedIn = true;
  await q.syncNow();
  assert.equal(calls, 1);
});

test("items belong to the user who queued them: another sign-in neither lists nor syncs them", async () => {
  let me: string | null = "user-a";
  const store = new MemoryQueueStore();
  const q = new QueueCore(store, { owner: async () => me });
  const synced: string[] = [];
  q.registerUploader("offline_session", async (item) => {
    synced.push(`${item.id}@${me}`);
  });
  await q.enqueue(session("s1", "c1"));
  assert.equal((await q.pending())[0].ownerId, "user-a");
  me = "user-b";
  assert.equal((await q.pending()).length, 0);
  assert.equal((await q.counts()).offlineSessions, 0);
  await q.syncNow();
  assert.deepEqual(synced, []);
  // B logs out: A's unsent item stays on the device.
  assert.equal(await q.clearMine(), 0);
  assert.equal((await store.all()).length, 1);
  me = "user-a";
  await q.syncNow();
  assert.deepEqual(synced, ["s1@user-a"]);
});

test("logout clears only the user's own items and cached children", async () => {
  let me: string | null = "user-a";
  const store = new MemoryQueueStore();
  const q = new QueueCore(store, { owner: async () => me });
  await q.enqueue(session("a1", "c1"));
  await store.setMeta("child:k1", { id: "k1", ownerId: "user-a" });
  me = "user-b";
  await q.enqueue(session("b1", "c2"));
  await store.setMeta("child:k2", { id: "k2", ownerId: "user-b" });
  assert.equal(await q.clearMine(), 1);
  assert.deepEqual((await store.all()).map((r) => r.id), ["a1"]);
  assert.deepEqual((await store.metaEntries("child:")).map((e) => e.key), ["child:k1"]);
  me = "user-a";
  assert.equal(await q.clearMine(), 1);
  assert.equal((await store.all()).length, 0);
  assert.equal((await store.metaEntries("child:")).length, 0);
});
