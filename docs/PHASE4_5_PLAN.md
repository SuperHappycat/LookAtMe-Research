# Phase 4 + 5 plan: parallel agents

Goal: build spec Phases 4 and 5 (`docs/RESEARCH_APP_SPEC.md` §4, §5, §9) with several Claude agents working at the
same time, without them breaking each other's work.

## The rule that makes parallel work safe

**Each agent owns its own files.** Anything shared is fixed first, in Wave 0, by one agent (the lead). After that,
agents may only *use* shared things, not change them. Each agent works in its own git worktree and branch and opens
a pull request into the integration branch `research/phase-4-5`, never into `main`.

## Wave 0: contracts (lead, done first, alone)

These files are touched by almost everyone, so one agent writes them before anyone starts:

| Contract | File | Contents |
| --- | --- | --- |
| Database | `supabase/migrations/20261026000001_phase45_contracts.sql` | New tables and columns, with RLS: `studies`, `study_sites`, `questionnaires`, `aoi_sets`, `consents.withdrawn_reason`, `sessions.client_offline_meta`, Drive fields. Each agent then gets its own migration number range (below) for anything extra |
| Shared types | `lib/research/contracts.ts` | `QueueItem` (offline/upload queue), `RecordingResult`, `DriveStatus`, `StudyRole`, `AoiBox`, `QuestionnaireResult` |
| Queue interface | `lib/research/queue.ts` (stub) | `enqueue(item)`, `onSynced(cb)`, `pending()`. Agent E implements it; others only call it |
| Navigation | `components/research/ResearchShell.tsx` | All new menu items added once (hidden by plan feature flags) |
| Plans | `lib/research/plans.ts` | Feature flags for every new function |
| Test fixtures | `tests/fixtures.ts`, `tests/rls.test.ts` stand-ins | Shared PGlite setup that every agent's RLS tests reuse |
| Mock Supabase | `tests/e2e/mockSupabase.cjs` | The browser mock from Phase 2+3, made reusable |

## Wave 1: six agents in parallel

| Agent | Builds | Owns (only these files) | Migration range |
| --- | --- | --- | --- |
| **A. Drive and recording** (Phase 4) | Connect / disconnect Google Drive, encrypted tokens, canvas screen recording, resumable upload, every error state (spec §4.6), "save on this computer" | `app/api/drive/**`, `lib/research/drive/**`, `lib/research/recording.ts`, `components/research/DriveSettings.tsx`, `app/r/settings/**` | `…0002xx` |
| **B. Child follow-up** | Consent withdrawal (deletes Drive files, CSVs, rows), ★ diagnosis follow-up with sensitivity/specificity and Wilson CIs, blind-mode switch, repeat-screening trend chart | `app/api/research/withdraw-consent/**`, `components/research/ChildClient.tsx`, `components/research/Diagnosis*.tsx`, `app/r/stats/**`, `lib/research/stats.ts` | `…0003xx` |
| **C. Analysis tools** | Areas-of-interest editor and metrics, age comparison, group summary, SPSS/R export | `app/r/analysis/**`, `components/research/analysis/**`, `lib/research/analysis/**` | `…0004xx` |
| **D. Multi-site studies** | Studies, site invitations, combined summary for the lead researcher (server-side, security-sensitive) | `app/api/research/studies/**`, `app/r/studies/**`, `components/research/studies/**` | `…0005xx` |
| **E. Offline and tablet** | ★ Offline mode (service worker, IndexedDB queue, sync), tablet layout, owns the save flow | `public/sw.js`, `app/manifest.ts`, `lib/research/queue.ts` (implements the stub), `lib/research/offline/**`, `components/research/ResearchSaveCard.tsx`, responsive CSS in `styles/research.module.css` (bottom section only) | `…0006xx` |
| **F. Questionnaire** | A generic questionnaire engine (items, scoring, side-by-side with the gaze result). The real M-CHAT-R/F items are added **only after you confirm the licence** | `lib/research/questionnaires/**`, `components/research/questionnaire/**`, `app/r/questionnaire/**` | `…0007xx` |

**Where agents meet:**
- A ↔ E: A produces a recording `Blob`, then calls `enqueue({ kind: "recording", … })`. E uploads it when online,
  using A's `/api/drive/*` routes.
- B ↔ A: consent withdrawal calls A's server helper `deleteDriveFiles(orgId, fileIds)`. Wave 0 fixes its signature.
- C, D and F read sessions and gaze CSVs only; they don't change how data is saved.

**Every agent must:** keep to its own files; add tests (unit, plus RLS tests for any new table); pass
`npm run lint`, `npm test` and `next build`; write a short `docs/agents/<letter>.md` (what was built, what was tested,
what wasn't); and open a PR into `research/phase-4-5`.

## Wave 2: integration (lead)

1. Merge in this order, running all tests after each merge:
   - **F, C, D** (independent pages);
   - **B** (child page);
   - **A** (Drive);
   - **E** last, because it wraps the save and upload flow everything else feeds.
2. Run the full browser end-to-end test on the mock Supabase: screening → recording → offline → sync → withdrawal.
3. **Independent security review** of the merged branch by a fresh agent that hasn't seen the work. Focus:
   multi-site data sharing, Drive tokens, consent-withdrawal deletion, offline data stored on the device.
4. Fix what it finds, then open one PR from `research/phase-4-5` to `main`.

## What you need to do

| When | What | Why |
| --- | --- | --- |
| Before Wave 1 | Create the Google Cloud project in Testing mode (spec §4.2) and send the client ID | Agent A needs it to test Drive for real (it can build against mocks without it) |
| Before agent F adds real items | Confirm the M-CHAT-R/F licence and permission for your use, and whether a validated Thai version exists | It's copyrighted; until then F ships the engine with a dummy questionnaire |
| After Wave 2 | Test on a real computer and a tablet with a child-age volunteer, then set the TBD thresholds | Real webcams and children can't be tested in the cloud |

## Rough effort

Wave 0 takes about 1–2 hours. Wave 1 agents run at the same time, about 2–4 hours each. Wave 2 takes about 2 hours.
Six agents use far more tokens than one working alone, roughly the sum of all six. The saving is in time, not cost.
