import { findApprovalItem } from './performanceApprovalCatalog.mjs';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 2000) => typeof value === 'string' ? value.slice(0, max).trim() : '';
const validText = (value, max) => typeof value === 'string' && value.length <= max;
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-][A-Za-z0-9_.:-]{0,149}$/.test(value);
export const isScheduleDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !value.startsWith('0000') && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export const nextScheduleDate = value => new Date(Date.parse(`${value}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
export const localScheduleDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export function normalizeSchedule(raw = {}) {
  const c = object(raw.calendar) ? raw.calendar : {};
  return { id: text(raw.id, 150), title: text(raw.title, 300), date: text(raw.date, 10), endDate: text(raw.endDate, 10), start: text(raw.start, 5), end: text(raw.end, 5), allDay: raw.allDay === true,
    place: text(raw.place, 300), format: ['face', 'remote', 'phone'].includes(raw.format) ? raw.format : 'face', target: ['', 'kcp', 'kca'].includes(raw.target) ? raw.target : '', itemId: text(raw.itemId, 150), supervisorId: text(raw.supervisorId, 150), supervisorName: text(raw.supervisorName, 100), note: text(raw.note),
    status: ['planned', 'done', 'cancelled'].includes(raw.status) ? raw.status : 'planned', recordId: text(raw.recordId, 150), approvalId: text(raw.approvalId, 150),
    calendar: { calendarId: text(c.calendarId, 300), eventId: text(c.eventId, 1024), etag: text(c.etag, 300), state: ['local', 'pending', 'synced', 'error', 'conflict'].includes(c.state) ? c.state : 'local', action: c.action === 'delete' ? 'delete' : 'upsert', revision: Number.isInteger(c.revision) && c.revision >= 0 ? c.revision : 0, error: text(c.error, 1000), baseFingerprint: text(c.baseFingerprint, 4000), remote: object(c.remote) ? c.remote : null, remoteCancelled: c.remoteCancelled === true, recurringEventId: text(c.recurringEventId, 1024) },
    ...(raw._revision ? { _revision: text(raw._revision, 150) } : {}), ...(raw._conflict === true ? { _conflict: true } : {}) };
}
export function validateSchedule(s) {
  if (!object(s) || !id(s.id)) return '수련 일정의 식별자를 확인해 주세요.';
  const allowed = ['id','title','date','endDate','start','end','allDay','place','format','target','itemId','supervisorId','supervisorName','note','status','recordId','approvalId','calendar','_revision','_conflict','_resolves'];
  if (Object.keys(s).some(key => !allowed.includes(key))) return '수련 일정에 알 수 없는 항목이 있습니다.';
  for (const [key,max] of [['title',300],['place',300],['supervisorName',100],['note',2000]]) if (!validText(s[key],max)) return '수련 일정의 제목·장소·메모 길이를 확인해 주세요.';
  if (!s.title.trim() || !isScheduleDate(s.date) || !isScheduleDate(s.endDate) || typeof s.allDay !== 'boolean') return '수련 일정의 제목과 날짜를 입력해 주세요.';
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (s.allDay ? s.endDate <= s.date || s.start !== '' || s.end !== '' : !time.test(s.start) || !time.test(s.end) || `${s.endDate}T${s.end}` <= `${s.date}T${s.start}`) return '종료 일시는 시작 일시보다 늦어야 합니다.';
  if ((Date.parse(s.endDate) - Date.parse(s.date)) / 86400000 > 366) return '하나의 수련 일정은 1년 이내로 설정해 주세요.';
  if (!['','kcp','kca'].includes(s.target) || !['planned','done','cancelled'].includes(s.status) || !['face','remote','phone'].includes(s.format)) return '일정의 학회와 진행 상태·방식을 확인해 주세요.';
  for (const key of ['itemId','supervisorId','recordId','approvalId']) if (s[key] !== '' && !id(s[key])) return '일정의 연결 항목 식별자를 확인해 주세요.';
  if (!!s.target !== !!s.itemId) return '학회와 수련 항목을 함께 선택해 주세요.';
  if (s.target && findApprovalItem(s.itemId)?.scheme !== s.target) return '학회에 맞는 수련 항목을 선택해 주세요.';
  if ((s._revision !== undefined && !id(s._revision)) || (s._conflict !== undefined && typeof s._conflict !== 'boolean')) return '일정 변경 식별자가 올바르지 않습니다.';
  const c = s.calendar;
  if (!object(c) || Object.keys(c).some(key => !['calendarId','eventId','etag','state','action','revision','error','baseFingerprint','remote','remoteCancelled','recurringEventId'].includes(key))) return '캘린더 연결 정보의 형식이 올바르지 않습니다.';
  for (const [key,max] of [['calendarId',300],['eventId',1024],['etag',300],['error',1000],['baseFingerprint',4000],['recurringEventId',1024]]) if (!validText(c[key],max)) return '캘린더 연결 정보의 길이를 확인해 주세요.';
  if (!['local','pending','synced','error','conflict'].includes(c.state) || !['upsert','delete'].includes(c.action) || !Number.isInteger(c.revision) || c.revision < 0 || typeof c.remoteCancelled !== 'boolean' || (c.remote !== null && !object(c.remote))) return '캘린더 동기화 상태를 확인해 주세요.';
  return null;
}
export function scheduleFields(s) {
  return { title: s.title, date: s.date, endDate: s.endDate, start: s.start, end: s.end, allDay: s.allDay, place: s.place, target: s.target || '', itemId: s.itemId || '' };
}
export const scheduleFingerprint = s => JSON.stringify(scheduleFields(s));
export const scheduleMinutes = s => s.allDay ? 0 : Math.round((Date.parse(`${s.endDate}T${s.end}:00+09:00`) - Date.parse(`${s.date}T${s.start}:00+09:00`)) / 60000);
export function scheduleGoogleEvent(s) {
  const error = validateSchedule(s); if (error) throw new Error(error);
  return { summary: s.title, location: s.place,
    start: s.allDay ? { date: s.date } : { dateTime: `${s.date}T${s.start}:00+09:00`, timeZone: 'Asia/Seoul' },
    end: s.allDay ? { date: s.endDate } : { dateTime: `${s.endDate}T${s.end}:00+09:00`, timeZone: 'Asia/Seoul' },
    extendedProperties: { private: { trainingScheduleId: s.id, target: s.target, itemId: s.itemId } } };
}
async function digest(value) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(x => x.toString(16).padStart(2,'0')).join(''); }
export const scheduleGoogleId = async id => 'a1' + await digest(`workboard:training:${id}`);
export const scheduleImportedId = async (calendarId, eventId) => 'gcal:' + await digest(`${calendarId}:${eventId}`);
function remotePart(value) {
  if (isScheduleDate(value?.date)) return { date: value.date, time: '', allDay: true };
  if (typeof value?.dateTime !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(value.dateTime) || !Number.isFinite(Date.parse(value.dateTime))) throw new Error('구글 일정의 날짜를 확인하지 못했습니다.');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value.dateTime)).map(p => [p.type,p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, allDay: false };
}
export function scheduleFromGoogle(remote, previous, calendarId, localId) {
  if (!object(remote) || typeof remote.id !== 'string' || !remote.id || remote.id.length > 1024) throw new Error('구글 일정의 식별자를 확인하지 못했습니다.');
  if (remote.status === 'cancelled') return previous ? normalizeSchedule({ ...previous, status: previous.status === 'done' ? 'done' : 'cancelled', calendar: { ...previous.calendar, calendarId, state: 'synced', remoteCancelled: true, remote: null, error: '', etag: remote.etag || previous.calendar.etag } }) : null;
  const start = remotePart(remote.start), end = remotePart(remote.end);
  if (start.allDay !== end.allDay || typeof remote.etag !== 'string' || !remote.etag) throw new Error('구글 일정의 버전 또는 시간을 확인하지 못했습니다.');
  const meta = remote.extendedProperties?.private || {};
  const validItem = findApprovalItem(meta.itemId)?.scheme === meta.target;
  const result = normalizeSchedule({ ...previous, id: previous?.id || localId, title: remote.summary || '제목 없는 수련 일정', date: start.date, endDate: end.date, start: start.time, end: end.time, allDay: start.allDay, place: remote.location || '',
    target: previous?.target || (validItem ? meta.target : ''), itemId: previous?.itemId || (validItem ? meta.itemId : ''),
    status: previous?.status === 'done' ? 'done' : 'planned', calendar: { ...previous?.calendar, calendarId, eventId: remote.id, etag: remote.etag, state: 'synced', action: 'upsert', error: '', remote: null, remoteCancelled: false, recurringEventId: remote.recurringEventId || '' } });
  result.calendar.baseFingerprint = scheduleFingerprint(result);
  const error = validateSchedule(result); if (error) throw new Error(error);
  return result;
}
export function prepareSchedule(raw, previous, calendarId = '') {
  const next = normalizeSchedule(raw), error = validateSchedule(next); if (error) throw new Error(error);
  if (previous) { next.id = previous.id; next.recordId = previous.recordId; next.approvalId = previous.approvalId; next.status = previous.status; next._revision = previous._revision; }
  const changed = !previous || scheduleFingerprint(next) !== scheduleFingerprint(previous);
  if (changed) next.calendar = { ...next.calendar, calendarId: previous?.calendar.calendarId || calendarId, state: calendarId || previous?.calendar.calendarId ? 'pending' : 'local', action: 'upsert', revision: (previous?.calendar.revision || 0) + 1, error: '', remote: null, remoteCancelled: false };
  return next;
}
export function scheduleInWindow(s, from, to) { return s.date <= to && (s.endDate > from || (!s.allDay && s.endDate === from && s.end !== '00:00')); }
