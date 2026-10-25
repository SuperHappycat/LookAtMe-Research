"use client";

/**
 * /r/check — 5-second camera check before calibration (spec §5 "pre-test camera check").
 * Measures: face visible (% of frames), lighting (mean brightness), distance (face size).
 * Thresholds: lib/research/quality.ts (TBD – tune with pilot data).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "@/styles/shared.module.css";
import rs from "@/styles/research.module.css";
import { CAPTURE_H, CAPTURE_W } from "@/hooks/useGazeTestRunner";
import { getGazeEngine } from "@/lib/research/gaze";
import { detectFeatures } from "@/lib/research/gaze/mediapipeEngine";
import { faceScaleOk, lumaOk, QUALITY_CONFIG } from "@/lib/research/quality";
import { median } from "@/lib/research/gaze/regression";
import { getResearchContext, setResearchContext, type ResearchContext } from "@/lib/research/screening";

const CHECK_MS = 5000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Result = NonNullable<ResearchContext["cameraCheck"]>;

export default function CameraCheckClient() {
  const router = useRouter();
  const engine = getGazeEngine();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ctx, setCtx] = useState<ResearchContext | null | undefined>(undefined);
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    engine.preload();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage is browser-only
    setCtx(getResearchContext());
    return () => streamRef.current?.getTracks().forEach((t) => t.stop());
  }, [engine]);

  const run = useCallback(async () => {
    setPhase("running");
    setError(null);
    try {
      if (!streamRef.current) {
        streamRef.current = await navigator.mediaDevices.getUserMedia({
          video: { width: CAPTURE_W, height: CAPTURE_H },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = streamRef.current;
          await videoRef.current.play();
        }
      }
      const useFace = engine.name === "mediapipe";
      const deadline = performance.now() + 30_000;
      while (useFace && engine.getStatus().status === "loading" && performance.now() < deadline) await sleep(200);
      const faceReady = useFace && engine.getStatus().status === "ready";

      const faces: boolean[] = [];
      const scales: number[] = [];
      const lumas: number[] = [];
      const t0 = performance.now();
      while (performance.now() - t0 < CHECK_MS) {
        const v = videoRef.current;
        const c = canvasRef.current;
        if (v && c && v.readyState >= 2) {
          const g = c.getContext("2d", { willReadFrequently: true });
          if (g) {
            g.save();
            g.translate(c.width, 0);
            g.scale(-1, 1);
            g.drawImage(v, 0, 0, c.width, c.height);
            g.restore();
            const d = g.getImageData(0, 0, c.width, c.height).data;
            let sum = 0;
            for (let i = 0; i < d.length; i += 64) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            lumas.push(sum / (d.length / 64));
            if (faceReady) {
              const f = detectFeatures(c);
              faces.push(!!f);
              if (f) scales.push(f.features.s);
            }
          }
        }
        setProgress(Math.min(1, (performance.now() - t0) / CHECK_MS));
        await sleep(150);
      }
      const faceFoundPct = faceReady && faces.length ? (100 * faces.filter(Boolean).length) / faces.length : null;
      const meanLuma = lumas.length ? lumas.reduce((a, b) => a + b, 0) / lumas.length : null;
      const medianFaceScale = scales.length ? median(scales) : null;
      const passed =
        (faceFoundPct === null || faceFoundPct >= QUALITY_CONFIG.minFaceFoundPct) &&
        (meanLuma === null || lumaOk(meanLuma)) &&
        (medianFaceScale === null || faceScaleOk(medianFaceScale));
      const r: Result = { faceFoundPct, meanLuma, medianFaceScale, passed };
      setResult(r);
      const current = getResearchContext();
      if (current) setResearchContext({ ...current, cameraCheck: r });
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
      setPhase("error");
    }
  }, [engine]);

  function proceed() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    router.push(engine.requiresCalibration ? "/calibrate" : "/test1");
  }

  if (ctx === undefined) return <div className={rs.wide}>…</div>;
  if (ctx === null)
    return (
      <div className={styles.pageNarrow}>
        <div className={styles.card}>
          ยังไม่ได้เลือกเด็ก / No screening started.{" "}
          <button className={rs.linkButton} onClick={() => router.push("/r")}>
            เลือกเด็ก / Choose a child →
          </button>
        </div>
      </div>
    );

  const item = (label: string, ok: boolean | null, value: string, tip: string) => (
    <div className={rs.checkItem}>
      <div style={{ fontWeight: 600 }}>
        {ok === null ? "–" : ok ? "✓" : "✗"} {label}
      </div>
      <div className={rs.muted} style={{ fontSize: 13 }}>
        {value}
      </div>
      {ok === false && <div style={{ fontSize: 13, color: "var(--danger)" }}>{tip}</div>}
    </div>
  );

  return (
    <div className={styles.pageNarrow}>
      <h1 className={styles.titleCentered}>ตรวจกล้อง / Camera check</h1>
      <p className={styles.subtitleCentered}>
        {ctx.childCode} · 5 วินาที / 5 seconds
      </p>
      <div className={styles.card}>
        <video ref={videoRef} className={rs.preview} muted playsInline style={{ transform: "scaleX(-1)" }} />
        <canvas ref={canvasRef} width={CAPTURE_W} height={CAPTURE_H} className={rs.hiddenCanvas} />
        {phase === "idle" && (
          <p style={{ marginTop: 0 }}>
            ให้เด็กนั่งหน้าจอเหมือนตอนทดสอบ แล้วกดเริ่ม / Seat the child as for the test, then start.
          </p>
        )}
        {phase === "running" && <p>กำลังตรวจ… / Checking… {Math.round(progress * 100)}%</p>}
        {phase === "error" && <p className={styles.errorText}>{error}</p>}
        {result && (
          <div className={rs.checkGrid}>
            {item(
              "ใบหน้า / Face",
              result.faceFoundPct === null ? null : result.faceFoundPct >= QUALITY_CONFIG.minFaceFoundPct,
              result.faceFoundPct === null ? "ไม่ได้ตรวจ / not checked" : `${Math.round(result.faceFoundPct)}%`,
              "ให้ใบหน้าอยู่กลางกล้อง / Keep the face in view",
            )}
            {item(
              "แสง / Lighting",
              result.meanLuma === null ? null : lumaOk(result.meanLuma),
              result.meanLuma === null ? "—" : `${Math.round(result.meanLuma)} / 255`,
              result.meanLuma !== null && result.meanLuma < QUALITY_CONFIG.lumaMin
                ? "สว่างไม่พอ เปิดไฟหน้าเด็ก / Too dark: add light in front"
                : "สว่างเกิน หลีกเลี่ยงแสงจ้า / Too bright: avoid glare",
            )}
            {item(
              "ระยะ / Distance",
              result.medianFaceScale === null ? null : faceScaleOk(result.medianFaceScale),
              result.medianFaceScale === null ? "ไม่ได้ตรวจ / not checked" : `${Math.round(result.medianFaceScale * 100)}%`,
              result.medianFaceScale !== null && result.medianFaceScale < QUALITY_CONFIG.faceScaleMin
                ? "นั่งใกล้ขึ้น / Sit closer"
                : "นั่งห่างขึ้น / Sit further back",
            )}
          </div>
        )}
        <div className={styles.saveRow}>
          {phase !== "running" && (
            <button className={result?.passed ? styles.secondaryButton : styles.primaryButton} onClick={run}>
              {result ? "ตรวจอีกครั้ง / Check again" : "เริ่มตรวจ / Start check"}
            </button>
          )}
          {result && (
            <button className={result.passed ? styles.primaryButton : styles.secondaryButton} onClick={proceed}>
              {result.passed ? "ผ่าน ไปต่อ / Passed — continue →" : "ไปต่อแม้ไม่ผ่าน / Continue anyway →"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
