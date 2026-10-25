/**
 * lib/research/gaze/direction.ts
 * ================================
 * Turns a calibrated gaze point into the Left / Center / Right value the
 * original scoring files read, using where the stimulus videos are on screen.
 *
 * - Two videos side by side (Test 1): inside or left of the left video's
 *   right edge -> "Left"; inside or right of the right video's left edge ->
 *   "Right"; the gap between them -> "Center" (scored as "Other", same as
 *   the OpenCV engine's Center).
 * - One video (Test 2, Test 3): inside the video (plus a margin) -> "Center"
 *   ("on target"); otherwise Left/Right of the video's centre.
 * - No point -> "Unknown".
 */

import type { GazeDirection, GazePoint } from "./types";

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function directionFromPoint(
  point: GazePoint | null,
  stimulusBoxes: Box[],
  marginPx: number,
): GazeDirection {
  if (!point) return "Unknown";
  const boxes = stimulusBoxes
    .filter((b) => b.right > b.left && b.bottom > b.top)
    .sort((a, b) => a.left - b.left);
  if (boxes.length === 0) return "Unknown";

  if (boxes.length >= 2) {
    const leftBox = boxes[0];
    const rightBox = boxes[boxes.length - 1];
    if (point.x <= leftBox.right) return "Left";
    if (point.x >= rightBox.left) return "Right";
    return "Center";
  }

  const b = boxes[0];
  const inside =
    point.x >= b.left - marginPx &&
    point.x <= b.right + marginPx &&
    point.y >= b.top - marginPx &&
    point.y <= b.bottom + marginPx;
  if (inside) return "Center";
  return point.x < (b.left + b.right) / 2 ? "Left" : "Right";
}
