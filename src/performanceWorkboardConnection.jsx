import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Link2, RefreshCw, Unplug } from 'lucide-react';
import { WORKBOARD_ORIGIN, PERFORMANCE_HOME, STANDALONE, LINK_CHANNEL, validLinkMessage, linkNonce } from './performanceDeployment.mjs';

export function useWorkboardConnection(store) {
  const [state, setState] = useState({ connected: false, busy: false, error: '', message: '', differences: [], missing: [], imported: 0 });
  const session = useRef(null), storeRef = useRef(store), alive = useRef(true);
  storeRef.current = store;
  const update = patch => { if (alive.current) setState(current => ({ ...current, ...patch })); };
  const post = (entry, type, extra = {}) => { if (entry?.popup && !entry.popup.closed) entry.popup.postMessage({ channel: LINK_CHANNEL, version: 1, nonce: entry.nonce, type, requestId: entry.requestId, ...extra }, WORKBOARD_ORIGIN); };
  const stop = (notify = true) => {
    const entry = session.current; session.current = null;
    if (entry) { clearInterval(entry.hello); clearInterval(entry.watch); clearTimeout(entry.timeout); if (notify) post(entry, 'stop'); }
    update({ connected: false, busy: false });
  };
  useEffect(() => {
    alive.current = true;
    const receive = event => {
      const entry = session.current;
      if (!entry || !validLinkMessage(event, { source: entry.popup, origin: WORKBOARD_ORIGIN, nonce: entry.nonce, types: ['ready', 'snapshot', 'migration', 'error', 'stopped'] })) return;
      const message = event.data;
      if (message.type === 'ready') {
        if (entry.ready) return; entry.ready = true; clearInterval(entry.hello); clearTimeout(entry.timeout);
        entry.timeout = setTimeout(() => { if (session.current === entry) { stop(); update({ error: '업무보드에서 기록을 받지 못했습니다. 업무보드의 잠금과 연결 상태를 확인한 뒤 다시 연결해 주세요.' }); } }, 60000);
        post(entry, entry.mode === 'migrate' ? 'request-migration' : 'request-snapshot'); return;
      }
      if (message.requestId !== entry.requestId) return;
      if (message.type === 'stopped') { stop(false); update({ message: '업무보드 연결을 중지했습니다.' }); return; }
      if (message.type === 'error') { clearTimeout(entry.timeout); update({ busy: false, error: typeof message.payload?.message === 'string' ? message.payload.message.slice(0, 500) : '업무보드에서 기록을 읽지 못했습니다.' }); return; }
      if (!entry.ready || (message.type === 'migration') !== (entry.mode === 'migrate')) return;
      // Queue arrivals so a second snapshot cannot plan against an unfinished save.
      entry.queue = entry.queue.then(async () => {
        if (session.current !== entry) return;
        clearTimeout(entry.timeout);
        try {
          update({ busy: true, error: '' });
          const result = entry.mode === 'migrate' ? await storeRef.current.importLinkedBackup(message.payload) : await storeRef.current.importWorkboardSnapshot(message.payload);
          if (session.current !== entry) return;
          post(entry, 'ack', { result: { imported: result.imported, skipped: result.skipped || 0, changed: result.differences?.length || 0, missing: result.missing?.length || 0 } });
          update({ connected: entry.mode === 'sync', busy: false, imported: result.imported,
            ...(entry.mode === 'sync' ? { differences: result.differences, missing: result.missing } : {}),
            message: entry.mode === 'migrate' ? `기존 실적의 변경 이력 ${result.imported}건을 복사했습니다. 원본은 그대로 보관되어 있습니다.` : `업무보드와 연결되었습니다. 새 완료 상담 ${result.imported}건을 가져왔습니다.` });
          if (entry.mode === 'migrate') stop(false);
        } catch (error) { if (session.current === entry) { update({ busy: false, error: error.message }); post(entry, 'ack', { result: { error: '실적 사이트 저장을 완료하지 못했습니다. 원본은 유지됩니다.' } }); } }
      });
    };
    window.addEventListener('message', receive);
    return () => { alive.current = false; stop(); window.removeEventListener('message', receive); };
  }, []);
  const connect = mode => {
    stop();
    const nonce = linkNonce(), requestId = crypto.randomUUID();
    // Open immediately inside the user gesture; no auth or data travels in the URL.
    const popup = window.open(`${WORKBOARD_ORIGIN}/#performance-link=${nonce}&mode=${mode}`, `workboard-performance-${nonce}`, 'popup,width=1100,height=800');
    if (!popup) { update({ error: '업무보드 연결 창이 차단되었습니다. 팝업을 허용하거나 Chrome·Edge에서 다시 연결해 주세요.' }); return; }
    const entry = { popup, nonce, requestId, mode, ready: false, queue: Promise.resolve() }; session.current = entry;
    update({ busy: true, connected: false, error: '', message: mode === 'migrate' ? '기존 실적을 읽고 있습니다. 업무보드에 잠금이 있으면 연결 창에서 해제해 주세요.' : '업무보드를 연결하고 있습니다. 잠금이 있으면 연결 창에서 해제해 주세요.' });
    const hello = () => post(entry, 'hello'); hello(); entry.hello = setInterval(hello, 1000);
    entry.watch = setInterval(() => { if (popup.closed && session.current === entry) { stop(false); update({ message: '업무보드 연결 창이 닫혔습니다. 다시 연결하면 새 완료 상담을 가져옵니다.' }); } }, 1000);
    entry.timeout = setTimeout(() => { if (session.current === entry) { stop(); update({ error: '업무보드 연결을 확인하지 못했습니다. 로그인·잠금을 확인한 뒤 다시 연결해 주세요.' }); } }, 120000);
  };
  return { ...state, connect: () => connect('sync'), migrate: () => connect('migrate'), disconnect: () => stop(), refresh: () => { const entry = session.current; if (entry?.ready) post(entry, 'request-snapshot'); } };
}

