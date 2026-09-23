import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, CheckCircle2, Link2, Loader2, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import { WORKBOARD_ORIGIN, PERFORMANCE_ORIGIN } from './performanceDeployment.mjs';
import { createWorkboardSnapshot } from './performanceWorkboardLink.mjs';
import { mergeEvents } from './performanceDomain.mjs';
import { META_KEY, backupText, readLocalBackup, readLocalEvents } from './performancePersistence.mjs';

const CHANNEL = 'workboard-performance-link';
const VERSION = 1;
const LIMIT = 50 * 1024 * 1024;
const CALENDAR_META = 'counseling-performance:v1:calendar';
const WORKBOARD_KEY = 'workboard:data';
const TYPES = new Set(['hello', 'request-snapshot', 'request-migration', 'ack', 'stop']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const requestIdValid = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,150}$/.test(value);
const count = value => Array.isArray(value) ? value.length : Number.isInteger(value) && value >= 0 && value <= 100000 ? value : 0;

function encryptedSource(raw) {
  let value = raw;
  for (let depth = 0; depth < 5; depth++) {
    if (typeof value === 'string') {
      if (value.length > LIMIT) throw new Error('업무보드 저장 자료가 너무 큽니다. 원본 자료를 확인해 주세요.');
      try { value = JSON.parse(value); } catch { throw new Error('업무보드의 최신 저장 자료를 읽지 못했습니다. 기존 실적은 그대로 보존됩니다.'); }
      continue;
    }
    if (!object(value)) return false;
    if (value.enc === 1 || value.encrypted === true || value.locked === true) return true;
    if (Object.hasOwn(value, 'data') && !Object.hasOwn(value, 'resv')) { value = value.data; continue; }
    return false;
  }
  return false;
}

function connectionFromPage() {
  if (window.location.origin !== WORKBOARD_ORIGIN || !window.opener) return null;
  const params = new URLSearchParams(window.location.hash.slice(1));
  if ([...params.keys()].some(key => !['performance-link', 'mode'].includes(key)) || params.getAll('performance-link').length !== 1 || params.getAll('mode').length !== 1) return null;
  const nonce = params.get('performance-link'), mode = params.get('mode');
  if (!/^[a-f0-9]{48}$/.test(nonce || '') || !['sync', 'migrate'].includes(mode)) return null;
  return { nonce, mode, opener: window.opener };
}

function readBindings() {
  const read = key => {
    const raw = localStorage.getItem(key);
    if (raw === null) return {};
    let result;
    try { result = JSON.parse(raw); } catch { throw new Error('이전 Google 연결 대상 정보를 읽지 못했습니다. 기존 저장 내용을 확인해 주세요.'); }
    if (!object(result)) throw new Error('이전 Google 연결 대상 정보의 형식이 올바르지 않습니다.');
    return result;
  };
  const cloud = read(META_KEY), calendar = read(CALENDAR_META);
  const sheetId = cloud.sheetId || '', calendarId = calendar.calendarId || '';
  if (typeof sheetId !== 'string' || sheetId && !/^[A-Za-z0-9_-]{8,180}$/.test(sheetId)) throw new Error('기존 Google Sheets 식별자를 확인하지 못했습니다.');
  if (typeof calendarId !== 'string' || calendarId && (calendarId === 'primary' || !/^[A-Za-z0-9._+@-]{1,300}$/.test(calendarId))) throw new Error('기존 수련 캘린더 식별자를 확인하지 못했습니다.');
  return { sheetId, calendarId };
}

