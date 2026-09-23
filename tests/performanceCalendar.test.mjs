import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { createPerformanceCalendarHandler } from '../server/performanceCalendar.cjs';

const ORIGIN = 'https://workboard.example';
const CALENDAR = 'training-calendar@group.calendar.google.com';
const MARKER = 'workboard:counseling-training:v1';
const SCOPE = 'https://www.googleapis.com/auth/calendar.app.created https://www.googleapis.com/auth/calendar.calendarlist.readonly';
const ENV = { GOOGLE_CALENDAR_CLIENT_ID: '1234567890-workboard.apps.googleusercontent.com', GOOGLE_CALENDAR_CLIENT_SECRET: 'test-only-client-secret',
  GOOGLE_CALENDAR_SESSION_KEY: Buffer.alloc(32, 7).toString('base64url'), GOOGLE_CALENDAR_ORIGINS: `${ORIGIN},http://localhost:3000` };
const inputEvent = (localId = 'schedule-1', fields = {}) => ({ summary: '집단상담 수련', location: '교육실', start: { dateTime: '2026-09-23T09:00:00+09:00', timeZone: 'Asia/Seoul' }, end: { dateTime: '2026-09-23T12:00:00+09:00', timeZone: 'Asia/Seoul' },
  extendedProperties: { private: { trainingScheduleId: localId, target: 'kca', itemId: 'kca-group-member-experience' } }, ...fields });
