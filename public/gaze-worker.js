/**
 * public/gaze-worker.js
 * ======================
 * Runs the entire classical-CV pipeline (OpenCV.js load, face/eye
 * detection, pupil localization, gaze smoothing/classification) off
 * the main thread. Loading opencv.js's ~10MB WASM binary is a heavy,
 * effectively-synchronous operation (it's embedded as a base64 data
 * URI, which disables streaming compilation) -- doing that on the main
 * thread froze the whole page for several seconds. A classic Web
 * Worker (not a module worker) is used specifically so opencv.js's
 * `importScripts()`-based UMD loader works unmodified.
 *
 * This intentionally duplicates (rather than imports) the logic in
 * lib/vision/*.ts, because a classic worker can't `import` TypeScript
 * modules the way the main thread's Next.js bundle can. Keep the two
 * in sync if you change the tracking algorithm.
 *
 * Message protocol (main thread -> worker):
 *   { type: "init" }
 *   { type: "reset" }                                  -- clear gaze calibration for a new test run
 *   { type: "frame", width, height, buffer }            -- one RGBA frame (transferable ArrayBuffer)
 * Message protocol (worker -> main thread):
 *   { type: "ready" }
 *   { type: "error", message }
 *   { type: "result", sample: { direction, eyesDetected, confidence, screenX, screenY } }
 */

importScripts("/opencv.js");

let faceCascade = null;
let eyeCascade = null;
let initialized = false;

function waitForCv() {
  return new Promise((resolve) => {
    if (cv.Mat) {
      resolve();
      return;
    }
    cv["onRuntimeInitialized"] = () => resolve();
  });
}

async function loadCascadeFile(filename) {
  const res = await fetch(`/cascades/${filename}`);
  if (!res.ok) throw new Error(`Failed to fetch cascade file: ${filename}`);
  const buffer = new Uint8Array(await res.arrayBuffer());
  cv.FS_createDataFile("/", filename, buffer, true, false, false);
}

async function init() {
  await waitForCv();
  await loadCascadeFile("haarcascade_frontalface_default.xml");
  await loadCascadeFile("haarcascade_eye.xml");

  faceCascade = new cv.CascadeClassifier();
  if (!faceCascade.load("haarcascade_frontalface_default.xml")) {
    throw new Error("Failed to load face cascade");
  }
  eyeCascade = new cv.CascadeClassifier();
  if (!eyeCascade.load("haarcascade_eye.xml")) {
    throw new Error("Failed to load eye cascade");
  }
  initialized = true;
}

// ---- Port of vision/face_tracker.py ------------------------------------
function detectFace(gray) {
  const equalized = new cv.Mat();
  cv.equalizeHist(gray, equalized);

  const faces = new cv.RectVector();
  faceCascade.detectMultiScale(equalized, faces, 1.1, 5, 0, new cv.Size(80, 80), new cv.Size(0, 0));

  if (faces.size() === 0) {
    faces.delete();
    equalized.delete();
    return { found: false, roiGray: null };
  }

  let best = faces.get(0);
  for (let i = 1; i < faces.size(); i++) {
    const r = faces.get(i);
    if (r.width * r.height > best.width * best.height) best = r;
  }
  faces.delete();

  const rect = new cv.Rect(best.x, best.y, best.width, best.height);
  const roiView = equalized.roi(rect);
  const roiGray = roiView.clone();
  roiView.delete();
  equalized.delete();

  return { found: true, roiGray };
}

