import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRecord } from '../src/performanceDomain.mjs';
import { militaryYear, employmentDays } from '../src/performanceMilitaryDomain.mjs';
const record = fields => normalizeRecord({ id: 'sample', date: '2026-01-01', caseId: 'C-1', recognition: { center: { status: 'approved', confirmedOn: '2026-01-02', approver: '기관' } }, ...fields });
test('annual thresholds require two distinct criteria in the same year, with no multiplication by people', () => {
  const individual = record({ sessions: 50, participants: 50, minutes: 2500 });
  const group = record({ id: 'group', activity: 'group', groupCategory: 'structured', groupRole: 'leader', minutes: 1440, participants: 100 });
  assert.equal(militaryYear([individual, group], 2026).passed, 2);
  assert.equal(militaryYear([individual, { ...group, date: '2025-12-31' }], 2026).passed, 1);
  assert.equal(militaryYear([{ ...group, minutes: 120 }], 2026).groupMinutes, 120);
});
test('unapproved, cancelled, imported unreviewed and conflicting records cannot meet military accepted threshold', () => {
  const sample = record({ sessions: 50, minutes: 2500 });
  for (const alteration of [{ status: 'cancelled' }, { needsReview: true }, { _conflict: true }, { targets: { military: false } }, { recognition: { center: { status: 'pending' } } }]) {
    assert.equal(militaryYear([{ ...sample, ...alteration }], 2026).sessions, 0);
  }
});
test('only face-to-face individual sessions count unless the specific helpline exception is selected', () => {
  const remote = record({ format: 'phone', sessions: 50 });
  assert.equal(militaryYear([remote], 2026).sessions, 0);
  assert.equal(militaryYear([remote], 2026, { helpCall: true }).sessions, 50);
  assert.equal(militaryYear([record({ activity: 'interpretation', sessions: 50 })], 2026).sessions, 0);
});
test('psychological tests are distinct case codes rather than instruments, sessions, or all work on one client', () => {
  const a = record({ activity: 'test', testCategory: 'standardized', testCaseId: 'T1', testName: '도구1', sessions: 10 });
  const b = { ...a, id: 'b', testCategory: 'projective', testName: '도구2' };
  const c = { ...a, id: 'c', testCaseId: 'T2' };
  assert.equal(militaryYear([a, b, c], 2026).testCases, 2);
  assert.equal(militaryYear([{ ...a, testCaseId: '' }, { ...b, testCategory: 'other' }], 2026).testCases, 0);
});
test('employment reference counts leap days and overlapping periods without double counting', () => {
  assert.equal(employmentDays([{ from: '2024-02-28', to: '2024-03-01' }, { from: '2024-02-29', to: '2024-03-02' }], '2026-01-01'), 4);
  assert.equal(employmentDays([{ from: '2026-01-01', to: '' }], '2026-01-03'), 3);
  assert.equal(employmentDays([{ from: '2026-02-30', to: '2026-03-02' }], '2026-01-01'), 0);
});
