/**
 * lib/research/offline/rules.ts
 * ===============================
 * Pure offline-mode rules (unit-tested in tests/offline.test.ts).
 */

import { OFFLINE_CONFIG } from "./config";

/** A child remembered on this device so it can be screened offline. Code only, never a name. */
export interface CachedChild {
  id: string;
  org_id: string;
  code: string;
  birth_month: string | null;
  consent: { allow_recording: boolean; allow_research: boolean };
  /** User who cached it: only that user can see or screen it offline on a shared device. */
  ownerId?: string;
  /** Blind mode at caching time (optional third argument of cacheChildForOffline). */
  blind?: boolean;
  cachedAt: string;
}

/** The org's plan status when it was last seen online. */
export interface CachedPlan {
  orgId: string;
  /** YYYY-MM-DD; the plan works through this day (server: expires_on < current_date → expired). */
  expiresOn: string;
  /** null = unlimited. */
  quotaLeft: number | null;
  cachedAt: string;
}

export type OfflineCheck = { ok: true } | { ok: false; code: string; message: string };

/** Local calendar date as YYYY-MM-DD. */
export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function planFromOrg(org: {
  id: string;
  expires_on: string;
  screening_quota: number | null;
  screenings_used: number;
}, now: Date = new Date()): CachedPlan {
  return {
    orgId: org.id,
    expiresOn: String(org.expires_on).slice(0, 10),
    quotaLeft: org.screening_quota === null ? null : Math.max(0, org.screening_quota - (org.screenings_used ?? 0)),
    cachedAt: now.toISOString(),
  };
}

/** May this child be screened offline right now? */
export function offlineStartCheck(a: {
  child: CachedChild | null | undefined;
  plan: CachedPlan | null | undefined;
  pendingOfflineSessions: number;
  now?: Date;
  maxOfflineSessions?: number;
  maxCacheAgeMs?: number;
}): OfflineCheck {
  const now = a.now ?? new Date();
  const max = a.maxOfflineSessions ?? OFFLINE_CONFIG.maxOfflineSessions;
  const maxAge = a.maxCacheAgeMs ?? OFFLINE_CONFIG.maxCacheAgeMs;
  if (!a.child)
    return {
      ok: false,
      code: "not_cached",
      message:
        "เด็กคนนี้ยังไม่ได้บันทึกไว้ในเครื่องสำหรับใช้ออฟไลน์ เปิดหน้าเด็กขณะออนไลน์ก่อน / This child isn't saved on this device for offline use. Open the child's page while online first.",
    };
  if (now.getTime() - Date.parse(a.child.cachedAt) > maxAge)
    return {
      ok: false,
      code: "cache_too_old",
      message:
        "ข้อมูลเด็กในเครื่องเก่าเกินไป เปิดหน้าเด็กขณะออนไลน์อีกครั้ง / The saved child data is too old. Open the child's page online again.",
    };
  if (!a.plan)
    return {
      ok: false,
      code: "plan_not_cached",
      message:
        "ยังไม่มีข้อมูลแผนการใช้งานในเครื่อง เข้าสู่ระบบขณะออนไลน์ก่อน / No plan status on this device yet. Sign in while online first.",
    };
  if (now.getTime() - Date.parse(a.plan.cachedAt) > maxAge)
    return {
      ok: false,
      code: "cache_too_old",
      message:
        "ข้อมูลแผนการใช้งานในเครื่องเก่าเกินไป กรุณาออนไลน์ก่อน / The saved plan status is too old. Please go online first.",
    };
  if (localDate(now) > a.plan.expiresOn)
    return {
      ok: false,
      code: "plan_expired",
      message: "แผนการใช้งานหมดอายุ ติดต่อ LookAtMe เพื่อต่ออายุ / Plan expired — contact LookAtMe to renew.",
    };
  if (a.pendingOfflineSessions >= max)
    return {
      ok: false,
      code: "too_many_offline",
      message: `มีการคัดกรองออฟไลน์รอส่ง ${a.pendingOfflineSessions} รายการแล้ว (สูงสุด ${max}) กรุณาเชื่อมต่ออินเทอร์เน็ตเพื่อส่งข้อมูลก่อน / ${a.pendingOfflineSessions} offline screenings are waiting (max ${max}). Go online to upload them first.`,
    };
  if (a.plan.quotaLeft !== null && a.pendingOfflineSessions >= a.plan.quotaLeft)
    return {
      ok: false,
      code: "quota_reached",
      message:
        "ใช้จำนวนการคัดกรองครบแล้ว (รวมรายการที่รอส่ง) / Screening quota used up (including screenings waiting to upload).",
    };
  return { ok: true };
}

/** True for errors that mean "couldn't reach the server" (so offline mode may be used). */
export function isNetworkError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === "object") {
    const e = err as { name?: unknown; status?: unknown; message?: unknown; details?: unknown };
    if (e.name === "AuthRetryableFetchError") return true;
    const text = `${String(e.message ?? "")} ${String(e.details ?? "")}`;
    if (/failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet_disconnected|err_network/i.test(text))
      return true;
    if (e.name === "TypeError" && /fetch/i.test(text)) return true;
  }
  return false;
}

/**
 * Offline gaze CSVs are written with the clientSessionId in the session_id column (the server id
 * isn't known yet); at sync it is swapped for the real session id. UUIDs don't occur by chance.
 */
export function replaceSessionId(csv: string, clientSessionId: string, sessionId: string): string {
  if (!clientSessionId) return csv;
  return csv.split(clientSessionId).join(sessionId);
}
