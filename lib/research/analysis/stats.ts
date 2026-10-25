/**
 * lib/research/analysis/stats.ts
 * ================================
 * Small descriptive statistics helpers (no dependencies). Every function
 * ignores null / non-finite values and returns null when nothing is left.
 */

export function clean(values: readonly (number | null | undefined)[]): number[] {
  return values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

export function mean(values: readonly (number | null | undefined)[]): number | null {
  const v = clean(values);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Sample standard deviation (n − 1), as SPSS and R's sd() report it. Null for n < 2. */
export function sd(values: readonly (number | null | undefined)[]): number | null {
  const v = clean(values);
  if (v.length < 2) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
}

/** Quantile by linear interpolation between order statistics (R type 7, the default of quantile()). */
export function quantile(values: readonly (number | null | undefined)[], p: number): number | null {
  const v = clean(values).sort((a, b) => a - b);
  if (!v.length) return null;
  const h = (v.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return v[lo] + (h - lo) * (v[hi] - v[lo]);
}

export const median = (values: readonly (number | null | undefined)[]) => quantile(values, 0.5);

export interface Describe {
  n: number;
  mean: number | null;
  sd: number | null;
  median: number | null;
  q1: number | null;
  q3: number | null;
  min: number | null;
  max: number | null;
}

export function describe(values: readonly (number | null | undefined)[]): Describe {
  const v = clean(values);
  return {
    n: v.length,
    mean: mean(v),
    sd: sd(v),
    median: quantile(v, 0.5),
    q1: quantile(v, 0.25),
    q3: quantile(v, 0.75),
    min: v.length ? Math.min(...v) : null,
    max: v.length ? Math.max(...v) : null,
  };
}

/**
 * Percentile rank of x within a reference group (mid-rank definition):
 * (number below + half the number equal) / n × 100. Null when the group is empty.
 */
export function percentileRank(reference: readonly (number | null | undefined)[], x: number): number | null {
  const v = clean(reference);
  if (!v.length) return null;
  let below = 0;
  let equal = 0;
  for (const r of v) {
    if (r < x) below++;
    else if (r === x) equal++;
  }
  return ((below + equal / 2) / v.length) * 100;
}

/** Rounds for display; "—" for null. */
export function fmt(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(digits);
}
