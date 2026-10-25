/**
 * lib/research/analysis/exports.ts
 * ==================================
 * CSV exports for SPSS / R (Hospital plan, feature raw_export), plus the CSVs of
 * the AOI metrics and group summary tables. Coded IDs only: child code and the
 * session UUID; never names or the internal child UUID. UTF-8 with BOM so Excel
 * and SPSS read Thai text; booleans are written as 1/0 and missing values as empty cells.
 */

import { csvCell } from "../gazeLog";
import { AGE_BANDS } from "./config";
import type { SessionAoiRow, AoiSummary } from "./aoi";
import type { GroupRow } from "./groupSummary";
import { SCORE_FIELDS, bandOf, sessionAge, sessionNumbers, type AnalysisSession } from "./sessions";

export const BOM = "﻿";

function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return BOM + [header.join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n") + "\n";
}

interface Variable {
  name: string;
  label: string;
  type: "string" | "integer" | "numeric" | "date" | "datetime" | "factor" | "binary";
  values?: string;
  get: (s: AnalysisSession, ctx: { num: Map<string, number> }) => unknown;
}

const r = (s: AnalysisSession) => s.results ?? {};

/** The wide file's variables, in order. Also the source of the codebook. */
export const WIDE_VARIABLES: readonly Variable[] = [
  { name: "session_id", label: "Session ID (coded, UUID)", type: "string", get: (s) => s.id },
  { name: "child_code", label: "Child code (coded ID set by the site)", type: "string", get: (s) => s.child?.code ?? "" },
  { name: "session_number", label: "Nth session of this child in the export (1 = first)", type: "integer", get: (s, c) => c.num.get(s.id) },
  { name: "age_months", label: "Age in months at the session (from birth month)", type: "integer", get: (s) => sessionAge(s) },
  {
    name: "age_band",
    label: "Age band in months (TBD config)",
    type: "factor",
    values: AGE_BANDS.map((b) => b.key).join("; ") + "; empty = outside bands or unknown",
    get: (s) => bandOf(sessionAge(s))?.key ?? "",
  },
  { name: "sex", label: "Sex", type: "factor", values: "M = male; F = female; U = unknown", get: (s) => s.child?.sex ?? "" },
  { name: "started_at", label: "Session start (ISO 8601, UTC)", type: "datetime", get: (s) => s.started_at },
  { name: "completed_at", label: "Session end (ISO 8601, UTC)", type: "datetime", get: (s) => s.completed_at },
  {
    name: "status",
    label: "Session status",
    type: "factor",
    values: "completed; invalid = retest needed; started = not finished",
    get: (s) => s.status,
  },
  { name: "engine", label: "Gaze engine", type: "factor", values: "mediapipe; opencv", get: (s) => s.engine },
  { name: "overall_score", label: "Overall score (0-100)", type: "numeric", get: (s) => s.overall_score },
  { name: "risk_level", label: "Screening risk level (not a diagnosis)", type: "factor", values: "Low; Moderate; High", get: (s) => s.risk_level },
  { name: "level1_score", label: "Test 1 score: % looking at the human video", type: "numeric", get: (s) => s.level1_score },
  { name: "level2_score", label: "Test 2 score: % looking at the face", type: "numeric", get: (s) => s.level2_score },
  { name: "level3_score", label: "Test 3 score: joint attention accuracy %", type: "numeric", get: (s) => s.level3_score },
  { name: "t1_human_pct", label: "Test 1: % of samples on the human video", type: "numeric", get: (s) => r(s).test1?.humanPct },
  { name: "t1_geometric_pct", label: "Test 1: % of samples on the geometric video", type: "numeric", get: (s) => r(s).test1?.geometricPct },
  { name: "t1_switches", label: "Test 1: number of switches between videos", type: "integer", get: (s) => r(s).test1?.switches },
  { name: "t1_avg_fixation_ms", label: "Test 1: mean fixation duration (ms)", type: "numeric", get: (s) => r(s).test1?.avgFixationMs },
  { name: "t1_human_side", label: "Test 1: side of the human video", type: "factor", values: "left; right", get: (s) => r(s).test1?.humanSide },
  { name: "t2_face_pct", label: "Test 2: % of samples on the face", type: "numeric", get: (s) => r(s).test2?.facePct },
  { name: "t2_object_pct", label: "Test 2: % of samples on the object", type: "numeric", get: (s) => r(s).test2?.objectPct },
  { name: "t3_block_pct", label: "Test 3: % on target during the block phase", type: "numeric", get: (s) => r(s).test3?.blockPct },
  { name: "t3_face_pct", label: "Test 3: % on target during the face phase", type: "numeric", get: (s) => r(s).test3?.facePct },
  { name: "t3_accuracy_pct", label: "Test 3: % on target over both phases", type: "numeric", get: (s) => r(s).test3?.accuracyPct },
  { name: "t3_latency_ms", label: "Test 3: time to first face look after the face phase starts (ms)", type: "numeric", get: (s) => r(s).test3?.latencyMs },
  { name: "quality_score", label: "Session quality score (0-100)", type: "numeric", get: (s) => s.quality_score },
  { name: "face_found_pct", label: "% of samples with the face found", type: "numeric", get: (s) => s.face_found_pct },
  { name: "lighting_ok_pct", label: "% of time lighting was in range", type: "numeric", get: (s) => s.quality?.lightingOkPct },
  { name: "distance_ok_pct", label: "% of time distance was in range", type: "numeric", get: (s) => s.quality?.distanceOkPct },
  { name: "retest_needed", label: "Retest recommended", type: "binary", values: "1 = yes; 0 = no", get: (s) => s.retest_needed },
  { name: "calibration_error_px", label: "Calibration mean error (px)", type: "numeric", get: (s) => s.calibration_error_px },
  { name: "calibration_error_deg", label: "Calibration mean error (degrees, approx.)", type: "numeric", get: (s) => r(s).calibration?.meanErrorDeg },
  { name: "low_accuracy", label: "Calibration accuracy was low", type: "binary", values: "1 = yes; 0 = no", get: (s) => s.low_accuracy },
];

