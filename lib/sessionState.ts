/**
 * lib/sessionState.ts
 * =====================
 * Carries patient info + each test's results across the multi-page
 * screening flow (Intake -> Test1 -> Test2 -> Test3 -> Summary),
 * mirroring what main.App's `current_patient`/`current_session`
 * in-memory state does in the desktop app. Next.js pages are separate
 * route components, not one long-lived object, so this uses
 * sessionStorage instead -- survives client-side navigation AND a
 * manual page refresh, but clears when the tab closes (never persisted
 * server-side; only the finished Summary gets saved, to Google Sheets).
 */

const STORAGE_KEY = "lookatme_screening_session";

export interface PatientInfo {
  name: string;
  email: string;
  dateOfBirth: string; // ISO "YYYY-MM-DD"
  province: string;
}

export interface Test1Results {
  humanPct: number;
  geometricPct: number;
  switches: number;
  avgFixationMs: number;
  humanSide: "left" | "right";
}

export interface Test2Results {
  facePct: number;
  objectPct: number;
}

export interface Test3Results {
  blockPct: number;
  facePct: number;
  accuracyPct: number;
  latencyMs: number | null;
}

export interface ScreeningSession {
  patient: PatientInfo | null;
  test1: Test1Results | null;
  test2: Test2Results | null;
  test3: Test3Results | null;
}

const EMPTY_SESSION: ScreeningSession = { patient: null, test1: null, test2: null, test3: null };

export function getSession(): ScreeningSession {
  if (typeof window === "undefined") return EMPTY_SESSION;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_SESSION;
    return { ...EMPTY_SESSION, ...JSON.parse(raw) };
  } catch {
    return EMPTY_SESSION;
  }
}

function saveSession(session: ScreeningSession): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function startNewSession(patient: PatientInfo): void {
  saveSession({ ...EMPTY_SESSION, patient });
}

export function saveTest1Results(results: Test1Results): void {
  saveSession({ ...getSession(), test1: results });
}

export function saveTest2Results(results: Test2Results): void {
  saveSession({ ...getSession(), test2: results });
}

export function saveTest3Results(results: Test3Results): void {
  saveSession({ ...getSession(), test3: results });
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(STORAGE_KEY);
}
