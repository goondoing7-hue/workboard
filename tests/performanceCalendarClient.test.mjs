import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { build } from 'esbuild';
import { normalizeSchedule, scheduleFingerprint, scheduleGoogleId } from '../src/performanceScheduleDomain.mjs';

// Exercise the real hook's async sync path without opening a browser, contacting
// Google, or touching the user's storage. React rendering is outside this test.
const bundled = (await build({ entryPoints: ['src/performanceCalendar.jsx'], bundle: true, platform: 'browser', format: 'cjs', write: false, external: ['react'], logLevel: 'silent' })).outputFiles[0].text;
const CALENDAR = 'training_calendar@example.test';
const remote = (patch = {}) => ({ id: 'remote-event-1', etag: '"remote-v1"', status: 'confirmed', summary: '수련 모임', location: '교육실', start: { dateTime: '2026-09-23T10:00:00+09:00' }, end: { dateTime: '2026-09-23T12:00:00+09:00' }, ...patch });
const schedule = (patch = {}) => {
  const item = normalizeSchedule({ id: 'schedule-1', title: '수련 모임', date: '2026-09-23', endDate: '2026-09-23', start: '10:00', end: '12:00', place: '교육실', format: 'face', calendar: { calendarId: CALENDAR, eventId: 'remote-event-1', etag: '"remote-v1"', state: 'synced' }, ...patch });
  item.calendar.baseFingerprint = scheduleFingerprint(item); item._revision = 'local-v1'; return item;
};
const tick = () => new Promise(resolve => setImmediate(resolve));
async function fixture(initial, handle, options = {}) {
  let records = structuredClone(initial), revision = 1, initialList = true;
  const calls = [], saves = [], conflicts = [], cleanup = [], values = new Map(), stateUpdates = [], scripts = [];
  const store = { schedules: records, getSnapshot: () => ({ schedules: structuredClone(records) }), saveSchedules: async rows => {
    for (const raw of rows) {
      const previous = records.find(item => item.id === raw.id);
      if (previous && raw._revision !== previous._revision) conflicts.push({ previous: structuredClone(previous), incoming: structuredClone(raw) });
      const saved = { ...structuredClone(raw), _revision: `local-v${++revision}` };
      records = [...records.filter(item => item.id !== raw.id), saved]; saves.push(saved);
    }
  } };
  const fetch = async (address, requestOptions = {}) => {
    const url = new URL(address, 'https://workboard.test'), action = url.searchParams.get('action'), body = requestOptions.body ? JSON.parse(requestOptions.body) : undefined;
    if (action === 'status') return Response.json(options.status || { configured: false, connected: true, calendar: { id: CALENDAR } });
    if (action === 'list' && initialList) { initialList = false; throw new Error('Initial background sync intentionally deferred by test'); }
    const call = { action, body, url }; calls.push(call);
    const result = await handle(call, { get records() { return records; }, edit: mutate => { records = records.map(item => ({ ...mutate(structuredClone(item)), _revision: `local-v${++revision}` })); } });
    return result instanceof Response ? result : Response.json(result);
  };
  const module = { exports: {} };
  const context = vm.createContext({ module, exports: module.exports, require: name => {
    assert.equal(name, 'react'); return { useState: value => [typeof value === 'function' ? value() : value, next => stateUpdates.push(next)], useRef: value => ({ current: value }), useEffect: effect => cleanup.push(effect()) };
  }, fetch, URL, AbortController, TextEncoder, crypto: webcrypto, setTimeout: options.clock?.setTimeout || setTimeout, clearTimeout: options.clock?.clearTimeout || clearTimeout, setInterval: () => 0, clearInterval: () => {}, navigator: { onLine: true },
  localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
  window: { google: options.google, addEventListener() {}, removeEventListener() {} }, document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {}, createElement: () => ({ remove() { this.removed = true; } }), head: { append: script => scripts.push(script) } } });
  vm.runInContext(bundled, context);
  const hook = module.exports.usePerformanceCalendar(store);
  await tick(); await tick();
  if (options.status) assert.equal(stateUpdates[0]?.connected, options.status.connected);
  hook.setWindow('2026-01-01', '2026-12-31');
  return { hook, calls, saves, conflicts, scripts, context, stateUpdates, get records() { return records; }, close: () => cleanup.forEach(fn => fn?.()) };
}
const listResult = (call, items) => ({ calendarId: CALENDAR, from: call.url.searchParams.get('from'), to: call.url.searchParams.get('to'), items });

