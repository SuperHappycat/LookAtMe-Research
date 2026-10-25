# Phase 2 + 3 notes (Research app)

Spec: `docs/RESEARCH_APP_SPEC.md` §3 (Supabase), §5.1 (quality score), §5.5 (gaze CSV), §9 Phases 2–3.
Written Oct 25, 2026.

## Set up Supabase (you do this once, about 10 minutes)

1. **Create the project.** supabase.com → New project. Free plan, region **Southeast Asia (Singapore)**.
   Save the database password somewhere safe.
2. **Create the tables.** Supabase → SQL Editor → paste all of
   `supabase/migrations/20261025000001_init.sql` → Run.
   This creates the tables, the Row Level Security rules, the private `gaze` storage bucket and the
   screening functions. (Or with the Supabase CLI: `supabase link` then `supabase db push`.)
3. **Make login invite-only.** Authentication → Sign In / Providers → Email: keep it enabled.
   Turn **off** "Allow new users to sign up".
4. **Set the URLs.** Authentication → URL Configuration:
   - Site URL: `https://research.lookat-me.online` (or your Vercel URL for now).
   - Redirect URLs: add `https://research.lookat-me.online/account/set-password`,
     `http://localhost:3000/account/set-password`, and your Vercel preview URL with `/account/set-password`.
5. **Add the keys to Vercel** (Project → Settings → Environment Variables) and to `.env.local` on your computer:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL`.
   They are under Project Settings → API. The service-role key is secret: server only, never commit it.
6. **Make yourself the LookAtMe admin.**
   - Authentication → Users → "Add user" → your email, with a password (auto-confirm).
   - SQL Editor: `insert into public.platform_admins (user_id) select id from auth.users where email = 'you@example.com';`
7. Log in at `/login`. Open **LookAtMe admin**, create a test organization, and put your own email as its
   first admin. You can then use the app as that organization.

Free-tier notes: the project pauses after 1 week with no use (restore it from the dashboard). Built-in auth email
is limited to a few emails per hour, which is fine for a prototype.

## What was built

**Phase 2: Supabase and the gate**
- `supabase/migrations/…_init.sql`: every table from spec §3.2.
  - Risk labels are `Low` / `Moderate` / `High`, as decided.
  - Extra `results` and `quality` JSON columns keep the per-test details.
  - RLS on every table; storage policies on `gaze/<org_id>/…`.
  - `start_session` checks role, expiry, quota and consent, and is idempotent.
  - `complete_session` uses quota only on the first "completed"; retests don't use quota.
  - `log_action` writes the audit log.
- Login (`/login`), forgot password, and set password from invite or reset emails (`/account/set-password`).
  There is no sign-up.
- `/r/admin`, LookAtMe team only: create an organization (plan → quota and seats from `lib/research/plans.ts`),
  invite its first admin, and renew.
- `/r/team`, org admins: invite staff by email with a role (admin / staff / viewer). Seat limit is checked
  on the server. Remove members (never the last admin).
- `/r`: children by **code only** (birth month, sex). `/r/children/[id]`: consent form (Thai + English, with
  separate research-use and video ticks), past screenings, **Start screening**.
- The original `/` and `/intake` now redirect to `/r`.
- The unauthenticated `/api/save-result` and `/api/send-report` routes are **removed** from this repo.
  The summary page no longer has the Google Sheet / Gmail buttons.

**Phase 3: Results**
- Screening flow: Start screening → `/r/check` camera check (5 s: face visible, lighting, distance) →
  `/calibrate` → Test 1–3 → `/summary`. The summary saves automatically:
  - session quality score (face visible %, lighting, distance; thresholds in `lib/research/quality.ts`,
    **TBD – tune with pilot data**);
  - gaze CSV uploaded to `gaze/<org>/<session>.csv` (format in spec §5.5, about 200 rows per level);
  - `complete_session` with scores, quality and the retest flag.
- "Retest recommended" when the face is often not visible or calibration did not pass. Those sessions are
  saved as `invalid` and do not use quota.
- `/r/dashboard`: all sessions with filters (dates, risk, status, code) and counts. Admins get
  **Export sessions (CSV)** and **Export all gaze data (CSV)** (gaze rows joined with coded child and session fields).
  Excel-friendly UTF-8, and every export is written to the audit log.
- `/r/sessions/[id]`: scores, details, quality, calibration error, camera check, and **replay with gaze dot**
  (original stimulus videos plus the stored gaze positions; no recording needed).

## Checked here (cloud sandbox)

- `npm test`: 25 tests pass.
  - **RLS tests run the real migration** on an in-memory Postgres with stand-ins for Supabase's auth and storage.
    They show cross-organization isolation for every table and the bucket; that role limits and blind mode work;
    that drive tokens can't be read; and that `start_session` / `complete_session` enforce consent, expiry and
    quota and use quota only once.
  - Quality score, CSV round-trip and export tests.
- `npm run lint` is clean and `next build` passes.
- **End-to-end in a browser against a mocked Supabase API**, with a fake camera and the OpenCV engine:
  log in → add child → consent → start screening → camera check → Tests 1–3 → summary auto-saves.
  This produced 597 gaze rows, the upload to the right path, and the `complete_session` call. The fake camera has
  no face, so it was correctly flagged "Retest".
- Dashboard (with CSV download) and session page (replay dot moving) rendered with mocked data.

**Not checked:** a real Supabase project (it doesn't exist yet), real invite emails, and MediaPipe with a real face.

## Known limits / next

- Replay positions are relative to the stimulus area, so they are approximate if the screen layout differed.
- Offline mode, consent withdrawal, diagnosis follow-up and blind-mode switches are Phase 5.
  `sessions.blind` and `diagnoses` exist in the schema already.
- Drive recording is Phase 4.
- The original repo (lookatme-web) still has the open `/api/send-report` email route. Fix it there.
