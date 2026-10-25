# Agent A: Google Drive and screen recording (Phase 4, spec §4)

Branch `research/p45-a`. Built and tested against mocked `fetch` only (no Google Cloud project yet).

## What was built

- **Connect / disconnect** (org admins, `/r/settings`):
  - `POST /api/drive/connect {orgId}` returns Google's consent URL, so the Supabase token never goes in a URL.
    The request asks for `openid email drive.file`, with `access_type=offline` and `prompt=consent`.
    The OAuth `state` is HMAC-signed `{org_id, user_id, nonce, exp=+10 min}` (`DRIVE_STATE_SECRET`).
    The route also sets an HttpOnly nonce cookie (path `/api/drive/callback`), so the callback only works in the
    browser that started it.
  - `GET /api/drive/callback`:
    1. Verifies the state signature, expiry and nonce cookie, then re-checks that the user is still an admin.
    2. Exchanges the code and requires a `refresh_token`.
    3. Encrypts the token (AES-256-GCM `iv:tag:ct`, `DRIVE_TOKEN_KEY`) and upserts `drive_connections`
       (`google_email` comes from the id_token).
    4. Creates the root folder "LookAtMe Recordings – <org>", or recreates it if it is missing or trashed.
    5. Redirects (303) to `/r/settings?drive=connected`, or to `?drive=error&reason=…`.
  - `POST /api/drive/disconnect` revokes the token at Google, sets `revoked` and wipes `refresh_token_enc`.
  - `GET /api/drive/status?orgId` (admin, staff or viewer) returns DriveStatus, google_email, last_error and
    hasFolder. It never returns tokens.
- **Upload**:
  - `POST /api/drive/start-upload {session_id, level, size, mimeType}`:
    - Checks that the caller is admin or staff of the session's org.
    - Checks for a current, non-withdrawn consent with `allow_recording`.
    - Checks Drive status. A not-connected or revoked Drive returns 409 `drive_not_connected`.
    - Refreshes the access token. On `invalid_grant` it sets `needs_reconnect` and returns 409 `drive_needs_reconnect`.
    - Makes sure the root and child-code folders exist.
    - Starts a resumable upload with the `Origin` header and appProperties
      `{lookatme_session, lookatme_org, lookatme_level}`. The file is named
      `<code>_<YYYYMMDD-HHmm Bangkok>_L<n>_<session>.webm`.
    - Returns `{uploadUrl, uploadSig}`.
  - `POST /api/drive/finish-upload`:
    - `{session_id, level, drive_file_id, size}`: checks the file with `files.get` (session, org, level, size,
      not trashed), then upserts `session_files` (`google_drive`, `level`).
    - `{…, location:"local_only"}`: records "saved on this computer".
  - `POST /api/drive/upload-chunk` is the CORS fallback proxy:
    - The body is the raw chunk, at most 3.75 MiB (15 × 256 KiB), with exact 256 KiB alignment.
    - It forwards only to a `www.googleapis.com/upload/drive/v3/files?...upload_id=` URL, and only one that
      start-upload signed for that session (`uploadSig`, HMAC). This prevents SSRF.
  - `GET /api/drive/files?sessionId` lists a session's recordings with `exists` true/false/null. `false` is shown
    as "ไม่พบไฟล์ใน Google Drive". Visibility matches session files (blind sessions: admins only).
- `deleteDriveFiles(orgId, fileIds)` in `lib/research/drive/server.ts` is implemented with the same signature.
  Missing files count as deleted. If Drive is not connected, every file is returned as failed.
- **Recording** (`lib/research/recording.ts`):
  - Draws a 640×360 canvas with the stimulus videos in their on-screen arrangement (letterboxed, object-fit
    contain), a 128×96 webcam inset (the mirrored preview canvas) and a gaze dot.
  - Records `captureStream(15)` with MediaRecorder: vp9, then vp8, then the browser default; 500 kbit/s.
  - Stops by itself if the videos leave the DOM or after 5 minutes.