function sorted(sessions: readonly AnalysisSession[]) {
  return [...sessions].sort((a, b) => a.started_at.localeCompare(b.started_at));
}

/** One row per session. */
export function wideCsv(sessions: readonly AnalysisSession[]): string {
  const num = sessionNumbers(sessions);
  return toCsv(
    WIDE_VARIABLES.map((v) => v.name),
    sorted(sessions).map((s) => WIDE_VARIABLES.map((v) => v.get(s, { num }))),
  );
}

const LEVEL_NAMES = ["", "human_vs_geometric", "face_vs_object", "joint_attention"] as const;

export const LONG_VARIABLES: readonly Omit<Variable, "get">[] = [
  { name: "session_id", label: "Session ID (coded, UUID)", type: "string" },
  { name: "child_code", label: "Child code (coded ID)", type: "string" },
  { name: "session_number", label: "Nth session of this child in the export", type: "integer" },
  { name: "age_months", label: "Age in months at the session", type: "integer" },
  { name: "age_band", label: "Age band in months (TBD config)", type: "factor", values: AGE_BANDS.map((b) => b.key).join("; ") },
  { name: "sex", label: "Sex", type: "factor", values: "M; F; U" },
  { name: "started_at", label: "Session start (ISO 8601, UTC)", type: "datetime" },
  { name: "status", label: "Session status", type: "factor", values: "completed; invalid; started" },
  { name: "risk_level", label: "Screening risk level of the session", type: "factor", values: "Low; Moderate; High" },
  { name: "quality_score", label: "Session quality score (0-100)", type: "numeric" },
  { name: "level", label: "Test level", type: "factor", values: "1; 2; 3" },
  { name: "level_name", label: "Test name", type: "factor", values: "human_vs_geometric; face_vs_object; joint_attention" },
  { name: "score", label: "Level score (0-100)", type: "numeric" },
  { name: "metric_a_pct", label: "L1: % on human video; L2: % on face; L3: % on target in block phase", type: "numeric" },
  { name: "metric_b_pct", label: "L1: % on geometric video; L2: % on object; L3: % on target in face phase", type: "numeric" },
];

/** One row per session × level. */
export function longCsv(sessions: readonly AnalysisSession[]): string {
  const num = sessionNumbers(sessions);
  const rows: unknown[][] = [];
  for (const s of sorted(sessions)) {
    const res = r(s);
    const levels: [number, number | null, unknown, unknown][] = [
      [1, s.level1_score, res.test1?.humanPct, res.test1?.geometricPct],
      [2, s.level2_score, res.test2?.facePct, res.test2?.objectPct],
      [3, s.level3_score, res.test3?.blockPct, res.test3?.facePct],
    ];
    for (const [lv, score, a, b] of levels) {
      rows.push([
        s.id,
        s.child?.code ?? "",
        num.get(s.id),
        sessionAge(s),
        bandOf(sessionAge(s))?.key ?? "",
        s.child?.sex ?? "",
        s.started_at,
        s.status,
        s.risk_level,
        s.quality_score,
        lv,
        LEVEL_NAMES[lv],
        score,
        a,
        b,
      ]);
    }
  }
  return toCsv(LONG_VARIABLES.map((v) => v.name), rows);
}

