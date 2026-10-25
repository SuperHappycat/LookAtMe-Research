"use client";

/**
 * End-of-session accuracy check (after Test 3, before saving). Developmental eye-tracking
 * guidance recommends verifying accuracy again after the task to detect drift (Dalrymple et
 * al., 2018), and discarding unreliable data rather than "correcting" offsets. So this only
 * measures: 3 quick targets, error in approximate degrees, stored with the session; a large
 * error flags the session for retest.
 */

import { useCallback, useState } from "react";
import styles from "@/styles/shared.module.css";
import rs from "@/styles/research.module.css";
import { RESEARCH_CONFIG } from "@/lib/research/config";
import { getGazeEngine } from "@/lib/research/gaze";
import { getActiveModel, getCalibrationState } from "@/lib/research/gaze/calibrationStore";
import { median, predictGaze } from "@/lib/research/gaze/regression";
import { pxToDeg } from "@/lib/research/gaze/calibrationCore";
import { unlockAudio } from "@/lib/research/attentionSound";
import { CAPTURE_H, CAPTURE_W } from "@/hooks/useGazeTestRunner";
import CalibrationStage from "./CalibrationStage";
import { useGazeStage } from "./useGazeStage";
import { useMirroredCamera } from "./useMirroredCamera";

export interface EndCheckResult {
  meanErrorPx: number | null;
  meanErrorDeg: number | null;
  pointsMeasured: number;
  skipped: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function EndCheck({ onDone }: { onDone: (r: EndCheckResult) => void }) {
  const { videoRef, canvasRef, start, stop, grab } = useMirroredCamera();
  const stage = useGazeStage(grab);
  const { runPoint, resetControls, isCancelled } = stage;
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cal = getCalibrationState();
  const mode = cal.state === "ready" ? (cal.record.mode ?? "adult") : "adult";

  const run = useCallback(async () => {
    const model = getActiveModel();
    if (!model) return onDone({ meanErrorPx: null, meanErrorDeg: null, pointsMeasured: 0, skipped: true });
    unlockAudio();
    resetControls();
    setError(null);
    try {
      await start();
      const engine = getGazeEngine();
      const deadline = performance.now() + 30_000;
      while (engine.getStatus().status === "loading" && performance.now() < deadline) {
        engine.preload();
        await sleep(200);
      }
      setRunning(true);
      const errors: number[] = [];
      const pts = RESEARCH_CONFIG.endCheckPoints;
      const m = RESEARCH_CONFIG.modes[mode];
      for (let k = 0; k < pts.length; k++) {
        const r = await runPoint(pts[k][0], pts[k][1], 20 + k, mode, m.validationSamples, `ตรวจท้ายสุด / Final check · ${k + 1} / ${pts.length}`);
        if (isCancelled()) break;
        if (r.skipped) continue;
        const preds = r.features.map((f) => predictGaze(model, f));
        errors.push(Math.hypot(median(preds.map((p) => p.x)) - r.x, median(preds.map((p) => p.y)) - r.y));
      }
      stop();
      setRunning(false);
      const cancelled = isCancelled();
      const mean = errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : null;
      onDone({
        meanErrorPx: mean,
        meanErrorDeg: mean === null ? null : pxToDeg(mean, RESEARCH_CONFIG.viewingDistanceCm),
        pointsMeasured: errors.length,
        skipped: cancelled || errors.length === 0,
      });
    } catch (err) {
      stop();
      setRunning(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [mode, onDone, resetControls, runPoint, start, stop, isCancelled]);

  return (
    <div className={styles.card}>
      <h2 style={{ marginTop: 0 }}>ตรวจท้ายสุด 10 วินาที / Final 10-second check</h2>
      <p style={{ marginTop: 0 }}>
        ให้เด็กนั่งที่เดิม มอง{mode === "child" ? "รูปสัตว์" : "จุด"} 3 ครั้ง เพื่อดูว่าความแม่นยำยังดีอยู่หรือไม่
        <br />
        <span className={rs.muted}>
          The child stays seated and looks at 3 targets, to confirm accuracy held during the tests.
        </span>
      </p>
      {error && <p className={styles.errorText}>{error}</p>}
      <div className={styles.saveRow}>
        <button className={styles.primaryButton} onClick={run} disabled={running}>
          เริ่มตรวจ / Start check
        </button>
        <button
          className={styles.secondaryButton}
          onClick={() => onDone({ meanErrorPx: null, meanErrorDeg: null, pointsMeasured: 0, skipped: true })}
          disabled={running}
        >
          ข้าม / Skip
        </button>
      </div>
      {running && (
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
      <canvas ref={canvasRef} width={CAPTURE_W} height={CAPTURE_H} className={rs.hiddenCanvas} />
      <video ref={videoRef} className={styles.hiddenVideo} muted playsInline />
    </div>
  );
}