- **Hook-up**: `researchLogger.start()` starts a recording only when `getResearchContext()?.allowRecording === true`,
  and `stop()` stops it. After that, `handleFinishedRecording`:
  - If the device preference `lookatme_recording_target` is `local_only`, or the org's Drive is `not_connected`
    or `revoked`, it downloads `<childCode>_<YYYYMMDD-HHmm>_L<level>.webm` and records `local_only`.
  - Otherwise it calls `enqueue()` with a RecordingQueueItem and the Blob. This includes `needs_reconnect`
    and offline, which stay queued.
- **Uploader** (`lib/research/recordingUploader.ts`, core in `drive/uploaderCore.ts`):
  - Registers `"recording"` with `registerUploader`.
  - Puts directly to Google in 8 MiB chunks with Content-Range, after a `bytes */size` resume query.
  - Retries 5xx/429 with backoff.
  - Keeps the session URL in localStorage per item, for resume. If the session expired (404/410) it starts a
    new one.
  - On a `TypeError` while online (CORS), it switches to the proxy in 3.75 MiB chunks. It then calls finish-upload.
  - Throws `NeedsReviewError` for `drive_needs_reconnect`, `drive_full` (storageQuotaExceeded),
    `drive_not_connected`, `no_recording_consent`, a missing blob, and 4xx.
  - Throws a plain (retryable) error when `sessionId` is null (an offline session that has not synced), when
    offline, or on 5xx.
- **Settings page** `/r/settings` (admins only):
  - Drive status, Connect / Reconnect / Disconnect.
  - Banners for needs-reconnect ("กรุณาเชื่อมต่อ Google Drive อีกครั้ง") and Drive full ("Google Drive เต็ม").
  - The result of the Google redirect.
  - The device recording-target choice (Google Drive / บันทึกในเครื่องนี้ / Save on this computer).
  - The number of queued recordings, with "Retry now".

## Files

- New: `app/api/drive/{connect,callback,disconnect,status,start-upload,finish-upload,upload-chunk,files}/route.ts`,
  `app/r/settings/page.tsx`, `components/research/DriveSettings.tsx`, `lib/research/drive/{config,crypto,google,service,
  http,callback,upload,deleteFiles,uploaderCore}.ts`, `lib/research/drive/RecordingLinks.tsx`, `lib/research/recording.ts`,
  `lib/research/recordingUploader.ts`, `styles/research-a.module.css`, `tests/drive.test.ts`, `tests/drive-rls.test.ts`,
  `tests/recording.test.ts`, `tests/drive-fakes.ts` (test helper; not picked up by the runner glob).
- Changed: `lib/research/drive/server.ts` (implementation), `lib/research/researchLogger.ts` (recording start/stop
  only), `.env.local.example` (Google Drive section).

## Migration

`supabase/migrations/20261026000201_session_files_level.sql`:
- Adds `session_files.level int not null default 0`, with a check that it is between 0 and 3 (0 is the gaze CSV).
- Replaces unique `(session_id, kind)` with `(session_id, kind, level)`.
- Adds a check that `google_drive` rows have a `drive_file_id`.
- Uses `create or replace complete_session` with the gaze upsert `on conflict (session_id, kind, level)`.
  All other behaviour and checks are unchanged, and the grants are re-applied.

## Tested