const idFor = id => 'a1' + createHash('sha256').update('workboard:training:' + id).digest('hex');
function fixture(options = {}) {
  let clock = Date.parse('2026-09-23T01:00:00.000Z');
  const state = { exists: options.exists !== false, calls: [], tokenCalls: 0, events: new Map(), listing: null, eventPages: null, listSecondFailed: false, role: 'owner', marked: true,
    insertLost: false, insertRace: false, patchRace: false, deleteRace: false, revision: 0, tokenScope: SCOPE };
  const meta = () => ({ kind: 'calendar#calendarListEntry', id: CALENDAR, summary: '상담·수련 실적', description: state.marked ? MARKER : 'unrelated calendar', timeZone: 'Asia/Seoul', accessRole: state.role });
  const asRemote = (event, id) => {
    const value = structuredClone(event);
    if (state.normalizeTimes) for (const key of ['start', 'end']) {
      if (value[key]?.dateTime) value[key] = { dateTime: new Date(value[key].dateTime).toISOString(), timeZone: 'UTC' };
      else if (value[key]?.date) value[key].timeZone = 'Asia/Seoul';
    }
    return { kind: 'calendar#event', ...value, id, status: 'confirmed', etag: `"revision-${++state.revision}"`, updated: '2026-09-23T01:00:00.000Z', htmlLink: 'https://calendar.google.com/calendar/event?eid=test' };
  };
  const fetch = async (url, init) => {
    state.calls.push({ url, init });
    if (options.fetch) { const response = await options.fetch(url, init, state); if (response !== undefined) return response; }
    if (url === 'https://oauth2.googleapis.com/token') { state.tokenCalls++; return Response.json({ access_token: 'test-only-access', refresh_token: 'test-only-refresh', token_type: 'Bearer', expires_in: 3600, scope: state.tokenScope }); }
    const parsed = new URL(url), path = decodeURIComponent(parsed.pathname), method = init.method || 'GET';
    if (path === '/calendar/v3/users/me/calendarList') {
      const page = parsed.searchParams.get('pageToken');
      if (page && state.listSecondFailed) return Response.json({ error: {} }, { status: 503 });
      if (state.listing) return Response.json(state.listing[page || 'first']);
      return Response.json({ kind: 'calendar#calendarList', items: state.exists ? [meta()] : [{ id: 'primary@example.com', accessRole: 'owner', description: 'existing personal calendar' }] });
    }
    if (path === '/calendar/v3/users/me/calendarList/' + CALENDAR) return state.exists ? Response.json(meta()) : Response.json({ error: {} }, { status: 404 });
    if (path === '/calendar/v3/calendars' && method === 'POST') {
      const body = JSON.parse(init.body); assert.deepEqual(body, { summary: '상담·수련 실적', description: MARKER, timeZone: 'Asia/Seoul' }); state.exists = true;
      return Response.json({ kind: 'calendar#calendar', id: CALENDAR, ...body });
    }
    const base = '/calendar/v3/calendars/' + CALENDAR + '/events';
    if (path === base && method === 'GET') {
      assert.equal(parsed.searchParams.get('singleEvents'), 'true'); assert.equal(parsed.searchParams.get('showDeleted'), 'true'); assert.equal(parsed.searchParams.get('maxResults'), '250');
      const page = parsed.searchParams.get('pageToken');
      if (page && state.listSecondFailed) return Response.json({ error: {} }, { status: 503 });
      return Response.json(state.eventPages ? state.eventPages[page || 'first'] : { kind: 'calendar#events', etag: '"list"', items: [...state.events.values()] });
    }
    if (path === base && method === 'POST') {
      const body = JSON.parse(init.body), event = asRemote(body, body.id); state.events.set(body.id, event);
      if (state.insertLost) { state.insertLost = false; throw new Error('response lost after insert'); }
      if (state.insertRace) { state.insertRace = false; return Response.json({ error: {} }, { status: 409 }); }
      return Response.json(event);
    }
    if (path.startsWith(base + '/')) {
      const id = path.slice(base.length + 1), current = state.events.get(id);
      if (method === 'GET') return current ? Response.json(current) : Response.json({ error: {} }, { status: 404 });
      if (!current) return Response.json({ error: {} }, { status: 404 });
      if (method === 'PATCH' && state.patchRace || method === 'DELETE' && state.deleteRace) {
        state.patchRace = state.deleteRace = false;
        state.events.set(id, { ...current, summary: 'Google에서 먼저 수정', etag: '"concurrent"' }); return Response.json({ error: {} }, { status: 412 });
      }
      assert.equal(init.headers['If-Match'], current.etag); assert.equal(parsed.searchParams.get('sendUpdates'), 'none');
      if (method === 'PATCH') {
        const body = JSON.parse(init.body); assert.equal(Object.hasOwn(body, 'description'), false); assert.equal(Object.hasOwn(body, 'attendees'), false); assert.equal(Object.hasOwn(body, 'recurrence'), false);
        const event = asRemote({ ...current, ...body }, id); state.events.set(id, event); return Response.json(event);
      }
      if (method === 'DELETE') { state.events.delete(id); return new Response(null, { status: 204 }); }
    }
    throw new Error('Unexpected mocked calendar request: ' + url);
  };
  const config = { ...ENV, ...options.env }, makeHandler = () => createPerformanceCalendarHandler({ env: config, fetch, now: () => clock, timeoutMs: 200 });
  return { state, config, handler: makeHandler(), makeHandler, meta, asRemote, advance: ms => { clock += ms; } };
}
async function request(handler, body, options = {}) {
  const method = options.method || 'POST', req = Readable.from(body === undefined ? [] : [options.raw || JSON.stringify(body)]);
  req.method = method; req.url = options.url || (method === 'GET' ? '/api/performance-calendar?action=status' : '/api/performance-calendar');
  req.headers = { host: new URL(options.origin || ORIGIN).host, origin: options.origin || ORIGIN, 'sec-fetch-site': 'same-origin', 'x-workboard-performance-calendar': '1', 'content-type': 'application/json', ...(options.cookie ? { cookie: options.cookie } : {}), ...options.headers };
  if (Object.hasOwn(options, 'body')) req.body = options.body;
  const res = { headers: {}, setHeader(key, value) { this.headers[key.toLowerCase()] = value; }, writeHead(status, headers) { this.status = status; for (const [key, value] of Object.entries(headers)) this.setHeader(key, value); }, end(raw) { this.raw = raw; this.data = JSON.parse(raw); } };
  await handler(req, res);
  const set = res.headers['set-cookie']; res.cookies = (Array.isArray(set) ? set : set ? [set] : []).map(value => value.split(';')[0]); return res;
}
async function authorize(f, extra = {}) {
  const begin = await request(f.handler, { action: 'connect', ...(extra.password ? { password: extra.password } : {}) }); assert.equal(begin.status, 200, begin.raw);
  return request(f.handler, { action: 'exchange', code: 'test-only-code', ...(extra.calendarId ? { calendarId: extra.calendarId } : {}) }, { cookie: begin.cookies.join('; ') });
}
async function connect(f, extra = {}) { const res = await authorize(f, extra); assert.equal(res.status, 200, res.raw); return res.cookies.find(value => value.includes('_session=')); }
const upsert = (f, cookie, localId = 'schedule-1', extra = {}) => request(f.handler, { action: 'upsert', calendarId: CALENDAR, localId, event: inputEvent(localId), ...extra }, { cookie });
const read = (f, cookie, query = 'from=2026-09-01&to=2026-09-30') => request(f.handler, undefined, { method: 'GET', url: '/api/performance-calendar?action=list&' + query, cookie });
const writes = f => f.state.calls.filter(call => ['POST', 'PATCH', 'PUT', 'DELETE'].includes(call.init.method) && !call.url.includes('oauth2.googleapis.com'));