test('queued calendar cancellation deletes the unchanged remote event before acknowledging completion', async () => {
  const local = schedule(); local.status = 'cancelled'; local.calendar.state = 'pending'; local.calendar.action = 'delete';
  const f = await fixture([local], call => {
    if (call.action === 'list') return listResult(call, [remote()]);
    if (call.action === 'delete') return { calendarId: CALENDAR, eventId: local.calendar.eventId, deleted: true };
    throw new Error(`Unexpected ${call.action}`);
  });
  try {
    await f.hook.syncNow();
    assert.equal(f.calls.filter(call => call.action === 'delete').length, 1);
    assert.equal(f.records[0].status, 'cancelled'); assert.equal(f.records[0].calendar.remoteCancelled, true); assert.equal(f.records[0].calendar.state, 'synced');
    assert.equal(f.conflicts.length, 0);
  } finally { f.close(); }
});

test('a complete list failure or malformed later event preserves every local schedule', async () => {
  for (const failure of ['network', 'malformed']) {
    const original = schedule();
    const f = await fixture([original], call => {
      assert.equal(call.action, 'list');
      if (failure === 'network') return Response.json({ error: { message: '조회 실패' } }, { status: 503 });
      return listResult(call, [remote({ summary: '정상 변경' }), remote({ id: 'bad-event', start: { dateTime: 'invalid' } })]);
    });
    try { await f.hook.syncNow(); assert.equal(f.saves.length, 0); assert.deepEqual(f.records, [original]); }
    finally { f.close(); }
  }
});

test('pending local changes preserve both versions when the Google etag also changed', async () => {
  const local = schedule({ title: '기기에서 변경' }); local.calendar.state = 'pending';
  const changed = remote({ summary: 'Google에서 변경', etag: '"remote-v2"' });
  const f = await fixture([local], call => { assert.equal(call.action, 'list'); return listResult(call, [changed]); });
  try {
    await f.hook.syncNow();
    assert.equal(f.records[0].title, '기기에서 변경'); assert.equal(f.records[0].calendar.state, 'conflict');
    assert.equal(f.records[0].calendar.remote.summary, 'Google에서 변경');
    assert.equal(f.calls.some(call => call.action === 'upsert'), false);
  } finally { f.close(); }
});

test('an acknowledged update keeps an edit made while the request was in flight queued for the next write', async () => {
  const local = schedule({ title: '첫 변경' }); local.calendar.state = 'pending';
  const f = await fixture([local], (call, world) => {
    if (call.action === 'list') return listResult(call, [remote()]);
    if (call.action === 'upsert') {
      world.edit(item => ({ ...item, title: '요청 중 두 번째 변경', calendar: { ...item.calendar, state: 'pending', revision: item.calendar.revision + 1 } }));
      return { calendarId: CALENDAR, event: remote({ ...call.body.event, etag: '"remote-v2"' }) };
    }
    throw new Error(`Unexpected ${call.action}`);
  });
  try {
    await f.hook.syncNow();
    assert.equal(f.records[0].title, '요청 중 두 번째 변경'); assert.equal(f.records[0].calendar.state, 'pending'); assert.equal(f.records[0].calendar.etag, '"remote-v2"');
    assert.equal(f.conflicts.length, 0);
  } finally { f.close(); }
});

test('lost create acknowledgement followed by cancellation cannot delete a subsequently edited Google event silently', async () => {
  const local = schedule(); local.status = 'cancelled'; local.calendar.eventId = ''; local.calendar.etag = ''; local.calendar.state = 'pending'; local.calendar.action = 'delete';
  const createdId = await scheduleGoogleId(local.id);
  const changed = remote({ id: createdId, summary: 'Google에서 수정된 수련', etag: '"remote-v2"', extendedProperties: { private: { trainingScheduleId: local.id } } });
  const f = await fixture([local], call => {
    if (call.action === 'list') return listResult(call, [changed]);
    if (call.action === 'event') return { calendarId: CALENDAR, event: changed };
    if (call.action === 'delete') return { calendarId: CALENDAR, eventId: createdId, deleted: true };
    throw new Error(`Unexpected ${call.action}`);
  });
  try {
    await f.hook.syncNow();
    assert.equal(f.calls.some(call => call.action === 'delete'), false);
    assert.equal(f.records[0].calendar.state, 'conflict'); assert.equal(f.records[0].calendar.remote.summary, changed.summary);
  } finally { f.close(); }
});

