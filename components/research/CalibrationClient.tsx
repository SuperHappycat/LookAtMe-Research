"use client";

/**
 * components/research/CalibrationClient.tsx — calibration v2 (Research app, MediaPipe engine).
 *
 * Child mode (default for children under RESEARCH_CONFIG.childModeUnderMonths): 5 points,
 * animated animals that loom onto each point with gentle sounds, a small reward after each point.
 * Adult mode: 9 points with a plain dot.
 *
 * Both modes collect only during fixations (gaze-contingent), re-attract automatically when the
 * child looks away, let the operator re-attract / skip / pause, retry skipped points once,
 * then validate on separate points and report error in px and approximate degrees.
 * "Improve weak spots" redoes only the points near the worst validation errors.
 * Background and sources: docs/CALIBRATION_V2.md.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "@/styles/shared.module.css";
import rs from "@/styles/research.module.css";
import { RESEARCH_CONFIG } from "@/lib/research/config";
import { getGazeEngine } from "@/lib/research/gaze";
import { fitGazeModel, median, predictGaze, type FeatureVector, type GazeModel } from "@/lib/research/gaze/regression";
import {
  chooseMode,
  gradeDeg,
  nearestPoint,
  orderPoints,
  pxToDeg,
  worstIndices,
  type AccuracyGrade,
  type CalibrationMode,
} from "@/lib/research/gaze/calibrationCore";
import { getCalibrationState, saveCalibration, type CalibrationRecord } from "@/lib/research/gaze/calibrationStore";
import { getResearchContext } from "@/lib/research/screening";
import { unlockAudio } from "@/lib/research/attentionSound";
import CalibrationStage from "./CalibrationStage";
import { useGazeStage } from "./useGazeStage";
import { useMirroredCamera } from "./useMirroredCamera";
import { CAPTURE_H, CAPTURE_W } from "@/hooks/useGazeTestRunner";

type Phase = "intro" | "loading" | "running" | "result" | "error";

const GRADE_TEXT: Record<AccuracyGrade, string> = {
  high: "ดีมาก / High",
  medium: "ดี / Medium",
  low: "พอใช้ / Low",
  fail: "ไม่ผ่าน / Not enough",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function CalibrationClient() {
  const router = useRouter();
  const engine = getGazeEngine();
  const { videoRef: camVideoRef, canvasRef: camCanvasRef, start: camStart, stop: camStop, grab } = useMirroredCamera();
  const stage = useGazeStage(grab);
  const { runPoint, resetControls, isCancelled } = stage;

  const [phase, setPhase] = useState<Phase>("intro");
  const [mode, setMode] = useState<CalibrationMode>("adult");
  const [childCode, setChildCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CalibrationRecord | null>(null);
  const [pointErrors, setPointErrors] = useState<number[]>([]);
  const [existing, setExisting] = useState<CalibrationRecord | null>(null);
  const [attempts, setAttempts] = useState(0);
  /** Training samples per calibration point index, kept so "improve weak spots" can replace a few. */
  const trainRef = useRef<Map<number, FeatureVector[]>>(new Map());

  useEffect(() => {
    engine.preload();
    const ctx = getResearchContext();
    const s = getCalibrationState();
    /* eslint-disable react-hooks/set-state-in-effect -- sessionStorage is browser-only */
    if (ctx) {
      setChildCode(ctx.childCode);
      setMode(chooseMode(ctx.ageMonths ?? null, RESEARCH_CONFIG.childModeUnderMonths));
    }
    if (s.state === "ready" && (s.record.ok || s.record.lowAccuracy)) setExisting(s.record);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [engine]);

  const waitForEngine = useCallback(async () => {
    const deadline = performance.now() + 60_000;
    while (engine.getStatus().status === "loading" && performance.now() < deadline) {
      engine.preload();
      await sleep(200);
    }
    const s = engine.getStatus();
    if (s.status !== "ready") throw new Error(s.error ?? "The gaze engine did not load in time.");
  }, [engine]);

  const prepare = useCallback(async (): Promise<boolean> => {
    unlockAudio();
    resetControls();
    setError(null);
    setPhase("loading");
    try {
      await camStart();
      await waitForEngine();
      return true;
    } catch (err) {
      setError(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
      setPhase("error");
      return false;
    }
  }, [camStart, waitForEngine, resetControls]);

  /** Collects training data for the given calibration-point indices (skipped ones retried once). */
  const collectTraining = useCallback(
    async (indices: number[]) => {
      const m = RESEARCH_CONFIG.modes[mode];
      const ordered = orderPoints(indices, (i) => m.points[i][0] === 0.5 && m.points[i][1] === 0.5);
      let pending = ordered;
      for (let round = 0; round < 2 && pending.length; round++) {
        const skipped: number[] = [];
        for (let k = 0; k < pending.length; k++) {
          const i = pending[k];
          const [fx, fy] = m.points[i];
          const label = `${round ? "ลองอีกครั้ง / retry · " : ""}${k + 1} / ${pending.length}`;
          const r = await runPoint(fx, fy, i, mode, m.samplesPerPoint, `มองที่${mode === "child" ? "รูป" : "จุด"} / Look at the target · ${label}`);
          if (isCancelled()) return;
          if (r.skipped) skipped.push(i);
          else trainRef.current.set(i, r.features);
        }
        pending = skipped;
      }
    },
    [mode, runPoint, isCancelled],
  );

  /** Fits the model on the stored training data, validates, and saves the record. */
  const fitAndValidate = useCallback(async () => {
    const m = RESEARCH_CONFIG.modes[mode];
    if (trainRef.current.size < m.minPoints) {
      throw new Error(
        `เก็บข้อมูลได้ ${trainRef.current.size}/${m.points.length} จุด ไม่พอ / Only ${trainRef.current.size} of ${m.points.length} points were collected (need ${m.minPoints}). The child may not have looked at the targets.`,
      );
    }
    const train: { features: FeatureVector; x: number; y: number }[] = [];
    trainRef.current.forEach((feats, i) => {
      const [fx, fy] = m.points[i];
      feats.forEach((features) => train.push({ features, x: fx * window.innerWidth, y: fy * window.innerHeight }));
    });
    const model: GazeModel = fitGazeModel(train, RESEARCH_CONFIG.ridgeLambda);

    const errors: number[] = [];
    for (let k = 0; k < m.validation.length; k++) {
      const [fx, fy] = m.validation[k];
      const r = await runPoint(fx, fy, 10 + k, mode, m.validationSamples, `ตรวจความแม่นยำ / Checking accuracy · ${k + 1} / ${m.validation.length}`);
      if (isCancelled()) return null;
      if (r.skipped) {
        errors.push(Infinity);
        continue;
      }
      const preds = r.features.map((f) => predictGaze(model, f));
      errors.push(Math.hypot(median(preds.map((p) => p.x)) - r.x, median(preds.map((p) => p.y)) - r.y));
    }
    const finite = errors.filter(Number.isFinite);
    const meanErrorPx = finite.length >= Math.ceil(m.validation.length / 2) ? finite.reduce((a, b) => a + b, 0) / finite.length : Infinity;
    const meanErrorDeg = pxToDeg(meanErrorPx, RESEARCH_CONFIG.viewingDistanceCm);
    const nextAttempts = attempts + 1;
    setAttempts(nextAttempts);
    const rec: CalibrationRecord = {
      model,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      meanErrorPx,
      meanErrorDeg,
      grade: gradeDeg(meanErrorDeg),
      mode,
      pointsUsed: trainRef.current.size,
      ok: meanErrorDeg <= RESEARCH_CONFIG.maxCalibrationErrorDeg,
      lowAccuracy: false,
      attempts: nextAttempts,
      createdAt: new Date().toISOString(),
    };
    saveCalibration(rec);
    setPointErrors(errors);
    return rec;
  }, [mode, runPoint, isCancelled, attempts]);

  const finish = useCallback(
    (rec: CalibrationRecord | null) => {
      stage.setTarget(null);
      camStop();
      if (!rec) {
        setPhase("intro");
        return;
      }
      setResult(rec);
      setPhase("result");
    },
    [stage, camStop],
  );

  const fail = useCallback(
    (err: unknown) => {
      stage.setTarget(null);
      camStop();
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    },
    [stage, camStop],
  );

  const startFull = useCallback(async () => {
    if (!(await prepare())) return;
    trainRef.current = new Map();
    setPhase("running");
    try {
      await collectTraining(allPoints(mode));
      if (isCancelled()) return finish(null);
      finish(await fitAndValidate());
    } catch (err) {
      fail(err);
    }
  }, [prepare, collectTraining, fitAndValidate, finish, fail, isCancelled, mode]);

  /** Redo only the calibration points closest to the worst validation points, then re-validate. */
  const improve = useCallback(async () => {
    if (!(await prepare())) return;
    const m = RESEARCH_CONFIG.modes[mode];
    const worst = worstIndices(pointErrors, 2).map((vi) => nearestPoint(m.points, m.validation[vi][0], m.validation[vi][1]));
    const redo = [...new Set(worst)];
    setPhase("running");
    try {
      await collectTraining(redo);
      if (isCancelled()) return finish(null);
      finish(await fitAndValidate());
    } catch (err) {
      fail(err);
    }
  }, [prepare, mode, pointErrors, collectTraining, fitAndValidate, finish, fail, isCancelled]);

  const continueLowAccuracy = useCallback(() => {
    if (!result) return;
    saveCalibration({ ...result, lowAccuracy: true });
    router.push("/test1");
  }, [result, router]);

  const canRecalibrate = attempts <= RESEARCH_CONFIG.maxRecalibrations;
  const m = RESEARCH_CONFIG.modes[mode];

  return (
    <div className={styles.pageNarrow}>
      <h1 className={styles.titleCentered}>ปรับเทียบสายตา / Gaze calibration</h1>
      <p className={styles.subtitleCentered}>
        {childCode ? `${childCode} · ` : ""}
        {mode === "child" ? `${m.points.length} จุด รูปสัตว์และเสียง / ${m.points.length} points with animals and sounds` : `${m.points.length} จุด / ${m.points.length} points`}
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
          <div className={rs.modeToggle} style={{ marginBottom: 14 }}>
            <button className={mode === "child" ? rs.modeOn : ""} onClick={() => setMode("child")}>
              เด็ก / Child
            </button>
            <button className={mode === "adult" ? rs.modeOn : ""} onClick={() => setMode("adult")}>
              ผู้ใหญ่ / Adult
            </button>
          </div>
          {mode === "child" ? (
            <ol className={rs.steps}>
              <li>ให้เด็กนั่งตักผู้ปกครองหรือเก้าอี้ ห่างจอประมาณหนึ่งช่วงแขน แสงส่องหน้าเด็ก ไม่มีแสงจ้าด้านหลัง</li>
              <li>ปิดสิ่งรบกวนรอบจอ ผู้ปกครองไม่ชี้หรือพูดบอกให้มอง (ให้รูปและเสียงดึงความสนใจเอง)</li>
              <li>ถ้าเด็กหันไปทางอื่น กด Space เพื่อเรียกความสนใจ หรือ S เพื่อข้ามจุด · P หยุดพัก</li>
              <li>เด็กที่ไวต่อเสียง: ลดเสียงหรือปิดเสียงได้ที่แถบด้านล่าง</li>
            </ol>
          ) : (
            <ol className={rs.steps}>
              <li>นั่งห่างจอประมาณหนึ่งช่วงแขน แสงส่องหน้า</li>
              <li>มองจุดให้นิ่งจนวงสีเขียวครบ แล้วจุดจะย้ายเอง</li>
              <li>อย่าปรับขนาดหน้าต่างเบราว์เซอร์หลังจากนี้</li>
            </ol>
          )}
          <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 14 }}>
            {mode === "child"
              ? "Seat the child (on a parent's lap is fine) about an arm's length away, light on the face. Remove distractions; let the animals and sounds attract the child rather than pointing. Space = attract, S = skip, P = pause. Lower or mute the sound for sound-sensitive children."
              : "Sit about an arm's length away. Look at each dot until the green ring fills; it moves on by itself. Don't resize the window afterwards."}
          </p>
          <div className={styles.saveRow}>
            <button className={styles.primaryButton} onClick={startFull}>
              เริ่มปรับเทียบ / Start calibration
            </button>
            {existing && (
              <button className={styles.secondaryButton} onClick={() => router.push("/test1")}>
                ใช้ค่าเดิม / Use current ({existing.meanErrorDeg ? `${existing.meanErrorDeg.toFixed(1)}°` : `${Math.round(existing.meanErrorPx)} px`})
              </button>
            )}
          </div>
        </div>
      )}

      {phase === "loading" && <div className={styles.card}>กำลังเปิดกล้องและโหลดระบบ… / Starting camera and loading…</div>}

      {phase === "error" && (
        <div className={styles.card}>
          <p className={styles.errorText}>{error}</p>
          <button className={styles.primaryButton} onClick={startFull}>
            ลองใหม่ / Try again
          </button>
        </div>
      )}

      {phase === "result" && result && (
        <div className={styles.card} style={{ textAlign: "center" }}>
          <div className={`${rs.metric} ${result.ok ? rs.pass : rs.fail}`}>
            {result.grade ? GRADE_TEXT[result.grade] : "—"}
          </div>
          <p style={{ marginTop: 0 }}>
            {Number.isFinite(result.meanErrorPx)
              ? `คลาดเคลื่อนเฉลี่ย / mean error ≈ ${result.meanErrorDeg?.toFixed(1)}° (${Math.round(result.meanErrorPx)} px)`
              : "ตรวจความแม่นยำไม่ได้ / Accuracy could not be measured"}
            <br />
            <span style={{ color: "var(--muted)", fontSize: 13 }}>
              ผ่านเมื่อ ≤ {RESEARCH_CONFIG.maxCalibrationErrorDeg}° (ค่าประมาณ รอปรับจากข้อมูลนำร่อง) · pass ≤{" "}
              {RESEARCH_CONFIG.maxCalibrationErrorDeg}° (approximate; TBD from pilot data) · {result.pointsUsed}/{m.points.length} points
            </span>
          </p>
          <div className={styles.saveRow} style={{ justifyContent: "center" }}>
            {result.ok && (
              <button className={styles.primaryButton} onClick={() => router.push("/test1")}>
                เริ่มแบบทดสอบที่ 1 / Start Test 1 →
              </button>
            )}
            {result.grade !== "high" && canRecalibrate && pointErrors.length > 0 && (
              <button className={result.ok ? styles.secondaryButton : styles.primaryButton} onClick={improve}>
                ปรับเฉพาะจุดที่คลาดเคลื่อน / Improve weak spots
              </button>
            )}
            {canRecalibrate && (
              <button className={styles.secondaryButton} onClick={startFull}>
                ปรับเทียบใหม่ทั้งหมด / Recalibrate all
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

      {phase === "running" && (
        <CalibrationStage
          target={stage.target}
          childMode={mode === "child"}
          status={stage.status}
          warning={stage.warning}
          onReattract={stage.requestReattract}
          onSkip={stage.requestSkip}
          paused={stage.paused}
          onTogglePause={stage.togglePause}
          sound={stage.sound}
          onSoundChange={stage.setSound}
          onStop={stage.cancel}
        />
      )}

      <canvas ref={camCanvasRef} width={CAPTURE_W} height={CAPTURE_H} className={rs.hiddenCanvas} />
      <video ref={camVideoRef} className={styles.hiddenVideo} muted playsInline />
    </div>
  );
}

function allPoints(mode: CalibrationMode): number[] {
  return RESEARCH_CONFIG.modes[mode].points.map((_, i) => i);
}
