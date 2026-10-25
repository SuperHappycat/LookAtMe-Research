# LookAtMe Research — Build Spec for Claude Code

> Read this whole file before writing code. Then explore the original repo (section 2.3) and write a short
> map of it before changing anything. When something here conflicts with what you find in the code, stop
> and ask instead of guessing.

## 0. Summary

LookAtMe is a webcam eye-tracking **autism screening** tool for young children (18 months – 6 years).
It is a **screening aid, not a diagnosis**; every result screen and export must say so
("ใช้คัดกรองเบื้องต้น ไม่ใช่การวินิจฉัย / Screening only, not a diagnosis").

There are two web apps, in **two separate repos**:

| | Individual app (exists) | Research app (to build) |
| --- | --- | --- |
| Repo | Original LookAtMe repo (shown on the team's deck as `Tambai/LookAtMe`; confirm exact URL) | New repo, cloned from the original (e.g. `LookAtMe-Research`) |
| URL | https://lookat-me.online | https://research.lookat-me.online |
| Users | Parents, no login | Invited staff of schools, behavioral development clinics, hospitals |
| Gaze engine | OpenCV.js in the browser | MediaPipe Face Landmarker (iris points) in the browser + calibration |
| Server data | None | Supabase: login, database, gaze CSV files |
| Recordings | None | Uploaded to **each customer's own Google Drive** |
| Price | Free | School 1,900 / Behavioral Dev. 2,900 / Hospital 4,900 THB per year |

**Hard constraint: the prototype must run on free tiers only** (GitHub, Vercel Hobby, Supabase Free,
Google Cloud OAuth in Testing mode). Do not add any paid service or paid add-on.

---

## 1. Plans (used for limits)

| Plan key | Org type | Screenings / year | Staff seats | Extra features |
| --- | --- | --- | --- | --- |
| `school` | school | 300 | 3 | class list import, parent letter |
| `behavioral_dev` | behavioral development clinic | 1,000 | 5 | repeat-screening trend, clinic logo on reports |
| `hospital` | hospital | unlimited (`null`) | 15 | areas of interest, diagnosis follow-up, blind mode, group summary, multi-site, custom videos, raw export |

All Research plans: MediaPipe engine, calibration, spreadsheet export, screen recording, dashboard,
consent + coded IDs, session quality score, pre-test camera check, replay with gaze dot,
questionnaire, age comparison, offline mode, tablet support, consent withdrawal.

Gate features by `organizations.plan` in one place (e.g. `src/research/plan-features.ts`), never scattered `if`s.

---

## 2. Repo setup: clone the original app into a new repo

### 2.1 Create the new repo (keep history, keep a link to the original)

The human creates an **empty** GitHub repo first (no README, no license), e.g. `<owner>/LookAtMe-Research`. Then:

```bash
git clone https://github.com/Tambai/LookAtMe.git LookAtMe-Research   # confirm the real URL
cd LookAtMe-Research
git remote rename origin upstream          # the original app = "upstream"
git remote add origin https://github.com/<owner>/LookAtMe-Research.git
git push -u origin main                    # use the original's default branch name if not main
git remote -v                              # expect: origin = new repo, upstream = original
```

Do **not** use GitHub's "fork" button. A fork of a public repo stays public and is linked in GitHub's UI.
A clone with an `upstream` remote gives the same syncing without that.

Check the original's `LICENSE`. Keep it and keep attribution. The new repo may be public or private.
Never commit secrets (section 7).

### 2.2 Keeping the two repos in sync

The shared screening code (test videos, 3-level flow, timing, scoring) must stay the same in both apps.

- **Shared bug fixes go into the original repo first**, then are pulled into Research:
  ```bash
  git fetch upstream
  git merge upstream/main     # resolve conflicts, run the app, commit
  ```
- To keep merges easy:
  - **Do not move or rename** the original's existing files unless unavoidable.
  - Put **all Research-only code in new folders** (e.g. `src/research/`, `api/`, `supabase/`), not mixed into original files.
  - Where the original code must change (e.g. to swap the gaze engine), change it through **one small seam**
    (the `GazeProvider` interface, section 2.4), so upstream changes rarely conflict.
- Never push Research-only code to `upstream`. To be safe:
  `git remote set-url --push upstream DISABLED`.

### 2.3 First task: map the original repo (no code changes)

Before building, write `docs/ORIGINAL_APP_MAP.md` with:
- framework and build tool (plain HTML/JS, Vite, React, Next.js…), package manager, Node version;
- how the app runs locally and how Vercel builds it (`vercel.json`, build command, output dir);
- where the OpenCV gaze code is, and what it outputs (per-frame? coordinates? which units?);
- where the 3 levels (3 × 20 s videos) are defined, how timing works, where the videos live;
- how the percentage score is calculated (exact formula and file);
- how results are emailed (service, API key location, template);
- anything that stores data (localStorage, cookies, APIs).

Keep the original framework. Do not rewrite the app in a different framework.

### 2.4 The gaze engine seam

Create an interface. Make the original OpenCV code one implementation, and add MediaPipe as a second:

```ts
// src/research/gaze/types.ts
export interface GazeSample {
  t: number;            // ms since level start
  level: 1 | 2 | 3;
  videoId: string;
  x: number | null;     // screen px (null if no face / no estimate)
  y: number | null;
  faceFound: boolean;
  confidence?: number;  // 0..1 if available
}
export interface CalibrationResult {
  ok: boolean;
  meanErrorPx: number;
  points: number;
}
export interface GazeProvider {
  init(video: HTMLVideoElement): Promise<void>;
  calibrate?(): Promise<CalibrationResult>;
  onSample(cb: (s: GazeSample) => void): void;
  stop(): void;
}
```

The scoring code must only read `GazeSample[]`. It must not care which engine produced them.

**MediaPipe implementation**
- Package: `@mediapipe/tasks-vision`, `FaceLandmarker`, `runningMode: "VIDEO"`, `numFaces: 1`.
  Iris landmarks are indices 468–477.
- Pin exact versions of the npm package, the WASM files and the `.task` model. Serve the WASM and model
  **from the app itself** (`/public/mediapipe/…`), not a CDN, so offline mode works.
- Run detection in `requestAnimationFrame`, throttled to about 30 fps. Use the `<video>` element's
  `currentTime` as the timestamp.

**Calibration** (Research only)
- 9 dots (3×3 grid at 10% / 50% / 90% of the screen), about 1.5 s each, child-friendly animated dot.
  Collect iris-centre features relative to the eye corners and head pose.
- Fit a mapping from features to screen x, y (start with 2nd-order polynomial ridge regression in plain TS;
  no heavy ML libraries).
- Validate with 4 extra dots and compute `meanErrorPx`.
- `ok = meanErrorPx <= CONFIG.maxCalibrationErrorPx`. **The threshold value is TBD**: put it in config
  with a placeholder and a comment that it must be tuned with pilot data. Do not invent clinical thresholds.
- Offer "recalibrate" up to 2 times, then allow continuing with a "low accuracy" flag on the session.

---

## 3. Supabase (free tier)

### 3.1 Project setup (done by a human in the dashboard)

1. Create a project in region **Southeast Asia (Singapore)**. Note the Project URL, the `anon` key and the
   `service_role` key.
2. **Auth → Providers → Email**: enable. Turn **off** "Allow new users to sign up" (invite-only).
3. **Auth → URL configuration**: Site URL `https://research.lookat-me.online`. Add redirect URLs for
   localhost and the Vercel preview domain.
4. **Storage**: create a **private** bucket `gaze`.
5. Free-tier facts to design around:
   - 500 MB database, 1 GB file storage.
   - The project **pauses after 1 week without activity**; restore it from the dashboard.
   - Built-in auth email is heavily rate-limited (only a few emails per hour). Fine for a prototype;
     later use a free SMTP provider.

Keep all schema as SQL migrations in `supabase/migrations/` (Supabase CLI, `supabase db push`), so the
database can be rebuilt from the repo.

### 3.2 Schema (first migration)

```sql
create extension if not exists pgcrypto;

create type org_type as enum ('school', 'behavioral_dev', 'hospital');
create type member_role as enum ('admin', 'staff', 'viewer');

create table organizations (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  type             org_type not null,
  plan             org_type not null,               -- plan key = org type for now
  screening_quota  int,                             -- null = unlimited
  screenings_used  int not null default 0,
  seats            int not null,
  expires_on       date not null,
  drive_folder_id  text,                            -- root "LookAtMe Recordings" folder in the customer's Drive
  created_at       timestamptz not null default now()
);

create table platform_admins (                      -- LookAtMe team (owner role)
  user_id uuid primary key references auth.users on delete cascade
);

create table members (
  user_id    uuid not null references auth.users on delete cascade,
  org_id     uuid not null references organizations on delete cascade,
  role       member_role not null default 'staff',
  created_at timestamptz not null default now(),
  primary key (user_id, org_id)
);

create table children (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations on delete cascade,
  code        text not null,                        -- e.g. CMU-0042; NO names, NO national ID
  birth_month date,                                 -- first day of birth month only
  sex         text check (sex in ('M', 'F', 'U')),
  created_at  timestamptz not null default now(),
  unique (org_id, code)
);

create table consents (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations on delete cascade,
  child_id          uuid not null references children on delete cascade,
  guardian_relation text not null,                  -- mother / father / guardian…
  consent_version   text not null,                  -- version of the consent text shown
  allow_recording   boolean not null default false, -- separate tick box for video recording
  allow_research    boolean not null default false, -- data may be used in research studies
  signed_at         timestamptz not null default now(),
  withdrawn_at      timestamptz
);

create table sessions (
  id                    uuid primary key default gen_random_uuid(),
  client_session_id     uuid not null unique,       -- created in the browser; makes offline sync idempotent
  org_id                uuid not null references organizations on delete cascade,
  child_id              uuid not null references children on delete cascade,
  staff_id              uuid references auth.users,
  status                text not null default 'started' check (status in ('started', 'completed', 'invalid')),
  engine                text not null default 'mediapipe',
  started_at            timestamptz not null default now(),
  completed_at          timestamptz,
  calibration_error_px  numeric,
  low_accuracy          boolean not null default false,
  face_found_pct        numeric,                    -- 0..100
  quality_score         numeric,                    -- 0..100
  retest_needed         boolean not null default false,
  level1_score          numeric,
  level2_score          numeric,
  level3_score          numeric,
  overall_score         numeric,
  risk_level            text check (risk_level in ('low', 'medium', 'high')),
  blind                 boolean not null default false,  -- hospital blind mode
  created_offline       boolean not null default false
);

create table session_files (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations on delete cascade,
  session_id     uuid not null references sessions on delete cascade,
  kind           text not null check (kind in ('gaze_csv', 'recording')),
  location       text not null check (location in ('supabase', 'google_drive', 'local_only')),
  path           text,                              -- Supabase storage path
  drive_file_id  text,                              -- Google Drive file id
  size_bytes     bigint,
  created_at     timestamptz not null default now()
);

create table diagnoses (                            -- hospital: diagnosis follow-up
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations on delete cascade,
  child_id      uuid not null references children on delete cascade,
  result        text not null check (result in ('asd', 'not_asd', 'other', 'pending')),
  diagnosed_on  date,
  recorded_by   uuid references auth.users,
  created_at    timestamptz not null default now()
);

create table drive_connections (                    -- SERVER ONLY (no RLS policies => clients can't read)
  org_id             uuid primary key references organizations on delete cascade,
  google_email       text,
  refresh_token_enc  text,                          -- AES-256-GCM, see section 4.5
  status             text not null default 'active' check (status in ('active', 'needs_reconnect', 'revoked')),
  connected_by       uuid references auth.users,
  connected_at       timestamptz not null default now(),
  last_error         text
);

create table audit_log (
  id       bigserial primary key,
  org_id   uuid references organizations on delete cascade,
  user_id  uuid references auth.users,
  action   text not null,     -- 'view_results' | 'export_csv' | 'invite' | 'withdraw_consent' | …
  target   text,
  at       timestamptz not null default now()
);
```

### 3.3 Row Level Security

Enable RLS on **every** table. Helper functions:

```sql
create or replace function is_member(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where org_id = o and user_id = auth.uid());
$$;

create or replace function has_role(o uuid, roles member_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where org_id = o and user_id = auth.uid() and role = any (roles));
$$;
```

Policies (write each explicitly):

| Table | select | insert / update | delete |
| --- | --- | --- | --- |
| organizations | `is_member(id)` | none (server only) | none |
| members | `is_member(org_id)` | none (server `/api/invite`) | none (server) |
| children | `is_member(org_id)` | `has_role(org_id, '{admin,staff}')` | none (server, via withdrawal) |
| consents | `is_member(org_id)` | `has_role(org_id, '{admin,staff}')` | none |
| sessions | `is_member(org_id)` **and** (`not blind` or role admin) | via RPCs only (3.4) | none |
| session_files | `is_member(org_id)` | server only | server only |
| diagnoses | `has_role(org_id, '{admin,staff}')` | `has_role(org_id, '{admin,staff}')` | none |
| drive_connections | **no policies** (server only) | none | none |
| audit_log | `has_role(org_id, '{admin}')` | server only | none |
| platform_admins | none | none | none |

Storage bucket `gaze`, path = `<org_id>/<session_id>.csv`:

```sql
create policy "gaze read" on storage.objects for select
  using (bucket_id = 'gaze' and is_member(((storage.foldername(name))[1])::uuid));
create policy "gaze upload" on storage.objects for insert
  with check (bucket_id = 'gaze' and has_role(((storage.foldername(name))[1])::uuid, '{admin,staff}'));
```

**Write a test** (SQL or a script) proving that a user in org A gets zero rows from org B for every table
and for the bucket.

### 3.4 RPCs for screening limits

```sql
-- Called when a screening starts. Checks plan, quota and consent; creates the session.
create or replace function start_session(p_child uuid, p_client_session_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; o organizations; v_id uuid;
begin
  select id into v_id from sessions where client_session_id = p_client_session_id;
  if v_id is not null then return v_id; end if;                          -- idempotent (offline retries)

  select org_id into v_org from children where id = p_child;
  if v_org is null or not has_role(v_org, '{admin,staff}') then raise exception 'not_allowed'; end if;

  select * into o from organizations where id = v_org;
  if o.expires_on < current_date then raise exception 'plan_expired'; end if;
  if o.screening_quota is not null and o.screenings_used >= o.screening_quota then
    raise exception 'quota_reached';
  end if;
  if not exists (select 1 from consents where child_id = p_child and withdrawn_at is null) then
    raise exception 'no_consent';
  end if;

  insert into sessions (client_session_id, org_id, child_id, staff_id)
  values (p_client_session_id, v_org, p_child, auth.uid()) returning id into v_id;
  return v_id;
end $$;
```

`complete_session(p_session uuid, p_results jsonb)`: saves scores, quality fields and `completed_at`;
sets `status = 'completed'` (or `'invalid'` if `retest_needed`). It increments
`organizations.screenings_used` **only on the first transition to `completed`**; invalid sessions do not
use up quota. It is idempotent.

The UI maps the errors `plan_expired`, `quota_reached` and `no_consent` to clear Thai and English messages
("ติดต่อ LookAtMe เพื่อต่ออายุหรือเพิ่มจำนวนการคัดกรอง").

### 3.5 Server functions (Vercel `/api`, Node runtime)

All of them verify the caller's Supabase JWT (`Authorization: Bearer <access_token>`, then
`supabase.auth.getUser(token)`), check the role, write to `audit_log`, and only then use the
service-role client.

