# Agent C: analysis tools (/r/analysis)

## What was built

One page, `/r/analysis`, with four tabs. A tab the plan doesn't include stays visible, shows a "Hospital" tag, and
displays "ฟังก์ชันนี้มีในแพ็กเกจโรงพยาบาล / Available on the Hospital plan". The ethics-approval note (wording from
`DashboardClient.tsx`) sits at the top of the page. The selected tab is remembered in `localStorage`.

The page loads the org's `completed` and `invalid` sessions once (limit 5000, same as the dashboard), joined with
`children(code, birth_month, sex, consents(allow_research, withdrawn_at))`. Blind sessions hidden by RLS never appear.
The AOI, group and export tabs share one filter bar: date range, risk, code, "include retest (invalid) sessions"
(off by default) and **"only children with research consent"** (on by default: a consent with `allow_research` that
hasn't been withdrawn). Age comparison ignores these filters because it is a screening feature over all completed
sessions.

1. **Areas of interest** (`areas_of_interest`)
   - Editor: choose a set or "New set", then a video (T1 human, T1 geometric, T2 talking, T3 rja). It shows the paused
     frame with a seek slider and a play button. Drag on the frame to draw a box, drag a box to move it, drag a corner
     to resize (pointer events, so touch works too). Each box has a label and an optional time window in video seconds
     ("start here", "end here", "whole video"). Boxes outside their window at the current position are faded. Sets
     are saved, edited and deleted in `aoi_sets` by admin or staff (viewers get read-only). Labels and geometry are
     checked before saving.
   - Metrics for the filtered sessions: downloads gaze CSVs 4 at a time, with a progress bar, a cancel button, a
     confirmation above 300 sessions, and an in-memory cache. Per AOI it shows mean % of valid samples inside, mean
     dwell, median time to first look, % of sessions that looked, mean visits and mean visit duration. There's also a
     per-session table, and CSV exports of the summary and the per-session rows.
   - Level 1: AOIs are defined per video and mapped through `results.test1.humanSide`, with each video taken as half
     of the union box. Sessions without `humanSide` are skipped and reported. The definitions and the approximation
     are documented at the top of `lib/research/analysis/aoi.ts` and in the UI note. The error comes from the 24 px gap
     between videos, the 6 px panel borders, `max-height: 70vh` letterboxing, and wrapping on narrow screens.
2. **Age comparison** (`age_comparison`). Bands 18–23, 24–35, 36–47, 48–59 and 60–72 months. Per band: n, median
   [IQR] of overall/T1/T2/T3, and risk counts and %. Option "first session per child only" (on by default). A band below
   `minNAgeBand` (20, TBD) shows "ข้อมูลยังไม่พอ / not enough data". You can find a session by code and see its
   mid-rank percentile in its band (computed against the other sessions in the band, excluding itself), plus a box plot
   with the session marked. The UI states it is the organization's own data, not a norm.
3. **Group summary** (`group_summary`). Group by age band, sex, month, quarter or year. Shows n, mean ± SD and median
   of the four scores, risk %, retest %, quality mean ± SD and face-found %. Rows below `minNGroup` (5, TBD) are
   faded. Two SVG charts with no dependencies: mean ± SD bars, and a 100% stacked risk bar. CSV export.
4. **Export for SPSS/R** (`raw_export`, admins only). Exports a wide CSV (one row per session, 34 variables including
   per-test results and quality), a long CSV (one row per session × level), a codebook CSV
   (file, variable, label, type, values) and an R script (`read.csv(..., fileEncoding = "UTF-8-BOM")`, ordered factor
   levels). The script is also shown on the page. Files contain the child code and session UUID only (no internal
   child UUID, no names). Files are UTF-8 with a BOM, booleans are 1/0, and missing values are empty cells.

Every CSV download first calls `log_action(p_org, 'export_analysis_csv', p_target)`. The target is a short
description such as `spss/r wide: 249 sessions`, with no child data. If logging fails, nothing is downloaded.
Downloads are **admin-only**, matching the dashboard; staff and viewers can still view the tables.

## Files

- `app/r/analysis/page.tsx`
- `components/research/analysis/`: `AnalysisClient.tsx`, `AoiTab.tsx`, `AoiEditor.tsx`, `AgeTab.tsx`,
  `GroupTab.tsx`, `ExportTab.tsx`, `Charts.tsx`, `common.tsx`
- `lib/research/analysis/` (pure, unit-tested): `config.ts` (age bands, min n, AOI gap; all TBD),
  `stats.ts` (mean, SD n−1, R type-7 quantiles, mid-rank percentile), `sessions.ts` (types, select string, filters,
  bands, first-per-child, session numbers), `aoi.ts`, `ageComparison.ts`, `groupSummary.ts`, `exports.ts`,
  `gazeFetch.ts` (concurrent download with an injectable downloader)
- `styles/research-c.module.css`
- `tests/analysis.test.ts`

No migration: the `aoi_sets` table and its RLS from Wave 0 were enough (its RLS is already tested in
`tests/contracts.test.ts`).

## Tested

- `npm test`: 58 tests pass. 20 of them are new: AOI metrics on synthetic gaze rows (% inside, dwell, time to first
  look, visits, invalid samples, gap splitting, time windows, other levels ignored, level-1 humanSide mapping,
  skipped sessions, summary), stats against R reference values, bands and filters, age comparison and percentile,
  group summary, wide/long/codebook/R exports (column counts, coded IDs only, no child UUID), and the gaze downloader
  (progress, cache, missing files, failures, cancel).
- `npm run lint` passes. `next build` passes (with the font stub, which was restored afterwards).
- Browser (Playwright with mocked Supabase, port 3303), with 60 and 300 sessions on the hospital plan and on the
  school plan. It covered the age table and percentile with the box plot; group summary and its charts; all 4 SPSS/R
  downloads (CSV checked to parse with `utf-8-sig`); drawing 2 boxes, moving one, saving (correct jsonb), computing
  metrics over 249 sessions and the AOI CSV; the plan gate on the school plan; the 390 px mobile layout; 6 audit RPC
  calls; and no page errors. The script is not committed: `tests/e2e/` is not mine. It can be added if wanted.

## Not tested

- Real Supabase (RLS for blind sessions, Storage download of real gaze files). The code uses the same calls as
  `DashboardClient`/`SessionClient`.
- AOI accuracy against real level-1 layouts (see the approximation above). Also not tested: the R script in real R
  (R isn't installed here) and SPSS import.
- Resizing by corner handle in the browser test (moving and drawing were tested; resizing uses the same code path,
  `rectFromPoints`, which is unit-tested).

## Requests for the lead

- None required. Optional: store each level's per-video boxes (not just the union) in the gaze log or `results`, so
  level-1 AOIs no longer need the half-and-half approximation.
- Export permissions: I made all analysis CSV downloads admin-only to match the dashboard. If staff researchers
  should be allowed to export, change `isAdmin` to `canWrite(active)` in `AnalysisClient.tsx`.
- `session_number` in the exports counts sessions **within the exported (filtered) set**. This is labelled in the
  codebook.
- Thresholds to tune with pilot data: `lib/research/analysis/config.ts`.
