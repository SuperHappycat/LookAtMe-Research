/**
 * lib/research/studies/pseudonym.ts
 * ===================================
 * Row-level coded export for a study (pure code, server-side only because it uses node:crypto).
 *
 * Pseudonymous IDs: HMAC-SHA256(secret, "<study id>:<child id>"), base32, 10 characters, prefixed "P-".
 * - Stable within a study (repeat screenings of one child share an ID), different across studies, and not
 *   reversible without the server secret `STUDY_PSEUDONYM_SECRET`.
 * - The site's own child code, the child's birth date and session ids are never written.
 * - Rotating the secret changes every ID (earlier exports can then no longer be linked).
 *
 * Which rows are allowed (all must hold):
 * - the session's org is an ACTIVE site of the study whose admin turned `share_row_data` on;
 * - the child's most recent non-withdrawn consent at that org has allow_research = true.
 */

import { createHmac } from "node:crypto";
import { ageInMonths } from "../screening";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32(buf: Buffer, chars: number): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < chars) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
    if (out.length >= chars) break;
  }
  return out;
}

export function studyPseudonym(secret: string, studyId: string, childId: string): string {
  if (!secret || secret.length < 32) throw new Error("STUDY_PSEUDONYM_SECRET must be at least 32 characters.");
  const mac = createHmac("sha256", secret).update(`${studyId}:${childId}`).digest();
  return "P-" + base32(mac, 10);
}

export interface ExportSessionRow {
  org_id: string;
  child_id: string;
  started_at: string;
  status: string;
  risk_level: string | null;
  overall_score: number | string | null;
  level1_score: number | string | null;
  level2_score: number | string | null;
  level3_score: number | string | null;
  quality_score: number | string | null;
  face_found_pct: number | string | null;
  child: { birth_month: string | null; sex: string | null } | null;
}

export interface ConsentRow {
  org_id: string;
  child_id: string;
  allow_research: boolean;
  signed_at: string;
  withdrawn_at: string | null;
}

/** "<org>:<child>" keys of children whose latest active consent at their org allows research use. */
export function researchConsentedChildren(consents: ConsentRow[]): Set<string> {
  const latest = new Map<string, ConsentRow>();
  for (const c of consents) {
    if (c.withdrawn_at) continue;
    const k = `${c.org_id}:${c.child_id}`;
    const prev = latest.get(k);
    if (!prev || c.signed_at > prev.signed_at) latest.set(k, c);
  }
  return new Set([...latest].filter(([, c]) => c.allow_research).map(([k]) => k));
}

export const STUDY_EXPORT_COLUMNS = [
  "study_child_id",
  "visit_no",
  "site",
  "age_months",
  "sex",
  "status",
  "risk_level",
  "overall_score",
  "level1_human_pct",
  "level2_face_pct",
  "level3_accuracy_pct",
  "quality_score",
  "face_found_pct",
] as const;

/** CSV cell with quoting, and a leading ' for values a spreadsheet would run as a formula. */
export function safeCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface StudyExportInput {
  secret: string;
  studyId: string;
  /** Active sites with share_row_data = true, with their display labels. */
  sharingSites: { orgId: string; label: string }[];
  sessions: ExportSessionRow[];
  consents: ConsentRow[];
}

export interface StudyExportResult {
  csv: string;
  rows: number;
  /** Rows per site org id, for the audit log of each site. */
  perSite: Map<string, number>;
}

export function buildStudyExport(input: StudyExportInput): StudyExportResult {
  const label = new Map(input.sharingSites.map((s) => [s.orgId, s.label]));
  const ok = researchConsentedChildren(input.consents);
  const kept = input.sessions
    .filter((s) => label.has(s.org_id) && ok.has(`${s.org_id}:${s.child_id}`))
    .sort((a, b) => a.started_at.localeCompare(b.started_at));

  const visits = new Map<string, number>();
  const perSite = new Map<string, number>();
  const lines = [STUDY_EXPORT_COLUMNS.join(",")];
  for (const s of kept) {
    const pid = studyPseudonym(input.secret, input.studyId, s.child_id);
    const visit = (visits.get(pid) ?? 0) + 1;
    visits.set(pid, visit);
    perSite.set(s.org_id, (perSite.get(s.org_id) ?? 0) + 1);
    const values = [
      pid,
      visit,
      label.get(s.org_id),
      ageInMonths(s.child?.birth_month ?? null, new Date(s.started_at)),
      s.child?.sex ?? "",
      s.status,
      s.risk_level,
      s.overall_score,
      s.level1_score,
      s.level2_score,
      s.level3_score,
      s.quality_score,
      s.face_found_pct,
    ];
    lines.push(values.map(safeCell).join(","));
  }
  return { csv: "﻿" + lines.join("\n") + "\n", rows: kept.length, perSite };
}
