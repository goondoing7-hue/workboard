import { reservationStatus } from './counselingDomain.mjs';
import { createEvent, isDate, normalizeRecord, validateRecord, recordsFor, mergeEvents } from './performanceDomain.mjs';

export const WORKBOARD_SNAPSHOT_FORMAT = 'workboard-performance-snapshot';
export const WORKBOARD_SNAPSHOT_VERSION = 1;
const MAX_RECORDS = 50000;
const MAX_BYTES = 10 * 1024 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exactKeys = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const sourceId = value => typeof value === 'string' && /^[A-Za-z0-9_-][A-Za-z0-9_.:-]{0,139}$/.test(value);
const caseCode = value => typeof value === 'string' && (value === '' || /^C-[A-Za-z0-9_-][A-Za-z0-9_.:-]{0,97}$/.test(value));
const isoTime = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && isDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
const fail = message => { throw new Error(message); };
const idText = value => typeof value === 'string' ? value : Number.isSafeInteger(value) && value >= 0 ? String(value) : '';
function boardData(input) {
  let value = input;
  // The board export can wrap its JSON in `data`; encrypted local storage must
  // instead be unlocked by the board and supplied from its in-memory state.
  for (let depth = 0; depth < 5; depth++) {
    if (typeof value === 'string') {
      if (value.length > 50 * 1024 * 1024) fail('업무보드 데이터가 너무 큽니다. 업무보드 화면에서 완료 상담을 연결해 주세요.');
      try { value = JSON.parse(value); } catch { fail('업무보드 데이터를 읽을 수 없습니다. 정상적인 업무보드 자료를 선택해 주세요.'); }
      continue;
    }
    if (!object(value)) fail('업무보드 자료의 형식이 올바르지 않습니다.');
    if (value.enc === 1 || value.encrypted === true || value.locked === true) fail('업무보드 자료가 잠겨 있습니다. 업무보드에서 잠금을 해제한 뒤 완료 상담을 연결해 주세요.');
    if (Object.hasOwn(value, 'resv')) {
      if (!Array.isArray(value.resv) || value.resv.length > MAX_RECORDS) fail('업무보드 상담 예약 목록의 형식이나 크기를 확인해 주세요.');
      return value;
    }
    if (Object.hasOwn(value, 'data')) { value = value.data; continue; }
    fail('업무보드 자료에서 상담 예약 목록을 찾을 수 없습니다.');
  }
  fail('업무보드 자료의 중첩 형식을 확인해 주세요.');
}
function timeMinutes(value) {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hours, minutes] = value.split(':').map(Number); return hours * 60 + minutes;
}
function reservationMinutes(reservation) {
  // Current reservations use start/end. Only genuinely older records fall back
  // to time/endTime; an explicitly empty or invalid current time stays unknown.
  const currentFields = Object.hasOwn(reservation, 'start') || Object.hasOwn(reservation, 'end');
  const start = timeMinutes(currentFields ? reservation.start : reservation.time);
  const end = timeMinutes(currentFields ? reservation.end : reservation.endTime);
  return start !== null && end !== null && end > start ? end - start : 0;
}
function reservationFormat(reservation) {
  if (reservation.method === '대면') return 'face';
  if (reservation.method === '전화') return 'phone';
  if (['온라인', '비대면', '화상'].includes(reservation.method)) return 'remote';
  if (reservation.format === 'phone') return 'phone';
  if (reservation.format === 'remote' || reservation.remote === true || reservation.place === 'meet') return 'remote';
  return 'face';
}
export function createWorkboardSnapshot(input, { exportedAt = new Date().toISOString() } = {}) {
  const data = boardData(input), records = [], seen = new Set();
  for (const reservation of data.resv) {
    if (!object(reservation)) fail('업무보드 상담 예약 중 형식이 올바르지 않은 항목이 있습니다.');
    if (reservationStatus({ ...reservation, done: reservation.done === true }) !== 'done') continue;
    const id = idText(reservation.id);
    if (!sourceId(id)) fail('완료 상담의 예약 ID가 없거나 올바르지 않습니다. 업무보드에서 해당 예약을 확인해 주세요.');
    if (seen.has(id)) fail('완료 상담에 동일한 예약 ID가 중복되어 있습니다. 업무보드에서 중복 예약을 확인해 주세요.');
    if (!isDate(reservation.date)) fail('완료 상담 중 날짜가 올바르지 않은 항목이 있습니다. 업무보드에서 날짜를 확인해 주세요.');
    const clientId = idText(reservation.clientId), code = clientId ? `C-${clientId}` : '';
    if (!caseCode(code)) fail('완료 상담의 내담자 연결 ID가 올바르지 않습니다. 업무보드에서 연결 정보를 확인해 주세요.');
    // No names, contacts, dates of birth, demographic data, memos, journals,
    // attachments, location strings, or free-form counseling types cross over.
    records.push({ source: { id }, date: reservation.date, caseId: code, minutes: reservationMinutes(reservation), format: reservationFormat(reservation) });
    seen.add(id);
  }
  records.sort((a, b) => a.date.localeCompare(b.date) || a.source.id.localeCompare(b.source.id));
  const snapshot = { format: WORKBOARD_SNAPSHOT_FORMAT, version: WORKBOARD_SNAPSHOT_VERSION, exportedAt, complete: true, records };
  const error = validateWorkboardSnapshot(snapshot); if (error) fail(error);
  return snapshot;
}
export function validateWorkboardSnapshot(snapshot) {
  if (!exactKeys(snapshot, ['format', 'version', 'exportedAt', 'complete', 'records']) || snapshot.format !== WORKBOARD_SNAPSHOT_FORMAT || snapshot.version !== WORKBOARD_SNAPSHOT_VERSION || snapshot.complete !== true || !isoTime(snapshot.exportedAt)) return '업무보드 완료 상담 연결 자료의 형식이 올바르지 않습니다.';
  if (!Array.isArray(snapshot.records) || snapshot.records.length > MAX_RECORDS) return '완료 상담 연결 목록의 형식이나 크기를 확인해 주세요.';
  const seen = new Set();
  for (const row of snapshot.records) {
    if (!exactKeys(row, ['source', 'date', 'caseId', 'minutes', 'format']) || !exactKeys(row.source, ['id']) || !sourceId(row.source.id) || !isDate(row.date) || !caseCode(row.caseId)
      || !Number.isInteger(row.minutes) || row.minutes < 0 || row.minutes > 1439 || !['face', 'remote', 'phone'].includes(row.format)) return '완료 상담 연결 항목에 허용되지 않는 내용이나 잘못된 값이 있습니다.';
    if (seen.has(row.source.id)) return '완료 상담 연결 목록에 같은 예약 ID가 중복되어 있습니다.';
    seen.add(row.source.id);
  }
  if (new TextEncoder().encode(JSON.stringify(snapshot)).length > MAX_BYTES) return '완료 상담 연결 자료가 너무 큽니다.';
  return null;
}
export function parseWorkboardSnapshot(input) {
  let snapshot = input;
  if (typeof input === 'string') {
    if (input.length > MAX_BYTES) fail('완료 상담 연결 자료가 너무 큽니다.');
    try { snapshot = JSON.parse(input); } catch { fail('완료 상담 연결 자료를 읽을 수 없습니다.'); }
  }
  const error = validateWorkboardSnapshot(snapshot); if (error) fail(error);
  return { format: snapshot.format, version: snapshot.version, exportedAt: snapshot.exportedAt, complete: true,
    records: snapshot.records.map(row => ({ source: { id: row.source.id }, date: row.date, caseId: row.caseId, minutes: row.minutes, format: row.format })) };
}
export function planWorkboardImport(input, existingEvents = []) {
  const snapshot = parseWorkboardSnapshot(input), verified = mergeEvents(existingEvents), state = recordsFor(verified);
  const historical = new Set(verified.filter(event => event.entityType === 'record').map(event => event.entityId));
  const current = new Map(state.records.map(record => [record.id, record]));
  const sourceIds = new Set(snapshot.records.map(row => row.source.id));
  const records = [], events = [], differences = []; let skipped = 0, deleted = 0;
  for (const row of snapshot.records) {
    const id = `workboard:${row.source.id}`, existing = current.get(id);
    if (historical.has(id)) {
      skipped++;
      if (!existing) { deleted++; continue; }
      // A difference can be an intentional correction made in either app.
      // Present it for review; never overwrite counts, notes, or confirmations.
      const fields = ['date', 'caseId', 'minutes', 'format'].filter(key => (key !== 'minutes' || row.minutes > 0) && (key !== 'caseId' || row.caseId) && existing[key] !== row[key]);
      if (fields.length || existing._conflict) differences.push({ id, sourceId: row.source.id, fields, existingRevision: existing._revision, conflict: existing._conflict === true,
        suggested: { date: row.date, caseId: row.caseId, minutes: row.minutes, format: row.format } });
      continue;
    }
    const record = normalizeRecord({ id, date: row.date, caseId: row.caseId, activity: 'individual', sessions: 1, participants: 1, minutes: row.minutes,
      institution: '춘천시청소년상담복지센터', format: row.format, status: 'done', needsReview: true, sourceReservationId: row.source.id,
      note: '업무보드 완료 상담에서 가져옴. 실제 활동·시간을 확인한 후 저장해 주세요.' });
    const error = validateRecord(record, { allowUnreviewed: true }); if (error) fail(error);
    delete record._revision;
    records.push(record); events.push(createEvent('record', id, record)); historical.add(id);
  }
  // Absence from a completed-only list does not establish cancellation/deletion.
  // These records remain intact until a user explicitly reviews the difference.
  const missing = state.records.filter(record => record.id.startsWith('workboard:') && record.sourceReservationId && !sourceIds.has(record.sourceReservationId)).map(record => ({ id: record.id, sourceId: record.sourceReservationId, existingRevision: record._revision }));
  return { records, events, imported: records.length, skipped, deleted, differences, missing };
}
