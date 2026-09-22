import React, { useEffect, useMemo, useState } from 'react';
import { militaryYear, employmentDays } from './performanceMilitaryDomain.mjs';
import { localDate, isDate } from './performanceDomain.mjs';

const lawUrl = 'https://law.go.kr/LSW/lumLsLinkPop.do?chrClsCd=010202&lspttninfSeq=132320';
const noticeUrl = 'https://www.mnd.go.kr/user/boardList.action?boardId=I_26382&boardSeq=I_13175837&command=view&id=mnd_020403000000&siteId=mnd';
const names = { individual: '개인상담', group: '집단상담', test: '심리검사' };
const hours = minutes => Number((minutes / 60).toFixed(2)).toLocaleString('ko-KR');
const emptyProfile = p => ({ degreePath: '', school: '', major: '', degreeDate: '', qualifications: [], employments: [], documents: {}, training: '', militaryCareer: '', recognizedMonths: '', ...p });
function Field({ label, children }) { return <label className="pm-field"><span>{label}</span>{children}</label>; }
export default function PerformanceMilitary({ records, profile, onSaveProfile }) {
  const [draft, setDraft] = useState(() => emptyProfile(profile)), [dirty, setDirty] = useState(false), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear()), [accepted, setAccepted] = useState(true), [helpCall, setHelpCall] = useState(false);
  useEffect(() => { if (!dirty) setDraft(emptyProfile(profile)); }, [profile, dirty]);
  const patch = (key, value) => { setDraft(p => ({ ...p, [key]: value })); setDirty(true); setMessage(''); };
  const annual = useMemo(() => militaryYear(records, year, { acceptedOnly: accepted, helpCall }), [records, year, accepted, helpCall]);
  const years = [...new Set([new Date().getFullYear(), year, ...records.map(r => Number(r.date.slice(0, 4)))])].sort((a, b) => b - a);
  const totals = years.map(y => ({ year: y, ...militaryYear(records, y, { acceptedOnly: accepted, helpCall }) }));
  const checklist = annual.institutions.flatMap(item => item.activities.map(activity => ({ key: `${year}|${item.institution}|${activity}`, institution: item.institution, activity })));
  const updateList = (key, id, field, value) => patch(key, draft[key].map(row => row.id === id ? { ...row, [field]: value } : row));
  const save = async e => {
    e.preventDefault(); setMessage('');
    if (draft.degreeDate && !isDate(draft.degreeDate)) { setMessage('학위 취득일을 확인해 주세요.'); return; }
    for (const row of draft.employments) {
      if (!row.institution || !isDate(row.from) || (row.to && (!isDate(row.to) || row.to < row.from))) { setMessage('경력의 기관명과 시작·종료일을 확인해 주세요.'); return; }
      if (row.hours !== '' && row.hours != null && (!Number.isFinite(Number(row.hours)) || Number(row.hours) < 0)) { setMessage('경력 시간은 0 이상의 숫자로 입력해 주세요.'); return; }
    }
    if (draft.recognizedMonths !== '' && (!Number.isInteger(Number(draft.recognizedMonths)) || Number(draft.recognizedMonths) < 0)) { setMessage('확인받은 경력은 0 이상의 개월 수로 입력해 주세요.'); return; }
    setBusy(true);
    try { await onSaveProfile(draft); setDirty(false); setMessage('자격·경력·서류 준비 현황을 저장했습니다.'); }
    catch (error) { setMessage(error.message); } finally { setBusy(false); }
  };
  return <section className="pm-panel">
    <div className="pm-heading"><div><h2>병영생활전문상담관 준비</h2><p>26-1차 첨부 서식의 연도별 실적 기준과 증빙 준비 현황</p></div><a href={noticeUrl} target="_blank" rel="noreferrer">국방부 공고 확인 ↗</a></div>
    <div className="pm-notice">첨부 파일에는 증빙 서식과 작성 유의사항이 포함되어 있습니다. 아래 결과는 <strong>연도별 실적 기준 점검</strong>이며, 지원 자격이나 인정 경력을 확정하지 않습니다.</div>
    <div className="pm-toolbar"><Field label="점검 연도"><input type="number" min="1900" max="2100" value={year} onChange={e => setYear(Math.max(1900, Math.min(2100, Number(e.target.value) || new Date().getFullYear())))} /></Field>
      <Field label="실적 범위"><select value={accepted ? 'accepted' : 'performed'} onChange={e => setAccepted(e.target.value === 'accepted')}><option value="accepted">센터 확인 완료</option><option value="performed">진행 완료 전체</option></select></Field>
      <label className="pm-check"><input type="checkbox" checked={helpCall} onChange={e => setHelpCall(e.target.checked)} />국방헬프콜센터 지원 예외 적용</label></div>
    <div className="pm-metrics">{[
      ['개인상담', annual.sessions, 50, '회기'], ['집단상담', annual.groupMinutes / 60, 24, '시간'], ['심리검사', annual.testCases, 10, '사례'],
    ].map(([label, count, threshold, unit]) => <article className="pm-metric" key={label}><span>{label}</span><div><strong>{Number(count.toFixed(2)).toLocaleString('ko-KR')}</strong> / {threshold}{unit}</div><progress max={threshold} value={Math.min(count, threshold)} aria-label={`${label} 기준 달성량`} /><small>{count >= threshold ? '연간 최소 실적 도달' : `${Number((threshold - count).toFixed(2))}${unit} 남음`}</small></article>)}</div>
    <p className="pm-result"><strong>{year}년 {annual.passed}/3 항목 {annual.meetsAnnualThreshold ? '충족' : '도달'}</strong><span>연간 기준: 세 항목 중 두 가지 이상. {accepted ? `센터 확인 대기 ${annual.pendingCenter}건` : '미확인 수행 기록을 포함한 참고 수치'}</span></p>
    <div className="pm-table-wrap"><table><caption>연도별 실적 요약</caption><thead><tr><th>연도</th><th>개인상담</th><th>집단상담</th><th>검사 사례</th><th>연간 기준</th></tr></thead><tbody>{totals.map(t => <tr key={t.year}><th>{t.year}년</th><td>{t.sessions}회기</td><td>{hours(t.groupMinutes)}시간</td><td>{t.testCases}사례</td><td>{t.passed}/3 {t.meetsAnnualThreshold ? '충족' : '미달'}</td></tr>)}</tbody></table></div>
    <details className="pm-details"><summary>포함 기준과 집계에서 빠진 기록 {annual.excluded.length}건</summary><ul><li>개인상담은 대면 완료 회기를 합산합니다. 마음결도 개인상담으로 합산합니다. 접수면접·해석상담은 포함 여부가 명시되지 않아 별도로 보관합니다.</li><li>집단은 비구조화 집단상담·구조화 집단프로그램의 실시/참가 시간을 합산합니다. 참여 인원과 시간을 곱하지 않습니다.</li><li>심리검사는 전국표준화·투사검사만 포함합니다. 같은 기관·연도의 같은 검사 사례코드는 여러 검사 도구가 있어도 한 사례로 집계합니다. 사례 구분은 인정기관에 확인해 주세요.</li><li>국방헬프콜센터 예외를 선택하면 개인상담의 전화·비대면도 포함합니다. 일반 병영 지원에는 적용하지 않습니다.</li></ul>{annual.excluded.length > 0 && <ul>{annual.excluded.map(r => <li key={r.id}>{r.date} · {r.caseId || r.groupName || '코드 미입력'} · {names[r.activity]} — {r.activity === 'individual' ? '대면 조건 미충족' : r.activity === 'group' ? '집단 종류·실시/참가 확인 필요' : '인정 검사 종류·검사 사례코드 확인 필요'}</li>)}</ul>}</details>
    <form onSubmit={save} className="pm-profile">
      <div className="pm-heading"><h3>자격·경력과 제출 서류</h3><span>{dirty ? '저장 전 변경 있음' : '저장된 준비 현황'}</span></div>
      <div className="pm-notice">법령의 기본 경로는 인정 자격증 보유를 전제로 상담경험 5년, 관련 학사 + 3년, 관련 석사 이상 + 2년입니다. 자격증 목록·급수와 해당 공고의 추가요건은 별도 확인이 필요합니다. <a href={lawUrl} target="_blank" rel="noreferrer">시행령 제32조 ↗</a></div>
      <div className="pm-grid"><Field label="검토할 기본 경로"><select value={draft.degreePath} onChange={e => patch('degreePath', e.target.value)}><option value="">선택</option><option value="experience">상담경험 5년</option><option value="bachelor">관련 학사 + 상담경험 3년</option><option value="master">관련 석사 이상 + 상담경험 2년</option></select></Field><Field label="학교·학위"><input value={draft.school} onChange={e => patch('school', e.target.value)} placeholder="학교와 학위명" /></Field><Field label="전공"><input value={draft.major} onChange={e => patch('major', e.target.value)} /></Field><Field label="학위 취득일"><input type="date" value={draft.degreeDate} onChange={e => patch('degreeDate', e.target.value)} /></Field></div>
      <div className="pm-heading"><h4>보유 자격증</h4><button type="button" onClick={() => patch('qualifications', [...draft.qualifications, { id: crypto.randomUUID(), name: '', issuer: '', date: '', evidence: '' }])}>자격증 추가</button></div>
      {draft.qualifications.map(row => <div className="pm-row" key={row.id}><Field label="자격증·급수"><input value={row.name} onChange={e => updateList('qualifications', row.id, 'name', e.target.value)} /></Field><Field label="발급기관"><input value={row.issuer} onChange={e => updateList('qualifications', row.id, 'issuer', e.target.value)} /></Field><Field label="취득일"><input type="date" value={row.date} onChange={e => updateList('qualifications', row.id, 'date', e.target.value)} /></Field><Field label="증빙 링크"><input type="url" value={row.evidence} onChange={e => updateList('qualifications', row.id, 'evidence', e.target.value)} /></Field><button type="button" onClick={() => patch('qualifications', draft.qualifications.filter(q => q.id !== row.id))} aria-label={`${row.name || '자격증'} 행 삭제`}>삭제</button></div>)}
      <div className="pm-heading"><h4>기관별 상담 경력</h4><button type="button" onClick={() => patch('employments', [...draft.employments, { id: crypto.randomUUID(), institution: '', role: '', from: '', to: '', hours: '', evidence: '' }])}>경력 추가</button></div>
      {draft.employments.map(row => <div className="pm-employment" key={row.id}><div className="pm-grid"><Field label="근무기관"><input value={row.institution} onChange={e => updateList('employments', row.id, 'institution', e.target.value)} /></Field><Field label="담당업무"><input value={row.role} onChange={e => updateList('employments', row.id, 'role', e.target.value)} /></Field><Field label="시작일"><input type="date" value={row.from} onChange={e => updateList('employments', row.id, 'from', e.target.value)} /></Field><Field label="종료일 · 재직 중이면 공란"><input type="date" value={row.to} onChange={e => updateList('employments', row.id, 'to', e.target.value)} /></Field><Field label="증빙에 기재된 총 시간"><input type="number" min="0" step="0.1" value={row.hours} onChange={e => updateList('employments', row.id, 'hours', e.target.value)} /></Field><Field label="경력증명서 링크"><input type="url" value={row.evidence} onChange={e => updateList('employments', row.id, 'evidence', e.target.value)} /></Field></div><button type="button" onClick={() => patch('employments', draft.employments.filter(q => q.id !== row.id))}>경력 행 삭제</button></div>)}
      <p className="pm-help">입력 기간의 중복을 제외한 재직일: {employmentDays(draft.employments, localDate()).toLocaleString('ko-KR')}일. 재직일·시간을 인정 경력 연수로 자동 환산하지 않습니다.</p>
      <div className="pm-grid"><Field label="별도로 확인받은 인정 경력 · 개월"><input type="number" min="0" value={draft.recognizedMonths} onChange={e => patch('recognizedMonths', e.target.value)} placeholder="확인받은 경우에만 입력" /></Field><Field label="자살예방 교육·교관 활동"><textarea value={draft.training} onChange={e => patch('training', e.target.value)} rows="2" placeholder="교육명, 날짜, 시간, 증빙 위치" /></Field><Field label="군경력·군 상담경력"><textarea value={draft.militaryCareer} onChange={e => patch('militaryCareer', e.target.value)} rows="2" /></Field></div>
      <h4>{year}년 기관별 증빙 준비</h4><p className="pm-help">기관장 직인과 해당 연도·기관별 상세사례를 확인합니다. 체크 표시 자체는 증빙서류를 대체하지 않습니다.</p>
      {!checklist.length ? <p className="pm-empty">집계 대상 기록이 생기면 기관별 준비 목록이 표시됩니다.</p> : checklist.map(item => {
        const value = draft.documents[item.key] || {};
        const change = (key, val) => patch('documents', { ...draft.documents, [item.key]: { ...value, [key]: val } });
        return <div className="pm-document" key={item.key}><strong>{item.institution} · {names[item.activity]}</strong><label className="pm-check"><input type="checkbox" checked={!!value.stamped} onChange={e => change('stamped', e.target.checked)} />기관장 직인 준비</label><label className="pm-check"><input type="checkbox" checked={!!value.detail} onChange={e => change('detail', e.target.checked)} />상세사례 준비</label><Field label="대표 사례코드"><input value={value.caseId || ''} onChange={e => change('caseId', e.target.value)} /></Field><Field label="증빙 링크"><input type="url" value={value.evidence || ''} onChange={e => change('evidence', e.target.value)} /></Field></div>;
      })}
      <div className="pm-save"><button type="submit" disabled={busy || !dirty}>{busy ? '저장 중…' : '자격·경력·서류 현황 저장'}</button>{message && <p role="status">{message}</p>}</div>
    </form>
  </section>;
}
