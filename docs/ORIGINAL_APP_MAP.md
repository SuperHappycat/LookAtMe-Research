# Original App Map (Individual app)

Written for `RESEARCH_APP_SPEC.md` section 2.3: a map of the existing app, made before any code changes.
Snapshot of `main` at `f89dc04`, Oct 25, 2026 (after the list-results fix).

## 1. Repo, framework, tooling

| Item | Value |
| --- | --- |
| Repo | `https://github.com/noppakron175/lookatme-web` (this is what the spec calls `Tambai/LookAtMe`) |
| Framework | **Next.js 16.3.5, App Router**, React 19.2.8, TypeScript 5 |
| Package manager | npm (`package-lock.json`, lockfile v3) |
| Node version | Not pinned (no `.nvmrc`, no `engines`). Developed on Node 24.19 |
| Source layout | No `src/` folder. Code lives in `app/`, `components/`, `hooks/`, `lib/`, `public/`, `styles/` |
| Lint | `eslint` with `eslint-config-next` |
| Tests | None |
| License | **No `LICENSE` file** |
| Runtime deps | `next`, `react`, `react-dom`, `googleapis` (Sheets), `nodemailer` (Gmail SMTP) |

## 2. Running and deploying

- Local: `npm install && npm run dev` → http://localhost:3000.
- Vercel: there is no `vercel.json`. Vercel auto-detects Next.js and uses `next build` with the default `.next` output.
  API routes run as Vercel Functions (Node runtime by default).
