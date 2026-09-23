import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { build } from 'esbuild';
import { createEvent, normalizeRecord } from '../src/performanceDomain.mjs';
import { normalizeSchedule } from '../src/performanceScheduleDomain.mjs';
import { backupText, readLocalEvents, writeLocalEvents, EVENT_PREFIX, META_KEY } from '../src/performancePersistence.mjs';

const bundled = (await build({ entryPoints: ['src/performanceStore.jsx'], bundle: true, platform: 'browser', format: 'cjs', write: false, external: ['react'], logLevel: 'silent' })).outputFiles[0].text;
const CALENDAR_META = 'counseling-performance:v1:calendar';
const A = 'calendar-a@group.calendar.google.com', B = 'calendar-b@group.calendar.google.com';
const tick = () => new Promise(resolve => setImmediate(resolve));
const recordEvent = (id = 'record-1', patch = {}) => createEvent('record', id, normalizeRecord({ id, date: '2026-09-23', caseId: 'CASE-1', ...patch }));
const scheduleEvent = (id, calendarId) => createEvent('schedule', id, normalizeSchedule({ id, title: '수련', date: '2026-09-23', endDate: '2026-09-23', start: '10:00', end: '11:00', calendar: { calendarId } }));
class MemoryStorage {
  map = new Map(); writes = []; failure = null;
  get length() { return this.map.size; }
  key(index) { return [...this.map.keys()][index] ?? null; }
  getItem(key) { return this.map.get(key) ?? null; }
  setItem(key, value) { if (this.failure?.(key, value)) throw new Error('Quota exceeded'); this.map.set(key, String(value)); this.writes.push(key); }
  removeItem(key) { this.map.delete(key); }
}
async function fixture(events = [], metadata = {}) {
  const storage = new MemoryStorage(), cleanup = []; writeLocalEvents(storage, events);
  for (const [key, value] of Object.entries(metadata)) storage.setItem(key, JSON.stringify(value));
  storage.setItem('workboard:data', 'unrelated-private-data'); storage.writes = [];
  const module = { exports: {} }; let timer = 0;
  const context = vm.createContext({ module, exports: module.exports, localStorage: storage, crypto: webcrypto, TextEncoder, URL, AbortController, navigator: { onLine: true },
    // This tests the primary durable log. IndexedDB being unavailable is handled
    // by the production hook's existing secondary-backup warning path.
    setTimeout: () => ++timer, clearTimeout() {}, setInterval: () => ++timer, clearInterval() {},
    fetch: async () => Response.json({ configured: false, connected: false }),
    window: { addEventListener() {}, removeEventListener() {} }, document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    require: name => { assert.equal(name, 'react'); return { useState: value => [typeof value === 'function' ? value() : value, () => {}], useRef: current => ({ current }), useMemo: fn => fn(), useEffect: effect => cleanup.push(effect()) }; } });
  vm.runInContext(bundled, context); const hook = module.exports.usePerformanceStore(); await tick(); await tick();
  return { hook, storage, close: () => cleanup.forEach(fn => fn?.()) };
}
const payload = (events, bindings = {}) => ({ backup: backupText(events), bindings });

test('linked backup merges immutable records and retries without duplicate records or imported counts', async () => {
  const first = recordEvent(), second = recordEvent('record-2');
  const f = await fixture([first]);
  try {
    assert.equal((await f.hook.importLinkedBackup(payload([first, second], { sheetId: 'private-sheet-123', calendarId: A }))).imported, 1);
    assert.equal((await f.hook.importLinkedBackup(payload([first, second], { sheetId: 'private-sheet-123', calendarId: A }))).imported, 0);
    assert.equal(readLocalEvents(f.storage).length, 2); assert.equal(f.storage.getItem('workboard:data'), 'unrelated-private-data');
    assert.deepEqual(JSON.parse(f.storage.getItem(META_KEY)), { sheetId: 'private-sheet-123' });
    assert.deepEqual(JSON.parse(f.storage.getItem(CALENDAR_META)), { calendarId: A });
  } finally { f.close(); }
});

test('migration derives a missing calendar binding from the single incoming schedule calendar', async () => {
  const f = await fixture();
  try {
    const item = scheduleEvent('schedule-1', A);
    assert.equal((await f.hook.importLinkedBackup(payload([item]))).imported, 1);
    assert.equal(JSON.parse(f.storage.getItem(CALENDAR_META)).calendarId, A);
    assert.equal(readLocalEvents(f.storage)[0].payload.calendar.calendarId, A);
  } finally { f.close(); }
});

