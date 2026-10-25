/**
 * lib/research/exportCsv.ts
 * ===========================
 * Builds the spreadsheet exports (spec §5.5): one row per session, or one row
 * per gaze sample joined with session-level fields. Coded IDs only.
 * A UTF-8 BOM is added so Excel opens Thai text correctly.
 */

import { csvCell, parseGazeCsv, CSV_COLUMNS } from "./gazeLog";
import { ageInMonths } from "./screening";

export interface ExportSession {
  id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  engine: string;
  overall_score: number | null;
  risk_level: string | null;
  level1_score: number | null;
  level2_score: number | null;
  level3_score: number | null;
  quality_score: number | null;
  face_found_pct: number | null;
  retest_needed: boolean;
  calibration_error_px: number | null;
  low_accuracy: boolean;
  child: { code: string; birth_month: string | null; sex: string | null } | null;
}

export const SESSION_COLUMNS = [
  "session_id",
  "child_code",
  "age_months",
  "sex",
  "started_at",
  "completed_at",
  "status",
  "engine",
  "overall_score",
  "risk_level",
  "level1_human_pct",
  "level2_face_pct",
  "level3_accuracy_pct",
  "quality_score",
  "face_found_pct",
  "retest_needed",
  "calibration_error_px",
  "low_accuracy",
] as const;

function sessionValues(s: ExportSession): unknown[] {
  return [
    s.id,
    s.child?.code ?? "",
    ageInMonths(s.child?.birth_month ?? null, new Date(s.started_at)),
    s.child?.sex ?? "",
    s.started_at,
    s.completed_at,
    s.status,
    s.engine,
    s.overall_score,
    s.risk_level,
    s.level1_score,
    s.level2_score,
    s.level3_score,
    s.quality_score,
    s.face_found_pct,
    s.retest_needed,
    s.calibration_error_px,
    s.low_accuracy,
  ];
}

const BOM = "﻿";

export function sessionsCsv(sessions: ExportSession[]): string {
  const lines = [SESSION_COLUMNS.join(",")];
  for (const s of sessions) lines.push(sessionValues(s).map(csvCell).join(","));
  return BOM + lines.join("\n") + "\n";
}

/** Gaze rows of many sessions, each row prefixed with its session-level fields. */
export function gazeExportCsv(parts: { session: ExportSession; gazeCsv: string }[]): string {
  const gazeCols = CSV_COLUMNS.filter((c) => c !== "session_id");
  const lines = [[...SESSION_COLUMNS, ...gazeCols].join(",")];
  for (const { session, gazeCsv } of parts) {
    const prefix = sessionValues(session).map(csvCell).join(",");
    for (const row of parseGazeCsv(gazeCsv)) {
      const rec = row as unknown as Record<string, unknown>;
      lines.push(prefix + "," + gazeCols.map((c) => csvCell(rec[c])).join(","));
    }
  }
  return BOM + lines.join("\n") + "\n";
}

export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
