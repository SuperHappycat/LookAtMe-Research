/**
 * lib/research/gaze/regression.ts
 * =================================
 * Small, dependency-free ridge regression used to map eye/head features to a
 * screen position. Features are standardised, expanded into a design row
 * (intercept, eye terms with 2nd-order products, linear head terms), and two
 * independent models are fitted: one for x and one for y.
 */

export interface FeatureVector {
  /** Eye-in-socket offsets (averaged over both eyes), along and across the eye axis. */
  ex: number;
  ey: number;
  /** Head turn / tilt proxies. */
  hx: number;
  hy: number;
  /** Face position in the camera frame (0..1) and apparent size. */
  px: number;
  py: number;
  s: number;
}

export const FEATURE_KEYS = ["ex", "ey", "hx", "hy", "px", "py", "s"] as const;

export interface GazeModel {
  mean: number[];
  std: number[];
  coefX: number[];
  coefY: number[];
}

function toArray(f: FeatureVector): number[] {
  return FEATURE_KEYS.map((k) => f[k]);
}

function designRow(z: number[]): number[] {
  const [ex, ey, hx, hy, px, py, s] = z;
  return [1, ex, ey, ex * ex, ey * ey, ex * ey, hx, hy, px, py, s];
}

/** Solves A x = b by Gaussian elimination with partial pivoting. */
export function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) throw new Error("Calibration data is degenerate (singular matrix).");
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

function ridge(X: number[][], y: number[], lambda: number): number[] {
  const p = X[0].length;
  const XtX = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const Xty = new Array<number>(p).fill(0);
  for (let i = 0; i < X.length; i++) {
    const row = X[i];
    for (let a = 0; a < p; a++) {
      Xty[a] += row[a] * y[i];
      for (let b = 0; b < p; b++) XtX[a][b] += row[a] * row[b];
    }
  }
  // Do not penalise the intercept (column 0).
  for (let a = 1; a < p; a++) XtX[a][a] += lambda * X.length;
  return solveLinear(XtX, Xty);
}

export function fitGazeModel(
  samples: { features: FeatureVector; x: number; y: number }[],
  lambda: number,
): GazeModel {
  if (samples.length < 20) throw new Error("Not enough calibration samples (face not visible?).");
  const raw = samples.map((s) => toArray(s.features));
  const k = FEATURE_KEYS.length;
  const mean = new Array<number>(k).fill(0);
  const std = new Array<number>(k).fill(0);
  for (const r of raw) r.forEach((v, j) => (mean[j] += v / raw.length));
  for (const r of raw) r.forEach((v, j) => (std[j] += (v - mean[j]) ** 2 / raw.length));
  for (let j = 0; j < k; j++) std[j] = Math.sqrt(std[j]) || 1;

  const X = raw.map((r) => designRow(r.map((v, j) => (v - mean[j]) / std[j])));
  const coefX = ridge(X, samples.map((s) => s.x), lambda);
  const coefY = ridge(X, samples.map((s) => s.y), lambda);
  return { mean, std, coefX, coefY };
}

export function predictGaze(model: GazeModel, f: FeatureVector): { x: number; y: number } {
  const z = toArray(f).map((v, j) => (v - model.mean[j]) / model.std[j]);
  const row = designRow(z);
  let x = 0;
  let y = 0;
  for (let i = 0; i < row.length; i++) {
    x += row[i] * model.coefX[i];
    y += row[i] * model.coefY[i];
  }
  return { x, y };
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