- `next.config.ts` is empty (default config).
- Env vars (see `.env.local.example`): `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID`,
  `GOOGLE_SHEET_TAB`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`. `.gitignore` already ignores `.env*` except `.env.local.example`.

## 3. Pages and flow

`/` Home → `/intake` → `/test1` → `/test2` → `/test3` → `/summary`. (`/results` was removed in `f89dc04`, see §8.)

| Route | Component | Notes |
| --- | --- | --- |
| `app/page.tsx` | `components/HomeClient.tsx` | Start button |
| `app/intake/page.tsx` | `components/IntakeClient.tsx` | Name, email, date of birth, province. Preloads the gaze worker |
| `app/test1..3/page.tsx` | `components/Test1Client.tsx` … `Test3Client.tsx` | One test each |
| `app/summary/page.tsx` | `components/SummaryClient.tsx` | Overall score and risk, "Save to Google Sheet", "Email Report" |

Each page is a thin server `page.tsx` that renders a `"use client"` component.

## 4. Gaze engine (OpenCV.js)

**Where it lives**
- `public/gaze-worker.js` is **the code that actually runs**: a classic Web Worker that calls `importScripts("/opencv.js")`.
  It does Haar-cascade face and eye detection, contour-based pupil detection, median filtering plus EMA smoothing,
  and Left/Center/Right classification that calibrates itself during the session.
- `public/opencv.js` is a self-hosted build (about 10 MB, with the WASM inlined). The cascades are in `public/cascades/*.xml`.
- `lib/gazeWorkerClient.ts` creates one worker for the whole tab and shares it. Its message protocol is `init` / `reset` / `frame`.
- `hooks/useGazeTestRunner.ts` handles the webcam (640×480, mirrored onto a canvas), sends one frame every
  **100 ms** (`DETECTION_INTERVAL_MS`) with at most one frame in flight, and runs the countdown and the stop timeout.
- `lib/vision/{faceTracker,eyeTracker,gazeEstimator,opencvLoader}.ts` are TypeScript ports of the same logic.
  **No app code imports them.** The worker duplicates them by hand. Only `lib/vision/types.ts` and
  `test{1,2,3}Scoring.ts` are used.

**What it outputs**: one sample for each processed frame (about 10 Hz, fewer if a frame takes longer than 100 ms):

```ts
{ direction: "Left" | "Center" | "Right" | "Unknown",
  eyesDetected: boolean,
  confidence: number,            // 1.0 = both pupils, 0.6 = one, 0.2 = eyes but no pupil, 0 = none
  screenX: number | null,        // NOT screen coords: smoothed pupil x inside the eye box, 0..1
  screenY: number | null }
```

The main thread's `WorkerSample` type keeps only `direction`, `eyesDetected` and `confidence`.
**There are no screen-pixel coordinates and no timestamps** in what scoring sees. Time is implied: one sample is
counted as 100 ms.

## 5. The 3 levels

| Level | Component | Stimulus | Duration | Scoring file |
| --- | --- | --- | --- | --- |
| 1: Human vs Geometric | `Test1Client.tsx` | `human.mp4` and `geometric.mp4` side by side. The side is randomized with `Math.random()` on mount | 20 s (`TEST_DURATION_MS = 20000`) | `lib/vision/test1Scoring.ts` |
| 2: Face vs Object | `Test2Client.tsx` | `talking.mp4`: face phase 0–11 s, object phase after 11 s | 20 s | `lib/vision/test2Scoring.ts` |
| 3: Joint attention | `Test3Client.tsx` | `rja.mp4`: block phase 0–5 s, face phase after 5 s | 20 s | `lib/vision/test3Scoring.ts` |

- The videos are in `public/videos/` and are 2.4 to 7.6 MB each. They play with `loop`, and the 20 s timer
  (`setTimeout`), not the video's end, stops the test.
- Levels 2 and 3 split into phases using `videoRefs[0].currentTime` at the moment each sample arrives.

## 6. Scoring (exact)

**Per level**, from region logs built from `direction` (see the scoring files):
- **Test 1**: `Left`/`Right` map to Human or Geometric according to `humanSide`. `Center`/`Unknown` map to Other.
  `humanPct = 100 × Human / (Human + Geometric)`, and `geometricPct` likewise. Also reports `switches` and
  `avgFixationMs` (run length × 100 ms).
- **Test 2**: "on target" = `eyesDetected && direction === "Center"`.
  `facePct` = % on target during 0–11 s, `objectPct` = % on target after 11 s.
- **Test 3**: same "on target" rule. `blockPct` covers 0–5 s and `facePct` covers after 5 s.
  `accuracyPct` = on-target % across both phases combined. `latencyMs` = samples from the start of the face phase
  to the first OnFace sample, × 100 ms.

**Overall** (`lib/scoring.ts`, a port of the desktop app's `scoring.py`):

```
overall = 0.40 × humanPreference + 0.35 × faceAttention + 0.25 × jointAttention   (clamped 0..100)
risk    = Low if ≤ 39, Moderate if ≤ 69, else High
```

Inputs, wired in `components/SummaryClient.tsx:47`: `humanPreference = test1.humanPct`,
`faceAttention = test2.facePct`, `jointAttention = test3.accuracyPct`. A missing test defaults to **50**.
`test2.objectPct`, `test3.blockPct`/`latencyMs` and Test 1's switches/fixation are displayed but not scored.

## 7. Email

- `lib/mailer.ts` and `app/api/send-report/route.ts` use **Gmail SMTP through `nodemailer`** with an App Password
  (`GMAIL_USER`, `GMAIL_APP_PASSWORD`). The template is inline HTML in `renderHtml()`. It sends to the email address
  entered on the intake page. The email includes the "preliminary screening tool, not a diagnostic instrument"
  disclaimer.
- Alternative: `apps-script/send-report-email.gs` runs inside the Google Sheet on an `onChange` trigger and emails
  each new row.
- **There is no PDF.** The README lists PDF generation as not ported.

## 8. Data storage

| Where | What | Code |
| --- | --- | --- |
| `sessionStorage` key `lookatme_screening_session` | Patient info and all test results; cleared when the tab closes | `lib/sessionState.ts` |
| **Google Sheet** (service account) | One row per saved session (A–L): timestamp, **name, email, DOB, province**, Test 1–3 %, overall, risk | `app/api/save-result/route.ts` |
| Gmail | The report email | `app/api/send-report/route.ts` |

No `localStorage`, cookies, database or auth. Webcam frames never leave the browser.

**Fixed in `f89dc04`:** `GET /api/list-results` used to return the name, email, province, score and risk of every
saved row with no authentication. The endpoint and the Previous Results page have been removed. Nothing in the app
reads the Sheet back now. Results can be viewed only in the Google Sheet, by people it is shared with.

## 9. Conflicts with the spec / plan (need a decision)

1. **Repo name** (resolved): the spec's `Tambai/LookAtMe` means `noppakron175/lookatme-web`. The default branch is `main`.
2. **Framework-specific paths**: this is Next.js App Router, so Research server code goes in `app/api/**/route.ts`
   (not a top-level `api/`), client env vars use `NEXT_PUBLIC_`, and there is no `src/`.
   **Decided:** use `lib/research/…` wherever the spec says `src/research/…`.
3. **"The Individual app stores nothing" is not true.** "Save to Google Sheet" stores the child's **name, email,
   DOB and province** in a Google Sheet. The unauthenticated read endpoint has been removed (`f89dc04`). The owner
   is deciding whether to delete the rows already saved. Nothing has been deleted.
4. **The gaze seam does not match the current engine.** The spec's `GazeSample` uses screen px `x`/`y`. OpenCV only
   gives `direction` (L/C/R) plus pupil-in-eye-box values, and all three scoring files use `direction` only. To keep
   "the scoring code only reads `GazeSample[]`" true for both engines.
   **Decided:** add `direction: "Left" | "Center" | "Right" | "Unknown"` to `GazeSample`. MediaPipe derives it from
   screen x relative to the stimulus layout. **Do not change the scoring formula.**
5. **Risk labels** (decided): use `'Low','Moderate','High'` in the database (`sessions.risk_level`) to match the app,
   not the spec's `'low','medium','high'`. Also update spec §5.2 ("medium + high") to mean Moderate + High.
6. **PDF output**: the plan lists "PDF + email" for the Individual app, but no PDF exists yet.
7. **Sample timing**: durations assume 100 ms per sample whether or not frames were skipped. MediaPipe at
   about 30 fps with real timestamps will produce different `avgFixationMs`/`latencyMs`. Compare engines on a
   recorded run (spec Phase 1).
8. **No LICENSE file**, so spec §2.1 ("keep it and keep attribution") has nothing to keep. The owner should choose
   a license.
9. **Dead code**: `lib/vision/{faceTracker,eyeTracker,gazeEstimator,opencvLoader}.ts` are not used. The worker is
   the real implementation.
