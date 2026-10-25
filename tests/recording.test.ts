/** Screen recording (spec §4.4): layout math, codec choice, recorder lifecycle, and the browser uploader. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as rec from "../lib/research/recording.ts";
import { itemLevel, uploadRecordingItem, type UploaderDeps } from "../lib/research/drive/uploaderCore.ts";
import { CHUNK_UNIT, DIRECT_CHUNK_BYTES, PROXY_CHUNK_BYTES } from "../lib/research/drive/config.ts";
import { json } from "./drive-fakes.ts";
import type { RecordingQueueItem } from "../lib/research/contracts.ts";

// ------------------------------------------------------------------ layout / codec
test("pickMimeType: vp9 → vp8 → browser default", () => {
  assert.equal(rec.pickMimeType((t) => t.includes("vp9") || t.includes("vp8")), "video/webm;codecs=vp9");
  assert.equal(rec.pickMimeType((t) => t.includes("vp8")), "video/webm;codecs=vp8");
  assert.equal(rec.pickMimeType(() => false), "");
  assert.equal(rec.pickMimeType(() => {
    throw new Error("x");
  }), "");
  assert.equal(rec.pickMimeType(undefined), "");
});

test("two side-by-side videos keep their arrangement inside 640×360", () => {
  const left = { x: 100, y: 200, w: 600, h: 400 };
  const right = { x: 820, y: 200, w: 600, h: 400 };
  const area = rec.unionRect([left, right])!;
  assert.deepEqual(area, { x: 100, y: 200, w: 1320, h: 400 });
  const t = rec.fitTransform(area, 640, 360);
  const l = rec.applyTransform(left, t);
  const r = rec.applyTransform(right, t);
  assert.ok(Math.abs(l.x - 0) < 1e-9, "left edge at 0");
  assert.ok(Math.abs(r.x + r.w - 640) < 1e-9, "right edge at 640");
  assert.ok(l.y > 0 && l.y + l.h < 360, "letterboxed vertically");
  assert.ok(Math.abs(l.y - r.y) < 1e-9);
  assert.ok(r.x > l.x + l.w, "gap preserved");
  // The gaze point maps with the same transform.
  const p = rec.applyPoint({ x: 760, y: 400 }, t);
  assert.ok(Math.abs(p.x - 320) < 1e-9);
  assert.ok(Math.abs(p.y - 180) < 1e-9);
  assert.equal(rec.unionRect([{ x: 0, y: 0, w: 0, h: 10 }]), null);
});

test("containRect letterboxes a 16:9 frame into a 4:3 box", () => {
  const r = rec.containRect(1920, 1080, { x: 0, y: 0, w: 400, h: 300 });
  assert.deepEqual(r, { x: 0, y: 37.5, w: 400, h: 225 });
  assert.deepEqual(rec.containRect(0, 0, { x: 1, y: 2, w: 3, h: 4 }), { x: 1, y: 2, w: 3, h: 4 });
  assert.equal(rec.RECORDING_CONFIG.videoBitsPerSecond, 500_000);
  assert.equal(rec.RECORDING_CONFIG.fps, 15);
});

// ------------------------------------------------------------------ recorder lifecycle with browser fakes
test("startRecording: draws, records with the chosen codec, and returns a RecordingResult", async () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { window: g.window, document: g.document, MediaRecorder: g.MediaRecorder, HTMLCanvasElement: g.HTMLCanvasElement };
  const drawn: string[] = [];
  let recOpts: Record<string, unknown> = {};
  const tracksStopped: number[] = [];
  class FakeCanvas {
    width = 0;
    height = 0;
    getContext() {
      return {
        fillRect: () => drawn.push("bg"),
        drawImage: (_s: unknown, x: number) => drawn.push(`img@${Math.round(x)}`),
        beginPath() {},
        arc() {},
        fill: () => drawn.push("dot"),
        stroke() {},
        strokeRect() {},
        set fillStyle(_v: string) {},
        set strokeStyle(_v: string) {},
        set lineWidth(_v: number) {},
      };
    }
    captureStream(fps: number) {
      assert.equal(fps, 15);
      return { getTracks: () => [{ stop: () => tracksStopped.push(1) }] };
    }
  }
  class FakeRecorder {
    static isTypeSupported = (t: string) => t === "video/webm;codecs=vp8";
    state = "inactive";
    mimeType: string;
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    private l: (() => void)[] = [];
    constructor(_s: unknown, o: Record<string, unknown>) {
      recOpts = o;
      this.mimeType = String(o.mimeType ?? "");
    }
    start() {
      this.state = "recording";
    }
    addEventListener(_e: string, cb: () => void) {
      this.l.push(cb);
    }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob([new Uint8Array(1000)]) });
      this.l.forEach((cb) => cb());
    }
  }
  g.HTMLCanvasElement = FakeCanvas;
  g.MediaRecorder = FakeRecorder;
  g.window = { MediaRecorder: FakeRecorder, setInterval: () => 1, clearInterval() {}, innerWidth: 1280, innerHeight: 720 };
  g.document = { createElement: () => new FakeCanvas() };
  try {
    const video = {
      isConnected: true,
      readyState: 4,
      videoWidth: 1280,
      videoHeight: 720,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    } as unknown as HTMLVideoElement;
    const h = rec.startRecording({ videos: [video], webcam: () => ({}) as CanvasImageSource, gaze: () => ({ x: 640, y: 360 }) })!;
    assert.ok(h && h.active);
    assert.equal(recOpts.mimeType, "video/webm;codecs=vp8");
    assert.equal(recOpts.videoBitsPerSecond, 500_000);
    assert.deepEqual(drawn.slice(0, 2), ["bg", "img@0"]);
    assert.ok(drawn.includes("dot"));
    assert.ok(drawn.includes("img@504"), "webcam inset at the bottom right");
    const r = await h.stop();
    assert.ok(r);
    assert.equal(r!.blob.size, 1000);
    assert.equal(r!.mimeType, "video/webm;codecs=vp8");
    assert.ok(r!.durationMs >= 0);
    assert.equal(tracksStopped.length, 1);
    assert.equal(h.active, false);
    assert.equal(await h.stop(), null, "second stop is a no-op");

    // No connected video → nothing recorded.
    const gone = { ...video, isConnected: false } as unknown as HTMLVideoElement;
    assert.equal(rec.startRecording({ videos: [gone] }), null);
  } finally {
    Object.assign(g, saved);
  }
});

// ------------------------------------------------------------------ uploader
class ReviewError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const SESSION = "5e000000-0000-0000-0000-000000000001";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=XYZ";

function item(over: Partial<RecordingQueueItem & { level: number }> = {}): RecordingQueueItem & { level?: number } {
  return {
    id: "item-1",
    kind: "recording",
    createdAt: new Date().toISOString(),
    orgId: "o",
    attempts: 0,
    sessionId: SESSION,
    clientSessionId: "c",
    childCode: "A-001",
    blobKey: "rec:c:L2:item-1",
    mimeType: "video/webm",
    size: 0,
    target: "google_drive",
    ...over,
  };
}

interface Sent {
  kind: "api" | "google";
  path: string;
  headers: Record<string, string>;
  body?: unknown;
  bodySize?: number;
}

/** Simulated Google resumable session + our API, with optional CORS block on direct PUTs. */
function harness(
  opts: {
    cors?: boolean;
    startCode?: { status: number; code: string };
    failOnce5xx?: boolean;
    quotaOnPut?: boolean;
    preset?: { total: number; received: number };
  } = {},
) {
  const sent: Sent[] = [];
  const store = new Map<string, string>();
  let received = opts.preset?.received ?? 0;
  let total = opts.preset?.total ?? 0;
  let failed = false;
  const googleSide = (range: string, size: number): Response => {
    if (opts.quotaOnPut && range !== `bytes */${total}`) return json({ error: { errors: [{ reason: "storageQuotaExceeded" }] } }, 403);
    if (opts.failOnce5xx && !failed && range !== `bytes */${total}`) {
      failed = true;
      return new Response("busy", { status: 503 });
    }
    const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
    if (m) {
      assert.equal(Number(m[1]), received, "chunks arrive in order");
      assert.equal(Number(m[2]) - Number(m[1]) + 1, size);
      received = Number(m[2]) + 1;
    }
    if (received >= total && total > 0) return json({ id: "drive_file_123" });
    return new Response(null, { status: 308, headers: received ? { range: `bytes=0-${received - 1}` } : {} });
  };
  const d: UploaderDeps = {
    NeedsReview: ReviewError,
    online: () => true,
    sleep: async () => {},
    store: { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v), del: (k) => void store.delete(k) },
    fetch: (async (url: string, init: RequestInit) => {
      const h = Object.fromEntries(new Headers(init.headers).entries());
      const size = init.body instanceof Blob ? init.body.size : 0;
      sent.push({ kind: "google", path: String(url), headers: h, bodySize: size });
      if (opts.cors) throw new TypeError("Failed to fetch");
      return googleSide(h["content-range"], size);
    }) as typeof fetch,
    api: async (path, init = {}) => {
      const h = Object.fromEntries(new Headers(init.headers).entries());
      if (path === "/api/drive/upload-chunk") {
        const size = (init.body as Blob).size;
        sent.push({ kind: "api", path, headers: h, bodySize: size });
        assert.ok(size <= PROXY_CHUNK_BYTES);
        const res = googleSide(h["x-upload-range"], size);
        if (res.status === 308) {
          const r = res.headers.get("range");
          return json({ done: false, nextOffset: r ? Number(/0-(\d+)/.exec(r)![1]) + 1 : 0 });
        }
        if (res.status === 503) return json({ error: "busy" }, 502);
        return json({ done: true, fileId: ((await res.json()) as { id: string }).id });
      }
      const body = JSON.parse(String(init.body));
      sent.push({ kind: "api", path, headers: h, body });
      if (path === "/api/drive/start-upload") {
        if (opts.startCode) return json({ error: "x", code: opts.startCode.code }, opts.startCode.status);
        total = body.size;
        return json({ uploadUrl: UPLOAD_URL, uploadSig: "sig" });
      }
      if (path === "/api/drive/finish-upload") return json({ ok: true });
      throw new Error(`unexpected ${path}`);
    },
  };
  return { d, sent, store };
}

