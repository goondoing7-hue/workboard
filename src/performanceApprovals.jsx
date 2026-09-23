import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, ExternalLink, FileCheck2, Info, Loader2, Pencil, Plus, Search, Trash2, TriangleAlert, UserRound, Users, X } from 'lucide-react';
import { ACTIVITIES } from './performanceDomain.mjs';
import { APPROVAL_ITEMS, APPROVAL_SCHEMES } from './performanceApprovalCatalog.mjs';

const STATUS = { pending: '미요청', requested: '승인 대기', approved: '승인 완료', rejected: '보완 · 반려' };
const FORMAT = { face: '대면', remote: '화상', phone: '전화' };
const number = value => Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
const activityName = id => ACTIVITIES.find(item => item.id === id)?.label || '활동';
const itemById = id => APPROVAL_ITEMS.find(item => item.id === id);
const schemeById = id => APPROVAL_SCHEMES.find(scheme => scheme.id === id);
const quantityLabel = (measure, quantity) => {
  const amount = Number(quantity || 0);
  if (measure.id !== 'minutes') return `${number(amount)}${measure.unit}`;
  return `${number(Math.floor(amount / 60))}시간${amount % 60 ? ` ${number(amount % 60)}분` : ''}`;
};
const quantitySummary = (item, entry) => item.measures.map(measure => quantityLabel(measure, entry.quantities?.[measure.id])).join(' · ');
const referenceTitle = record => `${record.date} · ${record.caseId || record.groupName || '사례코드 없음'} · ${activityName(record.activity)}`;

function Field({ label, children, help, className = '' }) {
  const id = useId();
  return <div className={`perf-field ${className}`}><label htmlFor={id}>{label}</label>{React.cloneElement(children, { id, 'aria-describedby': help ? `${id}-help` : undefined })}{help ? <small id={`${id}-help`}>{help}</small> : null}</div>;
}

function StateBadge({ entry }) {
  return <span className={`perf-badge ${entry._conflict || entry._sourceReview ? 'pa-conflict' : `perf-badge-${entry.status}`}`}>{entry._conflict ? '변경 충돌' : entry._sourceReview ? '연결 활동 재확인' : STATUS[entry.status] || '미요청'}</span>;
}

function Measures({ item, entries }) {
  return <div className="pa-measures">{item.measures.map(measure => <span key={measure.id}>{quantityLabel(measure, entries.reduce((sum, entry) => sum + Number(entry.quantities?.[measure.id] || 0), 0))}</span>)}</div>;
}

function ConditionList({ item }) {
  return <ul className="pa-conditions">{item.conditions.map((condition, index) => <li key={index}>{condition}</li>)}</ul>;
}

