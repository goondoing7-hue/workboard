import { useEffect, useMemo, useRef, useState } from 'react';
import { createEvent, normalizeRecord, validateRecord, normalizeApproval, validateApproval, normalizeSupervisor, validateSupervisor, resetChangedApproval, scheduleCompletionEvents, recordsFor, mergeEvents, localDate, canonicalJSON } from './performanceDomain.mjs';
import { EVENT_PREFIX, META_KEY, readLocalEvents, writeLocalEvents, readLocalBackup, writeLocalBackup, parseBackup, backupText, quarantineCorruptEvents } from './performancePersistence.mjs';
import { createWorkboardSnapshot, planWorkboardImport } from './performanceWorkboardLink.mjs';
import { normalizeSchedule, validateSchedule } from './performanceScheduleDomain.mjs';

const endpoint = '/api/performance-sheets';
const download = (text, name, type = 'application/json') => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
async function request(action, body, extra = '') {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${endpoint}?action=${action}${extra}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      headers: { 'X-Workboard-Performance': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify({ action, ...body }) } : {}) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.message || data.error?.message || (typeof data.error === 'string' ? data.error : '') || 'Google Sheets 요청을 완료하지 못했습니다.'); error.status = response.status; throw error; }
    return data;
  } catch (error) { if (error.name === 'AbortError') throw new Error('Google Sheets 응답 시간이 초과되었습니다. 기기 기록은 보존되며 다시 시도합니다.'); throw error; }
  finally { clearTimeout(timer); }
}
let googleReady;
function loadGoogle() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (googleReady) return googleReady;
  googleReady = new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
    script.onload = () => resolve(); script.onerror = () => { googleReady = null; reject(new Error('Google 연결 화면을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.')); }; document.head.append(script);
  });
  return googleReady;
}
function readMeta() { try { return JSON.parse(localStorage.getItem(META_KEY) || '{}'); } catch { return {}; } }
function sheetDetails(data) {
  const sheet = data.sheet || {};
  return { sheetId: sheet.id || sheet.spreadsheetId || data.spreadsheetId || '', spreadsheetUrl: sheet.url || sheet.webViewLink || data.spreadsheetUrl || '' };
}
export function usePerformanceStore() {
  const [events, setEvents] = useState([]), [storageError, setStorageError] = useState('');
  const [sync, setSync] = useState({ configured: false, connected: false, busy: false, pending: 0, lastSynced: '', error: '', spreadsheetUrl: '', passwordRequired: false });
  const current = useRef([]), live = useRef(true), inFlight = useRef(false), ready = useRef(false), timer = useRef(null), status = useRef(sync), authConfig = useRef(null), generation = useRef(0);
  const updateSync = patch => {
    const next = { ...status.current, ...patch }; status.current = next;
    if (live.current) setSync(next);
  };
  const refresh = list => {
    current.current = list; if (live.current) setEvents(list);
    const meta = readMeta(), ack = new Set(meta.accepted || []);
    updateSync({ pending: list.filter(e => !ack.has(e.id)).length });
  };
  const saveEvents = async list => {
    if (!ready.current) throw new Error('기기 저장소를 확인한 뒤 다시 저장해 주세요.');
    try { const all = writeLocalEvents(localStorage, list); refresh(all); }
    catch (error) { setStorageError(`기기 저장 실패: ${error.message}`); throw error; }
    try { await writeLocalBackup(list); setStorageError(''); }
    catch (error) { setStorageError(`주 기록은 기기에 저장되었습니다. ${error.message}`); }
    clearTimeout(timer.current); timer.current = setTimeout(() => void syncRef.current(), 1200);
    return list;
  };
  const syncNow = async (allowBinding = false) => {
    if (inFlight.current || !ready.current || !navigator.onLine || !status.current.connected) return;
    inFlight.current = true; updateSync({ busy: true, error: '' });
    const stamp = generation.current;
    try {
      let cursor = 0, sheet, remote = [], loops = 0;
      do {
        const page = await request('events', undefined, `&cursor=${cursor}`);
        if (stamp !== generation.current || !live.current) return;
        if (!Array.isArray(page.events)) throw new Error('Google Sheets의 기록 형식을 확인하지 못했습니다.');
        const pageSheetId = sheetDetails(page).sheetId;
        if (!pageSheetId || (sheet && sheetDetails({ sheet }).sheetId !== pageSheetId)) throw new Error('백업 조회 중 Google Sheets 저장 대상이 변경되었습니다. 다시 연결해 주세요.');
        remote.push(...page.events); sheet = page.sheet;
        const next = page.nextCursor;
        if (next != null && (!Number.isInteger(next) || next <= cursor || ++loops > 1000)) throw new Error('Google Sheets 전체 기록을 확인하지 못했습니다.');
        cursor = next;
      } while (cursor != null);
      const details = sheetDetails({ sheet });
      if (!details.sheetId) throw new Error('백업 스프레드시트 식별자를 확인하지 못했습니다.');
      const meta = readMeta();
      if (meta.sheetId && meta.sheetId !== details.sheetId) throw new Error('이 기기의 기록과 연결된 Google Sheets가 다릅니다. 원래 Google 계정으로 다시 연결해 주세요.');
      if (!meta.sheetId && current.current.length && !allowBinding) throw new Error('기기 기록을 백업하려면 Google 계정 연결 버튼으로 저장 대상을 확인해 주세요.');
      // Fully read and validate before mutating any local state or acknowledging uploads.
      const all = mergeEvents(readLocalEvents(localStorage), remote);
      writeLocalEvents(localStorage, remote); refresh(all);
      try { await writeLocalBackup(all); } catch (error) { setStorageError(error.message); }
      // A past receipt is not proof a row still exists in the remote backup.
      const accepted = new Set(remote.map(e => e.id));
      const persistReceipt = () => {
        localStorage.setItem(META_KEY, JSON.stringify({ ...details, accepted: [...accepted], lastSynced: new Date().toISOString() }));
        updateSync({ ...details, lastSynced: new Date().toISOString(), pending: current.current.filter(e => !accepted.has(e.id)).length });
      };
      persistReceipt();
      const pending = all.filter(e => !accepted.has(e.id));
      for (let i = 0; i < pending.length; i += 50) {
        if (stamp !== generation.current || !live.current) return;
        const batch = pending.slice(i, i + 50), response = await request('append', { events: batch, sheetId: details.sheetId });
        if (stamp !== generation.current || !live.current) return;
        if (!Array.isArray(response.acceptedIds) || batch.some(e => !response.acceptedIds.includes(e.id))) throw new Error('일부 기록의 백업 완료를 확인하지 못했습니다. 다시 전송합니다.');
        const responseDetails = sheetDetails(response);
        if (responseDetails.sheetId && responseDetails.sheetId !== details.sheetId) throw new Error('백업 저장 대상이 변경되었습니다.');
        batch.forEach(e => accepted.add(e.id)); persistReceipt();
      }
      updateSync({ error: '', ...details });
    } catch (error) { updateSync({ error: error.message, ...(error.status === 401 ? { connected: false } : {}) }); }
    finally { inFlight.current = false; updateSync({ busy: false }); }
  };
  const syncRef = useRef(syncNow); syncRef.current = syncNow;
  useEffect(() => {
    live.current = true;
    try { refresh(readLocalEvents(localStorage)); ready.current = true; } catch (error) { setStorageError(error.message); }
    void (async () => {
      try {
        const backed = await readLocalBackup(); if (!live.current || !ready.current) return;
        const all = writeLocalEvents(localStorage, backed); refresh(all); await writeLocalBackup(all);
      } catch (error) { if (live.current) setStorageError(error.message); }
    })();
    void (async () => {
      try {
        const data = await request('status'); if (!live.current) return;
        authConfig.current = data;
        updateSync({ configured: !!data.configured, connected: !!data.connected, passwordRequired: !!data.passwordRequired, ...sheetDetails(data), lastSynced: readMeta().lastSynced || '' });
        if (data.configured) void loadGoogle().catch(() => {});
        if (data.connected) await syncRef.current();
      } catch (error) { updateSync({ error: error.message }); }
    })();
    const wake = () => { if (document.visibilityState !== 'hidden') void syncRef.current(); };
    const storage = e => { if (e.key?.startsWith(EVENT_PREFIX) || e.key === META_KEY) { try { refresh(readLocalEvents(localStorage)); } catch (error) { setStorageError(error.message); } } };
    const interval = setInterval(wake, 60000);
    window.addEventListener('online', wake); window.addEventListener('focus', wake); window.addEventListener('storage', storage); document.addEventListener('visibilitychange', wake);
    return () => { live.current = false; generation.current++; clearTimeout(timer.current); clearInterval(interval); window.removeEventListener('online', wake); window.removeEventListener('focus', wake); window.removeEventListener('storage', storage); document.removeEventListener('visibilitychange', wake); };
  }, []);
  const materialized = useMemo(() => recordsFor(events), [events]);
  return { ...materialized, storageError, sync, getSnapshot: () => recordsFor(current.current),
    saveRecord: async raw => {
      const inputError = validateRecord(raw); if (inputError) throw new Error(inputError);
      const record = normalizeRecord(raw); record.id ||= crypto.randomUUID(); record.needsReview = false;
      const error = validateRecord(record); if (error) throw new Error(error);
      const previous = recordsFor(current.current).records.find(r => r.id === record.id);
      const base = record._revision || previous?._revision || '';
      if (previous) {
        const meaningful = r => Object.fromEntries(['date', 'caseId', 'activity', 'sessions', 'participants', 'minutes', 'institution', 'format', 'status', 'testName', 'testCaseId', 'testCategory', 'groupName', 'groupCategory', 'groupRole', 'participantIds', 'age', 'gender', 'supervisorId', 'supervisor'].map(key => [key, r[key]]));
        if (canonicalJSON(meaningful(previous)) !== canonicalJSON(meaningful(record))) {
          for (const channel of ['center', 'supervisor']) if (previous.recognition[channel].status === 'approved') record.recognition[channel] = { ...record.recognition[channel], status: 'requested', confirmedOn: '' };
        }
      }
      delete record._revision;
      await saveEvents([createEvent('record', record.id, record, base)]); return record;
    },
    saveApproval: async raw => {
      const state = recordsFor(current.current), previous = state.approvalEntries.find(item => item.id === raw?.id);
      const input = { ...raw }; delete input._sourceReview; delete input._conflict;
      const supervisor = state.supervisors.find(item => item.id === input.supervisorId);
      if (input.supervisorId && (input.supervisorId !== previous?.supervisorId || !input.supervisorName)) {
        if (!supervisor || supervisor._conflict) throw new Error('선택한 수퍼바이저 정보를 확인해 주세요.');
        input.supervisorName = supervisor.name;
      }
      const source = state.records.find(item => item.id === input.sourceRecordId);
      input.sourceRevision = input.sourceRecordId ? source?._revision || input.sourceRevision || '' : '';
      // Validate raw fields first; approval-specific requirements are checked after
      // changed approved entries are returned to the requested state.
      const inputError = validateApproval({ ...input, status: input.status === 'approved' ? 'pending' : input.status }); if (inputError) throw new Error(inputError);
      let approval = normalizeApproval(input); approval.id ||= crypto.randomUUID();
      approval = resetChangedApproval(previous, approval);
      if (approval.status === 'approved' && approval.sourceRecordId && (!source || source._conflict || source.needsReview || source.status !== 'done')) throw new Error('연결 활동을 완료·검토한 뒤 항목을 승인해 주세요.');
      const error = validateApproval(approval); if (error) throw new Error(error);
      const base = approval._revision || previous?._revision || ''; delete approval._revision;
      await saveEvents([createEvent('approval', approval.id, approval, base)]); return approval;
    },
    removeApproval: async id => { const approval = recordsFor(current.current).approvalEntries.find(item => item.id === id); if (approval) await saveEvents([createEvent('approval', id, { deleted: true }, approval._revision)]); },
    saveSupervisor: async raw => {
      const input = { ...raw }; delete input._conflict;
      const inputError = validateSupervisor(input); if (inputError) throw new Error(inputError);
      const supervisor = normalizeSupervisor(input); supervisor.id ||= crypto.randomUUID();
      const previous = recordsFor(current.current).supervisors.find(item => item.id === supervisor.id);
      const base = supervisor._revision || previous?._revision || ''; delete supervisor._revision;
      await saveEvents([createEvent('supervisor', supervisor.id, supervisor, base)]); return supervisor;
    },
    removeSupervisor: async id => { const supervisor = recordsFor(current.current).supervisors.find(item => item.id === id); if (supervisor) await saveEvents([createEvent('supervisor', id, { deleted: true }, supervisor._revision)]); },
    saveSchedules: async list => {
      if (!Array.isArray(list)) throw new Error('저장할 일정 목록을 확인해 주세요.');
      const state = recordsFor(current.current), changes = [], ids = new Set();
      for (const raw of list) {
        const input = { ...raw }; delete input._conflict;
        const inputError = validateSchedule(input); if (inputError) throw new Error(inputError);
        const schedule = normalizeSchedule(input); schedule.id ||= crypto.randomUUID();
        if (ids.has(schedule.id)) throw new Error('같은 일정을 한 번에 중복 저장할 수 없습니다.'); ids.add(schedule.id);
        const previous = state.schedules.find(item => item.id === schedule.id);
        const base = schedule._revision || previous?._revision || ''; delete schedule._revision;
        const old = previous ? normalizeSchedule(previous) : null; if (old) delete old._revision;
        if (old && canonicalJSON(old) === canonicalJSON(schedule)) continue;
        changes.push(createEvent('schedule', schedule.id, schedule, base));
      }
      if (changes.length) await saveEvents(changes);
      return changes.map(change => ({ ...change.payload, _revision: change.id }));
    },
    removeSchedule: async id => { const schedule = recordsFor(current.current).schedules.find(item => item.id === id); if (schedule) await saveEvents([createEvent('schedule', id, { deleted: true }, schedule._revision)]); },
    completeSchedule: async (id, options = {}) => {
      // Read the persisted log again so retrying a partially written batch reuses
      // the same activity and approval instead of creating duplicate performance.
      const result = scheduleCompletionEvents(readLocalEvents(localStorage), id, options);
      if (result.events.length) await saveEvents(result.events);
      return { recordId: result.recordId, approvalId: result.approvalId, alreadyCompleted: result.alreadyCompleted };
    },
    saveProfile: async profile => { const base = profile._revision || recordsFor(current.current).profile._revision || ''; const payload = { ...profile }; delete payload._revision; delete payload._conflict; await saveEvents([createEvent('profile', 'profile', payload, base)]); },
    removeRecord: async id => { const record = recordsFor(current.current).records.find(r => r.id === id); if (record) await saveEvents([createEvent('record', id, { deleted: true }, record._revision)]); },
    resolveConflict: async (entityId, eventId) => { const conflict = recordsFor(current.current).conflicts.find(c => c.entityId === entityId && c.versions.some(e => e.id === eventId)); const selected = conflict?.versions.find(e => e.id === eventId); if (!selected) throw new Error('선택한 변경 기록을 찾을 수 없습니다.'); await saveEvents([createEvent(selected.entityType, entityId, { ...selected.payload, _resolves: conflict.versions.map(e => e.id) }, selected.id)]); },
    exportBackup: () => {
      if (!ready.current) throw new Error('기기 기록을 읽지 못해 전체 백업을 만들 수 없습니다. 기존 백업 파일로 먼저 복구해 주세요.');
      download(backupText(readLocalEvents(localStorage)), `상담실적_전체백업_${localDate()}.json`);
    },
    importBackup: async file => {
      if (file.size > 50 * 1024 * 1024) throw new Error('백업은 50MB 이하 파일을 선택해 주세요.');
      const list = parseBackup(await file.text());
      try { readLocalEvents(localStorage); }
      catch { quarantineCorruptEvents(localStorage); refresh(readLocalEvents(localStorage)); }
      ready.current = true;
      const old = new Set(current.current.map(e => e.id)); await saveEvents(list); return { imported: list.filter(e => !old.has(e.id)).length };
    },
    importWorkboard: async () => {
      const raw = localStorage.getItem('workboard:data');
      if (!raw) throw new Error('이 주소에 업무보드 기록이 없습니다. 업무보드 연결을 이용해 주세요.');
      const result = planWorkboardImport(createWorkboardSnapshot(raw), readLocalEvents(localStorage));
      if (result.events.length) await saveEvents(result.events); return result;
    },
    importWorkboardSnapshot: async snapshot => {
      const result = planWorkboardImport(snapshot, readLocalEvents(localStorage));
      if (result.events.length) await saveEvents(result.events); return result;
    },
    importLinkedBackup: async payload => {
      if (!payload || typeof payload.backup !== 'string' || new TextEncoder().encode(payload.backup).length > 50 * 1024 * 1024) throw new Error('이전할 실적 백업 형식이나 크기를 확인해 주세요.');
      const list = parseBackup(payload.backup), bindings = payload.bindings || {};
      const existing = readLocalEvents(localStorage);
      let previous; try { previous = JSON.parse(localStorage.getItem(META_KEY) || '{}'); } catch { throw new Error('이 기기의 기존 Google Sheets 연결을 확인해 주세요.'); }
      let calendarMeta; try { calendarMeta = JSON.parse(localStorage.getItem('counseling-performance:v1:calendar') || '{}'); } catch { throw new Error('이 기기의 기존 캘린더 연결을 확인해 주세요.'); }
      if ([bindings, previous, calendarMeta].some(value => !value || typeof value !== 'object' || Array.isArray(value))) throw new Error('기존 Google 연결 정보의 형식을 확인해 주세요.');
      for (const field of ['sheetId', 'calendarId']) if (bindings[field] != null && (typeof bindings[field] !== 'string' || bindings[field].length > 512 || /[\s\x00-\x1f]/.test(bindings[field]))) throw new Error('기존 Google 연결 식별자를 확인해 주세요.');
      if (bindings.sheetId && previous.sheetId && previous.sheetId !== bindings.sheetId) throw new Error('이 기기와 이전 사이트의 Google Sheets가 다릅니다. 기존 백업 연결을 확인해 주세요.');
      // Bindings can be absent after a storage restore. Check every persisted
      // schedule revision on both sides instead of trusting only the metadata
      // or whichever calendar happens to appear first in the rendered state.
      const scheduleCalendars = [...existing, ...list].filter(event => event.entityType === 'schedule').map(event => event.payload.calendar?.calendarId);
      const calendarIds = new Set([calendarMeta.calendarId, bindings.calendarId, ...scheduleCalendars].filter(value => value != null && value !== ''));
      for (const id of calendarIds) if (typeof id !== 'string' || id.length > 300 || /[\s\x00-\x1f]/.test(id)) throw new Error('수련 일정에 저장된 Google 캘린더 식별자를 확인해 주세요.');
      if (calendarIds.size > 1) throw new Error('이 기기와 이전 자료에 서로 다른 수련 캘린더가 있습니다. 기존 캘린더 연결을 확인해 주세요.');
      const calendarId = [...calendarIds][0] || '';
      mergeEvents(existing, list);
      const oldIds = new Set(existing.map(event => event.id)); await saveEvents(list);
      // Only stable bindings travel. OAuth cookies and cloud upload receipts stay on their origin.
      if (bindings.sheetId && !previous.sheetId) localStorage.setItem(META_KEY, JSON.stringify({ ...previous, sheetId: bindings.sheetId }));
      if (calendarId && !calendarMeta.calendarId) localStorage.setItem('counseling-performance:v1:calendar', JSON.stringify({ ...calendarMeta, calendarId }));
      return { imported: list.filter(event => !oldIds.has(event.id)).length };
    },
    connect: async password => {
      updateSync({ error: '' });
      try {
        await loadGoogle(); const config = await request('connect', { password: password || '' });
        const result = await new Promise((resolve, reject) => {
          const client = window.google.accounts.oauth2.initCodeClient({ client_id: config.clientId || authConfig.current?.clientId, scope: config.scope || authConfig.current?.scope, ux_mode: 'popup', select_account: true, include_granted_scopes: false,
            callback: result => result.error ? reject(new Error('Google 계정 연결 승인이 완료되지 않았습니다.')) : resolve(result),
            error_callback: () => reject(new Error('Google 연결 창이 닫혔거나 차단되었습니다. 다시 연결해 주세요.')) }); client.requestCode();
        });
        const savedSheet = readMeta().sheetId;
        const response = await request('exchange', { code: result.code, ...(savedSheet ? { sheetId: savedSheet } : {}) });
        updateSync({ connected: true, ...sheetDetails(response) }); await syncRef.current(true);
      } catch (error) { updateSync({ error: error.message }); throw error; }
    },
    disconnect: async () => { generation.current++; await request('disconnect', {}); updateSync({ connected: false, busy: false, error: '' }); },
    syncNow: () => syncRef.current(),
  };
}
