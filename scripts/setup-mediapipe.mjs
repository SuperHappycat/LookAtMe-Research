#!/usr/bin/env node
/**
 * scripts/setup-mediapipe.mjs
 * =============================
 * Puts the MediaPipe files the Research app needs under public/mediapipe so
 * they are served by the app itself (no CDN at runtime, offline-ready):
 *
 *   public/mediapipe/wasm/vision_wasm_internal.{js,wasm}         (copied from node_modules)
 *   public/mediapipe/wasm/vision_wasm_nosimd_internal.{js,wasm}  (copied from node_modules)
 *   public/mediapipe/face_landmarker.task                        (downloaded once from Google)
 *
 * Runs automatically before `npm run dev` and `npm run build` (see package.json).
 * public/mediapipe/ is git-ignored; Vercel runs this during its build.
 *
 * Env:
 *   SKIP_MEDIAPIPE_MODEL=1  skip the model download (CI/sandbox without internet);
 *                           the app builds, but MediaPipe will fail to load at runtime.
 */

import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcWasm = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const outDir = join(root, "public", "mediapipe");
const outWasm = join(outDir, "wasm");
const modelPath = join(outDir, "face_landmarker.task");

// Official model (float16, version 1). Pinned URL.
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const WASM_FILES = [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
];

async function exists(p) {
  try {
    return (await stat(p)).size > 0;
  } catch {
    return false;
  }
}

await mkdir(outWasm, { recursive: true });
for (const f of WASM_FILES) {
  await copyFile(join(srcWasm, f), join(outWasm, f));
}
console.log(`[setup-mediapipe] copied ${WASM_FILES.length} wasm files`);

if (await exists(modelPath)) {
  console.log("[setup-mediapipe] model already present");
} else if (process.env.SKIP_MEDIAPIPE_MODEL === "1") {
  console.warn("[setup-mediapipe] SKIP_MEDIAPIPE_MODEL=1: model NOT downloaded; MediaPipe will not load at runtime");
} else {
  console.log("[setup-mediapipe] downloading face_landmarker.task …");
  const res = await fetch(MODEL_URL);
  if (!res.ok) {
    console.error(`[setup-mediapipe] download failed: HTTP ${res.status}`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1_000_000) {
    console.error(`[setup-mediapipe] downloaded model is suspiciously small (${buf.length} bytes)`);
    process.exit(1);
  }
  await writeFile(modelPath, buf);
  console.log(`[setup-mediapipe] model saved (${(buf.length / 1e6).toFixed(1)} MB)`);
}
