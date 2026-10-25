# Agent E: offline mode and tablet layout (Phase 5)

Branch `research/p45-e`. Spec §5.4.

## What was built

**Upload queue** (`lib/research/queue.ts`, `lib/research/offline/queueCore.ts`, `lib/research/offline/idb.ts`)
- All the stub's exported signatures are kept: `enqueue`, `registerUploader`, `pending`, `onChange`, `syncNow`.
- New exports: `counts`, `retryItem`, `removeItem`, `linkSession`, `linkedSessionId`, `clearQueue`, `startSyncLoop`,
  `setSyncGate` and `queueStore`.
- The logic lives in `QueueCore`, which is pure and has its storage behind `QueueStore`. In the browser that is
  `IdbQueueStore` (raw IndexedDB: database `lookatme-offline`, stores `queue`, `blobs` and `meta`). Tests and browsers
  without IndexedDB use `MemoryQueueStore`.
- Failed uploads retry with exponential backoff (5 s doubling, capped at 15 min).
- An item is marked `needsReview` (and kept, never dropped) when:
  - the uploader throws `NeedsReviewError`;
  - the server refuses it (`quota_reached`, `plan_expired`, `no_consent`, `not_allowed`, RLS, `bad_path`, …);
  - its blob is missing;
  - it fails 12 times.
- Order: offline sessions first, then recordings, oldest first. A recording whose `sessionId` is null waits until its
  offline session has synced. The sync calls `linkSession(clientSessionId, sessionId)`, which fills in the waiting
  recordings. A recording enqueued later gets the id straight away.
- Kinds with no uploader wait. While offline, or while nobody is signed in (the sync gate), the queue makes no attempt
  and counts no attempt.
- Only one sync pass runs at a time, so an item is never uploaded twice at once. Re-enqueueing the same id replaces it.
- Sync runs at app start, on `online`, on `visibilitychange` (visible), every 60 s and on `SIGNED_IN`.
- Config: `lib/research/offline/config.ts`. Limits are marked TBD.

**Offline start** (`lib/research/offline/start.ts`, rules in `offline/rules.ts`)
- `startScreening` works as before when online. It falls back to offline only when the device is offline or the RPC
  fails with a network error. Offline start is allowed only when all of these hold:
  - the child + an active consent are cached;
  - the cached plan hasn't expired;
  - the cache is ≤ 30 days old;
  - fewer than 20 offline sessions are pending (TBD);
  - the pending count is below the cached quota left.
- Offline, the context is set with `sessionId ""` and `offline: true`. Recording is allowed only if the cached consent
  allows it.
- `cacheChildForOffline(child, consent, opts?)` stores the code, birth month, id, org and consent flags. It also stores
  the org's plan status, read from `organizations` (`expires_on`, quota left). `consent === null` forgets the child.
  The optional 3rd argument `{ blind }` is backward compatible.
- Extra exports: `cachePlanStatus(org)`, `refreshPlanStatus`, `cachedChildren`, `cachedPlan`, `forgetCachedChild`.

**Saving** (`components/research/ResearchSaveCard.tsx`)
- The online flow is unchanged: EndCheck → quality → CSV upload → `complete_session`.
- When the screening started offline (`ctx.offline`, empty `sessionId`) or `navigator.onLine` is false, the save card
  enqueues an `offline_session` item instead. The item id is `session-<clientSessionId>`, so saving twice can't create
  a duplicate.
  - It shows "บันทึกไว้ในเครื่อง รอส่งข้อมูล / Saved on this device, waiting to upload".
  - When the upload finishes it switches to "ส่งข้อมูลแล้ว ✓ / Uploaded ✓" with a "View session" button.
- If an online save fails with a network error, it also falls back to the queue (`startedOffline: false`).
  `start_session` returns the existing id for that `clientSessionId`.
- The offline gaze CSV uses the clientSessionId in the `session_id` column. The uploader swaps in the real id.

**`offline_session` uploader** (`lib/research/offline/syncSession.ts`, registered in `offline/boot.ts`)
- It runs these steps: `start_session(child, clientSessionId, engine)` → `linkSession` → `mark_session_offline` →
  gaze CSV upsert at `gaze/<org>/<session>.csv` → `complete_session`.
- Every step is idempotent, so the whole chain re-runs after any failure.