/** Data dictionary for both files. */
export function codebookCsv(): string {
  const rows = [
    ...WIDE_VARIABLES.map((v) => ["wide", v.name, v.label, v.type, v.values ?? ""]),
    ...LONG_VARIABLES.map((v) => ["long", v.name, v.label, v.type, v.values ?? ""]),
  ];
  return toCsv(["file", "variable", "label", "type", "values"], rows);
}

/** A short R script that reads the two files with the right encoding and factor levels. */
export function rSnippet(wideName: string, longName: string): string {
  const bands = AGE_BANDS.map((b) => `"${b.key}"`).join(", ");
  return `# LookAtMe Research export — read in R
# Screening data, not diagnoses. Research use needs ethics committee approval.
wide <- read.csv("${wideName}", fileEncoding = "UTF-8-BOM", na.strings = "", stringsAsFactors = FALSE)
long <- read.csv("${longName}", fileEncoding = "UTF-8-BOM", na.strings = "", stringsAsFactors = FALSE)

for (d in c("wide", "long")) {
  x <- get(d)
  x$risk_level <- factor(x$risk_level, levels = c("Low", "Moderate", "High"), ordered = TRUE)
  x$sex        <- factor(x$sex, levels = c("M", "F", "U"), labels = c("male", "female", "unknown"))
  x$age_band   <- factor(x$age_band, levels = c(${bands}), ordered = TRUE)
  x$status     <- factor(x$status, levels = c("completed", "invalid", "started"))
  x$started_at <- as.POSIXct(x$started_at, format = "%Y-%m-%dT%H:%M:%OS", tz = "UTC")
  assign(d, x)
}
long$level      <- factor(long$level, levels = 1:3)
long$level_name <- factor(long$level_name, levels = c("human_vs_geometric", "face_vs_object", "joint_attention"))
wide$retest_needed <- wide$retest_needed == 1
wide$low_accuracy  <- wide$low_accuracy == 1

# Example: completed sessions, first session per child
first <- subset(wide, status == "completed" & session_number == 1)
aggregate(overall_score ~ age_band, data = first, FUN = median)
`;
}

/** Per-session × AOI metrics. */
export function aoiCsv(rows: readonly SessionAoiRow[]): string {
  return toCsv(
    ["session_id", "child_code", "aoi_set", "level", "video_id", "aoi", "valid_samples", "inside_samples", "pct_inside", "dwell_ms", "ttfl_ms", "visits", "mean_visit_ms", "skipped"],
    rows.map((x) => [
      x.sessionId,
      x.childCode,
      x.setName,
      x.level,
      x.videoId,
      x.label,
      x.validSamples,
      x.insideSamples,
      x.pctInside,
      x.dwellMs,
      x.ttflMs,
      x.visits,
      x.meanVisitMs,
      x.skipped ?? "",
    ]),
  );
}

export function aoiSummaryCsv(rows: readonly AoiSummary[]): string {
  return toCsv(
    ["aoi", "sessions", "mean_pct_inside", "mean_dwell_ms", "median_ttfl_ms", "looked_pct", "mean_visits", "mean_visit_ms"],
    rows.map((x) => [x.label, x.sessions, x.meanPctInside, x.meanDwellMs, x.medianTtflMs, x.lookedPct, x.meanVisits, x.meanVisitMs]),
  );
}

export function groupSummaryCsv(by: string, rows: readonly GroupRow[]): string {
  const header = ["group_by", "group", "n_completed", "n_completed_or_invalid"];
  for (const f of SCORE_FIELDS) header.push(`${f.key}_mean`, `${f.key}_sd`, `${f.key}_median`);
  header.push("risk_low_pct", "risk_moderate_pct", "risk_high_pct", "retest_pct", "quality_mean", "quality_sd", "face_found_mean");
  return toCsv(
    header,
    rows.map((g) => {
      const v: unknown[] = [by, g.key, g.n, g.nAll];
      for (const f of SCORE_FIELDS) v.push(g.scores[f.key].mean, g.scores[f.key].sd, g.scores[f.key].median);
      v.push(g.riskPct.Low, g.riskPct.Moderate, g.riskPct.High, g.retestPct, g.quality.mean, g.quality.sd, g.faceFound.mean);
      return v;
    }),
  );
}
