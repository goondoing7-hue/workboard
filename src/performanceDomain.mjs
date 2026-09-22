// One performed activity, independent confirmations, and an immutable change log.
export const ACTIVITIES = [
  { id: 'intake', label: '접수면접' }, { id: 'individual', label: '개인상담' },
  { id: 'test', label: '검사실시' }, { id: 'interpretation', label: '해석상담' },
  { id: 'group', label: '집단상담' }, { id: 'supervision', label: '슈퍼비전' },
];
export const TARGETS = { performed: '진행 실적', kcp: '한상심', kca: '한상', military: '병영생활전문상담관' };
export const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const isDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !value.startsWith('0000') && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const string = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
const number = (value, fallback = 0) => value === '' || value == null ? fallback : Number(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const identifier = value => typeof value === 'string' && /^[\w:.-]{1,150}$/.test(value);
const textValue = (value, max = 2000) => typeof value === 'string' && value.length <= max;
const numeric = (value, { stored = false, integer = true, min = 0, max = 1000000 } = {}) => (typeof value === 'number' || (!stored && typeof value === 'string' && value.trim() !== ''))
  && Number.isFinite(Number(value)) && (!integer || Number.isInteger(Number(value))) && Number(value) >= min && Number(value) <= max;
const evidenceUrl = value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !!url.hostname; } catch { return false; } };
const confirmation = value => {
  const item = object(value) ? value : {};
  return { status: ['pending', 'requested', 'approved'].includes(item.status) ? item.status : 'pending', confirmedOn: string(item.confirmedOn, 10), evidence: string(item.evidence), approver: string(item.approver, 100) };
};
export function normalizeRecord(value = {}) {
  if (!object(value)) value = {};
  return {
    id: string(value.id, 150), date: string(value.date, 10) || localDate(), caseId: string(value.caseId, 100),
    activity: ACTIVITIES.some(a => a.id === value.activity) ? value.activity : 'individual',
    sessions: number(value.sessions, 1), participants: number(value.participants, 1), minutes: number(value.minutes, 50),
    institution: string(value.institution, 200) || '춘천시청소년상담복지센터',
    format: ['face', 'remote', 'phone'].includes(value.format) ? value.format : 'face',
    status: ['done', 'planned', 'cancelled'].includes(value.status) ? value.status : 'done',
    testName: string(value.testName, 200), testCaseId: string(value.testCaseId, 100), testCategory: ['standardized', 'projective', 'other'].includes(value.testCategory) ? value.testCategory : '',
    groupName: string(value.groupName, 200), groupCategory: ['unstructured', 'structured', 'other'].includes(value.groupCategory) ? value.groupCategory : '', groupRole: ['leader', 'co-leader', 'participant'].includes(value.groupRole) ? value.groupRole : '',
    supervisor: string(value.supervisor, 100), age: value.age === '' || value.age == null ? '' : Number(value.age),
    gender: string(value.gender, 20), youth: value.youth === true,
    participantIds: [...new Set((Array.isArray(value.participantIds) ? value.participantIds : String(value.participantIds || '').split(/[,\n]/)).map(v => string(v, 100)).filter(Boolean))],
    recognition: { center: confirmation(value.recognition?.center), supervisor: confirmation(value.recognition?.supervisor) },
    targets: { kcp: value.targets?.kcp !== false, kca: value.targets?.kca !== false, military: value.targets?.military !== false },
    note: string(value.note), needsReview: value.needsReview === true,
    sourceReservationId: string(value.sourceReservationId, 200), _revision: string(value._revision, 150),
  };
}
export function validateRecord(value, { stored = false, allowUnreviewed = false } = {}) {
  if (!object(value)) return '활동 기록의 형식이 올바르지 않습니다.';
  if (!isDate(value.date)) return '실제 진행 날짜를 확인해 주세요.';
  if (!ACTIVITIES.some(a => a.id === value.activity)) return '활동 종류를 선택해 주세요.';
  if (!['face', 'remote', 'phone'].includes(value.format)) return '진행 방식을 선택해 주세요.';
  if (!['done', 'planned', 'cancelled'].includes(value.status)) return '진행 상태를 선택해 주세요.';
  if (!textValue(value.institution, 200) || !value.institution.trim()) return '진행 기관을 입력해 주세요.';
  for (const [key, label] of [['sessions', '횟수'], ['participants', '참여 인원 누계'], ['minutes', '총 진행 분']]) {
    const min = allowUnreviewed && key === 'minutes' ? 0 : 1;
    if (!numeric(value[key], { stored, min })) return `${label}은 ${min}~1,000,000 사이의 정수로 입력해 주세요.`;
  }
  const limits = { id: 150, caseId: 100, testName: 200, testCaseId: 100, groupName: 200, supervisor: 100, gender: 20, note: 2000, sourceReservationId: 200, _revision: 150 };
  for (const [key, max] of Object.entries(limits)) if (value[key] !== undefined && !textValue(value[key], max)) return '활동 기록의 문자 항목과 길이를 확인해 주세요.';
  for (const [key, options] of Object.entries({ testCategory: ['', 'standardized', 'projective', 'other'], groupCategory: ['', 'unstructured', 'structured', 'other'], groupRole: ['', 'leader', 'co-leader', 'participant'] })) {
    if (value[key] !== undefined && !options.includes(value[key])) return '검사·집단 분류를 확인해 주세요.';
  }
  for (const key of ['needsReview', 'youth', '_conflict']) if (value[key] !== undefined && typeof value[key] !== 'boolean') return '활동 기록의 확인 표시 형식이 올바르지 않습니다.';
  if (stored && (typeof value.needsReview !== 'boolean' || typeof value.youth !== 'boolean')) return '저장된 활동의 확인 표시가 누락되었습니다.';
  if (value.age !== '' && value.age != null && !numeric(value.age, { stored, max: 120 })) return '상담 당시 나이를 확인해 주세요.';
  if (value.participantIds !== undefined && (!Array.isArray(value.participantIds) || value.participantIds.length > 1000 || value.participantIds.some(id => !textValue(id, 100)))) return '참여자 코드는 문자 목록으로 입력해 주세요.';
  const participantIds = (value.participantIds || []).map(id => id.trim()).filter(Boolean), distinctIds = new Set(participantIds);
  if (stored && (!Array.isArray(value.participantIds) || participantIds.length !== value.participantIds.length || distinctIds.size !== participantIds.length)) return '저장된 참여자 코드에 빈 값 또는 중복이 있습니다.';
  if (distinctIds.size > Number(value.participants)) return '참여자 코드 수가 참여 인원 누계보다 많습니다.';
  if (!object(value.targets) || ['kcp', 'kca', 'military'].some(key => typeof value.targets[key] !== 'boolean') || Object.keys(value.targets).some(key => !['kcp', 'kca', 'military'].includes(key))) return '인정 대상 선택을 확인해 주세요.';
  if (!object(value.recognition) || Object.keys(value.recognition).some(key => !['center', 'supervisor'].includes(key))) return '인정 확인 항목의 형식이 올바르지 않습니다.';
  for (const key of ['center', 'supervisor']) {
    const item = value.recognition[key];
    if (!object(item) || !['pending', 'requested', 'approved'].includes(item.status)
      || Object.keys(item).some(name => !['status', 'confirmedOn', 'evidence', 'approver'].includes(name))) return '인정 확인 상태를 확인해 주세요.';
    for (const [name, max] of [['confirmedOn', 10], ['evidence', 2000], ['approver', 100]]) if (item[name] !== undefined && !textValue(item[name], max)) return '인정 확인 정보의 형식과 길이를 확인해 주세요.';
    if (item.confirmedOn && !isDate(item.confirmedOn)) return '확인받은 날짜를 확인해 주세요.';
    if (item.status === 'approved' && (!item.confirmedOn || !item.approver?.trim())) return '확인 완료에는 확인자와 확인일을 입력해 주세요.';
    if (item.evidence && !evidenceUrl(item.evidence)) return '증빙은 올바른 http 또는 https 링크를 입력해 주세요.';
  }
  return null;
}
export function isRecognized(record, target) {
  if (target === 'performed') return true;
  return !!record.targets?.[target] && record.recognition?.[target === 'kcp' ? 'supervisor' : 'center']?.status === 'approved';
}
function countPeople(records) {
  const ids = new Set(); let unknownPeople = 0, attendance = 0, uncertainPeopleRecords = 0;
  for (const r of records) {
    attendance += r.participants;
    if (r.participantIds?.length) {
      r.participantIds.forEach(id => ids.add(id));
      // A list of codes does not prove that every listed person attended every session.
      const unassigned = Math.max(0, r.participants - r.participantIds.length);
      unknownPeople += unassigned;
      if (unassigned) uncertainPeopleRecords++;
    } else if (r.caseId && r.activity !== 'group' && r.activity !== 'supervision') {
      ids.add(r.caseId);
      const unassigned = Math.max(0, r.participants - r.sessions);
      unknownPeople += unassigned;
      if (unassigned) uncertainPeopleRecords++;
    } else { unknownPeople += r.participants; uncertainPeopleRecords++; }
  }
  // unknownPeople is unassigned attendance, not an estimate of additional unique people.
  return { people: ids.size, unknownPeople, attendance, peopleExact: uncertainPeopleRecords === 0, uncertainPeopleRecords };
}
export function summarize(records, { from = '', to = '', target = 'performed', activity = '' } = {}) {
  const period = records.filter(r => (!from || r.date >= from) && (!to || r.date <= to) && (!activity || r.activity === activity));
  const selected = period.filter(r => r.status === 'done' && !r.needsReview && !r._conflict && isRecognized(r, target));
  const sum = list => ({ sessions: list.reduce((s, r) => s + r.sessions, 0), minutes: list.reduce((s, r) => s + r.minutes, 0), ...countPeople(list) });
  return { ...sum(selected), records: selected, pending: period.filter(r => r.status === 'done' && (r.needsReview || r._conflict || (target !== 'performed' && !isRecognized(r, target)))).length,
    byActivity: ACTIVITIES.map(a => ({ ...a, ...sum(selected.filter(r => r.activity === a.id)) })) };
}
export function createEvent(entityType, entityId, payload, baseRevision = '') {
  const id = globalThis.crypto.randomUUID();
  return { id, entityId, entityType, baseRevision: baseRevision || null, createdAt: new Date().toISOString(), payload: JSON.parse(JSON.stringify(payload)) };
}
export function validateProfile(value) {
  if (!object(value)) return '자격·경력 정보의 형식이 올바르지 않습니다.';
  const allowed = ['degreePath', 'school', 'major', 'degreeDate', 'qualifications', 'employments', 'documents', 'training', 'militaryCareer', 'recognizedMonths', '_revision', '_conflict', '_resolves'];
  if (Object.keys(value).some(key => !allowed.includes(key))) return '자격·경력 정보에 알 수 없는 항목이 있습니다.';
  if (value.degreePath !== undefined && !['', 'experience', 'bachelor', 'master'].includes(value.degreePath)) return '학력·경력 기본 경로를 확인해 주세요.';
  for (const [key, max] of [['school', 200], ['major', 200], ['training', 2000], ['militaryCareer', 2000], ['_revision', 150]]) if (value[key] !== undefined && !textValue(value[key], max)) return '자격·경력 문자 항목의 형식과 길이를 확인해 주세요.';
  if (value.degreeDate !== undefined && value.degreeDate !== '' && !isDate(value.degreeDate)) return '학위 취득일을 확인해 주세요.';
  if (value.recognizedMonths !== undefined && value.recognizedMonths !== '' && !numeric(value.recognizedMonths)) return '확인받은 경력은 0 이상의 개월 수로 입력해 주세요.';
  if (value._conflict !== undefined && typeof value._conflict !== 'boolean') return '자격·경력 확인 표시의 형식이 올바르지 않습니다.';
  for (const key of ['qualifications', 'employments']) {
    if (value[key] === undefined) continue;
    if (!Array.isArray(value[key]) || value[key].length > 1000) return '자격증·기관 경력은 목록으로 입력해 주세요.';
    const ids = new Set();
    for (const row of value[key]) {
      if (!object(row) || !identifier(row.id) || ids.has(row.id)) return '자격증·기관 경력의 식별자가 없거나 중복되었습니다.';
      ids.add(row.id);
      const fields = key === 'qualifications' ? ['id', 'name', 'issuer', 'date', 'evidence'] : ['id', 'institution', 'role', 'from', 'to', 'hours', 'evidence'];
      if (Object.keys(row).some(name => !fields.includes(name))) return '자격증·기관 경력에 알 수 없는 항목이 있습니다.';
      for (const name of fields.filter(name => !['id', 'hours'].includes(name))) {
        if (!textValue(row[name], name === 'evidence' ? 2000 : ['from', 'to', 'date'].includes(name) ? 10 : 200)) return '자격증·기관 경력의 문자 정보를 확인해 주세요.';
      }
      if (row.evidence && !evidenceUrl(row.evidence)) return '자격·경력 증빙은 올바른 http 또는 https 링크를 입력해 주세요.';
      if (key === 'qualifications' && row.date && !isDate(row.date)) return '자격증 취득일을 확인해 주세요.';
      if (key === 'employments') {
        if (!row.institution.trim() || !isDate(row.from) || (row.to && (!isDate(row.to) || row.to < row.from))) return '경력의 기관명과 시작·종료일을 확인해 주세요.';
        if (row.hours !== '' && !numeric(row.hours, { integer: false })) return '경력 시간은 0 이상의 숫자로 입력해 주세요.';
      }
    }
  }
  if (value.documents !== undefined) {
    if (!object(value.documents) || Object.keys(value.documents).length > 1000) return '기관별 증빙 준비 정보의 형식이 올바르지 않습니다.';
    for (const [key, item] of Object.entries(value.documents)) {
      if (!key || key.length > 300 || !object(item) || Object.keys(item).some(name => !['stamped', 'detail', 'caseId', 'evidence'].includes(name))) return '기관별 증빙 준비 항목을 확인해 주세요.';
      for (const name of ['stamped', 'detail']) if (item[name] !== undefined && typeof item[name] !== 'boolean') return '기관별 증빙 준비 표시는 확인 또는 미확인으로 저장해 주세요.';
      if (item.caseId !== undefined && !textValue(item.caseId, 100)) return '대표 사례코드를 확인해 주세요.';
      if (item.evidence !== undefined && (!textValue(item.evidence) || (item.evidence && !evidenceUrl(item.evidence)))) return '기관 증빙은 올바른 http 또는 https 링크를 입력해 주세요.';
    }
  }
  return null;
}
function safeJSON(value, depth = 0, ancestors = new Set()) {
  if (depth > 16) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= 16000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
  if ((!Array.isArray(value) && !object(value)) || ancestors.has(value) || Object.keys(value).length > 1000) return false;
  ancestors.add(value);
  const valid = Object.entries(value).every(([key, item]) => key.length <= 300 && !['__proto__', 'prototype', 'constructor'].includes(key) && safeJSON(item, depth + 1, ancestors));
  ancestors.delete(value); return valid;
}
export function validateEvent(event) {
  if (!object(event) || Object.keys(event).some(key => !['id', 'entityId', 'entityType', 'baseRevision', 'createdAt', 'payload'].includes(key))
    || !['record', 'profile'].includes(event.entityType) || !identifier(event.id) || !identifier(event.entityId)
    || (event.baseRevision != null && !identifier(event.baseRevision))
    || typeof event.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(event.createdAt)
    || !isDate(event.createdAt.slice(0, 10)) || !Number.isFinite(Date.parse(event.createdAt))
    || !object(event.payload) || !safeJSON(event) || new TextEncoder().encode(JSON.stringify(event)).length > 16000) return '복구할 기록의 형식이 올바르지 않습니다.';
  if (event.baseRevision === event.id) return '변경 기록이 자기 자신을 이전 버전으로 참조합니다.';
  const resolves = event.payload._resolves;
  if (resolves !== undefined && (!Array.isArray(resolves) || resolves.length > 1000 || resolves.some(id => !identifier(id) || id === event.id) || new Set(resolves).size !== resolves.length)) return '충돌 해결에 참조한 변경 목록이 올바르지 않습니다.';
  if (event.entityType === 'profile') {
    if (event.entityId !== 'profile') return '자격·경력 정보의 식별자가 올바르지 않습니다.';
    return validateProfile(event.payload);
  }
  if (event.payload.deleted !== undefined && typeof event.payload.deleted !== 'boolean') return '기록 삭제 표시의 형식이 올바르지 않습니다.';
  if (event.payload.deleted === true) {
    if (Object.keys(event.payload).some(key => !['deleted', '_resolves'].includes(key))) return '삭제 이력에 알 수 없는 항목이 있습니다.';
  } else {
    const allowed = ['id', 'date', 'caseId', 'activity', 'sessions', 'participants', 'minutes', 'institution', 'format', 'status', 'testName', 'testCaseId', 'testCategory', 'groupName', 'groupCategory', 'groupRole', 'supervisor', 'age', 'gender', 'youth', 'participantIds', 'recognition', 'targets', 'note', 'needsReview', 'sourceReservationId', '_revision', '_resolves', 'deleted'];
    if (Object.keys(event.payload).some(key => !allowed.includes(key))) return '저장된 활동에 알 수 없는 항목이 있습니다.';
    if (event.payload.id !== event.entityId) return '기록 식별자가 일치하지 않습니다.';
    return validateRecord(event.payload, { stored: true, allowUnreviewed: event.payload.needsReview === true });
  }
  return null;
}
export function eventGraphProblems(events) {
  const byId = new Map(events.map(event => [event.id, event])), problems = new Map(), edges = new Map();
  for (const event of events) {
    const references = [...new Set([event.baseRevision, ...(event.payload._resolves || [])].filter(Boolean))];
    edges.set(event.id, references.filter(id => byId.has(id)));
    for (const id of references) {
      const previous = byId.get(id);
      if (previous && (previous.entityId !== event.entityId || previous.entityType !== event.entityType)) problems.set(event.id, '다른 활동 또는 자격 정보의 변경을 이전 버전으로 참조합니다.');
    }
  }
  // Iterative DFS keeps long, valid histories from overflowing the JavaScript stack.
  const state = new Map();
  for (const event of events) {
    if (state.has(event.id)) continue;
    const stack = [{ id: event.id, next: 0 }], positions = new Map([[event.id, 0]]);
    state.set(event.id, 1);
    while (stack.length) {
      const frame = stack.at(-1), refs = edges.get(frame.id);
      if (frame.next === refs.length) { state.set(frame.id, 2); positions.delete(frame.id); stack.pop(); continue; }
      const id = refs[frame.next++];
      if (state.get(id) === 1) {
        for (let i = positions.get(id); i < stack.length; i++) problems.set(stack[i].id, '변경 기록의 이전 버전 참조가 순환합니다.');
      } else if (!state.has(id)) { state.set(id, 1); positions.set(id, stack.length); stack.push({ id, next: 0 }); }
    }
  }
  return problems;
}
export function mergeEvents(...lists) {
  const all = new Map();
  for (const event of lists.flat()) {
    const problem = validateEvent(event); if (problem) throw new Error(problem);
    const old = all.get(event.id);
    if (old && stableEvent(old) !== stableEvent(event)) throw new Error('동일한 변경 ID에 서로 다른 내용이 있습니다. 원본을 확인해 주세요.');
    all.set(event.id, event);
  }
  const events = [...all.values()], problems = eventGraphProblems(events);
  if (problems.size) throw new Error(problems.values().next().value);
  return events.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
export const canonicalJSON = value => Array.isArray(value) ? `[${value.map(canonicalJSON).join(',')}]` : value !== null && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(',')}}` : JSON.stringify(value);
export const stableEvent = value => canonicalJSON({ ...value, baseRevision: value.baseRevision || null });
export function recordsFor(events) {
  const groups = new Map();
  for (const e of mergeEvents(events)) { const key = `${e.entityType}:${e.entityId}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(e); }
  const records = [], conflicts = []; let profile = {};
  for (const list of groups.values()) {
    const superseded = new Set(list.flatMap(e => [e.baseRevision, ...(Array.isArray(e.payload._resolves) ? e.payload._resolves : [])]).filter(Boolean));
    const versions = list.filter(e => !superseded.has(e.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const last = versions.at(-1); if (!last) continue;
    if (versions.length > 1) conflicts.push({ entityId: last.entityId, entityType: last.entityType, versions });
    if (last.entityType === 'profile') profile = { ...last.payload, _revision: last.id, _conflict: versions.length > 1 };
    else if (!last.payload.deleted) records.push({ ...normalizeRecord(last.payload), _revision: last.id, _conflict: versions.length > 1 });
  }
  records.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return { records, profile, conflicts };
}
export function csvRecords(records) {
  const labels = Object.fromEntries(ACTIVITIES.map(a => [a.id, a.label]));
  const status = { pending: '미확인', requested: '확인 요청', approved: '확인 완료' };
  const rows = [['진행일', '사례코드', '활동', '횟수', '참여 인원 누계', '총 진행 분', '기관', '진행방식', '진행상태', '센터 확인', '센터 확인자', '센터 확인일', '센터 증빙', '수퍼바이저 확인', '수퍼바이저', '수퍼바이저 확인일', '수퍼바이저 증빙', '검사명', '비고']];
  for (const r of records) rows.push([r.date, r.caseId, labels[r.activity], r.sessions, r.participants, r.minutes, r.institution, { face: '대면', remote: '비대면', phone: '전화' }[r.format], { done: '완료', planned: '예정', cancelled: '취소' }[r.status], status[r.recognition.center.status], r.recognition.center.approver, r.recognition.center.confirmedOn, r.recognition.center.evidence, status[r.recognition.supervisor.status], r.recognition.supervisor.approver, r.recognition.supervisor.confirmedOn, r.recognition.supervisor.evidence, r.testName, r.note]);
  const cell = v => `"${String(v ?? '').replace(/^[=+@-]/, "'$&").replaceAll('"', '""')}"`;
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}