// ---- Port of vision/eye_tracker.py --------------------------------------
function locatePupil(eyeRoiGray) {
  const fullH = eyeRoiGray.rows;
  const fullW = eyeRoiGray.cols;
  if (fullH < 6 || fullW < 6) return null;

  const x0 = Math.floor(fullW * 0.08);
  const x1 = Math.floor(fullW * 0.92);
  const y0 = Math.floor(fullH * 0.15);
  const y1 = Math.floor(fullH * 0.85);
  const cropW = x1 - x0;
  const cropH = y1 - y0;
  if (cropW < 4 || cropH < 4) return null;

  const cropView = eyeRoiGray.roi(new cv.Rect(x0, y0, cropW, cropH));
  const crop = cropView.clone();
  cropView.delete();

  const blurred = new cv.Mat();
  cv.GaussianBlur(crop, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
  crop.delete();

  const enhanced = new cv.Mat();
  const clahe = new cv.CLAHE(2.0, new cv.Size(4, 4));
  clahe.apply(blurred, enhanced);
  clahe.delete();
  blurred.delete();

  const thresh = new cv.Mat();
  cv.threshold(enhanced, thresh, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
  enhanced.delete();

  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
  const opened = new cv.Mat();
  cv.morphologyEx(thresh, opened, cv.MORPH_OPEN, kernel);
  kernel.delete();
  thresh.delete();

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(opened, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  hierarchy.delete();
  opened.delete();

  const cropArea = cropW * cropH;
  let bestScore = -1;
  let bestCentroid = null;

  for (let i = 0; i < contours.size(); i++) {
    const c = contours.get(i);
    const area = cv.contourArea(c);
    const areaFrac = area / cropArea;
    if (areaFrac < 0.03 || areaFrac > 0.55) {
      c.delete();
      continue;
    }
    const perimeter = cv.arcLength(c, true);
    if (perimeter <= 0) {
      c.delete();
      continue;
    }
    const circularity = Math.min(1, (4 * Math.PI * area) / (perimeter * perimeter));
    const m = cv.moments(c);
    c.delete();
    if (m.m00 === 0) continue;
    const cx = m.m10 / m.m00;
    const cy = m.m01 / m.m00;

    const verticalOffset = Math.abs(cy / cropH - 0.5);
    const centeringScore = 1 - Math.min(1, verticalOffset * 2);

    const score = 0.6 * circularity + 0.4 * centeringScore;
    if (score > bestScore) {
      bestScore = score;
      bestCentroid = [cx, cy];
    }
  }
  contours.delete();

  if (!bestCentroid) return null;
  const [cx, cy] = bestCentroid;
  return [(x0 + cx) / fullW, (y0 + cy) / fullH];
}

function analyzeEyes(faceRoiGray) {
  const h = faceRoiGray.rows;
  const w = faceRoiGray.cols;
  const searchH = Math.max(1, Math.floor(h * 0.65));
  const searchRegion = faceRoiGray.roi(new cv.Rect(0, 0, w, searchH));

  const eyes = new cv.RectVector();
  eyeCascade.detectMultiScale(searchRegion, eyes, 1.1, 6, 0, new cv.Size(25, 25), new cv.Size(0, 0));

  if (eyes.size() === 0) {
    eyes.delete();
    searchRegion.delete();
    return { eyesDetected: false, observations: [] };
  }

  const boxes = [];
  for (let i = 0; i < eyes.size(); i++) {
    const r = eyes.get(i);
    boxes.push({ x: r.x, y: r.y, width: r.width, height: r.height });
  }
  eyes.delete();
  boxes.sort((a, b) => b.width * b.height - a.width * a.height);
  const top = boxes.slice(0, 2);

  const observations = top.map((box) => {
    const eyeRoiView = searchRegion.roi(new cv.Rect(box.x, box.y, box.width, box.height));
    const eyeRoi = eyeRoiView.clone();
    eyeRoiView.delete();
    const pupilNorm = locatePupil(eyeRoi);
    eyeRoi.delete();
    return { pupilNorm };
  });

  searchRegion.delete();
  return { eyesDetected: true, observations };
}

// ---- Port of vision/gaze_estimation.py ----------------------------------
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

class GazeEstimator {
  constructor(options = {}) {
    this.leftThreshold = options.leftThreshold ?? 0.4;
    this.rightThreshold = options.rightThreshold ?? 0.6;
    this.alpha = options.smoothingAlpha ?? 0.35;
    this.medianWindow = Math.max(1, options.medianWindow ?? 5);
    this.minCalibrationSpread = options.minCalibrationSpread ?? 0.08;
    this.centerBandFrac = options.centerBandFrac ?? 0.35;
    this.smoothedX = null;
    this.smoothedY = null;
    this.rawXWindow = [];
    this.rawYWindow = [];
    this.observedMinX = null;
    this.observedMaxX = null;
  }

  update(eyesResult) {
    const now = Date.now() / 1000;

    if (!eyesResult.eyesDetected || eyesResult.observations.length === 0) {
      return { timestamp: now, direction: "Unknown", screenX: null, screenY: null, eyesDetected: false, confidence: 0 };
    }

    const validPupils = eyesResult.observations.map((o) => o.pupilNorm).filter((p) => p !== null);
    if (validPupils.length === 0) {
      return { timestamp: now, direction: "Unknown", screenX: null, screenY: null, eyesDetected: true, confidence: 0.2 };
    }

    const avgX = validPupils.reduce((s, p) => s + p[0], 0) / validPupils.length;
    const avgY = validPupils.reduce((s, p) => s + p[1], 0) / validPupils.length;

    this.rawXWindow = [...this.rawXWindow, avgX].slice(-this.medianWindow);
    this.rawYWindow = [...this.rawYWindow, avgY].slice(-this.medianWindow);
    const denoisedX = median(this.rawXWindow);
    const denoisedY = median(this.rawYWindow);

    this.smoothedX = this.smoothedX === null ? denoisedX : this.alpha * denoisedX + (1 - this.alpha) * this.smoothedX;
    this.smoothedY = this.smoothedY === null ? denoisedY : this.alpha * denoisedY + (1 - this.alpha) * this.smoothedY;

    if (this.observedMinX === null || this.smoothedX < this.observedMinX) this.observedMinX = this.smoothedX;
    if (this.observedMaxX === null || this.smoothedX > this.observedMaxX) this.observedMaxX = this.smoothedX;

    const direction = this.classify(this.smoothedX);
    const confidence = validPupils.length === 2 ? 1.0 : 0.6;

    return {
      timestamp: now,
      direction,
      screenX: this.smoothedX,
      screenY: this.smoothedY,
      eyesDetected: true,
      confidence,
    };
  }

  domain() {
    if (
      this.observedMinX !== null &&
      this.observedMaxX !== null &&
      this.observedMaxX - this.observedMinX >= this.minCalibrationSpread
    ) {
      return [this.observedMinX, this.observedMaxX, true];
    }
    const band = Math.max(this.rightThreshold - this.leftThreshold, 1e-6);
    return [this.leftThreshold - band, this.rightThreshold + band, false];
  }

  relative(normX, lo, hi) {
    const spread = hi > lo ? hi - lo : 1.0;
    return Math.max(0, Math.min(1, (normX - lo) / spread));
  }

  classify(normX) {
    const [lo, hi, calibrated] = this.domain();
    if (calibrated) {
      const relative = this.relative(normX, lo, hi);
      const low = (1 - this.centerBandFrac) / 2;
      const high = 1 - low;
      if (relative < low) return "Left";
      if (relative > high) return "Right";
      return "Center";
    }
    if (normX < this.leftThreshold) return "Left";
    if (normX > this.rightThreshold) return "Right";
    return "Center";
  }
}

let gazeEstimator = new GazeEstimator();
let busy = false;

self.onmessage = async (e) => {
  const msg = e.data;

  if (msg.type === "init") {
    try {
      await init();
      self.postMessage({ type: "ready" });
    } catch (err) {
      self.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (msg.type === "reset") {
    gazeEstimator = new GazeEstimator();
    return;
  }

  if (msg.type === "frame") {
    if (!initialized || busy) return;
    busy = true;
    try {
      const { width, height, buffer } = msg;
      const imageData = new ImageData(new Uint8ClampedArray(buffer), width, height);
      const src = cv.matFromImageData(imageData);
      const gray = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      src.delete();

      const faceResult = detectFace(gray);
      gray.delete();

      let eyesResult = { eyesDetected: false, observations: [] };
      if (faceResult.found && faceResult.roiGray) {
        eyesResult = analyzeEyes(faceResult.roiGray);
        faceResult.roiGray.delete();
      }

      const sample = gazeEstimator.update(eyesResult);
      self.postMessage({ type: "result", sample });
    } catch (err) {
      self.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      busy = false;
    }
  }
};