test('calendar status reveals configuration only; separate encrypted HttpOnly auth accepts just required scopes', async () => {
  const missing = fixture({ env: { GOOGLE_CALENDAR_SESSION_KEY: '' } });
  const status = await request(missing.handler, undefined, { method: 'GET' }); assert.equal(status.data.configured, false); assert.equal(status.data.calendar, null);
  assert.equal((await request(missing.handler, { action: 'connect' })).status, 503); assert.equal(missing.state.calls.length, 0);
  const f = fixture(), cookie = await connect(f); assert.match(cookie, /^__Host-wb_performance_calendar_session=v1\./); assert.doesNotMatch(cookie, /test-only/);
  const connected = await request(f.handler, undefined, { method: 'GET', cookie }); assert.equal(connected.data.connected, true); assert.equal(connected.data.calendar.id, CALENDAR); assert.equal(connected.data.scope, SCOPE); assert.doesNotMatch(connected.raw, /test-only|refresh_token|client_secret/);
  const token = f.state.calls.find(call => call.url.includes('oauth2')); assert.equal(new URLSearchParams(token.init.body).get('redirect_uri'), ORIGIN);
  const grant = await request(f.handler, { action: 'connect' }); assert.match(grant.headers['set-cookie'], /HttpOnly; SameSite=Lax;/); assert.match(grant.headers['set-cookie'], /; Secure$/);
  for (const scope of ['https://www.googleapis.com/auth/calendar', SCOPE.split(' ')[0], SCOPE + ' https://www.googleapis.com/auth/drive.file']) { const bad = fixture(); bad.state.tokenScope = scope; assert.equal((await authorize(bad)).data.error.code, 'scope_not_granted'); assert.equal(writes(bad).length, 0); }
});

test('optional password, same-origin headers, tampered cookies, expired grants and cross-cookie reuse fail closed', async () => {
  const f = fixture({ env: { PERFORMANCE_CONNECTION_PASSWORD: 'password' } }); assert.equal((await request(f.handler, { action: 'connect' })).status, 403);
  const cookie = await connect(f, { password: 'password' });
  for (const headers of [{ origin: 'https://evil.example' }, { host: 'evil.example' }, { 'x-workboard-performance-calendar': '0' }, { 'sec-fetch-site': 'cross-site' }]) { const before = f.state.calls.length; assert.equal((await request(f.handler, undefined, { method: 'GET', cookie, headers })).status, 403); assert.equal(f.state.calls.length, before); }
  assert.equal((await request(f.handler, undefined, { method: 'GET', cookie, headers: { origin: undefined, referer: ORIGIN + '/performance.html' } })).status, 200);
  assert.equal((await request(f.handler, undefined, { method: 'GET', cookie, headers: { origin: undefined, referer: 'https://evil.example/' } })).status, 403);
  for (const bad of [cookie + 'broken', `${cookie}; ${cookie}`, cookie.replace('performance_calendar_session', 'performance_session')]) assert.equal((await read(f, bad)).status, 401);
  const begin = await request(f.handler, { action: 'connect', password: 'password' }); f.advance(601000); assert.equal((await request(f.handler, { action: 'exchange', code: 'x' }, { cookie: begin.cookies.join('; ') })).status, 401);
});

test('dedicated calendar is created only after complete discovery, stays private by default, and reconnect reuses it', async () => {
  const f = fixture({ exists: false }); await connect(f); assert.equal(writes(f).length, 1); assert.match(writes(f)[0].url, /\/calendars$/);
  assert.equal(f.state.calls.some(call => /\/acl(?:\/|$|\?)/.test(call.url)), false); await connect(f); assert.equal(writes(f).length, 1);
  const pages = fixture(); pages.state.listing = { first: { kind: 'calendar#calendarList', items: [{ id: 'personal@example.com', accessRole: 'owner' }], nextPageToken: 'second' }, second: { kind: 'calendar#calendarList', items: [pages.meta()] } };
  await connect(pages); assert.equal(writes(pages).length, 0); assert.equal(pages.state.calls.some(call => call.url.includes('pageToken=second')), true);
});

