/**
 * lib/research/gaze/regression.ts
 * =================================
 * Small, dependency-free ridge regression used to map eye/head features to a
 * screen position. Features are standardised and two independent models are
 * fitted: one for x and one for y.
 *
 * Designs:
 * - "compact" (default, calibration v3): x from [eye-x, head yaw, face x], y from
 *   [eye-y, head pitch, face y] — 4 numbers per axis. A child calibration has only
 *   5–9 target positions; the old 13-term "full" design fitted those few positions
 *   by leaning on incidental head movement and then missed new positions badly.
 * - "full" (v1/v2): intercept, eye terms with 2nd-order products, every head term.
 *   Kept so calibrations saved by the previous version still load.
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
  /** Head rotation from MediaPipe's facial transformation matrix (radians; 0 if unavailable). */
  yaw: number;
  pitch: number;
}

export const FEATURE_KEYS = ["ex", "ey", "hx", "hy", "px", "py", "s", "yaw", "pitch"] as const;

export type GazeDesign = "eyes" | "compact" | "compact_int" | "full";

/** Designs tried by fitBestModel(), simplest first. */
export const CANDIDATE_DESIGNS: readonly GazeDesign[] = ["eyes", "compact", "compact_int"];

export interface GazeModel {
  /** Missing on records saved before v3 (= "full"). */
  design?: GazeDesign;
  mean: number[];
  std: number[];
  coefX: number[];
  coefY: number[];
}

function toArray(f: FeatureVector): number[] {
  return FEATURE_KEYS.map((k) => f[k]);
}

function designRow(z: number[]): number[] {
  const [ex, ey, hx, hy, px, py, s, yaw, pitch] = z;
  return [1, ex, ey, ex * ex, ey * ey, ex * ey, hx, hy, px, py, s, yaw, pitch];
}

/** Compact design rows: horizontal and vertical terms kept apart (z = standardised features). */
function compactRows(z: number[]): { x: number[]; y: number[] } {
  const [ex, ey, , , px, py, , yaw, pitch] = z;
  return { x: [1, ex, yaw, px], y: [1, ey, pitch, py] };
}

function rowsFor(design: GazeDesign, z: number[]): { x: number[]; y: number[] } {
  if (design === "compact") return compactRows(z);
  const [ex, ey, , , px, py, , yaw, pitch] = z;
  // Eyes only, with the eye-x × eye-y term: looking down shrinks the iris's sideways offset (seen in real
  // data), so x depends on ey too. Best when the head stays still.
  if (design === "eyes") return { x: [1, ex, ey, ex * ey], y: [1, ey, ex, ex * ey] };
  if (design === "compact_int") return { x: [1, ex, ey, ex * ey, yaw, px], y: [1, ey, ex, ex * ey, pitch, py] };
  const r = designRow(z);
  return { x: r, y: r };
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
  design: GazeDesign = "compact",
): GazeModel {
  if (samples.length < 20) throw new Error("Not enough calibration samples (face not visible?).");
  const raw = samples.map((s) => toArray(s.features));
  const k = FEATURE_KEYS.length;
  const mean = new Array<number>(k).fill(0);
  const std = new Array<number>(k).fill(0);
  for (const r of raw) r.forEach((v, j) => (mean[j] += v / raw.length));
  for (const r of raw) r.forEach((v, j) => (std[j] += (v - mean[j]) ** 2 / raw.length));
  for (let j = 0; j < k; j++) std[j] = Math.sqrt(std[j]) || 1;

  const rows = raw.map((r) => rowsFor(design, r.map((v, j) => (v - mean[j]) / std[j])));
  const coefX = ridge(rows.map((r) => r.x), samples.map((s) => s.x), lambda);
  const coefY = ridge(rows.map((r) => r.y), samples.map((s) => s.y), lambda);
  return { design, mean, std, coefX, coefY };
}

export function predictGaze(model: GazeModel, f: FeatureVector): { x: number; y: number } {
  const z = toArray(f).map((v, j) => (v - model.mean[j]) / model.std[j]);
  const rows = rowsFor(model.design ?? "full", z);
  let x = 0;
  let y = 0;
  for (let i = 0; i < rows.x.length; i++) x += rows.x[i] * model.coefX[i];
  for (let i = 0; i < rows.y.length; i++) y += rows.y[i] * model.coefY[i];
  return { x, y };
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Leave-one-point-out error: for each held-out target, fit on the other targets and measure how far the
 * median prediction lands from it (px). Used by child mode instead of extra validation dots, so every dot
 * the child looks at also trains the model.
 */
export function leaveOnePointOut(
  points: { x: number; y: number; features: FeatureVector[] }[],
  lambda: number,
  heldOut: (i: number) => boolean = () => true,
  design: GazeDesign = "compact",
): number[] {
  const errors: number[] = [];
  points.forEach((p, i) => {
    if (!heldOut(i)) return;
    const train = points.flatMap((q, j) => (j === i ? [] : q.features.map((features) => ({ features, x: q.x, y: q.y }))));
    if (train.length < 20 || !p.features.length) {
      errors.push(Infinity);
      return;
    }
    const m = fitGazeModel(train, lambda, design);
    const preds = p.features.map((f) => predictGaze(m, f));
    errors.push(Math.hypot(median(preds.map((q) => q.x)) - p.x, median(preds.map((q) => q.y)) - p.y));
  });
  return errors;
}

export interface BestModel {
  model: GazeModel;
  design: GazeDesign;
  /** Leave-one-point-out error (px) of the chosen design, per point, in input order. */
  looErrors: number[];
  /** Mean leave-one-out error (px) of every design tried (for the calibration data download). */
  tried: Partial<Record<GazeDesign, number>>;
}

/**
 * Fits each candidate design and keeps the one whose leave-one-point-out error over all points is lowest:
 * a still adult gets the eyes-only model, a child who moves gets the head terms. Falls back to "compact"
 * when every candidate fails.
 */
export function fitBestModel(
  points: { x: number; y: number; features: FeatureVector[] }[],
  lambda: number,
  designs: readonly GazeDesign[] = CANDIDATE_DESIGNS,
): BestModel {
  const tried: Partial<Record<GazeDesign, number>> = {};
  let best: { design: GazeDesign; errs: number[]; mean: number } | null = null;
  for (const design of designs) {
    let errs: number[];
    try {
      errs = leaveOnePointOut(points, lambda, () => true, design);
    } catch {
      continue;
    }
    const finite = errs.filter(Number.isFinite);
    if (finite.length < Math.ceil(points.length / 2)) continue;
    const mean = finite.reduce((a, b) => a + b, 0) / finite.length;
    tried[design] = Math.round(mean);
    if (!best || mean < best.mean) best = { design, errs, mean };
  }
  const design = best?.design ?? "compact";
  const all = points.flatMap((p) => p.features.map((features) => ({ features, x: p.x, y: p.y })));
  return {
    model: fitGazeModel(all, lambda, design),
    design,
    looErrors: best?.errs ?? points.map(() => Infinity),
    tried,
  };
}
