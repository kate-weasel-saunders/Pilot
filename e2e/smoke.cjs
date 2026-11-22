/**
 * End-to-end smoke test of the core loop on an emulated iPhone, against the
 * production build (service worker included). Supabase is replaced by a tiny
 * in-memory fake of the auth + PostgREST endpoints the app uses, so this runs
 * without any external account. The fake also checks that every data request
 * carries the user's access token.
 *
 *   npm run test:e2e            (builds into dist-e2e, serves, runs)
 *   SCREENSHOTS=1 npm run test:e2e   (also saves screenshots to e2e/screenshots)
 */
const { chromium, devices } = require('playwright');
const { spawn, execSync } = require('child_process');
const assert = require('assert/strict');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4179;
const BASE = `http://localhost:${PORT}`;
const SUPABASE = 'https://e2e-fake.supabase.co';
const USER = { id: '6f1c2a3b-0000-4000-8000-000000000001', email: 'me@example.com' };
const SHOTS = process.env.SCREENSHOTS ? path.join(__dirname, 'screenshots') : null;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
// The browser clock is pinned to Friday 20 Nov 2026, 08:00 London (GMT), so
// calendar timing is deterministic. The token must outlive that moment.
const NOW = new Date('2026-11-20T08:00:00Z');
const exp = Math.floor(Date.parse('2027-06-01T00:00:00Z') / 1000);
const TOKEN = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, exp, role: 'authenticated', aud: 'authenticated', email: USER.email })}.sig`;

// ---- Fake Supabase -------------------------------------------------------
const tables = {
  check_ins: new Map(), periods: new Map(), tags: new Map(), calendar_sources: new Map(), calendar_events: new Map(), event_series: new Map(),
  health_samples: new Map(), health_ingest_keys: new Map(),
};

/** Events the fake `calendar` function "imports": the dentist example. */
function importedEvents(sourceId) {
  const t = (h) => new Date(NOW.getTime() + h * 3600_000).toISOString();
  const timed = (key, title, from, to) => ({ event_key: key, series_key: key.split('|')[0], title, all_day: false, starts_at: t(from), ends_at: t(to), start_date: null, end_date: null });
  return [
    timed('gym|1', 'Gym', -2, -1), // ended an hour ago → ticked
    timed('dentist|1', 'Dentist', 2, 2.5), // in 2 hours → ticked
    timed('dinner|1', 'Dinner with Sam', 11, 13), // in 11 hours → ticked
    timed('film|1', 'Film night', 13, 15), // in 13 hours → offered, not ticked
    timed('standup|0', 'Yesterday standup', -23, -22.5), // yesterday → not offered
    { event_key: 'parents|1', series_key: 'parents', title: 'Neil’s parents visiting', all_day: true, starts_at: null, ends_at: null, start_date: '2026-11-20', end_date: '2026-11-22' },
  ].map((e) => ({ ...e, id: crypto.randomUUID(), source_ids: [sourceId], created_at: NOW.toISOString(), updated_at: new Date((clock += 1000)).toISOString() }));
}
const requests = [];
let clock = Date.now();

async function fakeSupabase(route) {
  const req = route.request();
  const url = new URL(req.url());
  const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  if (url.pathname === '/auth/v1/token') {
    const body = JSON.parse(req.postData() || '{}');
    if (body.email !== USER.email || body.password !== 'correct horse') return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
    const user = { id: USER.id, email: USER.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
    return json(200, { access_token: TOKEN, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'refresh', user });
  }
  if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204 });
  if (url.pathname.startsWith('/auth/v1/')) return json(200, {});

  if (url.pathname === '/functions/v1/health') {
    assert.equal(req.headers()['authorization'], `Bearer ${TOKEN}`, 'key creation must carry the user token');
    const body = JSON.parse(req.postData() || '{}');
    if (body.action !== 'create_key') return json(400, { error: 'Unknown action.' });
    const id = crypto.randomUUID();
    tables.health_ingest_keys.set(id, { id, label: body.label, created_at: NOW.toISOString(), last_used_at: null, last_summary: null, updated_at: new Date((clock += 1000)).toISOString() });
    return json(200, { key: 'pilot_hk_e2eTESTkeyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', label: body.label });
  }

  if (url.pathname === '/functions/v1/calendar') {
    assert.equal(req.headers()['authorization'], `Bearer ${TOKEN}`, 'function calls must carry the user token');
    const body = JSON.parse(req.postData() || '{}');
    const summary = () => ({ events: tables.calendar_events.size, sources: [...tables.calendar_sources.keys()].map((id) => ({ id, ok: true })) });
    if (body.action === 'add') {
      if (!/^https:\/\/calendar\.google\.com\//.test(body.feed_url)) return json(400, { error: 'Pilot can import Google Calendar and Outlook/Microsoft 365 calendar links only.' });
      const source = { id: crypto.randomUUID(), name: body.name, default_kind: body.default_kind, enabled: true, last_refreshed_at: NOW.toISOString(), last_error: null, created_at: NOW.toISOString(), updated_at: new Date((clock += 1000)).toISOString() };
      tables.calendar_sources.set(source.id, source);
      for (const e of importedEvents(source.id)) tables.calendar_events.set(e.id, e);
      return json(200, { source, refresh: summary() });
    }
    if (body.action === 'refresh') return json(200, { refresh: summary() });
    return json(400, { error: 'Unknown action.' });
  }

  const m = url.pathname.match(/^\/rest\/v1\/(\w+)$/);
  if (!m || !tables[m[1]]) return json(404, { message: 'not found' });
  const auth = req.headers()['authorization'];
  assert.equal(auth, `Bearer ${TOKEN}`, 'data requests must carry the user token');
  const table = tables[m[1]];
  requests.push(`${req.method()} ${m[1]}`);

  if (req.method() === 'POST') {
    const rows = JSON.parse(req.postData());
    const out = rows.map((r) => {
      assert.equal(r.user_id, USER.id, 'rows are pushed with the signed-in user id');
      const saved = { ...r, updated_at: new Date((clock += 1000)).toISOString() };
      table.set(r.id, saved);
      return saved;
    });
    return json(201, out);
  }
  if (req.method() === 'DELETE') {
    const ids = (url.searchParams.get('id') || '').replace(/^in\.\(|\)$/g, '').split(',').map((s) => s.replace(/"/g, ''));
    ids.forEach((id) => table.delete(id));
    return route.fulfill({ status: 204 });
  }
  // GET
  let rows = [...table.values()];
  const gt = url.searchParams.get('updated_at');
  if (gt) rows = rows.filter((r) => r.updated_at > gt.replace(/^gt\./, ''));
  if (url.searchParams.get('select') === 'id') rows = rows.map((r) => ({ id: r.id }));
  return json(200, rows);
}

// ---- Helpers -------------------------------------------------------------
async function waitFor(fn, msg, timeout = 5000) {
  const start = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - start > timeout) throw new Error(`Timed out: ${msg}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
