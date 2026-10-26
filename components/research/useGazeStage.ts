"use client";

/**
 * Drives <CalibrationStage>: shows each target (loom → hold → reward), plays the sounds,
 * collects fixation samples per point, and exposes operator controls.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { RESEARCH_CONFIG } from "@/lib/research/config";
import { collectFixation, type CollectControls, type CollectResult } from "@/lib/research/gaze/collector";
import { facePositionHint, type CalibrationMode } from "@/lib/research/gaze/calibrationCore";
import {
  loadSoundPrefs,
  playChime,
  playReattract,
  playReward,
  saveSoundPrefs,
  type SoundPrefs,
} from "@/lib/research/attentionSound";
import type { StageTarget } from "./CalibrationStage";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LOOM_MS = 900;
const REWARD_MS = 450;

export interface PointResult extends CollectResult {
  fx: number;
  fy: number;
  x: number;
  y: number;
}

export function useGazeStage(grab: () => HTMLCanvasElement | null) {
  const [target, setTarget] = useState<StageTarget | null>(null);
  const [status, setStatus] = useState("");
  const [faceVisible, setFaceVisible] = useState(true);
  const [positionHint, setPositionHint] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [sound, setSoundState] = useState<SoundPrefs>({ on: true, volume: 0.4 });
  const soundRef = useRef(sound);
  const controlsRef = useRef<CollectControls>({
    reattractRequested: { current: false },
    skipRequested: { current: false },
    paused: { current: false },
    cancelled: { current: false },
  });

  useEffect(() => {
    const p = loadSoundPrefs();
    soundRef.current = p;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is browser-only
    setSoundState(p);
  }, []);

  const setSound = useCallback((p: SoundPrefs) => {
    soundRef.current = p;
    setSoundState(p);
    saveSoundPrefs(p);
  }, []);

  const togglePause = useCallback(() => {
    const c = controlsRef.current;
    c.paused.current = !c.paused.current;
    setPaused(c.paused.current);
  }, []);

  const cancel = useCallback(() => {
    controlsRef.current.cancelled.current = true;
  }, []);

  const isCancelled = useCallback(() => controlsRef.current.cancelled.current, []);
  const requestReattract = useCallback(() => {
    controlsRef.current.reattractRequested.current = true;
  }, []);
  const requestSkip = useCallback(() => {
    controlsRef.current.skipRequested.current = true;
  }, []);

  const resetControls = useCallback(() => {
    const c = controlsRef.current;
    c.cancelled.current = false;
    c.paused.current = false;
    c.skipRequested.current = false;
    c.reattractRequested.current = false;
    setPaused(false);
  }, []);

  /** Runs one point: loom in with a chime, collect a fixation, small reward. */
  const runPoint = useCallback(
    async (fx: number, fy: number, index: number, mode: CalibrationMode, samplesNeeded: number, label: string) => {
      const m = RESEARCH_CONFIG.modes[mode];
      const x = fx * window.innerWidth;
      const y = fy * window.innerHeight;
      setStatus(label);
      setTarget({ x, y, index, phase: "loom", progress: 0 });
      playChime(index, soundRef.current);
      await sleep(mode === "child" ? LOOM_MS : 350);
      setTarget({ x, y, index, phase: "hold", progress: 0 });
      const res = await collectFixation({
        samplesNeeded,
        reattractAfterMs: m.reattractAfterMs,
        giveUpAfterMs: m.giveUpAfterMs,
        grab,
        controls: controlsRef.current,
        onProgress: (p) => setTarget({ x, y, index, phase: "hold", progress: p }),
        onReattract: () => {
          playReattract(soundRef.current);
          setTarget((t) => (t ? { ...t, phase: "reattract" } : t));
          setTimeout(() => setTarget((t) => (t && t.phase === "reattract" ? { ...t, phase: "hold" } : t)), 1200);
        },
        onFaceVisible: setFaceVisible,
        onFrame: (f) => {
          const h = facePositionHint(f);
          setPositionHint((prev) => (prev === h ? prev : h));
        },
      });
      if (!res.skipped) {
        setTarget({ x, y, index, phase: "reward", progress: 1 });
        playReward(soundRef.current);
        await sleep(mode === "child" ? REWARD_MS : 150);
      }
      return { ...res, fx, fy, x, y } as PointResult;
    },
    [grab],
  );

  const warning = !faceVisible ? "มองไม่เห็นใบหน้า ขยับให้อยู่หน้ากล้อง / Face not visible" : positionHint;

  return {
    target,
    setTarget,
    status,
    setStatus,
    warning,
    paused,
    togglePause,
    sound,
    setSound,
    requestReattract,
    requestSkip,
    isCancelled,
    cancel,
    resetControls,
    runPoint,
  };
}
