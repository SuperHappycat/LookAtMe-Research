/**
 * lib/research/studies/messages.ts
 * ==================================
 * Error codes raised by the study RPCs → HTTP status and a Thai / English message.
 * Shared by the server routes and the browser (safe to import anywhere).
 */

export const STUDY_ERRORS: [code: string, status: number, text: string][] = [
  ["feature_not_in_plan", 403, "แผนนี้ไม่มีโครงการหลายสถานที่ หรือหมดอายุ / Multi-site studies need an active Hospital plan."],
  ["too_many_attempts", 429, "ลองรหัสผิดหลายครั้งเกินไป กรุณารอ 1 ชั่วโมง / Too many wrong codes. Try again in an hour."],
  ["too_many_invites", 409, "มีรหัสเชิญที่ยังไม่ใช้มากเกินไป / Too many unused invite codes. Revoke some first."],
  ["too_many_sessions", 400, "เลือกได้ครั้งละไม่เกิน 1000 รายการ / At most 1000 sessions at a time."],
  ["lead_cannot_leave", 409, "ผู้นำโครงการออกจากโครงการไม่ได้ / The lead site can't leave its own study."],
  ["not_a_site", 409, "องค์กรนี้ไม่ได้เป็นสถานที่ที่ใช้งานอยู่ในโครงการ / This organization is not an active site of the study."],
  ["bad_name", 400, "กรุณาใส่ชื่อโครงการ (ไม่เกิน 200 ตัวอักษร) / Please enter a study name (up to 200 characters)."],
  ["not_allowed", 403, "ไม่มีสิทธิ์ทำรายการนี้ / You don't have permission for this."],
];

export function studyErrorFor(message: string): { status: number; text: string } | null {
  for (const [code, status, text] of STUDY_ERRORS) if (message.includes(code)) return { status, text };
  return null;
}

/** For the browser: the mapped text, or the original message. */
export function studyErrorText(err: unknown): string {
  const msg = err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : String(err);
  return studyErrorFor(msg)?.text ?? msg;
}
