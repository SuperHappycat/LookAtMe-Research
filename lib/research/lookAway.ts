/**
 * lib/research/lookAway.ts
 * ==========================
 * Pause-when-the-child-looks-away (gaze-contingent presentation, common in infant eye-tracking): the
 * stimulus pauses after the child has looked away for `awayAfterMs`, and resumes once they look back for
 * `backAfterMs` (or after `maxPauseMs`, so a test never stalls). Paused time is not scored.
 *
 * "Away" = no face, or (calibrated engine) a gaze point off the screen. Pausing only happens after the
 * child has been looking for `armAfterMs` since the start / last resume, so a camera that never finds the
 * face (or a child who never looks) doesn't cause a pause loop. `maxTotalPauseMs` caps pausing per test.
 * Pure logic: unit-tested in tests/look-away.test.ts.
 */

export interface LookAwayConfig {
  enabled: boolean;
  awayAfterMs: number;
  backAfterMs: number;
  maxPauseMs: number;
  armAfterMs: number;
  maxTotalPauseMs: number;
  /** Off-screen margin (fraction of the viewport) before a gaze point counts as "away". */
  offscreenMargin: number;
}

export const LOOK_AWAY_DEFAULTS: LookAwayConfig = {
  enabled: true,
  awayAfterMs: 1500,
  backAfterMs: 400,
  maxPauseMs: 8000,
  armAfterMs: 1000,
  maxTotalPauseMs: 30000,
  offscreenMargin: 0.1,
};

export type LookAwayEvent = "pause" | "resume" | null;

/** Is this sample "looking away"? */
export function isAway(
  s: { faceFound: boolean; point: { x: number; y: number } | null; direction: string },
  viewport: { w: number; h: number },
  margin: number,
): boolean {
  if (!s.faceFound) return true;
  if (s.point) {
    const mx = viewport.w * margin;
    const my = viewport.h * margin;
    return s.point.x < -mx || s.point.x > viewport.w + mx || s.point.y < -my || s.point.y > viewport.h + my;
  }
  return s.direction === "Unknown";
}

export class LookAwayTracker {
  private cfg: LookAwayConfig;
  paused = false;
  pauses = 0;
  totalPausedMs = 0;
  private lookingSince: number | null = null;
  private awaySince: number | null = null;
  private backSince: number | null = null;
  private pausedAt = 0;
  private armed = false;

  constructor(cfg: LookAwayConfig = LOOK_AWAY_DEFAULTS) {
    this.cfg = cfg;
  }

  /** Feed one sample; returns "pause" / "resume" when the state changes. */
  update(away: boolean, now: number): LookAwayEvent {
    const c = this.cfg;
    if (!c.enabled) return null;
    if (!this.paused) {
      if (!away) {
        this.awaySince = null;
        this.lookingSince ??= now;
        if (now - this.lookingSince >= c.armAfterMs) this.armed = true;
        return null;
      }
      this.lookingSince = null;
      this.awaySince ??= now;
      if (this.armed && this.totalPausedMs < c.maxTotalPauseMs && now - this.awaySince >= c.awayAfterMs) {
        this.paused = true;
        this.pauses += 1;
        this.pausedAt = now;
        this.backSince = null;
        return "pause";
      }
      return null;
    }
    // paused
    if (!away) this.backSince ??= now;
    else this.backSince = null;
    const back = this.backSince !== null && now - this.backSince >= c.backAfterMs;
    const tooLong = now - this.pausedAt >= Math.min(c.maxPauseMs, c.maxTotalPauseMs - this.totalPausedMs);
    if (back || tooLong) return this.resume(now, back);
    return null;
  }

  private resume(now: number, lookingNow: boolean): LookAwayEvent {
    this.totalPausedMs += now - this.pausedAt;
    this.paused = false;
    this.awaySince = null;
    // After a timeout resume the child must look again before the next pause can happen.
    this.armed = lookingNow;
    this.lookingSince = lookingNow ? now : null;
    return "resume";
  }

  /** Ends an open pause (e.g. the test was stopped while paused). */
  finish(now: number) {
    if (this.paused) {
      this.totalPausedMs += now - this.pausedAt;
      this.paused = false;
    }
  }
}