- `npm test`: all 68 tests pass, including the existing `rls.test.ts` and `contracts.test.ts`. New tests:
  - **crypto**: round trip, fresh IV, tamper detection (ciphertext, tag, wrong key, bad format), key length.
  - **OAuth state**: signature, 10-minute expiry, forged payload, wrong secret. Also upload-URL signatures.
  - **Chunk math**: 8 MiB / 3.75 MiB, 256 KiB multiples, under 4.5 MB, ranges, the `Range` → offset parser.
    Also the upload-URL allow-list and file names.
  - **Refresh `invalid_grant`**: the connection becomes `needs_reconnect` and the route returns 409. The next call
    doesn't reach Google. A damaged token is handled too.
  - **Folders**: the root folder is kept when it was moved; it is recreated when it is 404 or trashed. The child
    folder `q` is escaped.
  - **start-upload**: the Origin header, X-Upload headers, appProperties and parents. Drive full gives 507
    `drive_full` and `last_error`.
  - **finish-upload**: verification logic, the upsert per level, idempotency, mismatch (422), and a deleted file
    ("ไม่พบไฟล์ใน Google Drive").
  - **Proxy chunks**: validation and forwarding.
  - **Callback**: nonce, expiry, not admin, no refresh_token, the encrypted store and the root folder.
  - **deleteDriveFiles core**.
  - **Recorder lifecycle** with fake canvas and MediaRecorder: codec order, 500 kbit/s, layout, inset, gaze dot.
  - **Uploader**: direct chunks, CORS → proxy fallback, 5xx retry, NeedsReview codes, resume from Google's Range,
    null sessionId → retry.
  - **RLS / migration**: 3 recordings per session, duplicate level refused, level check, gaze CSV upsert still
    works with quota used once, other orgs and strangers see nothing, users can't write session_files, nobody
    can read or update `drive_connections`, and blind sessions hide recordings from staff.
- `npm run lint` is clean and `next build` passes (with the font stub, which was reverted).
- Browser on port 3301 with mocked Supabase and mocked `/api/drive/*`: the settings page shows the needs-reconnect
  banner, the Connect → redirect → "connected" message, the Drive-full banner and Disconnect. The device choice is
  saved to localStorage. The page works at 390 px. There were no page errors.

## Not tested (needs the real Google project or real hardware)

- **The direct browser PUT to the resumable session URL (CORS) still needs the real-Google spike at
  `/dev/drive-spike`.** The proxy fallback works either way, but direct upload is cheaper.
- The real OAuth round trip, Google's real error bodies (`invalid_grant`, `storageQuotaExceeded`) and the ~7-day
  Testing-mode refresh token expiry.
- MediaRecorder output quality and size on real webcams and tablets (Safari may only support mp4: it gets the
  browser default, and Drive stores it as `video/webm` metadata. Check this on iPad).

## Requests for the lead

1. **`lib/research/contracts.ts`**:
   - Add `level?: 1 | 2 | 3` to `RecordingQueueItem`. I set it on items now and also encode it in `blobKey`
     (`rec:<clientSessionId>:L<n>:<id>`). E's queue must store the item object as is, or keep `blobKey`.
   - Rewrite `NeedsReviewError` without a TypeScript parameter property:
     `code: string; constructor(code: string, message: string) { super(message); this.code = code; }`.
     Node's strip-only TS mode (`npm test`) can't load `public code` in a constructor, so tests can't import that
     class today. My uploader core receives the class by injection for this reason.
2. **Import `@/lib/research/recordingUploader` once app-wide** (e.g. in ResearchShell or E's queue bootstrap) so
   the "recording" uploader is registered on every page where the queue syncs. Today it registers when
   researchLogger (test pages) or `/r/settings` loads.
3. **Agent E**: when an offline session syncs, fill `sessionId` on queued recording items with the same
   `clientSessionId`. Until then my uploader throws a retryable error.
4. **Session page**: mount `<RecordingLinks sessionId={id} />` from `lib/research/drive/RecordingLinks.tsx` in
   `SessionClient.tsx`. It shows "เปิดใน Google Drive", "saved on the screening computer", or
   "ไม่พบไฟล์ใน Google Drive".
5. **Agent B**: `deleteDriveFiles` now works. Pass `session_files.drive_file_id`s for `kind='recording'`
   (there can be 3 per session).
6. Audit actions written: `drive_connect` and `drive_disconnect`. They are inserted with the service role, not
   through `log_action`.
7. Production env: set `APP_URL`. It is used as the upload `Origin` and as the callback redirect base, and the
   routes refuse to run in production without it. Also set `GOOGLE_*`, `DRIVE_TOKEN_KEY` and `DRIVE_STATE_SECRET`.