**Migration** `20261026000601_offline_sync.sql`: `mark_session_offline(p_session, p_started_at)`
- Callable by the session's staff member, or by an org admin.
- Sets `created_offline = true` and `offline_synced_at` (on the first sync only).
- While the session is still `started`, moves `started_at` back to the device's start time, by at most 30 days.
- The uploader tolerates the function being missing (`PGRST202`).

**Status UI**
- `components/research/offline/SyncStatusChip.tsx` shows one of: ออนไลน์ / ออฟไลน์ / รอส่งข้อมูล N รายการ /
  ต้องตรวจสอบ N. It links to `/r/offline`.
- `/r/offline` (`components/research/offline/OfflineClient.tsx`) shows:
  - children cached on this device, with "start screening (offline)" and "remove from device";
  - items waiting and items that need review, each with retry and delete (delete asks for confirmation);
  - "upload now";
  - a privacy note;
  - "clear offline data on this device" (asks for confirmation and warns how many unsent items will be lost).
- `clearOfflineData()` is in `lib/research/offline/boot.ts`. It returns the number of items deleted.

**Service worker** (`public/sw.js`)
- It is registered in production only, by `components/research/offline/OfflineBoot.tsx` in `app/layout.tsx`. The same
  component lazy-loads the queue boot.
- At install it precaches the videos, OpenCV, the cascades, the gaze worker and the MediaPipe model and SIMD WASM. It
  also warms the 7 screening pages plus the `/_next/static` files their HTML references.
- Cache-first for `/videos/*`, `/mediapipe/*`, `/opencv.js`, `/cascades/*`, `/gaze-worker.js` and `/_next/static/*`.
  Video `Range` requests are answered with a 206 from the cached full file.
- Navigations to `/r/check`, `/calibrate`, `/test1`–`/test3`, `/summary` and `/r/offline` are network-first with the
  cached copy as fallback. Other pages show a small bilingual "offline" page when the network is down.
- It never touches other origins (Supabase), `/api/*`, RSC requests or anything that isn't a GET.
- Cache names are versioned (`lookatme-research-*-v1`), and old ones are deleted on activate.
- `app/manifest.ts`: "LookAtMe Research", with a Thai/English description, theme `#2563eb` and background `#f4f7fc`.

**Tablet** (Phase 5 sections at the end of `styles/research.module.css` and `styles/shared.module.css`)
- On screens up to 1024 px, page padding is tighter and the top bar wraps.
- The calibration operator bar wraps inside the screen.
- Test 1's two videos stay side by side (`nowrap` from 600–1024 px; they shrink rather than stack). Portrait mode caps
  the video height.
- The corner camera preview is smaller.
- On `pointer: coarse`, buttons, nav links, inputs, selects, table actions, operator-bar controls and the mode toggle
  are ≥ 44 px. Inputs use 16 px text so iOS doesn't zoom.

## Privacy

IndexedDB on the device holds the following until each item uploads:
- child codes, birth months and consent flags;
- results and gaze CSVs;
- recording Blobs.

There are no names and no auth tokens; supabase-js keeps its own session. The data is cleared by `clearOfflineData()`
(logout, once hooked up) and by the button on `/r/offline`. The `/r/offline` page explains this in Thai and English.
The service worker caches only static files and page shells, never API or database responses.

## Tests

- `tests/queue.test.ts` (13 tests): backoff, review codes, success removes the blob, backoff then needs-review then
  retry, refusals and NeedsReviewError, session-before-recording ordering and linking, no uploader, offline, idempotency
  and concurrency, deletion during upload, missing blob, sync gate.
- `tests/offline.test.ts` (10 tests): offline start rules (every refusal), plan caching, network-error detection, CSV id
  swap, the uploader steps, retry after a mid-chain failure through the queue, a refusal leading to needs-review,
  signed-out handling, missing RPC, and `mark_session_offline` on PGlite (permissions, the one-time flag, the 30-day
  bound, `start_session` idempotency).
- `npm run lint` and `npm test` pass (60 tests). `next build` passes, with the font stub reverted afterwards.
- **Browser** (`tests/e2e/offline.cjs`, new file; 1024×768 with touch) on the mocked Supabase with
  `NEXT_PUBLIC_GAZE_ENGINE=opencv`:
  1. Login online. The service worker installs (31 static entries and 7 pages cached).
  2. The child is cached, then `context.setOffline(true)`.
  3. Start offline from `/r/offline`, run the camera check and Tests 1–3. Navigation fell back from RSC to the cached
     pages.
  4. The summary shows "Saved on this device". There were 0 network calls, and one queue item with 559 CSV lines.
  5. Back online: `start_session`, `mark_session_offline`, the gaze upload to `org/<session>.csv` (clientSessionId
     replaced) and `complete_session` (retest, as expected with the fake camera) all ran. The page showed "Uploaded ✓"
     and `/r/offline` was empty.
