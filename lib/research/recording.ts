/**
 * lib/research/recording.ts
 * ===========================
 * "Advanced screen recording" (spec §4.4): composites, on an offscreen 640×360 canvas,
 *  - the stimulus video frame(s), in the same arrangement they have on screen,
 *  - a small webcam inset (the mirrored preview canvas), PIXELATED so the person can't be recognised
 *    (only coarse head position stays visible; see RECORDING_CONFIG.faceBlocks),
 *  - an optional gaze dot,
 * then records canvas.captureStream(15) with MediaRecorder (webm vp9 → vp8 → browser default,
 * 500 kbit/s ≈ 4 MB per minute). Video never leaves the browser here; see recordingUploader.ts.
 *
 * Pure layout helpers are exported for unit tests.
 */

import type { RecordingResult } from "./contracts";

export const RECORDING_CONFIG = {
  width: 640,
  height: 360,
  fps: 15,
  videoBitsPerSecond: 500_000,
  inset: { w: 128, h: 96, margin: 8 },
  /**
   * The webcam inset is drawn at this many blocks (w × h) and scaled up without smoothing, so faces are
   * never stored recognisably (participants are told their face is blurred). 0 would hide the inset.
   */
  faceBlocks: { w: 12, h: 9 },
  gazeDot: true,
  /** Safety stop if a page never calls stop() (e.g. the child leaves mid-level). */
  maxDurationMs: 5 * 60 * 1000,
} as const;

export const MIME_CANDIDATES = ["video/webm;codecs=vp9", "video/webm;codecs=vp8"] as const;

/** First supported candidate, or "" (= let the browser choose its default). */
export function pickMimeType(isTypeSupported?: (t: string) => boolean): string {
  if (!isTypeSupported) return "";
  for (const t of MIME_CANDIDATES) {
    try {
      if (isTypeSupported(t)) return t;
    } catch {
      // ignore
    }
  }
  return "";
}

export function recordingSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    typeof HTMLCanvasElement !== "undefined" &&
    typeof HTMLCanvasElement.prototype.captureStream === "function"
  );
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Transform {
  scale: number;
  dx: number;
  dy: number;
}

export function unionRect(rects: Rect[]): Rect | null {
  const r = rects.filter((b) => b.w > 0 && b.h > 0);
  if (r.length === 0) return null;
  const x = Math.min(...r.map((b) => b.x));
  const y = Math.min(...r.map((b) => b.y));
  const right = Math.max(...r.map((b) => b.x + b.w));
  const bottom = Math.max(...r.map((b) => b.y + b.h));
  return { x, y, w: right - x, h: bottom - y };
}

/** Scales the on-screen area `area` to fit (letterboxed, centred) inside outW × outH. */
export function fitTransform(area: Rect, outW: number, outH: number): Transform {
  const scale = Math.min(outW / area.w, outH / area.h);
  return { scale, dx: (outW - area.w * scale) / 2 - area.x * scale, dy: (outH - area.h * scale) / 2 - area.y * scale };
}

export function applyTransform(r: Rect, t: Transform): Rect {
  return { x: r.x * t.scale + t.dx, y: r.y * t.scale + t.dy, w: r.w * t.scale, h: r.h * t.scale };
}

export function applyPoint(p: { x: number; y: number }, t: Transform): { x: number; y: number } {
  return { x: p.x * t.scale + t.dx, y: p.y * t.scale + t.dy };
}

