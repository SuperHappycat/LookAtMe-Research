/*
 * public/sw.js — LookAtMe Research service worker (offline mode, spec §5.4; agent E).
 * Registered in production only, by components/research/offline/OfflineBoot.tsx.
 *
 * - Cache-first: stimulus videos, MediaPipe WASM + model, OpenCV.js, Haar cascades,
 *   the gaze worker and Next.js static chunks (/_next/static/* are content-hashed).
 * - Network-first with a cached fallback: navigations to the screening pages
 *   (/r/check, /calibrate, /test1–3, /summary, /r/offline).
 * - Never cached: Supabase (other origin), /api/*, anything that isn't a same-origin GET.
 * - The cache name is versioned; old caches are deleted on activate. Bump VERSION when the
 *   caching rules or the asset list change (hashed chunks don't need a bump).
 *
 * Privacy: only static files and page shells are cached here (the pages render child data in
 * the browser from IndexedDB/Supabase); no API or database responses are ever stored.
 */

const VERSION = "v2";
const PREFIX = "lookatme-research-";
const STATIC_CACHE = `${PREFIX}static-${VERSION}`;
const PAGE_CACHE = `${PREFIX}pages-${VERSION}`;

/** Big files the screening needs offline even if they were never played online. */
const PRECACHE = [
  "/videos/human.mp4",
  "/videos/geometric.mp4",
  "/videos/talking.mp4",
  "/videos/rja.mp4",
  "/opencv.js",
  "/cascades/haarcascade_frontalface_default.xml",
  "/cascades/haarcascade_eye.xml",
  "/gaze-worker.js",
  "/mediapipe/face_landmarker.task",
  "/mediapipe/wasm/vision_wasm_internal.js",
  "/mediapipe/wasm/vision_wasm_internal.wasm",
];

/** Pages kept for offline use (network-first). */
const OFFLINE_PAGES = ["/r/check", "/calibrate", "/test1", "/test2", "/test3", "/summary", "/r/offline"];

const CACHE_FIRST = [/^\/videos\//, /^\/mediapipe\//, /^\/opencv\.js$/, /^\/cascades\//, /^\/gaze-worker\.js$/, /^\/_next\/static\//];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      // One missing file (e.g. no MediaPipe model in a test build) must not stop the install.
      await Promise.allSettled(PRECACHE.map((url) => addToCache(cache, url)));
      await Promise.allSettled(OFFLINE_PAGES.map((p) => warmPage(p)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC_CACHE, PAGE_CACHE]);
      for (const name of await caches.keys()) {
        if (name.startsWith(PREFIX) && !keep.has(name)) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "warm-pages") {
    event.waitUntil(Promise.allSettled(OFFLINE_PAGES.map((p) => warmPage(p))));
  }
});

async function addToCache(cache, url) {
  if (await cache.match(url)) return;
  const res = await fetch(url, { cache: "no-cache" });
  if (res.ok && res.status === 200) await cache.put(url, res);
}

/** Caches a page's HTML and the static chunks it references, so it can open offline. */
async function warmPage(path) {
  const res = await fetch(path, { credentials: "same-origin", cache: "no-cache" });
  if (!res.ok || !(res.headers.get("content-type") || "").includes("text/html")) return;
  const html = await res.clone().text();
  const pages = await caches.open(PAGE_CACHE);
  await pages.put(path, res);
  const statics = await caches.open(STATIC_CACHE);
  const urls = new Set();
  for (const m of html.matchAll(/["'(](\/_next\/static\/[^"'()\s\\]+)/g)) urls.add(m[1]);
  await Promise.allSettled([...urls].map((u) => addToCache(statics, u)));
}

function isOfflinePage(pathname) {
  const p = pathname.replace(/\/+$/, "") || "/";
  return OFFLINE_PAGES.includes(p);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase and other origins: never touched
  if (url.pathname.startsWith("/api/") || url.pathname === "/sw.js") return;

  if (req.mode === "navigate") {
    event.respondWith(navigation(req, url));
    return;
  }
  if (req.headers.get("RSC") || url.searchParams.has("_rsc")) return; // router data: network only
  if (CACHE_FIRST.some((re) => re.test(url.pathname))) {
    event.respondWith(cacheFirst(req, url));
  }
});

async function navigation(req, url) {
  const key = url.pathname.replace(/\/+$/, "") || "/";
  try {
    const res = await fetch(req);
    if (res.ok && isOfflinePage(key)) {
      const cache = await caches.open(PAGE_CACHE);
      await cache.put(key, res.clone());
    }
    return res;
  } catch (err) {
    const cached = await caches.match(key, { cacheName: PAGE_CACHE });
    if (cached) return cached;
    return offlineFallback();
  }
}

async function cacheFirst(req, url) {
  const cache = await caches.open(STATIC_CACHE);
  const key = url.pathname; // ignore query strings and Range headers for the cache key
  const cached = await cache.match(key);
  const range = req.headers.get("range");
  if (cached) return range ? rangeResponse(cached, range) : cached;

  if (range) {
    // <video> asks for byte ranges (206s can't be cached): fetch the whole file once in the
    // background for next time, and answer this request from the network.
    fetch(key)
      .then((full) => (full.ok && full.status === 200 ? cache.put(key, full) : undefined))
      .catch(() => undefined);
    return fetch(req);
  }
  const res = await fetch(req);
  if (res.ok && res.status === 200) await cache.put(key, res.clone());
  return res;
}

/** Serves "Range: bytes=a-b" from a cached full response. */
async function rangeResponse(full, range) {
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  const buf = await full.arrayBuffer();
  const size = buf.byteLength;
  if (!m) return new Response(buf, { status: 200, headers: full.headers });
  let start = m[1] === "" ? NaN : Number(m[1]);
  let end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (Number.isNaN(start)) {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  const headers = new Headers(full.headers);
  headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  headers.set("Content-Length", String(end - start + 1));
  headers.set("Accept-Ranges", "bytes");
  return new Response(buf.slice(start, end + 1), { status: 206, statusText: "Partial Content", headers });
}

function offlineFallback() {
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ออฟไลน์ / Offline</title><style>body{font-family:system-ui,sans-serif;background:#f4f7fc;color:#0f1b2d;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px}
main{background:#fff;border:1px solid #dde4f0;border-radius:20px;padding:28px;max-width:520px;text-align:center}a{display:inline-block;margin-top:16px;background:#2563eb;color:#fff;padding:13px 26px;border-radius:999px;text-decoration:none;font-weight:600;min-height:44px}</style></head>
<body><main><h1>ออฟไลน์ / Offline</h1><p>หน้านี้ใช้งานแบบออฟไลน์ไม่ได้ / This page isn't available offline.</p>
<a href="/r/offline">ข้อมูลออฟไลน์ / Offline data</a></main></body></html>`;
  return new Response(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
