/** Unit tests: quality score, gaze CSV round-trip, exports, age. Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeQuality, QUALITY_CONFIG } from "../lib/research/quality.ts";
import { gazeRowsToCsv, parseGazeCsv, type GazeRow } from "../lib/research/gazeLog.ts";
import { sessionsCsv, gazeExportCsv, type ExportSession } from "../lib/research/exportCsv.ts";
import { ageInMonths } from "../lib/research/screening.ts";

const row = (over: Partial<GazeRow> = {}): GazeRow => ({
  level: 1,
  video_id: "human+geometric",
  t_ms: 100,
  video_pos_s: 0.1,
  x_px: 300,
  y_px: 200,
  x_norm: 0.25,
  y_norm: 0.5,
  direction: "Left",
  face_found: true,
  eyes_detected: true,
  confidence: 1,
  face_scale: 0.3,
  ...over,
});

test("quality: good session passes", () => {
  const q = computeQuality({
    faceFound: Array(100).fill(true),
    luma: [120, 130, 125],
    faceScale: Array(100).fill(0.3),
    calibration: { meanErrorPx: 80, ok: true, lowAccuracy: false },
  });
  assert.equal(q.faceFoundPct, 100);
  assert.equal(q.qualityScore, 100);
  assert.equal(q.retestNeeded, false);
});

test("quality: face often missing -> retest", () => {
  const faceFound = [...Array(60).fill(true), ...Array(40).fill(false)];
  const q = computeQuality({ faceFound, luma: [], faceScale: [], calibration: null });
  assert.equal(q.faceFoundPct, 60);
  assert.ok(q.faceFoundPct < QUALITY_CONFIG.minFaceFoundPct);
  assert.deepEqual(q.reasons, ["face_not_found_often"]);
  assert.equal(q.lightingOkPct, null);
  assert.equal(q.qualityScore, 60); // only the face part is available
});

test("quality: failed calibration (continued with low accuracy) -> retest", () => {
  const q = computeQuality({
    faceFound: Array(10).fill(true),
    luma: [10],
    faceScale: [0.9],
    calibration: { meanErrorPx: 400, ok: false, lowAccuracy: true },
  });
  assert.deepEqual(q.reasons, ["calibration_failed"]);
  assert.equal(q.lightingOkPct, 0);
  assert.equal(q.distanceOkPct, 0);
});

test("quality: no samples -> retest", () => {
  const q = computeQuality({ faceFound: [], luma: [], faceScale: [], calibration: null });
  assert.equal(q.retestNeeded, true);
  assert.deepEqual(q.reasons, ["no_samples"]);
});

test("gaze CSV round-trips, including empty points", () => {
  const rows = [row(), row({ t_ms: 200, x_px: null, y_px: null, x_norm: null, y_norm: null, direction: "Unknown", face_found: false, eyes_detected: false, confidence: 0, face_scale: null })];
  const csv = gazeRowsToCsv("sess-1", rows);
  assert.ok(csv.startsWith("session_id,level,video_id,t_ms"));
  const back = parseGazeCsv(csv);
  assert.equal(back.length, 2);
  assert.equal(back[0].session_id, "sess-1");
  assert.equal(back[0].x_norm, 0.25);
  assert.equal(back[0].face_found, true);
  assert.equal(back[1].x_px, null);
  assert.equal(back[1].direction, "Unknown");
  assert.equal(back[1].face_found, false);
});

const session: ExportSession = {
  id: "s1",
  started_at: "2026-10-25T03:00:00Z",
  completed_at: "2026-10-25T03:02:00Z",
  status: "completed",
  engine: "mediapipe",
  overall_score: 55.5,
  risk_level: "Moderate",
  level1_score: 60,
  level2_score: 50,
  level3_score: 55,
  quality_score: 90,
  face_found_pct: 95,
  retest_needed: false,
  calibration_error_px: 80,
  low_accuracy: false,
  child: { code: 'CMU,"01"', birth_month: "2023-04-01", sex: "F" },
};

test("sessions export escapes values and adds a BOM for Excel", () => {
  const csv = sessionsCsv([session]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  const [header, line] = csv.slice(1).trim().split("\n");
  assert.ok(header.startsWith("session_id,child_code,age_months,sex"));
  assert.ok(line.includes('"CMU,""01"""'), line);
  assert.ok(line.includes(",42,F,"), "age at screening = 42 months");
});

test("gaze export joins session fields to every sample", () => {
  const csv = gazeExportCsv([{ session, gazeCsv: gazeRowsToCsv("s1", [row(), row({ t_ms: 300 })]) }]);
  const lines = csv.slice(1).trim().split("\n");
  assert.equal(lines.length, 3);
  assert.ok(lines[0].includes("risk_level") && lines[0].includes("x_norm"));
  assert.ok(lines[2].includes("Moderate") && lines[2].includes(",300,"));
});

test("ageInMonths", () => {
  assert.equal(ageInMonths("2024-10-01", new Date("2026-10-25")), 24);
  assert.equal(ageInMonths(null), null);
});
