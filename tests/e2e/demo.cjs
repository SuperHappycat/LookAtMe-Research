/* eslint-disable @typescript-eslint/no-require-imports */
// End-to-end smoke test of the Research flow against a mocked Supabase API.
const { chromium } = require('playwright');
const SB = 'http://127.0.0.1:54399';
const APP = process.env.APP_URL_E2E || 'http://localhost:3200';
const ORG = '00000000-0000-0000-0000-00000000000a';
const USER = '10000000-0000-0000-0000-00000000000a';
const SESSION = '5e550000-0000-0000-0000-000000000001';
const out = process.argv[2];

const state = { children: [], consents: [], sessions: [], uploads: [], rpc: [] };
const org = { id: ORG, name: 'Test School', type: 'school', plan: 'school', screening_quota: 300, screenings_used: 0, seats: 3, expires_on: '2027-10-25' };
const user = { id: USER, email: 'admin@school.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-10-01T00:00:00Z' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

async function mock(route) {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname;
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (p === '/auth/v1/token') {
    const now = Math.floor(Date.now() / 1000);
    return json(route, { access_token: 'test-access-token', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r', user });
  }
  if (p === '/auth/v1/user') return json(route, user);
  if (p === '/rest/v1/members') return json(route, [{ role: 'admin', organizations: org }]);
  if (p === '/rest/v1/children') {
    if (req.method() === 'POST') {
      const b = JSON.parse(req.postData());
      const rows = Array.isArray(b) ? b : [b];
      for (const r of rows) state.children.push({ id: 'c0000000-0000-0000-0000-00000000000' + (state.children.length + 1), created_at: new Date().toISOString(), ...r });
      return route.fulfill({ status: 201, headers: { 'access-control-allow-origin': '*' } });
    }
    const id = url.searchParams.get('id');
    if (id) { const c = state.children.find((x) => 'eq.' + x.id === id); return json(route, c ?? null); }
    return json(route, state.children);
  }
  if (p === '/rest/v1/consents') {
    if (req.method() === 'POST') {
      state.consents.push({ id: 'k1', signed_at: new Date().toISOString(), ...JSON.parse(req.postData()) });
      return route.fulfill({ status: 201, headers: { 'access-control-allow-origin': '*' } });
    }
    return json(route, state.consents);
  }
  if (p === '/rest/v1/sessions') return json(route, state.sessions);
  if (p.startsWith('/rest/v1/rpc/')) {
    const name = p.split('/').pop();
    const body = JSON.parse(req.postData() || '{}');
    state.rpc.push({ name, body });
    if (name === 'start_session') return json(route, SESSION);
    if (name === 'complete_session') return json(route, body.p_data.retest_needed ? 'invalid' : 'completed');
    return json(route, null);
  }
  if (p.startsWith('/storage/v1/object/gaze/')) {
    state.uploads.push({ path: p.replace('/storage/v1/object/gaze/', ''), body: req.postData() ?? '' });
    return json(route, { Key: 'gaze/' + p.split('/gaze/')[1] });
  }
  console.log('UNMOCKED', req.method(), p);
  return json(route, {}, 404);
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, permissions: ['camera'] });
  await ctx.route(SB + '/**', mock);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const step = async (name) => { await page.screenshot({ path: `${out}/${name}.png` }); console.log('step', name, page.url()); };

  await page.goto(APP + '/');
  await page.waitForURL(/\/login/);
  await page.fill('#email', 'admin@school.test');
  await page.fill('#password', 'secret-password');
  await page.click('button[type=submit]');
  await page.waitForURL(/\/r$/);
  await page.waitForSelector('text=Test School');
  await step('01-children');

  // Demo mode: choose High risk, run the full flow, check nothing is saved.
  await page.goto(APP + '/r/demo');
  await page.click('text=เสี่ยงสูง / High risk');
  await page.click('text=เริ่มการสาธิต / Start demo →');
  await page.click('text=✓ ตกลง / I agree');
  await page.waitForURL(/\/r\/check/);
  await page.click('text=เริ่มตรวจ / Start check');
  await page.waitForSelector('text=Lighting', { timeout: 20000 });
  await page.click('text=/continue/i');
  for (const [n, next] of [[1, 'Next: Test 2 →'], [2, 'Next: Test 3 →'], [3, 'Next: Summary →']]) {
    await page.waitForURL(new RegExp(`/test${n}`));
    await page.click('text=Start Test (20s)', { timeout: 30000 });
    await page.waitForSelector(`text=${next}`, { timeout: 40000 });
    await page.click(`text=${next}`);
  }
  await page.waitForURL(/\/summary/);
  await page.waitForSelector('text=Demo mode: nothing was saved');
  await step('demo-summary');
  console.log('summary text:', (await page.innerText('body')).replace(/\s+/g, ' ').slice(0, 500));
  console.log('rpc calls:', state.rpc.map((r) => r.name).join(',') || 'none', '| uploads:', state.uploads.length);
  await page.click('text=Start Over');
  await page.waitForURL(/\/r\/demo/);
  console.log('errors:', errors.join('\n') || 'none');
  await browser.close();
})();