| Route | Who | What |
| --- | --- | --- |
| `POST /api/invite` | org admin | Checks seats (`count(members) < seats`), calls `auth.admin.inviteUserByEmail(email, { redirectTo })`, inserts `members` row |
| `POST /api/remove-member` | org admin | Removes a member (cannot remove the last admin) |
| `POST /api/admin/org` | platform admin | Creates or updates an organization (plan, quota, seats, expiry) and invites its first admin |
| `POST /api/withdraw-consent` | org admin | Section 5.3 |
| `/api/drive/*` | see section 4 | Google Drive |

The Vercel Hobby request body limit is about 4.5 MB. Never send video through these functions except via
the chunked fallback (section 4.4).

---

## 4. Google Drive (each customer's own Drive)

### 4.1 Principle

Screen recordings are stored in the **customer organization's own Google Drive**, never on LookAtMe servers.
LookAtMe keeps only an encrypted refresh token and the Drive file IDs.
Scope: **`https://www.googleapis.com/auth/drive.file` only**. The app can see only files and folders it
created. Never request `drive` or `drive.readonly`.

Recording happens only if the child's consent has `allow_recording = true`. If the organization has no Drive
connected, or chooses "save on this computer", the recording is downloaded locally instead
(`location = 'local_only'`, no file id).

