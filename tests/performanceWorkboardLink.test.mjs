import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkboardSnapshot, validateWorkboardSnapshot, parseWorkboardSnapshot, planWorkboardImport } from '../src/performanceWorkboardLink.mjs';
import { createEvent, normalizeRecord, recordsFor, summarize } from '../src/performanceDomain.mjs';
import { parseBackup, backupText } from '../src/performancePersistence.mjs';

const exportedAt = '2026-09-23T01:00:00.000Z';
const reservation = (patch = {}) => ({ id: 'reservation-1', clientId: 'client-1', date: '2026-09-23', start: '10:00', end: '11:00', type: '개인상담', method: '대면', status: 'done', ...patch });
const snapshot = reservations => createWorkboardSnapshot({ resv: reservations }, { exportedAt });
const previousEvent = (patch = {}) => {
  const record = normalizeRecord({ id: 'workboard:reservation-1', sourceReservationId: 'reservation-1', date: '2026-09-23', caseId: 'C-client-1', minutes: 60, ...patch });
  return createEvent('record', record.id, record);
};

test('snapshot whitelists completed counseling metadata without names, contact data, journal content or free text', () => {
  const board = { clients: [{ id: 'client-1', name: '비공개이름', phone: '010-9876-5432', birth: '2001-01-01', sex: '여', issue: '비공개호소' }],
    resv: [reservation({ name: '비공개이름', phone: '010-9876-5432', memo: '비공개예약메모', journal: '비공개일지본문', attachments: ['비공개첨부파일'], place: '비공개주소', type: '비공개프로그램명' }), reservation({ id: 'scheduled', status: 'scheduled', done: true }), reservation({ id: 'cancelled', status: 'cancelled', done: true }), reservation({ id: 'noshow', status: 'noshow' }), reservation({ id: 'legacy-done', status: undefined, done: true }), reservation({ id: 'invalid-done', status: undefined, done: 'false' })] };
  const result = createWorkboardSnapshot(board, { exportedAt });
  assert.deepEqual(result.records.map(row => row.source.id).sort(), ['legacy-done', 'reservation-1']);
  assert.equal(result.records[0].caseId, 'C-client-1');
  assert.equal(validateWorkboardSnapshot(result), null);
  const text = JSON.stringify(result);
  for (const secret of ['비공개이름', '010-9876-5432', '2001-01-01', '비공개호소', '비공개예약메모', '비공개일지본문', '비공개첨부파일', '비공개주소', '비공개프로그램명']) assert.equal(text.includes(secret), false, secret);
  assert.deepEqual(Object.keys(result.records[0]).sort(), ['source', 'date', 'caseId', 'minutes', 'format'].sort());
});

test('current reservation times take precedence and invalid or absent times remain unknown', () => {
  const rows = [reservation({ id: 'current', start: '10:00', end: '10:50', time: '09:00', endTime: '13:00' }), reservation({ id: 'legacy', start: undefined, end: undefined, time: '09:00', endTime: '10:00' }), reservation({ id: 'empty', start: '', end: '', time: '09:00', endTime: '10:00' }), reservation({ id: 'bad-hour', start: '25:00', end: '26:00' }), reservation({ id: 'reversed', start: '11:00', end: '10:00' })];
  delete rows[1].start; delete rows[1].end;
  const durations = Object.fromEntries(snapshot(rows).records.map(row => [row.source.id, row.minutes]));
  assert.deepEqual(durations, { 'bad-hour': 0, current: 50, empty: 0, legacy: 60, reversed: 0 });
});

test('explicit counseling method wins over stale calendar presentation flags', () => {
  const rows = [reservation({ id: 'face', method: '대면', remote: true, place: 'meet' }), reservation({ id: 'phone', method: '전화', remote: true }), reservation({ id: 'online', method: '온라인' }), reservation({ id: 'remote', method: '비대면' }), reservation({ id: 'legacy-meet', method: '', place: 'meet' })];
  assert.deepEqual(Object.fromEntries(snapshot(rows).records.map(row => [row.source.id, row.format])), { face: 'face', 'legacy-meet': 'remote', online: 'remote', phone: 'phone', remote: 'remote' });
});

test('JSON and wrapper exports are accepted while locked or malformed board data reports an explicit error', () => {
  const expected = snapshot([reservation()]);
  for (const input of [JSON.stringify({ resv: [reservation()] }), { data: { resv: [reservation()] } }, JSON.stringify({ data: JSON.stringify({ resv: [reservation()] }) })]) assert.deepEqual(createWorkboardSnapshot(input, { exportedAt }), expected);
  for (const input of [{ enc: 1, iv: 'cipher-iv', ct: 'ciphertext' }, JSON.stringify({ enc: 1, iv: 'cipher-iv', ct: 'ciphertext' }), { data: JSON.stringify({ enc: 1, iv: 'cipher-iv', ct: 'ciphertext' }) }]) assert.throws(() => createWorkboardSnapshot(input), /잠겨.*잠금을 해제/);
  for (const input of ['{broken', {}, { resv: {} }, { resv: [null] }, { resv: [reservation({ id: '' })] }, { resv: [reservation({ date: '2026-02-30' })] }, { resv: [reservation(), reservation()] }]) assert.throws(() => createWorkboardSnapshot(input));
});

