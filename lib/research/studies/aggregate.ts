/**
 * lib/research/studies/aggregate.ts
 * ===================================
 * Combined study summary: aggregates only (pure code, unit-tested).
 *
 * Input rows deliberately carry no child id, child code, birth date or session id, so nothing identifying can
 * leak into the output by mistake.
 *
 * Rules:
 * - n counts every tagged session; completed / invalid / started by status.
 * - Risk distribution and score means/medians use completed sessions only (invalid = retest needed).
 * - Mean quality uses every session that has a quality score (invalid ones included, since quality explains them).
 * - `hideBlindScores`: blind sessions are counted in n (and `blinded`) but kept out of scores and risk.
 * - A block with fewer than `minCellN` completed sessions gets `suppressed: true` and null means/medians/risk.
 */

export type RiskLevel = "Low" | "Moderate" | "High";

export interface SummarySessionRow {
  org_id: string;
  status: string;
  blind: boolean;
  risk_level: string | null;
  overall_score: number | string | null;
  level1_score: number | string | null;
  level2_score: number | string | null;
  level3_score: number | string | null;
  quality_score: number | string | null;
}

export interface Stat {
  n: number;
  mean: number | null;
  median: number | null;
}

export interface SummaryBlock {
  label: string;
  n: number;
  completed: number;
  invalid: number;
  started: number;
  blinded: number;
  suppressed: boolean;
  risk: Record<RiskLevel | "none", number> | null;
  overall: Stat | null;
  level1: Stat | null;
  level2: Stat | null;
  level3: Stat | null;
  quality: Stat | null;
}

export interface SiteSummary extends SummaryBlock {
  /** Org id of the site (the caller already knows the sites of its study). */
  orgId: string;
}

export interface StudySummary {
  sites: SiteSummary[];
  total: SummaryBlock | null;
}

export interface AggregateOptions {
  minCellN: number;
  hideBlindScores: boolean;
}

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

const round = (x: number) => Math.round(x * 100) / 100;

export function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  return round(xs.reduce((a, b) => a + b, 0) / xs.length);
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
}

function stat(xs: (number | null)[]): Stat {
  const v = xs.filter((x): x is number => x !== null);
  return { n: v.length, mean: mean(v), median: median(v) };
}

export function aggregateBlock(label: string, rows: SummarySessionRow[], opts: AggregateOptions): SummaryBlock {
  const completed = rows.filter((r) => r.status === "completed");
  const invalid = rows.filter((r) => r.status === "invalid").length;
  const blinded = rows.filter((r) => r.blind).length;
  const scored = opts.hideBlindScores ? completed.filter((r) => !r.blind) : completed;
  const withQuality = opts.hideBlindScores ? rows.filter((r) => !r.blind) : rows;
  const suppressed = scored.length < opts.minCellN;

  const base = {
    label,
    n: rows.length,
    completed: completed.length,
    invalid,
    started: rows.length - completed.length - invalid,
    blinded,
    suppressed,
  };
  if (suppressed) {
    return { ...base, risk: null, overall: null, level1: null, level2: null, level3: null, quality: null };
  }
  const risk: Record<RiskLevel | "none", number> = { Low: 0, Moderate: 0, High: 0, none: 0 };
  for (const r of scored) {
    if (r.risk_level === "Low" || r.risk_level === "Moderate" || r.risk_level === "High") risk[r.risk_level]++;
    else risk.none++;
  }
  return {
    ...base,
    risk,
    overall: stat(scored.map((r) => num(r.overall_score))),
    level1: stat(scored.map((r) => num(r.level1_score))),
    level2: stat(scored.map((r) => num(r.level2_score))),
    level3: stat(scored.map((r) => num(r.level3_score))),
    quality: stat(withQuality.map((r) => num(r.quality_score))),
  };
}

/**
 * Per site and in total. Rows of orgs not in `sites` are dropped (defence in depth: the query already filters).
 * `includeTotal` is false when the caller is a non-lead site (it sees only its own block).
 */
export function aggregateStudy(
  rows: SummarySessionRow[],
  sites: { orgId: string; label: string }[],
  opts: AggregateOptions & { includeTotal: boolean },
): StudySummary {
  const allowed = new Set(sites.map((s) => s.orgId));
  const kept = rows.filter((r) => allowed.has(r.org_id));
  return {
    sites: sites.map((s) => ({
      orgId: s.orgId,
      ...aggregateBlock(
        s.label,
        kept.filter((r) => r.org_id === s.orgId),
        opts,
      ),
    })),
    total: opts.includeTotal ? aggregateBlock("รวม / Total", kept, opts) : null,
  };
}
