# Agent B: child follow-up (Phase 5)

Branch `research/p45-b`. Spec §5.2, §5.3, and the blind mode and repeat trend rows of §5.

## What was built

- **Start flow:** `ChildClient` now starts screenings with `startScreening()` from `lib/research/offline/start.ts`. It passes:
  - `allowRecording` from the active consent;
  - `blind` = the org's `blind_new_sessions`, used only when the plan has `blind_mode`;
  - `ageMonths` and `engine`.

  It calls `cacheChildForOffline(child, consent)` when the page loads, then goes to `/r/check` as before. Role and plan come from the membership of the **child's** org, falling back to the active org.
- **Consent withdrawal (§5.3):** `POST /api/research/withdraw-consent {childId, reason, confirmCode}`. Org admins only: the route looks up the child with the service client, then calls `requireOrgRole(admin)`. The server also checks the typed child code. The steps live in `lib/research/followup/withdraw.ts`, with dependencies injected so they can be tested:
  1. Mark active consents withdrawn, with `withdrawn_reason`.
  2. `deleteDriveFiles()`. Failures don't stop the withdrawal; their IDs are returned.
  3. Remove the gaze CSVs: the paths stored in `session_files` plus `<org>/<session>.csv` for every session, limited to the org's own folder. **If this fails, the withdrawal stops before the child row is deleted**, so the admin can retry.
  4. Delete the child (cascades).
  5. `audit(..., 'withdraw_consent', 'reason:<category>')`. No child data.

  Reasons are fixed categories (`parent_request`, `entered_in_error`, `other`). Free text is not accepted. `screenings_used` is not refunded.

  UI: a danger panel for admins with a typed-code confirmation. The result screen shows:
  - counts of what was deleted;
  - a list of Drive files that failed, each with a `https://drive.google.com/file/d/<id>/view` link (shown only once);
  - the number of `local_only` recordings, which the admin must delete on the device.
- **Diagnosis follow-up (§5.2):** `DiagnosisSection.tsx` on the child page, for admin and staff on plans with `diagnosis_follow_up`. It adds a diagnosis (result and date) and lists past ones. Diagnoses can't be edited, so **the most recent one counts** (latest `diagnosed_on`, then latest `created_at`).

  `/r/stats` (`StatsClient.tsx`) is for admins; other roles see a message. It uses each child's first `completed` session. The positive definition can be set to High only or Moderate + High. The page shows:
  - a 2×2 table of `asd` vs `not_asd`;
  - how many children were excluded, by reason (other/pending, no completed session, no risk result), and separately how many have no diagnosis yet;
  - TP/FP/FN/TN;
  - sensitivity, specificity, PPV and NPV, each with a 95% Wilson interval;
  - "ข้อมูลยังไม่พอ" when a denominator is below `FOLLOWUP_CONFIG.minNForStats` (10, **TBD – tune with pilot data**).

  Two CSV exports (the 2×2 and coded rows). It logs `view_stats` when the page opens and `export_stats_csv` on each export. Reads are paginated (1000 rows per request).
- **Blind mode:** migration `20261026000301_blind_mode.sql`:
  - adds `organizations.blind_new_sessions`;
  - adds `set_org_blind(p_org, p_on)` (org admin only; turning it on needs the hospital plan; writes `set_blind_mode` to the audit log);
  - replaces `start_session` with every existing check and its idempotency, plus `blind = blind_new_sessions and plan = 'hospital'`.

  The admin toggle is on `/r/stats`. The child page shows a "Blind mode on" note and a "blind" tag on blind sessions (only admins can see those). When `ctx.blind` is set, `SummaryClient` hides the score, risk and per-test percentages ("ผลถูกปิดไว้ (blind mode) / Result hidden"). Saving is unchanged.
- **Repeat trend:** `TrendChart.tsx` is an SVG chart with no dependencies, shown on plans with `repeat_trend`. It plots the overall and level 1–3 scores of completed sessions over a real time axis. Each line has its own marker shape (not just colour). It has a hover crosshair and tooltip, and a table view. The layout maths is in `lib/research/followup/trend.ts`.

## Files

New:
- `app/api/research/withdraw-consent/route.ts`, `app/r/stats/page.tsx`
- `components/research/{StatsClient,DiagnosisSection,TrendChart}.tsx`
- `lib/research/stats.ts`, `lib/research/followup/{config,withdraw,trend}.ts`
- `styles/research-b.module.css`
- `tests/{stats,followup,followup-blind}.test.ts`
- `supabase/migrations/20261026000301_blind_mode.sql`

Changed: `components/research/ChildClient.tsx`, `components/SummaryClient.tsx` (blind display only).

## Tested

- `npm test`: 51 tests pass, including the existing `rls.test.ts`.
  - Wilson intervals checked against hand-computed values: 8/10, 0/10, 5/5, 45/50, 40/50.
  - 2×2 table, exclusions, both positive definitions, CSV content.
  - Order of withdrawal steps; refusals for bad input, wrong code and non-admins; stopping on a gaze-delete failure; no child data in the audit log.
  - Trend layout.
  - Database (PGlite): `set_org_blind` role and plan checks and its audit row; users can't update the column directly; new sessions copy the setting and are hidden from staff, but admins see them and staff can still complete them; turning it off affects only new sessions; a downgraded org gets no blind sessions; all `start_session` checks still work; diagnoses RLS; child delete cascades.
- `npm run lint` is clean. `next build` passes (with the font stub, which was reverted).
- Browser check against a mocked Supabase (script in my scratchpad, not committed), at 1280px and 390px wide, with no page errors:
  - trend chart, tooltip and table;
  - adding a diagnosis;
  - start screening puts `blind:true, allowRecording:true` into the context;
  - the summary is hidden in blind mode;
  - the withdrawal confirm button stays disabled until the code is typed, and the result screen shows the Drive links;
  - stats numbers for both definitions, CSV download, `view_stats` / `export_stats_csv` / `set_org_blind` RPCs.

## Not tested

- The withdrawal route against a real Supabase. The service-role queries and `storage.remove` are untested; only the logic was tested, with fakes.
- Real Drive deletion, because A's `deleteDriveFiles` is still a stub.

## Requests for the lead / integration notes

1. `friendlyError` doesn't know `feature_not_in_plan` (from `set_org_blind`). Add: `if (msg.includes("feature_not_in_plan")) return "ฟังก์ชันนี้ไม่มีในแผนของคุณ / Not included in your plan.";`. Only a non-hospital admin calling the RPC by hand can see it.
2. **Offline (E):** after a withdrawal, the child may still be cached on devices (`cacheChildForOffline`), and offline sessions may still be queued for them. Those would fail at sync with `no_consent` or `not_allowed`. E should drop cached children and queue items whose sync gets those errors, and ideally offer an `uncacheChild(childId)` that `WithdrawPanel` can call.
3. **Drive (A):** withdrawal only deletes recordings that have a `session_files` row with `kind='recording', location='google_drive', drive_file_id`. If A stores recordings any other way, they won't be found. Once `deleteDriveFiles` is real, the failed list should be empty in normal use.
4. **Studies (D):** `studies.blind_default` is not used by `start_session`. If study sessions should be blind, D or the lead must combine it in a later `create or replace start_session`. Keep my `blind` expression and the tests in `tests/followup-blind.test.ts`.
5. `ResearchSaveCard` (E) still shows a "View session" button after saving. For a staff member's blind session, that page will say "not found" because RLS hides it. E may want to hide the button when `ctx.blind` is set.
6. The `Organization` type in `ResearchShell` doesn't include `blind_new_sessions`, so I read it with a separate query. No shared change is needed.
