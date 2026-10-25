/**
 * lib/research/studies/config.ts
 * ================================
 * Tunable numbers for multi-site studies. None of these are clinical cut-offs.
 */

export const STUDIES_CONFIG = {
  /** Days an invite code stays valid (the database clamps it to 1–30). TBD – confirm with the study team. */
  inviteDays: 14,
  /**
   * In the combined summary, a site (or the total) with fewer scored sessions than this shows "n < X" instead of
   * means and medians, so a single child's result can't be read off. TBD – tune with pilot data / ethics advice.
   */
  minCellN: 3,
  /** Mirrors redeem_study_invite(): failed code redemptions allowed per org per hour. Documentation only. */
  maxJoinFailuresPerHour: 10,
  /** Rows per page when the server reads sessions (PostgREST returns at most 1000 per request). */
  pageSize: 1000,
} as const;