test('a remote event missing from the current date window is fetched individually before deciding it was deleted', async () => {
  const local = schedule(), moved = remote({ start: { dateTime: '2027-01-04T10:00:00+09:00' }, end: { dateTime: '2027-01-04T12:00:00+09:00' }, etag: '"remote-v2"' });
  const f = await fixture([local], call => {
    if (call.action === 'list') return listResult(call, []);
    if (call.action === 'event') return { calendarId: CALENDAR, event: moved };
    throw new Error(`Unexpected ${call.action}`);
  });
  try { await f.hook.syncNow(); assert.equal(f.records[0].date, '2027-01-04'); assert.equal(f.records[0].status, 'planned'); assert.equal(f.records[0].calendar.remoteCancelled, false); }
  finally { f.close(); }
});

test('lost delete and update acknowledgements are recovered by comparing the next complete snapshot', async () => {
  const local = schedule(); local.status = 'cancelled'; local.calendar.state = 'pending'; local.calendar.action = 'delete';
  let deleted = false;
  const f = await fixture([local], call => {
    if (call.action === 'list') return listResult(call, [deleted ? remote({ status: 'cancelled' }) : remote()]);
    if (call.action === 'delete') { deleted = true; throw new Error('Delete succeeded but its response was lost'); }
    throw new Error(`Unexpected ${call.action}`);
  });
  try {
    await f.hook.syncNow(); assert.equal(f.records[0].calendar.state, 'error');
    await f.hook.syncNow(); assert.equal(f.records[0].calendar.state, 'synced'); assert.equal(f.records[0].calendar.remoteCancelled, true);
    assert.equal(f.calls.filter(call => call.action === 'delete').length, 1);
  } finally { f.close(); }
  const changed = schedule({ title: '저장된 변경' }); changed.calendar.state = 'error';
  const updated = await fixture([changed], call => { assert.equal(call.action, 'list'); return listResult(call, [remote({ summary: changed.title, etag: '"remote-v2"' })]); });
  try { await updated.hook.syncNow(); assert.equal(updated.records[0].calendar.state, 'synced'); assert.equal(updated.records[0].calendar.etag, '"remote-v2"'); assert.equal(updated.calls.length, 1); }
  finally { updated.close(); }
});

test('new Google events import once with their training classification and existing local details remain separate', async () => {
  const imported = remote({ extendedProperties: { private: { target: 'kca', itemId: 'kca-workshops' } } });
  const f = await fixture([], call => { assert.equal(call.action, 'list'); return listResult(call, [imported]); });
  try {
    await f.hook.syncNow(); const id = f.records[0].id;
    assert.equal(f.records.length, 1); assert.match(id, /^gcal:/); assert.equal(f.records[0].target, 'kca'); assert.equal(f.records[0].itemId, 'kca-workshops');
    await f.hook.syncNow(); assert.equal(f.records.length, 1); assert.equal(f.records[0].id, id);
  } finally { f.close(); }
});

test('restored schedules bound to another training calendar block automatic reads and writes', async () => {
  const local = schedule(); local.calendar.calendarId = 'previous_calendar@example.test';
  const f = await fixture([local], () => { throw new Error('A differently bound calendar must not be accessed'); });
  try { await f.hook.syncNow(); assert.equal(f.calls.length, 0); assert.equal(f.saves.length, 0); assert.deepEqual(f.records, [local]); }
  finally { f.close(); }
});