### 4.2 Google Cloud setup (done by a human, free)

1. https://console.cloud.google.com → new project "LookAtMe Research".
2. **APIs & Services → Library**: enable **Google Drive API**.
3. **OAuth consent screen**: User type **External**. App name "LookAtMe Research", support email, app
   domain `lookat-me.online`, privacy policy URL (create a simple `/privacy` page in the app).
   Scopes: `openid`, `email`, `https://www.googleapis.com/auth/drive.file`.
   **Publishing status: Testing.** Add **test users** (the team and pilot organizations' Google accounts,
   max 100).
4. **Credentials → Create OAuth client ID → Web application.** Authorized redirect URIs:
   - `https://research.lookat-me.online/api/drive/callback`
   - `http://localhost:<dev-port>/api/drive/callback`
5. Copy the Client ID and Client secret into Vercel env vars (section 7).

Testing-mode limits to design around:
- Only listed test users can connect.
- **Refresh tokens expire after about 7 days**, so organizations must reconnect weekly during the prototype.
  The app must handle this gracefully (4.6).
- Later, publishing to Production needs Google's OAuth verification (free). `drive.file` keeps the review light.

### 4.3 Connect flow (org admin, once)

1. Settings page → **"เชื่อมต่อ Google Drive / Connect Google Drive"** (admins only).
2. `GET /api/drive/connect?token=<supabase access token>`:
   - verify the JWT and admin role;
   - create `state` = HMAC-signed `{org_id, user_id, nonce, exp: now+10min}` (key: `DRIVE_STATE_SECRET`);
   - redirect to `https://accounts.google.com/o/oauth2/v2/auth` with
     `client_id`, `redirect_uri`, `response_type=code`, `scope=openid email https://www.googleapis.com/auth/drive.file`,
     `access_type=offline`, `prompt=consent`, `include_granted_scopes=true`, `state`.
