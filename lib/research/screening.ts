/**
 * lib/research/screening.ts
 * ===========================
 * The Research "screening context": which organization, child and database
 * session the current test run belongs to. Lives in sessionStorage next to
 * the original app's lib/sessionState.ts (which the test pages still use for
 * per-test results). No child names: the child's code is used as the
 * "patient name" the original pages display.
 */

import { startNewSession, clearSession } from "../sessionState";
import { clearGazeLog } from "./gazeLog";

export interface ResearchContext {
  orgId: string;
  childId: string;
  childCode: string;
  sessionId: string;
  clientSessionId: string;
  engine: string;
  startedAt: string;
  /** Child's age in months at the start of the screening (chooses child-mode calibration). */
  ageMonths?: number | null;
  /** Parent consented to video recording (A records only when true). Set by the start flow (B/E). */
  allowRecording?: boolean;
  /** Blind mode: staff must not see the result on the summary page (B). */
  blind?: boolean;
  /** True when the session was started offline; sessionId is then "" until it syncs (E). */
  offline?: boolean;
  /** Demo mode (lib/research/demo.ts): the summary shows this overall score and nothing is saved. */
  demo?: { score: number };
  cameraCheck?: {
    faceFoundPct: number | null;
    meanLuma: number | null;
    medianFaceScale: number | null;
    passed: boolean;
  };
}

const KEY = "lookatme_research_ctx";

export function getResearchContext(): ResearchContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ResearchContext) : null;
  } catch {
    return null;
  }
}

export function setResearchContext(ctx: ResearchContext) {
  window.sessionStorage.setItem(KEY, JSON.stringify(ctx));
}

export function beginResearchScreening(ctx: ResearchContext, birthMonth: string | null) {
  clearGazeLog();
  setResearchContext(ctx);
  // The original test pages require a "patient" in session state.
  startNewSession({ name: ctx.childCode, email: "", dateOfBirth: birthMonth ?? "", province: "" });
}

export function endResearchScreening() {
  clearGazeLog();
  clearSession();
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** Age in whole months at a date, from a birth month stored as YYYY-MM-01. */
export function ageInMonths(birthMonth: string | null, at: Date = new Date()): number | null {
  if (!birthMonth) return null;
  const [y, m] = birthMonth.split("-").map(Number);
  if (!y || !m) return null;
  return (at.getFullYear() - y) * 12 + (at.getMonth() + 1 - m);
}