function manualClock() {
  let id = 0;
  const tasks = new Map();
  return { setTimeout: (callback, delay) => { tasks.set(++id, { callback, delay }); return id; }, clearTimeout: key => tasks.delete(key),
    expire: delay => { const matching = [...tasks].filter(([, task]) => task.delay === delay); for (const [key, task] of matching) { tasks.delete(key); task.callback(); } return matching.length; },
    pending: delay => [...tasks.values()].filter(task => task.delay === delay).length };
}
const disconnected = { configured: false, connected: false, calendar: null };
const googleMock = clients => ({ accounts: { oauth2: { initCodeClient: config => { clients.push(config); return { requestCode() {} }; } } } });
const connectResponse = call => {
  if (call.action === 'connect') return { clientId: 'test-client', scope: 'test-scope' };
  if (call.action === 'exchange') return { calendar: { id: CALENDAR } };
  if (call.action === 'disconnect') return {};
  throw new Error(`Unexpected ${call.action}`);
};

test('Google SDK loading times out after 30 seconds and a fresh retry can connect', async () => {
  const clock = manualClock(), clients = [];
  const f = await fixture([], connectResponse, { status: disconnected, clock });
  try {
    const first = f.hook.connect().then(() => null, error => error);
    assert.equal(f.scripts.length, 1); const staleLoad = f.scripts[0].onload;
    assert.equal(clock.expire(30000), 1);
    const error = await first; assert.match(error.message, /30초.*다시 연결/); assert.equal(f.scripts[0].removed, true);
    assert.equal(f.calls.some(call => call.action === 'exchange'), false);
    const retry = f.hook.connect(); assert.equal(f.scripts.length, 2);
    f.context.window.google = googleMock(clients); staleLoad();
    await tick(); assert.equal(clients.length, 0);
    f.scripts[1].onload(); await tick();
    assert.equal(clients.length, 1); clients[0].callback({ code: 'successful-code' }); await retry;
    assert.equal(f.calls.filter(call => call.action === 'exchange').length, 1);
    assert.equal(clock.pending(30000), 0); assert.equal(clock.pending(300000), 0);
  } finally { f.close(); }
});

test('SDK load failure or an incomplete SDK gives retry instructions without starting OAuth', async () => {
  for (const event of ['error', 'load']) {
    const f = await fixture([], connectResponse, { status: disconnected, clock: manualClock() });
    try {
      const result = f.hook.connect().then(() => null, error => error);
      f.scripts[0][event === 'error' ? 'onerror' : 'onload']();
      assert.match((await result).message, /다시 연결/); assert.equal(f.scripts[0].removed, true); assert.equal(f.calls.length, 0);
    } finally { f.close(); }
  }
});

test('an unanswered Google popup expires after five minutes and its late code cannot be exchanged', async () => {
  const clock = manualClock(), clients = [];
  const f = await fixture([], connectResponse, { status: disconnected, clock, google: googleMock(clients) });
  try {
    const first = f.hook.connect().then(() => null, error => error); await tick();
    assert.equal(clients.length, 1); assert.equal(clock.pending(300000), 1);
    clock.expire(300000); const error = await first;
    assert.match(error.message, /5분/); assert.match(error.message, /Chrome.*Edge/); assert.match(error.message, /다시 연결/);
    assert.match(f.stateUpdates.at(-1).error, /5분/);
    clients[0].callback({ code: 'too-late-code' }); await tick();
    assert.equal(f.calls.some(call => call.action === 'exchange'), false);
    const retry = f.hook.connect(); await tick();
    clients[1].callback({ code: 'retry-code' }); await retry;
    assert.deepEqual(f.calls.filter(call => call.action === 'exchange').map(call => call.body.code), ['retry-code']);
    assert.equal(clock.pending(300000), 0);
  } finally { f.close(); }
});

test('blocked popup and cancelled connection release the attempt and ignore later OAuth callbacks', async () => {
  for (const reason of ['blocked', 'disconnect', 'unmount']) {
    const clock = manualClock(), clients = [];
    const f = await fixture([], connectResponse, { status: disconnected, clock, google: googleMock(clients) });
    try {
      const result = f.hook.connect().then(() => null, error => error); await tick();
      if (reason === 'blocked') clients[0].error_callback({ type: 'popup_failed_to_open' });
      else if (reason === 'disconnect') await f.hook.disconnect();
      else f.close();
      const error = await result; assert.match(error.message, reason === 'blocked' ? /팝업.*다시 연결/ : /취소.*다시 시작/);
      clients[0].callback({ code: 'stale-code' }); await tick();
      assert.equal(f.calls.some(call => call.action === 'exchange'), false); assert.equal(clock.pending(300000), 0);
    } finally { f.close(); }
  }
});