3. `GET /api/drive/callback?code&state`:
   - verify the `state` signature and expiry;
   - exchange `code` at `https://oauth2.googleapis.com/token`;
   - require a `refresh_token` (if it is missing, show "please reconnect" and log it);
   - encrypt it (4.5) and upsert `drive_connections` (`status='active'`, `google_email` from the id_token);
   - create the root folder if `organizations.drive_folder_id` is null, or if that folder is gone/trashed:
     `POST https://www.googleapis.com/drive/v3/files` with
     `{ name: "LookAtMe Recordings – <org name>", mimeType: "application/vnd.google-apps.folder" }`;
     save its id;
   - redirect to `/settings?drive=connected`.

### 4.4 Upload flow (after each screening)

**Recording format** ("advanced screen recording")
- Composite on an offscreen `<canvas>` (e.g. 640×360): the stimulus video frame, plus a small webcam inset,
  plus an optional gaze dot. Then use `canvas.captureStream(15)`.
- Use `MediaRecorder` with `mimeType` `video/webm;codecs=vp9` (fallback `vp8`, then the browser default;
  check with `MediaRecorder.isTypeSupported`) and `videoBitsPerSecond: 500_000`. That is roughly
  4 MB per minute, so a 3 × 20 s test is about 4–5 MB.