test('failed, partial, ambiguous or missing preferred calendar discovery never creates a replacement', async () => {
  for (const alter of [
    f => { f.state.listing = { first: {} }; },
    f => { f.state.listing = { first: { kind: 'calendar#calendarList', items: [], nextPageToken: 'second' } }; f.state.listSecondFailed = true; },
    f => { f.state.listing = { first: { kind: 'calendar#calendarList', items: [f.meta(), { ...f.meta(), id: 'another@group.calendar.google.com' }] } }; },
    f => { f.state.role = 'writer'; },
  ]) { const f = fixture(); alter(f); const res = await authorize(f); assert.notEqual(res.status, 200); assert.equal(writes(f).length, 0); assert.equal(res.headers['set-cookie'], undefined); }
  const absent = fixture({ exists: false }); assert.equal((await authorize(absent, { calendarId: CALENDAR })).data.error.code, 'calendar_missing'); assert.equal(writes(absent).length, 0);
  const selected = fixture(); selected.state.listing = { first: { kind: 'calendar#calendarList', items: [selected.meta(), { ...selected.meta(), id: 'another@group.calendar.google.com' }] } }; await connect(selected, { calendarId: CALENDAR }); assert.equal(writes(selected).length, 0);
});

test('list exhausts pages, uses an inclusive Seoul date range and retains only safe event fields including cancelled instances', async () => {
  const f = fixture(), cookie = await connect(f), one = f.asRemote({ ...inputEvent(), description: 'private notes', attendees: [{ email: 'other@example.com' }], extendedProperties: { private: { ...inputEvent().extendedProperties.private, unrelated: 'private note' } } }, 'event001');
  const cancelled = { id: 'cancel001', status: 'cancelled', recurringEventId: 'series001', originalStartTime: { dateTime: '2026-09-24T09:00:00+09:00' } };
  f.state.eventPages = { first: { kind: 'calendar#events', etag: '"list"', items: [one], nextPageToken: 'next' }, next: { kind: 'calendar#events', etag: '"list"', items: [cancelled] } };
  const result = await read(f, cookie); assert.equal(result.status, 200, result.raw); assert.equal(result.data.items.length, 2); assert.deepEqual(result.data.items[1], cancelled);
  assert.equal(Object.hasOwn(result.data.items[0], 'description'), false); assert.equal(Object.hasOwn(result.data.items[0], 'attendees'), false); assert.equal(Object.hasOwn(result.data.items[0].extendedProperties.private, 'unrelated'), false);
  const first = new URL(f.state.calls.find(call => call.url.includes('/events?')).url); assert.equal(first.searchParams.get('timeMin'), '2026-09-01T00:00:00+09:00'); assert.equal(first.searchParams.get('timeMax'), '2026-10-01T00:00:00+09:00');
  assert.equal((await read(f, cookie, 'from=2026-09-30&to=2026-09-30')).status, 200);
  for (const query of ['from=2026-02-30&to=2026-03-01', 'from=2026-10-01&to=2026-09-30', 'from=2025-01-01&to=2026-12-31', 'from=2026-09-01&from=2026-09-02&to=2026-09-30']) assert.equal((await read(f, cookie, query)).status, 400);
});

test('partial event pages, malformed entries and loops return an error instead of an authoritative empty snapshot', async () => {
  for (const pages of [
    { first: {} },
    { first: { kind: 'calendar#events', etag: '"list"', items: [{ id: 'event001', status: 'confirmed' }] } },
    { first: { kind: 'calendar#events', etag: '"list"', items: [], nextPageToken: 'again' }, again: { kind: 'calendar#events', etag: '"list"', items: [], nextPageToken: 'again' } },
  ]) { const f = fixture(), cookie = await connect(f); f.state.eventPages = pages; const result = await read(f, cookie); assert.notEqual(result.status, 200); assert.equal(result.data.items, undefined); assert.equal(writes(f).length, 0); }
  const f = fixture(), cookie = await connect(f); f.state.eventPages = { first: { kind: 'calendar#events', etag: '"list"', items: [f.asRemote(inputEvent(), 'event001')], nextPageToken: 'next' } }; f.state.listSecondFailed = true;
  const failed = await read(f, cookie); assert.equal(failed.status, 503); assert.equal(failed.data.items, undefined);
});

