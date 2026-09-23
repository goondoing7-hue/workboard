import test from 'node:test';
import assert from 'node:assert/strict';
import { APPROVAL_SCHEMES, APPROVAL_ITEMS, findApprovalItem } from '../src/performanceApprovalCatalog.mjs';

const target = (itemId, measureId) => findApprovalItem(itemId).measures.find(entry => entry.id === measureId).target;

test('approval catalog keeps different associations, tracks and stable unique identifiers', () => {
  assert.deepEqual(APPROVAL_SCHEMES.map(entry => entry.name), ['한국상담심리학회', '한국상담학회']);
  assert.equal(APPROVAL_SCHEMES[0].track, '상담심리사 2급');
  assert.match(APPROVAL_SCHEMES[1].track, /1급.*B범주.*720시간.*4년/);
  assert.equal(new Set(APPROVAL_ITEMS.map(entry => entry.id)).size, APPROVAL_ITEMS.length);
  for (const item of APPROVAL_ITEMS) {
    assert.match(item.id, /^[a-z0-9-]+$/);
    assert.ok(APPROVAL_SCHEMES.some(scheme => scheme.id === item.scheme && scheme.sections.includes(item.section)));
    assert.ok(item.conditions.length > 0);
    assert.equal(new Set(item.measures.map(entry => entry.id)).size, item.measures.length);
    for (const entry of item.measures) assert.ok(Number.isFinite(entry.target) && entry.target > 0);
  }
  assert.equal(findApprovalItem('unknown'), undefined);
});

test('psychological association screenshot requirements preserve both case counts and session totals', () => {
  assert.equal(APPROVAL_ITEMS.filter(entry => entry.scheme === 'kcp').length, 9);
  assert.equal(target('kcp-intake', 'times'), 20);
  assert.equal(target('kcp-individual-counseling', 'cases'), 5);
  assert.equal(target('kcp-individual-counseling', 'sessions'), 50);
  assert.equal(target('kcp-individual-supervision', 'times'), 10);
  assert.equal(target('kcp-group-participation', 'groups'), 2);
  assert.equal(target('kcp-group-participation', 'minutes'), 30 * 60);
  assert.equal(target('kcp-test-administration', 'cases'), 10);
  assert.equal(target('kcp-test-interpretation', 'cases'), 10);
  assert.equal(target('kcp-test-supervision', 'cases'), 5);
  assert.equal(target('kcp-public-presentation', 'cases'), 2);
  assert.equal(target('kcp-public-presentation', 'sessions'), 10);
  assert.match(findApprovalItem('kcp-public-presentation').conditions.join(' '), /총 10회기/);
  assert.equal(target('kcp-case-study-activity', 'times'), 10);
});

test('720-hour counseling association subtotal excludes additional workshops and document counts', () => {
  const hours = section => APPROVAL_ITEMS.filter(entry => entry.scheme === 'kca' && entry.section === section && entry.within720)
    .reduce((sum, entry) => sum + entry.measures.filter(measure => measure.id === 'minutes').reduce((n, measure) => n + measure.target, 0), 0) / 60;
  assert.equal(hours('개인상담'), 590);
  assert.equal(hours('집단상담'), 130);
  assert.equal(hours('기타요건'), 0);
  assert.equal(target('kca-workshops', 'minutes'), 80 * 60);
  assert.equal(findApprovalItem('kca-workshops').within720, false);
  assert.equal(APPROVAL_ITEMS.filter(entry => entry.scheme === 'kca' && entry.section === '제출서류').length, 6);
  assert.equal(target('kca-document-individual-presentations', 'times'), 2);
});

test('remote maximums, testing restrictions, special conditions and clipped source remain visible', () => {
  const expected = { 'kca-intake': 10, 'kca-client-experience': 15, 'kca-counselor-experience': 240, 'kca-individual-supervision': 56, 'kca-group-member-experience': 35, 'kca-group-leader-experience': 25, 'kca-group-supervision': 8 };
  for (const [id, hours] of Object.entries(expected)) assert.equal(findApprovalItem(id).onlineMaxMinutes, hours * 60);
  assert.match(findApprovalItem('kcp-test-supervision').conditions.join(' '), /1\/2/);
  assert.match(findApprovalItem('kca-counselor-experience').conditions.join(' '), /50%/);
  assert.match(findApprovalItem('kca-counselor-experience').conditions.join(' '), /30%/);
  assert.match(findApprovalItem('kca-counselor-experience').conditions.join(' '), /12건/);
  assert.match(findApprovalItem('kca-counselor-experience').conditions.join(' '), /20건/);
  assert.equal(findApprovalItem('kca-research').sourceIncomplete, true);
  assert.match(findApprovalItem('kca-research').conditions.join(' '), /원문 추가 확인/);
});