- Save the finished Blob to **IndexedDB first** (upload queue, see offline 5.4), then upload.

**Upload**
1. Client → `POST /api/drive/start-upload` `{ session_id, size, mimeType }` with the JWT.
2. Server:
   - verify membership, the session's org, and that `consents.allow_recording = true`;
   - load `drive_connections`; if `status != 'active'`, return `409 drive_needs_reconnect`;
   - get an access token: `POST https://oauth2.googleapis.com/token` with `grant_type=refresh_token`.
     On `invalid_grant`, set `status='needs_reconnect'` and return 409;
   - find or create the child subfolder under the root:
     `GET /drive/v3/files?q=name='<child_code>' and '<root_id>' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
     (this works with `drive.file` because the app created the folder);
   - start a **resumable upload**:
     `POST https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable`
     with headers `X-Upload-Content-Type: video/webm`, `X-Upload-Content-Length: <size>`,
     `Origin: https://research.lookat-me.online`, and body
     `{ name: "<child_code>_<YYYYMMDD-HHmm>_<session_id>.webm", parents: [<child_folder_id>], appProperties: { lookatme_session: <session_id>, lookatme_org: <org_id> } }`;
   - return the `Location` header (the upload session URL) to the client.
3. Client `PUT`s the Blob to the session URL in chunks of 8 MiB (a multiple of 256 KiB) with
   `Content-Range`. Retry on 5xx with backoff. Resume by sending `PUT` with `Content-Range: bytes */<size>`.
