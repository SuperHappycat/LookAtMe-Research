"use client";

/**
 * components/research/CalibrationClient.tsx
 * ===========================================
 * 9-dot gaze calibration for the MediaPipe engine (Research app only).
 *
 * 1. The child follows a dot to 9 places; for each place we collect eye and
 *    head features from the webcam (blinks and no-face frames skipped).
 * 2. A ridge regression maps features -> screen position (viewport px).
 * 3. 4 extra dots measure accuracy (mean error in px).
 * 4. Pass if error <= RESEARCH_CONFIG.maxCalibrationErrorPx (TBD value).
 *    Recalibration is offered up to maxRecalibrations times, then the user
 *    may continue with a "low accuracy" flag.
 *
 * Uses the same mirrored 640×480 capture canvas as the test runner, so the
 * fitted mapping matches what the tests feed the engine.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "@/styles/shared.module.css";
import rs from "@/styles/research.module.css";
import { CAPTURE_W, CAPTURE_H } from "@/hooks/useGazeTestRunner";
import { RESEARCH_CONFIG } from "@/lib/research/config";
import { getGazeEngine } from "@/lib/research/gaze";
import { detectFeatures, isBlink } from "@/lib/research/gaze/mediapipeEngine";
import { fitGazeModel, median, predictGaze, type FeatureVector, type GazeModel } from "@/lib/research/gaze/regression";
import { getCalibrationState, saveCalibration, type CalibrationRecord } from "@/lib/research/gaze/calibrationStore";

type Phase = "intro" | "loading" | "running" | "fitting" | "result" | "error";

interface DotState {
  x: number;
  y: number;
  collecting: boolean;
  label: string;
}

const SAMPLE_EVERY_MS = 50;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function CalibrationClient() {
  const router = useRouter();
  const engine = getGazeEngine();
  const [phase, setPhase] = useState<Phase>("intro");
  const [error, setError] = useState<string | null>(null);
  const [dot, setDot] = useState<DotState | null>(null);
  const [noFace, setNoFace] = useState(false);
  const [result, setResult] = useState<CalibrationRecord | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [existing, setExisting] = useState<CalibrationRecord | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    engine.preload();
    const s = getCalibrationState();
    // sessionStorage is browser-only, so read it after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (s.state === "ready" && (s.record.ok || s.record.lowAccuracy)) setExisting(s.record);
    return () => {
      cancelledRef.current = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [engine]);

  const grabFrame = useCallback((): HTMLCanvasElement | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return null;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    // Identical mirroring to hooks/useGazeTestRunner.ts.
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.restore();
    return canvas;
  }, []);

  /** Shows a dot, waits for the child to settle, then samples features for collectMs. */
  const runPoint = useCallback(
    async (fx: number, fy: number, label: string): Promise<{ x: number; y: number; feats: FeatureVector[] }> => {
      const x = fx * window.innerWidth;
      const y = fy * window.innerHeight;
      setDot({ x, y, collecting: false, label });
      await sleep(RESEARCH_CONFIG.calibrationSettleMs);
      setDot({ x, y, collecting: true, label });
      const feats: FeatureVector[] = [];
      let missed = 0;
      const end = performance.now() + RESEARCH_CONFIG.calibrationCollectMs;
      while (performance.now() < end && !cancelledRef.current) {
        const canvas = grabFrame();
        const f = canvas ? detectFeatures(canvas) : null;
        if (f && !isBlink(f)) {
          feats.push(f.features);
          missed = 0;
        } else {
          missed++;
        }
        setNoFace(missed * SAMPLE_EVERY_MS > 800);
        await sleep(SAMPLE_EVERY_MS);
      }
      return { x, y, feats };
    },
    [grabFrame],
  );

  const waitForEngine = useCallback(async () => {
    const deadline = performance.now() + 60_000;
    while (engine.getStatus().status === "loading" && performance.now() < deadline) {
      engine.preload();
      await sleep(200);
    }
    const s = engine.getStatus();
    if (s.status !== "ready") throw new Error(s.error ?? "The gaze engine did not load in time.");
  }, [engine]);

  const start = useCallback(async () => {
    cancelledRef.current = false;
    setError(null);
    setResult(null);
    setPhase("loading");
    try {
      if (!streamRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: CAPTURE_W, height: CAPTURE_H },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      }
      await waitForEngine();
    } catch (err) {
      setError(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
      setPhase("error");
      return;
    }

    setPhase("running");
    const viewport = { w: window.innerWidth, h: window.innerHeight };
    const train: { features: FeatureVector; x: number; y: number }[] = [];
    const calPts = RESEARCH_CONFIG.calibrationPoints;
    for (let i = 0; i < calPts.length; i++) {
      const p = await runPoint(calPts[i][0], calPts[i][1], `${i + 1} / ${calPts.length}`);
      if (cancelledRef.current) return;
      p.feats.forEach((features) => train.push({ features, x: p.x, y: p.y }));
    }

    setPhase("fitting");
    let model: GazeModel;
    try {
      model = fitGazeModel(train, RESEARCH_CONFIG.ridgeLambda);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
      return;
    }

    setPhase("running");
    const errors: number[] = [];
    const valPts = RESEARCH_CONFIG.validationPoints;
    for (let i = 0; i < valPts.length; i++) {
      const p = await runPoint(valPts[i][0], valPts[i][1], `ตรวจสอบ / check ${i + 1} / ${valPts.length}`);
      if (cancelledRef.current) return;
      if (p.feats.length === 0) continue;
      const preds = p.feats.map((f) => predictGaze(model, f));
      const mx = median(preds.map((q) => q.x));
      const my = median(preds.map((q) => q.y));
      errors.push(Math.hypot(mx - p.x, my - p.y));
    }
    setDot(null);
    setNoFace(false);

    const nextAttempts = attempts + 1;
    setAttempts(nextAttempts);
    const meanErrorPx = errors.length === valPts.length ? errors.reduce((a, b) => a + b, 0) / errors.length : Infinity;
    const rec: CalibrationRecord = {
      model,
      viewport,
      meanErrorPx,
      ok: meanErrorPx <= RESEARCH_CONFIG.maxCalibrationErrorPx,
      lowAccuracy: false,
      attempts: nextAttempts,
      createdAt: new Date().toISOString(),
    };
    saveCalibration(rec);
    setResult(rec);
    setPhase("result");
  }, [attempts, runPoint, waitForEngine]);

  const continueLowAccuracy = useCallback(() => {
    if (!result) return;
    saveCalibration({ ...result, lowAccuracy: true });
    router.push("/test1");
  }, [result, router]);

  const canRecalibrate = attempts <= RESEARCH_CONFIG.maxRecalibrations;

  return (
    <div className={styles.pageNarrow}>
      <h1 className={styles.titleCentered}>ปรับเทียบสายตา / Gaze calibration</h1>
      <p className={styles.subtitleCentered}>
        ใช้เวลาประมาณ 30 วินาที ทำครั้งเดียวก่อนเริ่มแบบทดสอบทั้ง 3 ระดับ
        <br />
        About 30 seconds, once before the three tests.
      </p>

      {engine.name !== "mediapipe" && (
        <div className={styles.card}>
          <p>The active gaze engine ({engine.name}) does not need calibration.</p>
          <button className={styles.primaryButton} onClick={() => router.push("/test1")}>
            Go to Test 1
          </button>
        </div>
      )}

      {engine.name === "mediapipe" && phase === "intro" && (
        <div className={styles.card}>
          <ol className={rs.steps}>
            <li>ให้เด็กนั่งตรงหน้าจอ ห่างประมาณหนึ่งช่วงแขน มีแสงสว่างที่ใบหน้า</li>
            <li>อย่าปรับขนาดหน้าต่างเบราว์เซอร์หลังจากนี้</li>
            <li>ให้เด็กมองตามจุดสีแดงที่เคลื่อนไปบนจอ (ศีรษะขยับได้เล็กน้อย)</li>
          </ol>
          <p style={{ color: "var(--muted)", marginTop: 0 }}>
            Seat the child about an arm&apos;s length from the screen with light on the face. Don&apos;t resize
            the browser window after this. The child follows the red dot with their eyes.
          </p>
          <div className={styles.saveRow}>
            <button className={styles.primaryButton} onClick={start}>
              เริ่มปรับเทียบ / Start calibration
            </button>
            {existing && (
              <button className={styles.secondaryButton} onClick={() => router.push("/test1")}>
                ใช้ค่าเดิม / Use current calibration ({Math.round(existing.meanErrorPx)} px)
              </button>
            )}
          </div>
        </div>
      )}

      {phase === "loading" && <div className={styles.card}>กำลังเปิดกล้องและโหลดระบบ… / Starting camera and loading…</div>}

      {phase === "error" && (
        <div className={styles.card}>
          <p className={styles.errorText}>เกิดข้อผิดพลาด / Something went wrong: {error}</p>
          <button className={styles.primaryButton} onClick={start}>
            ลองใหม่ / Try again
          </button>
        </div>
      )}

      {phase === "result" && result && (
        <div className={styles.card} style={{ textAlign: "center" }}>
          <div className={`${rs.metric} ${result.ok ? rs.pass : rs.fail}`}>
            {Number.isFinite(result.meanErrorPx) ? `${Math.round(result.meanErrorPx)} px` : "—"}
          </div>
          <p style={{ marginTop: 0 }}>
            {result.ok
              ? "ปรับเทียบสำเร็จ / Calibration passed"
              : "ความแม่นยำยังไม่พอ / Accuracy too low"}
            <br />
            <span style={{ color: "var(--muted)", fontSize: 14 }}>
              ค่าคลาดเคลื่อนเฉลี่ย (เกณฑ์ ≤ {RESEARCH_CONFIG.maxCalibrationErrorPx} px, รอปรับจากข้อมูลนำร่อง) / mean error
              (threshold TBD)
            </span>
          </p>
          <div className={styles.saveRow} style={{ justifyContent: "center" }}>
            {result.ok && (
              <button className={styles.primaryButton} onClick={() => router.push("/test1")}>
                เริ่มแบบทดสอบที่ 1 / Start Test 1 →
              </button>
            )}
            {!result.ok && canRecalibrate && (
              <button className={styles.primaryButton} onClick={start}>
                ปรับเทียบใหม่ / Recalibrate
              </button>
            )}
            {result.ok && (
              <button className={styles.secondaryButton} onClick={start}>
                ปรับเทียบใหม่ / Recalibrate
              </button>
            )}
            {!result.ok && !canRecalibrate && (
              <button className={styles.secondaryButton} onClick={continueLowAccuracy}>
                ทำต่อแบบความแม่นยำต่ำ / Continue with low accuracy
              </button>
            )}
          </div>
        </div>
      )}

      {(phase === "running" || phase === "fitting") && (
        <div className={rs.overlay}>
          <div className={`${rs.overlayStatus} ${noFace ? rs.overlayWarning : ""}`}>
            {noFace
              ? "มองไม่เห็นใบหน้า ขยับให้อยู่หน้ากล้อง / Face not visible"
              : phase === "fitting"
                ? "กำลังคำนวณ… / Fitting…"
                : `มองที่จุด / Look at the dot · ${dot?.label ?? ""}`}
          </div>
          {dot && (
            <div className={`${rs.dot} ${dot.collecting ? rs.dotCollecting : ""}`} style={{ left: dot.x, top: dot.y }} />
          )}
        </div>
      )}

      <canvas ref={canvasRef} width={CAPTURE_W} height={CAPTURE_H} className={rs.hiddenCanvas} />
      <video ref={videoRef} className={styles.hiddenVideo} muted playsInline />
    </div>
  );
}
