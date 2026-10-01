"use client";

/**
 * hooks/useGazeTestRunner.ts
 * ============================
 * Shared infrastructure behind every "play stimulus video(s) + track
 * webcam gaze" test page (Test 1, 2, 3) -- the Next.js/browser
 * equivalent of gui/video_test_base.py's VideoTestPage. Factors out
 * everything that's identical across tests: vision-worker lifecycle,
 * webcam capture, the mirrored capture/preview canvas, the detection
 * tick loop, the countdown timer, and stimulus-video autoplay(+sound)
 * handling. Each test component only supplies its own stimulus video
 * ref(s) and a callback that turns a raw gaze sample (+ the primary
 * stimulus video's current playback position, for phase-gated scoring)
 * into whatever that test's own region log needs.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  getGazeWorker,
  getGazeWorkerStatus,
  subscribeGazeWorker,
  type WorkerSample,
  type WorkerStatus,
} from "@/lib/gazeWorkerClient";

export type { WorkerSample, WorkerStatus };

const getStatusSnapshot = () => getGazeWorkerStatus().status;
const getErrorSnapshot = () => getGazeWorkerStatus().error;
const getServerStatus = (): WorkerStatus => "loading";
const getServerError = () => null;

export const DETECTION_INTERVAL_MS = 100;

// The canvas's actual pixel buffer -- this is what gets fed to the CV
// pipeline, so it needs to be large enough that a normal face-to-camera
// distance still leaves the face above the Haar cascade's 80x80 minSize
// floor. It's shown on screen much smaller than this via CSS (see
// .previewCanvas in each test's stylesheet) -- display size and capture
// resolution are intentionally decoupled.
export const CAPTURE_W = 640;
export const CAPTURE_H = 480;

export interface UseGazeTestRunnerOptions {
  testDurationMs: number;
  /** The stimulus video element(s) this test plays. videoRefs[0]'s
   * currentTime is what phase-gated tests (Test 2/3) key their scoring
   * off of, matching the desktop app's `_get_stim_pos_sec(0)`. */
  videoRefs: React.RefObject<HTMLVideoElement | null>[];
  /** Created by the caller (via its own useRef) and rendered as the
   * hidden <video>/corner <canvas> elements -- passed in rather than
   * created-and-returned here so no ref crosses the hook boundary as a
   * return value (the react-hooks lint rules flag that pattern, since
   * they can't verify a hook's return object stays referentially
   * stable the way a same-component useRef() does). */
  webcamVideoRef: React.RefObject<HTMLVideoElement | null>;
  previewCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  onSample: (sample: WorkerSample, videoPosSec: number) => void;
  /** Called once, right when the timer runs out or stop() is invoked
   * manually -- before `running` flips to false -- so the caller can
   * read its own region-log ref and compute final results. */
  onStop: () => void;
}