4. Client → `POST /api/drive/finish-upload` `{ session_id, drive_file_id }`. The server checks it with
   `GET /drive/v3/files/<id>?fields=id,size,appProperties`, confirms `appProperties.lookatme_session`
   matches, and inserts a `session_files` row (`location='google_drive'`).
5. Remove the Blob from IndexedDB only after step 4 succeeds.

**CORS spike: do this in Phase 1.** Confirm the browser can `PUT` to the resumable session URL created
server-side with the `Origin` header. If the browser blocks it, use the fallback: proxy chunks through
`POST /api/drive/upload-chunk`. Each chunk must be **3.75 MiB (15 × 256 KiB)** to stay under Vercel's
roughly 4.5 MB body limit; the server forwards it with `Content-Range`.

### 4.5 Token security

- Encrypt refresh tokens with **AES-256-GCM** (Node `crypto`). The key comes from env `DRIVE_TOKEN_KEY`
  (32 random bytes, base64). Store `iv:authTag:ciphertext` (base64).
- Decrypt only inside `/api/drive/*`. Never send refresh tokens or access tokens to the browser.
  Never log them.

### 4.6 Errors and edge cases

| Case | Behaviour |
| --- | --- |
| Refresh token expired / revoked (`invalid_grant`) | Set `needs_reconnect`. Keep recordings queued in IndexedDB. Show admins a banner "กรุณาเชื่อมต่อ Google Drive อีกครั้ง". Staff can keep screening |
| Customer deleted or moved the root folder | Moved: still works by id. Deleted/trashed: create a new root folder on the next upload |
| Customer deleted a video | Dashboard shows "ไม่พบไฟล์ใน Google Drive" (file not found) instead of an error |
| Drive full (`storageQuotaExceeded`) | Keep it queued. Tell the admin "Google Drive เต็ม" |
| No Drive connected | Offer "save on this computer" (download the `.webm`) and record `location='local_only'` |
| Disconnect | `POST https://oauth2.googleapis.com/revoke?token=<refresh>`, set `status='revoked'`, wipe `refresh_token_enc`. Files stay in the customer's Drive |

### 4.7 Viewing recordings

The dashboard shows **"เปิดใน Google Drive"** linking to `https://drive.google.com/file/d/<id>/view`.
Access is controlled by the customer's own Drive sharing. The app does not stream or proxy video
(that would cost bandwidth).

"Replay with gaze dot" does **not** need the recording. It plays the original stimulus video (bundled with
the app) and draws the gaze dot from the session's gaze CSV.

---

## 5. Functions to build

Build first: ★ session quality score, ★ diagnosis follow-up, ★ offline mode.

| Area | Function | What it does | Plans |
| --- | --- | --- | --- |
| Data quality | ★ Session quality score | % of time the face was found, plus lighting and distance; flags "retest needed" automatically | All Research |
| Data quality | Pre-test camera check | 5-second lighting and seating check before the test starts | All Research |
| Data quality | Replay with gaze dot | Stimulus video plus gaze dot drawn from the gaze CSV | All Research |
| Screening | Questionnaire alongside gaze test | Parent questionnaire (e.g. M-CHAT-R/F; **check its permission and licence terms first**) shown side by side with the gaze result | All Research |
| Screening | Age comparison | The child's score compared with same-age children, once enough data exists | All Research |
| Screening | Repeat screening trend | Chart of the same child's scores over time | Behavioral Dev., Hospital |
| Research | Areas of interest | Draw boxes on a video (e.g. face vs toy); report looking time per box and time to first look | Hospital |
| Research | ★ Diagnosis follow-up | Record the final diagnosis later; calculate sensitivity and specificity | Hospital |
| Research | Blind mode | Hide the risk result from staff during a study | Hospital |
| Research | Group summary | Compare by age, site or group; export ready for SPSS or R | Hospital |
| Research | Multi-site studies | Several hospitals in one study, each seeing only its own data, plus a combined summary | Hospital |
| Practical | ★ Offline mode | Screen without internet; upload when back online | All Research |
| Practical | Tablet support | Works on tablets (touch-friendly, portrait and landscape) | All Research |
| Practical | Consent withdrawal | A parent asks to delete their child's data; one action removes everything | All Research |

