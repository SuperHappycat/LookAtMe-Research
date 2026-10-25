/** Unit tests for lib/research/analysis (AOI metrics, stats, age comparison, groups, exports). Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { GazeRow } from "../lib/research/gazeLog.ts";
import {
  aoiMetrics,
  boxToUnion,
  rectFromPoints,
  sampleDurations,
  sessionAoiMetrics,
  summarizeAoi,
  validateBoxes,
} from "../lib/research/analysis/aoi.ts";
import { describe, mean, median, percentileRank, quantile, sd } from "../lib/research/analysis/stats.ts";
import { ageComparison, sessionPercentile } from "../lib/research/analysis/ageComparison.ts";
import { groupKey, groupSummary } from "../lib/research/analysis/groupSummary.ts";
import { bandOf, filterSessions, firstPerChild, hasResearchConsent, type AnalysisSession } from "../lib/research/analysis/sessions.ts";
import { codebookCsv, longCsv, rSnippet, wideCsv, WIDE_VARIABLES, aoiCsv } from "../lib/research/analysis/exports.ts";

// ---------------------------------------------------------------- synthetic gaze

/** Builds rows every `dt` ms from a list of points (null = face lost). */
function rows(points: ([number, number] | null)[], opts: { level?: 1 | 2 | 3; dt?: number; t0?: number; fps?: number } = {}): GazeRow[] {
  const dt = opts.dt ?? 100;
  return points.map((p, i) => ({
    level: opts.level ?? 2,
    video_id: "talking",
    t_ms: (opts.t0 ?? 0) + i * dt,
    video_pos_s: ((opts.t0 ?? 0) + i * dt) / 1000,
    x_px: p ? p[0] * 1000 : null,
    y_px: p ? p[1] * 1000 : null,
    x_norm: p ? p[0] : null,
    y_norm: p ? p[1] : null,
    direction: "Center",
    face_found: p !== null,
    eyes_detected: p !== null,
    confidence: 1,
    face_scale: 0.3,
  }));
}

const IN: [number, number] = [0.2, 0.2];
const OUT: [number, number] = [0.8, 0.8];
const BOX = { label: "face", x: 0, y: 0, w: 0.5, h: 0.5 };

test("aoi: pct inside, dwell, ttfl, visits", () => {
  // 10 samples, 100 ms apart: out out in in in out in in out out
  const r = rows([OUT, OUT, IN, IN, IN, OUT, IN, IN, OUT, OUT]);
  const m = aoiMetrics(r, 2, BOX);
  assert.equal(m.validSamples, 10);
  assert.equal(m.insideSamples, 5);
  assert.equal(m.pctInside, 50);
  assert.equal(m.dwellMs, 500);
  assert.equal(m.ttflMs, 200);
  assert.equal(m.visits, 2);
  assert.equal(m.meanVisitMs, 250);
});

test("aoi: invalid samples are excluded from the denominator and short losses keep the visit", () => {
  const r = rows([IN, null, IN, OUT]);
  const m = aoiMetrics(r, 2, BOX);
  assert.equal(m.validSamples, 3);
  assert.equal(m.insideSamples, 2);
  assert.equal(m.visits, 1);
});

test("aoi: a long tracking gap ends a visit", () => {
  const r = rows([IN, null, null, null, IN]); // 400 ms between valid samples > 250 ms
  assert.equal(aoiMetrics(r, 2, BOX).visits, 2);
});

test("aoi: never looked gives null ttfl and zero visits", () => {
  const m = aoiMetrics(rows([OUT, OUT]), 2, BOX);
  assert.equal(m.ttflMs, null);
  assert.equal(m.visits, 0);
  assert.equal(m.meanVisitMs, null);
  assert.equal(m.pctInside, 0);
});

test("aoi: no valid samples gives null pct", () => {
  assert.equal(aoiMetrics(rows([null, null]), 2, BOX).pctInside, null);
});

test("aoi: time window limits samples and ttfl counts from the window start", () => {
  // positions 0.0..0.9 s; window 0.5–0.8 s covers samples 5,6,7
  const r = rows([IN, IN, IN, IN, IN, OUT, IN, IN, IN, IN]);
  const m = aoiMetrics(r, 2, { ...BOX, tStartS: 0.5, tEndS: 0.8 });
  assert.equal(m.validSamples, 3);
  assert.equal(m.insideSamples, 2);
  assert.equal(m.ttflMs, 100);
  assert.equal(m.visits, 1);
});

