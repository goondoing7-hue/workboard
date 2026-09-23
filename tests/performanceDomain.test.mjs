import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRecord, validateRecord, validateEvent, validateProfile, mergeEvents, recordsFor, summarize,
  normalizeApproval, validateApproval, normalizeSupervisor, validateSupervisor, resetChangedApproval, scheduleCompletionEvents,
} from '../src/performanceDomain.mjs';
import { normalizeSchedule } from '../src/performanceScheduleDomain.mjs';
import {
  EVENT_PREFIX, QUARANTINE_PREFIX, readLocalEvents, writeLocalEvents, quarantineCorruptEvents, parseBackup, backupText,
} from '../src/performancePersistence.mjs';

const record = (patch = {}) => normalizeRecord({ id: 'record-1', date: '2026-09-23', caseId: 'C-1', ...patch });
const event = (id = 'event-1', patch = {}, payload = record()) => ({ id, entityId: payload.id, entityType: 'record', baseRevision: null, createdAt: '2026-09-23T01:00:00.000Z', payload, ...patch });
class MemoryStorage {
  map = new Map();
  get length() { return this.map.size; }
  key(index) { return [...this.map.keys()][index] ?? null; }
  getItem(key) { return this.map.get(key) ?? null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}
const archives = storage => [...storage.map].filter(([key]) => key.startsWith(QUARANTINE_PREFIX)).map(([, value]) => JSON.parse(value));
const approval = (patch = {}) => normalizeApproval({ id: 'approval-1', target: 'kcp', itemId: 'kcp-individual-counseling', date: '2026-09-23', title: '사례 A 면접상담', quantities: { cases: 1, sessions: 10 }, ...patch });
const supervisor = (patch = {}) => normalizeSupervisor({ id: 'supervisor-1', name: '검증용 수퍼바이저', kcp: true, ...patch });
const schedule = (patch = {}) => normalizeSchedule({ id: 'schedule-1', title: '수련 학술모임', date: '2026-09-23', endDate: '2026-09-23', start: '10:00', end: '12:00', target: 'kca', itemId: 'kca-workshops', format: 'remote', ...patch });
const entityEvent = (entityType, payload, id, baseRevision = null) => ({ ...event(id), entityType, entityId: payload.id, payload, baseRevision });

test('required UI values are validated before normalization can supply defaults', () => {
  assert.equal(validateRecord(record()), null);
  assert.equal(validateRecord({ ...record(), sessions: '2', participants: '2', minutes: '100' }), null);
  for (const key of ['date', 'sessions', 'participants', 'minutes', 'institution', 'status', 'format']) {
    assert.ok(validateRecord({ ...record(), [key]: '' }), key);
  }
  for (const bad of [true, false, null, [], {}, ' ', Infinity, NaN]) assert.ok(validateRecord({ ...record(), minutes: bad }), String(bad));
  assert.ok(validateRecord({ ...record(), date: '2026-02-30' }));
  assert.ok(validateRecord({ ...record(), recognition: { ...record().recognition, center: { status: 'approved', confirmedOn: '2026-09-23', approver: '   ' } } }));
});

test('new form defaults remain available and null confirmations cannot crash normalization', () => {
  assert.equal(normalizeRecord().minutes, 50);
  assert.equal(normalizeRecord(null).activity, 'individual');
  assert.equal(normalizeRecord({ recognition: { center: null } }).recognition.center.status, 'pending');
});

test('persisted enums and numeric types cannot become performed face-to-face activity by fallback', () => {
  for (const patch of [{ status: 'cancel' }, { format: 'unknown' }, { activity: 'unknown' }, { minutes: '50' }, { targets: { kca: 'false', kcp: true, military: true } }, { needsReview: 'false' }]) {
    assert.ok(validateEvent(event('bad-event', {}, { ...record(), ...patch })), JSON.stringify(patch));
  }
  assert.ok(validateEvent(event('bad-event', { createdAt: 12345678 })));
  assert.ok(validateEvent(event('bad-event', { id: 123 })));
  assert.ok(validateEvent(event('bad-event', {}, { ...record(), deleted: 'false' })));
  assert.ok(validateEvent(event('bad-event', {}, { ...record(), unknownField: 'unexpected' })));
});

test('needsReview permits unknown minutes but never bypasses record structure validation', () => {
  const imported = event('imported', {}, record({ minutes: 0, needsReview: true }));
  assert.equal(validateEvent(imported), null);
  assert.equal(summarize(recordsFor([imported]).records).sessions, 0);
  assert.ok(validateEvent(event('reviewed', {}, record({ minutes: 0 }))));
  for (const patch of [{ recognition: { center: null } }, { activity: 'unknown' }, { sessions: -1 }, { minutes: NaN }, { targets: [] }, { participantIds: [null] }]) {
    const invalid = event('bad-import', {}, { ...imported.payload, ...patch });
    assert.ok(validateEvent(invalid), JSON.stringify(patch));
    assert.throws(() => mergeEvents([invalid]));
  }
});

test('nested data and profile arrays are validated before a backup reaches the UI', () => {
  for (const payload of [{ qualifications: null }, { employments: {} }, { documents: { row: null } }, { recognizedMonths: false }, { degreeDate: '2026-02-30' }, { documents: { row: { stamped: 'true' } } }]) {
    assert.ok(validateProfile(payload));
    assert.throws(() => parseBackup(backupText([{ ...event(), entityType: 'profile', entityId: 'profile', payload }])));
  }
  assert.ok(validateEvent({ ...event(), entityType: 'profile', entityId: 'other-profile', payload: {} }));
  const circular = {}; circular.self = circular;
  assert.doesNotThrow(() => validateEvent(event('circular', {}, circular)));
  assert.ok(validateEvent(event('circular', {}, circular)));
  const unsafe = JSON.parse(JSON.stringify(event()));
  unsafe.payload.note = 'unsupported\u0000control';
  assert.ok(validateEvent(unsafe));
  assert.equal(validateProfile({ degreePath: 'master', qualifications: [{ id: 'q-1', name: '상담 자격', issuer: '발급기관', date: '2026-09-01', evidence: 'https://example.org/proof' }], employments: [{ id: 'job-1', institution: '기관', role: '상담', from: '2026-01-01', to: '', hours: '50.5', evidence: '' }], documents: {}, recognizedMonths: '12' }), null);
});

test('same immutable change ID is idempotent across property order and rejects changed payload', () => {
  const first = event();
  const reordered = { payload: { ...first.payload }, createdAt: first.createdAt, entityType: first.entityType, entityId: first.entityId, id: first.id };
  assert.equal(mergeEvents([first], [reordered]).length, 1);
  assert.throws(() => mergeEvents([first], [{ ...first, payload: record({ minutes: 100 }) }]), /동일한 변경 ID/);
});

test('self references, reference cycles and references to another entity are rejected', () => {
  assert.ok(validateEvent(event('self', { baseRevision: 'self' })));
  assert.ok(validateEvent(event('self', {}, { ...record(), _resolves: ['self'] })));
  assert.ok(validateEvent(event('bad-resolve', {}, { ...record(), _resolves: 'event-1' })));
  assert.ok(validateEvent(event('bad-resolve', {}, { ...record(), _resolves: ['event-1', 'event-1'] })));
  assert.throws(() => mergeEvents([event('a', { baseRevision: 'b' }), event('b', { baseRevision: 'a' })]), /순환/);
  assert.throws(() => recordsFor([event('a', { baseRevision: 'b' }), event('b', {}, { ...record(), _resolves: ['a'] })]), /순환/);
  const other = event('other', {}, record({ id: 'record-2' }));
  assert.throws(() => mergeEvents([other, event('child', { baseRevision: 'other' })]), /다른 활동/);
  assert.throws(() => mergeEvents([other, event('child', {}, { ...record(), _resolves: ['other'] })]), /다른 활동/);
});

test('concurrent revisions preserve conflicts, exclude ambiguous totals and allow explicit resolution', () => {
  const first = event('first');
  const left = event('left', { baseRevision: first.id }, record({ minutes: 100 }));
  const right = event('right', { baseRevision: first.id }, record({ minutes: 150 }));
  const conflicted = recordsFor(mergeEvents([first, left], [first, right]));
  assert.equal(conflicted.conflicts.length, 1);
  assert.equal(conflicted.records[0]._conflict, true);
  assert.equal(summarize(conflicted.records).minutes, 0);
  const resolved = event('resolved', { baseRevision: right.id }, { ...right.payload, _resolves: [left.id, right.id] });
  const final = recordsFor(mergeEvents([first, left, right, resolved]));
  assert.equal(final.conflicts.length, 0);
  assert.equal(summarize(final.records).minutes, 150);
  // A complete surviving snapshot can be restored before its missing predecessor.
  assert.equal(recordsFor([left]).records[0].minutes, 100);
  assert.equal(mergeEvents([left], [first]).length, 2);
});

test('partial participant codes do not assume every named participant attended every session', () => {
  const partial = summarize([record({ activity: 'group', sessions: 2, participants: 2, participantIds: ['A'] })]);
  assert.equal(partial.people, 1);
  assert.equal(partial.attendance, 2);
  assert.equal(partial.unknownPeople, 1);
  assert.equal(partial.peopleExact, false);
  const complete = summarize([record({ activity: 'group', sessions: 1, participants: 2, participantIds: ['A', 'B'] })]);
  assert.equal(complete.people, 2);
  assert.equal(complete.peopleExact, true);
  const individual = summarize([record({ sessions: 4, participants: 4 }), record({ id: 'record-2', sessions: 2, participants: 2 })]);
  assert.equal(individual.people, 1);
  assert.equal(individual.attendance, 6);
  assert.equal(individual.peopleExact, true);
});

test('shared center confirmation still permits excluding a target independently', () => {
  const approved = record({ targets: { kcp: true, kca: true, military: false }, recognition: { center: { status: 'approved', confirmedOn: '2026-09-23', approver: '기관 담당자' }, supervisor: { status: 'pending' } } });
  assert.equal(summarize([approved], { target: 'kca' }).sessions, 1);
  assert.equal(summarize([approved], { target: 'military' }).sessions, 0);
  assert.equal(summarize([approved], { target: 'kcp' }).sessions, 0);
});

test('backup round-trip merges revisions without duplicate statistics or partial overwrite on ID collision', () => {
  const storage = new MemoryStorage(), first = event('first');
  writeLocalEvents(storage, [first]);
  writeLocalEvents(storage, parseBackup(backupText([first])));
  assert.equal(summarize(recordsFor(readLocalEvents(storage)).records).sessions, 1);
  const newEvent = event('new-record', {}, record({ id: 'record-2' }));
  assert.throws(() => writeLocalEvents(storage, [newEvent, { ...first, payload: record({ minutes: 100 }) }]));
  assert.equal(storage.getItem(EVENT_PREFIX + newEvent.id), null);
  assert.deepEqual(readLocalEvents(storage), [first]);
});

test('recovery quarantines only corrupt raw keys and preserves normal records and unrelated data', () => {
  const storage = new MemoryStorage(), good = event('good');
  writeLocalEvents(storage, [good]);
  storage.setItem('workboard:data', 'untouched');
  storage.setItem(EVENT_PREFIX + 'bad-json', '{broken JSON');
  const self = event('self', { baseRevision: 'self' });
  storage.setItem(EVENT_PREFIX + 'self', JSON.stringify(self));
  assert.throws(() => readLocalEvents(storage));
  assert.deepEqual(quarantineCorruptEvents(storage), { quarantined: 2, skipped: 0 });
  assert.deepEqual(readLocalEvents(storage), [good]);
  assert.equal(storage.getItem('workboard:data'), 'untouched');
  assert.equal(archives(storage).find(item => item.originalKey.endsWith('bad-json')).raw, '{broken JSON');
  assert.equal(archives(storage).find(item => item.originalKey.endsWith('self')).raw, JSON.stringify(self));
  assert.equal(quarantineCorruptEvents(storage).quarantined, 0);
  writeLocalEvents(storage, parseBackup(backupText([good, event('restored', {}, record({ id: 'restored-record' }))])));
  assert.equal(readLocalEvents(storage).length, 2);
});

test('graph recovery archives cycle participants and cross-entity references without removing sound ancestors', () => {
  const storage = new MemoryStorage(), good = event('good');
  for (const item of [good, event('a', { baseRevision: 'b' }), event('b', { baseRevision: 'a' }), event('foreign', { baseRevision: 'good' }, record({ id: 'other-record' }))]) storage.setItem(EVENT_PREFIX + item.id, JSON.stringify(item));
  assert.equal(quarantineCorruptEvents(storage).quarantined, 3);
  assert.deepEqual(readLocalEvents(storage), [good]);
});

test('recovery never deletes original bytes when writing the quarantine fails', () => {
  const storage = new MemoryStorage();
  storage.setItem(EVENT_PREFIX + 'bad', '{damaged');
  const originalSet = storage.setItem.bind(storage);
  storage.setItem = (key, value) => { if (key.startsWith(QUARANTINE_PREFIX)) throw new Error('Quota exceeded'); originalSet(key, value); };
  assert.throws(() => quarantineCorruptEvents(storage), /Quota/);
  assert.equal(storage.getItem(EVENT_PREFIX + 'bad'), '{damaged');
});

test('recovery does not delete a record another tab repaired after the corruption scan', () => {
  const storage = new MemoryStorage(), repaired = event('bad'), repairedBytes = JSON.stringify(repaired);
  storage.setItem(EVENT_PREFIX + 'bad', '{damaged');
  const originalSet = storage.setItem.bind(storage);
  storage.setItem = (key, value) => { originalSet(key, value); if (key.startsWith(QUARANTINE_PREFIX)) originalSet(EVENT_PREFIX + 'bad', repairedBytes); };
  assert.deepEqual(quarantineCorruptEvents(storage), { quarantined: 0, skipped: 1 });
  assert.equal(storage.getItem(EVENT_PREFIX + 'bad'), repairedBytes);
  assert.equal(archives(storage)[0].raw, '{damaged');
});

test('item-level approval validates its own scheme, allowed measures and explicit approval evidence', () => {
  assert.equal(validateApproval(approval()), null);
  const approved = approval({ status: 'approved', approver: '확인자', confirmedOn: '2026-09-23', requirementsChecked: true });
  assert.equal(validateApproval(approved), null);
  for (const patch of [{ target: 'kca' }, { itemId: 'unknown' }, { quantities: {} }, { quantities: { sessions: 0 } }, { quantities: { sessions: -1 } }, { quantities: { sessions: 1.5 } }, { quantities: { minutes: 10 } }, { requirementsChecked: 'true' }, { confirmedOn: '2026-02-30' }, { sourceRecordId: '../unsafe' }, { evidence: 'javascript:alert(1)' }]) assert.ok(validateApproval({ ...approved, ...patch }), JSON.stringify(patch));
  for (const patch of [{ approver: '' }, { confirmedOn: '' }, { requirementsChecked: false }]) assert.ok(validateApproval({ ...approved, ...patch }));
  assert.equal(validateApproval({ ...approval(), quantities: { cases: '0', sessions: '2' } }), null);
  assert.ok(validateApproval({ ...approval(), quantities: { cases: '0', sessions: '2' } }, { stored: true }));
  assert.ok(validateEvent(entityEvent('approval', { ...approval(), _sourceReview: false }, 'bad-derived')));
});

test('legacy approvals never become item approvals and missing supervisor IDs remain compatible', () => {
  const legacy = record({ supervisor: '이전 이름', recognition: { center: { status: 'approved', confirmedOn: '2026-09-23', approver: '센터' } } });
  delete legacy.supervisorId;
  const state = recordsFor([event('legacy', {}, legacy)]);
  assert.equal(state.records[0].supervisor, '이전 이름');
  assert.equal(state.records[0].supervisorId, '');
  assert.deepEqual(state.approvalEntries, []);
  assert.deepEqual(state.supervisors, []);
  assert.equal(summarize(state.records, { target: 'kca' }).sessions, 1);
});

test('item approvals and supervisor snapshots round-trip through immutable backups without retroactive name changes', () => {
  const first = entityEvent('supervisor', supervisor(), 'sv-first');
  const nameChange = entityEvent('supervisor', supervisor({ name: '변경된 이름', active: false }), 'sv-updated', first.id);
  const approved = entityEvent('approval', approval({ supervisorId: first.entityId, supervisorName: first.payload.name }), 'approval-first');
  const storage = new MemoryStorage();
  writeLocalEvents(storage, parseBackup(backupText([first, approved, nameChange])));
  writeLocalEvents(storage, [approved]);
  const state = recordsFor(readLocalEvents(storage));
  assert.equal(state.approvalEntries.length, 1);
  assert.equal(state.approvalEntries[0].supervisorName, first.payload.name);
  assert.equal(state.supervisors[0].name, '변경된 이름');
  assert.equal(state.supervisors[0].active, false);
  assert.equal(validateSupervisor(supervisor()), null);
  for (const patch of [{ name: '' }, { kcp: 'true' }, { active: null }, { qualification: 'x'.repeat(501) }]) assert.ok(validateSupervisor({ ...supervisor(), ...patch }));
});

test('item approval changes reset only substantive approved details and preserve memo and proof edits', () => {
  const original = approval({ status: 'approved', approver: '수퍼바이저', confirmedOn: '2026-09-23', requirementsChecked: true });
  for (const patch of [{ quantities: { cases: 1, sessions: 11 } }, { caseCode: 'C-2' }, { date: '2026-09-24' }, { format: 'remote' }, { sourceRecordId: 'record-2' }, { supervisorName: '다른 수퍼바이저' }, { itemId: 'different' }, { target: 'kca' }]) {
    const changed = resetChangedApproval(original, { ...original, ...patch });
    assert.equal(changed.status, 'requested'); assert.equal(changed.confirmedOn, ''); assert.equal(changed.requirementsChecked, false);
  }
  assert.equal(resetChangedApproval(original, { ...original, note: '설명', evidence: 'https://example.org/proof', title: '제목 정리' }).status, 'approved');
  assert.equal(resetChangedApproval({ ...original, _sourceReview: true }, { ...original }).status, 'requested');
});

test('linked activity revisions and deletions require rechecking approval without losing its history', () => {
  const source = event('source-first');
  const linked = entityEvent('approval', approval({ sourceRecordId: source.entityId, sourceRevision: source.id }), 'linked');
  assert.equal(recordsFor([source, linked]).approvalEntries[0]._sourceReview, false);
  const changed = event('source-changed', { baseRevision: source.id }, record({ minutes: 100 }));
  assert.equal(recordsFor([source, changed, linked]).approvalEntries[0]._sourceReview, true);
  const deleted = { ...event('source-deleted', { baseRevision: source.id }), payload: { deleted: true } };
  assert.equal(recordsFor([source, deleted, linked]).approvalEntries[0]._sourceReview, true);
  assert.equal(recordsFor([linked]).approvalEntries[0]._sourceReview, true);
});

test('approval and supervisor conflicts support explicit resolution and deletion tombstones', () => {
  for (const [type, make] of [['approval', approval], ['supervisor', supervisor]]) {
    const first = entityEvent(type, make(), `${type}-first`);
    const left = entityEvent(type, make({ note: 'left' }), `${type}-left`, first.id);
    const right = entityEvent(type, make({ note: 'right' }), `${type}-right`, first.id);
    const key = type === 'approval' ? 'approvalEntries' : 'supervisors';
    const conflicted = recordsFor([first, left, right]);
    assert.equal(conflicted[key][0]._conflict, true);
    assert.equal(conflicted.conflicts[0].entityType, type);
    const resolved = { ...entityEvent(type, make({ note: 'resolved' }), `${type}-resolved`, right.id), payload: { ...make({ note: 'resolved' }), _resolves: [left.id, right.id] } };
    assert.equal(recordsFor([first, left, right, resolved]).conflicts.length, 0);
    const deleted = { ...entityEvent(type, make(), `${type}-deleted`, resolved.id), payload: { deleted: true } };
    assert.equal(recordsFor([first, left, right, resolved, deleted])[key].length, 0);
  }
});

test('scheduled training converts once into performed activity and a pending item approval', () => {
  const first = entityEvent('schedule', schedule(), 'schedule-first');
  const result = scheduleCompletionEvents([first], first.entityId, { actualMinutes: 100, quantities: { minutes: 90 }, sessions: 1, participants: 1 });
  assert.equal(result.events.length, 3);
  const state = recordsFor([first, ...result.events]);
  assert.equal(state.records.length, 1); assert.equal(state.records[0].activity, 'training'); assert.equal(state.records[0].minutes, 100); assert.equal(state.records[0].format, 'remote');
  assert.deepEqual(state.records[0].targets, { kcp: false, kca: true, military: false });
  assert.equal(state.approvalEntries[0].quantities.minutes, 90);
  assert.equal(state.approvalEntries[0].status, 'pending'); assert.equal(state.approvalEntries[0].requirementsChecked, false);
  assert.equal(state.approvalEntries[0]._sourceReview, false);
  assert.equal(state.schedules[0].status, 'done'); assert.equal(state.schedules[0].recordId, result.recordId);
  const repeat = scheduleCompletionEvents([first, ...result.events], first.entityId);
  assert.equal(repeat.alreadyCompleted, true); assert.deepEqual(repeat.events, []);
  assert.equal(summarize(state.records, { target: 'kca' }).minutes, 0);
});

test('schedule completion retries a partial local batch without duplicating records or approvals', () => {
  const first = entityEvent('schedule', schedule(), 'schedule-first');
  const options = { actualMinutes: 100, quantities: { minutes: 100 } };
  const started = scheduleCompletionEvents([first], first.entityId, options);
  for (const prefix of [started.events.slice(0, 1), started.events.slice(0, 2)]) {
    const retry = scheduleCompletionEvents([first, ...prefix], first.entityId, options);
    const state = recordsFor(parseBackup(backupText([first, ...prefix, ...retry.events])));
    assert.equal(state.records.length, 1); assert.equal(state.approvalEntries.length, 1); assert.equal(state.conflicts.length, 0);
    assert.equal(state.approvalEntries[0].sourceRevision, state.records[0]._revision);
    assert.equal(state.schedules[0].recordId, state.records[0].id);
    assert.equal(summarize(state.records).minutes, 100);
  }
});

test('planned or cancelled schedules cannot silently turn missing or invalid quantities into performance', () => {
  const first = entityEvent('schedule', schedule(), 'schedule-first');
  for (const options of [{ quantities: { minutes: 100 } }, { actualMinutes: '', quantities: { minutes: 100 } }, { actualMinutes: true, quantities: { minutes: 100 } }, { actualMinutes: 100, quantities: { minutes: 0 } }, { actualMinutes: 100, quantities: { cases: 1 } }, { actualMinutes: 100, quantities: { minutes: true } }]) assert.throws(() => scheduleCompletionEvents([first], first.entityId, options));
  const cancelled = entityEvent('schedule', schedule({ status: 'cancelled' }), 'cancelled');
  assert.throws(() => scheduleCompletionEvents([cancelled], cancelled.entityId, { actualMinutes: 100, quantities: { minutes: 100 } }), /취소/);
  const unclassified = entityEvent('schedule', schedule({ target: '', itemId: '' }), 'unclassified');
  assert.throws(() => scheduleCompletionEvents([unclassified], unclassified.entityId, { actualMinutes: 100, quantities: { minutes: 100 } }), /인정 대상/);
  const done = scheduleCompletionEvents([first], first.entityId, { actualMinutes: 100, quantities: { minutes: 100 } });
  const recordChange = done.events.find(item => item.entityType === 'record');
  const deleted = { ...recordChange, id: 'deleted-record', baseRevision: recordChange.id, payload: { deleted: true } };
  assert.throws(() => scheduleCompletionEvents([first, recordChange, deleted], first.entityId, { actualMinutes: 100, quantities: { minutes: 100 } }), /삭제/);
});