### 5.1 ★ Session quality score

Computed in the browser at the end of the session and saved via `complete_session`.
- `face_found_pct` = samples with `faceFound` / total samples × 100.
- Lighting: mean luminance of downscaled webcam frames (sampled once per second) must stay within
  `CONFIG.lumaMin..lumaMax`.
- Distance: inter-pupil distance in px, relative to the video width, must stay within `CONFIG.ipdMin..ipdMax`.
- `quality_score` (0–100) = a weighted mix of the three (weights in config).
- `retest_needed = face_found_pct < CONFIG.minFaceFoundPct || calibration failed`.
- **All thresholds and weights live in one config file, marked "TBD – tune with pilot data".**
  Do not hard-code clinical cut-offs.
- The result screen shows a clear "ควรทดสอบซ้ำ / Retest recommended" when needed.

### 5.2 ★ Diagnosis follow-up (Hospital)

- From a child's page, staff add a `diagnoses` row (result + date).
- Statistics page: take each child's **first completed, non-invalid** session. Positive = `risk_level = 'high'`
  (make the positive definition configurable: high only, or medium + high). Build a 2×2 table against
  `asd` vs `not_asd` (exclude `other` and `pending`, and show how many were excluded).
- Show TP, FP, FN, TN, sensitivity = TP/(TP+FN), specificity = TN/(TN+FP), PPV, NPV, each with a
  **95% Wilson confidence interval**. Show "ข้อมูลยังไม่พอ" (not enough data) if a denominator is below
  `CONFIG.minNForStats`.
- Export the 2×2 table and the row-level data (coded IDs only) as CSV.

### 5.3 Consent withdrawal

`POST /api/withdraw-consent { child_id }` (org admin):
1. Delete each recording from Drive (`DELETE /drive/v3/files/<id>`; allowed for app-created files).
   Ignore "not found".
2. Delete the gaze CSVs from the bucket.
3. Delete `children` (which cascades to consents, sessions, session_files, diagnoses).
4. Write `audit_log` with **no child data** in `target`.
5. Show a confirmation screen with a summary.

`screenings_used` is not refunded.

### 5.4 ★ Offline mode

- Make it a PWA. The service worker caches the app shell, the stimulus videos, and the MediaPipe WASM and
  model (`/public/mediapipe`).
- `client_session_id` is generated in the browser for every session.
- **IndexedDB stores**: `pendingSessions` (child, consent snapshot, results, gaze samples) and
  `pendingUploads` (recording Blobs).
- Offline rules:
  - The user must have logged in online before. Cache the org's plan status (`expires_on`, quota left)
    at login.
  - Allow offline screening only if the cached `expires_on` has not passed, and at most
    `CONFIG.maxOfflineSessions` (e.g. 20) are pending.
  - New children and consents can be created offline. They also use client-generated UUIDs.
- Sync on the `online` event and on app start:
  children → consents → `start_session` → `complete_session` → gaze CSV upload → Drive upload.
  Each step is idempotent. If the server rejects a session (e.g. `quota_reached`), keep the data, mark it
  "ต้องตรวจสอบ" (needs review), and show it to an admin. Never silently drop data.
- Show a visible status chip: ออนไลน์ / ออฟไลน์ / รอส่งข้อมูล N รายการ (online / offline / N items waiting).

### 5.5 Gaze CSV format

One file per session, at `gaze/<org_id>/<session_id>.csv`, UTF-8 with a header row:

```
session_id,level,video_id,t_ms,x_px,y_px,x_norm,y_norm,face_found,confidence
```

`x_norm` / `y_norm` = position as a fraction of the stimulus video area (0..1), so different screen sizes
can be compared. Spreadsheet export = these rows joined with session-level fields (coded ID, age in months,
sex, scores, quality).

