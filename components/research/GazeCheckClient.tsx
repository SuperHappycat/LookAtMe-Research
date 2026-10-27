"use client";

/**
 * components/research/GazeCheckClient.tsx — /r/gaze-check
 *
 * Live view of where the person is looking after calibration, for pilot testing and for showing
 * an audience that the calibration works. Nothing is saved.
 *
 * The gaze point comes from the same pipeline the tests use: frames from the mirrored 640×480
 * canvas (useMirroredCamera) go to mediapipeEngine.submitFrame() every DETECTION_INTERVAL_MS,
 * which runs detectFeatures → isBlink → predictGaze with the active calibration model and the
 * RESEARCH_CONFIG.smoothingAlpha smoothing, and emits the point through subscribe().
 *
 * Views: "stars" = 3×3 faint targets that light up after ~1 s of dwelling; "animals" = one animal
 * at a random target position, caught after ~1 s of dwelling, then it moves (count shown).
 * Dwell logic: lib/research/gaze/gazeCheck.ts. Keys: Esc = finish.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "@/styles/shared.module.css";
import rs from "@/styles/research.module.css";
import gc from "@/styles/gaze-check.module.css";
import { RESEARCH_CONFIG } from "@/lib/research/config";
import { getGazeEngine } from "@/lib/research/gaze";
import { getActiveModel, getCalibrationState, type CalibrationRecord } from "@/lib/research/gaze/calibrationStore";
import {
  INITIAL_DWELL,
  dwellMeanDistance,
  gridRadius,
  gridTargets,
  pickNextTarget,
  pushTrail,
  stepDwell,
  type DwellState,
  type Pt,
} from "@/lib/research/gaze/gazeCheck";
import { loadSoundPrefs, playChime, playReward, unlockAudio, type SoundPrefs } from "@/lib/research/attentionSound";
import { CAPTURE_H, CAPTURE_W, DETECTION_INTERVAL_MS } from "@/hooks/useGazeTestRunner";
import AttentionTarget from "./AttentionTarget";
import { useMirroredCamera } from "./useMirroredCamera";

type Phase = "checking" | "unsupported" | "nocal" | "viewport" | "intro" | "loading" | "running" | "error";
type View = "stars" | "animals";

interface Layout {
  targets: Pt[];
  radius: number;
}

interface LastLit {
  index: number;
  meanPx: number | null;
  n: number;
}

const REWARD_MS = 600;
const RETURN_PATHS: Record<string, string> = { calibrate: "/calibrate", test1: "/test1" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Where "back" / "finish" go: ?from=calibrate (default) or ?from=test1. */
function returnPath(): string {
  if (typeof window === "undefined") return "/calibrate";
  const from = new URLSearchParams(window.location.search).get("from") ?? "";
  return RETURN_PATHS[from] ?? "/calibrate";
}

function computeLayout(): Layout {
  const c = RESEARCH_CONFIG.gazeCheck;
  const w = window.innerWidth;
  const h = window.innerHeight;
  return { targets: gridTargets(w, h, c.gridFractions), radius: gridRadius(w, h, c.gridFractions, c.targetRadiusOfGap) };
}

