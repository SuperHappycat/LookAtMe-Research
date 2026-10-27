"use client";

/**
 * components/Test1Client.tsx
 * ============================
 * Web port of gui/test1.py (Human vs Geometric preference), the first
 * of the three tests in the full screening flow: Home -> Intake ->
 * Test1 -> Test2 -> Test3 -> Summary. Patient info is collected once on
 * the Intake page (see lib/sessionState.ts); this page just requires a
 * patient already be in session storage, same as the desktop app
 * requiring `app.current_patient` be set before Test 1 can run.
 *
 * Deliberately has NO bounding boxes drawn on any video -- the desktop
 * app's debug overlays (face/eye rectangles, AOI zone boxes) are left
 * out here by request. See hooks/useGazeTestRunner.ts for the shared
 * webcam/worker/timer machinery this builds on.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "@/styles/shared.module.css";
import { useGazeTestRunner, CAPTURE_W, CAPTURE_H, DETECTION_INTERVAL_MS, type WorkerSample } from "@/hooks/useGazeTestRunner";
import {
  mapDirectionToRegion,
  finalizeTest1Results,
  type Test1Region,
  type Test1Results as ScoredTest1Results,
} from "@/lib/vision/test1Scoring";
import { getSession, saveTest1Results } from "@/lib/sessionState";
import { getGazeEngine } from "@/lib/research/gaze";

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

export default function Test1Client() {
  const router = useRouter();
  // Set once on mount from sessionStorage (a browser-only API) -- can't
  // be read during the initial render because this component's first
  // render also runs on the server, where sessionStorage doesn't exist.
  const [patientState, setPatientState] = useState<PatientState>("checking");
  const [humanSide, setHumanSide] = useState<"left" | "right">("left");
  const [results, setResults] = useState<ScoredTest1Results | null>(null);

  const humanVideoRef = useRef<HTMLVideoElement | null>(null);
  const geoVideoRef = useRef<HTMLVideoElement | null>(null);
  const webcamVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const regionLogRef = useRef<Test1Region[]>([]);
  const humanSideRef = useRef<"left" | "right">("left");

  useEffect(() => {
    // sessionStorage doesn't exist during this component's server render,
    // so the "checking" state above has to be the universal first-render
    // output on both server and client (avoiding a hydration mismatch);
    // this effect reads the real value right after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPatientState(getSession().patient ? "ok" : "missing");
  }, []);

  const handleSample = useCallback((sample: WorkerSample) => {
    regionLogRef.current.push(mapDirectionToRegion(sample.direction, humanSideRef.current));
  }, []);

  const handleStop = useCallback(() => {
    const finalResults = finalizeTest1Results(regionLogRef.current, DETECTION_INTERVAL_MS);
    setResults(finalResults);
    saveTest1Results({ ...finalResults, humanSide: humanSideRef.current });
  }, []);

  const runner = useGazeTestRunner({
    testDurationMs: TEST_DURATION_MS,
    videoRefs: [humanVideoRef, geoVideoRef],
    webcamVideoRef,
    previewCanvasRef,
    onSample: handleSample,
    onStop: handleStop,
  });

  const phase = computeDisplayPhase(patientState, runner.workerStatus, runner.running, results !== null);

  const handleStart = useCallback(async () => {
    setResults(null);
    const side: "left" | "right" = Math.random() < 0.5 ? "left" : "right";
    setHumanSide(side);
    humanSideRef.current = side;
    regionLogRef.current = [];
    await runner.start();
  }, [runner]);

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>แบบทดสอบที่ 1 — ความสนใจคนกับรูปทรง / Test 1 — Human vs Geometric Preference</h1>
      <p className={styles.subtitle}>
        ระบบคำนวณการมองในเครื่องนี้ ภาพจากกล้องไม่ถูกส่งออกไป จะบันทึกวิดีโอหน้าจอ (ใบหน้าเบลอ) เฉพาะเมื่อผู้ปกครองยินยอม
        <br />
        Gaze is computed on this device; the camera picture is not sent anywhere. A screen recording (face pixelated) is
        saved only if the parent agreed.
      </p>

      {phase === "no_patient" && (
        <div className={styles.card}>
          <p className={styles.errorText}>ไม่พบข้อมูลผู้รับการทดสอบ / No patient info found for this session.</p>
          <div className={styles.saveRow}>
            <button className={styles.primaryButton} onClick={() => router.push("/intake")}>
              ไปที่หน้าเลือกเด็ก / Go to Patient Intake
            </button>
          </div>
        </div>
      )}

      {phase === "checking" && <div className={styles.card}>กำลังโหลด… / Loading…</div>}

      {phase === "loading" && (
        <div className={styles.card}>กำลังโหลดระบบตรวจจับใบหน้า… / Loading the in-browser vision engine…</div>
      )}

      {phase === "load_error" && (
        <div className={styles.card}>
          <p className={styles.errorText}>โหลดระบบไม่สำเร็จ / Failed to load the vision engine: {runner.loadError}</p>
        </div>
      )}

      {phase === "ready" && (
        <div className={styles.card} style={{ textAlign: "center" }}>
          <button className={styles.primaryButton} onClick={handleStart}>
            เริ่มทดสอบ / Start Test (20s)
          </button>
          {getGazeEngine().name === "mediapipe" && (
            <button
              className={styles.secondaryButton}
              style={{ marginLeft: 10 }}
              onClick={() => router.push("/r/gaze-check?from=test1")}
            >
              ดูว่ามองตรงไหน / See where they look
            </button>
          )}
          {runner.cameraError && (
            <p className={styles.errorText} style={{ marginTop: 12, marginBottom: 0 }}>
              {runner.cameraError}
            </p>
          )}
        </div>
      )}

      {/* Rendered unconditionally (just off-screen outside "running") so
          both refs are already attached to real <video> elements before
          the user clicks "Start Test" -- that's what lets runner.start()
          call .play() synchronously within the click's gesture, which is
          what browsers require to allow autoplay *with sound*.

          Each <video> keeps a FIXED ref+src for its whole lifetime here;
          only its visual left/right slot changes (via CSS `order`) when
          humanSide is randomized. Swapping which ref/src went to which
          JSX position (the previous approach) made React reuse the same
          DOM node but rewrite its `src` attribute on the post-click
          re-render -- which aborts whatever had just started playing,
          so sound only "worked" on the ~50% of runs where the random
          side happened to match the default. */}
      <div className={phase === "running" ? styles.videoRow : `${styles.videoRow} ${styles.videoRowOffscreen}`}>
        <div style={{ flex: "1 1 480px", maxWidth: 760, order: humanSide === "left" ? 0 : 1 }}>
          <div className={styles.videoLabel}>คน / Human</div>
          <div className={styles.videoPanel}>
            <video ref={humanVideoRef} src="/videos/human.mp4" loop playsInline />
          </div>
        </div>
        <div style={{ flex: "1 1 480px", maxWidth: 760, order: humanSide === "left" ? 1 : 0 }}>
          <div className={styles.videoLabel}>รูปทรง / Geometric</div>
          <div className={styles.videoPanel}>
            <video ref={geoVideoRef} src="/videos/geometric.mp4" loop playsInline />
          </div>
        </div>
      </div>

      {phase === "running" && (
        <div className={styles.timer}>เหลือเวลา / Time remaining: {Math.ceil(runner.remainingSec)}s</div>
      )}

      {phase === "running" && runner.paused && (
        <p className={styles.timer} style={{ color: "var(--warning)" }}>
          ⏸ หยุดชั่วคราว รอให้เด็กกลับมามองจอ / Paused — waiting for the child to look back
        </p>
      )}

      {phase === "running" && runner.soundBlocked && (
        <p className={styles.errorText} style={{ textAlign: "center" }}>
          เบราว์เซอร์ปิดเสียงไว้ คลิกที่ใดก็ได้บนหน้าเพื่อเปิดเสียง · Your browser blocked autoplay with sound — click anywhere on the page to enable it.
        </p>
      )}

      {phase === "done" && results && (
        <div className={styles.card}>
          <h2 style={{ marginTop: 0 }}>ผล / Results</h2>
          <div className={styles.resultsGrid}>
            <div className={styles.statTile}>
              <div className={styles.statValue}>{results.humanPct.toFixed(0)}%</div>
              <div className={styles.statLabel}>คน / Human</div>
            </div>
            <div className={styles.statTile}>
              <div className={styles.statValue}>{results.geometricPct.toFixed(0)}%</div>
              <div className={styles.statLabel}>รูปทรง / Geometric</div>
            </div>
            <div className={styles.statTile}>
              <div className={styles.statValue}>{results.switches}</div>
              <div className={styles.statLabel}>สลับการมอง / Gaze Switches</div>
            </div>
            <div className={styles.statTile}>
              <div className={styles.statValue}>{results.avgFixationMs.toFixed(0)} ms</div>
              <div className={styles.statLabel}>มองนานเฉลี่ย / Avg Fixation</div>
            </div>
          </div>

          <div className={styles.saveRow}>
            <button className={styles.primaryButton} onClick={() => router.push("/test2")}>
              ถัดไป: แบบทดสอบที่ 2 / Next: Test 2 →
            </button>
            <button className={styles.secondaryButton} onClick={handleStart}>
              ทำอีกครั้ง / Run Again
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
