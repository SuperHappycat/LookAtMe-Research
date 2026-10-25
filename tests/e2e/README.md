# Browser end-to-end tests (mocked Supabase)

These drive the real built app in Chromium against a **mocked Supabase API** (route interception), with a fake
camera. No real Supabase project is needed.

```bash
# 1. Build with test settings (the font stub is needed only where Google Fonts is blocked)
SKIP_MEDIAPIPE_MODEL=1 NEXT_PUBLIC_GAZE_ENGINE=opencv \
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399 NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon-key npm run build
# 2. Start on your own port and remember the PID (don't kill other people's servers)
npx next start -p 3301 & echo $! > /tmp/my-next.pid
# 3. Run (screenshots go to the folder you pass)
APP_URL_E2E=http://localhost:3301 node tests/e2e/flow.cjs /tmp/shots
kill $(cat /tmp/my-next.pid)
```

- `flow.cjs`: login → add child → consent → start → camera check → Tests 1–3 → summary auto-save.
- `views.cjs`: dashboard and session page with mocked data.

Extend the `mock()` function for new tables, RPCs and API routes.
