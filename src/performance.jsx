import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, BarChart3, CalendarDays, Check, CheckCircle2, ChevronRight, Cloud, CloudOff, Database, FileCheck2, FileText, HardDrive, Info, List, Loader2, LockKeyhole, Plus, RefreshCw, Search, Settings2, ShieldCheck, Trash2, TriangleAlert, Users, X } from 'lucide-react';
import { ACTIVITIES, csvRecords, normalizeRecord, summarize, validateRecord } from './performanceDomain.mjs';
import { usePerformanceStore } from './performanceStore.jsx';
import PerformanceMilitary from './performanceMilitary.jsx';
import PerformanceApprovals, { SupervisorManager } from './performanceApprovals.jsx';
import { findApprovalItem } from './performanceApprovalCatalog.mjs';
import PerformanceSchedule from './performanceSchedule.jsx';
import { usePerformanceCalendar } from './performanceCalendar.jsx';

const INSTITUTION = '춘천시청소년상담복지센터';
const NAV = [
  { id: 'overview', title: '실적 한눈에', icon: BarChart3 },
  { id: 'records', title: '활동 기록', icon: List },
  { id: 'recognition', title: '인정 현황', icon: FileCheck2 },
  { id: 'schedule', title: '수련 캘린더', icon: CalendarDays },
  { id: 'military', title: '병영 자격요건', icon: ShieldCheck },
  { id: 'supervisors', title: '수퍼바이저 관리', icon: Users },
  { id: 'settings', title: '백업 · 연결', icon: Database },
];
const MOBILE_NAV = { overview: '실적', records: '기록', recognition: '인정', schedule: '일정', military: '병영', supervisors: '지도자', settings: '백업' };
const TARGETS = [
  { id: 'kcp', label: '한국상담심리학회', full: '한국상담심리학회', authority: '수퍼바이저', channel: 'supervisor' },
  { id: 'kca', label: '한국상담학회', full: '한국상담학회', authority: '센터', channel: 'center' },
  { id: 'military', label: '병영생활전문상담관', full: '병영생활전문상담관', authority: '센터', channel: 'center' },
];
const STATE = { done: '진행 완료', planned: '예정', cancelled: '취소' };
const APPROVAL = { pending: '미확인', requested: '확인 요청', approved: '확인 완료' };
const num = value => Number(value || 0).toLocaleString('ko-KR');
const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const duration = minutes => `${Math.floor(Number(minutes || 0) / 60)}시간${Number(minutes || 0) % 60 ? ` ${num(Number(minutes || 0) % 60)}분` : ''}`;
const shortDate = value => String(value || '').replaceAll('-', '.');
const activityLabel = id => ACTIVITIES.find(activity => activity.id === id)?.label || id;
const recordKey = record => record.caseId || record.groupName || '사례코드 미입력';
const channelStatus = (record, channel) => record.recognition?.[channel]?.status || 'pending';
const dateTime = value => {
  if (!value) return '아직 백업하지 않음';
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? String(value) : parsed.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};
function downloadFile(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function periodRange(period) {
  const now = new Date();
  if (period === 'year') return { from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31` };
  if (period === 'month') return { from: localDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: localDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
  return { from: '', to: '' };
}
function newRecord() {
  return normalizeRecord({ id: crypto.randomUUID(), date: localDate(), activity: 'individual', sessions: 1, participants: 1, minutes: 50, institution: INSTITUTION, format: 'face', status: 'done', groupRole: 'leader', targets: { kcp: true, kca: true, military: true }, recognition: { center: { status: 'pending' }, supervisor: { status: 'pending' } } });
}

function Field({ label, children, help, className = '' }) {
  const id = useId();
  return <div className={`perf-field ${className}`}><label htmlFor={id}>{label}</label>{React.cloneElement(children, { id, 'aria-describedby': help ? `${id}-help` : undefined })}{help ? <small id={`${id}-help`}>{help}</small> : null}</div>;
}
function Badge({ status, children }) {
  return <span className={`perf-badge perf-badge-${status}`}>{children || APPROVAL[status] || STATE[status] || status}</span>;
}
function Empty({ title, description, action }) {
  return <div className="perf-empty"><span className="perf-empty-icon"><FileText size={27} strokeWidth={1.6} /></span><strong>{title}</strong><p>{description}</p>{action}</div>;
}
function RecognitionFields({ channel, value, onChange, supervisors = [] }) {
  const title = channel === 'center' ? '센터 활동 확인 · 한국상담학회 / 병영' : '수퍼바이저 활동 확인 · 한국상담심리학회';
  const patch = (key, next) => onChange({ ...value, [key]: next });
  const options = supervisors.filter(person => person.active && person.kcp && !person._conflict);
  return <fieldset className="perf-recognition-fields"><legend>{title}</legend><div className="perf-form-grid">
    <Field label="확인 상태"><select value={value.status || 'pending'} onChange={event => patch('status', event.target.value)}>{Object.entries(APPROVAL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
    <Field label="확인 일자"><input type="date" value={value.confirmedOn || ''} onChange={event => patch('confirmedOn', event.target.value)} /></Field>
    <Field label="확인자" help={channel === 'supervisor' ? '수퍼바이저 관리에서 등록한 사람을 선택합니다.' : undefined}>{channel === 'supervisor' ? <select value={value.approver || ''} onChange={event => patch('approver', event.target.value)}><option value="">수퍼바이저 선택</option>{value.approver && !options.some(person => person.name === value.approver) ? <option value={value.approver}>{value.approver} · 기존 기록</option> : null}{options.map(person => <option key={person.id} value={person.name}>{person.name}{person.affiliation ? ` · ${person.affiliation}` : ''}</option>)}</select> : <input value={value.approver || ''} placeholder="기관 또는 담당자" onChange={event => patch('approver', event.target.value)} maxLength={100} />}</Field>
    <Field label="증빙 링크" help="Google Drive 등 확인서를 보관한 http(s) 링크"><input type="url" value={value.evidence || ''} placeholder="https://drive.google.com/…" onChange={event => patch('evidence', event.target.value)} maxLength={2000} /></Field>
  </div></fieldset>;
}
function RecordDialog({ record, onSave, onClose, onDelete, supervisors = [] }) {
  const [draft, setDraft] = useState(() => record ? normalizeRecord(record) : newRecord());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dialog = useRef(null);
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);
  const set = (key, value) => setDraft(previous => ({ ...previous, [key]: value }));
  async function save(event) {
    event.preventDefault();
    const validation = validateRecord(draft);
    if (validation) { setError(validation); return; }
    setBusy(true); setError('');
    try { const result = await onSave(draft); if (result === false) throw new Error('저장에 실패했습니다. 입력 내용을 유지합니다.'); onClose(); }
    catch (failure) { setError(failure.message || '저장하지 못했습니다. 다시 시도해 주세요.'); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="perf-dialog" aria-labelledby="perf-dialog-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={save}>
      <header className="perf-dialog-head"><div><span className="perf-eyebrow">활동 기록</span><h2 id="perf-dialog-title">{record ? '기록 수정' : '새 기록 추가'}</h2></div><button type="button" className="perf-icon-button" aria-label="닫기" onClick={onClose} disabled={busy}><X size={21} /></button></header>
      <div className="perf-dialog-body">
        <div className="perf-note"><LockKeyhole size={17} /><span>실적에 필요한 정보만 기록하세요. 내담자 실명과 상세 상담 내용은 입력하지 않습니다.</span></div>
        <section className="perf-form-section"><h3>기본 정보</h3><div className="perf-form-grid">
          <Field label="진행 일자"><input autoFocus type="date" required value={draft.date || ''} onChange={event => set('date', event.target.value)} /></Field>
          <Field label="활동 종류"><select value={draft.activity} onChange={event => set('activity', event.target.value)}>{ACTIVITIES.map(activity => <option value={activity.id} key={activity.id}>{activity.label}</option>)}</select></Field>
          <Field label="사례코드" help="같은 내담자에게 같은 코드를 사용하면 중복 제외 인원이 계산됩니다."><input value={draft.caseId || ''} onChange={event => set('caseId', event.target.value)} placeholder="예: C-2026-001" maxLength={120} /></Field>
          <Field label="진행 상태"><select value={draft.status} onChange={event => set('status', event.target.value)}>{Object.entries(STATE).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
          <Field label="진행 기관"><input value={draft.institution || ''} onChange={event => set('institution', event.target.value)} maxLength={200} /></Field>
          <Field label="진행 방식"><select value={draft.format || 'face'} onChange={event => set('format', event.target.value)}><option value="face">대면</option><option value="remote">화상</option><option value="phone">전화</option></select></Field>
        </div></section>
        <section className="perf-form-section"><h3>횟수 · 인원 · 시간</h3><div className="perf-form-grid perf-form-three">
          <Field label="진행 횟수 (회)"><input type="number" min="1" max="10000" step="1" required value={draft.sessions ?? ''} onChange={event => set('sessions', event.target.value)} /></Field>
          <Field label="참여 인원 누계 (명)"><input type="number" min="1" max="100000" step="1" required value={draft.participants ?? ''} onChange={event => set('participants', event.target.value)} /></Field>
          <Field label="총 진행 시간 (분)"><input type="number" min="1" max="1000000" step="1" required value={draft.minutes ?? ''} onChange={event => set('minutes', event.target.value)} /></Field>
        </div><p className="perf-field-help">기록 전체의 합계를 입력합니다. 개인상담 4회는 참여 누계 4명, 집단상담 4회 × 8명은 32명입니다. 한 회기씩 기록하면 관리가 더 정확합니다.</p>
          {(draft.activity === 'test' || draft.activity === 'interpretation') ? <div className="perf-form-grid"><Field label="검사명"><input value={draft.testName || ''} placeholder="예: MMPI-2" onChange={event => set('testName', event.target.value)} maxLength={500} /></Field><Field label="검사 분류"><select value={draft.testCategory || ''} onChange={event => set('testCategory', event.target.value)}><option value="">미확인</option><option value="standardized">전국 표준화 검사</option><option value="projective">투사 검사</option><option value="other">기타 검사</option></select></Field><Field className="perf-span-two" label="검사 사례코드" help="같은 검사 사례에서 여러 도구를 사용했다면 같은 코드를 입력합니다. 도구 수와 사례 수는 별도로 집계합니다."><input value={draft.testCaseId || ''} placeholder="예: T-2026-001" onChange={event => set('testCaseId', event.target.value)} maxLength={120} /></Field></div> : null}
          {draft.activity === 'group' ? <div className="perf-form-grid"><Field label="집단명"><input value={draft.groupName || ''} onChange={event => set('groupName', event.target.value)} placeholder="집단 프로그램 이름" maxLength={200} /></Field><Field label="참여자 사례코드" help="쉼표로 구분합니다. 입력한 코드로 중복 제외 인원을 계산합니다."><input value={(draft.participantIds || []).join(', ')} onChange={event => set('participantIds', event.target.value.split(',').map(value => value.trim()))} placeholder="C-001, C-002, C-003" /></Field><Field label="집단 분류"><select value={draft.groupCategory || ''} onChange={event => set('groupCategory', event.target.value)}><option value="">미확인</option><option value="unstructured">비구조화 집단상담</option><option value="structured">구조화 집단프로그램</option><option value="other">기타</option></select></Field><Field label="진행 역할"><select value={draft.groupRole || ''} onChange={event => set('groupRole', event.target.value)}><option value="">미확인</option><option value="leader">실시 · 진행자</option><option value="participant">참가자</option><option value="co-leader">보조 진행자</option></select></Field></div> : null}
          <Field label="수퍼바이저" help="수퍼바이저 관리에서 등록 후 선택할 수 있습니다."><select value={draft.supervisorId || (draft.supervisor ? '__legacy' : '')} onChange={event => { const person = supervisors.find(item => item.id === event.target.value); setDraft(previous => ({ ...previous, supervisorId: person?.id || '', supervisor: person?.name || '' })); }}><option value="">선택 안 함</option>{draft.supervisor && !draft.supervisorId ? <option value="__legacy">{draft.supervisor} · 기존 기록</option> : null}{draft.supervisorId && !supervisors.some(person => person.id === draft.supervisorId && person.active && !person._conflict) ? <option value={draft.supervisorId}>{draft.supervisor || '기존 수퍼바이저'} · 선택 종료</option> : null}{supervisors.filter(person => person.active && !person._conflict).map(person => <option key={person.id} value={person.id}>{person.name}{person.affiliation ? ` · ${person.affiliation}` : ''}</option>)}</select></Field>
        </section>
        <section className="perf-form-section"><h3>활동 확인</h3><div className="perf-target-checks">{TARGETS.map(target => <label className="perf-checkbox" key={target.id}><input type="checkbox" checked={Boolean(draft.targets?.[target.id])} onChange={event => set('targets', { ...draft.targets, [target.id]: event.target.checked })} /><span>{target.label}</span></label>)}</div><p className="perf-field-help">센터·수퍼바이저의 활동 확인을 기록합니다. 학회 수련항목별 승인 내역은 ‘인정 현황’에서 이 활동을 연결해 등록하세요.</p>
          {(draft.targets?.kca || draft.targets?.military) ? <RecognitionFields channel="center" value={draft.recognition?.center || { status: 'pending' }} onChange={value => set('recognition', { ...draft.recognition, center: value })} /> : null}
          {draft.targets?.kcp ? <RecognitionFields channel="supervisor" supervisors={supervisors} value={draft.recognition?.supervisor || { status: 'pending' }} onChange={value => set('recognition', { ...draft.recognition, supervisor: value })} /> : null}
        </section>
        <details className="perf-form-details"><summary>추가 정보 · 병영 실적 분류</summary><div className="perf-form-grid">
          <Field label="상담 당시 연령 (선택)"><input type="number" min="0" max="120" step="1" value={draft.age ?? ''} onChange={event => set('age', event.target.value === '' ? undefined : Number(event.target.value))} /></Field>
          <Field label="성별 (선택)"><select value={draft.gender || ''} onChange={event => set('gender', event.target.value)}><option value="">미입력</option><option value="male">남성</option><option value="female">여성</option><option value="other">기타</option></select></Field>
          <label className="perf-checkbox perf-span-two"><input type="checkbox" checked={Boolean(draft.youth)} onChange={event => set('youth', event.target.checked)} /><span>청소년 상담 실적에 포함</span></label>
          <Field className="perf-span-two" label="실적 관리 메모 (선택)" help="증빙 준비나 확인 요청에 필요한 메모만 남겨 주세요."><textarea rows="2" maxLength={2000} value={draft.note || ''} onChange={event => set('note', event.target.value)} placeholder="예: 9월 경력확인서 발급 시 포함" /></Field>
        </div></details>
        {error ? <div className="perf-alert perf-alert-error" role="alert"><TriangleAlert size={18} />{error}</div> : null}
      </div>
      <footer className="perf-dialog-foot">{record ? <button type="button" className="perf-button perf-danger-button" disabled={busy} onClick={async () => { setBusy(true); try { if (await onDelete(record)) onClose(); } finally { setBusy(false); } }}><Trash2 size={16} />삭제</button> : <span />}<div><button type="button" className="perf-button" onClick={onClose} disabled={busy}>취소</button><button type="submit" className="perf-button perf-primary" disabled={busy}>{busy ? <Loader2 className="perf-spin" size={16} /> : <Check size={16} />}기록 저장</button></div></footer>
    </form>
  </dialog>;
}

function RecordTable({ records, onEdit, compact = false }) {
  return <div className="perf-table-scroll"><table className="perf-table"><thead><tr><th>진행 일자</th><th>사례 · 활동</th><th className="perf-number">횟수</th><th className="perf-number">참여 누계</th><th className="perf-number">시간</th>{!compact ? <th>진행</th> : null}<th>센터 확인</th><th>수퍼바이저 확인</th><th><span className="perf-sr-only">기록 열기</span></th></tr></thead><tbody>{records.map(record => <tr key={record.id}>
    <td className="perf-nowrap">{shortDate(record.date)}</td><td><button className="perf-record-title" onClick={() => onEdit(record)}>{recordKey(record)}</button><span className="perf-table-sub">{activityLabel(record.activity)}{record.testName ? ` · ${record.testName}` : ''}</span>{record.needsReview ? <Badge status="pending">내용 확인 필요</Badge> : null}</td><td className="perf-number">{num(record.sessions)}회</td><td className="perf-number">{num(record.participants)}명</td><td className="perf-number perf-nowrap">{duration(record.minutes)}</td>{!compact ? <td><Badge status={record.status} /></td> : null}
    <td>{record.targets?.kca || record.targets?.military ? <Badge status={channelStatus(record, 'center')} /> : <span className="perf-muted">—</span>}</td><td>{record.targets?.kcp ? <Badge status={channelStatus(record, 'supervisor')} /> : <span className="perf-muted">—</span>}</td><td><button className="perf-icon-button" onClick={() => onEdit(record)} aria-label={`${record.date} ${recordKey(record)} 기록 수정`}><ChevronRight size={17} /></button></td>
  </tr>)}</tbody></table></div>;
}

function BackupSettings({ store, onMessage, runAction }) {
  const [password, setPassword] = useState('');
  const [connecting, setConnecting] = useState(false);
  const input = useRef(null);
  const { sync, storageError } = store;
  async function connect(event) {
    event.preventDefault(); setConnecting(true);
    try { await store.connect(password); setPassword(''); }
    catch (failure) { onMessage({ text: failure.message || 'Google Drive에 연결하지 못했습니다.', error: true }); }
    finally { setConnecting(false); }
  }
  return <div className="perf-settings-grid"><section className="perf-panel"><div className="perf-panel-title"><div><h2>Google Drive · Sheets</h2><p>기록 변경을 자동 백업하고 시트로 확인합니다.</p></div><Cloud size={24} /></div><div className="perf-panel-body">
    <div className={`perf-connection-state ${sync.connected ? 'is-connected' : ''}`}><span className="perf-state-dot" /><strong>{sync.connected ? 'Google Drive 연결됨' : 'Google Drive 연결 필요'}</strong></div>
    <dl className="perf-detail-list"><div><dt>최근 백업</dt><dd>{dateTime(sync.lastSynced)}</dd></div><div><dt>백업 대기</dt><dd>{num(sync.pending)}건</dd></div><div><dt>현재 상태</dt><dd>{sync.busy ? '백업 중' : sync.error ? '백업 오류' : sync.connected ? '자동 백업 켜짐' : '이 기기에 저장 중'}</dd></div></dl>
    {sync.error ? <div className="perf-alert perf-alert-error" role="alert"><TriangleAlert size={18} />{sync.error}</div> : null}
    {sync.connected ? <div className="perf-settings-actions"><button className="perf-button perf-primary" onClick={() => runAction(store.syncNow)} disabled={sync.busy}>{sync.busy ? <Loader2 size={16} className="perf-spin" /> : <RefreshCw size={16} />}지금 백업</button>{sync.spreadsheetUrl ? <a className="perf-button" href={sync.spreadsheetUrl} target="_blank" rel="noreferrer">Google Sheets 열기<ChevronRight size={15} /></a> : null}<button className="perf-text-button" onClick={() => { if (window.confirm('이 기기의 Google Drive 연결을 해제할까요? 기존 기록과 백업 파일은 유지됩니다.')) runAction(store.disconnect); }}>연결 해제</button></div> : <form onSubmit={connect} className="perf-connect-form">{sync.passwordRequired ? <Field label="연결 비밀번호"><input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></Field> : null}<button className="perf-button perf-primary" disabled={connecting || sync.configured === false}>{connecting ? <Loader2 className="perf-spin" size={16} /> : <Cloud size={16} />}Google Drive 연결</button>{sync.configured === false ? <p className="perf-field-help">Google Drive 연결 준비가 필요합니다. 연결 전에는 이 기기 저장과 아래 파일 백업을 사용할 수 있습니다.</p> : <p className="perf-field-help">연결 후 저장한 기록은 Google Drive에 자동 백업됩니다. 백업 상태는 화면 왼쪽 아래에서 확인할 수 있습니다.</p>}</form>}
  </div></section><section className="perf-panel"><div className="perf-panel-title"><div><h2>파일 백업과 복구</h2><p>전체 기록을 파일로 별도 보관합니다.</p></div><HardDrive size={24} /></div><div className="perf-panel-body">
    <div className="perf-backup-block"><strong>전체 백업 다운로드</strong><p>활동 기록, 인정 정보, 자격요건 정보를 JSON 파일로 저장합니다.</p><button className="perf-button" onClick={() => runAction(store.exportBackup)}><ArrowDownToLine size={16} />백업 파일 저장</button></div>
    <div className="perf-backup-block"><strong>백업 파일 불러오기</strong><p>이 프로그램에서 저장한 JSON 백업을 가져옵니다. 같은 기록의 서로 다른 변경은 충돌 목록에서 확인합니다.</p><input ref={input} className="perf-sr-only" type="file" accept=".json,application/json" aria-label="JSON 백업 파일 선택" onChange={async event => { const file = event.target.files?.[0]; if (file) await runAction(async () => { await store.importBackup(file); onMessage({ text: '백업 파일을 불러왔습니다.' }); }); event.target.value = ''; }} /><button className="perf-button" onClick={() => input.current.click()}><ArrowUpFromLine size={16} />백업 파일 불러오기</button></div>
    <div className={`perf-note ${storageError ? 'perf-alert-error' : ''}`}><HardDrive size={17} /><span>{storageError || '입력한 기록은 먼저 이 기기에 저장됩니다. Google Drive 연결 상태와 최근 백업 시간을 함께 확인하세요.'}</span></div>
  </div></section></div>;
}

function ConflictList({ store, runAction }) {
  if (!store.conflicts?.length) return null;
  const typeName = type => ({ approval: '항목 승인', supervisor: '수퍼바이저', schedule: '수련 일정', record: '활동', profile: '자격·경력' }[type] || '기록');
  return <section className="perf-panel perf-conflict-panel"><div className="perf-panel-title"><div><h2>확인이 필요한 변경 {num(store.conflicts.length)}건</h2><p>같은 기록에 여러 변경이 있습니다. 내용을 확인하고 사용할 버전을 선택하세요.</p></div><TriangleAlert size={23} /></div><div className="perf-panel-body">{store.conflicts.map(conflict => <div className="perf-conflict" key={`${conflict.entityType}:${conflict.entityId}`}><strong>{typeName(conflict.entityType)} · {conflict.versions?.[0]?.payload?.title || conflict.versions?.[0]?.payload?.name || conflict.versions?.[0]?.payload?.caseId || '변경 비교'}</strong><div className="perf-conflict-versions">{conflict.versions.map(version => <div key={version.id}><div><strong>{version.payload?.deleted ? '삭제' : version.payload?.date || version.payload?.name || '저장된 변경'}</strong><span>{version.payload?.itemId ? findApprovalItem(version.payload.itemId)?.label : version.payload?.activity ? activityLabel(version.payload.activity) : typeName(version.entityType)} · {dateTime(version.createdAt)}</span>{version.payload?.sessions ? <span>{num(version.payload.sessions)}회 · {duration(version.payload.minutes)}</span> : null}<details><summary>저장 내용 비교</summary><pre className="perf-conflict-detail">{JSON.stringify(version.payload, null, 2)}</pre></details></div><button className="perf-button" onClick={() => runAction(() => store.resolveConflict(conflict.entityId, version.id))}>이 버전 사용</button></div>)}</div></div>)}</div></section>;
}

function PerformanceApp() {
  const store = usePerformanceStore();
  const calendar = usePerformanceCalendar(store);
  const { records = [], sync = {}, storageError } = store;
  const [tab, setTab] = useState('overview');
  const [period, setPeriod] = useState('year');
  const [range, setRange] = useState(() => periodRange('year'));
  const [target, setTarget] = useState('performed');
  const [activity, setActivity] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [editing, setEditing] = useState(null);
  const [message, setMessage] = useState(null);
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => { const update = () => setOnline(navigator.onLine); window.addEventListener('online', update); window.addEventListener('offline', update); return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); }; }, []);
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(null), message.error ? 10000 : 4500); return () => clearTimeout(timer); }, [message]);
  const rangeError = range.from && range.to && range.from > range.to;
  const periodRecords = useMemo(() => records.filter(record => (!range.from || record.date >= range.from) && (!range.to || record.date <= range.to)), [records, range.from, range.to]);
  const summary = useMemo(() => summarize(records, { ...range, target, ...(activity ? { activity } : {}) }), [records, range.from, range.to, target, activity]);
  const filteredRecords = useMemo(() => periodRecords.filter(record => {
    if (activity && record.activity !== activity) return false;
    if (status !== 'all' && record.status !== status) return false;
    if (target !== 'performed') { const info = TARGETS.find(item => item.id === target); if (record.status !== 'done' || record.needsReview || record._conflict || !record.targets?.[target] || channelStatus(record, info.channel) !== 'approved') return false; }
    if (search.trim()) { const term = search.toLowerCase().trim(); if (![record.caseId, record.groupName, record.institution, record.testName, record.note, activityLabel(record.activity)].some(value => String(value || '').toLowerCase().includes(term))) return false; }
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)), [periodRecords, activity, status, target, search]);
  const pending = useMemo(() => periodRecords.filter(record => record.status === 'done' && (((record.targets?.kca || record.targets?.military) && channelStatus(record, 'center') !== 'approved') || (record.targets?.kcp && channelStatus(record, 'supervisor') !== 'approved'))).sort((a, b) => b.date.localeCompare(a.date)), [periodRecords]);
  const pendingApprovalCount = (store.approvalEntries || []).filter(entry => ['pending', 'requested'].includes(entry.status) || entry._sourceReview || entry._conflict).length;
  async function runAction(action) {
    try { return await action(); }
    catch (failure) { setMessage({ error: true, text: failure.message || '요청을 처리하지 못했습니다.' }); return false; }
  }
  function changePeriod(value) { setPeriod(value); if (value !== 'custom') setRange(periodRange(value)); }
  async function deleteRecord(record) {
    if (!window.confirm(`${shortDate(record.date)} ${recordKey(record)} 기록을 삭제할까요?`)) return false;
    return await runAction(async () => { await store.removeRecord(record.id); setMessage({ text: '기록을 삭제했습니다.' }); return true; });
  }
  function exportCsv() { downloadFile(csvRecords(filteredRecords), `상담실적_${range.from || '전체'}_${range.to || localDate()}.csv`, 'text/csv;charset=utf-8'); setMessage({ text: `${num(filteredRecords.length)}개 기록을 CSV로 저장했습니다.` }); }
  async function importWorkboard() { await runAction(async () => { const result = await store.importWorkboard(); setMessage({ text: `완료된 상담 ${num(result?.imported)}건을 가져왔습니다.${result?.skipped ? ` 이미 가져왔거나 대상이 아닌 ${num(result.skipped)}건은 제외했습니다.` : ''}` }); }); }
  const backupState = storageError ? '기기 저장 오류' : !online ? '오프라인 · 기기 저장' : sync.busy ? 'Google Drive 백업 중' : sync.error ? '백업 오류 · 확인 필요' : sync.connected && Number(sync.pending) > 0 ? `백업 대기 ${num(sync.pending)}건` : sync.connected ? 'Google Drive 백업 연결' : '이 기기에 저장 중';
  const BackupIcon = storageError || sync.error ? TriangleAlert : sync.busy ? RefreshCw : sync.connected ? Cloud : HardDrive;
  const currentNav = NAV.find(item => item.id === tab);
  const chosenTarget = TARGETS.find(item => item.id === target);
  return <div className="perf-app">
    <aside className="perf-sidebar"><a href="/performance.html" className="perf-brand" aria-label="상담실적 첫 화면"><span><img src="/performance-icon.svg" width="40" height="40" alt="" /></span><div><strong>상담실적</strong><small>기록과 수련 관리</small></div></a><div className="perf-workspace-label">나의 상담 기록</div><nav aria-label="실적관리 메뉴">{NAV.map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)} aria-label={item.title} title={item.title} data-mobile-label={MOBILE_NAV[item.id]} aria-current={tab === item.id ? 'page' : undefined}><item.icon size={19} /><span>{item.title}</span>{item.id === 'recognition' && pendingApprovalCount ? <b>{pendingApprovalCount}</b> : null}</button>)}</nav><div className="perf-sidebar-bottom"><button className={`perf-backup-indicator ${storageError || sync.error ? 'has-error' : ''}`} onClick={() => setTab('settings')} aria-label={`${backupState} · 백업 설정`}><BackupIcon className={sync.busy ? 'perf-spin' : ''} size={19} /><span><strong>{backupState}</strong><small>{sync.lastSynced ? `최근 백업 ${dateTime(sync.lastSynced)}` : '백업 · 연결 확인'}</small></span><ChevronRight size={15} /></button><a className="perf-back-link" href="/"><ArrowLeft size={15} />업무보드로 이동</a></div></aside>
    <div className="perf-main"><header className="perf-topbar"><div className="perf-breadcrumb">상담실적<span>/</span><strong>{currentNav.title}</strong></div><span className="perf-topbar-date"><CalendarDays size={16} />{new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}</span></header>
      <main className="perf-content"><div className="perf-page-heading"><div><h1>{currentNav.title}</h1><p>{tab === 'overview' ? '한 번 기록하고, 진행 실적과 인정 실적을 함께 확인하세요.' : tab === 'records' ? '마음결 사업의 상담도 개인상담에 함께 집계합니다.' : tab === 'recognition' ? '학회별 수련 항목과 개별 승인 내역을 확인하세요.' : tab === 'schedule' ? '수련 일정을 Google 캘린더와 연결하고 진행 후 실적으로 등록하세요.' : tab === 'supervisors' ? '수퍼바이저를 등록하고 상담·승인 기록에서 선택하세요.' : tab === 'military' ? '경력과 상담 실적, 제출에 필요한 증빙을 함께 정리합니다.' : '내 기록의 저장 위치와 백업 상태를 확인하세요.'}</p></div>{['overview', 'records', 'military'].includes(tab) ? <button className="perf-button perf-primary" onClick={() => setEditing({ new: true })}><Plus size={18} />기록 추가</button> : null}</div>
        {storageError ? <div className="perf-alert perf-alert-error" role="alert"><TriangleAlert size={19} /><div><strong>기기 저장 상태를 확인해 주세요.</strong><p>{storageError}</p></div><button className="perf-button" onClick={() => runAction(store.exportBackup)}>지금 파일 백업</button></div> : null}
        {store.conflicts?.length && tab !== 'settings' ? <div className="perf-alert perf-alert-warning"><TriangleAlert size={18} /><span>여러 곳에서 변경된 기록 {num(store.conflicts.length)}건이 있습니다. 사용할 버전을 확정할 때까지 합계에서 제외됩니다.</span><button className="perf-text-button" onClick={() => setTab('settings')}>변경 확인</button></div> : null}
        {['overview', 'records'].includes(tab) ? <section className="perf-filter-bar" aria-label="실적 조회 조건"><div className="perf-period"><CalendarDays size={18} /><select aria-label="조회 기간" value={period} onChange={event => changePeriod(event.target.value)}><option value="year">올해</option><option value="month">이번 달</option><option value="all">전체 기간</option><option value="custom">기간 설정</option></select>{period !== 'all' ? <div className="perf-date-range"><input type="date" aria-label="시작일" value={range.from} onChange={event => { setPeriod('custom'); setRange({ ...range, from: event.target.value }); }} /><span>—</span><input type="date" aria-label="종료일" value={range.to} onChange={event => { setPeriod('custom'); setRange({ ...range, to: event.target.value }); }} /></div> : <span className="perf-muted">저장된 모든 기록</span>}</div>{tab !== 'recognition' ? <div className="perf-basis"><span>실적 기준</span><select aria-label="실적 기준" value={target} onChange={event => setTarget(event.target.value)}><option value="performed">진행한 실적</option>{TARGETS.map(item => <option key={item.id} value={item.id}>{item.label} · 활동 확인</option>)}</select></div> : <span className="perf-filter-caption">인정 대상별 확인 완료 실적</span>}</section> : null}
        {rangeError && ['overview', 'records'].includes(tab) ? <div className="perf-alert perf-alert-error" role="alert"><TriangleAlert size={18} />종료일을 시작일 이후로 설정해 주세요.</div> : null}
        {tab === 'overview' || tab === 'records' ? <>
          <div className="perf-kpi-grid"><section className="perf-kpi"><div><span>{chosenTarget ? '활동 확인된 횟수' : '진행한 횟수'}</span><span className="perf-kpi-icon"><FileCheck2 size={20} /></span></div><strong>{num(summary.sessions)}<small>회</small></strong><p>{chosenTarget ? `${chosenTarget.authority} 확인 완료 · ${chosenTarget.label}` : '진행 완료된 활동만 집계'}</p></section><section className="perf-kpi"><div><span>{summary.peopleExact ? '상담 인원 · 중복 제외' : '확인된 상담 인원'}</span><span className="perf-kpi-icon"><Users size={20} /></span></div><strong>{num(summary.people)}<small>명</small></strong><p>참여 누계 {num(summary.attendance)}명{summary.unknownPeople ? ` · 코드 연결 미확인 누계 ${num(summary.unknownPeople)}명` : ''}</p></section><section className="perf-kpi"><div><span>총 진행 시간</span><span className="perf-kpi-icon"><CalendarDays size={20} /></span></div><strong>{num(Math.floor(Number(summary.minutes || 0) / 60))}<small>시간 {Number(summary.minutes || 0) % 60 ? `${num(Number(summary.minutes) % 60)}분` : ''}</small></strong><p>합계 {num(summary.minutes)}분</p></section></div>
          {tab === 'overview' ? <div className="perf-overview-grid"><section className="perf-panel"><div className="perf-panel-title"><div><h2>활동별 실적</h2><p>{chosenTarget ? `${chosenTarget.label} · 확인 완료` : '진행 완료'} 기준</p></div><BarChart3 size={21} /></div><div className="perf-table-scroll"><table className="perf-table perf-activity-table"><thead><tr><th>활동</th><th className="perf-number">횟수</th><th className="perf-number">인원</th><th className="perf-number">시간</th></tr></thead><tbody>{ACTIVITIES.map(item => { const row = summary.byActivity?.find(value => value.id === item.id) || {}; return <tr key={item.id}><td><button className="perf-activity-link" onClick={() => { setActivity(item.id); setTab('records'); }}><span className={`perf-activity-dot perf-activity-${item.id}`} />{item.label}</button></td><td className="perf-number">{num(row.sessions)}회</td><td className="perf-number">{num(row.people)}명</td><td className="perf-number perf-nowrap">{duration(row.minutes)}</td></tr>; })}</tbody></table></div><div className="perf-panel-foot"><Info size={15} />인원은 사례코드 기준입니다. 활동 간 중복은 전체 인원에서 제외됩니다.</div></section><section className="perf-panel"><div className="perf-panel-title"><div><h2>활동 확인이 필요해요 <span className="perf-count">{num(pending.length)}</span></h2><p>진행을 마쳤지만 확인이 남은 기록</p></div><button className="perf-text-button" onClick={() => setTab('records')}>활동 보기<ChevronRight size={14} /></button></div>{pending.length ? <div className="perf-pending-list">{pending.slice(0, 5).map(record => <button key={record.id} onClick={() => setEditing(record)}><span className="perf-pending-day">{record.date.slice(5).replace('-', '.')}</span><span><strong>{recordKey(record)}</strong><small>{activityLabel(record.activity)} · {num(record.sessions)}회</small></span><span className="perf-pending-authorities">{(record.targets?.kca || record.targets?.military) && channelStatus(record, 'center') !== 'approved' ? <Badge status={channelStatus(record, 'center')}>센터 {APPROVAL[channelStatus(record, 'center')]}</Badge> : null}{record.targets?.kcp && channelStatus(record, 'supervisor') !== 'approved' ? <Badge status={channelStatus(record, 'supervisor')}>수퍼바이저 {APPROVAL[channelStatus(record, 'supervisor')]}</Badge> : null}</span><ChevronRight size={16} /></button>)}</div> : <Empty title={records.length ? '남은 확인 요청이 없습니다' : '첫 기록부터 차근차근'} description={records.length ? '선택한 기간에 확인이 필요한 기록이 없습니다.' : '상담을 기록하면 확인할 실적이 여기에 모입니다.'} />}</section></div> : null}
          <section className="perf-panel perf-record-panel"><div className="perf-panel-title"><div><h2>{tab === 'overview' ? '최근 활동 기록' : '활동 기록'} <span className="perf-count">{num(filteredRecords.length)}</span></h2><p>기록을 누르면 상세 정보와 인정 상태를 수정할 수 있습니다.</p></div><div className="perf-record-actions">{typeof store.importWorkboard === 'function' ? <button className="perf-button" onClick={importWorkboard}><ArrowDownToLine size={15} />업무보드에서 가져오기</button> : null}<button className="perf-button" disabled={!filteredRecords.length} onClick={exportCsv}><ArrowDownToLine size={15} />CSV 저장</button></div></div><div className="perf-table-filters"><div className="perf-search"><Search size={17} /><input type="search" aria-label="활동 검색" placeholder="사례코드, 검사명, 기관 검색" value={search} onChange={event => setSearch(event.target.value)} /></div><select aria-label="활동 종류 필터" value={activity} onChange={event => setActivity(event.target.value)}><option value="">모든 활동</option>{ACTIVITIES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select><select aria-label="진행 상태 필터" value={status} onChange={event => setStatus(event.target.value)}><option value="all">모든 진행 상태</option>{Object.entries(STATE).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>{filteredRecords.length ? <RecordTable records={tab === 'overview' ? filteredRecords.slice(0, 8) : filteredRecords} onEdit={setEditing} compact={tab === 'overview'} /> : <Empty title={records.length ? '조건에 맞는 기록이 없습니다' : '아직 기록된 실적이 없습니다'} description={records.length ? '조회 기간이나 활동 필터를 변경해 보세요.' : '날짜, 사례코드, 횟수와 시간을 입력하면 합계가 바로 계산됩니다.'} action={!records.length ? <button className="perf-button perf-primary" onClick={() => setEditing({ new: true })}><Plus size={16} />첫 기록 추가</button> : null} />}{tab === 'overview' && filteredRecords.length > 8 ? <div className="perf-panel-foot perf-justify-end"><button className="perf-text-button" onClick={() => setTab('records')}>활동 기록 {num(filteredRecords.length)}건 모두 보기<ChevronRight size={15} /></button></div> : null}</section>
        </> : null}
        {tab === 'recognition' ? <PerformanceApprovals store={store} onEditRecord={setEditing} /> : null}
        {tab === 'schedule' ? <PerformanceSchedule store={store} calendar={calendar} onEditRecord={setEditing} onOpenApprovals={() => setTab('recognition')} /> : null}
        {tab === 'supervisors' ? <SupervisorManager store={store} /> : null}
        {tab === 'military' ? <PerformanceMilitary records={records} profile={store.profile} onSaveProfile={store.saveProfile} /> : null}
        {tab === 'settings' ? <><BackupSettings store={store} onMessage={setMessage} runAction={runAction} /><ConflictList store={store} runAction={runAction} /></> : null}
        <footer className="perf-page-footer"><span><LockKeyhole size={13} />사례코드로 기록하는 나의 상담실적</span><button className="perf-text-button" onClick={() => setTab('settings')}>{backupState}</button></footer>
      </main>
    </div>
    {message ? <div className={`perf-toast ${message.error ? 'perf-toast-error' : ''}`} role={message.error ? 'alert' : 'status'}>{message.error ? <TriangleAlert size={18} /> : <CheckCircle2 size={18} />}<span>{message.text}</span><button className="perf-icon-button" aria-label="알림 닫기" onClick={() => setMessage(null)}><X size={17} /></button></div> : null}
    {editing ? <RecordDialog key={editing.id || 'new'} record={editing.new ? null : editing} supervisors={store.supervisors || []} onClose={() => setEditing(null)} onSave={async record => { const result = await store.saveRecord(record); if (result === false) return false; const recheck = ['center', 'supervisor'].some(channel => record.recognition?.[channel]?.status === 'approved' && result?.recognition?.[channel]?.status === 'requested'); setMessage({ text: recheck ? '기록을 저장했습니다. 실적 변경으로 기존 인정은 재확인이 필요합니다.' : '기록을 저장했습니다.' }); return result; }} onDelete={deleteRecord} /> : null}
  </div>;
}

createRoot(document.getElementById('root')).render(<PerformanceApp />);
