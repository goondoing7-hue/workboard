import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Cloud, ExternalLink, FileCheck2, Info, Loader2, MapPin, Pencil, Plus, RefreshCw, TriangleAlert, X } from 'lucide-react';
import { APPROVAL_ITEMS, APPROVAL_SCHEMES, findApprovalItem } from './performanceApprovalCatalog.mjs';
import { isScheduleDate, localScheduleDate, normalizeSchedule, scheduleInWindow, scheduleMinutes, validateSchedule } from './performanceScheduleDomain.mjs';

const STATUS = { planned: '예정', done: '실적 등록 완료', cancelled: '취소' };
const SYNC = { local: '기기에 저장', pending: 'Google 전송 대기', synced: 'Google 동기화됨', error: 'Google 전송 오류', conflict: 'Google 변경 확인 필요' };
const FORMAT = { face: '대면', remote: '화상', phone: '전화' };
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const num = value => Number(value || 0).toLocaleString('ko-KR');
const shiftDate = (date, amount) => isScheduleDate(date) ? new Date(Date.parse(`${date}T00:00:00Z`) + amount * 86400000).toISOString().slice(0, 10) : '';
const shortDate = date => String(date || '').replaceAll('-', '.');
const schemeName = target => APPROVAL_SCHEMES.find(scheme => scheme.id === target)?.name || '학회 미분류';
const endLabel = schedule => schedule.allDay ? shiftDate(schedule.endDate, -1) : schedule.endDate;
const scheduleTime = schedule => schedule.allDay ? `${shortDate(schedule.date)}${endLabel(schedule) !== schedule.date ? ` ~ ${shortDate(endLabel(schedule))}` : ''} · 종일` : `${shortDate(schedule.date)} ${schedule.start} ~ ${schedule.endDate !== schedule.date ? `${shortDate(schedule.endDate)} ` : ''}${schedule.end}`;
function monthWindow(month) { const first = `${month}-01`; return { from: first, to: new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10) }; }
function moveMonth(month, amount) { return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 1 + amount, 1)).toISOString().slice(0, 7); }
function recentSync(value) { if (!value) return '아직 동기화하지 않음'; const date = new Date(value); return Number.isNaN(date.valueOf()) ? '' : date.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function initialSchedule(date) { return normalizeSchedule({ id: crypto.randomUUID(), title: '', date, endDate: date, start: '09:00', end: '10:00', allDay: false, target: '', itemId: '', status: 'planned', calendar: {} }); }

function Field({ label, children, help, className = '' }) {
  const id = useId();
  return <div className={`perf-field ${className}`}><label htmlFor={id}>{label}</label>{React.cloneElement(children, { id, 'aria-describedby': help ? `${id}-help` : undefined })}{help ? <small id={`${id}-help`}>{help}</small> : null}</div>;
}
function DurationInput({ label, value, onChange }) {
  const amount = Number(value || 0);
  return <fieldset className="ps-duration"><legend>{label}</legend><div><label><input aria-label={`${label} 시간`} type="number" min="0" max="16666" step="1" value={Math.floor(amount / 60)} onChange={event => onChange(Number(event.target.value || 0) * 60 + amount % 60)} /><span>시간</span></label><label><input aria-label={`${label} 분`} type="number" min="0" max="59" step="1" value={amount % 60} onChange={event => onChange(Math.floor(amount / 60) * 60 + Number(event.target.value || 0))} /><span>분</span></label></div></fieldset>;
}

function ScheduleDialog({ schedule, date, store, calendar, onClose, onSaved }) {
  const [draft, setDraft] = useState(() => schedule ? normalizeSchedule(schedule) : initialSchedule(date));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef(null);
  const titleId = useId();
  useEffect(() => { const node = dialog.current; node.showModal(); return () => node.close(); }, []);
  const set = (key, value) => setDraft(previous => ({ ...previous, [key]: value }));
  const items = APPROVAL_ITEMS.filter(item => item.scheme === draft.target);
  const supervisors = (store.supervisors || []).filter(supervisor => supervisor.active !== false && !supervisor._conflict && (!draft.target || supervisor[draft.target]));
  function changeDate(value) {
    setDraft(previous => { const last = endLabel(previous); return { ...previous, date: value, endDate: !last || last < value ? previous.allDay ? shiftDate(value, 1) : value : previous.endDate }; });
  }
  function toggleAllDay(checked) {
    setDraft(previous => ({ ...previous, allDay: checked, endDate: checked ? shiftDate(previous.endDate || previous.date, 1) : shiftDate(previous.endDate, -1), start: checked ? '' : '09:00', end: checked ? '' : '10:00' }));
  }
  function selectSupervisor(id) {
    const supervisor = supervisors.find(candidate => candidate.id === id);
    setDraft(previous => ({ ...previous, supervisorId: id, supervisorName: supervisor?.name || '' }));
  }
  async function save(event) {
    event.preventDefault();
    const validation = validateSchedule(draft);
    if (validation) { setError(validation); return; }
    setBusy(true); setError('');
    try { const result = await calendar.saveSchedule(draft); if (result === false) throw new Error('일정을 저장하지 못했습니다.'); onSaved?.(result); onClose(); }
    catch (failure) { setError(failure.message || '일정을 저장하지 못했습니다. 입력 내용을 유지합니다.'); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="perf-dialog ps-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}><form onSubmit={save}>
    <header className="perf-dialog-head"><div><span className="perf-eyebrow">수련 일정</span><h2 id={titleId}>{schedule ? '일정 수정' : '수련 일정 등록'}</h2></div><button type="button" className="perf-icon-button" aria-label="수련 일정 닫기" onClick={onClose} disabled={busy}><X size={20} /></button></header>
    <div className="perf-dialog-body">{schedule?.status === 'done' ? <div className="perf-note"><Info size={17} /><span>이 일정은 실적으로 등록되었습니다. 일정을 수정해도 실제 진행 기록과 승인내역은 유지됩니다.</span></div> : null}<div className="perf-form-grid">
      <Field className="perf-span-two" label="일정 제목"><input autoFocus required maxLength={300} value={draft.title} onChange={event => set('title', event.target.value)} placeholder="예: 개인상담 수퍼비전 / 사례발표회" /></Field>
      <Field label="학회"><select value={draft.target} onChange={event => setDraft(previous => ({ ...previous, target: event.target.value, itemId: '', supervisorId: '', supervisorName: '' }))}><option value="">나중에 분류</option>{APPROVAL_SCHEMES.map(scheme => <option key={scheme.id} value={scheme.id}>{scheme.name}</option>)}</select></Field>
      <Field label="수련 항목"><select required={Boolean(draft.target)} disabled={!draft.target} value={draft.itemId} onChange={event => set('itemId', event.target.value)}><option value="">항목 선택</option>{items.map(item => <option key={item.id} value={item.id}>{item.section} · {item.label}</option>)}</select></Field>
      <label className="perf-checkbox perf-span-two"><input type="checkbox" checked={draft.allDay} onChange={event => toggleAllDay(event.target.checked)} /><span>종일 일정</span></label>
      <Field label="시작 날짜"><input type="date" required value={draft.date} onChange={event => changeDate(event.target.value)} /></Field>
      <Field label={draft.allDay ? '마지막 날짜 (포함)' : '종료 날짜'}><input type="date" required min={draft.date || undefined} value={endLabel(draft)} onChange={event => set('endDate', draft.allDay ? shiftDate(event.target.value, 1) : event.target.value)} /></Field>
      {!draft.allDay ? <><Field label="시작 시간"><input type="time" required value={draft.start} onChange={event => set('start', event.target.value)} /></Field><Field label="종료 시간"><input type="time" required value={draft.end} onChange={event => set('end', event.target.value)} /></Field></> : null}
      <Field label="장소"><input maxLength={300} value={draft.place} onChange={event => set('place', event.target.value)} placeholder="교육 장소 또는 온라인" /></Field>
      <Field label="진행 방식"><select value={draft.format} onChange={event => set('format', event.target.value)}>{Object.entries(FORMAT).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
      <Field className="perf-span-two" label="수퍼바이저"><select value={draft.supervisorId || ''} onChange={event => selectSupervisor(event.target.value)}><option value="">선택하지 않음</option>{draft.supervisorId && !supervisors.some(supervisor => supervisor.id === draft.supervisorId) ? <option value={draft.supervisorId}>{draft.supervisorName || '기존 수퍼바이저'} · 이전 등록 정보</option> : null}{supervisors.map(supervisor => <option key={supervisor.id} value={supervisor.id}>{supervisor.id === draft.supervisorId && draft.supervisorName ? draft.supervisorName : supervisor.name}{supervisor.affiliation ? ` · ${supervisor.affiliation}` : ''}</option>)}</select></Field>
      <Field className="perf-span-two" label="관리 메모" help="메모와 수퍼바이저 정보는 Google 일정에 전송하지 않습니다."><textarea rows="3" maxLength={2000} value={draft.note} onChange={event => set('note', event.target.value)} placeholder="준비물이나 수련 확인 사항" /></Field>
    </div><p className="perf-field-help ps-help">시간은 한국 시간 기준입니다. 예정 일정은 실적 합계에 포함되지 않습니다. 진행 후 실제 시간을 확인해 실적으로 등록하세요.</p>{error ? <div className="perf-alert perf-alert-error" role="alert"><TriangleAlert size={17} />{error}</div> : null}</div>
    <footer className="perf-dialog-foot"><span /><div><button type="button" className="perf-button" onClick={onClose} disabled={busy}>취소</button><button type="submit" className="perf-button perf-primary" disabled={busy}>{busy ? <Loader2 size={16} className="perf-spin" /> : <Check size={16} />}일정 저장</button></div></footer>
  </form></dialog>;
}

function CompletionDialog({ schedule, calendar, onClose, onSaved }) {
  const item = findApprovalItem(schedule.itemId);
  const [actualMinutes, setActualMinutes] = useState(() => Math.max(0, scheduleMinutes(schedule)));
  const [sessions, setSessions] = useState(1);
  const [participants, setParticipants] = useState(1);
  const [caseCode, setCaseCode] = useState('');
  const [quantities, setQuantities] = useState(() => Object.fromEntries(item.measures.map(measure => [measure.id, measure.id === 'minutes' ? Math.max(0, scheduleMinutes(schedule)) : 0])));
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const titleId = useId();
  const dialog = useRef(null);
  useEffect(() => { const node = dialog.current; node.showModal(); return () => node.close(); }, []);
  async function save(event) {
    event.preventDefault();
    if (!checked) { setError('실제 진행 내용과 수량을 확인해 주세요.'); return; }
    if (!Number.isInteger(Number(actualMinutes)) || Number(actualMinutes) < 1) { setError('실제로 진행한 시간을 1분 이상 입력해 주세요.'); return; }
    if (!Object.values(quantities).some(value => Number(value) > 0)) { setError('승인내역에 등록할 수량을 하나 이상 입력해 주세요.'); return; }
    setBusy(true); setError('');
    try { const result = await calendar.completeSchedule(schedule.id, { quantities, actualMinutes: Number(actualMinutes), sessions: Number(sessions), participants: Number(participants), caseCode }); if (result === false) throw new Error('실적을 등록하지 못했습니다.'); onSaved(result); onClose(); }
    catch (failure) { setError(failure.message || '실적을 등록하지 못했습니다. 입력 내용을 유지합니다.'); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="perf-dialog ps-completion-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}><form onSubmit={save}>
    <header className="perf-dialog-head"><div><span className="perf-eyebrow">진행 완료</span><h2 id={titleId}>실제 진행 내용을 실적으로 등록</h2></div><button type="button" className="perf-icon-button" aria-label="실적 등록 닫기" onClick={onClose} disabled={busy}><X size={20} /></button></header>
    <div className="perf-dialog-body"><div className="ps-completion-source"><strong>{schedule.title}</strong><p>{scheduleTime(schedule)}</p><span>{schemeName(schedule.target)} · {item.section} · {item.label}</span></div>
      <section className="perf-form-section"><h3>활동 기록에 등록할 실제 실적</h3><div className="perf-form-grid"><DurationInput label="실제 진행 시간" value={actualMinutes} onChange={setActualMinutes} /><Field label="진행 횟수 (회)"><input type="number" min="1" max="10000" step="1" required value={sessions} onChange={event => setSessions(event.target.value)} /></Field><Field label="참여 인원 누계 (명)"><input type="number" min="1" max="100000" step="1" required value={participants} onChange={event => setParticipants(event.target.value)} /></Field><Field label="사례 · 집단 코드 (선택)"><input maxLength={100} value={caseCode} onChange={event => setCaseCode(event.target.value)} placeholder="예: C-2026-001" /></Field></div><p className="perf-field-help">쉬는 시간을 제외한 실제 진행 시간을 입력합니다. 일정의 시간과 달라도 됩니다.</p></section>
      <section className="perf-form-section"><h3>항목별 승인내역에 등록할 수량</h3><div className="perf-form-grid">{item.measures.map(measure => measure.id === 'minutes' ? <DurationInput key={measure.id} label={`${measure.label} 등록량`} value={quantities.minutes} onChange={value => setQuantities(previous => ({ ...previous, minutes: value }))} /> : <Field key={measure.id} label={`${measure.label} (${measure.unit})`}><input type="number" min="0" max="1000000" step="1" required value={quantities[measure.id]} onChange={event => setQuantities(previous => ({ ...previous, [measure.id]: event.target.value === '' ? '' : Number(event.target.value) }))} /></Field>)}</div><p className="perf-field-help">승인 상태는 ‘미요청’으로 등록합니다. 실제 인정받은 뒤 인정 현황에서 확인자와 승인 결과를 기록하세요.</p></section>
      <label className="perf-checkbox ps-confirm-check"><input type="checkbox" checked={checked} required onChange={event => setChecked(event.target.checked)} /><span>실제로 진행한 활동이며 시간, 횟수, 인원과 등록 수량을 확인했습니다.</span></label>{error ? <div className="perf-alert perf-alert-error" role="alert"><TriangleAlert size={17} />{error}</div> : null}
    </div><footer className="perf-dialog-foot"><span /><div><button type="button" className="perf-button" onClick={onClose} disabled={busy}>취소</button><button type="submit" className="perf-button perf-primary" disabled={busy}>{busy ? <Loader2 size={16} className="perf-spin" /> : <FileCheck2 size={16} />}실적과 승인내역 등록</button></div></footer>
  </form></dialog>;
}

function remoteDescription(remote) {
  if (!remote) return { title: '최신 Google 내용 조회 필요', when: '지금 동기화한 뒤 다시 확인해 주세요.', place: '' };
  if (remote.status === 'cancelled') return { title: 'Google에서 삭제된 일정', when: 'Google의 삭제 상태를 적용하면 예정 일정이 취소됩니다.', place: '' };
  const format = part => part?.date ? shortDate(part.date) : part?.dateTime && Number.isFinite(Date.parse(part.dateTime)) ? new Date(part.dateTime).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '시간 확인 필요';
  return { title: remote.summary || '제목 없는 일정', when: remote.start?.date ? `${format(remote.start)} ~ ${shortDate(shiftDate(remote.end?.date, -1))} · 종일` : `${format(remote.start)} ~ ${format(remote.end)}`, place: remote.location || '' };
}

function CalendarConflict({ schedule, calendar, onMessage }) {
  const [busy, setBusy] = useState(false);
  const remote = remoteDescription(schedule.calendar.remote);
  async function resolve(choice) {
    setBusy(true);
    try { await calendar.resolveConflict(schedule.id, choice); onMessage({ text: choice === 'remote' ? 'Google의 일정 내용을 적용했습니다.' : '기기의 일정 내용을 Google에 반영하도록 요청했습니다.' }); }
    catch (failure) { onMessage({ text: failure.message || '변경 내용을 적용하지 못했습니다.', error: true }); }
    finally { setBusy(false); }
  }
  return <div className="ps-conflict"><p><TriangleAlert size={16} />기기와 Google에서 모두 변경되었습니다. 사용할 내용을 선택하세요.</p><div className="ps-conflict-options"><section><span>이 기기의 일정</span><strong>{schedule.title}</strong><p>{scheduleTime(schedule)}</p>{schedule.place ? <small>{schedule.place}</small> : null}<button className="perf-button" disabled={busy || !schedule.calendar.remote || schedule.calendar.remote.status === 'cancelled'} onClick={() => resolve('local')}>기기 내용 사용</button></section><section><span>Google의 일정</span><strong>{remote.title}</strong><p>{remote.when}</p>{remote.place ? <small>{remote.place}</small> : null}<button className="perf-button" disabled={busy || !schedule.calendar.remote} onClick={() => resolve('remote')}>Google 내용 사용</button></section></div>{schedule.calendar.remote?.status === 'cancelled' ? <p className="ps-conflict-help">삭제된 Google 일정을 다시 진행하려면 새 일정으로 등록하세요. 이미 등록한 실적은 유지됩니다.</p> : null}</div>;
}

export default function PerformanceSchedule({ store, calendar, onEditRecord, onOpenApprovals }) {
  const [month, setMonth] = useState(() => localScheduleDate().slice(0, 7));
  const [selectedDate, setSelectedDate] = useState('');
  const [showCancelled, setShowCancelled] = useState(false);
  const [editing, setEditing] = useState(null);
  const [completing, setCompleting] = useState(null);
  const [message, setMessage] = useState(null);
  const [working, setWorking] = useState('');
  const [password, setPassword] = useState('');
  const schedules = store.schedules || [];
  const range = useMemo(() => monthWindow(month), [month]);
  useEffect(() => { calendar.setWindow(range.from, range.to); }, [range.from, range.to]);
  const monthSchedules = schedules.filter(schedule => scheduleInWindow(schedule, range.from, range.to) && (showCancelled || schedule.status !== 'cancelled')).sort((a, b) => a.date.localeCompare(b.date) || (a.start || '').localeCompare(b.start || '') || a.title.localeCompare(b.title, 'ko'));
  const listed = selectedDate ? monthSchedules.filter(schedule => scheduleInWindow(schedule, selectedDate, selectedDate)) : monthSchedules;
  const firstWeekday = new Date(`${range.from}T00:00:00Z`).getUTCDay();
  const gridStart = shiftDate(range.from, -firstWeekday);
  const cells = Array.from({ length: 42 }, (_, index) => shiftDate(gridStart, index));
  const conflicts = schedules.filter(schedule => schedule.calendar?.state === 'conflict');
  function navigate(amount) { setMonth(previous => moveMonth(previous, amount)); setSelectedDate(''); }
  async function run(key, action, success) {
    setWorking(key); setMessage(null);
    try { const result = await action(); if (result === false) throw new Error('요청을 처리하지 못했습니다.'); if (success) setMessage({ text: success }); }
    catch (failure) { setMessage({ error: true, text: failure.message || '요청을 처리하지 못했습니다.' }); }
    finally { setWorking(''); }
  }
  async function cancel(schedule) {
    if (!window.confirm(`“${schedule.title}” 일정을 취소할까요? 연결된 Google 일정도 삭제됩니다.`)) return;
    await run(schedule.id, () => calendar.cancelSchedule(schedule.id), '일정을 취소했습니다. 이 일정은 실적에 포함되지 않습니다.');
  }
  function complete(schedule) {
    if (!findApprovalItem(schedule.itemId) || !schedule.target) { setEditing(schedule); setMessage({ text: '실적을 등록하기 전에 학회와 수련 항목을 선택해 주세요.' }); return; }
    setCompleting(schedule);
  }
  const addDate = selectedDate || (localScheduleDate().startsWith(month) ? localScheduleDate() : range.from);
  return <div className="ps-app"><section className="perf-panel ps-connection"><div className="ps-connection-summary"><span className={`ps-cloud ${calendar.connected ? 'is-connected' : ''}`}><Cloud size={23} /></span><div><strong>{calendar.connected ? calendar.calendar?.name || 'Google 수련 캘린더 연결됨' : '수련 일정을 Google 캘린더와 함께 관리'}</strong><p>{calendar.connected ? `최근 동기화 ${recentSync(calendar.lastSynced)}${calendar.pending ? ` · 전송 대기 ${num(calendar.pending)}건` : ''}` : '전용 캘린더를 연결하면 이곳과 Google에서 변경한 일정을 서로 반영합니다.'}</p></div></div><div className="ps-connection-actions">{calendar.connected ? <><button className="perf-button" disabled={calendar.busy || Boolean(working)} onClick={() => run('sync', calendar.syncNow)}><RefreshCw size={15} className={calendar.busy ? 'perf-spin' : ''} />{calendar.busy ? '동기화 중' : '지금 동기화'}</button>{calendar.calendar?.url && /^https?:\/\//i.test(calendar.calendar.url) ? <a className="perf-button" href={calendar.calendar.url} target="_blank" rel="noopener noreferrer">Google 열기<ExternalLink size={13} /></a> : null}<button className="perf-text-button" disabled={Boolean(working)} onClick={() => run('disconnect', calendar.disconnect, 'Google 연결을 해제했습니다. 저장한 일정과 실적은 유지됩니다.')}>연결 해제</button></> : <>{calendar.passwordRequired ? <input type="password" aria-label="캘린더 연결 비밀번호" placeholder="연결 비밀번호" value={password} onChange={event => setPassword(event.target.value)} /> : null}<button className="perf-button perf-primary" disabled={!calendar.configured || Boolean(working)} onClick={() => run('connect', () => calendar.connect(password), '전용 Google 캘린더를 연결했습니다.')}>{working === 'connect' ? <Loader2 size={15} className="perf-spin" /> : <Cloud size={16} />}Google 연결 · 전용 캘린더 만들기</button><small>{calendar.configured ? '계정 승인 후 전용 비공개 캘린더 생성 · 기존 연결은 재사용' : '기기에 일정을 저장할 수 있습니다. Google 연결 설정을 확인 중입니다.'}</small></>}</div></section>
    {calendar.error ? <div className="perf-alert perf-alert-error" role="alert"><TriangleAlert size={17} /><span>{calendar.error}</span></div> : null}{message ? <div className={`perf-alert ${message.error ? 'perf-alert-error' : 'ps-message'}`} role={message.error ? 'alert' : 'status'}>{message.error ? <TriangleAlert size={17} /> : <Check size={17} />}<span>{message.text}</span><button className="perf-icon-button" aria-label="일정 알림 닫기" onClick={() => setMessage(null)}><X size={15} /></button></div> : null}
    <div className="ps-month-toolbar"><div className="ps-month-navigation"><button className="perf-icon-button" aria-label="이전 달" onClick={() => navigate(-1)}><ChevronLeft size={20} /></button><h2>{Number(month.slice(0, 4))}년 {Number(month.slice(5))}월</h2><button className="perf-icon-button" aria-label="다음 달" onClick={() => navigate(1)}><ChevronRight size={20} /></button><button className="perf-button ps-today" onClick={() => { setMonth(localScheduleDate().slice(0, 7)); setSelectedDate(localScheduleDate()); }}>오늘</button></div><button className="perf-button perf-primary" onClick={() => setEditing({ new: true, date: addDate })}><Plus size={16} />수련 일정 추가</button></div>
    <section className="perf-panel ps-calendar" aria-label={`${month} 수련 달력`}><div className="ps-weekdays" aria-hidden="true">{DAYS.map(day => <span key={day}>{day}</span>)}</div><div className="ps-month-grid">{cells.map((date, index) => {
      const daily = monthSchedules.filter(schedule => scheduleInWindow(schedule, date, date));
      return <button key={date} className={`ps-day ${!date.startsWith(month) ? 'is-outside' : ''} ${date === localScheduleDate() ? 'is-today' : ''} ${date === selectedDate ? 'is-selected' : ''} ${index % 7 === 0 ? 'is-sunday' : ''}`} aria-label={`${Number(date.slice(5, 7))}월 ${Number(date.slice(8))}일, 일정 ${daily.length}개`} aria-pressed={date === selectedDate} onClick={() => { if (!date.startsWith(month)) setMonth(date.slice(0, 7)); setSelectedDate(date); }}><span className="ps-day-number">{Number(date.slice(8))}</span><span className="ps-day-events">{daily.slice(0, 2).map(schedule => <span key={schedule.id} className={`ps-event-label ps-event-${schedule.target || 'other'} ${schedule.status === 'cancelled' ? 'is-cancelled' : ''}`}><i />{schedule.title}</span>)}{daily.length > 2 ? <small>+{daily.length - 2}개</small> : null}</span>{daily.length ? <span className="ps-day-count">{daily.length}</span> : null}</button>;
    })}</div></section>
    <section className="perf-panel ps-list-panel"><div className="perf-panel-title"><div><h2>{selectedDate ? `${Number(selectedDate.slice(5, 7))}월 ${Number(selectedDate.slice(8))}일 일정` : '이번 달 수련 일정'} <span className="perf-count">{num(listed.length)}</span></h2><p>실제로 진행한 뒤 ‘실적 등록’을 누르면 활동 기록과 미요청 승인내역이 생성됩니다.</p></div>{selectedDate ? <button className="perf-text-button" onClick={() => setSelectedDate('')}>월 전체 보기<ChevronRight size={14} /></button> : null}</div><div className="ps-list-toolbar"><label className="perf-checkbox"><input type="checkbox" checked={showCancelled} onChange={event => setShowCancelled(event.target.checked)} /><span>취소 일정 포함</span></label><span>예정 일정은 실적 합계에서 제외</span></div>
      {listed.length ? <div className="ps-schedule-list">{listed.map(schedule => {
        const item = findApprovalItem(schedule.itemId), original = (store.records || []).find(record => record.id === schedule.recordId);
        const blocked = schedule._conflict || schedule.calendar.state === 'conflict';
        return <article className={`ps-schedule ${schedule.status === 'cancelled' ? 'is-cancelled' : ''}`} key={schedule.id}><div className="ps-schedule-body"><div className="ps-schedule-info"><div className="ps-schedule-badges"><span className={`perf-badge perf-badge-${schedule.status}`}>{STATUS[schedule.status]}</span><span className={`ps-sync-state ps-sync-${schedule.calendar.state}`}>{schedule._conflict ? '기기 변경 충돌' : SYNC[schedule.calendar.state]}</span></div><button className="ps-schedule-title" disabled={Boolean(blocked) || schedule.status === 'cancelled'} onClick={() => setEditing(schedule)}>{schedule.title}</button><p className="ps-schedule-time"><CalendarDays size={14} />{scheduleTime(schedule)}</p><div className="ps-schedule-meta"><span>{schemeName(schedule.target)}{item ? ` · ${item.section} · ${item.label}` : ''}</span>{schedule.place ? <span><MapPin size={13} />{schedule.place}</span> : null}{schedule.supervisorName ? <span>수퍼바이저 {schedule.supervisorName}</span> : null}</div>{schedule.note ? <p className="ps-schedule-note">{schedule.note}</p> : null}{schedule.calendar.error && schedule.calendar.state !== 'conflict' ? <p className="ps-schedule-error">{schedule.calendar.error}</p> : null}{schedule.calendar.remoteCancelled && schedule.status === 'done' ? <p className="ps-schedule-note">Google 일정이 삭제되었으며 등록한 실적은 보존되어 있습니다.</p> : null}{schedule._conflict ? <p className="ps-schedule-error">여러 기기에서 변경된 일정입니다. 백업 · 연결에서 사용할 버전을 선택하세요.</p> : null}</div><div className="ps-schedule-actions">{schedule.status === 'planned' ? <><button className="perf-button perf-primary" disabled={Boolean(blocked) || Boolean(working)} onClick={() => complete(schedule)}><FileCheck2 size={14} />{item ? '실적 등록' : '항목 분류'}</button><button className="perf-button" disabled={Boolean(blocked) || Boolean(working)} onClick={() => setEditing(schedule)}><Pencil size={14} />수정</button><button className="perf-text-button ps-cancel-button" disabled={Boolean(blocked) || Boolean(working)} onClick={() => cancel(schedule)}>{working === schedule.id ? '처리 중' : '일정 취소'}</button></> : schedule.status === 'done' ? <>{original && onEditRecord ? <button className="perf-button" onClick={() => onEditRecord(original)}>등록 실적 보기<ChevronRight size={14} /></button> : <span className="perf-muted">연결 활동 확인 필요</span>}{onOpenApprovals ? <button className="perf-text-button" onClick={() => onOpenApprovals(schedule)}>승인내역 보기<ChevronRight size={13} /></button> : null}<button className="perf-text-button" disabled={Boolean(blocked)} onClick={() => setEditing(schedule)}>일정 수정</button></> : null}</div></div>{schedule.calendar.state === 'conflict' ? <CalendarConflict schedule={schedule} calendar={calendar} onMessage={setMessage} /> : null}</article>;
      })}</div> : <div className="perf-empty ps-empty"><span className="perf-empty-icon"><CalendarDays size={25} /></span><strong>{selectedDate ? '선택한 날짜에 수련 일정이 없습니다.' : '이번 달 수련 일정이 없습니다.'}</strong><p>수퍼비전, 사례발표회, 교육과 수련 일정을 등록해 보세요.</p><button className="perf-button" onClick={() => setEditing({ new: true, date: addDate })}><Plus size={15} />{selectedDate ? '선택일에 일정 등록' : '수련 일정 등록'}</button></div>}
    </section>{conflicts.some(schedule => !monthSchedules.some(candidate => candidate.id === schedule.id)) ? <div className="perf-alert perf-alert-warning"><TriangleAlert size={17} /><span>다른 달에도 확인이 필요한 Google 일정 변경이 있습니다.</span><button className="perf-text-button" onClick={() => { const next = conflicts.find(schedule => !monthSchedules.some(candidate => candidate.id === schedule.id)); setMonth(next.date.slice(0, 7)); setSelectedDate(''); setShowCancelled(true); }}>해당 달 보기</button></div> : null}
    {editing ? <ScheduleDialog key={editing.id || `new-${editing.date}`} schedule={editing.new ? null : editing} date={editing.date || addDate} store={store} calendar={calendar} onClose={() => setEditing(null)} onSaved={result => { setMessage({ text: calendar.connected ? '일정을 저장했습니다. Google 캘린더에 자동으로 반영합니다.' : '일정을 기기에 저장했습니다. Google 연결 후 자동으로 반영합니다.' }); if (result?.date) { if (selectedDate) setSelectedDate(result.date); if (!result.date.startsWith(month)) { setMonth(result.date.slice(0, 7)); setSelectedDate(result.date); } } }} /> : null}
    {completing ? <CompletionDialog schedule={completing} calendar={calendar} onClose={() => setCompleting(null)} onSaved={result => setMessage({ text: result?.alreadyCompleted ? '이미 등록된 실적과 승인내역을 확인했습니다. 중복으로 추가하지 않았습니다.' : '활동 실적과 미요청 승인내역을 등록했습니다. 인정 현황에서 승인 결과를 관리하세요.' })} /> : null}
  </div>;
}
