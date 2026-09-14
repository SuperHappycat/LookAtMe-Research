/**
 * lib/vision/gazeEstimator.ts
 * ============================
 * Port of vision/gaze_estimation.py's GazeEstimator: median-filters the
 * raw per-frame pupil position (rejects single-frame outliers like a
 * blink transition), smooths with an EMA, and classifies Left/Center/
 * Right -- self-calibrated to this session's own observed left-right
 * pupil range once it's spread out enough, falling back to fixed
 * configured thresholds before that. No head-pose fusion (the Python
 * version computes head pose but never uses it for classification
 * either -- it's fine to leave out here).
 */

import type { EyesResult, GaugeState, GazeDirection, GazeSample } from "./types";

export interface GazeEstimatorOptions {
  leftThreshold?: number;
  rightThreshold?: number;
  smoothingAlpha?: number;
  medianWindow?: number;
  minCalibrationSpread?: number;
  centerBandFrac?: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export class GazeEstimator {
  private leftThreshold: number;
  private rightThreshold: number;
  private alpha: number;
  private medianWindow: number;
  private minCalibrationSpread: number;
  private centerBandFrac: number;

  private smoothedX: number | null = null;
  private smoothedY: number | null = null;
  private rawXWindow: number[] = [];
  private rawYWindow: number[] = [];
  private observedMinX: number | null = null;
  private observedMaxX: number | null = null;

  constructor(options: GazeEstimatorOptions = {}) {
    this.leftThreshold = options.leftThreshold ?? 0.4;
    this.rightThreshold = options.rightThreshold ?? 0.6;
    this.alpha = options.smoothingAlpha ?? 0.35;
    this.medianWindow = Math.max(1, options.medianWindow ?? 5);
    this.minCalibrationSpread = options.minCalibrationSpread ?? 0.08;
    this.centerBandFrac = options.centerBandFrac ?? 0.35;
  }

  update(eyesResult: EyesResult): GazeSample {
    const now = performance.now() / 1000;

    if (!eyesResult.eyesDetected || eyesResult.observations.length === 0) {
      return {
        timestamp: now, direction: "Unknown", screenX: null, screenY: null,
        eyesDetected: false, confidence: 0,
      };
    }

    const validPupils = eyesResult.observations
      .map((o) => o.pupilNorm)
      .filter((p): p is [number, number] => p !== null);

    if (validPupils.length === 0) {
      return {
        timestamp: now, direction: "Unknown", screenX: null, screenY: null,
        eyesDetected: true, confidence: 0.2,
      };
    }

    const avgX = validPupils.reduce((s, p) => s + p[0], 0) / validPupils.length;
    const avgY = validPupils.reduce((s, p) => s + p[1], 0) / validPupils.length;

    this.rawXWindow = [...this.rawXWindow, avgX].slice(-this.medianWindow);
    this.rawYWindow = [...this.rawYWindow, avgY].slice(-this.medianWindow);
    const denoisedX = median(this.rawXWindow);
    const denoisedY = median(this.rawYWindow);

    this.smoothedX = this.smoothedX === null
      ? denoisedX : this.alpha * denoisedX + (1 - this.alpha) * this.smoothedX;
    this.smoothedY = this.smoothedY === null
      ? denoisedY : this.alpha * denoisedY + (1 - this.alpha) * this.smoothedY;

    if (this.observedMinX === null || this.smoothedX < this.observedMinX) this.observedMinX = this.smoothedX;
    if (this.observedMaxX === null || this.smoothedX > this.observedMaxX) this.observedMaxX = this.smoothedX;

    const direction = this.classify(this.smoothedX);
    const confidence = validPupils.length === 2 ? 1.0 : 0.6;

    return {
      timestamp: now,
      direction,
      screenX: this.smoothedX,
      screenY: this.smoothedY,
      eyesDetected: true,
      confidence,
    };
  }

  private domain(): [number, number, boolean] {
    if (
      this.observedMinX !== null && this.observedMaxX !== null &&
      this.observedMaxX - this.observedMinX >= this.minCalibrationSpread
    ) {
      return [this.observedMinX, this.observedMaxX, true];
    }
    const band = Math.max(this.rightThreshold - this.leftThreshold, 1e-6);
    return [this.leftThreshold - band, this.rightThreshold + band, false];
  }

  private relative(normX: number, lo: number, hi: number): number {
    const spread = hi > lo ? hi - lo : 1.0;
    return Math.max(0, Math.min(1, (normX - lo) / spread));
  }

  private classify(normX: number): GazeDirection {
    const [lo, hi, calibrated] = this.domain();
    if (calibrated) {
      const relative = this.relative(normX, lo, hi);
      const low = (1 - this.centerBandFrac) / 2;
      const high = 1 - low;
      if (relative < low) return "Left";
      if (relative > high) return "Right";
      return "Center";
    }
    if (normX < this.leftThreshold) return "Left";
    if (normX > this.rightThreshold) return "Right";
    return "Center";
  }

  gaugeState(): GaugeState | null {
    if (this.smoothedX === null) return null;
    const [lo, hi, calibrated] = this.domain();
    const value = this.relative(this.smoothedX, lo, hi);
    let zoneLow: number;
    let zoneHigh: number;
    if (calibrated) {
      zoneLow = (1 - this.centerBandFrac) / 2;
      zoneHigh = 1 - zoneLow;
    } else {
      zoneLow = this.relative(this.leftThreshold, lo, hi);
      zoneHigh = this.relative(this.rightThreshold, lo, hi);
    }
    return { value, zoneLow, zoneHigh };
  }

  reset(): void {
    this.smoothedX = null;
    this.smoothedY = null;
    this.rawXWindow = [];
    this.rawYWindow = [];
    this.observedMinX = null;
    this.observedMaxX = null;
  }
}
