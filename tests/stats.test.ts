/** Diagnosis follow-up statistics (lib/research/stats.ts) against hand-computed values. Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFollowup,
  codedRowsCsv,
  currentDiagnosis,
  firstCompletedSession,
  isPositive,
  metrics,
  twoByTwoCsv,
  wilson,
  type StatsDiagnosis,
  type StatsSession,
} from "../lib/research/stats.ts";

const close = (a: number, b: number, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("Wilson 95% interval matches hand-computed values", () => {
  // 8/10: p=.8, z²/n=.38415, centre=.99207/1.38415=.71674, half=1.96·√(.016+.0096036)/1.38415=.22658
  const a = wilson(8, 10)!;
  close(a.est, 0.8);
  close(a.lo, 0.49016);
  close(a.hi, 0.94332);
  // 0/10: lower bound 0, upper = (z²/n)/(1+z²/n) = .38415/1.38415 = .27753
  const b = wilson(0, 10)!;
  close(b.lo, 0);
  close(b.hi, 0.27753);
  // 5/5: upper 1, lower = 1/(1+z²/5) = 1/1.76829 = .56551
  const c = wilson(5, 5)!;
  close(c.lo, 0.56551);
  close(c.hi, 1);
  // 45/50: p=.9; z²/n=.076829; centre=(.9+.038415)/1.076829=.87147; half=1.96·√(.0018+.00038415)/1.076829=.08507
  const d = wilson(45, 50)!;
  close(d.lo, 0.78640, 1e-3);
  close(d.hi, 0.95654, 1e-3);
  assert.equal(wilson(0, 0), null);
  assert.equal(wilson(3, 2), null);
});

test("positive definition: High only, or Moderate + High", () => {
  assert.equal(isPositive("High", "high"), true);
  assert.equal(isPositive("Moderate", "high"), false);
  assert.equal(isPositive("Moderate", "moderate_high"), true);
  assert.equal(isPositive("Low", "moderate_high"), false);
  assert.equal(isPositive(null, "high"), null);
});

const S = (id: string, child: string, at: string, status: string, risk: string | null): StatsSession => ({
  id,
  child_id: child,
  started_at: at,
  status,
  risk_level: risk,
  overall_score: 50,
});
const D = (child: string, result: StatsDiagnosis["result"], on: string | null, created = "2026-01-01T00:00:00Z"): StatsDiagnosis => ({
  child_id: child,
  result,
  diagnosed_on: on,
  created_at: created,
});

test("first completed session skips invalid and unfinished ones; latest diagnosis wins", () => {
  const s = firstCompletedSession([
    S("a", "c", "2026-01-01", "invalid", "High"),
    S("b", "c", "2026-01-03", "completed", "Low"),
    S("x", "c", "2026-01-02", "started", null),
    S("d", "c", "2026-01-05", "completed", "High"),
  ]);
  assert.equal(s?.id, "b");
  assert.equal(firstCompletedSession([S("a", "c", "2026-01-01", "invalid", "High")]), null);
  const d = currentDiagnosis([D("c", "pending", "2026-02-01"), D("c", "asd", "2026-05-01"), D("c", "not_asd", "2026-03-01")]);
  assert.equal(d?.result, "asd");
  const tie = currentDiagnosis([D("c", "asd", "2026-05-01", "2026-05-02"), D("c", "not_asd", "2026-05-01", "2026-05-03")]);
  assert.equal(tie?.result, "not_asd", "same date: the later entry is the correction");
});

test("2×2 table, exclusions and metrics", () => {
  const children = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"].map((id) => ({ id, code: id.toUpperCase() }));
  const sessions = [
    S("s1", "c1", "2026-01-01", "completed", "High"), // asd → TP
    S("s2", "c2", "2026-01-01", "completed", "Moderate"), // asd → FN (high only) / TP (mod+high)
    S("s3", "c3", "2026-01-01", "completed", "Low"), // not_asd → TN
    S("s4", "c4", "2026-01-01", "completed", "High"), // not_asd → FP
    S("s5a", "c5", "2026-01-01", "invalid", "High"),
    S("s5b", "c5", "2026-02-01", "completed", "Low"), // asd → FN (first completed is Low)
    S("s6", "c6", "2026-01-01", "completed", "High"), // other → excluded
    S("s7", "c7", "2026-01-01", "invalid", "High"), // asd but no completed session
    // c8: no diagnosis
  ];
  const diagnoses = [
    D("c1", "asd", "2026-06-01"),
    D("c2", "asd", "2026-06-01"),
    D("c3", "not_asd", "2026-06-01"),
    D("c4", "not_asd", "2026-06-01"),
    D("c5", "asd", "2026-06-01"),
    D("c6", "other", "2026-06-01"),
    D("c7", "asd", "2026-06-01"),
  ];
  const hi = buildFollowup(children, sessions, diagnoses, "high");
  assert.deepEqual(hi.table, { tp: 1, fp: 1, fn: 2, tn: 1 });
  assert.deepEqual(hi.excluded, { no_diagnosis: 1, other_or_pending: 1, no_completed_session: 1, no_risk_result: 0 });
  const mh = buildFollowup(children, sessions, diagnoses, "moderate_high");
  assert.deepEqual(mh.table, { tp: 2, fp: 1, fn: 1, tn: 1 });

  // denominators below minN → not enough data, no interval
  const m = metrics(hi.table, 10);
  assert.equal(m.sensitivity.n, 3);
  assert.equal(m.sensitivity.enough, false);
  assert.equal(m.sensitivity.ci, null);

  // hand-computed: TP 40, FN 10, FP 20, TN 80
  const big = metrics({ tp: 40, fn: 10, fp: 20, tn: 80 }, 10);
  close(big.sensitivity.ci!.est, 0.8);
  close(big.specificity.ci!.est, 0.8);
  close(big.ppv.ci!.est, 40 / 60);
  close(big.npv.ci!.est, 80 / 90);
  // sensitivity 40/50: p=.8, z²/n=.076829, centre=.838415/1.076829=.77860, half=1.96·√(.0032+.00038415)/1.076829=.10895
  close(big.sensitivity.ci!.lo, 0.66965, 1e-3);
  close(big.sensitivity.ci!.hi, 0.88755, 1e-3);
  assert.equal(big.npv.n, 90);

  const csv = twoByTwoCsv(hi, "high", 10);
  assert.ok(csv.startsWith("﻿"));
  assert.ok(csv.includes("screen_positive,1,1,2"));
  assert.ok(csv.includes("screen_negative,2,1,3"));
  assert.ok(csv.includes("other_or_pending,1"));
  const rows = codedRowsCsv(hi.rows).trim().split("\n");
  assert.equal(rows.length, 1 + children.length);
  assert.ok(rows[0].includes("child_code,session_id"));
  assert.ok(rows.some((r) => r.startsWith("C5,s5b,") && r.endsWith(",FN")));
});