test("itemLevel reads the level field or the blobKey", () => {
  assert.equal(itemLevel(item({ level: 3 })), 3);
  assert.equal(itemLevel(item()), 2);
  assert.equal(itemLevel(item({ blobKey: "x" })), null);
});

test("direct upload: 8 MiB chunks with Content-Range, then finish-upload", async () => {
  const size = DIRECT_CHUNK_BYTES * 2 + 12345;
  const { d, sent, store } = harness();
  const out = await uploadRecordingItem(d, item({ level: 1 }), new Blob([new Uint8Array(size)]));
  assert.equal(out.fileId, "drive_file_123");
  const puts = sent.filter((s) => s.kind === "google");
  assert.equal(puts[0].headers["content-range"], `bytes */${size}`, "starts with a resume query");
  assert.deepEqual(
    puts.slice(1).map((p) => p.headers["content-range"]),
    [`bytes 0-${DIRECT_CHUNK_BYTES - 1}/${size}`, `bytes ${DIRECT_CHUNK_BYTES}-${2 * DIRECT_CHUNK_BYTES - 1}/${size}`, `bytes ${2 * DIRECT_CHUNK_BYTES}-${size - 1}/${size}`],
  );
  for (const p of puts.slice(1, -1)) assert.equal(p.bodySize! % CHUNK_UNIT, 0);
  const finish = sent.find((s) => s.path === "/api/drive/finish-upload")!;
  assert.deepEqual(finish.body, { session_id: SESSION, level: 1, drive_file_id: "drive_file_123", size });
  assert.equal(store.size, 0, "cached session URL removed after finish");
});