test("aoi: rows of other levels are ignored", () => {
  const r = [...rows([IN, IN], { level: 1 }), ...rows([OUT, OUT], { level: 2 })];
  assert.equal(aoiMetrics(r, 2, BOX).insideSamples, 0);
});

test("aoi: sample durations are capped and the last gets the median", () => {
  const r = rows([IN, IN, IN]);
  r[2].t_ms = 1200;
  assert.deepEqual(sampleDurations(r, 250), [100, 250, 250]);
});

test("aoi: level 1 boxes map to the half of the union box given by humanSide", () => {
  const b = { label: "face", x: 0.2, y: 0.1, w: 0.4, h: 0.3 };
  assert.deepEqual(boxToUnion(b, 1, "human", "left"), { ...b, x: 0.1, w: 0.2 });
  assert.deepEqual(boxToUnion(b, 1, "human", "right"), { ...b, x: 0.6, w: 0.2 });
  assert.deepEqual(boxToUnion(b, 1, "geometric", "left"), { ...b, x: 0.6, w: 0.2 });
  assert.equal(boxToUnion(b, 1, "human", null), null);
  assert.deepEqual(boxToUnion(b, 2, "talking", null), b);
});

test("aoi: session metrics for level 1 use humanSide; summary across sessions", () => {
  const set = { level: 1 as const, video_id: "human", name: "T1", boxes: [{ label: "whole", x: 0, y: 0, w: 1, h: 1 }] };
  // gaze on the left half of the union box
  const r = rows([[0.25, 0.5], [0.25, 0.5], [0.25, 0.5], [0.75, 0.5]], { level: 1 });
  const left = sessionAoiMetrics(set, { id: "s1", childCode: "A", humanSide: "left" }, r)[0];
  const right = sessionAoiMetrics(set, { id: "s2", childCode: "B", humanSide: "right" }, r)[0];
  const none = sessionAoiMetrics(set, { id: "s3", childCode: "C", humanSide: null }, r)[0];
  assert.equal(left.pctInside, 75);
  assert.equal(right.pctInside, 25);
  assert.equal(none.skipped, "no_human_side");
  const sum = summarizeAoi([left, right, none]);
  assert.equal(sum[0].sessions, 2);
  assert.equal(sum[0].meanPctInside, 50);
  assert.equal(sum[0].lookedPct, 100);
  assert.match(aoiCsv([left, none]), /no_human_side/);
});

test("aoi: sessions without gaze positions are skipped", () => {
  const set = { level: 2 as const, video_id: "talking", name: "T2", boxes: [BOX] };
  const r = rows([null, null]);
  assert.equal(sessionAoiMetrics(set, { id: "s", childCode: "A", humanSide: null }, r)[0].skipped, "no_gaze");
});

test("aoi: validate boxes and normalise drawn rectangles", () => {
  assert.deepEqual(validateBoxes([BOX]), []);
  assert.equal(validateBoxes([{ ...BOX, label: "" }]).length, 1);
  assert.equal(validateBoxes([BOX, BOX]).length, 1);
  assert.equal(validateBoxes([{ ...BOX, w: 0 }]).length, 1);
  assert.equal(validateBoxes([{ ...BOX, tStartS: 5, tEndS: 2 }]).length, 1);
  assert.deepEqual(rectFromPoints(0.6, 0.9, 0.2, -0.1), { x: 0.2, y: 0, w: 0.39999999999999997, h: 0.9 });
});

// ---------------------------------------------------------------- stats