function SupervisorDialog({ supervisor, store, onClose, onSaved, initialScheme = 'kcp' }) {
  const [draft, setDraft] = useState(() => supervisor ? { ...supervisor } : { id: crypto.randomUUID(), name: '', affiliation: '', qualification: '', kcp: initialScheme === 'kcp', kca: initialScheme === 'kca', note: '', active: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef(null);
  const titleId = useId();
  useEffect(() => { const node = dialog.current; node.showModal(); return () => node.close(); }, []);
  const set = (key, value) => setDraft(previous => ({ ...previous, [key]: value }));
  async function save(event) {
    event.preventDefault();
    if (!draft.name.trim()) { setError('수퍼바이저 이름을 입력해 주세요.'); return; }
    if (!draft.kcp && !draft.kca) { setError('수퍼바이저를 선택할 학회를 하나 이상 지정해 주세요.'); return; }
    setBusy(true); setError('');
    try {
      const result = await store.saveSupervisor({ ...draft, name: draft.name.trim() });
      if (result === false) throw new Error('수퍼바이저를 저장하지 못했습니다.');
      onSaved?.(result?.id ? result : { ...draft, name: draft.name.trim() });
      onClose();
    } catch (failure) { setError(failure.message || '저장하지 못했습니다. 입력 내용을 유지합니다.'); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="perf-dialog pa-supervisor-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}><form onSubmit={save}>
    <header className="perf-dialog-head"><div><span className="perf-eyebrow">수퍼바이저 관리</span><h2 id={titleId}>{supervisor ? '수퍼바이저 수정' : '수퍼바이저 등록'}</h2></div><button type="button" className="perf-icon-button" aria-label="수퍼바이저 등록 닫기" onClick={onClose} disabled={busy}><X size={20} /></button></header>
    <div className="perf-dialog-body"><div className="perf-form-grid">
      <Field label="이름"><input autoFocus required maxLength={100} value={draft.name} onChange={event => set('name', event.target.value)} /></Field>
      <Field label="소속"><input maxLength={200} value={draft.affiliation || ''} onChange={event => set('affiliation', event.target.value)} placeholder="기관 또는 상담센터" /></Field>
      <Field className="perf-span-two" label="자격 · 등록번호" help="확인한 자격과 등록번호를 함께 적어 두세요."><input maxLength={500} value={draft.qualification || ''} onChange={event => set('qualification', event.target.value)} placeholder="예: 상담심리사 1급 · 등록번호" /></Field>
      <fieldset className="pa-scheme-checks perf-span-two"><legend>선택 가능한 학회</legend>{APPROVAL_SCHEMES.map(scheme => <label className="perf-checkbox" key={scheme.id}><input type="checkbox" checked={Boolean(draft[scheme.id])} onChange={event => set(scheme.id, event.target.checked)} /><span>{scheme.name}</span></label>)}</fieldset>
      <Field className="perf-span-two" label="메모"><textarea rows="2" maxLength={2000} value={draft.note || ''} onChange={event => set('note', event.target.value)} placeholder="전문영역이나 확인할 사항" /></Field>
      <label className="perf-checkbox perf-span-two"><input type="checkbox" checked={draft.active !== false} onChange={event => set('active', event.target.checked)} /><span>활동 중 · 새 승인내역에서 선택 가능</span></label>
    </div><p className="perf-field-help pa-spaced-help">수정하거나 비활성화해도 이전 승인내역에 저장된 수퍼바이저 이름은 그대로 보존됩니다.</p>{error ? <div className="perf-alert perf-alert-error" role="alert"><TriangleAlert size={17} />{error}</div> : null}</div>
    <footer className="perf-dialog-foot"><span /><div><button type="button" className="perf-button" onClick={onClose} disabled={busy}>취소</button><button type="submit" className="perf-button perf-primary" disabled={busy}>{busy ? <Loader2 size={16} className="perf-spin" /> : <Check size={16} />}수퍼바이저 저장</button></div></footer>
  </form></dialog>;
}

export function SupervisorManager({ store }) {
  const [editing, setEditing] = useState(null);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const supervisors = (store.supervisors || []).filter(supervisor => includeInactive || supervisor.active !== false).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  async function toggle(supervisor) {
    setBusyId(supervisor.id); setError(''); setMessage('');
    try {
      const result = await store.saveSupervisor({ ...supervisor, active: supervisor.active === false });
      if (result === false) throw new Error('수퍼바이저 상태를 저장하지 못했습니다.');
      setMessage(supervisor.active === false ? '다시 선택할 수 있도록 활성화했습니다.' : '수퍼바이저를 비활성화했습니다. 기존 승인내역은 보존됩니다.');
    } catch (failure) { setError(failure.message || '변경하지 못했습니다.'); }
    finally { setBusyId(''); }
  }
  return <section className="perf-panel pa-supervisor-manager"><div className="perf-panel-title"><div><h2>등록한 수퍼바이저 <span className="perf-count">{number((store.supervisors || []).filter(supervisor => supervisor.active !== false).length)}</span></h2><p>학회별 수퍼바이저를 등록한 뒤 활동 기록과 승인내역에서 선택합니다.</p></div><button className="perf-button perf-primary" onClick={() => setEditing({ new: true })}><Plus size={16} />수퍼바이저 등록</button></div>
    <div className="pa-supervisor-toolbar"><label className="perf-checkbox"><input type="checkbox" checked={includeInactive} onChange={event => setIncludeInactive(event.target.checked)} /><span>비활성 수퍼바이저도 보기</span></label></div>
    {error ? <div className="perf-alert perf-alert-error pa-panel-notice" role="alert"><TriangleAlert size={17} />{error}</div> : null}{message ? <p className="pa-feedback" role="status">{message}</p> : null}
    {supervisors.length ? <div className="pa-supervisor-list">{supervisors.map(supervisor => <article key={supervisor.id} className={`pa-supervisor-row ${supervisor.active === false ? 'pa-inactive' : ''}`}><span className="pa-person-icon"><UserRound size={20} /></span><div className="pa-supervisor-description"><strong>{supervisor.name}{supervisor.active === false ? <span className="perf-badge">비활성</span> : null}{supervisor._conflict ? <span className="perf-badge pa-conflict">변경 충돌</span> : null}</strong><p>{[supervisor.affiliation, supervisor.qualification].filter(Boolean).join(' · ') || '소속 · 자격 미입력'}</p><div className="pa-supervisor-schemes">{APPROVAL_SCHEMES.filter(scheme => supervisor[scheme.id]).map(scheme => <span key={scheme.id}>{scheme.name}</span>)}</div>{supervisor.note ? <p className="pa-note-text">{supervisor.note}</p> : null}</div><div className="pa-supervisor-actions"><button className="perf-button" onClick={() => setEditing(supervisor)} disabled={Boolean(supervisor._conflict) || Boolean(busyId)} aria-label={`${supervisor.name} 수퍼바이저 수정`}><Pencil size={14} />수정</button><button className="perf-text-button" disabled={Boolean(supervisor._conflict) || Boolean(busyId)} onClick={() => toggle(supervisor)}>{busyId === supervisor.id ? '저장 중' : supervisor.active === false ? '활성화' : '비활성화'}</button></div></article>)}</div> : <div className="perf-empty pa-empty"><span className="perf-empty-icon"><Users size={25} /></span><strong>등록한 수퍼바이저가 없습니다</strong><p>이름과 소속, 자격을 한 번 등록하면 반복해서 선택할 수 있습니다.</p></div>}
    {editing ? <SupervisorDialog supervisor={editing.new ? null : editing} store={store} onClose={() => setEditing(null)} onSaved={() => { setError(''); setMessage('수퍼바이저를 저장했습니다.'); }} /> : null}
  </section>;
}

function newApproval(item) {
  return { id: crypto.randomUUID(), target: item.scheme, itemId: item.id, date: today(), title: '', sourceRecordId: '', caseCode: '', quantities: Object.fromEntries(item.measures.map(measure => [measure.id, 0])), status: 'pending', supervisorId: '', supervisorName: '', approver: '', confirmedOn: '', evidence: '', note: '', format: 'face', requirementsChecked: false };
}

function QuantityInput({ measure, value, onChange }) {
  if (measure.id !== 'minutes') return <Field label={`${measure.label} (${measure.unit})`}><input type="number" min="0" step="1" max="1000000" required value={value ?? 0} onChange={event => onChange(event.target.value === '' ? '' : Number(event.target.value))} /></Field>;
  const minutes = Number(value || 0);
  return <fieldset className="pa-duration"><legend>{measure.label}</legend><div><label><input aria-label={`${measure.label} 시간`} type="number" min="0" max="16666" step="1" value={Math.floor(minutes / 60)} onChange={event => onChange(Number(event.target.value || 0) * 60 + minutes % 60)} /><span>시간</span></label><label><input aria-label={`${measure.label} 분`} type="number" min="0" max="59" step="1" value={minutes % 60} onChange={event => onChange(Math.floor(minutes / 60) * 60 + Number(event.target.value || 0))} /><span>분</span></label></div></fieldset>;
}

function ApprovalDialog({ entry, initialItem, store, onClose, onSaved }) {
  const [draft, setDraft] = useState(() => entry ? { ...entry, quantities: { ...entry.quantities } } : newApproval(initialItem));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [registerSupervisor, setRegisterSupervisor] = useState(false);
  const dialog = useRef(null);
  const titleId = useId();
  const item = itemById(draft.itemId);
  const scheme = schemeById(draft.target);
  const matchingItems = APPROVAL_ITEMS.filter(candidate => candidate.scheme === draft.target);
  const selectableSupervisors = (store.supervisors || []).filter(supervisor => supervisor.active !== false && !supervisor._conflict && supervisor[draft.target]);
  const selectedSupervisor = selectableSupervisors.find(supervisor => supervisor.id === draft.supervisorId);
  const sourceRecords = (store.records || []).filter(record => record.status === 'done' && !record.needsReview && !record._conflict && (!item.activityIds.length || item.activityIds.includes(record.activity))).sort((a, b) => b.date.localeCompare(a.date));
  const sourceExists = (store.records || []).some(record => record.id === draft.sourceRecordId);
  const duplicateSource = draft.sourceRecordId && (store.approvalEntries || []).some(other => other.id !== draft.id && other.itemId === draft.itemId && other.sourceRecordId === draft.sourceRecordId && other.status !== 'rejected');
  useEffect(() => { const node = dialog.current; node.showModal(); return () => node.close(); }, []);
  const set = (key, value) => setDraft(previous => ({ ...previous, [key]: value }));
  function selectItem(id) {
    const next = itemById(id);
    setDraft(previous => ({ ...previous, itemId: id, quantities: Object.fromEntries(next.measures.map(measure => [measure.id, 0])), sourceRecordId: '', sourceRevision: '', requirementsChecked: false, ...(previous.status === 'approved' ? { status: 'requested', confirmedOn: '' } : {}) }));
  }
  function selectSource(id) {
    const record = (store.records || []).find(candidate => candidate.id === id);
    if (!record) { set('sourceRecordId', ''); return; }
    setDraft(previous => ({ ...previous, sourceRecordId: id, date: record.date, title: [activityName(record.activity), record.groupName || record.testName].filter(Boolean).join(' · ').slice(0, 200), caseCode: record.caseId || record.testCaseId || '', format: record.format || 'face' }));
  }
  function selectSupervisor(supervisor) {
    setDraft(previous => ({ ...previous, supervisorId: supervisor?.id || '', supervisorName: supervisor?.name || '', approver: !previous.approver || previous.approver === previous.supervisorName ? supervisor?.name || '' : previous.approver }));
  }
  async function save(event) {
    event.preventDefault();
    if (!draft.title.trim()) { setError('어떤 활동을 승인받는지 제목을 입력해 주세요.'); return; }
    if (!item.measures.some(measure => Number(draft.quantities[measure.id]) > 0)) { setError('등록할 수량이나 시간을 하나 이상 입력해 주세요.'); return; }
    if (draft.status === 'approved' && (!draft.approver.trim() || !draft.confirmedOn || !draft.requirementsChecked)) { setError('승인 완료로 저장하려면 확인자, 확인 일자와 세부조건 확인이 필요합니다.'); return; }
    setBusy(true); setError('');
    try {
      const result = await store.saveApproval({ ...draft, title: draft.title.trim() });
      if (result === false) throw new Error('승인내역을 저장하지 못했습니다.');
      onSaved?.(result || draft); onClose();
    } catch (failure) { setError(failure.message || '저장하지 못했습니다. 입력 내용을 유지합니다.'); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!window.confirm(`“${draft.title}” 승인내역을 삭제할까요? 연결한 활동 기록은 유지됩니다.`)) return;
    setBusy(true); setError('');
    try { const result = await store.removeApproval(draft.id); if (result === false) throw new Error('삭제하지 못했습니다.'); onSaved?.(null); onClose(); }
    catch (failure) { setError(failure.message || '삭제하지 못했습니다.'); }
    finally { setBusy(false); }
  }
  return <><dialog ref={dialog} className="perf-dialog pa-approval-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}><form onSubmit={save}>
    <header className="perf-dialog-head"><div><span className="perf-eyebrow">{scheme.name} · {scheme.track}</span><h2 id={titleId}>{entry ? '승인내역 수정' : '승인내역 등록'}</h2></div><button type="button" className="perf-icon-button" aria-label="승인내역 닫기" onClick={onClose} disabled={busy}><X size={20} /></button></header>
    <div className="perf-dialog-body">{entry?._sourceReview ? <div className="perf-alert perf-alert-warning"><TriangleAlert size={17} /><span>연결 활동이 변경되어 승인량에서 제외되었습니다. 현재 활동과 수량을 검토해 저장하면 승인 대기로 전환됩니다. 확인을 다시 받은 뒤 승인 완료로 변경하세요.</span></div> : null}<div className="perf-form-grid">
      <Field className="perf-span-two" label="수련 항목"><select autoFocus value={draft.itemId} onChange={event => selectItem(event.target.value)}>{matchingItems.map(candidate => <option value={candidate.id} key={candidate.id}>{candidate.section} · {candidate.label}</option>)}</select></Field>
      <Field className="perf-span-two" label="연결할 활동 기록" help="연결하면 날짜와 제목, 사례코드를 가져옵니다. 인정받을 수량은 직접 확인해 입력하세요."><select value={draft.sourceRecordId || ''} onChange={event => selectSource(event.target.value)}><option value="">연결하지 않고 직접 입력</option>{draft.sourceRecordId && !sourceRecords.some(record => record.id === draft.sourceRecordId) ? <option value={draft.sourceRecordId}>{sourceExists ? '기존 연결 활동 · 현재 분류 대상 아님' : '이전에 연결한 활동 · 현재 목록에 없음'}</option> : null}{sourceRecords.map(record => <option value={record.id} key={record.id}>{referenceTitle(record)}</option>)}</select></Field>
      <Field label="활동 일자"><input type="date" required value={draft.date} onChange={event => set('date', event.target.value)} /></Field>
      <Field label="사례 · 집단 코드"><input maxLength={100} value={draft.caseCode || ''} onChange={event => set('caseCode', event.target.value)} placeholder="예: C-2026-001" /></Field>
      <Field className="perf-span-two" label="어떤 활동을 승인받나요?"><input required maxLength={200} value={draft.title} onChange={event => set('title', event.target.value)} placeholder="예: C-001 개인상담 1~5회기 / 9월 공개사례발표" /></Field>
      <Field label="진행 방식"><select value={draft.format || 'face'} onChange={event => set('format', event.target.value)}>{Object.entries(FORMAT).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
    </div>
    <section className="perf-form-section"><h3>이 승인내역에 등록할 수량</h3><div className="perf-form-grid">{item.measures.map(measure => <QuantityInput key={`${item.id}:${measure.id}`} measure={measure} value={draft.quantities?.[measure.id]} onChange={value => set('quantities', { ...draft.quantities, [measure.id]: value })} />)}</div><p className="perf-field-help">누적 합계가 아니라 이번 내역에서 승인받을 수량만 입력하세요. 같은 사례나 자료를 중복 등록하지 않도록 확인합니다.</p>{duplicateSource ? <div className="perf-alert perf-alert-warning"><Info size={17} />같은 활동이 이 수련 항목에 이미 연결되어 있습니다. 서로 다른 승인 범위인지 확인해 주세요.</div> : null}</section>
    <section className="perf-form-section"><h3>승인 상태와 확인자</h3><div className="perf-form-grid">
      <Field label="승인 상태"><select value={draft.status} onChange={event => set('status', event.target.value)}>{Object.entries(STATUS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
      <Field label="확인 일자"><input type="date" required={draft.status === 'approved'} value={draft.confirmedOn || ''} onChange={event => set('confirmedOn', event.target.value)} /></Field>
      <div className="perf-span-two pa-supervisor-choice"><Field label="수퍼바이저" help="등록 당시의 이름이 승인내역에 함께 저장됩니다."><select value={draft.supervisorId || ''} onChange={event => selectSupervisor(selectableSupervisors.find(supervisor => supervisor.id === event.target.value))}><option value="">선택하지 않음</option>{draft.supervisorId && !selectedSupervisor ? <option value={draft.supervisorId}>{draft.supervisorName || '기존 수퍼바이저'} · 이전 등록 정보</option> : null}{selectableSupervisors.map(supervisor => <option key={supervisor.id} value={supervisor.id}>{supervisor.id === draft.supervisorId && draft.supervisorName ? draft.supervisorName : supervisor.name}{supervisor.affiliation ? ` · ${supervisor.affiliation}` : ''}</option>)}</select></Field><button type="button" className="perf-button" onClick={() => setRegisterSupervisor(true)}><Plus size={15} />수퍼바이저 등록</button></div>
      <Field label="확인자" help="실제로 해당 항목을 확인한 수퍼바이저 또는 센터 확인자"><input required={draft.status === 'approved'} maxLength={100} value={draft.approver || ''} onChange={event => set('approver', event.target.value)} /></Field>
      <Field label="증빙 링크"><input type="url" maxLength={2000} value={draft.evidence || ''} onChange={event => set('evidence', event.target.value)} placeholder="https://drive.google.com/…" /></Field>
    </div></section>
    <section className="pa-condition-review"><h3>이 항목의 세부조건</h3><ConditionList item={item} /><label className="perf-checkbox"><input type="checkbox" checked={Boolean(draft.requirementsChecked)} onChange={event => set('requirementsChecked', event.target.checked)} required={draft.status === 'approved'} /><span>이 내역의 세부조건과 증빙을 확인했습니다.</span></label><p>수량 합계와 별도로 확인합니다. 이 체크는 학회의 심사 결과를 자동으로 판단하지 않습니다.</p></section>
    <Field label="확인 메모"><textarea rows="2" maxLength={2000} value={draft.note || ''} onChange={event => set('note', event.target.value)} placeholder="승인 범위, 보완 요청이나 증빙 준비 사항" /></Field>
    {error ? <div className="perf-alert perf-alert-error" role="alert"><TriangleAlert size={17} />{error}</div> : null}</div>
    <footer className="perf-dialog-foot">{entry ? <button type="button" className="perf-button perf-danger-button" onClick={remove} disabled={busy}><Trash2 size={15} />삭제</button> : <span />}<div><button type="button" className="perf-button" onClick={onClose} disabled={busy}>취소</button><button type="submit" className="perf-button perf-primary" disabled={busy}>{busy ? <Loader2 className="perf-spin" size={16} /> : <Check size={16} />}승인내역 저장</button></div></footer>
  </form></dialog>{registerSupervisor ? <SupervisorDialog store={store} initialScheme={draft.target} onClose={() => setRegisterSupervisor(false)} onSaved={supervisor => { if (supervisor[draft.target] && supervisor.active !== false) selectSupervisor(supervisor); }} /> : null}</>;
}

function EntryList({ item, entries, records, onEdit, onEditRecord }) {
  if (!entries.length) return <div className="pa-entry-empty"><FileCheck2 size={22} /><div><strong>이 항목에 등록한 승인내역이 없습니다.</strong><p>활동, 사례코드, 수량과 확인자를 등록하면 어떤 실적이 승인되었는지 확인할 수 있습니다.</p></div></div>;
  return <div className="pa-entry-list">{entries.map(entry => {
    const record = records.find(candidate => candidate.id === entry.sourceRecordId);
    return <article key={entry.id} className="pa-entry"><div className="pa-entry-main"><div className="pa-entry-top"><span>{entry.date.replaceAll('-', '.')}</span><StateBadge entry={entry} /><span>{FORMAT[entry.format] || ''}</span></div><button className="pa-entry-title" disabled={Boolean(entry._conflict)} onClick={() => onEdit(entry)}>{entry.title}</button><div className="pa-entry-meta"><span>{entry.caseCode ? `사례 · 집단 ${entry.caseCode}` : '사례 · 집단 코드 없음'}</span><strong>{quantitySummary(item, entry)}</strong></div><dl className="pa-entry-confirmation"><div><dt>수퍼바이저</dt><dd>{entry.supervisorName || '미지정'}</dd></div><div><dt>확인자</dt><dd>{entry.approver || '미입력'}</dd></div><div><dt>확인일</dt><dd>{entry.confirmedOn ? entry.confirmedOn.replaceAll('-', '.') : '미입력'}</dd></div></dl>{entry.note ? <p className="pa-note-text">{entry.note}</p> : null}{entry._conflict ? <p className="pa-conflict-note">여러 기기의 변경 내용이 충돌하여 합계에서 제외됩니다. 백업 · 연결에서 사용할 버전을 확정하세요.</p> : null}</div><div className="pa-entry-actions"><button className="perf-button" disabled={Boolean(entry._conflict)} onClick={() => onEdit(entry)} aria-label={`${entry.title} 승인내역 수정`}><Pencil size={14} />수정</button>{entry.evidence && /^https?:\/\//i.test(entry.evidence) ? <a className="perf-text-button" href={entry.evidence} target="_blank" rel="noopener noreferrer">증빙 열기<ExternalLink size={13} /></a> : null}{record && onEditRecord ? <button className="perf-text-button" onClick={() => onEditRecord(record)}>연결 활동 보기<ChevronRight size={13} /></button> : null}{entry.sourceRecordId && !record ? <span className="perf-muted">연결 활동 없음</span> : null}</div></article>;
  })}</div>;
}

export default function PerformanceApprovals({ store, onEditRecord }) {
  const [schemeId, setSchemeId] = useState('kcp');
  const [year, setYear] = useState('all');
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [openItems, setOpenItems] = useState({});
  const [editing, setEditing] = useState(null);
  const [message, setMessage] = useState('');
  const entries = store.approvalEntries || [];
  const records = store.records || [];
  const scheme = schemeById(schemeId);
  const items = APPROVAL_ITEMS.filter(item => item.scheme === schemeId);
  const sections = [...new Set(items.map(item => item.section))];
  const years = [...new Set(entries.map(entry => entry.date?.slice(0, 4)).filter(Boolean))].sort().reverse();
  const periodEntries = useMemo(() => entries.filter(entry => entry.target === schemeId && (year === 'all' || entry.date?.startsWith(`${year}-`))), [entries, schemeId, year]);
  const legacyCount = records.filter(record => record.targets?.[schemeId] && record.recognition?.[schemeId === 'kcp' ? 'supervisor' : 'center']?.status === 'approved').length;
  const pendingCount = periodEntries.filter(entry => !entry._conflict && (entry._sourceReview || ['pending', 'requested'].includes(entry.status))).length;
  const approvedCount = periodEntries.filter(entry => !entry._conflict && !entry._sourceReview && entry.status === 'approved').length;
  const searchTerm = search.toLocaleLowerCase('ko-KR').trim();
  const matchesEntry = entry => (status === 'all' || (status === 'conflict' ? Boolean(entry._conflict) : status === 'review' ? !entry._conflict && Boolean(entry._sourceReview) : !entry._conflict && !entry._sourceReview && entry.status === status)) && (!searchTerm || [entry.title, entry.caseCode, entry.supervisorName, entry.approver, entry.note, itemById(entry.itemId)?.label, itemById(entry.itemId)?.section].some(value => String(value || '').toLocaleLowerCase('ko-KR').includes(searchTerm)));
  const visibleItems = items.filter(item => {
    if (!searchTerm && status === 'all') return true;
    if (status === 'all' && `${item.section} ${item.label}`.toLocaleLowerCase('ko-KR').includes(searchTerm)) return true;
    return periodEntries.some(entry => entry.itemId === item.id && matchesEntry(entry));
  });
  function changeScheme(id) { setSchemeId(id); setStatus('all'); setSearch(''); setMessage(''); }
  function add(item) { setEditing({ item, new: true }); }
  function toggle(id, expanded) { setOpenItems(previous => ({ ...previous, [id]: !expanded })); }
  return <div className="pa-app">
    <div className="pa-scheme-tabs" aria-label="승인 현황 학회">{APPROVAL_SCHEMES.map(candidate => <button key={candidate.id} className={schemeId === candidate.id ? 'is-selected' : ''} aria-pressed={schemeId === candidate.id} onClick={() => changeScheme(candidate.id)}><FileCheck2 size={19} /><span><strong>{candidate.name}</strong><small>{candidate.track}</small></span><ChevronRight size={17} /></button>)}</div>
    <div className="pa-intro"><div><h2>{scheme.name} <span>{scheme.track}</span></h2><p>수련 항목을 열면 어떤 활동이 승인되었는지 확인할 수 있습니다.</p></div><button className="perf-button perf-primary" onClick={() => add(items[0])}><Plus size={16} />승인내역 등록</button></div>
    <div className="pa-source-note"><Info size={16} /><p>{scheme.sourceNote || '제공된 캡처를 기준으로 구성했습니다. 승인량과 최종 자격 심사는 구분합니다.'}</p></div>
    {legacyCount ? <div className="pa-legacy-note"><Info size={16} /><span>기존 활동의 일괄 확인 {number(legacyCount)}건은 보존되어 있습니다. 수련 항목을 분류한 뒤 아래에 승인내역을 등록하세요.</span></div> : null}
    <div className="pa-toolbar"><div className="perf-search"><Search size={16} /><input type="search" aria-label="승인내역 검색" placeholder="항목, 활동, 사례코드, 수퍼바이저 검색" value={search} onChange={event => setSearch(event.target.value)} /></div><select aria-label="승인내역 기간" value={year} onChange={event => setYear(event.target.value)}><option value="all">전체 기간 · 누적</option>{years.map(value => <option key={value} value={value}>{value}년 활동</option>)}</select><select aria-label="승인 상태 필터" value={status} onChange={event => setStatus(event.target.value)}><option value="all">모든 승인 상태</option>{Object.entries(STATUS).map(([id, label]) => <option value={id} key={id}>{label}</option>)}<option value="review">연결 활동 재확인</option><option value="conflict">변경 충돌</option></select></div>
    <div className="pa-overview-line"><span>등록 내역 <strong>{number(periodEntries.length)}건</strong><i />승인 완료 <strong>{number(approvedCount)}건</strong><i />확인 필요 <strong>{number(pendingCount)}건</strong></span><small>아래 등록량은 반려 포함 · 승인량은 승인 완료만 집계</small></div>
    {message ? <div className="pa-feedback" role="status"><Check size={15} />{message}<button className="perf-icon-button" aria-label="승인내역 알림 닫기" onClick={() => setMessage('')}><X size={15} /></button></div> : null}
    {sections.map(section => {
      const sectionItems = visibleItems.filter(item => item.section === section);
      if (!sectionItems.length) return null;
      return <section className="perf-panel pa-section" key={section}><div className="pa-section-head"><h3>{section}</h3><span>{sectionItems.length}개 항목</span></div><div className="pa-column-head" aria-hidden="true"><span>수련 항목 · 필요 기준</span><span>등록한 인정량</span><span>승인량</span><span>확인 필요</span><span /></div>{sectionItems.map(item => {
        const itemEntries = periodEntries.filter(entry => entry.itemId === item.id);
        const aggregateEntries = itemEntries.filter(entry => !entry._conflict);
        const approvedEntries = aggregateEntries.filter(entry => !entry._sourceReview && entry.status === 'approved');
        const waiting = aggregateEntries.filter(entry => entry._sourceReview || ['pending', 'requested'].includes(entry.status)).length;
        const listedEntries = itemEntries.filter(matchesEntry).sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title, 'ko'));
        const expanded = openItems[item.id] ?? Boolean((searchTerm || status !== 'all') && listedEntries.length);
        const panelId = `pa-item-${item.id}`;
        return <article className={`pa-item ${expanded ? 'is-open' : ''}`} key={item.id}><button className="pa-item-summary" onClick={() => toggle(item.id, expanded)} aria-expanded={expanded} aria-controls={panelId}><span className="pa-item-heading"><strong>{item.label}</strong><small>{item.measures.map(measure => measure.target === null ? `${measure.label} · 세부조건 확인` : quantityLabel(measure, measure.target)).join(' · ')}{item.conditions.length ? <span>세부조건 {item.conditions.length}개</span> : null}</small></span><span className="pa-item-quantity"><span className="pa-mobile-label">등록</span><Measures item={item} entries={aggregateEntries} /></span><span className="pa-item-quantity pa-approved-quantity"><span className="pa-mobile-label">승인</span><Measures item={item} entries={approvedEntries} /></span><span className="pa-waiting"><span className="pa-mobile-label">확인 필요</span><span>{number(waiting)}건</span></span><ChevronDown size={17} className="pa-expand-icon" /></button>{expanded ? <div id={panelId} className="pa-item-detail"><div className="pa-detail-heading"><strong>승인내역 <span>{number(listedEntries.length)}건</span></strong><button className="perf-button" onClick={() => add(item)}><Plus size={14} />이 항목 등록</button></div><EntryList item={item} entries={listedEntries} records={records} onEdit={entry => setEditing({ entry })} onEditRecord={onEditRecord} /><details className="pa-requirements"><summary>필요 기준과 세부조건 보기</summary><ConditionList item={item} /></details></div> : null}</article>;
      })}</section>;
    })}
    {!visibleItems.length ? <div className="perf-panel perf-empty pa-empty"><span className="perf-empty-icon"><Search size={23} /></span><strong>조건에 맞는 승인내역이 없습니다.</strong><p>검색어 또는 승인 상태를 변경해 주세요.</p><button className="perf-button" onClick={() => { setSearch(''); setStatus('all'); }}>검색 조건 초기화</button></div> : null}
    <p className="pa-footnote">등록량이 필요 기준에 도달해도 세부조건 충족이나 자격 취득이 자동 확정되지는 않습니다. 각 활동의 승인 결과와 증빙을 기록해 관리합니다.</p>
    {editing ? <ApprovalDialog key={editing.entry?.id || `new-${editing.item.id}`} entry={editing.entry} initialItem={editing.item} store={store} onClose={() => setEditing(null)} onSaved={result => { setMessage(result ? editing.entry?.status === 'approved' && result.status === 'requested' ? '실적 변경으로 승인 대기로 전환했습니다. 다시 확인한 뒤 승인 완료로 변경하세요.' : '승인내역을 저장했습니다.' : '승인내역을 삭제했습니다. 연결 활동 기록은 유지됩니다.'); if (result?.itemId) setOpenItems(previous => ({ ...previous, [result.itemId]: true })); }} /> : null}
  </div>;
}
