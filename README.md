# LookAtMe — Web Demo

Full browser-based port of the LookAtMe desktop eye-tracking screening
app (the original `d:\LookAtMe` Python/Tkinter project). Same flow as
the desktop app: Home → Patient Intake → Test 1 → Test 2 → Test 3 →
Summary. (The desktop app's Previous Results page is not ported -- see
below.)

## Why this looks different from the desktop app

- **No server-side video processing.** Vercel's backend is serverless
  (no long-running process, no webcam access), so all face/eye
  detection and gaze estimation runs **in the visitor's browser** via
  [OpenCV.js](https://docs.opencv.org/4.x/d5/d10/tutorial_js_root.html)
  (the same OpenCV, compiled to WebAssembly), inside a Web Worker so it
  never blocks the page. Nothing about your webcam feed is ever sent to
  a server.
- **Same classical-CV pipeline as the desktop app**, ported line-by-line:
  Haar-cascade face/eye detection, contour-based pupil localization,
  median-filter + EMA smoothing, and per-session self-calibrated
  Left/Center/Right classification. See `lib/vision/` and
  `public/gaze-worker.js`.
- **No bounding boxes drawn on any video** (by request) -- neither the
  desktop app's face/eye rectangles on the camera preview, nor the AOI
  zone boxes Test 2/3 use on the desktop.
- **sessionStorage instead of an in-memory App object.** Each page is a
  separate Next.js route, so patient info + each test's results are
  carried across navigations via `lib/sessionState.ts` (cleared when
  the tab closes) instead of the desktop app's long-lived `App`
  controller.
- **Google Sheets instead of SQLite + PDF reports.** The finished
  Summary appends one row (patient + all three tests' results +
  overall score/risk) to a Google Sheet via `/api/save-result`, using
  a Google Cloud service account, never exposed to the browser.
- **No Previous Results page.** Saved rows contain patient names and
  emails, and this app has no login, so there is deliberately no
  endpoint that reads them back. View results in the Google Sheet
  itself, which only people it's shared with can open.

## Project structure

```
app/
  page.tsx                    Home
  intake/page.tsx              Patient intake (name/email/DOB/province)
  test1/, test2/, test3/       The three tests
  summary/page.tsx              Overall score + risk + save
  api/save-result/route.ts      POST: append a session row to Sheets
components/
  HomeClient.tsx, IntakeClient.tsx, Test1/2/3Client.tsx,
  SummaryClient.tsx
hooks/
  useGazeTestRunner.ts          Shared webcam/worker/timer machinery
                                 behind all 3 tests (the browser
                                 equivalent of gui/video_test_base.py)
lib/
  gazeWorkerClient.ts            Tab-wide shared gaze worker (OpenCV.js loads once,
                                 preloaded from the intake page)
  sessionState.ts                sessionStorage-backed patient/results state
  scoring.ts                     Port of scoring.py
  provinces.ts                   Thai provinces + month names
  vision/
    opencvLoader.ts, faceTracker.ts, eyeTracker.ts, gazeEstimator.ts
    test1Scoring.ts, test2Scoring.ts, test3Scoring.ts
public/
  opencv.js                     Self-hosted OpenCV.js build (~10MB, WASM inlined)
  gaze-worker.js                 The actual CV pipeline, runs in a Web Worker
  cascades/                     Haar cascade XML files
  videos/                       human.mp4 / geometric.mp4 / talking.mp4 / rja.mp4
  logo.png
styles/
  shared.module.css              Shared design system (matches desktop's UIConfig)
```

## Running locally

```bash
npm install
npm run dev
```

Open http://localhost:3000, click Start Screening, fill in the intake
form, allow camera access, and go through Test 1-3. The first load of
each test page takes a few seconds while its Web Worker spins up
OpenCV.js (~10MB) -- a one-time cost per tab per page (Next.js doesn't
share the worker across routes since each is a fresh client component
mount).

Saving results requires the Google Sheets env vars below; without
them the app still runs every test fine, "Save to Google Sheet" will
just show a clear error explaining it isn't configured yet.

## Google Sheets setup

1. **Create a Google Cloud project** (or reuse one) at
   https://console.cloud.google.com/.
2. **Enable the Google Sheets API**: APIs & Services → Enable APIs and
   Services → search "Google Sheets API" → Enable.
3. **Create a service account**: APIs & Services → Credentials →
   Create Credentials → Service Account. Any name works (e.g.
   `lookatme-sheets-writer`); no special roles are needed.
4. **Create a JSON key** for that service account: open it → Keys →
   Add Key → Create new key → JSON. This downloads a `.json` file --
   keep it private, never commit it.
5. **Create a Google Sheet** (or reuse one) to hold results, and note
   the long ID from its URL:
   `https://docs.google.com/spreadsheets/d/<THIS_PART>/edit`
6. **Share that Sheet** with the service account's email address (the
   `client_email` field in the JSON key -- looks like
   `xxx@yyy.iam.gserviceaccount.com`), with Editor access, exactly like
   sharing with a person.
