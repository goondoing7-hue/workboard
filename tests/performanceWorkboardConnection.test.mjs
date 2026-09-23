import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { build } from 'esbuild';
import { WORKBOARD_ORIGIN, LINK_CHANNEL, validLinkMessage } from '../src/performanceDeployment.mjs';
import { createWorkboardSnapshot, planWorkboardImport } from '../src/performanceWorkboardLink.mjs';
import { recordsFor } from '../src/performanceDomain.mjs';

const bundled = (await build({ entryPoints: ['src/performanceWorkboardConnection.jsx'], bundle: true, platform: 'browser', format: 'cjs', write: false, external: ['react', 'lucide-react'], logLevel: 'silent' })).outputFiles[0].text;
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const snapshot = () => createWorkboardSnapshot({ resv: [{ id: 'reservation-1', clientId: 'client-1', date: '2026-09-23', start: '10:00', end: '11:00', method: '대면', status: 'done' }] });
function fixture(store, { blocked = false } = {}) {
  const handlers = new Set(), cleanup = [], timers = new Map(), intervals = new Map(), popups = [], updates = [];
  let nextTimer = 0, state;
  const module = { exports: {} };
  const window = { addEventListener: (type, fn) => { assert.equal(type, 'message'); handlers.add(fn); }, removeEventListener: (type, fn) => handlers.delete(fn),
    open: (url, name, features) => { if (blocked) return null; const popup = { url, name, features, closed: false, messages: [], postMessage: (message, origin) => popup.messages.push({ message: structuredClone(message), origin }) }; popups.push(popup); return popup; } };
  const context = vm.createContext({ module, exports: module.exports, window, crypto: webcrypto,
    setTimeout: (callback, ms) => { timers.set(++nextTimer, { callback, ms }); return nextTimer; }, clearTimeout: id => timers.delete(id),
    setInterval: (callback, ms) => { intervals.set(++nextTimer, { callback, ms }); return nextTimer; }, clearInterval: id => intervals.delete(id),
    require: name => {
      if (name === 'lucide-react') return { ArrowUpRight() {}, Link2() {}, RefreshCw() {}, Unplug() {} };
      assert.equal(name, 'react'); return { useState: initial => { state = typeof initial === 'function' ? initial() : initial; return [state, next => { state = typeof next === 'function' ? next(state) : next; updates.push(structuredClone(state)); }]; }, useRef: current => ({ current }), useEffect: effect => cleanup.push(effect()) };
    } });
  vm.runInContext(bundled, context);
  const hook = module.exports.useWorkboardConnection(store);
  const send = (type, payload, { popup = popups.at(-1), data = {}, origin = WORKBOARD_ORIGIN, source = popup } = {}) => {
    const hello = popup?.messages.find(entry => entry.message.type === 'hello')?.message;
    const event = { origin, source, data: { channel: LINK_CHANNEL, version: 1, nonce: hello?.nonce, requestId: hello?.requestId, type, ...(payload === undefined ? {} : { payload }), ...data } };
    for (const handler of handlers) handler(event);
  };
  return { hook, send, popups, updates, get state() { return state; }, get posted() { return popups.flatMap(popup => popup.messages); },
    intervals: () => [...intervals.values()].forEach(task => task.callback()),
    timeout: ms => { for (const [id, task] of [...timers]) if (task.ms === ms) { timers.delete(id); task.callback(); } },
    close: () => cleanup.forEach(fn => fn?.()) };
}
const acks = f => f.posted.filter(entry => entry.message.type === 'ack').map(entry => entry.message.result);

test('receiver rejects wrong origin, popup, nonce, channel, version and request ID before importing', async () => {
  let imported = 0;
  const f = fixture({ importWorkboardSnapshot: async () => { imported++; return { imported: 1, differences: [], missing: [] }; } });
  try {
    f.hook.connect();
    for (const wrong of [{ origin: 'https://evil.example' }, { source: {} }, { data: { nonce: 'f'.repeat(48) } }, { data: { channel: 'wrong' } }, { data: { version: 2 } }]) f.send('ready', undefined, wrong);
    assert.equal(f.posted.filter(entry => entry.message.type === 'request-snapshot').length, 0);
    f.send('ready');
    for (const wrong of [{ origin: 'https://evil.example' }, { source: {} }, { data: { nonce: 'f'.repeat(48) } }, { data: { channel: 'wrong' } }, { data: { version: 2 } }, { data: { requestId: 'wrong-request' } }]) f.send('snapshot', snapshot(), wrong);
    await tick(); assert.equal(imported, 0); assert.equal(acks(f).length, 0);
    f.send('snapshot', snapshot()); await tick();
    assert.equal(imported, 1); assert.equal(acks(f).length, 1);
    assert.equal(f.posted.every(entry => entry.origin === WORKBOARD_ORIGIN), true);
  } finally { f.close(); }
});