export default function WorkboardConnectionPanel({ connection, onReview }) {
  if (!STANDALONE) return <section className="perf-note" style={{ marginBottom: 20 }}><Link2 size={20}/><div><strong>상담 실적 관리가 독립 사이트로 분리되었습니다.</strong><p style={{ margin: '6px 0', lineHeight: 1.6 }}>새 사이트의 ‘기존 실적 옮기기’로 현재 기록을 복사할 수 있습니다. 이곳의 원본과 백업은 유지됩니다.</p><a className="perf-button perf-primary" href={PERFORMANCE_HOME} target="_blank" rel="noopener noreferrer">새 실적 사이트 열기 <ArrowUpRight size={16}/></a></div></section>;
  return <section className="perf-panel" style={{ padding: 20, marginBottom: 20 }} aria-label="업무보드 연동">
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}><Link2 size={21}/><h2 style={{ fontSize: 17, margin: 0 }}>업무보드 연동</h2><span style={{ color: '#68778b' }}>{connection.connected ? '연결됨' : '별도 사이트 · 내 기록은 이 기기에 저장'}</span></div>
    <p style={{ margin: '10px 0 14px', lineHeight: 1.7, color: '#68778b' }}>업무보드의 완료 상담을 가져옵니다. 연결 창을 열어두면 새 완료 상담이 자동으로 들어오며, 실제 시간과 활동을 확인한 뒤 실적에 반영합니다.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9 }}>
      {connection.connected ? <><button className="perf-button" onClick={connection.refresh} disabled={connection.busy}><RefreshCw size={16}/>지금 가져오기</button><button className="perf-button" onClick={connection.disconnect}><Unplug size={16}/>연결 중지</button></> : <button className="perf-button perf-primary" onClick={connection.connect} disabled={connection.busy}><Link2 size={16}/>업무보드 연결</button>}
      <button className="perf-button" onClick={connection.migrate} disabled={connection.busy}>기존 실적 옮기기</button>
      <a className="perf-button" href={WORKBOARD_ORIGIN} target="_blank" rel="noopener noreferrer">업무보드 열기 <ArrowUpRight size={16}/></a>
    </div>
    <p style={{ fontSize: 13, color: '#68778b', lineHeight: 1.6, margin: '12px 0 0' }}>상담 연동에는 사례코드·일정·진행 시간만 사용합니다. ‘기존 실적 옮기기’는 이전 사이트의 실적·승인·수퍼바이저·수련 일정과 관리 메모를 복사합니다.</p>
    {connection.message ? <p role="status" style={{ margin: '12px 0 0', color: '#2d527b' }}>{connection.message}</p> : null}
    {connection.error ? <p role="alert" style={{ margin: '12px 0 0', color: '#b53430' }}>{connection.error}</p> : null}
    {connection.differences.length ? <div style={{ marginTop: 15 }}><strong>업무보드에서 바뀐 상담 {connection.differences.length}건</strong><p style={{ fontSize: 13, color: '#68778b' }}>기존 실적과 승인 내역은 유지했습니다. 바뀐 내용을 확인해 적용하세요.</p>{connection.differences.map(change => <div key={change.id} style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 7 }}><span>{change.suggested.date} · {change.suggested.caseId || '사례코드 없음'}</span><button className="perf-button" onClick={() => onReview(change)}>변경 검토</button></div>)}</div> : null}
    {connection.missing.length ? <p style={{ margin: '12px 0 0', color: '#8d6216' }}>기존에 가져온 상담 {connection.missing.length}건이 업무보드의 현재 완료 목록에 없습니다. 이미 작성한 실적은 보존했습니다. 해당 활동의 진행 상태를 확인해 주세요.</p> : null}
  </section>;
}
