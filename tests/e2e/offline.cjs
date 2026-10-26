/* eslint-disable @typescript-eslint/no-require-imports */
// Offline mode end-to-end (agent E): online login → child cached on device → go offline →
// screening → "saved on this device" → back online → start_session + gaze upload + complete_session.
// Needs a production build (service worker) — see README.md. Run:
//   APP_URL_E2E=http://localhost:3305 node tests/e2e/offline.cjs /tmp/shots
const { chromium } = require('playwright');
const SB = 'http://127.0.0.1:54399';
const APP = process.env.APP_URL_E2E || 'http://localhost:3305';
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
  if (p === '/rest/v1/organizations') return json(route, org);
  if (p === '/rest/v1/children') {
    if (req.method() === 'POST') {
      const b = JSON.parse(req.postData());
      for (const r of Array.isArray(b) ? b : [b]) state.children.push({ id: 'c0000000-0000-0000-0000-00000000000' + (state.children.length + 1), created_at: new Date().toISOString(), ...r });
      return route.fulfill({ status: 201, headers: { 'access-control-allow-origin': '*' } });
    }
    const id = url.searchParams.get('id');
    if (id) return json(route, state.children.find((x) => 'eq.' + x.id === id) ?? null);
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
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, permissions: ['camera'], hasTouch: true });
  await ctx.route(SB + '/**', mock);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push('console: ' + m.text().slice(0, 200)); });
  const step = async (name) => { await page.screenshot({ path: `${out}/${name}.png` }); console.log('step', name, page.url()); };

  await page.goto(APP + '/');
  await page.waitForURL(/\/login/);
  await page.fill('#email', 'admin@school.test');
  await page.fill('#password', 'secret-password');
  await page.click('button[type=submit]');
  await page.waitForURL(/\/r$/);
  await page.fill('#c-code', 'T-OFF');
  await page.fill('#c-bm', '2023-04');
  await page.click('text=เพิ่ม / Add');
  await page.waitForSelector('text=T-OFF');
  const child = state.children[0];

  // service worker installed and pages warmed
  await page.evaluate(() => navigator.serviceWorker.ready);
  for (let i = 0; i < 60; i++) {
    const ok = await page.evaluate(async () => {
      const keys = await caches.keys();
      const pages = keys.find((k) => k.includes('pages'));
      if (!pages) return false;
      const c = await caches.open(pages);
      return !!(await c.match('/test3')) && !!(await c.match('/summary'));
    });
    if (ok) break;
    await page.waitForTimeout(500);
  }
  console.log('caches:', await page.evaluate(async () => {
    const r = {};
    for (const k of await caches.keys()) r[k] = (await (await caches.open(k)).keys()).length;
    return JSON.stringify(r);
  }));

  // what cacheChildForOffline() stores (agent B's child page will call it)
  await page.evaluate(async ({ child, org }) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('lookatme-offline', 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const tx = db.transaction('meta', 'readwrite');
    const now = new Date().toISOString();
    tx.objectStore('meta').put({ key: 'child:' + child.id, value: { id: child.id, org_id: child.org_id, code: child.code, birth_month: '2023-04-01', consent: { allow_recording: false, allow_research: true }, cachedAt: now } });
    tx.objectStore('meta').put({ key: 'plan:' + org.id, value: { orgId: org.id, expiresOn: org.expires_on, quotaLeft: 300, cachedAt: now } });
    await new Promise((res) => (tx.oncomplete = res));
  }, { child, org });

  // the server has an active consent for the child (pruneCachedChildren() drops cached children without one)
  state.consents.push({ id: 'k1', child_id: child.id, org_id: child.org_id, allow_recording: false, allow_research: true, signed_at: new Date().toISOString(), withdrawn_at: null });

  await page.goto(APP + '/r/offline');
  await page.waitForSelector('text=T-OFF');
  await step('e01-offline-page-online');

  await ctx.setOffline(true);
  await page.waitForSelector('text=ออฟไลน์ / Offline');
  await page.click('text=เริ่มคัดกรองแบบออฟไลน์ / Start offline screening');
  await page.click('text=✓ ตกลง / I agree');
  await page.waitForURL(/\/r\/check/, { timeout: 20000 });
  console.log('ctx:', await page.evaluate(() => sessionStorage.getItem('lookatme_research_ctx')));
  await page.click('text=เริ่มตรวจ / Start check');
  await page.waitForSelector('text=Lighting', { timeout: 20000 });
  await step('e02-camera-check-offline');
  await page.click('text=/continue/i');
  for (const [n, next] of [[1, 'Next: Test 2 →'], [2, 'Next: Test 3 →'], [3, 'Next: Summary →']]) {
    await page.waitForURL(new RegExp(`/test${n}`), { timeout: 20000 });
    await page.click('text=Start Test (20s)', { timeout: 30000 });
    await page.waitForSelector(`text=${next}`, { timeout: 40000 });
    if (n === 1) await step('e03-test1-offline');
    await page.click(`text=${next}`);
  }
  await page.waitForURL(/\/summary/);
  await page.waitForSelector('text=/Saved on this device|Save failed/', { timeout: 20000 });
  await step('e04-summary-queued');
  console.log('rpc calls while offline:', state.rpc.length, 'uploads:', state.uploads.length);
  const queued = await page.evaluate(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open('lookatme-offline', 1); r.onsuccess = () => res(r.result); });
    return await new Promise((res) => { const g = db.transaction('queue').objectStore('queue').getAll(); g.onsuccess = () => res(g.result.map((r) => ({ kind: r.item.kind, attempts: r.item.attempts, csvLines: r.item.payload?.gazeCsv.split('\n').length }))); });
  });
  console.log('queued:', JSON.stringify(queued));

  await ctx.setOffline(false);
  await page.waitForSelector('text=Uploaded ✓', { timeout: 30000 });
  await step('e05-summary-uploaded');
  console.log('rpc calls after online:', state.rpc.map((r) => r.name).join(','));
  const up = state.uploads[0];
  console.log('upload path ok:', up && up.path === `${ORG}/${SESSION}.csv`, 'session ids replaced:', up ? !up.body.includes(JSON.parse(await page.evaluate(() => sessionStorage.getItem('lookatme_research_ctx')) || '{}').clientSessionId || 'x') : null);
  const c = state.rpc.find((r) => r.name === 'complete_session');
  if (c) console.log('complete_session:', JSON.stringify({ path: c.body.p_gaze_path, retest: c.body.p_data.retest_needed, gaze_bytes: c.body.p_data.gaze_bytes, csvLen: up && up.body.length }));
  const m = state.rpc.find((r) => r.name === 'mark_session_offline');
  console.log('mark_session_offline:', JSON.stringify(m && m.body));

  await page.goto(APP + '/r/offline');
  await page.waitForSelector('text=ไม่มีรายการรอส่ง');
  await step('e06-offline-page-empty');
  console.log('errors:', errors.join('\n') || 'none');
  await browser.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
