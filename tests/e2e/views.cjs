/* eslint-disable @typescript-eslint/no-require-imports */
// Renders the dashboard and a session page (with replay) against mocked Supabase data.
const { chromium } = require('playwright');
const SB = 'http://127.0.0.1:54399', APP = process.env.APP_URL_E2E || 'http://localhost:3200';
const ORG = '00000000-0000-0000-0000-00000000000a', SID = '5e550000-0000-0000-0000-000000000001';
const out = process.argv[2];
const user = { id: 'u1', email: 'admin@school.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} };
const org = { id: ORG, name: 'Test School', type: 'hospital', plan: 'hospital', screening_quota: null, screenings_used: 4, seats: 15, expires_on: '2027-10-25' };
const rows = [];
for (let lv = 1; lv <= 3; lv++) for (let i = 0; i < 200; i++) {
  const x = 0.5 + 0.4 * Math.sin(i / 15), y = 0.5 + 0.3 * Math.cos(i / 20);
  rows.push([SID, lv, lv === 1 ? 'human+geometric' : lv === 2 ? 'talking' : 'rja', i * 100, (i * 0.1).toFixed(1), 600, 300, x.toFixed(3), y.toFixed(3), x < 0.5 ? 'Left' : 'Right', 1, 1, 1, 0.3].join(','));
}
const csv = 'session_id,level,video_id,t_ms,video_pos_s,x_px,y_px,x_norm,y_norm,direction,face_found,eyes_detected,confidence,face_scale\n' + rows.join('\n') + '\n';
const session = { id: SID, org_id: ORG, child_id: 'c1', started_at: '2026-10-25T03:00:00Z', completed_at: '2026-10-25T03:02:00Z', status: 'completed', engine: 'mediapipe',
  overall_score: 72, risk_level: 'High', level1_score: 80, level2_score: 65, level3_score: 70, quality_score: 92, face_found_pct: 96, retest_needed: false, calibration_error_px: 88, low_accuracy: false,
  results: { test1: { humanPct: 80, geometricPct: 20, switches: 6, avgFixationMs: 900, humanSide: 'right' }, test2: { facePct: 65, objectPct: 40 }, test3: { blockPct: 50, facePct: 75, accuracyPct: 70, latencyMs: 600 }, cameraCheck: { faceFoundPct: 100, meanLuma: 130, medianFaceScale: 0.3, passed: true } },
  quality: { lightingOkPct: 100, distanceOkPct: 90, reasons: [] }, child: { code: 'T-001', birth_month: '2023-04-01', sex: 'F' } };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await ctx.route(SB + '/**', async (route) => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname;
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    if (p === '/auth/v1/token') return json(route, { access_token: 't', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user });
    if (p === '/auth/v1/user') return json(route, user);
    if (p === '/rest/v1/members') return json(route, [{ role: 'admin', organizations: org }]);
    if (p === '/rest/v1/sessions') return json(route, u.searchParams.get('id') ? session : [session, { ...session, id: 's2', status: 'invalid', risk_level: 'Low', overall_score: 10, quality_score: 30 }]);
    if (p.startsWith('/rest/v1/rpc/')) return json(route, null);
    if (p.startsWith('/storage/v1/object/gaze/') || p.startsWith('/storage/v1/object/authenticated/gaze/')) return route.fulfill({ status: 200, contentType: 'text/csv', headers: { 'access-control-allow-origin': '*' }, body: csv });
    console.log('UNMOCKED', req.method(), p); return json(route, [], 200);
  });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(APP + '/login'); await page.fill('#email', 'a@b.c'); await page.fill('#password', 'x'); await page.click('button[type=submit]');
  await page.waitForURL(/\/r$/);
  await page.goto(APP + '/r/dashboard'); await page.waitForSelector('text=T-001');
  await page.screenshot({ path: out + '/06-dashboard.png', fullPage: true });
  const dl = page.waitForEvent('download'); await page.click('text=/Export sessions/'); const d = await dl;
  console.log('download:', d.suggestedFilename());
  await page.goto(APP + '/r/sessions/' + SID); await page.waitForSelector('text=Replay with gaze dot');
  await page.waitForSelector('text=/Play replay/'); await page.click('text=/Play replay/'); await page.waitForTimeout(2500);
  await page.screenshot({ path: out + '/07-session.png', fullPage: true });
  console.log('dot visible:', await page.locator('[class*=replayDot]').count());
  console.log('errors:', errors.join('\n') || 'none');
  await browser.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