test('snapshot saves are serialized and duplicate arrivals plan against the completed prior save', async () => {
  const gate = deferred(); let events = [], calls = 0, active = 0, maximum = 0;
  const f = fixture({ importWorkboardSnapshot: async input => {
    calls++; active++; maximum = Math.max(maximum, active);
    const plan = planWorkboardImport(input, events);
    if (calls === 1) await gate.promise;
    events.push(...plan.events); active--; return plan;
  } });
  try {
    f.hook.connect(); f.send('ready');
    const input = snapshot(); f.send('snapshot', input); f.send('snapshot', input);
    await tick(); assert.equal(calls, 1); assert.equal(acks(f).length, 0);
    gate.resolve(); await tick(); await tick();
    assert.equal(calls, 2); assert.equal(maximum, 1); assert.equal(recordsFor(events).records.length, 1);
    assert.deepEqual(acks(f).map(result => result.imported), [1, 0]); assert.equal(acks(f)[1].skipped, 1);
    assert.equal(f.state.connected, true); assert.equal(f.state.busy, false);
  } finally { f.close(); }
});

test('migration acknowledges only after persistence succeeds and rejects snapshot messages in migration mode', async () => {
  const gate = deferred(); let migrations = 0, snapshots = 0;
  const f = fixture({ importLinkedBackup: async payload => { migrations++; assert.equal(payload.backup, 'validated-by-store'); await gate.promise; return { imported: 7 }; }, importWorkboardSnapshot: async () => { snapshots++; } });
  try {
    f.hook.migrate(); f.send('ready');
    assert.equal(f.posted.at(-1).message.type, 'request-migration');
    f.send('snapshot', snapshot()); f.send('migration', { backup: 'validated-by-store' });
    await tick(); assert.equal(snapshots, 0); assert.equal(migrations, 1); assert.equal(acks(f).length, 0); assert.doesNotMatch(f.state.message, /복사했습니다/);
    gate.resolve(); await tick();
    assert.equal(acks(f)[0].imported, 7); assert.match(f.state.message, /변경 이력 7건을 복사/); assert.equal(f.state.connected, false); assert.equal(f.state.busy, false);
    f.send('migration', { backup: 'validated-by-store' }); await tick(); assert.equal(migrations, 1);
  } finally { f.close(); }
});

test('storage failure sends an error acknowledgement without claiming migration success', async () => {
  const f = fixture({ importLinkedBackup: async () => { throw new Error('기기 저장 용량 부족'); } });
  try {
    f.hook.migrate(); f.send('ready'); f.send('migration', { backup: 'source-stays-intact' }); await tick();
    assert.equal(acks(f).length, 1); assert.match(acks(f)[0].error, /저장을 완료하지 못했습니다/);
    assert.match(f.state.error, /저장 용량/); assert.equal(f.state.busy, false);
    assert.equal(f.updates.some(update => /복사했습니다|가져왔습니다/.test(update.message)), false);
  } finally { f.close(); }
});

test('blocked popups and closed windows end the connection with an actionable message', async () => {
  const blocked = fixture({}, { blocked: true });
  try { blocked.hook.connect(); assert.match(blocked.state.error, /차단.*팝업.*Chrome/); assert.equal(blocked.state.busy, false); }
  finally { blocked.close(); }
  let calls = 0;
  const f = fixture({ importWorkboardSnapshot: async () => { calls++; return { imported: 0, differences: [], missing: [] }; } });
  try {
    f.hook.connect(); f.send('ready'); const popup = f.popups[0]; popup.closed = true; f.intervals();
    assert.equal(f.state.connected, false); assert.equal(f.state.busy, false); assert.match(f.state.message, /창이 닫혔습니다/);
    f.send('snapshot', snapshot(), { popup }); await tick(); assert.equal(calls, 0);
  } finally { f.close(); }
});

test('a stopped or replaced session ignores queued snapshots and never acknowledges an unfinished old save', async () => {
  const gate = deferred(); let calls = 0;
  const f = fixture({ importWorkboardSnapshot: async () => { calls++; await gate.promise; return { imported: 1, differences: [], missing: [] }; } });
  try {
    f.hook.connect(); f.send('ready'); const old = f.popups[0]; f.send('snapshot', snapshot()); f.send('snapshot', snapshot()); await tick();
    f.hook.disconnect(); gate.resolve(); await tick(); await tick();
    assert.equal(calls, 1); assert.equal(acks(f).length, 0); assert.equal(f.state.connected, false);
    f.hook.connect(); f.send('snapshot', snapshot(), { popup: old }); await tick(); assert.equal(calls, 1);
  } finally { f.close(); }
});

test('handshake and initial payload waits time out without fabricating saved records', () => {
  for (const ready of [false, true]) {
    const f = fixture({});
    try { f.hook.connect(); if (ready) f.send('ready'); f.timeout(ready ? 60000 : 120000); assert.equal(f.state.busy, false); assert.match(f.state.error, /다시 연결/); assert.equal(acks(f).length, 0); }
    finally { f.close(); }
  }
});

test('message envelope requires an exact opener and a full generated nonce', () => {
  const source = {}, nonce = 'a'.repeat(48), event = { source, origin: WORKBOARD_ORIGIN, data: { channel: LINK_CHANNEL, version: 1, nonce, type: 'snapshot' } };
  assert.equal(validLinkMessage(event, { source, origin: WORKBOARD_ORIGIN, nonce, types: ['snapshot'] }), true);
  assert.equal(validLinkMessage(event, { source: null, origin: WORKBOARD_ORIGIN, nonce, types: ['snapshot'] }), false);
  assert.equal(validLinkMessage({ ...event, data: { ...event.data, nonce: 'a' } }, { source, origin: WORKBOARD_ORIGIN, nonce: 'a', types: ['snapshot'] }), false);
});