test('every incoming and persisted schedule binding must agree before any migration write', async () => {
  const scenarios = [
    { existing: [], incoming: [scheduleEvent('schedule-1', A), scheduleEvent('schedule-2', B)] },
    { existing: [], incoming: [scheduleEvent('schedule-1', A)], bindings: { calendarId: B } },
    { existing: [scheduleEvent('existing', A)], incoming: [scheduleEvent('incoming', B)] },
    { existing: [scheduleEvent('existing-a', A), scheduleEvent('existing-b', B)], incoming: [recordEvent()] },
    { existing: [], incoming: [scheduleEvent('incoming', B)], metadata: { [CALENDAR_META]: { calendarId: A } } },
  ];
  for (const scenario of scenarios) {
    const f = await fixture(scenario.existing, scenario.metadata);
    try {
      const original = new Map(f.storage.map);
      await assert.rejects(f.hook.importLinkedBackup(payload(scenario.incoming, scenario.bindings)), /서로 다른 수련 캘린더/);
      assert.deepEqual(f.storage.map, original); assert.equal(f.storage.writes.length, 0);
    } finally { f.close(); }
  }
});

test('calendar checks read the persisted log including revisions no longer shown or received from another tab', async () => {
  const f = await fixture();
  try {
    const earlier = scheduleEvent('existing', A), deleted = createEvent('schedule', earlier.entityId, { deleted: true }, earlier.id);
    // Simulates writes from another tab before this hook has received its event.
    writeLocalEvents(f.storage, [earlier, deleted]); f.storage.writes = [];
    await assert.rejects(f.hook.importLinkedBackup(payload([scheduleEvent('incoming', B)])), /서로 다른 수련 캘린더/);
    assert.equal(f.storage.writes.length, 0); assert.equal(readLocalEvents(f.storage).length, 2);
    assert.equal((await f.hook.importLinkedBackup(payload([earlier, deleted]))).imported, 0);
    assert.equal(JSON.parse(f.storage.getItem(CALENDAR_META)).calendarId, A);
  } finally { f.close(); }
});

test('event ID collisions, malformed backups and Google binding mismatches fail before saving', async () => {
  const existing = recordEvent();
  const f = await fixture([existing], { [META_KEY]: { sheetId: 'existing-sheet-123', accepted: [existing.id] } });
  try {
    const original = new Map(f.storage.map), collision = { ...existing, payload: { ...existing.payload, minutes: 100 } };
    await assert.rejects(f.hook.importLinkedBackup(payload([recordEvent('new-record'), collision])), /동일한 변경 ID/);
    await assert.rejects(f.hook.importLinkedBackup({ backup: '{broken' }), /백업 파일/);
    await assert.rejects(f.hook.importLinkedBackup(payload([recordEvent('new-record')], { sheetId: 'different-sheet-123' })), /Google Sheets가 다릅니다/);
    await assert.rejects(f.hook.importLinkedBackup(payload([recordEvent('new-record')], { calendarId: 'bad calendar' })), /식별자/);
    assert.deepEqual(f.storage.map, original); assert.equal(f.storage.writes.length, 0);
  } finally { f.close(); }
});

test('failed primary storage never reports success or saves new bindings, and retry preserves partial immutable writes', async () => {
  const f = await fixture(), first = recordEvent(), second = recordEvent('record-2');
  first.createdAt = '2026-09-23T01:00:00.000Z'; second.createdAt = '2026-09-23T01:00:01.000Z';
  try {
    f.storage.failure = key => key === EVENT_PREFIX + second.id;
    await assert.rejects(f.hook.importLinkedBackup(payload([first, second], { calendarId: A })), /Quota exceeded/);
    assert.equal(f.storage.getItem(CALENDAR_META), null); assert.equal(f.storage.getItem(META_KEY), null);
    assert.equal(readLocalEvents(f.storage).length, 1);
    f.storage.failure = null;
    assert.equal((await f.hook.importLinkedBackup(payload([first, second], { calendarId: A }))).imported, 1);
    assert.equal(readLocalEvents(f.storage).length, 2); assert.equal(JSON.parse(f.storage.getItem(CALENDAR_META)).calendarId, A);
  } finally { f.close(); }
});

test('unreadable existing Google binding metadata blocks migration rather than replacing unknown bindings', async () => {
  for (const key of [META_KEY, CALENDAR_META]) {
    const f = await fixture();
    try {
      f.storage.setItem(key, '{broken'); f.storage.writes = [];
      await assert.rejects(f.hook.importLinkedBackup(payload([recordEvent()], { sheetId: 'new-sheet-123', calendarId: A })), /연결을 확인/);
      assert.equal(f.storage.getItem(key), '{broken'); assert.equal(f.storage.writes.length, 0); assert.equal(readLocalEvents(f.storage).length, 0);
    } finally { f.close(); }
  }
});