export function useGazeTestRunner(options: UseGazeTestRunnerOptions) {
  const { testDurationMs, videoRefs, webcamVideoRef, previewCanvasRef, onSample, onStop } = options;

  // Init status comes from the tab-wide shared worker; a frame-processing
  // error during this page's run is tracked locally on top of it.
  const sharedStatus = useSyncExternalStore(subscribeGazeWorker, getStatusSnapshot, getServerStatus);
  const sharedError = useSyncExternalStore(subscribeGazeWorker, getErrorSnapshot, getServerError);
  const [frameError, setFrameError] = useState<string | null>(null);
  const workerStatus: WorkerStatus = frameError ? "error" : sharedStatus;
  const loadError = frameError ?? sharedError;
  const [running, setRunning] = useState(false);
  const [remainingSec, setRemainingSec] = useState(testDurationMs / 1000);
  const [liveStatus, setLiveStatus] = useState<WorkerSample | null>(null);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  // At most one frame is in flight to the worker at a time, so we never
  // pay for a getImageData() readback that the worker would just drop.
  const frameInFlightRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);

  const runningRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);
  const detectionIntervalRef = useRef<number | null>(null);
  const countdownIntervalRef = useRef<number | null>(null);
  const stopTimeoutRef = useRef<number | null>(null);

  // Keep the latest callbacks in refs so the effects/loops below (set up
  // once) always call the current version without needing to be torn
  // down and rebuilt every render. Assigned in an effect, not during
  // render -- mutating a ref during render isn't allowed.
  const onSampleRef = useRef(onSample);
  const onStopRef = useRef(onStop);
  const videoRefsRef = useRef(videoRefs);
  useEffect(() => {
    onSampleRef.current = onSample;
    onStopRef.current = onStop;
    videoRefsRef.current = videoRefs;
  });

  const stopAllLoops = useCallback(() => {
    if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    if (detectionIntervalRef.current !== null) window.clearInterval(detectionIntervalRef.current);
    if (countdownIntervalRef.current !== null) window.clearInterval(countdownIntervalRef.current);
    if (stopTimeoutRef.current !== null) window.clearTimeout(stopTimeoutRef.current);
    rafIdRef.current = null;
    detectionIntervalRef.current = null;
    countdownIntervalRef.current = null;
    stopTimeoutRef.current = null;
  }, []);

  // ---- attach to the shared vision worker ----
  // (See lib/gazeWorkerClient.ts and public/gaze-worker.js -- a classic
  // Worker, not a module worker, specifically so opencv.js's
  // importScripts()-based UMD loader works unmodified. It's shared across
  // test pages so opencv.js only loads once per tab.)
  useEffect(() => {
    workerRef.current = getGazeWorker();
    frameInFlightRef.current = false;

    const unsubscribe = subscribeGazeWorker((msg) => {
      if (msg.type === "skipped") {
        frameInFlightRef.current = false;
      } else if (msg.type === "error") {
        frameInFlightRef.current = false;
        console.error("gaze-worker error:", msg.message);
        if (getGazeWorkerStatus().status === "ready") setFrameError(msg.message);
      } else if (msg.type === "result") {
        frameInFlightRef.current = false;
        const sample = msg.sample;
        // Skip the re-render when nothing visible changed.
        setLiveStatus((prev) =>
          prev &&
          prev.direction === sample.direction &&
          prev.eyesDetected === sample.eyesDetected &&
          prev.confidence === sample.confidence
            ? prev
            : sample,
        );
        if (runningRef.current) {
          const videoPosSec = videoRefsRef.current[0]?.current?.currentTime ?? 0;
          onSampleRef.current(sample, videoPosSec);
        }
      }
    });

    return () => {
      unsubscribe();
      workerRef.current = null;
    };
  }, []);

  // ---- cleanup on unmount ----
  useEffect(() => {
    return () => {
      stopAllLoops();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [stopAllLoops]);

  const stop = useCallback(() => {
    runningRef.current = false;
    stopAllLoops();
    videoRefsRef.current.forEach((ref) => ref.current?.pause());
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    onStopRef.current();
    setRunning(false);
  }, [stopAllLoops]);

  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  });

  const tryPlayAll = useCallback(() => {
    return Promise.all(videoRefsRef.current.map((ref) => ref.current?.play() ?? Promise.resolve()));
  }, []);

  // Fallback only: if the synchronous play() call at the top of start()
  // (below) still got blocked, retry once the visitor clicks anywhere.
  // Caller components render the stimulus <video> elements unconditionally
  // (just visually hidden outside the "running" phase) precisely so their
  // refs are already attached by the time start() runs the synchronous
  // play() call -- calling play() from an effect after a re-render would
  // be one tick too late for stricter autoplay-with-sound policies (e.g.
  // Safari requires the call to happen synchronously within the user
  // gesture's call stack).
  useEffect(() => {
    if (!running || !soundBlocked) return;
    const retryOnClick = () => {
      tryPlayAll()
        .then(() => setSoundBlocked(false))
        .catch(() => setSoundBlocked(true));
    };
    window.addEventListener("click", retryOnClick);
    return () => window.removeEventListener("click", retryOnClick);
  }, [running, soundBlocked, tryPlayAll]);

  // A ref (not a memoized callback) so the recursive requestAnimationFrame
  // call below never references a `const` before it's fully initialized.
  // Assigned in an effect (not during render) since mutating a ref during
  // render isn't allowed.
  const previewLoopRef = useRef<() => void>(() => {});
  useEffect(() => {
    previewLoopRef.current = () => {
      const video = webcamVideoRef.current;
      const canvas = previewCanvasRef.current;
      if (video && canvas && video.readyState >= 2) {
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          // Mirror horizontally so it feels like looking in a mirror --
          // matches the desktop app's default camera.mirror behavior,
          // and keeps Left/Right classification matching real intuition.
          ctx.save();
          ctx.translate(canvas.width, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          ctx.restore();
        }
      }
      rafIdRef.current = requestAnimationFrame(previewLoopRef.current);
    };
  }, [webcamVideoRef, previewCanvasRef]);

  const runDetectionTick = useCallback(() => {
    const worker = workerRef.current;
    const canvas = previewCanvasRef.current;
    if (!worker || !canvas || frameInFlightRef.current) return;
    // willReadFrequently keeps the canvas CPU-backed, so getImageData()
    // below doesn't force a slow GPU readback every tick.
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    // Ship one RGBA frame to the worker as a transferable buffer
    // (zero-copy). Skipped while a previous frame is still being
    // processed (the worker replies to every frame), so this is safe to
    // call on a fixed interval regardless of how long detection takes.
    frameInFlightRef.current = true;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    worker.postMessage(
      { type: "frame", width: canvas.width, height: canvas.height, buffer: imageData.data.buffer },
      [imageData.data.buffer],
    );
  }, [previewCanvasRef]);

  const start = useCallback(async (): Promise<boolean> => {
    // Must run synchronously, before any `await` in this function, so the
    // browser still counts it as part of the same user gesture as the
    // "Start Test" click that led here -- that's what makes unmuted
    // ("with sound") autoplay allowed instead of silently blocked.
    setSoundBlocked(false);
    setCameraError(null);
    tryPlayAll()
      .then(() => setSoundBlocked(false))
      .catch(() => setSoundBlocked(true));

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: CAPTURE_W, height: CAPTURE_H },
        audio: false,
      });
      streamRef.current = stream;
      if (webcamVideoRef.current) {
        webcamVideoRef.current.srcObject = stream;
        await webcamVideoRef.current.play();
      }
    } catch (err) {
      console.error(err);
      // Not window.alert(): a blocking native dialog pauses whatever media
      // is already playing on the page for as long as it's open (Chrome
      // does this deliberately for any open alert/confirm/prompt), which
      // left the stimulus video's sound stuck paused after the visitor
      // dismissed it -- looked like a silent-audio bug, wasn't one.
      setCameraError(
        err instanceof Error
          ? `Could not access your webcam (${err.name}: ${err.message}). Please allow camera access and try again.`
          : "Could not access your webcam. Please allow camera access and try again.",
      );
      videoRefsRef.current.forEach((ref) => ref.current?.pause());
      return false;
    }

    workerRef.current?.postMessage({ type: "reset" });
    setFrameError(null);
    runningRef.current = true;
    setRunning(true);
    setRemainingSec(testDurationMs / 1000);

    rafIdRef.current = requestAnimationFrame(previewLoopRef.current);
    detectionIntervalRef.current = window.setInterval(runDetectionTick, DETECTION_INTERVAL_MS);
    countdownIntervalRef.current = window.setInterval(() => {
      setRemainingSec((s) => Math.max(0, s - 0.25));
    }, 250);
    stopTimeoutRef.current = window.setTimeout(() => stopRef.current(), testDurationMs);
    return true;
  }, [testDurationMs, runDetectionTick, webcamVideoRef, tryPlayAll]);

  return {
    workerStatus,
    loadError,
    running,
    remainingSec,
    liveStatus,
    soundBlocked,
    cameraError,
    start,
    stop,
  };
}
