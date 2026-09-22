import { isRecognized, isDate } from './performanceDomain.mjs';

export const MILITARY_THRESHOLDS = { individual: 50, groupMinutes: 24 * 60, testCases: 10 };
export function militaryYear(records, year, { acceptedOnly = true, helpCall = false } = {}) {
  const source = records.filter(r => r.date?.startsWith(`${year}-`) && r.status === 'done' && !r.needsReview && !r._conflict && r.targets?.military !== false);
  const eligible = acceptedOnly ? source.filter(r => isRecognized(r, 'military')) : source;
  const individual = eligible.filter(r => r.activity === 'individual' && (r.format === 'face' || helpCall));
  const group = eligible.filter(r => r.activity === 'group' && ['structured', 'unstructured'].includes(r.groupCategory) && ['leader', 'co-leader', 'participant'].includes(r.groupRole));
  const tests = eligible.filter(r => r.activity === 'test' && ['standardized', 'projective'].includes(r.testCategory) && r.testCaseId);
  const sessions = individual.reduce((s, r) => s + r.sessions, 0), groupMinutes = group.reduce((s, r) => s + r.minutes, 0);
  const testCases = new Set(tests.map(r => `${r.institution}\u0000${r.testCaseId}`)).size;
  const passed = Number(sessions >= 50) + Number(groupMinutes >= 1440) + Number(testCases >= 10);
  const excluded = eligible.filter(r => (r.activity === 'individual' && r.format !== 'face' && !helpCall)
    || (r.activity === 'group' && (!['structured', 'unstructured'].includes(r.groupCategory) || !r.groupRole))
    || (r.activity === 'test' && (!['standardized', 'projective'].includes(r.testCategory) || !r.testCaseId)));
  const institutionMap = new Map();
  for (const r of [...individual, ...group, ...tests]) {
    if (!institutionMap.has(r.institution)) institutionMap.set(r.institution, new Set());
    institutionMap.get(r.institution).add(r.activity);
  }
  return { sessions, groupMinutes, testCases, passed, meetsAnnualThreshold: passed >= 2, excluded,
    pendingCenter: source.filter(r => !isRecognized(r, 'military')).length,
    institutions: [...institutionMap].map(([institution, kinds]) => ({ institution, activities: [...kinds] })) };
}
// Calendar duration is a personal reference, never converted into recognized experience.
export function employmentDays(entries = [], asOf) {
  const periods = entries.map(e => [e.from, e.to || asOf]).filter(([from, to]) => isDate(from) && isDate(to) && from <= to)
    .map(([from, to]) => [Date.parse(from + 'T00:00:00Z'), Date.parse(to + 'T00:00:00Z')]).sort((a, b) => a[0] - b[0]);
  let total = 0, start = null, end = null;
  for (const [a, b] of periods) {
    if (start == null) { start = a; end = b; }
    else if (a <= end + 86400000) end = Math.max(end, b);
    else { total += (end - start) / 86400000 + 1; start = a; end = b; }
  }
  return total + (start == null ? 0 : (end - start) / 86400000 + 1);
}