test('deterministic create retries lost replies and insert conflicts without creating duplicate events', async () => {
  for (const mode of ['insertLost', 'insertRace']) {
    const f = fixture(), cookie = await connect(f); f.state[mode] = true;
    const first = await upsert(f, cookie); assert.equal(first.status, mode === 'insertLost' ? 503 : 200, first.raw);
    const again = await upsert(f, cookie); assert.equal(again.status, 200, again.raw); assert.equal(again.data.event.id, idFor('schedule-1')); assert.equal(f.state.events.size, 1); assert.equal(writes(f).length, 1);
    const different = await upsert(f, cookie, 'schedule-1', { event: inputEvent('schedule-1', { summary: '다른 내용' }) }); assert.equal(different.status, 409); assert.equal(different.data.error.code, 'calendar_conflict'); assert.equal(different.data.remote.summary, '집단상담 수련'); assert.equal(writes(f).length, 1);
  }
});

test('Google timezone, offset and millisecond normalization acknowledge equivalent instants without duplicate writes', async () => {
  const f = fixture(), cookie = await connect(f); f.state.normalizeTimes = true;
  const first = await upsert(f, cookie); assert.equal(first.status, 200, first.raw);
  assert.equal(first.data.event.start.dateTime, '2026-09-23T00:00:00.000Z');
  const replay = await upsert(f, cookie); assert.equal(replay.status, 200, replay.raw); assert.equal(writes(f).length, 1);
  const allDay = inputEvent('all-day', { start: { date: '2026-09-23' }, end: { date: '2026-09-24' } });
  const made = await upsert(f, cookie, 'all-day', { event: allDay }); assert.equal(made.status, 200, made.raw); assert.deepEqual(made.data.event.start, { date: '2026-09-23' });
  const repeated = await upsert(f, cookie, 'all-day', { event: allDay }); assert.equal(repeated.status, 200, repeated.raw); assert.equal(writes(f).length, 2);
});

test('updates require ETags and protect Google changes both before and during PATCH; preserve unrelated fields', async () => {
  const f = fixture(), cookie = await connect(f), made = await upsert(f, cookie), original = made.data.event;
  f.state.events.set(original.id, { ...f.state.events.get(original.id), description: 'existing detail', reminders: { useDefault: true } });
  assert.equal((await upsert(f, cookie, 'schedule-1', { eventId: original.id })).status, 400);
  const edited = await upsert(f, cookie, 'schedule-1', { eventId: original.id, etag: original.etag, event: inputEvent('schedule-1', { summary: '변경한 수련' }) }); assert.equal(edited.status, 200, edited.raw); assert.equal(f.state.events.get(original.id).description, 'existing detail'); assert.deepEqual(f.state.events.get(original.id).reminders, { useDefault: true });
  const count = writes(f).length, stale = await upsert(f, cookie, 'schedule-1', { eventId: original.id, etag: original.etag }); assert.equal(stale.data.error.code, 'calendar_conflict'); assert.equal(writes(f).length, count);
  f.state.patchRace = true;
  const race = await upsert(f, cookie, 'schedule-1', { eventId: original.id, etag: edited.data.event.etag }); assert.equal(race.status, 409); assert.equal(race.data.remote.summary, 'Google에서 먼저 수정'); assert.equal(f.state.events.get(original.id).summary, 'Google에서 먼저 수정');
});

test('delete uses If-Match, treats explicit missing as success and keeps a racing update intact', async () => {
  const f = fixture(), cookie = await connect(f), event = (await upsert(f, cookie)).data.event;
  f.state.deleteRace = true;
  const body = { action: 'delete', calendarId: CALENDAR, eventId: event.id, etag: event.etag };
  const conflict = await request(f.handler, body, { cookie }); assert.equal(conflict.status, 409); assert.equal(f.state.events.get(event.id).summary, 'Google에서 먼저 수정');
  const deleted = await request(f.handler, { ...body, etag: conflict.data.remote.etag }, { cookie }); assert.equal(deleted.status, 200, deleted.raw); assert.equal(deleted.data.deleted, true); assert.equal(f.state.events.size, 0);
  const again = await request(f.handler, body, { cookie }); assert.equal(again.status, 200); assert.equal(again.data.deleted, true);
  const single = await request(f.handler, undefined, { method: 'GET', url: '/api/performance-calendar?action=event&eventId=' + event.id, cookie }); assert.equal(single.status, 200); assert.equal(single.data.event, null);
});

