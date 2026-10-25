/** Consent withdrawal steps (lib/research/followup/withdraw.ts) and trend layout. Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { withdrawConsent, WithdrawError, type WithdrawDeps, type WithdrawFile } from "../lib/research/followup/withdraw.ts";
import { pathD, trendLayout, type TrendSession } from "../lib/research/followup/trend.ts";

const ORG = "00000000-0000-0000-0000-00000000000a";
const CHILD = "c0000000-0000-0000-0000-00000000000a";
const S1 = "51000000-0000-0000-0000-000000000001";
const S2 = "51000000-0000-0000-0000-000000000002";

function fakeDeps(over: Partial<WithdrawDeps> = {}) {
  const calls: string[] = [];
  const files: WithdrawFile[] = [
    { session_id: S1, kind: "gaze_csv", location: "supabase", path: `${ORG}/${S1}.csv`, drive_file_id: null },
    { session_id: S1, kind: "recording", location: "google_drive", path: null, drive_file_id: "drv1" },
    { session_id: S2, kind: "recording", location: "local_only", path: null, drive_file_id: null },
    // a path outside this org's folder must never be deleted
    { session_id: S2, kind: "gaze_csv", location: "supabase", path: `other-org/${S2}.csv`, drive_file_id: null },
  ];
  let removed: string[] = [];
  let auditTarget = "";
  const deps: WithdrawDeps = {
    async loadChild(id) {
      calls.push("loadChild");
      return id === CHILD ? { id, org_id: ORG, code: "A-001" } : null;
    },
    async requireAdmin() {
      calls.push("requireAdmin");
    },
    async loadSessionIds() {
      return [S1, S2];
    },
    async loadFiles() {
      return files;
    },
    async markWithdrawn() {
      calls.push("markWithdrawn");
    },
    async deleteDriveFiles(_org, ids) {
      calls.push("drive");
      return { deleted: 0, failed: [...ids] }; // the Wave 0 stub behaviour
    },
    async removeGaze(paths) {
      calls.push("gaze");
      removed = paths;
    },
    async deleteChild() {
      calls.push("deleteChild");
    },
    async audit(_org, target) {
      calls.push("audit");
      auditTarget = target;
    },
    ...over,
  };
  return { deps, calls, removed: () => removed, auditTarget: () => auditTarget };
}

test("withdrawal runs every step in order and reports Drive failures", async () => {
  const f = fakeDeps();
  const res = await withdrawConsent({ childId: CHILD, reason: "parent_request", confirmCode: "A-001" }, f.deps);
  assert.deepEqual(f.calls, ["loadChild", "requireAdmin", "markWithdrawn", "drive", "gaze", "deleteChild", "audit"]);
  assert.deepEqual(res.driveFailed, ["drv1"]);
  assert.equal(res.localOnlyRecordings, 1);
  assert.equal(res.sessionsDeleted, 2);
  assert.deepEqual(f.removed().sort(), [`${ORG}/${S1}.csv`, `${ORG}/${S2}.csv`]);
  assert.equal(f.auditTarget(), "reason:parent_request");
  assert.ok(!f.auditTarget().includes("A-001") && !f.auditTarget().includes(CHILD), "no child data in the audit log");
});

test("withdrawal refuses bad input, wrong code and non-admins before deleting anything", async () => {
  const f = fakeDeps();
  await assert.rejects(withdrawConsent({ childId: "x", reason: "parent_request" }, f.deps), (e: WithdrawError) => e.status === 400);
  await assert.rejects(withdrawConsent({ childId: CHILD, reason: "because" }, f.deps), (e: WithdrawError) => e.status === 400);
  await assert.rejects(
    withdrawConsent({ childId: "c0000000-0000-0000-0000-0000000000ff", reason: "other", confirmCode: "A-001" }, f.deps),
    (e: WithdrawError) => e.status === 404,
  );
  await assert.rejects(withdrawConsent({ childId: CHILD, reason: "other", confirmCode: "A-002" }, f.deps), /does not match/);
  const denied = fakeDeps({
    async requireAdmin() {
      throw new Error("403");
    },
  });
  await assert.rejects(withdrawConsent({ childId: CHILD, reason: "other", confirmCode: "A-001" }, denied.deps), /403/);
  assert.ok(!f.calls.includes("deleteChild") && !denied.calls.includes("markWithdrawn"));
});

test("a gaze delete failure stops before the child row is deleted", async () => {
  const f = fakeDeps({
    async removeGaze() {
      throw new Error("storage down");
    },
  });
  await assert.rejects(
    withdrawConsent({ childId: CHILD, reason: "other", confirmCode: "A-001" }, f.deps),
    (e: WithdrawError) => e.status === 502,
  );
  assert.ok(!f.calls.includes("deleteChild"));
  assert.ok(!f.calls.includes("audit"));
});

test("trend layout: completed sessions only, oldest first, time-scaled x and 0–100 y", () => {
  const mk = (id: string, at: string, status: string, overall: number | null, l1: number | null = null): TrendSession => ({
    id,
    started_at: at,
    status,
    overall_score: overall,
    level1_score: l1,
    level2_score: null,
    level3_score: null,
    risk_level: null,
  });
  const L = trendLayout(
    [
      mk("c", "2026-03-01T00:00:00Z", "completed", 100, 50),
      mk("a", "2026-01-01T00:00:00Z", "completed", 0, 20),
      mk("x", "2026-02-01T00:00:00Z", "invalid", 70),
      mk("b", "2026-01-31T00:00:00Z", "completed", 50),
    ],
    640,
    260,
  );
  assert.deepEqual(L.sessions.map((s) => s.id), ["a", "b", "c"]);
  const o = L.series.overall_score;
  assert.equal(o.length, 3);
  assert.equal(o[0].x, L.pad.left);
  assert.equal(o[2].x, 640 - L.pad.right);
  // Jan 1 → Jan 31 is 30 of 59 days
  assert.ok(Math.abs(o[1].x - (L.pad.left + (30 / 59) * (640 - L.pad.left - L.pad.right))) < 1e-6);
  assert.equal(o[0].y, 260 - L.pad.bottom); // 0 at the bottom
  assert.equal(o[2].y, L.pad.top); // 100 at the top
  assert.equal(L.series.level1_score.length, 2, "missing level scores are skipped");
  assert.match(pathD(o), /^M40\.0,228\.0 L/);
  const one = trendLayout([mk("a", "2026-01-01T00:00:00Z", "completed", 40)]);
  assert.equal(one.series.overall_score[0].x, one.pad.left + (640 - one.pad.left - one.pad.right) / 2);
});
