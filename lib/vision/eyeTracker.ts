/**
 * lib/vision/eyeTracker.ts
 * =========================
 * Port of vision/eye_tracker.py (including the circularity/centering
 * scored pupil localization, not the older "largest blob" version):
 *
 * 1. Haar-cascade eye detection within the upper 65% of the face ROI.
 * 2. Per eye, crop in from the box edges (lash/lid clutter lives
 *    there), CLAHE-normalize contrast, Otsu-threshold, clean with a
 *    morphological opening, then score every resulting blob by how
 *    pupil-like it is (round, plausibly sized, near vertical center)
 *    instead of just taking the largest one.
 */

import { loadCascadeFile, type CvNamespace } from "./opencvLoader";
import type { EyeObservation, EyesResult, Rect } from "./types";

export class EyeTracker {
  private constructor(private cv: CvNamespace, private classifier: CvNamespace) {}

  static async create(cv: CvNamespace, cascadeFilename = "haarcascade_eye.xml"): Promise<EyeTracker> {
    await loadCascadeFile(cv, cascadeFilename);
    const classifier = new cv.CascadeClassifier();
    const ok = classifier.load(cascadeFilename);
    if (!ok) {
      throw new Error(`Failed to load eye cascade: ${cascadeFilename}`);
    }
    return new EyeTracker(cv, classifier);
  }

  /** `faceRoiGray` -- caller keeps ownership and must delete it after this call. */
  analyze(faceRoiGray: CvNamespace): EyesResult {
    const cv = this.cv;
    const h = faceRoiGray.rows;
    const w = faceRoiGray.cols;
    const searchH = Math.max(1, Math.floor(h * 0.65));
    const searchRegion = faceRoiGray.roi(new cv.Rect(0, 0, w, searchH));

    const eyes = new cv.RectVector();
    const minSize = new cv.Size(25, 25);
    const maxSize = new cv.Size(0, 0);
    this.classifier.detectMultiScale(searchRegion, eyes, 1.1, 6, 0, minSize, maxSize);

    if (eyes.size() === 0) {
      eyes.delete();
      searchRegion.delete();
      return { eyesDetected: false, observations: [] };
    }

    const boxes: Rect[] = [];
    for (let i = 0; i < eyes.size(); i++) {
      const r = eyes.get(i);
      boxes.push({ x: r.x, y: r.y, width: r.width, height: r.height });
    }
    eyes.delete();
    boxes.sort((a, b) => b.width * b.height - a.width * a.height);
    const top = boxes.slice(0, 2);

    const observations: EyeObservation[] = top.map((box) => {
      const eyeRoiView = searchRegion.roi(new cv.Rect(box.x, box.y, box.width, box.height));
      const eyeRoi = eyeRoiView.clone();
      eyeRoiView.delete();
      const pupilNorm = this.locatePupil(eyeRoi);
      eyeRoi.delete();
      return { box, pupilNorm };
    });

    searchRegion.delete();
    return { eyesDetected: true, observations };
  }

  private locatePupil(eyeRoiGray: CvNamespace): [number, number] | null {
    const cv = this.cv;
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
    let bestCentroid: [number, number] | null = null;

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

  delete(): void {
    this.classifier.delete();
  }
}
