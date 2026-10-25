# Phase 1 notes (Research app)

Status of spec Phase 1 (`docs/RESEARCH_APP_SPEC.md` §9), written Oct 25, 2026.

| Phase 1 item | Status |
| --- | --- |
| New repo cloned with `upstream` remote | Done (by the local Claude Code session) |
| `docs/ORIGINAL_APP_MAP.md` | Done |
| `GazeProvider` seam; OpenCV adapter unchanged | **Done**: `lib/research/gaze/` |
| MediaPipe provider + 9-point calibration | **Built, needs a real-webcam test** (see "Test on a real computer") |
| Drive resumable-upload CORS spike | **Test page built**; needs a Google token to run (see below) |

## What changed

**New (Research-only) code**
- `lib/research/config.ts`: every tunable number. Calibration and AOI values are **TBD – tune with pilot data**.
- `lib/research/gaze/`
  - `types.ts`: the `GazeEngine` seam (one interface for both engines).
  - `opencvEngine.ts`: wraps the original OpenCV worker; same behaviour as before.
  - `mediapipeEngine.ts`: MediaPipe Face Landmarker (iris landmarks), self-hosted files, 100 ms cadence.
  - `features.ts`: eye-in-socket and head-pose features from landmarks.
  - `regression.ts`: ridge regression (features → screen px); no ML libraries.
  - `calibrationStore.ts`: keeps the calibration for the tab; discarded if the window size changes.
  - `direction.ts`: turns a gaze point into Left / Center / Right from where the stimulus videos are.
- `app/calibrate` + `components/research/CalibrationClient.tsx`: 9 dots, then 4 check dots.
  Pass if mean error ≤ `maxCalibrationErrorPx`. Recalibrate up to 2 times, then "continue with low accuracy".
- `app/dev/drive-spike` + `app/api/dev/drive-spike`: dev-only Drive upload test (hidden unless `ENABLE_DEV_TOOLS=1`).
- `scripts/setup-mediapipe.mjs`: copies MediaPipe WASM into `public/mediapipe/` and downloads the official
  `face_landmarker.task` model. Runs automatically before `npm run dev` and `npm run build`.
- `tests/gaze.test.ts`: unit tests (`npm test`).

**Original files touched (kept small, for easy upstream merges)**
- `hooks/useGazeTestRunner.ts`: talks to the engine seam instead of the worker directly. Blocks tests with a
  clear message if MediaPipe isn't calibrated.
- `components/IntakeClient.tsx`: preloads the active engine. Goes to `/calibrate` (not `/test1`) when the engine
  needs calibration.
- `package.json`: `@mediapipe/tasks-vision` pinned to 1.1.1; `setup:mediapipe`, `predev`, `prebuild` and `test` scripts.
- `tsconfig.json` excludes `tests/`. `.gitignore` ignores `public/mediapipe/`.

**Scoring is unchanged.** All three tests still read only `direction` / `eyesDetected`, and each sample is still
100 ms, because MediaPipe is fed at the same 100 ms tick as OpenCV.

## How MediaPipe maps to the existing scoring

| Test | Gaze point position | Direction | Scored as |
| --- | --- | --- | --- |
| Test 1 (two videos) | left of the left video's right edge | Left | Human or Geometric (by `humanSide`) |
| | right of the right video's left edge | Right | Human or Geometric |
| | gap between the videos | Center | Other |
| Test 2, Test 3 (one video) | inside the video + `aoiMarginPx` | Center | on target |
| | outside | Left / Right | off target |
| Any | blink or no face | Unknown, `eyesDetected=false` | off target / Other |

## Verified here (cloud sandbox, no real webcam)

- `npm run lint` clean, `npm test` 9/9 pass, `next build` passes.
- OpenCV engine (`NEXT_PUBLIC_GAZE_ENGINE=opencv`): Test 1 runs end to end with a fake camera and shows results,
  so the seam didn't break the original path.
- MediaPipe engine: WASM loads from `/mediapipe/wasm`. Test pages correctly refuse to start without calibration.
  **The model could not be downloaded in the sandbox** (Google storage is blocked there), so real face tracking and
  calibration accuracy were **not** tested.

## Test on a real computer (please do this next)

```bash
npm install
npm run dev          # downloads the model once into public/mediapipe/
```

1. Open http://localhost:3000 → Intake → you are sent to **/calibrate**.
2. Calibrate with an adult first. Write down the mean error in px. Try twice with different lighting.
3. Run Test 1–3. During Test 1, look only at the left video for 10 s, then only at the right video. The Human/Geometric
   split should follow where you looked.
4. Compare with OpenCV: set `NEXT_PUBLIC_GAZE_ENGINE=opencv` in `.env.local`, restart, and repeat the same viewing
   pattern. Note the differences (spec Phase 1 "compare on a recorded test run").
5. Tune `maxCalibrationErrorPx` and `aoiMarginPx` in `lib/research/config.ts` only after pilot data.

On Vercel, `npm run build` downloads the model automatically during the build.

## Drive CORS spike (spec §4.4)

1. In `.env.local` set `ENABLE_DEV_TOOLS=1`, then `npm run dev`.
2. Go to Google's OAuth 2.0 Playground. In "Input your own scopes" enter
   `https://www.googleapis.com/auth/drive.file`, authorize with a **test** Google account, and click
   "Exchange authorization code for tokens". Copy the access token.
3. Open http://localhost:3000/dev/drive-spike, paste the token, and run.
   - "direct browser upload WORKS" → keep the design in spec §4.4 (browser PUTs to Google).
   - "BLOCKED" → use the server chunk-proxy fallback (3.75 MiB chunks).
4. Write the result into this file. Delete the test file from that Drive.

## Open issues found (not fixed here)

- **`POST /api/send-report` and `POST /api/save-result` have no authentication** (inherited from the original
  app). Anyone can make the app send email from your Gmail account to any address, or add rows to the Sheet.
  Per spec §2.2 shared fixes go into the original repo first. The Research app will not use these routes; they
  should be removed here once Supabase is in place (Phase 2).
- Test pages still say "Loading the in-browser vision engine (OpenCV.js)…" while MediaPipe loads (text only).
- Calibration is in viewport pixels: if the window is resized after calibrating, the tests ask for recalibration.
- No LICENSE file in the original repo.