const styles = {
  shell: { position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 95, width: 'min(720px, calc(100vw - 24px))', border: '1px solid #b8d0f4', borderRadius: 11, background: '#f6f9ff', color: '#284767', boxShadow: '0 8px 30px #17345326', padding: '13px 15px', fontFamily: "'Noto Sans KR', 'Malgun Gothic', sans-serif", fontSize: 13, lineHeight: 1.7 },
  top: { display: 'flex', alignItems: 'flex-start', gap: 10 },
  icon: { flexShrink: 0, marginTop: 3, color: '#3476c9' },
  body: { flex: 1, minWidth: 0 },
  title: { display: 'block', fontSize: 14, fontWeight: 700, color: '#264f7e' },
  paragraph: { margin: '4px 0 0', color: '#6b83a2', fontSize: 12, overflowWrap: 'anywhere' },
  status: { display: 'flex', alignItems: 'flex-start', gap: 6, margin: '9px 0 0', color: '#537798', fontSize: 12 },
  error: { color: '#a56643' },
  footer: { marginTop: 11, display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' },
  button: { background: 'white', color: '#4b6e98', border: '1px solid #c7d6ec', borderRadius: 6, padding: '5px 9px', fontSize: 12, lineHeight: 1.6, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 },
  muted: { fontSize: 11, color: '#8d9eb4', marginLeft: 'auto' },
};

export default function WorkboardPerformanceLink({ data, ready }) {
  const [connection] = useState(connectionFromPage);
  const [active, setActive] = useState(Boolean(connection));
  const [view, setView] = useState({ stage: 'waiting', text: '', error: false, sent: 0 });
  const values = useRef({ data, ready });
  values.current = { data, ready };
  const activeRef = useRef(Boolean(connection));
  const epoch = useRef(0);
  const request = useRef(null);
  const sentSignature = useRef('');
  const migrationBusy = useRef(false);
  const snapshotSender = useRef(null);
  const stopped = useRef(null);

  useEffect(() => {
    if (!connection) return undefined;
    let mounted = true;
    let storageBlocked = '';
    const show = patch => { if (mounted) setView(previous => ({ ...previous, ...patch })); };
    const openerAvailable = () => {
      try { return window.opener === connection.opener && !connection.opener.closed; } catch { return false; }
    };
    const send = (type, requestId, payload) => {
      if (!mounted || !activeRef.current || !openerAvailable()) return false;
      connection.opener.postMessage({ channel: CHANNEL, version: VERSION, nonce: connection.nonce, type, ...(requestId ? { requestId } : {}), ...(payload !== undefined ? { payload } : {}) }, PERFORMANCE_ORIGIN);
      return true;
    };
    const fail = (requestId, error) => {
      const message = error?.message || '이전할 자료를 읽지 못했습니다. 원본 자료는 변경하지 않았습니다.';
      send('error', requestId, { message }); show({ stage: 'error', text: message, error: true });
    };
    const stop = (message, notify = true) => {
      if (!activeRef.current) return;
      if (notify) send('stopped', request.current?.id, { message });
      activeRef.current = false; epoch.current++; request.current = null; setActive(false);
      show({ stage: 'stopped', text: message, error: false });
      // A stopped bridge must not silently resume after a page reload.
      try { if (window.location.hash.includes(`performance-link=${connection.nonce}`)) window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`); } catch { /* The active flag still stops all transfers. */ }
    };
    stopped.current = stop;
    const sendSnapshot = (force = false) => {
      const current = request.current;
      if (!activeRef.current || connection.mode !== 'sync' || current?.kind !== 'snapshot' || !values.current.ready) return;
      try {
        if (storageBlocked) throw new Error(storageBlocked);
        // Another tab can save after the board's storedData prop was rendered.
        // For plaintext browser storage, read the durable value now instead of
        // allowing that older prop to replace a newer transmitted snapshot.
        const raw = localStorage.getItem(WORKBOARD_KEY);
        const source = raw !== null && !encryptedSource(raw) ? raw : values.current.data;
        const snapshot = createWorkboardSnapshot(source);
        const signature = JSON.stringify(snapshot.records);
        if (!force && signature === sentSignature.current) return;
        if (send('snapshot', current.id, snapshot)) {
          sentSignature.current = signature;
          show({ stage: 'sent', text: '새 실적 프로그램에서 저장 결과를 확인하고 있습니다.', error: false, sent: snapshot.records.length });
        }
      } catch (error) { fail(current.id, error); }
    };
    snapshotSender.current = sendSnapshot;
    const storageChanged = event => {
      if (!activeRef.current || connection.mode !== 'sync' || !values.current.ready || (event.key !== WORKBOARD_KEY && event.key !== null) || event.storageArea !== localStorage) return;
      try {
        // Read the current value, not event.newValue: queued storage events can
        // arrive after a later save. This listener never writes board data.
        const raw = localStorage.getItem(WORKBOARD_KEY);
        if (raw === null) storageBlocked = '다른 탭에서 업무보드 저장 자료가 제거되었습니다. 전송을 중지했습니다. 원본을 확인한 뒤 다시 연결해 주세요.';
        else if (encryptedSource(raw)) storageBlocked = '다른 탭의 암호화된 변경은 이 창에서 확인할 수 없어 전송을 중지했습니다. 연결을 중지한 뒤 실적 프로그램에서 다시 연결하고 업무보드 잠금을 해제해 주세요.';
        if (storageBlocked) { fail(request.current?.id, new Error(storageBlocked)); return; }
        sendSnapshot();
      } catch (error) {
        storageBlocked = error.message || '다른 탭에서 저장된 업무보드 내용을 확인하지 못했습니다. 원본을 확인한 뒤 다시 연결해 주세요.';
        fail(request.current?.id, new Error(storageBlocked));
      }
    };
    const sendMigration = async requestId => {
      if (migrationBusy.current) return;
      migrationBusy.current = true;
      const stamp = epoch.current;
      show({ stage: 'reading', text: '기존 실적 변경 이력과 기기 백업을 확인하고 있습니다.', error: false });
      try {
        const primary = readLocalEvents(localStorage);
        const secondary = await readLocalBackup();
        // Include changes saved while the IndexedDB snapshot was being read.
        const events = mergeEvents(primary, secondary, readLocalEvents(localStorage));
        if (events.length > 100000) throw new Error('이전할 실적 변경 이력이 너무 많습니다. 파일 백업으로 자료를 확인해 주세요.');
        const backup = backupText(events);
        if (new TextEncoder().encode(backup).length > LIMIT) throw new Error('이전할 실적 백업이 50MB를 초과합니다. 원본을 보관하고 이전 방법을 확인해 주세요.');
        const bindings = readBindings();
        if (!mounted || !activeRef.current || stamp !== epoch.current || request.current?.id !== requestId) return;
        if (!values.current.ready) throw new Error('업무보드 잠금 또는 저장 상태가 변경되었습니다. 잠금 해제와 저장 완료 후 다시 이전해 주세요.');
        if (send('migration', requestId, { backup, bindings })) show({ stage: 'sent', text: '새 실적 프로그램에서 저장 결과를 확인하고 있습니다. 이전 원본은 그대로 보존됩니다.', error: false, sent: events.length });
      } catch (error) { if (mounted && activeRef.current && stamp === epoch.current) fail(requestId, error); }
      finally { migrationBusy.current = false; }
    };
    const receive = event => {
      if (!activeRef.current || !openerAvailable() || event.origin !== PERFORMANCE_ORIGIN || event.source !== window.opener || event.source !== connection.opener) return;
      const message = event.data;
      if (!object(message) || message.channel !== CHANNEL || message.version !== VERSION || message.nonce !== connection.nonce || !TYPES.has(message.type)) return;
      if (message.type === 'stop') { stop('실적 프로그램과의 연결을 중지했습니다.', false); return; }
      if (message.type === 'hello') {
        if (values.current.ready) send('ready');
        return;
      }
      if (!requestIdValid(message.requestId)) return;
      if (message.type === 'ack') {
        if (message.requestId !== request.current?.id || !object(message.result)) return;
        const result = message.result;
        if (typeof result.error === 'string') {
          sentSignature.current = '';
          show({ stage: 'error', error: true, text: result.error.slice(0, 2000) || '새 실적 프로그램에서 저장을 완료하지 못했습니다. 원본 자료는 그대로 보존됩니다.' });
          return;
        }
        if (storageBlocked) return;
        show({ stage: 'acknowledged', error: false, text: connection.mode === 'migrate'
          ? '새 실적 프로그램의 저장 확인을 받았습니다. 기존 기록과 Google 자료는 삭제하지 않았습니다.'
          : `저장 확인 · 새로 가져옴 ${count(result.imported)}건 · 기존 기록 ${count(result.skipped)}건${count(result.changed) ? ` · 변경 확인 ${count(result.changed)}건` : ''}${count(result.missing) ? ` · 원본 확인 ${count(result.missing)}건` : ''}` });
        return;
      }
      if (!values.current.ready) return;
      if (message.type === 'request-snapshot') {
        if (connection.mode !== 'sync') { fail(message.requestId, new Error('이 창은 기존 실적 이전 전용입니다. 완료 상담 연결에서 다시 열어 주세요.')); return; }
        request.current = { id: message.requestId, kind: 'snapshot' };
        sendSnapshot(true);
      } else if (message.type === 'request-migration') {
        if (connection.mode !== 'migrate') { fail(message.requestId, new Error('이 창은 완료 상담 연결 전용입니다. 기존 실적 이전에서 다시 열어 주세요.')); return; }
        if (migrationBusy.current) return;
        request.current = { id: message.requestId, kind: 'migration' };
        void sendMigration(message.requestId);
      }
    };
    window.addEventListener('message', receive);
    window.addEventListener('storage', storageChanged);
    const timer = setInterval(() => {
      if (activeRef.current && !openerAvailable()) stop('실적 프로그램 창이 닫혀 연결이 끝났습니다. 다시 연결하려면 실적 프로그램에서 연결 버튼을 눌러 주세요.', false);
    }, 1000);
    if (values.current.ready) send('ready');
    return () => { mounted = false; epoch.current++; clearInterval(timer); window.removeEventListener('message', receive); window.removeEventListener('storage', storageChanged); snapshotSender.current = null; stopped.current = null; };
  }, [connection]);

  useEffect(() => { if (ready && active) snapshotSender.current?.(); }, [data, ready, active]);

  if (!connection) return null;
  const migrating = connection.mode === 'migrate';
  const working = active && ['reading', 'sent'].includes(view.stage);
  const waitingText = !ready ? '업무보드가 열리고 잠금 해제와 저장이 완료되면 연결할 수 있습니다.' : migrating ? '새 실적 프로그램의 이전 요청을 기다리고 있습니다.' : '새 실적 프로그램의 완료 상담 연결 요청을 기다리고 있습니다.';
  return <aside style={styles.shell} aria-label={migrating ? '실적 이전 연결' : '완료 상담 연결'}><div style={styles.top}>
    {view.error ? <TriangleAlert size={20} style={{ ...styles.icon, color: '#b27949' }} /> : <Link2 size={20} style={styles.icon} />}
    <div style={styles.body}><strong style={styles.title}>{migrating ? '기존 실적을 새 프로그램으로 이전' : active ? '상담 실적 프로그램과 연결 중' : '상담 실적 프로그램 연결 종료'}</strong><p style={styles.paragraph}>{migrating ? '이 브라우저의 실적 변경 이력 전체와 Google 연결 대상 ID만 전송합니다. 이전 자료와 업무보드 원본은 그대로 남습니다.' : '저장된 완료 상담의 날짜·사례코드·시간·진행 방식만 전송합니다. 내담자 이름과 상담일지·메모는 전송하지 않습니다.'}</p>
      <div style={{ ...styles.status, ...(view.error ? styles.error : {}) }} role={view.error ? 'alert' : 'status'} aria-live="polite">{working ? <Loader2 size={14} style={{ flexShrink: 0, marginTop: 3 }} /> : view.stage === 'acknowledged' ? <CheckCircle2 size={14} style={{ flexShrink: 0, marginTop: 3 }} /> : <ShieldCheck size={14} style={{ flexShrink: 0, marginTop: 3 }} />}<span>{active && !ready ? waitingText : view.text || waitingText}{view.sent ? ` · ${migrating ? '변경 이력' : '완료 상담'} ${view.sent.toLocaleString('ko-KR')}건` : ''}</span></div>
      <div style={styles.footer}>{active ? <button type="button" style={styles.button} onClick={() => stopped.current?.('업무보드 연결을 중지했습니다. 다시 연결하려면 실적 프로그램에서 연결 버튼을 눌러 주세요.')}><X size={13} />연결 중지</button> : <button type="button" style={styles.button} onClick={() => window.close()}><X size={13} />연결 창 닫기</button>}<button type="button" style={styles.button} onClick={() => { try { connection.opener.focus(); } catch { /* The closed-window state is shown by the timer. */ } }}><ArrowUpRight size={13} />실적 프로그램으로</button><span style={styles.muted}>{active && !migrating ? '이 창이 열려 있는 동안 자동 연결' : '원본 자료 보존'}</span></div>
    </div></div></aside>;
}
