/**
 * lib/vision/opencvLoader.ts
 * ===========================
 * Loads opencv.js (self-hosted in /public so we control the exact
 * version, rather than depending on an external CDN's uptime) and the
 * Haar cascade XML files into OpenCV.js's virtual filesystem. Browser
 * only -- this whole module is a no-op on the server.
 */

// opencv.js has no official TypeScript types; treat it as an opaque
// namespace object rather than fighting `any` everywhere it's used.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CvNamespace = any;

declare global {
  interface Window {
    cv?: CvNamespace;
  }
}

let loadPromise: Promise<CvNamespace> | null = null;

export function loadOpenCv(): Promise<CvNamespace> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("loadOpenCv() can only run in the browser"));
  }
  if (window.cv && window.cv.Mat) {
    return Promise.resolve(window.cv);
  }
  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = new Promise((resolve, reject) => {
    const onReady = () => {
      const cv = window.cv;
      if (!cv) {
        reject(new Error("opencv.js loaded but window.cv is missing"));
        return;
      }
      if (cv.Mat) {
        resolve(cv);
      } else {
        // The script has loaded but the WASM runtime is still
        // initializing asynchronously.
        cv["onRuntimeInitialized"] = () => resolve(cv);
      }
    };

    const existing = document.getElementById("opencv-js") as HTMLScriptElement | null;
    if (existing) {
      onReady();
      return;
    }

    const script = document.createElement("script");
    script.id = "opencv-js";
    script.src = "/opencv.js";
    script.async = true;
    script.onload = onReady;
    script.onerror = () => reject(new Error("Failed to load /opencv.js"));
    document.body.appendChild(script);
  });

  return loadPromise;
}

const loadedCascades = new Set<string>();

/** Fetches a cascade XML from /public/cascades and registers it with
 * OpenCV.js's in-memory filesystem so `cv.CascadeClassifier.load()`
 * can find it by filename. */
export async function loadCascadeFile(cv: CvNamespace, filename: string): Promise<void> {
  if (loadedCascades.has(filename)) return;
  const response = await fetch(`/cascades/${filename}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch cascade file: ${filename}`);
  }
  const buffer = new Uint8Array(await response.arrayBuffer());
  cv.FS_createDataFile("/", filename, buffer, true, false, false);
  loadedCascades.add(filename);
}