const serverCheckIns = () => [...tables.check_ins.values()];
async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}
const step = (s) => console.log(`✓ ${s}`);

// ---- Run -----------------------------------------------------------------
(async () => {
  execSync('npx vite build --outDir dist-e2e --emptyOutDir', {
    cwd: ROOT,
    stdio: 'ignore',
    env: { ...process.env, VITE_SUPABASE_URL: SUPABASE, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_e2e' },
  });
  const server = spawn('npx', ['vite', 'preview', '--outDir', 'dist-e2e', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  const browser = await chromium.launch();
  let failed = false;
  try {
    await waitFor(async () => fetch(BASE).then((r) => r.ok).catch(() => false), 'preview server', 15000);
    const context = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: SHOTS ? 2 : 1, timezoneId: 'Europe/London' });
    await context.clock.setFixedTime(NOW);
    await context.route(`${SUPABASE}/**`, fakeSupabase);
    const page = await context.newPage();
    page.on('pageerror', (e) => {
      throw e;
    });

    // Sign in
    await page.goto(BASE);
    await page.getByLabel('Email').fill(USER.email);
    await page.getByLabel('Password').fill('wrong');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('alert').waitFor();
    await page.getByLabel('Password').fill('correct horse');
    await shot(page, '01-sign-in');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('link', { name: 'Check in' }).waitFor();
    await shot(page, '02-today-empty');
    step('sign in (wrong password rejected, right one accepted)');

    // Add a calendar
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('link', { name: 'Manage calendars' }).click();
    await page.getByLabel('Name').fill('Kate & Neil');
    await page.getByLabel('Secret calendar link (iCal / ICS)').fill('https://evil.example.com/steal.ics');
    await page.getByRole('radio', { name: 'Family' }).click();
    await page.getByRole('button', { name: 'Add calendar' }).click();
    await page.getByRole('alert').filter({ hasText: 'Google Calendar and Outlook' }).waitFor();
    assert.equal(tables.calendar_sources.size, 0, 'rejected link creates nothing');
    await page.getByLabel('Secret calendar link (iCal / ICS)').fill('https://calendar.google.com/calendar/ical/x/private-abc/basic.ics');
    await page.getByRole('button', { name: 'Add calendar' }).click();
    await page.getByText(/Added “Kate & Neil”/).waitFor();
    await page.getByRole('button', { name: /Kate & Neil/ }).waitFor();
    assert.equal(await page.getByLabel('Secret calendar link (iCal / ICS)').inputValue(), '', 'link is cleared from the form');
    const stored = await page.evaluate(() => JSON.stringify(localStorage) + document.cookie);
    assert.ok(!stored.includes('private-abc'), 'link is not stored on the device');
    await shot(page, '02b-calendars');
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Done' }).click();
    step('add a calendar (bad link rejected; link not kept on device)');

    // Check in
    await page.getByRole('link', { name: 'Check in' }).click();
    const scale = (label) => page.getByRole('radiogroup', { name: label });
    await scale('Mood').getByRole('radio', { name: 'Low', exact: true }).click();
    await scale('Energy').getByRole('radio', { name: 'Empty', exact: true }).click();
    await scale('Anxiety / tension').getByRole('radio', { name: 'Tense', exact: true }).click();
    await scale('Pressure / demand').getByRole('radio', { name: 'A lot', exact: true }).click();
    await page.getByLabel('What’s going through your head?').fill('Can’t face this meeting.');
    await page.getByRole('button', { name: 'Heavy' }).click();
    await page.getByRole('button', { name: 'Work', exact: true }).click();
    await page.getByRole('button', { name: 'Rest', exact: true }).click();
    await page.getByRole('group', { name: 'Body' }).getByRole('button', { name: '+ Other' }).click();
    await page.getByLabel('Add to Body').fill('Jaw clenched');
    await page.getByLabel('Add to Body').press('Enter');
    await page.locator('summary', { hasText: 'What happened just before this?' }).click();
    await page.getByRole('textbox', { name: 'What happened just before this?' }).fill('Calendar reminder');

    // Calendar events: the default rule, then adjustments
    const around = page.getByRole('button', { name: /Around now/ });
    await around.waitFor();
    assert.match(await around.innerText(), /Neil’s parents visiting · Gym 06:00 · Dentist 10:00 · \+1/);
    await shot(page, '03-check-in');
    await around.click();
    const box = (name) => page.getByRole('checkbox', { name });
    for (const n of [/Gym/, /Dentist/, /Dinner with Sam/, /Neil’s parents/]) assert.ok(await box(n).isChecked(), `${n} pre-ticked`);
    assert.equal(await box(/Film night/).isChecked(), false, 'film (13h ahead) offered but not ticked');
    assert.equal(await box(/Yesterday standup/).count(), 0, 'yesterday not offered');
    await box(/Dinner with Sam/).uncheck();
    await box(/Film night/).check();
    await page.getByRole('button', { name: /Kind for Dentist/ }).click();
    await page.getByRole('radiogroup', { name: 'Kind' }).getByRole('radio', { name: 'Appointment' }).click();
    await page.getByRole('button', { name: /Kind for Gym/ }).click();
    await page.getByRole('radiogroup', { name: 'Kind' }).getByRole('button', { name: '+ Other' }).click();
    await page.getByLabel('New kind').fill('Training');
    await page.getByLabel('New kind').press('Enter');
    await page.getByRole('button', { name: 'Kind for Gym: Training' }).waitFor();
    await shot(page, '03b-check-in-events');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByText('Saved', { exact: true }).waitFor();
    await page.getByText('Can’t face this meeting.').waitFor();
    await shot(page, '04-today-after-save');
    await waitFor(() => serverCheckIns().length === 1, 'check-in reaches server');
    const saved = serverCheckIns()[0];
    assert.deepEqual([saved.mood, saved.energy, saved.anxiety, saved.pressure], [2, 1, 3, 4]);
    assert.deepEqual(saved.body_tags, ['Heavy', 'Jaw clenched']);
    assert.deepEqual(saved.context_tags, ['Work']);
    assert.deepEqual(saved.need_tags, ['Rest']);
    assert.equal(saved.preceding, 'Calendar reminder');
    assert.equal(saved.timezone, 'Europe/London');
    assert.match(saved.local_date, /^\d{4}-\d{2}-\d{2}$/);
    await waitFor(() => [...tables.tags.values()].some((t) => t.label === 'Jaw clenched'), 'custom tag synced');
    const ev = Object.fromEntries(saved.events.map((e) => [e.title, e]));
    assert.deepEqual(Object.keys(ev).sort(), ['Dentist', 'Film night', 'Gym', 'Neil’s parents visiting']);
    assert.deepEqual([ev.Dentist.kind, ev.Dentist.relation, ev.Dentist.offset_min], ['Appointment', 'upcoming', 120]);
    assert.deepEqual([ev.Gym.kind, ev.Gym.relation, ev.Gym.offset_min], ['Training', 'recent', -60]);
    assert.deepEqual([ev['Film night'].relation, ev['Film night'].offset_min], ['later', 780]);
    assert.deepEqual([ev['Neil’s parents visiting'].kind, ev['Neil’s parents visiting'].relation], ['Family', 'all_day']);
    await waitFor(() => [...tables.event_series.values()].some((s) => s.series_key === 'dentist' && s.kind === 'Appointment'), 'series kind synced');
    await waitFor(() => [...tables.tags.values()].some((t) => t.kind === 'event' && t.label === 'Training'), 'custom kind synced');
    step('calendar events pre-ticked by the timing rule; untick, add, set kinds (incl. custom)');
    step('check in with scales, tags, custom tag and text; synced to server');

    // History → day collapsed by default → expand → open → edit
    await page.getByRole('link', { name: 'History' }).click();
    const dayToggle = page.getByRole('region', { name: 'Today' }).getByRole('button', { expanded: false });
    assert.match(await dayToggle.innerText(), /Today\s*1 check-in/);
    await shot(page, '05a-history-collapsed');
    await dayToggle.click();
    await page.getByText('Can’t face this meeting.').click();
    await page.getByText('Calendar reminder').waitFor();
    await page.locator('.plain-list').getByText(/Dentist/).waitFor();
    await shot(page, '05-history-expanded');
    await page.getByRole('link', { name: 'Edit' }).click();
    await page.getByLabel('What’s going through your head?').fill('Can’t face this meeting. It went fine in the end.');
    await scale('Mood').getByRole('radio', { name: 'Okay', exact: true }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByText('It went fine in the end.').waitFor();
    await waitFor(() => serverCheckIns()[0]?.mood === 3, 'edit reaches server');
    assert.equal(serverCheckIns().length, 1, 'editing does not duplicate');
    step('open from History, edit, saved without duplicating');

    // Offline check-in
    await context.setOffline(true);
    await page.getByRole('link', { name: 'Today' }).click();
    await page.getByRole('link', { name: 'Check in' }).click();
    await scale('Energy').getByRole('radio', { name: 'Some', exact: true }).click();
    await page.getByLabel('What’s going through your head?').fill('Written on the train with no signal.');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByText('Written on the train with no signal.').waitFor();
    await page.getByText(/will sync when online/).waitFor();
    await shot(page, '06-offline-saved');
    assert.equal(serverCheckIns().length, 1, 'nothing reaches the server while offline');
    await context.setOffline(false);
    await waitFor(() => serverCheckIns().length === 2, 'offline check-in syncs when back online');
    await page.getByText(/will sync when online/).waitFor({ state: 'detached' });
    step('check in while offline; synced automatically on reconnect');

    // Reload keeps session + data (IndexedDB)
    await page.reload();
    await page.getByText('Written on the train with no signal.').waitFor();
    step('reload keeps session and data');

    // Draft survives the app closing mid check-in
    await page.getByRole('link', { name: 'Check in' }).click();
    await page.getByLabel('What’s going through your head?').fill('Half-finished thought');
    await page.waitForTimeout(700);
    await page.reload();
    await page.getByLabel('What’s going through your head?').waitFor();
    assert.equal(await page.getByLabel('What’s going through your head?').inputValue(), 'Half-finished thought');
    await page.getByRole('button', { name: 'Discard' }).click();
    step('unsaved draft survives a reload; discard works');

    // Periods
    await page.getByRole('link', { name: 'Periods' }).click();
    await page.getByRole('link', { name: 'New period' }).click();
    await page.getByRole('button', { name: 'Save period' }).click();
    await page.getByRole('alert').filter({ hasText: 'name' }).waitFor();
    await page.getByLabel('Name').fill('Holiday');
    await page.getByRole('button', { name: 'Holiday', exact: true }).click();
    await page.getByLabel('Notes (optional)').fill('No work. Travelling/resting.');
    const today = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date()));
    const plus = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
    await page.getByLabel('Starts').fill(plus(today, -2));
    await page.getByLabel('Ends (leave empty if ongoing)').fill(plus(today, 11));
    await shot(page, '07-period-form');
    await page.getByRole('button', { name: 'Save period' }).click();
    await page.getByText('2 check-ins').waitFor();
    await shot(page, '08-periods');
    await page.getByRole('link', { name: 'Today' }).click();
    await page.getByText('day 3 of 14').waitFor();
    await waitFor(() => tables.periods.size === 1, 'period synced');
    step('create a period (validation, sync); shown as active on Today');

    // History filters
    await page.getByRole('link', { name: 'History' }).click();
    await page.getByRole('searchbox', { name: 'Search' }).fill('no signal');
    await page.locator('p[role=status]', { hasText: /^1 check-in$/ }).waitFor();
    await page.getByRole('searchbox', { name: 'Search' }).fill('');
    await page.getByRole('button', { name: /^Filter/ }).click();
    await page.getByLabel('Tag').selectOption('Jaw clenched');
    await page.locator('p[role=status]', { hasText: /^1 check-in$/ }).waitFor();
    await page.getByLabel('Tag').selectOption('');
    await page.getByLabel('Period').selectOption({ label: 'Holiday' });
    await page.locator('p[role=status]', { hasText: /^2 check-ins$/ }).waitFor();
    await shot(page, '09-history-filtered');
    step('search, tag filter and period filter');

    // Delete with confirmation
    await page.getByText('Written on the train with no signal.').click();
    await page.getByRole('button', { name: 'Delete' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete this check-in?' });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    assert.equal(serverCheckIns().length, 2, 'cancel keeps the entry');
    await page.getByRole('button', { name: 'Delete' }).click();
    await dialog.getByRole('button', { name: 'Delete' }).click();
    await page.getByText('Written on the train with no signal.').waitFor({ state: 'detached' });
    await waitFor(() => serverCheckIns().length === 1, 'delete reaches server');
    step('delete requires confirmation and removes from server');

    // Export
    await page.getByRole('link', { name: 'Today' }).click();
    await page.getByRole('link', { name: 'Settings' }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export check-ins (CSV)' }).click()]);
    const csv = fs.readFileSync(await download.path(), 'utf8');
    assert.match(csv, /^id,observed_at,timezone/);
    assert.match(csv, /It went fine in the end/);
    assert.match(csv, /Holiday/);
    assert.match(csv, /Dentist \[Appointment\] \(upcoming, 120 min\)/);
    const [jsonDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export everything (JSON)' }).click()]);
    const exported = JSON.parse(fs.readFileSync(await jsonDl.path(), 'utf8'));
    assert.equal(exported.check_ins.length, 1);
    assert.equal(exported.periods.length, 1);
    step('export CSV and JSON');

    // Apple Health: create a key, then data "arrives" from the Shortcut
    await page.getByRole('link', { name: 'Set up Apple Health' }).click();
    await page.getByText('How to set up the Shortcut').waitFor();
    await page.getByRole('button', { name: 'Create a key' }).click();
    const keyField = page.getByRole('textbox', { name: 'Key', exact: true });
    await keyField.waitFor();
    assert.match(await keyField.inputValue(), /^pilot_hk_/);
    assert.equal(await page.getByRole('textbox', { name: 'Web address (URL)', exact: true }).inputValue(), `${SUPABASE}/functions/v1/health`);
    await shot(page, '12-apple-health-key');
    const healthStored = await page.evaluate(() => JSON.stringify(localStorage));
    assert.ok(!healthStored.includes('pilot_hk_'), 'health key is not stored on the device');
    await page.getByRole('button', { name: 'I’ve copied it' }).click();
    const sample = (o) => ({ id: crypto.randomUUID(), unit: 'min', label: null, detail: {}, created_at: NOW.toISOString(), updated_at: new Date((clock += 1000)).toISOString(), ...o });
    const h = (hours) => new Date(NOW.getTime() + hours * 3600_000).toISOString();
    for (const r of [
      sample({ metric: 'workout', label: 'Running', value: 35, starts_at: h(-1.6), ends_at: h(-1), sample_key: 'workout|run' }),
      sample({ metric: 'sleep', value: 412, starts_at: h(-9), ends_at: h(-1.5), detail: { asleep: 412, deep: 60, rem: 95 }, sample_key: 'sleep|night' }),
      sample({ metric: 'hrv', value: 48, unit: 'ms', starts_at: h(-5), ends_at: h(-5), sample_key: 'hrv|1' }),
      sample({ metric: 'workout', label: 'Strength', value: 40, starts_at: h(-30), ends_at: h(-29.3), sample_key: 'workout|yesterday' }),
    ]) tables.health_samples.set(r.id, r);
    await page.reload();
    await page.getByText('Latest received').waitFor();
    await page.getByText('48 ms', { exact: false }).waitFor();
    await shot(page, '13-apple-health-latest');
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Done' }).click();
    const todayTags = page.getByRole('list', { name: 'Health' });
    await todayTags.getByText('Sleep 6h 52m').waitFor();
    assert.deepEqual(await todayTags.getByRole('listitem').allInnerTexts(), ['Sleep 6h 52m', 'HRV 48 ms', 'Active 35 min']);
    await shot(page, '15-today-health');
    await page.getByRole('link', { name: 'History' }).click();
    const todayCard = page.getByRole('region', { name: 'Today' });
    await todayCard.getByRole('list', { name: 'Health' }).getByText('Sleep 6h 52m').waitFor();
    await shot(page, '16-history-day-cards');
    await page.getByRole('link', { name: 'Today' }).click();
    await page.getByRole('link', { name: 'Check in' }).click();
    await page.getByRole('button', { name: /Around now/ }).click();
    assert.ok(await page.getByRole('checkbox', { name: /Running · 35 min/ }).isChecked(), 'run an hour ago pre-ticked');
    assert.ok(await page.getByRole('checkbox', { name: /Sleep · 6h 52m/ }).isChecked(), 'last night’s sleep pre-ticked');
    assert.equal(await page.getByRole('checkbox', { name: /Strength/ }).count(), 0, 'yesterday’s workout not offered');
    assert.equal(await page.getByRole('button', { name: 'Kind for Running · 35 min: Exercise' }).count(), 1, 'workouts default to Exercise');
    await shot(page, '14-check-in-health');
    await page.getByRole('button', { name: 'Discard' }).click();
    await page.getByRole('link', { name: 'Settings' }).click();
    step('Apple Health: key created (not kept on device); health tags on Today and History day cards; run and sleep pre-ticked in Check In');

    // Sign out wipes the device
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('dialog', { name: 'Sign out?' }).getByRole('button', { name: 'Sign out' }).click();
    await page.getByLabel('Email').waitFor();
    const leftovers = await page.evaluate(
      () => new Promise((res) => { const r = indexedDB.open('pilot'); r.onsuccess = () => { const tx = r.result.transaction('check_ins'); const c = tx.objectStore('check_ins').count(); c.onsuccess = () => res(c.result); }; }),
    );
    assert.equal(leftovers, 0, 'local data cleared on sign-out');
    step('sign out clears local data');

    // Dark mode render check
    if (SHOTS) {
      const dark = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2, colorScheme: 'dark' });
      await dark.route(`${SUPABASE}/**`, fakeSupabase);
      await dark.clock.setFixedTime(NOW);
      const p2 = await dark.newPage();
      await p2.goto(BASE);
      await p2.getByLabel('Email').fill(USER.email);
      await p2.getByLabel('Password').fill('correct horse');
      await p2.getByRole('button', { name: 'Sign in' }).click();
      await p2.getByText('It went fine in the end.').waitFor();
      await shot(p2, '10-today-dark');
      await p2.getByRole('link', { name: 'Check in' }).click();
      await p2.getByRole('radiogroup', { name: 'Mood' }).getByRole('radio', { name: 'Good', exact: true }).click();
      await shot(p2, '11-check-in-dark');
      await dark.close();
    }

    console.log(`\nAll e2e checks passed. (${requests.length} Supabase data requests, all with the user token)`);
  } catch (e) {
    failed = true;
    console.error(e);
    if (process.env.DEBUG_E2E) for (const p of browser.contexts().flatMap((c) => c.pages())) {
      console.error('URL', p.url());
      console.error((await p.locator('main').innerText().catch(() => '')).slice(0, 1500));
    }
  } finally {
    await browser.close();
    server.kill();
    fs.rmSync(path.join(ROOT, 'dist-e2e'), { recursive: true, force: true });
    process.exit(failed ? 1 : 0);
  }
})();
