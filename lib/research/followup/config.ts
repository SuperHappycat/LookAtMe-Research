/**
 * lib/research/followup/config.ts
 * =================================
 * Settings for diagnosis follow-up statistics (spec §5.2) and consent withdrawal (§5.3).
 * Every number here is TBD – tune with pilot data. None of them is a clinical cut-off.
 */

export const FOLLOWUP_CONFIG = {
  /**
   * Sensitivity, specificity, PPV and NPV are shown only when their denominator is at least this.
   * Below it the page shows "ข้อมูลยังไม่พอ / Not enough data". TBD – tune with pilot data.
   */
  minNForStats: 10,
  /** Default positive definition on the statistics page (spec: risk_level = 'High'). */
  defaultPositive: "high" as const,
  /** z for a two-sided 95% Wilson interval. */
  z95: 1.959963984540054,
} as const;

/** Why a parent's consent was withdrawn. Only the category is written to the audit log (no child data). */
export const WITHDRAW_REASONS = {
  parent_request: "ผู้ปกครองขอถอนความยินยอม / Parent asked to withdraw",
  entered_in_error: "บันทึกผิดพลาด / Entered in error",
  other: "อื่น ๆ / Other",
} as const;
export type WithdrawReason = keyof typeof WITHDRAW_REASONS;

export const DIAGNOSIS_LABELS = {
  asd: "ออทิสติก (ASD) / ASD",
  not_asd: "ไม่ใช่ออทิสติก / Not ASD",
  other: "การวินิจฉัยอื่น / Other diagnosis",
  pending: "รอผล / Pending",
} as const;
export type DiagnosisResult = keyof typeof DIAGNOSIS_LABELS;
