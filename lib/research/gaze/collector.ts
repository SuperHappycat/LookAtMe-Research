"use client";

/**
 * lib/research/gaze/collector.ts
 * ================================
 * Gaze-contingent sample collection for one calibration/validation point.
 *
 * Instead of sampling for a fixed time, samples are accepted only while the eyes are still
 * (fixating). The target is re-animated when the child stops looking, and the point is
 * given up after a time limit so a distracted child doesn't stall the session. This follows
 * infant protocols that advance only after the child has looked at the target for a set time
 * and use attention-getters when the child looks away (Dalrymple et al., 2018).
 */

import { RESEARCH_CONFIG } from "../config";
import { detectFeatures, isBlink } from "./mediapipeEngine";
import { dropOutliers, isFixating } from "./calibrationCore";
import type { FeatureVector } from "./regression";

export interface CollectControls {
  /** Operator pressed "re-attract" (Space). Read once, then cleared by the collector. */
  reattractRequested: { current: boolean };
  /** Operator pressed "skip" (S). Read once, then cleared. */
  skipRequested: { current: boolean };
  paused: { current: boolean };
  cancelled: { current: boolean };
}

export interface CollectOptions {
  samplesNeeded: number;
  reattractAfterMs: number;
  giveUpAfterMs: number;
  grab: () => HTMLCanvasElement | null;
  controls: CollectControls;
  onProgress: (fraction: number) => void;
  onReattract: () => void;
  onFaceVisible: (visible: boolean) => void;
  /** Every detected frame's features (for the face-position hint). Optional. */
  onFrame?: (f: FeatureVector) => void;
}

export interface CollectResult {
  features: FeatureVector[];
  skipped: boolean;
}

const STEP_MS = 50;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function collectFixation(o: CollectOptions): Promise<CollectResult> {
  const recent: FeatureVector[] = [];
  const accepted: FeatureVector[] = [];
  let start = performance.now();
  let lastProgress = start;
  let missed = 0;

  while (!o.controls.cancelled.current) {
    if (o.controls.paused.current) {
      const t = performance.now();
      await sleep(STEP_MS);
      const dt = performance.now() - t;
      start += dt; // pausing doesn't use up the point's time
      lastProgress += dt;
      continue;
    }
    if (o.controls.skipRequested.current) {
      o.controls.skipRequested.current = false;
      return { features: [], skipped: true };
    }
    if (o.controls.reattractRequested.current) {
      o.controls.reattractRequested.current = false;
      o.onReattract();
      lastProgress = performance.now();
    }

    const canvas = o.grab();
    const f = canvas ? detectFeatures(canvas) : null;
    if (f && !isBlink(f)) {
      missed = 0;
      o.onFrame?.(f.features);
      recent.push(f.features);
      if (recent.length > 12) recent.shift();
      if (isFixating(recent, RESEARCH_CONFIG.fixationWindow, RESEARCH_CONFIG.fixationMaxSpread)) {
        accepted.push(f.features);
        lastProgress = performance.now();
        o.onProgress(accepted.length / o.samplesNeeded);
        if (accepted.length >= o.samplesNeeded) return { features: dropOutliers(accepted), skipped: false };
      }
    } else {
      recent.length = 0; // a blink or lost face breaks the fixation
      missed++;
    }
    o.onFaceVisible(missed * STEP_MS < 800);

    const now = performance.now();
    if (now - start > o.giveUpAfterMs) {
      // Enough partial data still helps; too little means the child never looked.
      return accepted.length >= Math.ceil(o.samplesNeeded / 2)
        ? { features: dropOutliers(accepted), skipped: false }
        : { features: [], skipped: true };
    }
    if (now - lastProgress > o.reattractAfterMs) {
      o.onReattract();
      lastProgress = now;
    }
    await sleep(STEP_MS);
  }
  return { features: [], skipped: true };
}