---

## 6. Privacy rules (PDPA)

- No child names, national IDs, addresses or photos in Supabase. Use coded IDs only.
- Consent (with version) must exist before any session. Recording needs its own separate consent tick box.
- Video never goes to LookAtMe servers. It goes to the customer's Drive, or stays local.
- `audit_log` records views of results, exports, invites and withdrawals.
- Every result screen, export and recording file name avoids personal data, and every screen shows the
  "screening only, not a diagnosis" line.
- A `/privacy` page in Thai and English explains what is stored where (Supabase Singapore; recordings in the
  customer's own Google Drive).
- Research use of the data needs the hospital's own ethics committee approval. Show this as a note on the
  export page.

---

## 7. Environment variables

| Name | Where | Notes |
| --- | --- | --- |
| `VITE_` / `NEXT_PUBLIC_SUPABASE_URL` | client | prefix depends on the framework |
| `VITE_` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client | safe to expose; RLS protects data |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | **never** in client code or git |
| `GOOGLE_CLIENT_ID` | server | |
| `GOOGLE_CLIENT_SECRET` | server only | |
| `GOOGLE_REDIRECT_URI` | server | per environment |
| `DRIVE_TOKEN_KEY` | server only | 32 random bytes, base64 |
| `DRIVE_STATE_SECRET` | server only | HMAC key for OAuth `state` |
| `APP_URL` | server | `https://research.lookat-me.online` |

Add `.env.example` with names only. Make sure `.gitignore` covers `.env*` (except `.env.example`).
In Vercel, set the variables per environment (Production / Preview / Development).

---

## 8. Hosting

- New Vercel project from the **new** repo (Hobby plan; this is fine for a non-commercial prototype).
- Domain: add `research.lookat-me.online` in Vercel → at the DNS provider add `CNAME research → cname.vercel-dns.com`
  (use the exact value Vercel shows).
- The original Vercel project (lookat-me.online) stays untouched.

---

## 9. Build phases and "done" checks

**Phase 1 — Clone and engine**
- [ ] New repo cloned with `upstream` remote; pushes to `upstream` disabled
- [ ] `docs/ORIGINAL_APP_MAP.md` written
- [ ] `GazeProvider` seam; OpenCV adapter still produces the same scores as before (compare on a recorded test run)
- [ ] MediaPipe provider and 9-point calibration working in Chrome desktop
- [ ] Drive resumable-upload CORS spike done and the result written down
- Done when: research.lookat-me.online runs a full 3-level test with MediaPipe and shows a score.

**Phase 2 — Supabase and the gate**
- [ ] Migrations, RLS, storage policies, cross-org isolation test passes
- [ ] Invite-only login; owner admin page; `/api/invite` with seat check
- [ ] Children (coded), consent form, `start_session` / `complete_session` with quota checks
- Done when: two test orgs can't see each other's data, and quota and expiry errors show correctly.

**Phase 3 — Results**
- [ ] Gaze CSV upload; dashboard with filters; spreadsheet export; ★ session quality score; pre-test camera check; replay with gaze dot
- Done when: an admin can export a CSV of all sessions, and poor sessions are flagged "retest".

**Phase 4 — Google Drive and recording**
- [ ] Connect / disconnect Drive; canvas recording; resumable upload; error states (4.6); "save on this computer"
- Done when: a recording appears in the customer's Drive under `LookAtMe Recordings/<child_code>/`, and a
  `needs_reconnect` state recovers without losing the video.

**Phase 5 — Offline and research tools**
- [ ] ★ Offline mode; consent withdrawal; ★ diagnosis follow-up; blind mode; repeat trend
- [ ] Areas of interest; group summary; multi-site; questionnaire (after licence check); age comparison; tablet layout
- Done when: a session done in airplane mode syncs correctly after reconnecting, and the diagnosis stats page
  shows correct numbers on a hand-checked test dataset.

---

## 10. Working rules for Claude Code

- Small commits, one feature each; never commit secrets.
- Ask the human before: changing the original repo, adding any dependency over about 200 KB, adding any paid
  service, or changing the scoring formula.
- Every user-facing text is in Thai first, with English second where it helps.
- Thresholds and clinical cut-offs live in config files and are marked TBD. Never invent them.