test("stats: mean, sd, quantiles (R type 7), percentile rank", () => {
  const v = [1, 2, 3, 4, null, 10];
  assert.equal(mean(v), 4);
  assert.ok(Math.abs((sd([2, 4, 4, 4, 5, 5, 7, 9]) ?? 0) - 2.13809) < 1e-4);
  assert.equal(sd([5]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(quantile([1, 2, 3, 4], 0.25), 1.75); // R: quantile(1:4, .25) = 1.75
  assert.equal(quantile([], 0.5), null);
  assert.equal(percentileRank([10, 20, 30, 40], 25), 50);
  assert.equal(percentileRank([10, 20, 30, 40], 20), 37.5);
  assert.equal(percentileRank([], 1), null);
  const d = describe([1, 2, 3]);
  assert.equal(d.n, 3);
  assert.equal(d.q1, 1.5);
});

// ---------------------------------------------------------------- sessions

let seq = 0;
function session(over: Partial<AnalysisSession> & { age?: number; sex?: "M" | "F" | "U" } = {}): AnalysisSession {
  seq++;
  const started = over.started_at ?? "2026-06-15T03:00:00Z";
  const d = new Date(started);
  const age = over.age ?? 30;
  const bm = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - age, 1));
  const { age: _a, sex, ...rest } = over;
  void _a;
  return {
    id: `s${seq}`,
    child_id: `c${seq}`,
    started_at: started,
    completed_at: started,
    status: "completed",
    engine: "mediapipe",
    overall_score: 50,
    risk_level: "Low",
    level1_score: 60,
    level2_score: 50,
    level3_score: 40,
    quality_score: 80,
    face_found_pct: 90,
    retest_needed: false,
    calibration_error_px: 40,
    low_accuracy: false,
    results: { test1: { humanPct: 60, geometricPct: 40, switches: 3, avgFixationMs: 500, humanSide: "left" } },
    quality: { lightingOkPct: 100, distanceOkPct: 95 },
    child: {
      code: `C-${seq}`,
      birth_month: bm.toISOString().slice(0, 10),
      sex: sex ?? "M",
      consents: [{ allow_research: true, withdrawn_at: null }],
    },
    ...rest,
  };
}

test("sessions: age bands, filters, first per child, consent", () => {
  assert.equal(bandOf(18)?.key, "18-23");
  assert.equal(bandOf(23)?.key, "18-23");
  assert.equal(bandOf(72)?.key, "60-72");
  assert.equal(bandOf(17), null);
  assert.equal(bandOf(null), null);
  const a = session({ started_at: "2026-01-10T00:00:00Z", risk_level: "High" });
  const b = { ...session({ started_at: "2026-03-10T00:00:00Z" }), child_id: a.child_id };
  const c = session({ child: { code: "X-9", birth_month: null, sex: null, consents: [{ allow_research: true, withdrawn_at: "2026-02-01" }] } });
  assert.deepEqual(filterSessions([a, b, c], { from: "2026-02-01", to: "2026-03-31" }).map((s) => s.id), [b.id]);
  assert.deepEqual(filterSessions([a, b, c], { risk: "High" }).map((s) => s.id), [a.id]);
  assert.deepEqual(filterSessions([a, b, c], { code: "x-9" }).map((s) => s.id), [c.id]);
  assert.equal(filterSessions([a, b, c], { researchConsentOnly: true }).length, 2);
  assert.equal(hasResearchConsent(c), false);
  assert.deepEqual(firstPerChild([b, a]).map((s) => s.id), [a.id]);
});

// ---------------------------------------------------------------- age comparison

test("age comparison: per band n, median, IQR, risk; not enough data flag", () => {
  const list = [
    ...[10, 20, 30, 40].map((v) => session({ age: 20, overall_score: v, risk_level: v > 30 ? "High" : "Low" })),
    session({ age: 40, overall_score: 70 }),
    session({ age: 40, status: "invalid" }),
    session({ age: 100 }),
  ];
  const ac = ageComparison(list, undefined, 3);
  const b18 = ac.bands[0];
  assert.equal(b18.n, 4);
  assert.equal(b18.enough, true);
  assert.equal(b18.scores.overall_score.median, 25);
  assert.equal(b18.scores.overall_score.q1, 17.5);
  assert.equal(b18.scores.overall_score.q3, 32.5);
  assert.deepEqual(b18.risk, { Low: 3, Moderate: 0, High: 1 });
  assert.equal(ac.bands[2].n, 1);
  assert.equal(ac.bands[2].enough, false);
  assert.equal(ac.outside, 1);
});

test("age comparison: session percentile excludes the session itself", () => {
  const ref = [10, 20, 30, 40].map((v) => session({ age: 20, overall_score: v }));
  const me = session({ age: 21, overall_score: 35 });
  const p = sessionPercentile(me, [...ref, me], undefined, 4);
  assert.equal(p.band?.key, "18-23");
  assert.equal(p.referenceN, 4);
  assert.equal(p.percentiles.overall_score, 75);
  const few = sessionPercentile(me, [...ref, me], undefined, 5);
  assert.equal(few.enough, false);
  assert.equal(few.percentiles.overall_score, null);
  assert.equal(sessionPercentile(session({ age: 5 }), ref).band, null);
});

// ---------------------------------------------------------------- group summary

