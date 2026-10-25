/**
 * lib/research/studies/codes.ts
 * ===============================
 * Invite-code helpers safe for the browser. Codes are generated and hashed in the database
 * (create_study_invite / study_code_hash); this file only normalises what people type.
 */

/** Same alphabet as create_study_invite(): no 0/O, 1/I/L. */
export const INVITE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const INVITE_LENGTH = 12;

/** Upper-case and strip separators/spaces (same rule as study_code_hash() in SQL). */
export function normalizeInviteCode(input: string): string {
  return (input ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/** Quick client-side check before sending; the server decides. */
export function looksLikeInviteCode(input: string): boolean {
  const c = normalizeInviteCode(input);
  return c.length === INVITE_LENGTH && [...c].every((ch) => INVITE_ALPHABET.includes(ch));
}