7. **Set environment variables** (copy `.env.local.example` to
   `.env.local` for local dev, and add the same under Vercel Project
   Settings → Environment Variables for production):
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL` — the `client_email` from the JSON key
   - `GOOGLE_PRIVATE_KEY` — the `private_key` from the JSON key, quoted,
     with its `\n` sequences left as literal text (don't convert them to
     real line breaks)
   - `GOOGLE_SHEET_ID` — the ID from step 5
   - `GOOGLE_SHEET_TAB` — optional, defaults to `Sheet1`

Each saved session appends one row (columns A-L): timestamp, name,
email, date of birth, province, Test 1 (human%, geometric%), Test 2
(face%, object%), Test 3 (accuracy%), overall score, risk level -- a
deliberately trimmed subset of what the app tracks internally (gaze
switches, avg fixation, which side showed the human clip, Test 3's
block%/latency are still shown on each test's own results screen,
just not written to the Sheet).

## Email setup

The Summary page's **Email Report** button sends the finished summary
to the email address entered on the Intake page (before any test
starts), via Gmail SMTP (`nodemailer` -- `app/api/send-report/route.ts`
/ `lib/mailer.ts`). This is separate from any Claude/claude.ai Gmail
connector -- the deployed app needs its own sender credentials.

1. **Turn on 2-Step Verification** on the Gmail account you want to
   send FROM: https://myaccount.google.com/security -- App Passwords
   require it.
2. **Create an App Password**: https://myaccount.google.com/apppasswords
   → App name "LookAtMe" (or anything) → Create. Copy the 16-character
   password it shows you (spaces don't matter, they're stripped) --
   this is NOT your normal Gmail password, and it's shown only once.
3. **Set environment variables** (same `.env.local` / Vercel Project
   Settings → Environment Variables as the Sheets setup above):
   - `GMAIL_USER` — the Gmail address itself (e.g. `you@gmail.com`)
   - `GMAIL_APP_PASSWORD` — the App Password from step 2

Without these set, clicking **Email Report** shows a clear "not
configured" error instead of crashing -- same pattern as Google Sheets.

### Alternative: send the email from Google Sheets itself

If you'd rather not set `GMAIL_USER`/`GMAIL_APP_PASSWORD` in the app,
`apps-script/send-report-email.gs` does the same thing from inside the
Sheet instead: a script watches for new rows (via an installable
`onChange` trigger) and emails the patient automatically the moment
"Save to Google Sheet" appends one -- no separate button, no app-side
credentials, sends as whichever Google account owns the Sheet. See the
setup steps in that file's header comment. You can use this instead of
the Email Report button, or alongside it -- they don't conflict.

## Deploying to Vercel

Not deployed from here -- to deploy it yourself:

```bash
npm install -g vercel   # if you don't already have it
cd web
vercel login
vercel                  # first deploy, follow the prompts
vercel --prod           # promote to production
```

Or connect the repo in the Vercel dashboard (New Project → import this
`web/` directory as the project root) and set the `GOOGLE_*`
environment variables there before the first deploy.

No `vercel.json` is needed -- Next.js App Router projects (including
API routes) are auto-detected and deployed as-is.

## What's not ported

- PDF report generation (`reports/pdf_generator.py`) -- no web
  equivalent yet, the Summary page shows the score/risk on-screen only.
- Settings page -- vision thresholds, scoring weights, and risk bands
  are the desktop app's fixed defaults, not editable here.
- Gaze/heatmap visualizations on Summary -- the desktop app's are
  placeholders too (`gui/summary.py` says as much).
