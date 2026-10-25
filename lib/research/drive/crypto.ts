/**
 * lib/research/drive/crypto.ts
 * ==============================
 * Server-only crypto for Google Drive (spec §4.3, §4.5):
 *  - AES-256-GCM encryption of refresh tokens, stored as "iv:authTag:ciphertext" (base64).
 *    Key: env DRIVE_TOKEN_KEY = 32 random bytes, base64 (`openssl rand -base64 32`).
 *  - HMAC-SHA256-signed OAuth `state` {org_id, user_id, nonce, exp}. Key: env DRIVE_STATE_SECRET.
 *
 * Uses node:crypto, so it can never end up in a browser bundle. Never log inputs or outputs.
 */

import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { STATE_TTL_MS } from "./config";

export class DriveConfigError extends Error {}

function tokenKey(raw = process.env.DRIVE_TOKEN_KEY): Buffer {
  if (!raw) throw new DriveConfigError("DRIVE_TOKEN_KEY is not configured on the server.");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new DriveConfigError("DRIVE_TOKEN_KEY must be 32 bytes, base64-encoded.");
  return key;
}

function stateSecret(raw = process.env.DRIVE_STATE_SECRET): Buffer {
  if (!raw || raw.length < 16) throw new DriveConfigError("DRIVE_STATE_SECRET is not configured on the server.");
  return Buffer.from(raw, "utf8");
}

export function encryptToken(plain: string, keyB64?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(keyB64), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

/** Throws if the value was tampered with or encrypted with another key. */
export function decryptToken(enc: string, keyB64?: string): string {
  const parts = enc.split(":");
  if (parts.length !== 3) throw new Error("bad_token_format");
  const [iv, tag, ct] = parts.map((p) => Buffer.from(p, "base64"));
  if (iv.length !== 12 || tag.length !== 16) throw new Error("bad_token_format");
  const decipher = createDecipheriv("aes-256-gcm", tokenKey(keyB64), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export interface DriveState {
  org_id: string;
  user_id: string;
  nonce: string;
  exp: number; // ms since epoch
}

const b64url = (b: Buffer) => b.toString("base64url");

function sign(payload: string, secret?: string): Buffer {
  return createHmac("sha256", stateSecret(secret)).update(payload).digest();
}

export function newNonce(): string {
  return b64url(randomBytes(18));
}

export function signState(
  s: { org_id: string; user_id: string; nonce?: string },
  opts: { now?: number; secret?: string } = {},
): { state: string; nonce: string } {
  const nonce = s.nonce ?? newNonce();
  const payload: DriveState = { org_id: s.org_id, user_id: s.user_id, nonce, exp: (opts.now ?? Date.now()) + STATE_TTL_MS };
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  return { state: `${body}.${b64url(sign(body, opts.secret))}`, nonce };
}

/** Returns the payload, or throws "bad_state" / "state_expired". */
export function verifyState(state: string, opts: { now?: number; secret?: string } = {}): DriveState {
  const [body, sig, extra] = state.split(".");
  if (!body || !sig || extra !== undefined) throw new Error("bad_state");
  const want = sign(body, opts.secret);
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw new Error("bad_state");
  let p: DriveState;
  try {
    p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new Error("bad_state");
  }
  if (typeof p.org_id !== "string" || typeof p.user_id !== "string" || typeof p.nonce !== "string" || typeof p.exp !== "number") {
    throw new Error("bad_state");
  }
  if ((opts.now ?? Date.now()) > p.exp) throw new Error("state_expired");
  return p;
}

/**
 * Binds a Drive upload-session URL to a session so /api/drive/upload-chunk only forwards to
 * URLs that start-upload created for that session.
 */
export function signUploadUrl(uploadUrl: string, sessionId: string, secret?: string): string {
  return b64url(sign(`upload:${sessionId}:${uploadUrl}`, secret));
}

export function verifyUploadUrl(uploadUrl: string, sessionId: string, sig: string, secret?: string): boolean {
  return safeEqual(signUploadUrl(uploadUrl, sessionId, secret), sig);
}

/** Constant-time string comparison (for the nonce cookie). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
