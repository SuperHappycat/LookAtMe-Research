"use client";

/**
 * components/Test3Client.tsx
 * ============================
 * Web port of gui/test3.py (Block vs Face joint attention). Same
 * shared runner as Test 1/2, single stimulus panel (rja.mp4, two
 * children), phase-gated scoring via lib/vision/test3Scoring.ts. Last
 * test in the flow -- finishing navigates to /summary.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "@/styles/shared.module.css";
import {
  useGazeTestRunner,
  CAPTURE_W,
  CAPTURE_H,
  DETECTION_INTERVAL_MS,
  type WorkerSample,
} from "@/hooks/useGazeTestRunner";
import {
  mapTest3Region,
  finalizeTest3Results,
  TEST3_PHASE1_END_SEC,
  type Test3Region,
  type Test3Results as ScoredTest3Results,
} from "@/lib/vision/test3Scoring";
import { getSession, saveTest3Results } from "@/lib/sessionState";

const TEST_DURATION_MS = 20000;

type PatientState = "checking" | "ok" | "missing";
type DisplayPhase = "checking" | "no_patient" | "loading" | "load_error" | "ready" | "running" | "done";

function computeDisplayPhase(
  patientState: PatientState,
  workerStatus: "loading" | "ready" | "error",
  running: boolean,
  hasResults: boolean,
): DisplayPhase {
  if (patientState === "checking") return "checking";
  if (patientState === "missing") return "no_patient";
  if (workerStatus === "error") return "load_error";
  if (workerStatus === "loading") return "loading";
  if (running) return "running";
  if (hasResults) return "done";
  return "ready";
}

export default function Test3Client() {
  const router = useRouter();
  const [patientState, setPatientState] = useState<PatientState>("checking");
  const [results, setResults] = useState<ScoredTest3Results | null>(null);

  const stimVideoRef = useRef<HTMLVideoElement | null>(null);
  const webcamVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const regionLogRef = useRef<Test3Region[]>([]);

  useEffect(() => {
    // sessionStorage doesn't exist during this component's server render,
    // so the "checking" state above has to be the universal first-render
    // output on both server and client (avoiding a hydration mismatch);
    // this effect reads the real value right after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPatientState(getSession().patient ? "ok" : "missing");
  }, []);

  const handleSample = useCallback((sample: WorkerSample, videoPosSec: number) => {
    regionLogRef.current.push(mapTest3Region(sample.direction, sample.eyesDetected, videoPosSec));
  }, []);

  const handleStop = useCallback(() => {
    const finalResults = finalizeTest3Results(regionLogRef.current, DETECTION_INTERVAL_MS);
    setResults(finalResults);
    saveTest3Results(finalResults);
  }, []);

  const runner = useGazeTestRunner({
    testDurationMs: TEST_DURATION_MS,
    videoRefs: [stimVideoRef],
    webcamVideoRef,
    previewCanvasRef,
    onSample: handleSample,
    onStop: handleStop,
  });

  const phase = computeDisplayPhase(patientState, runner.workerStatus, runner.running, results !== null);

  const handleStart = useCallback(async () => {
    setResults(null);
    regionLogRef.current = [];
    await runner.start();
  }, [runner]);

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Test 3 — Block vs Face Joint Attention</h1>
      <p className={styles.subtitle}>
        First {TEST3_PHASE1_END_SEC.toFixed(0)}s: is the child looking at the blocks being played with?
        After that: is the child looking at the children&apos;s faces?
      </p>

      {phase === "no_patient" && (
        <div className={styles.card}>
          <p className={styles.errorText}>No patient info found for this session.</p>
          <div className={styles.saveRow}>
            <button className={styles.primaryButton} onClick={() => router.push("/intake")}>
              Go to Patient Intake
            </button>
          </div>
        </div>
      )}

      {phase === "checking" && <div className={styles.card}>Loading…</div>}
      {phase === "loading" && (
        <div className={styles.card}>Loading the in-browser vision engine (OpenCV.js)…</div>
      )}
      {phase === "load_error" && (
        <div className={styles.card}>
          <p className={styles.errorText}>Failed to load the vision engine: {runner.loadError}</p>
        </div>
      )}

      {phase === "ready" && (
        <div className={styles.card} style={{ textAlign: "center" }}>
          <button className={styles.primaryButton} onClick={handleStart}>
            Start Test (20s)
          </button>
          {runner.cameraError && (
            <p className={styles.errorText} style={{ marginTop: 12, marginBottom: 0 }}>
              {runner.cameraError}
            </p>
          )}
        </div>
      )}

      {/* Rendered unconditionally (just hidden outside "running") so the
          ref is already attached to a real <video> element before the user
          clicks "Start Test" -- that's what lets runner.start() call
          .play() synchronously within the click's gesture, which is what
          browsers require to allow autoplay *with sound*. */}
      <div className={phase === "running" ? styles.videoRow : `${styles.videoRow} ${styles.videoRowOffscreen}`}>
        <div className={styles.videoPanelSingle}>
          <video ref={stimVideoRef} src="/videos/rja.mp4" loop playsInline />
        </div>
      </div>

      {phase === "running" && (
        <div className={styles.timer}>Time remaining: {Math.ceil(runner.remainingSec)}s</div>
      )}

      {phase === "running" && runner.soundBlocked && (
        <p className={styles.errorText} style={{ textAlign: "center" }}>
          Your browser blocked autoplay with sound — click anywhere on the page to enable it.
        </p>
      )}

      {phase === "done" && results && (
        <div className={styles.card}>
          <h2 style={{ marginTop: 0 }}>Results</h2>
          <div className={styles.resultsGrid}>
            <div className={styles.statTile}>
              <div className={styles.statValue}>{results.blockPct.toFixed(0)}%</div>
              <div className={styles.statLabel}>Block</div>
            </div>
            <div className={styles.statTile}>
              <div className={styles.statValue}>{results.facePct.toFixed(0)}%</div>
              <div className={styles.statLabel}>Face</div>
            </div>
            <div className={styles.statTile}>
              <div className={styles.statValue}>{results.accuracyPct.toFixed(0)}%</div>
              <div className={styles.statLabel}>Accuracy</div>
            </div>
            <div className={styles.statTile}>
              <div className={styles.statValue}>
                {results.latencyMs !== null ? `${results.latencyMs.toFixed(0)} ms` : "No follow"}
              </div>
              <div className={styles.statLabel}>Latency to Face</div>
            </div>
          </div>

          <div className={styles.saveRow}>
            <button className={styles.primaryButton} onClick={() => router.push("/summary")}>
              Next: Summary →
            </button>
            <button className={styles.secondaryButton} onClick={handleStart}>
              Run Again
            </button>
          </div>
        </div>
      )}

      {phase === "running" && (
        <div className={styles.cornerPreviewWrap}>
          {runner.liveStatus && (
            <div className={styles.statusText}>
              Gaze: {runner.liveStatus.direction} • Eyes: {runner.liveStatus.eyesDetected ? "Yes" : "No"} • Conf:{" "}
              {runner.liveStatus.confidence.toFixed(2)}
            </div>
          )}
          <canvas ref={previewCanvasRef} width={CAPTURE_W} height={CAPTURE_H} className={styles.previewCanvas} />
        </div>
      )}

      <video ref={webcamVideoRef} className={styles.hiddenVideo} muted playsInline />
    </div>
  );
}
