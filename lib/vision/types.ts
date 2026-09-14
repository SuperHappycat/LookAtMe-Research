/**
 * lib/vision/types.ts
 * ====================
 * Shared types for the in-browser classical-CV gaze pipeline. Mirrors
 * the dataclasses in the original Python desktop app (vision/*.py) so
 * the two implementations stay easy to compare.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FaceDetection {
  found: boolean;
  box: Rect | null;
}

export interface EyeObservation {
  box: Rect; // relative to the face ROI
  pupilNorm: [number, number] | null; // normalized (0-1, 0-1) within `box`
}

export interface EyesResult {
  eyesDetected: boolean;
  observations: EyeObservation[];
}

export type GazeDirection = "Left" | "Center" | "Right" | "Unknown";

export interface GazeSample {
  timestamp: number;
  direction: GazeDirection;
  screenX: number | null; // normalized 0-1, smoothed pupil-in-eye-box x
  screenY: number | null;
  eyesDetected: boolean;
  confidence: number;
}

export interface GaugeState {
  value: number;
  zoneLow: number;
  zoneHigh: number;
}