test('receiving validator rejects non-whitelisted data, mismatched types, duplicate IDs and partial snapshots', () => {
  const good = snapshot([reservation()]);
  assert.deepEqual(parseWorkboardSnapshot(JSON.stringify(good)), good);
  assert.notEqual(parseWorkboardSnapshot(good).records[0], good.records[0]);
  for (const patch of [{ complete: false }, { version: 2 }, { extra: 'private text' }, { exportedAt: 'yesterday' }]) assert.ok(validateWorkboardSnapshot({ ...good, ...patch }));
  for (const patch of [{ memo: 'secret' }, { source: { id: 'reservation-1', name: 'secret' } }, { source: { id: '../unsafe' } }, { minutes: '60' }, { minutes: -1 }, { minutes: 1440 }, { format: 'unknown' }, { caseId: '실명' }, { date: '2026-02-30' }]) assert.ok(validateWorkboardSnapshot({ ...good, records: [{ ...good.records[0], ...patch }] }));
  assert.ok(validateWorkboardSnapshot({ ...good, records: [good.records[0], good.records[0]] }));
  assert.throws(() => planWorkboardImport({ ...good, records: [good.records[0], { ...good.records[0], source: { id: 'new' }, memo: 'secret' }] }));
});

test('new reservations become unreviewed records with legacy-compatible IDs and receiving the same snapshot is idempotent', () => {
  const input = snapshot([reservation(), reservation({ id: 'unknown-time', start: '', end: '' })]);
  const first = planWorkboardImport(input);
  assert.equal(first.imported, 2); assert.equal(first.events.length, 2); assert.equal(first.skipped, 0);
  const state = recordsFor(parseBackup(backupText(first.events)));
  assert.equal(state.records.every(record => record.id === `workboard:${record.sourceReservationId}` && record.needsReview), true);
  assert.equal(state.records.find(record => record.sourceReservationId === 'unknown-time').minutes, 0);
  assert.equal(summarize(state.records).sessions, 0);
  const repeated = planWorkboardImport(JSON.stringify(input), first.events);
  assert.equal(repeated.imported, 0); assert.equal(repeated.skipped, 2); assert.deepEqual(repeated.events, []); assert.deepEqual(repeated.differences, []);
});

test('receiving updates preserves user corrections and recognized performance, returning review proposals only', () => {
  const existing = previousEvent({ minutes: 75, note: '사용자가 쓴 별도 메모', recognition: { center: { status: 'approved', confirmedOn: '2026-09-23', approver: '확인자' } } });
  const original = structuredClone(existing);
  const plan = planWorkboardImport(snapshot([reservation({ end: '11:30', method: '전화' }), reservation({ id: 'new-record' })]), [existing]);
  assert.equal(plan.imported, 1); assert.equal(plan.skipped, 1);
  assert.deepEqual(plan.differences[0].fields, ['minutes', 'format']);
  assert.deepEqual(plan.differences[0].suggested, { date: '2026-09-23', caseId: 'C-client-1', minutes: 90, format: 'phone' });
  assert.equal(plan.differences[0].existingRevision, existing.id);
  assert.deepEqual(existing, original);
  const state = recordsFor([existing, ...plan.events]);
  assert.equal(state.records.find(record => record.id === existing.entityId).minutes, 75);
  assert.equal(state.records.find(record => record.id === existing.entityId).note, '사용자가 쓴 별도 메모');
  assert.equal(summarize(state.records, { target: 'kca' }).minutes, 75);
});

test('missing source rows or deletion tombstones never erase or resurrect previously imported performance', () => {
  const existing = previousEvent();
  const deleted = createEvent('record', existing.entityId, { deleted: true }, existing.id);
  const received = planWorkboardImport(snapshot([reservation()]), [existing, deleted]);
  assert.equal(received.imported, 0); assert.equal(received.deleted, 1); assert.deepEqual(received.events, []);
  const omitted = planWorkboardImport(snapshot([]), [existing]);
  assert.deepEqual(omitted.events, []); assert.equal(omitted.missing[0].id, existing.entityId);
  assert.equal(recordsFor([existing, ...omitted.events]).records.length, 1);
});

test('conflicted source imports remain conflicts and unknown source values do not replace actual reviewed values', () => {
  const first = previousEvent(), branch = previousEvent({ minutes: 80 }); branch.baseRevision = first.id;
  const other = previousEvent({ minutes: 70 }); other.baseRevision = first.id;
  const conflicting = planWorkboardImport(snapshot([reservation()]), [first, branch, other]);
  assert.deepEqual(conflicting.events, []); assert.equal(conflicting.differences[0].conflict, true);
  const unknown = planWorkboardImport(snapshot([reservation({ start: '', end: '', clientId: '' })]), [first]);
  assert.deepEqual(unknown.events, []); assert.deepEqual(unknown.differences, []);
});
