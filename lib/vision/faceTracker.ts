/**
 * lib/vision/faceTracker.ts
 * ==========================
 * Port of vision/face_tracker.py: Haar-cascade face detection, largest
 * face wins, histogram-equalized before detecting (helps in low light)
 * -- same equalized Mat is what the ROI is cropped from, matching the
 * Python version exactly.
 */

import { loadCascadeFile, type CvNamespace } from "./opencvLoader";
import type { FaceDetection, Rect } from "./types";

export interface FaceDetectResult {
  detection: FaceDetection;
  /** Caller owns this Mat and must call .delete() on it. Null if no face found. */
  roiGray: CvNamespace | null;
}

export class FaceTracker {
  private constructor(private cv: CvNamespace, private classifier: CvNamespace) {}

  static async create(cv: CvNamespace, cascadeFilename = "haarcascade_frontalface_default.xml"): Promise<FaceTracker> {
    await loadCascadeFile(cv, cascadeFilename);
    const classifier = new cv.CascadeClassifier();
    const ok = classifier.load(cascadeFilename);
    if (!ok) {
      throw new Error(`Failed to load face cascade: ${cascadeFilename}`);
    }
    return new FaceTracker(cv, classifier);
  }

  /** `gray` is a single-channel grayscale Mat. Caller keeps ownership of `gray`. */
  detect(gray: CvNamespace): FaceDetectResult {
    const cv = this.cv;

    const equalized = new cv.Mat();
    cv.equalizeHist(gray, equalized);

    const faces = new cv.RectVector();
    const minSize = new cv.Size(80, 80);
    const maxSize = new cv.Size(0, 0);
    this.classifier.detectMultiScale(equalized, faces, 1.1, 5, 0, minSize, maxSize);

    if (faces.size() === 0) {
      faces.delete();
      equalized.delete();
      return { detection: { found: false, box: null }, roiGray: null };
    }

    let best = faces.get(0);
    for (let i = 1; i < faces.size(); i++) {
      const r = faces.get(i);
      if (r.width * r.height > best.width * best.height) best = r;
    }
    const box: Rect = { x: best.x, y: best.y, width: best.width, height: best.height };
    faces.delete();

    const rect = new cv.Rect(box.x, box.y, box.width, box.height);
    const roiView = equalized.roi(rect);
    const roiGray = roiView.clone();
    roiView.delete();
    equalized.delete();

    return { detection: { found: true, box }, roiGray };
  }

  delete(): void {
    this.classifier.delete();
  }
}
