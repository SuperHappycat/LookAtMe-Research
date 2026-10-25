# Phase 4 + 5 — notes

Built with the parallel-agent plan in `docs/PHASE4_5_PLAN.md` (Wave 0 contracts → agents A–E → lead
merge, e2e and an independent security review). **No questionnaire / M-CHAT anywhere** (agent F dropped).
This branch also contains Calibration v2 (`docs/CALIBRATION_V2.md`), so PR #3 can be closed once this merges.

## What was built

| Agent | Feature | Where |
|---|---|---|
| A | Screen recording per test level, saved to the organization's **own Google Drive** (OAuth, `drive.file` scope, encrypted refresh token, resumable upload with a server proxy fallback), or "save on this computer" | `lib/research/drive/*`, `app/api/drive/*`, `/r/settings` |
| B | Consent withdrawal (deletes Drive recordings, the child's Drive folder, gaze files, sessions, diagnoses, consents), blind mode per org / child, diagnosis follow-up | `lib/research/followup/*`, child page |
| C | Analysis: areas of interest per stimulus video, dwell time / first look, CSV exports | `/r/analysis` |
| D | Multi-site studies (Hospital plan): invite codes, combined summary (aggregates only, small cells hidden), coded export for the lead | `/r/studies`, `lib/research/studies/*` |
| E | Offline mode: PWA, service worker, upload queue in IndexedDB, offline screening of cached children, sync when back online | `lib/research/queue.ts`, `lib/research/offline/*`, `/r/offline` |
| Lead | Accuracy page (screening result vs. diagnosis), nav, sync chip, logout warning | `/r/stats`, `ResearchShell.tsx` |

## Setup you need to do

1. **Run the new migrations** in the Supabase SQL editor, in this order (each file once):
   `20261026000001_phase45_contracts.sql`, `20261026000201_session_files_level.sql`,
   `20261026000301_blind_mode.sql`, `20261026000501_studies.sql`, `20261026000601_offline_sync.sql`,
   `20261026000901_security_fixes.sql`.
2. **Google Cloud project** (free): create an OAuth client of type *Web application*, enable the
   **Google Drive API**, set the consent screen to **Testing** and add the Google accounts you will test with
   as test users (no Google review needed in Testing mode). Authorized redirect URI:
   `https://<your-vercel-domain>/api/drive/callback` (plus `http://localhost:3000/api/drive/callback` for local).
3. **Vercel environment variables** (server-only unless marked):
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
   - `DRIVE_TOKEN_KEY` — `openssl rand -base64 32`
   - `DRIVE_STATE_SECRET` — `openssl rand -base64 32`
   - `STUDY_PSEUDONYM_SECRET` — at least 32 characters; never change it later (it changes every pseudonym)
   - `APP_URL` — e.g. `https://<your-vercel-domain>` (required in production)
4. Optional: open `/dev/drive-spike` locally (dev tools on) once with a real Google account to check that the
   direct browser upload works. If it doesn't, uploads still work through the server proxy (slower).

## Security review (independent agent) — all findings fixed

| # | Finding | Fix |
|---|---|---|
| M1 | A hidden small site could be worked out by subtracting the other sites from the total | The total only includes sites whose own block is shown ("Total (shown sites only)") |
| M2 | Finishing an upload could overwrite a recording row and orphan the Drive file; staff could add recordings to other people's sessions | A recording already in Drive is never replaced (409, duplicate copy deleted); staff only for sessions they ran, admins for any |
| M3 | Withdrawal deleted the child even when Drive deletion failed, losing the file ids | Withdrawal stops (409) before deleting rows; the admin can reconnect Drive and retry, or confirm to go ahead and delete the listed files by hand. The child's Drive folder is deleted too (catches recordings still uploading) |
| M4 | The offline queue wasn't tied to a user (shared device: one person's screening synced under another's login) | Items and cached children are stamped with the user id; only that user lists or syncs them; logout clears only your own items |
| L5 | The offline start time could be backdated repeatedly | Only on the first sync, at most 30 days earlier, never before the consent was signed |
| L6 | Sites in a study could list each other | A site sees only its own row; the lead sees all |
| L7 | An expired Hospital plan still allowed study summaries/exports | Expired plan counts as no plan |
| L8 | A child withdrawn on another device could still be screened offline | Cached children are re-checked against the server whenever the app is online |

**Decision to note:** lead-org *admins* see blind sessions inside the combined summary (blind mode hides
scores from staff/viewers, not from the study lead's admins). Staff and viewers at the lead never see blind
scores. Change `hideBlindScores` in `lib/research/studies/service.ts` if you want otherwise.

## Tests

- 162 unit + database tests (`npm test`; the database tests run the real migrations on an in-memory Postgres with RLS).
- Browser e2e against a mocked Supabase (`tests/e2e/`): online screening + save, dashboard / replay, offline
  screening → queue → sync, offline reload.
- Lint and production build pass.

## Not tested here (please try on real devices)

- Real Google Drive (connect, upload, delete) and a real Supabase project.
- MediaPipe model (blocked in this sandbox; tested with the OpenCV engine).
- Real iPads / Android tablets, real infants, slow or flaky networks.
- A recording still uploading on another device at the moment a child is withdrawn: the server refuses to
  record it (the session is gone), but the file may stay in Drive. Check the organization's Drive folder after
  a withdrawal if a screening was running elsewhere.