test("CORS-blocked PUT falls back to the 3.75 MiB proxy", async () => {
  const size = PROXY_CHUNK_BYTES + 100;
  const { d, sent } = harness({ cors: true });
  const out = await uploadRecordingItem(d, item(), new Blob([new Uint8Array(size)]));
  assert.equal(out.fileId, "drive_file_123");
  const proxied = sent.filter((s) => s.path === "/api/drive/upload-chunk");
  assert.deepEqual(
    proxied.map((p) => p.headers["x-upload-range"]),
    [`bytes */${size}`, `bytes 0-${PROXY_CHUNK_BYTES - 1}/${size}`, `bytes ${PROXY_CHUNK_BYTES}-${size - 1}/${size}`],
  );
  assert.equal(proxied[0].headers["x-upload-sig"], "sig");
  assert.equal(proxied[0].headers["x-session-id"], SESSION);
});

test("5xx is retried; Drive full / reconnect / not connected become NeedsReview", async () => {
  {
    const { d } = harness({ failOnce5xx: true });
    assert.equal((await uploadRecordingItem(d, item(), new Blob([new Uint8Array(1000)]))).fileId, "drive_file_123");
  }
  for (const [status, code] of [[409, "drive_needs_reconnect"], [409, "drive_not_connected"], [507, "drive_full"], [403, "no_recording_consent"]] as const) {
    const { d } = harness({ startCode: { status, code } });
    await assert.rejects(uploadRecordingItem(d, item(), new Blob([new Uint8Array(10)])), (e: ReviewError) => e instanceof ReviewError && e.code === code);
  }
  {
    const { d } = harness({ quotaOnPut: true });
    await assert.rejects(uploadRecordingItem(d, item(), new Blob([new Uint8Array(10)])), (e: ReviewError) => e instanceof ReviewError && e.code === "drive_full");
  }
});

test("no sessionId yet (offline session) → retry later, not review; missing blob → review", async () => {
  const { d, sent } = harness();
  await assert.rejects(uploadRecordingItem(d, item({ sessionId: null }), new Blob([new Uint8Array(10)])), (e: Error) => !(e instanceof ReviewError));
  await assert.rejects(uploadRecordingItem(d, item(), null), (e: ReviewError) => e instanceof ReviewError && e.code === "blob_missing");
  assert.equal(sent.length, 0);
});

test("resume: a cached upload session continues from Google's Range without a new start-upload", async () => {
  const size = 3 * CHUNK_UNIT + 7;
  const h = harness({ preset: { total: size, received: 2 * CHUNK_UNIT } });
  h.store.set("lookatme_upload_item-1", JSON.stringify({ uploadUrl: UPLOAD_URL, uploadSig: "sig", size }));
  const out = await uploadRecordingItem(h.d, item(), new Blob([new Uint8Array(size)]));
  assert.equal(out.fileId, "drive_file_123");
  assert.equal(h.sent.filter((s) => s.path === "/api/drive/start-upload").length, 0);
  const puts = h.sent.filter((s) => s.kind === "google").map((p) => p.headers["content-range"]);
  assert.deepEqual(puts, [`bytes */${size}`, `bytes ${2 * CHUNK_UNIT}-${size - 1}/${size}`]);
});