test('every connected read/write verifies calendar ownership and marker; wrong binding never touches another calendar', async () => {
  const f = fixture(), cookie = await connect(f); assert.equal((await upsert(f, cookie, 'schedule-1', { calendarId: 'another@group.calendar.google.com' })).data.error.code, 'calendar_changed'); assert.equal(writes(f).length, 0);
  for (const change of [() => { f.state.role = 'writer'; }, () => { f.state.role = 'owner'; f.state.marked = false; }]) {
    change(); const count = f.state.calls.length; assert.equal((await read(f, cookie)).status, 403); assert.equal((await upsert(f, cookie)).status, 403); assert.equal(f.state.calls.slice(count).some(call => call.url.includes('/events')), false);
  }
  f.state.marked = true; f.state.exists = false; assert.equal((await read(f, cookie)).data.error.code, 'calendar_missing'); assert.equal(writes(f).length, 0);
});

test('write payload rejects notes, attendees, malformed times and oversize data; all-day ending stays exclusive', async () => {
  const f = fixture(), cookie = await connect(f);
  for (const event of [inputEvent('schedule-1', { description: 'sensitive notes' }), inputEvent('schedule-1', { attendees: [] }), inputEvent('schedule-1', { start: { dateTime: '2026-09-23T09:00' } }), inputEvent('schedule-1', { start: { date: '2026-02-30' }, end: { date: '2026-03-01' } }), inputEvent('schedule-1', { start: { date: '2026-09-23' }, end: { date: '2026-09-23' } }), inputEvent('schedule-1', { extendedProperties: { private: { trainingScheduleId: 'different', target: 'kca' } } })]) assert.equal((await upsert(f, cookie, 'schedule-1', { event })).status, 400);
  assert.equal(writes(f).length, 0);
  assert.equal((await request(f.handler, { action: 'connect', padding: '가'.repeat(12000) }, { cookie })).status, 413);
  const allDay = await upsert(f, cookie, 'schedule-1', { event: inputEvent('schedule-1', { start: { date: '2026-09-23' }, end: { date: '2026-09-25' } }) }); assert.equal(allDay.status, 200, allDay.raw); assert.deepEqual(allDay.data.event.end, { date: '2026-09-25' });
});

test('only individual recurring instances can be edited/deleted, not the series master', async () => {
  const f = fixture(), cookie = await connect(f), master = f.asRemote({ ...inputEvent(), recurrence: ['RRULE:FREQ=WEEKLY'] }, 'series001'); f.state.events.set(master.id, master);
  const edit = await upsert(f, cookie, 'schedule-1', { eventId: master.id, etag: master.etag }); assert.equal(edit.data.error.code, 'recurring_series_not_supported');
  const deletion = await request(f.handler, { action: 'delete', calendarId: CALENDAR, eventId: master.id, etag: master.etag }, { cookie }); assert.equal(deletion.data.error.code, 'recurring_series_not_supported');
  const instance = f.asRemote({ ...inputEvent(), recurringEventId: master.id, originalStartTime: inputEvent().start }, 'series001_20260923T000000Z'); f.state.events.set(instance.id, instance);
  assert.equal((await upsert(f, cookie, 'schedule-1', { eventId: instance.id, etag: instance.etag })).status, 200); assert.deepEqual(f.state.events.get(master.id).recurrence, ['RRULE:FREQ=WEEKLY']);
});

test('refresh works after process restart and disconnect clears only performance calendar cookies', async () => {
  const f = fixture(), cookie = await connect(f); f.handler = f.makeHandler();
  assert.equal((await read(f, cookie)).status, 200); assert.equal(f.state.tokenCalls, 2);
  const disconnect = await request(f.handler, { action: 'disconnect' }, { cookie }); assert.equal(disconnect.status, 200); assert.equal(disconnect.cookies.length, 2);
  for (const value of disconnect.headers['set-cookie']) { assert.match(value, /^__Host-wb_performance_calendar_(session|grant)=;/); assert.match(value, /Max-Age=0/); }
  assert.equal(writes(f).length, 0);
});