export default function GazeCheckClient() {
  const router = useRouter();
  const engine = getGazeEngine();
  const { videoRef, canvasRef, start: camStart, stop: camStop, grab } = useMirroredCamera();

  const [phase, setPhase] = useState<Phase>("checking");
  const [record, setRecord] = useState<CalibrationRecord | null>(null);
  const [view, setView] = useState<View>("stars");
  const [error, setError] = useState<string | null>(null);

  // Live display state (updated once per engine result, ~10 per second).
  const [layout, setLayout] = useState<Layout | null>(null);
  /** Latest gaze point; `lost` = no point in the latest frame (blink / face lost), dot dims in place. */
  const [dot, setDot] = useState<{ p: Pt; lost: boolean } | null>(null);
  const [trail, setTrail] = useState<Pt[]>([]);
  const [faceFound, setFaceFound] = useState(true);
  const [dwell, setDwell] = useState<{ index: number; progress: number }>({ index: -1, progress: 0 });
  const [lit, setLit] = useState<boolean[]>([]);
  const [lastLit, setLastLit] = useState<LastLit | null>(null);
  const [animalAt, setAnimalAt] = useState(0);
  const [caught, setCaught] = useState(0);
  const [rewarding, setRewarding] = useState(false);

  // Mutable loop state (read inside the engine listener).
  const viewRef = useRef<View>("stars");
  const layoutRef = useRef<Layout | null>(null);
  const dwellRef = useRef<DwellState>(INITIAL_DWELL);
  const lastLitIndexRef = useRef(-1);
  const animalRef = useRef(0);
  const caughtRef = useRef(0);
  const rewardingRef = useRef(false);
  const soundRef = useRef<SoundPrefs>({ on: true, volume: 0.4 });
  const intervalRef = useRef<number | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const timeoutsRef = useRef<number[]>([]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- sessionStorage / window are browser-only */
    if (engine.name !== "mediapipe") {
      setPhase("unsupported");
      return;
    }
    engine.preload();
    soundRef.current = loadSoundPrefs();
    const s = getCalibrationState();
    if (s.state === "viewport_changed") {
      setPhase("viewport");
    } else if (s.state !== "ready" || !getActiveModel()) {
      setPhase("nocal");
    } else {
      setRecord(s.record);
      if (s.record.mode === "child") {
        setView("animals");
        viewRef.current = "animals";
      }
      setPhase("intro");
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [engine]);

  /** Clears targets, counts and the dwell tracker (also used when switching view). */
  const resetProgress = useCallback((l: Layout | null) => {
    dwellRef.current = INITIAL_DWELL;
    lastLitIndexRef.current = -1;
    caughtRef.current = 0;
    rewardingRef.current = false;
    const n = l?.targets.length ?? 9;
    animalRef.current = pickNextTarget(-1, n);
    setDwell({ index: -1, progress: 0 });
    setLit(Array(n).fill(false));
    setLastLit(null);
    setCaught(0);
    setRewarding(false);
    setAnimalAt(animalRef.current);
  }, []);

  const stopLoop = useCallback(() => {
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    intervalRef.current = null;
    unsubRef.current?.();
    unsubRef.current = null;
    timeoutsRef.current.forEach((t) => window.clearTimeout(t));
    timeoutsRef.current = [];
    camStop();
  }, [camStop]);

  useEffect(() => stopLoop, [stopLoop]);

  /** One engine sample → dot, trail, dwell, lighting. */
  const onSample = useCallback((p: Pt | null, tMs: number, face: boolean) => {
    const l = layoutRef.current;
    if (!l) return;
    setFaceFound(face);
    if (p) {
      setDot({ p, lost: false });
      setTrail((tr) => pushTrail(tr, p, RESEARCH_CONFIG.gazeCheck.trailLength));
    } else {
      setDot((d) => (d && !d.lost ? { ...d, lost: true } : d));
    }

    const c = RESEARCH_CONFIG.gazeCheck;
    const opts = { radiusPx: l.radius, dwellMs: c.dwellMs, maxGapMs: c.maxGapMs };

    if (viewRef.current === "stars") {
      const r = stepDwell(dwellRef.current, p, tMs, l.targets, opts);
      dwellRef.current = r.state;
      setDwell({ index: r.state.index, progress: r.progress });
      if (r.lit >= 0) {
        lastLitIndexRef.current = r.lit;
        setLit((prev) => prev.map((v, i) => v || i === r.lit));
        playChime(r.lit, soundRef.current);
      }
      if (r.state.fired && r.state.index === lastLitIndexRef.current) {
        setLastLit({ index: r.state.index, meanPx: dwellMeanDistance(r.state), n: r.state.n });
      }
      return;
    }

    // Animals: one target at a time; dwelling on it "catches" it, then it moves.
    if (rewardingRef.current) return;
    const at = animalRef.current;
    const r = stepDwell(dwellRef.current, p, tMs, [l.targets[at]], opts);
    dwellRef.current = r.state;
    setDwell({ index: r.state.index >= 0 ? at : -1, progress: r.progress });
    if (r.lit >= 0) {
      caughtRef.current += 1;
      setCaught(caughtRef.current);
      setLastLit({ index: at, meanPx: dwellMeanDistance(r.state), n: r.state.n });
      playReward(soundRef.current);
      rewardingRef.current = true;
      setRewarding(true);
      const t = window.setTimeout(() => {
        animalRef.current = pickNextTarget(at, l.targets.length);
        dwellRef.current = INITIAL_DWELL;
        rewardingRef.current = false;
        setRewarding(false);
        setAnimalAt(animalRef.current);
        setDwell({ index: -1, progress: 0 });
      }, REWARD_MS);
      timeoutsRef.current.push(t);
    }
  }, []);

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
    unlockAudio();
    setError(null);
    setPhase("loading");
    try {
      await camStart();
      await waitForEngine();
    } catch (err) {
      camStop();
      setError(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
      setPhase("error");
      return;
    }
    if (!getActiveModel()) {
      camStop();
      setPhase("nocal");
      return;
    }
    const l = computeLayout();
    layoutRef.current = l;
    setLayout(l);
    resetProgress(l);
    setTrail([]);
    setDot(null);
    engine.reset(); // clear smoothing from any earlier run
    unsubRef.current?.();
    unsubRef.current = engine.subscribe((msg) => {
      if (msg.type === "result") onSample(msg.sample.point, msg.sample.tMs, msg.sample.faceFound);
      else if (msg.type === "error") setError(msg.message);
    });
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    intervalRef.current = window.setInterval(() => {
      const canvas = grab();
      if (canvas) engine.submitFrame(canvas, performance.now());
    }, DETECTION_INTERVAL_MS);
    setPhase("running");
  }, [camStart, camStop, waitForEngine, resetProgress, engine, onSample, grab]);

  const finish = useCallback(() => {
    stopLoop();
    router.push(returnPath());
  }, [stopLoop, router]);

  const chooseView = useCallback(
    (v: View) => {
      viewRef.current = v;
      setView(v);
      resetProgress(layoutRef.current);
    },
    [resetProgress],
  );

  // Esc finishes; window resize re-lays out the targets (calibration itself is in viewport px).
  useEffect(() => {
    if (phase !== "running") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    const onResize = () => {
      const l = computeLayout();
      layoutRef.current = l;
      setLayout(l);
      resetProgress(l);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [phase, finish, resetProgress]);

  const litCount = lit.filter(Boolean).length;
  const calText = record
    ? `${record.meanErrorDeg ? `${record.meanErrorDeg.toFixed(1)}° · ` : ""}${Number.isFinite(record.meanErrorPx) ? `${Math.round(record.meanErrorPx)} px` : "—"}`
    : "";

  return (
    <div className={styles.pageNarrow}>
      <h1 className={styles.titleCentered}>ดูว่ามองตรงไหน / Gaze check</h1>
      <p className={styles.subtitleCentered}>
        จุดสีฟ้าคือตำแหน่งที่ระบบคิดว่ากำลังมอง · ไม่มีการบันทึกข้อมูล / The blue dot shows where the system thinks the
        person is looking · nothing is saved
      </p>

      {phase === "unsupported" && (
        <div className={styles.card}>
          <p>
            ใช้ไม่ได้กับระบบติดตามสายตานี้ / Not available with this engine ({engine.name}). The gaze check needs the
            MediaPipe engine.
          </p>
          <button className={styles.secondaryButton} onClick={() => router.push(returnPath())}>
            ← กลับ / Back
          </button>
        </div>
      )}

      {(phase === "nocal" || phase === "viewport") && (
        <div className={styles.card}>
          <p>
            {phase === "viewport"
              ? "ขนาดหน้าต่างเปลี่ยนหลังปรับเทียบ ต้องปรับเทียบใหม่ / The window size changed since calibration. Please calibrate again."
              : "ยังไม่ได้ปรับเทียบสายตาในแท็บนี้ / No calibration in this tab yet. Calibrate first, then come back."}
          </p>
          <div className={styles.saveRow}>
            <button className={styles.primaryButton} onClick={() => router.push("/calibrate")}>
              ไปปรับเทียบ / Go to calibration
            </button>
          </div>
        </div>
      )}

      {phase === "intro" && (
        <div className={styles.card}>
          <div className={rs.modeToggle} style={{ marginBottom: 14 }}>
            <button className={view === "stars" ? rs.modeOn : ""} onClick={() => chooseView("stars")}>
              ดาว 9 ดวง / 9 stars
            </button>
            <button className={view === "animals" ? rs.modeOn : ""} onClick={() => chooseView("animals")}>
              จับสัตว์ / Catch the animal
            </button>
          </div>
          <ol className={rs.steps}>
            {view === "stars" ? (
              <li>มองดาวทีละดวงค้างไว้ประมาณ 1 วินาที ดาวจะสว่างขึ้น</li>
            ) : (
              <li>มองสัตว์ค้างไว้ประมาณ 1 วินาทีเพื่อ “จับ” แล้วสัตว์จะย้ายไปที่ใหม่</li>
            )}
            <li>นั่งท่าเดิมกับตอนปรับเทียบ อย่าปรับขนาดหน้าต่าง · กด Esc หรือ “จบ” เพื่อออก</li>
          </ol>
          <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 14 }}>
            {view === "stars"
              ? "Look at each star for about 1 second and it lights up."
              : "Look at the animal for about 1 second to “catch” it; it then moves somewhere else."}{" "}
            Sit as during calibration and don&apos;t resize the window. Esc or “Finish” to leave. Calibration: {calText}.
          </p>
          <div className={styles.saveRow}>
            <button className={styles.primaryButton} onClick={start}>
              เริ่ม / Start
            </button>
            <button className={styles.secondaryButton} onClick={() => router.push(returnPath())}>
              ← กลับ / Back
            </button>
          </div>
        </div>
      )}

      {phase === "loading" && <div className={styles.card}>กำลังเปิดกล้องและโหลดระบบ… / Starting camera and loading…</div>}

      {phase === "error" && (
        <div className={styles.card}>
          <p className={styles.errorText}>{error}</p>
          <div className={styles.saveRow}>
            <button className={styles.primaryButton} onClick={start}>
              ลองใหม่ / Try again
            </button>
            <button className={styles.secondaryButton} onClick={() => router.push(returnPath())}>
              ← กลับ / Back
            </button>
          </div>
        </div>
      )}

      {phase === "running" && layout && (
        <div className={`${rs.overlay} ${gc.stage}`}>
          {view === "stars" &&
            layout.targets.map((t, i) => (
              <div
                key={i}
                className={`${gc.target} ${lit[i] ? gc.targetLit : ""}`}
                style={{ left: t.x - layout.radius, top: t.y - layout.radius, width: 2 * layout.radius, height: 2 * layout.radius }}
              >
                {!lit[i] && dwell.index === i && (
                  <div className={gc.targetFill} style={{ opacity: dwell.progress, transform: `scale(${dwell.progress})` }} />
                )}
                <span className={gc.targetStar}>★</span>
              </div>
            ))}

          {view === "animals" && layout.targets[animalAt] && (
            <>
              <AttentionTarget
                x={layout.targets[animalAt].x}
                y={layout.targets[animalAt].y}
                index={caught}
                phase={rewarding ? "reward" : "hold"}
                childMode
                progress={rewarding ? 1 : dwell.index === animalAt ? dwell.progress : 0}
              />
              <div className={gc.counter}>🐾 {caught}</div>
            </>
          )}

          {trail.slice(0, -1).map((p, i, arr) => (
            <div
              key={i}
              className={gc.trailDot}
              style={{ transform: `translate(${p.x}px, ${p.y}px)`, opacity: (0.35 * (i + 1)) / (arr.length + 1) }}
            />
          ))}
          {dot && <GazeDot p={dot.p} lost={dot.lost} />}

          {!faceFound && (
            <div className={`${rs.overlayStatus} ${rs.overlayWarning}`}>มองไม่เห็นใบหน้า ขยับให้อยู่หน้ากล้อง / Face not visible</div>
          )}

          <div className={rs.operatorBar}>
            <span className={gc.operatorInfo}>
              {view === "stars" ? `★ ${litCount}/${layout.targets.length}` : `🐾 ${caught}`}
              {" · "}
              {lastLit && lastLit.meanPx !== null
                ? `ระยะเฉลี่ย / mean dist #${lastLit.index + 1}: ${Math.round(lastLit.meanPx)} px (n=${lastLit.n})`
                : "ระยะเฉลี่ย / mean dist: —"}
            </span>
            <button onClick={() => chooseView(view === "stars" ? "animals" : "stars")}>
              {view === "stars" ? "สัตว์ / Animals" : "ดาว / Stars"}
            </button>
            <button onClick={() => resetProgress(layout)}>เริ่มนับใหม่ / Reset</button>
            <button onClick={finish} title="Esc">
              จบ / Finish (Esc)
            </button>
          </div>
          {error && <div className={`${rs.overlayStatus} ${rs.overlayWarning}`} style={{ top: 56 }}>{error}</div>}
        </div>
      )}

      <canvas ref={canvasRef} width={CAPTURE_W} height={CAPTURE_H} className={rs.hiddenCanvas} />
      <video ref={videoRef} className={styles.hiddenVideo} muted playsInline />
    </div>
  );
}

function GazeDot({ p, lost }: { p: Pt; lost: boolean }) {
  return <div className={`${gc.gazeDot} ${lost ? gc.gazeDotLost : ""}`} style={{ transform: `translate(${p.x}px, ${p.y}px)` }} />;
}