test("group summary: by sex with mean, SD, median, risk %, retest %", () => {
  const list = [
    session({ sex: "M", overall_score: 40, risk_level: "Low" }),
    session({ sex: "M", overall_score: 60, risk_level: "High" }),
    session({ sex: "M", status: "invalid", overall_score: null, risk_level: null, quality_score: 20 }),
    session({ sex: "F", overall_score: 50 }),
    session({ sex: "F", status: "started" }),
  ];
  const { rows: g } = groupSummary(list, "sex", 2);
  assert.deepEqual(g.map((x) => x.key), ["M", "F"]);
  const m = g[0];
  assert.equal(m.n, 2);
  assert.equal(m.nAll, 3);
  assert.equal(m.enough, true);
  assert.equal(m.scores.overall_score.mean, 50);
  assert.ok(Math.abs((m.scores.overall_score.sd ?? 0) - Math.SQRT2 * 10) < 1e-9);
  assert.equal(m.riskPct.High, 50);
  assert.ok(Math.abs((m.retestPct ?? 0) - 100 / 3) < 1e-9);
  assert.equal(m.quality.mean, 60);
  assert.equal(g[1].n, 1);
  assert.equal(g[1].enough, false);
});

test("group summary: date period keys and unplaced age", () => {
  const s = session({ started_at: "2026-05-20T05:00:00Z" });
  assert.equal(groupKey(s, "quarter"), "2026-Q2");
  assert.equal(groupKey(s, "year"), "2026");
  assert.equal(groupKey(s, "month"), "2026-05");
  const noAge = session({ child: { code: "Z", birth_month: null, sex: "F" } });
  assert.equal(groupSummary([noAge], "age_band").unplaced, 1);
});

// ---------------------------------------------------------------- exports

test("exports: wide, long, codebook, R snippet; coded IDs only", () => {
  const a = session({ started_at: "2026-01-01T00:00:00Z" });
  const b = { ...session({ started_at: "2026-02-01T00:00:00Z" }), child_id: a.child_id, child: a.child };
  const wide = wideCsv([b, a]);
  assert.ok(wide.startsWith("﻿session_id,child_code,session_number"));
  const lines = wide.trim().split("\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[0].split(",").length, WIDE_VARIABLES.length);
  assert.ok(lines[1].startsWith(`${a.id},${a.child!.code},1,`));
  assert.ok(lines[2].startsWith(`${b.id},${a.child!.code},2,`));
  assert.ok(!wide.includes(a.child_id), "internal child UUID must not be exported");
  const long = longCsv([a]).trim().split("\n");
  assert.equal(long.length, 4);
  assert.match(long[1], /,1,human_vs_geometric,60,60,40$/);
  const cb = codebookCsv();
  for (const v of WIDE_VARIABLES) assert.ok(cb.includes(`wide,${v.name},`), v.name);
  assert.match(cb, /long,level_name,/);
  const rs = rSnippet("w.csv", "l.csv");
  assert.match(rs, /read\.csv\("w\.csv", fileEncoding = "UTF-8-BOM"/);
  assert.match(rs, /levels = c\("Low", "Moderate", "High"\)/);
});

// ---------------------------------------------------------------- gaze download

test("gaze fetch: progress, cache, missing files, failures, cancel", async () => {
  const { fetchGazeMany } = await import("../lib/research/analysis/gazeFetch.ts");
  const csv = "session_id,level,video_id,t_ms,video_pos_s,x_px,y_px,x_norm,y_norm,direction,face_found,eyes_detected,confidence,face_scale\nx,2,talking,0,0,1,1,0.5,0.5,Center,1,1,1,0.3\n";
  const calls: string[] = [];
  const dl = async (id: string) => {
    calls.push(id);
    if (id === "bad") throw new Error("network");
    return id === "none" ? null : csv;
  };
  const cache = new Map();
  const progress: number[] = [];
  const res = await fetchGazeMany(["a", "b", "none", "bad"], dl, cache, { concurrency: 2, onProgress: (d) => progress.push(d) });
  assert.equal(res.rows.get("a")?.length, 1);
  assert.equal(res.rows.get("none"), null);
  assert.equal(res.rows.has("bad"), false);
  assert.deepEqual(res.failed, ["bad"]);
  assert.equal(progress.at(-1), 4);
  calls.length = 0;
  await fetchGazeMany(["a", "b"], dl, cache);
  assert.deepEqual(calls, [], "cached files are not downloaded again");
  const signal = { cancelled: true };
  const c = await fetchGazeMany(["z1", "z2"], dl, new Map(), { signal });
  assert.equal(c.cancelled, true);
  assert.equal(c.rows.size, 0);
});