/** Where a srcW × srcH frame is drawn inside `box` with object-fit: contain. */
export function containRect(srcW: number, srcH: number, box: Rect): Rect {
  if (srcW <= 0 || srcH <= 0) return box;
  const s = Math.min(box.w / srcW, box.h / srcH);
  const w = srcW * s;
  const h = srcH * s;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

export interface RecordingSources {
  /** Stimulus videos; their on-screen boxes give the layout. */
  videos: (HTMLVideoElement | null)[];
  /** The webcam image for the inset (e.g. the mirrored preview canvas). */
  webcam?: () => CanvasImageSource | null;
  /** Latest gaze point in viewport px, or null. */
  gaze?: () => { x: number; y: number } | null;
}

export interface RecordingHandle {
  /** Stops and returns the recording (null if nothing was recorded). */
  stop(): Promise<RecordingResult | null>;
  /** Stops and discards. */
  cancel(): void;
  readonly active: boolean;
}

function toRect(d: DOMRect): Rect {
  return { x: d.left, y: d.top, w: d.width, h: d.height };
}

/** Starts recording, or returns null if this browser can't (recording is then skipped). */
export function startRecording(src: RecordingSources, opts: { gazeDot?: boolean } = {}): RecordingHandle | null {
  if (!recordingSupported()) return null;
  const { width, height, fps, videoBitsPerSecond, inset } = RECORDING_CONFIG;
  const gazeDot = opts.gazeDot ?? RECORDING_CONFIG.gazeDot;
  const canvas = Object.assign(document.createElement("canvas"), { width, height });
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  let stream: MediaStream;
  let recorder: MediaRecorder;
  let pix: HTMLCanvasElement | null = null;
  const mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t));
  try {
    stream = canvas.captureStream(fps);
    recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond });
  } catch (err) {
    console.warn("recording unavailable:", err instanceof Error ? err.message : err);
    return null;
  }

  const chunks: Blob[] = [];
  let active = true;
  let discarded = false;
  const t0 = performance.now();
  let tEnd = t0;

  const draw = () => {
    const live = src.videos.filter((v): v is HTMLVideoElement => !!v && v.isConnected);
    if (live.length === 0 || performance.now() - t0 > RECORDING_CONFIG.maxDurationMs) {
      // The page went away without stop(): don't keep recording in the background.
      handle.cancel();
      return;
    }
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    const boxes = live.map((v) => toRect(v.getBoundingClientRect()));
    const area = unionRect(boxes) ?? { x: 0, y: 0, w: window.innerWidth || width, h: window.innerHeight || height };
    const t = fitTransform(area, width, height);
    live.forEach((v, i) => {
      if (v.readyState < 2) return;
      const r = containRect(v.videoWidth, v.videoHeight, applyTransform(boxes[i], t));
      try {
        ctx.drawImage(v, r.x, r.y, r.w, r.h);
      } catch {
        // frame not ready
      }
    });
    if (gazeDot) {
      const p = src.gaze?.();
      if (p) {
        const q = applyPoint(p, t);
        ctx.beginPath();
        ctx.arc(q.x, q.y, 7, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 40, 40, 0.75)";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#fff";
        ctx.stroke();
      }
    }
    const cam = src.webcam?.();
    if (cam) {
      const x = width - inset.w - inset.margin;
      const y = height - inset.h - inset.margin;
      try {
        // Pixelate: shrink to a few blocks, then enlarge without smoothing. Never draw the camera at full detail.
        const { w: bw, h: bh } = RECORDING_CONFIG.faceBlocks;
        pix ??= Object.assign(document.createElement("canvas"), { width: bw, height: bh });
        const pctx = pix.getContext("2d");
        if (!pctx) throw new Error("no 2d context");
        pctx.drawImage(cam, 0, 0, bw, bh);
        const smooth = ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(pix, x, y, inset.w, inset.h);
        ctx.imageSmoothingEnabled = smooth;
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#fff";
        ctx.strokeRect(x, y, inset.w, inset.h);
      } catch {
        // camera not ready
      }
    }
  };

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  let timer = 0;
  const finish = () =>
    new Promise<void>((resolve) => {
      window.clearInterval(timer);
      if (recorder.state === "inactive") return resolve();
      recorder.addEventListener("stop", () => resolve(), { once: true });
      try {
        recorder.stop();
      } catch {
        resolve();
      }
    }).then(() => stream.getTracks().forEach((tr) => tr.stop()));

  const handle: RecordingHandle = {
    get active() {
      return active;
    },
    async stop() {
      if (!active) return null;
      active = false;
      tEnd = performance.now();
      await finish();
      if (discarded || chunks.length === 0) return null;
      const type = recorder.mimeType || mimeType || "video/webm";
      const blob = new Blob(chunks, { type });
      return { blob, mimeType: type, durationMs: Math.round(tEnd - t0) };
    },
    cancel() {
      if (!active) return;
      active = false;
      discarded = true;
      void finish();
    },
  };

  // setInterval (not requestAnimationFrame) keeps a steady frame rate.
  draw();
  if (!active) return null;
  timer = window.setInterval(draw, Math.round(1000 / fps));
  try {
    recorder.start(1000);
  } catch {
    handle.cancel();
    return null;
  }
  return handle;
}
