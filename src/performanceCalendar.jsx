import { useEffect, useRef, useState } from 'react';
import { findApprovalItem } from './performanceApprovalCatalog.mjs';
import { normalizeSchedule, prepareSchedule, scheduleFingerprint, scheduleFromGoogle, scheduleGoogleEvent, scheduleGoogleId, scheduleImportedId, scheduleInWindow } from './performanceScheduleDomain.mjs';

const META = 'counseling-performance:v1:calendar';
function readMeta() { try { return JSON.parse(localStorage.getItem(META) || '{}'); } catch { return {}; } }
async function api(action, body, query = '') {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(`/api/performance-calendar?action=${action}${query}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      headers: { 'X-Workboard-Performance-Calendar': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify({ action, ...body }) }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.message || data.error?.message || '수련 캘린더 요청을 완료하지 못했습니다.'); Object.assign(error, { status: response.status, code: data.code || data.error?.code, remote: data.remote || data.error?.remote }); throw error; }
    return data;
  } catch (error) { if (error.name === 'AbortError') throw new Error('구글 캘린더 응답 시간이 초과되었습니다. 일정은 기기에 보관되어 있습니다.'); throw error; }
  finally { clearTimeout(timer); }
}
let googleReady;
function loadGoogle() {
  if (typeof window.google?.accounts?.oauth2?.initCodeClient === 'function') return Promise.resolve();
  if (!googleReady) {
    const pending = new Promise((resolve, reject) => {
      let settled = false;
      const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
      const finish = error => {
        if (settled) return; settled = true; clearTimeout(timeout); script.onload = null; script.onerror = null;
        if (error) { script.remove(); reject(error); } else resolve();
      };
      const timeout = setTimeout(() => finish(new Error('30초 동안 Google 연결 화면을 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 연결해 주세요. 계속되면 Chrome 또는 Edge에서 이 페이지를 열어 주세요.')), 30000);
      script.onload = () => finish(typeof window.google?.accounts?.oauth2?.initCodeClient === 'function' ? null : new Error('Google 연결 기능이 준비되지 않았습니다. 페이지를 새로고침한 뒤 다시 연결해 주세요.'));
      script.onerror = () => finish(new Error('Google 연결 화면을 불러오지 못했습니다. 인터넷 연결과 브라우저 차단 설정을 확인하고 다시 연결해 주세요.'));
      try { document.head.append(script); } catch { finish(new Error('Google 연결 화면을 열지 못했습니다. 페이지를 새로고침한 뒤 다시 연결해 주세요.')); }
    });
    googleReady = pending;
    void pending.catch(() => { if (googleReady === pending) googleReady = null; });
  }
  return googleReady;
}
function requestGoogleCode(config, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timeout); signal.removeEventListener('abort', cancelled);
      if (error) reject(error); else resolve(value);
    };
    const cancelled = () => finish(new Error('Google 연결 시도가 취소되었습니다. 연결 버튼에서 다시 시작해 주세요.'));
    const timeout = setTimeout(() => finish(new Error('5분 동안 Google 계정 승인을 확인하지 못했습니다. 열려 있는 계정 선택 창을 닫고 다시 연결해 주세요. 승인 창이 보이지 않으면 Chrome이나 Edge에서 사이트를 열고 다시 연결해 주세요.')), 5 * 60000);
    signal.addEventListener('abort', cancelled, { once: true });
    if (signal.aborted) { cancelled(); return; }
    try {
      window.google.accounts.oauth2.initCodeClient({ client_id: config.clientId, scope: config.scope, ux_mode: 'popup', select_account: true, include_granted_scopes: false,
        callback: value => finish(value?.error || !value?.code ? new Error('Google 캘린더 연결 승인이 완료되지 않았습니다. 다시 연결해 주세요.') : null, value),
        error_callback: error => finish(new Error(error?.type === 'popup_failed_to_open' ? 'Google 계정 선택 창이 차단되었습니다. 팝업을 허용하거나 Chrome 또는 Edge에서 이 페이지를 열고 다시 연결해 주세요.' : 'Google 연결 창이 닫혔거나 열리지 않았습니다. 연결 버튼에서 다시 시작해 주세요.')) }).requestCode();
    } catch { finish(new Error('Google 계정 선택 창을 열지 못했습니다. 팝업을 허용한 뒤 다시 연결해 주세요.')); }
  });
}
function defaultWindow() { const y = new Date().getFullYear(); return { from: `${y}-01-01`, to: `${y}-12-31` }; }
export function usePerformanceCalendar(store) {
  const [state, setState] = useState({ configured: false, connected: false, busy: false, error: '', lastSynced: readMeta().lastSynced || '', calendar: null });
  const storeRef = useRef(store), stateRef = useRef(state), alive = useRef(true), busy = useRef(false), generation = useRef(0), timer = useRef(null), windowRef = useRef(defaultWindow()), connectionAttempt = useRef(null);
  storeRef.current = store;
  const update = patch => { stateRef.current = { ...stateRef.current, ...patch }; if (alive.current) setState(stateRef.current); };
  const schedules = () => storeRef.current.getSnapshot().schedules || [];
  const latest = id => schedules().find(s => s.id === id);
  const save = list => storeRef.current.saveSchedules(list);
  const checkBinding = calendarId => { const previous = readMeta().calendarId || schedules().find(s => s.calendar.calendarId)?.calendar.calendarId; if (!calendarId || (previous && previous !== calendarId)) throw new Error('이 기기의 수련 캘린더와 연결 대상이 다릅니다. 원래 Google 계정으로 다시 연결해 주세요.'); };
  const safeRemote = (remote, previous, calendarId, localId) => {
    let normalized = scheduleFromGoogle(remote, previous, calendarId, localId);
    if (normalized?.itemId && findApprovalItem(normalized.itemId)?.scheme !== normalized.target) normalized = normalizeSchedule({ ...normalized, target: '', itemId: '' });
    return normalized;
  };
  const syncNow = async () => {
    if (busy.current || !navigator.onLine || !stateRef.current.connected) return;
    busy.current = true; const stamp = generation.current; update({ busy: true, error: '' });
    const active = () => stamp === generation.current && alive.current;
    try {
      const range = { ...windowRef.current }, response = await api('list', undefined, `&from=${range.from}&to=${range.to}`);
      if (!active()) return;
      checkBinding(response.calendarId);
      if (!Array.isArray(response.items) || response.from !== range.from || response.to !== range.to) throw new Error('전체 수련 일정의 조회 결과를 확인하지 못했습니다.');
      const calendarId = response.calendarId, remoteById = new Map();
      // Validate the complete snapshot before changing local data.
      for (const remote of response.items) {
        if (remoteById.has(remote.id)) throw new Error('구글 일정 목록에 중복 식별자가 있습니다.');
        safeRemote(remote, undefined, calendarId, await scheduleImportedId(calendarId, remote.id)); remoteById.set(remote.id, remote);
      }
      const before = schedules();
      for (const local of before) {
        if (local._conflict || !local.calendar.eventId || local.calendar.calendarId !== calendarId || !scheduleInWindow(local, range.from, range.to) || remoteById.has(local.calendar.eventId)) continue;
        // A missing window entry may have moved; only a per-event lookup can prove deletion.
        const result = await api('event', undefined, `&eventId=${encodeURIComponent(local.calendar.eventId)}`);
        if (!active()) return;
        if (result.calendarId !== calendarId || !Object.hasOwn(result, 'event')) throw new Error('개별 구글 일정의 조회 결과를 확인하지 못했습니다.');
        remoteById.set(local.calendar.eventId, result.event || { id: local.calendar.eventId, status: 'cancelled' });
      }
      const changes = [];
      for (const remote of remoteById.values()) {
        const marker = remote.extendedProperties?.private?.trainingScheduleId;
        const previous = before.find(s => s.calendar.calendarId === calendarId && s.calendar.eventId === remote.id)
          || before.find(s => s.id === marker && (!s.calendar.calendarId || s.calendar.calendarId === calendarId) && !s.calendar.eventId);
        if (previous?._conflict || (previous && latest(previous.id)?._revision !== previous._revision)) continue;
        const next = safeRemote(remote, previous, calendarId, previous?.id || await scheduleImportedId(calendarId, remote.id));
        if (!next) continue;
        if (previous && ['pending', 'error', 'local'].includes(previous.calendar.state)) {
          if (previous.calendar.action === 'delete' && remote.status === 'cancelled') changes.push({ ...previous, calendar: { ...next.calendar, action: 'delete' } });
          else if (previous.calendar.action !== 'delete' && remote.status !== 'cancelled' && scheduleFingerprint(next) === scheduleFingerprint(previous)) changes.push({ ...previous, calendar: { ...next.calendar, revision: previous.calendar.revision } });
          else if (remote.status === 'cancelled' || !previous.calendar.etag || previous.calendar.etag !== remote.etag) changes.push({ ...previous, calendar: { ...previous.calendar, state: 'conflict', remote, error: 'Google 캘린더에서도 일정이 변경되었거나 저장 결과를 확인하지 못했습니다. 사용할 내용을 선택해 주세요.' } });
          // Otherwise the unchanged remote revision is the base for the queued write.
        } else if (previous?.calendar.state === 'conflict') changes.push({ ...previous, calendar: { ...previous.calendar, remote } });
        else changes.push(next);
      }
      if (!active()) return;
      const applicable = changes.filter(change => {
        const now = latest(change.id);
        if (change._revision) return now?._revision === change._revision;
        return !now && !schedules().some(s => s.calendar.calendarId === calendarId && s.calendar.eventId === change.calendar.eventId);
      });
      if (applicable.length) await save(applicable);
      const queued = schedules().filter(s => !s._conflict && ['pending','error','local'].includes(s.calendar.state) && (!s.calendar.calendarId || s.calendar.calendarId === calendarId));
      for (const entry of queued) {
        if (!active()) return;
        const current = latest(entry.id); if (!current || current._revision !== entry._revision) continue;
        const eventId = current.calendar.eventId || await scheduleGoogleId(current.id);
        try {
          let result;
          if (current.calendar.action === 'delete') {
            if (!current.calendar.eventId) {
              const found = await api('event', undefined, `&eventId=${encodeURIComponent(eventId)}`);
              if (found.calendarId !== calendarId || !Object.hasOwn(found, 'event')) throw new Error('일정의 삭제 전 상태를 확인하지 못했습니다.');
              if (found.event && found.event.status !== 'cancelled') { const error = new Error('Google에 등록된 일정이 있습니다. 삭제 전에 현재 내용을 확인해 주세요.'); Object.assign(error, { code: 'calendar_conflict', remote: found.event }); throw error; }
              else result = { calendarId };
            } else result = await api('delete', { calendarId, eventId, etag: current.calendar.etag });
          } else result = await api('upsert', { calendarId, localId: current.id, ...(current.calendar.eventId ? { eventId: current.calendar.eventId, etag: current.calendar.etag } : {}), event: scheduleGoogleEvent(current) });
          if (!active()) return;
          if (result.calendarId !== calendarId) throw new Error('저장한 Google 캘린더가 변경되었습니다.');
          const now = latest(current.id); if (!now) continue;
          if (current.calendar.action === 'delete') {
            if (now._revision === current._revision) await save([{ ...now, calendar: { ...now.calendar, calendarId, eventId, state: 'synced', remoteCancelled: true, error: '', remote: null } }]);
          } else {
            if (!result.event || result.event.id !== eventId) throw new Error('수련 일정의 Google 저장 결과를 확인하지 못했습니다.');
            const confirmed = safeRemote(result.event, current, calendarId, current.id);
            const unchanged = now._revision === current._revision;
            await save([{ ...now, calendar: { ...now.calendar, calendarId, eventId, etag: confirmed.calendar.etag, baseFingerprint: scheduleFingerprint(confirmed), state: unchanged ? 'synced' : 'pending', error: '', remote: null, remoteCancelled: false } }]);
          }
        } catch (error) {
          if (!active()) return;
          if (error.status === 401) throw error;
          const now = latest(current.id); if (!now) continue;
          await save([{ ...now, calendar: { ...now.calendar, calendarId, state: error.code === 'calendar_conflict' || error.status === 409 ? 'conflict' : 'error', error: error.message, ...(error.remote ? { remote: error.remote } : {}) } }]);
        }
      }
      if (!active()) return;
      const remaining = schedules().filter(s => s.calendar.calendarId === calendarId && ['error','conflict'].includes(s.calendar.state));
      const lastSynced = new Date().toISOString(); localStorage.setItem(META, JSON.stringify({ calendarId, lastSynced }));
      update({ lastSynced, error: remaining.length ? `${remaining.length}개 일정의 동기화 상태를 확인해 주세요.` : '' });
    } catch (error) { if (active()) update({ error: error.message, ...(error.status === 401 ? { connected: false } : {}) }); }
    finally { busy.current = false; if (active()) update({ busy: false }); }
  };
  const syncRef = useRef(syncNow); syncRef.current = syncNow;
  const queue = () => { clearTimeout(timer.current); timer.current = setTimeout(() => void syncRef.current(), 1200); };
  useEffect(() => {
    alive.current = true;
    void (async () => {
      try { const result = await api('status'); if (!alive.current) return; if (result.connected) checkBinding(result.calendar?.id); update(result); if (result.configured) void loadGoogle().catch(() => {}); if (result.connected) await syncRef.current(); }
      catch (error) { update({ error: error.message }); }
    })();
    const wake = () => { if (document.visibilityState !== 'hidden') void syncRef.current(); }, interval = setInterval(wake, 60000);
    window.addEventListener('online', wake); window.addEventListener('focus', wake); document.addEventListener('visibilitychange', wake);
    return () => { alive.current = false; generation.current++; connectionAttempt.current?.abort(); clearTimeout(timer.current); clearInterval(interval); window.removeEventListener('online', wake); window.removeEventListener('focus', wake); document.removeEventListener('visibilitychange', wake); };
  }, []);
  return { ...state, pending: (store.schedules || []).filter(s => ['pending','error','local'].includes(s.calendar.state) && !s._conflict).length,
    syncNow: () => syncRef.current(),
    setWindow: (from, to) => { if (windowRef.current.from !== from || windowRef.current.to !== to) { windowRef.current = { from, to }; queue(); } },
    saveSchedule: async raw => {
      const previous = latest(raw.id), prepared = prepareSchedule(raw, previous, stateRef.current.calendar?.id || '');
      if (prepared.target && findApprovalItem(prepared.itemId)?.scheme !== prepared.target) throw new Error('수련 항목을 선택해 주세요.');
      await save([prepared]); queue(); return prepared;
    },
    cancelSchedule: async id => {
      const previous = latest(id); if (!previous) return;
      if (previous.status === 'done') throw new Error('이미 실적에 등록한 일정입니다. 실적은 활동 기록과 인정 현황에서 확인해 주세요.');
      await save([{ ...previous, status: 'cancelled', calendar: { ...previous.calendar, action: 'delete', state: stateRef.current.connected || previous.calendar.calendarId ? 'pending' : 'local', revision: previous.calendar.revision + 1, error: '', remote: null } }]); queue();
    },
    resolveConflict: async (id, choice) => {
      const previous = latest(id), remote = previous?.calendar.remote; if (!previous || !remote) throw new Error('최신 Google 일정을 먼저 동기화해 주세요.');
      if (choice === 'remote') {
        const remoteVersion = safeRemote(remote, previous, previous.calendar.calendarId, previous.id);
        await save([remoteVersion]);
      } else {
        if (remote.status === 'cancelled') throw new Error('Google에서 삭제된 일정은 새 일정으로 다시 등록해 주세요.');
        await save([{ ...previous, calendar: { ...previous.calendar, eventId: remote.id, etag: remote.etag, state: 'pending', remote: null, error: '', revision: previous.calendar.revision + 1 } }]); queue();
      }
    },
    completeSchedule: (id, details) => storeRef.current.completeSchedule(id, details),
    connect: async password => {
      connectionAttempt.current?.abort();
      const attempt = new AbortController(); connectionAttempt.current = attempt;
      const activeAttempt = () => alive.current && connectionAttempt.current === attempt && !attempt.signal.aborted;
      const ensureActive = () => { if (!activeAttempt()) throw new Error('Google 연결 시도가 취소되었습니다. 연결 버튼에서 다시 시작해 주세요.'); };
      update({ error: '' });
      try {
        await loadGoogle(); ensureActive();
        const config = await api('connect', { password: password || '' }); ensureActive();
        const result = await requestGoogleCode(config, attempt.signal); ensureActive();
        generation.current++; const saved = readMeta().calendarId || schedules().find(s => s.calendar.calendarId)?.calendar.calendarId;
        const response = await api('exchange', { code: result.code, ...(saved ? { calendarId: saved } : {}) });
        ensureActive();
        checkBinding(response.calendar?.id); localStorage.setItem(META, JSON.stringify({ ...readMeta(), calendarId: response.calendar.id })); update({ connected: true, calendar: response.calendar, busy: false }); queue();
      } catch (error) { if (activeAttempt()) update({ error: error.message }); throw error; }
      finally { if (connectionAttempt.current === attempt) connectionAttempt.current = null; }
    },
    disconnect: async () => { connectionAttempt.current?.abort(); generation.current++; await api('disconnect', {}); update({ connected: false, busy: false, error: '' }); },
  };
}
