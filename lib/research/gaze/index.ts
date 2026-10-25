"use client";

/**
 * lib/research/gaze/index.ts
 * ============================
 * Picks the active gaze engine from RESEARCH_CONFIG.gazeEngine.
 */

import { RESEARCH_CONFIG } from "../config";
import { mediapipeEngine } from "./mediapipeEngine";
import { opencvEngine } from "./opencvEngine";
import type { GazeEngine } from "./types";

export function getGazeEngine(): GazeEngine {
  return RESEARCH_CONFIG.gazeEngine === "opencv" ? opencvEngine : mediapipeEngine;
}

export type { GazeEngine, EngineSample, EngineMessage, EngineStatus, GazePoint } from "./types";