- Screenshots were also taken at 768×1024 and 1024×768 of the camera check, Test 1, Test 2 and `/r`.

## Not tested

- The calibration operator bar on a real tablet. The e2e build uses OpenCV, which skips calibration, so the bar was
  never rendered; the CSS was checked only by reading it.
- A real iPad or Android tablet, Safari's IndexedDB Blob storage, and a real ~5 MB recording Blob (A's uploader).
- MediaPipe precache. The model was skipped in this build, so that precache entry is skipped too, which is
  harmless.
- Offline start after a fresh offline page load (see request 3).

## Requests for the lead

1. **ResearchShell: status chip.** In `topbarRight`, before `<span className={rs.muted}>{session.user.email}</span>`,
   add `<SyncStatusChip />` (`import SyncStatusChip from "./offline/SyncStatusChip"`). Optionally add a nav entry
   `{ href: "/r/offline", label: "ออฟไลน์ / Offline" }`.
2. **ResearchShell: logout.** Replace the logout body with:
   ```ts
   const { pending } = await import("@/lib/research/queue");
   const n = (await pending()).length;
   if (n > 0 && !window.confirm(`มี ${n} รายการยังไม่ได้ส่ง จะถูกลบเมื่อออกจากระบบ / ${n} item(s) not uploaded will be deleted on logout. Continue?`)) return;
   const { clearOfflineData } = await import("@/lib/research/offline/boot");
   await clearOfflineData();
   await getSupabase().auth.signOut();
   router.replace("/login");
   ```
3. **ResearchShell: working offline (needed for a fresh offline page load of `/r/*`).** Today `reloadOrgs()` fails
   offline, so the shell shows an error and `/r/offline` and `/r/check` can't render.
   - On success, save the memberships list to `localStorage` (`lookatme_memberships_<userId>`; org data only, no child
     data).
   - On error with `!navigator.onLine`, use that cached list.
   - Also call `cachePlanStatus(m.org)` (from `lib/research/offline/start.ts`) for each membership on success. This is
     the spec's "cache plan status at login".
   - When offline and `getSession()` returns null because the access token expired and can't refresh, don't redirect to
     /login if supabase's stored session exists (`sb-*-auth-token` in localStorage). Show the cached shell.

   My e2e worked without this only because the shell stays mounted during client navigation, and `/r/offline`
   prefetches `/r/check`.
4. **Agent B (ChildClient).** After loading the child and consent, call
   `cacheChildForOffline(child, consent, { blind })`, with `consent = null` when there is none. Use `startScreening()`
   from `lib/research/offline/start.ts` instead of its own RPC call.
5. **Agent A.** The recording uploader must be registered at app start, not only on the summary page, so queued
   recordings sync later. Ideally `bootOffline()` calls A's registration function; give me or the lead its name.
   - For offline sessions, enqueue with `sessionId: null` and the `clientSessionId`. The queue fills in the id after the
     session syncs (or use `linkedSessionId()`).
   - The blob is stored under `item.blobKey`, which must be unique.
   - Throw `NeedsReviewError("drive_needs_reconnect", …)` and similar for cases a person must fix.
6. **contracts.ts:** `NeedsReviewError` uses a TypeScript parameter property (`constructor(public code…)`), which Node's
   strip-only test runner rejects. So no test can import contracts.ts at runtime (mine inject the check instead).
   Suggested change:
   `export class NeedsReviewError extends Error { code: string; constructor(code: string, message: string) { super(message); this.code = code; this.name = "NeedsReviewError"; } }`
7. **next.config.ts (optional):** add headers for `/sw.js` (`Cache-Control: no-cache, no-store, must-revalidate`). Also
   add 192/512 px square PNG icons to the manifest for installability. Only `favicon.ico` is used now, because
   `logo.png` isn't square.
8. **New file outside my list:** `tests/e2e/offline.cjs` (the offline e2e). It doesn't conflict with anything.
9. **Bump `VERSION` in `public/sw.js`** when the precache list or the caching rules change.
