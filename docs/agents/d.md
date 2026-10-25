# Agent D: multi-site studies

## What was built

- **Create a study** (`POST /api/research/studies`): admin of a `multi_site` org. The org becomes the lead and is also an active site.
- **Invite by one-time code**: the lead admin creates a 12-character code from the 31-letter alphabet `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (about 59 bits), shown as `XXXX-XXXX-XXXX`.
  - The code is generated in SQL with `gen_random_bytes` and rejection sampling. Only its SHA-256 hash is stored.
  - It expires after 14 days (`STUDIES_CONFIG.inviteDays`, clamped to 1–30 in SQL). The lead can revoke it, and at most 20 unused codes can exist per study.
  - An admin of another hospital org redeems it with `POST /api/research/studies/join {code, orgId}`.
- **Joining rules**:
  - A code is single-use.
  - Unknown, used, expired and revoked codes all return the same `null`.
  - The lookup is by hash, so there is no prefix-timing oracle.
  - A retry by the org that used the code is idempotent.
  - When the lead redeems its own code, the code is not used up.
  - Rate limit: failures are written to `study_join_attempts`, and after 10 failures in an hour the org gets `too_many_attempts`. This is enforced in the database, so calling the RPC directly can't get around it.
- **Leave and remove**: a site admin can leave, the lead admin can remove a site, and the lead can't leave. Leaving or removal also switches `share_row_data` off.
- **Tagging sessions**:
  - `set_session_study(p_session, p_study|null)` plus a bulk `set_sessions_study(uuid[], uuid)` that is all-or-nothing, with at most 1000 ids.
  - The caller must be admin or staff of the session's org, and that org must be the lead or an active site.
  - Blind sessions can be tagged by admins only, the same as the blind read rule.
  - The UI picks the org's own sessions (read through RLS) by date range, child codes, or tag state.
- **Combined summary** (`GET /api/research/studies/[id]/summary?orgId=`): returns aggregates only.
  - Admin or staff of the lead org gets every active site plus a total. A site gets only its own block.
  - Contents: n, completed, invalid, started, risk distribution, mean and median of overall and level 1–3 scores, mean quality.
  - Scores and risk come from completed sessions only. Quality uses all sessions.
  - Blocks with fewer than `minCellN` (3, TBD) scored sessions are suppressed.
  - For non-admin callers, blind sessions are counted in n but kept out of scores and risk.
  - Each view is logged as `view_study_summary`.
- **Row-level coded export** (`GET /api/research/studies/[id]/export?orgId=`): lead **admin** only.
  - Rows come only from active sites whose own admin turned on `share_row_data`. The lead also has to turn it on for its own rows.
  - Only children whose **latest non-withdrawn consent** has `allow_research = true` are included.
  - ID column: `P-` plus a 10-character base32 HMAC-SHA256 of `study_id:child_id`, keyed with `STUDY_PSEUDONYM_SECRET`.
  - Other columns: visit number, site name, age in months, sex, status, risk, scores, quality, face-found %.
  - The export never contains child codes, birth dates or session ids.
  - CSV cells are protected against formula injection.
  - Logged as `export_study_csv` in the lead's audit log and in each site's audit log.
- **UI**:
  - `/r/studies`: list with a lead/site badge, create a study, join with a code.
  - `/r/studies/[id]`: sites, the invite panel (each code is shown once), the row-sharing switch with the ethics/DSA notice and a confirm step, the summary table with SVG risk bars, the session tagger, and export.

## Files

- Migration: `supabase/migrations/20261026000501_studies.sql`
- `lib/research/studies/`:
  - `config.ts` (TBD values)
  - `codes.ts`
  - `messages.ts`
  - `aggregate.ts` (pure)
  - `pseudonym.ts` (pure, `node:crypto`)
  - `service.ts` (route logic with injected `StudyData`)
  - `server.ts` (service-role data access, `rpcAsUser`; server-only)
- Routes: `app/api/research/studies/{route.ts, join/route.ts, [id]/route.ts, [id]/summary/route.ts, [id]/export/route.ts}`
- Pages: `app/r/studies/page.tsx`, `app/r/studies/[id]/page.tsx`
- Components: `components/research/studies/{StudiesClient, StudyClient, StudyBits, SessionTagger}.tsx`
- Styles: `styles/research-d.module.css`
- Tests: `tests/studies.test.ts` (RLS/RPC), `tests/studies-unit.test.ts`

## Migration summary (`…000501`)

- `study_sites.share_row_data boolean not null default false`
- New tables `study_invites` and `study_join_attempts`, both with RLS on and **no** policies.
- Partial index `sessions(study_id)`.
- SECURITY DEFINER functions with `search_path = public[, extensions]`, since pgcrypto lives in `extensions` on Supabase:
  - `org_has_multi_site` (internal; not granted to users)
  - `study_code_hash`
  - `create_study`
  - `create_study_invite`
  - `revoke_study_invite`
  - `redeem_study_invite`
  - `leave_study`
  - `remove_study_site`
  - `set_study_share_row_data`
  - `set_session_study`
  - `set_sessions_study`
- Execute is revoked from public and anon, and granted to authenticated.

## Design notes

- **Plan checks happen twice.**
  - The routes check `planHas(plan, 'multi_site')` in TypeScript.
  - The RPCs check `org_has_multi_site()`, which mirrors plans.ts as hospital-only and also requires `expires_on >= today`.
  - A test fails if plans.ts gives `multi_site` to another plan, so the two can't drift silently.
- **Route RPCs run as the caller.** The create and join routes call the RPC with the **caller's token** (anon key plus the bearer token), so the database checks the role again. The UI calls the other RPCs directly; they have no service-role path.
- **Platform admins get no bypass.** The study routes use their own `memberRole` check, not `requireOrgRole`, so platform admins don't pass. Study data belongs to the sites.
- **Studies are hidden from outsiders.** A study the caller can't see returns 404, the same as an unknown one.
- **What each org can see.**
  - A site sees only the lead's name and its own row in the sites list.
  - The lead sees all sites.
  - Sites can still read each other's `study_sites` rows (org ids) through the Wave 0 RLS policy, but organization names are hidden by RLS.
- **Leaving keeps tags.** When a site leaves, its sessions keep their `study_id` but drop out of all summaries and exports (active sites only). The site can still untag them.

## Data-sharing assumptions (shown in the UI before sharing is turned on)

- Each site needs its **own ethics committee approval** for the study and a **data-sharing agreement** with the lead.
- Turning sharing off stops future exports. Files already exported are not recalled.
- Pseudonymous IDs are not reversible without `STUDY_PSEUDONYM_SECRET`.
  - They are stable within a study and differ across studies.
  - Rotating the secret changes every ID, so links to earlier exports are lost.
- Age in months and sex are quasi-identifiers. Small-cell suppression applies to the summary, not to the export: the export is consented, agreed row data.

## Tests

`npm test`: 62/62 pass. `npm run lint` is clean. `next build` passes, run with the font stub; `app/layout.tsx` was restored.

- **RLS/RPC tests** (PGlite, real migrations), 11 tests:
  - Plan-sync and expired plans.
  - Who can create a study.
  - A non-site org sees no study or sites, and direct inserts fail.
  - Invite codes: format, randomness, stored only as a SHA-256 hash, invisible to users, expiry about 14 days and clamped.
  - Codes are single-use, normalise case and separators, refuse expired and revoked codes, and a retry by the same org is idempotent.
  - The rate limit blocks after 10 failures without using up a valid code.
  - The lead can't see a site's sessions, children or org.
  - Direct `update sessions set study_id` has no effect.
  - `set_session_study` refuses foreign sessions, non-site studies, unknown ids, viewers, and blind sessions for staff. Bulk tagging is atomic.
  - Share flag: only the site admin can change it.
  - Leave and remove rules, and re-joining.
  - Anon can't execute the RPCs.
- **Unit tests** (14):
  - mean and median; aggregation counts, suppression and blind handling.
  - Pseudonyms: stable, study-scoped, secret-scoped, no collisions in 5000 ids.
  - Latest-consent rule.
  - The export filter leaks no codes, dates or ids; formula escaping works.
  - Route logic with fake data access: the access matrix (lead, site, viewer, outsider, left site, wrong org, bad uuid). Refused callers trigger **no** session reads and no audit entries.
  - Audit entries for the lead and for each site.
- **Browser check** on port 3304 with a mocked Supabase and mocked API, via a scratch script not committed:
  - Pages tested: list, create/join forms, study page, invite code, summary table and bars, tagging (bulk RPC payload checked), export download, mobile width.
  - No page errors.

## Not tested

- The real Supabase/PostgREST path: `rpcAsUser` with real JWTs, the embedded `child:children(...)` select in the export, and paging beyond 1000 rows. All of these were built against the Supabase API but never run here.
- A real browser against real data.

## Requests for the lead

1. **Env var**: add `STUDY_PSEUDONYM_SECRET` to the server environment (at least 32 random characters, server-only; for example `openssl rand -base64 48`). Without it, the export returns 500. Document it next to the other secrets.
2. **Optional, `lib/research/supabase/client.ts` `friendlyError`**: map `not_a_site`, `feature_not_in_plan`, `too_many_attempts` and `lead_cannot_leave`. My components use `studyErrorText` from `lib/research/studies/messages.ts` instead, so this isn't required.
3. **Integration with B and E (`start_session`)**: new sessions start untagged. If you want auto-tagging (for example a default study per org), call `set_session_study` after `start_session`. Don't write `sessions.study_id` directly.
4. **Integration with B (consent withdrawal)**: withdrawal deletes the child, which cascades to sessions, so withdrawn children drop out of summaries and exports automatically. Files already exported can't be recalled, as stated in the UI.
5. **Security review focus**:
   - `redeem_study_invite`: rate limit, single use, one answer for all bad codes.
   - `studySummary` / `studyExport`: the order of checks before the service-role reads.
   - The latest-consent rule in `researchConsentedChildren`.
