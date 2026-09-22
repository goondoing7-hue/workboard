import { mergeEvents, validateEvent, stableEvent, eventGraphProblems } from './performanceDomain.mjs';

export const EVENT_PREFIX = 'counseling-performance:v1:event:';
export const META_KEY = 'counseling-performance:v1:cloud';
export const QUARANTINE_PREFIX = 'counseling-performance:v1:quarantine:';
export function quarantineCorruptEvents(storage) {
  const snapshots = [], events = [], invalid = new Map();
  // Snapshot keys before adding quarantine entries; never clear the storage namespace.
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(EVENT_PREFIX)) snapshots.push({ key, raw: storage.getItem(key) });
  }
  for (const item of snapshots) {
    if (item.raw == null) continue;
    try {
      const event = JSON.parse(item.raw), problem = validateEvent(event);
      if (problem) throw new Error(problem);
      if (item.key !== EVENT_PREFIX + event.id) throw new Error('변경 ID와 저장 키가 일치하지 않습니다.');
      events.push(event);
    } catch (error) { invalid.set(item.key, error.message); }
  }
  for (const [id, reason] of eventGraphProblems(events)) invalid.set(EVENT_PREFIX + id, reason);
  let quarantined = 0, skipped = 0;
  for (const item of snapshots) {
    if (!invalid.has(item.key)) continue;
    // A repair from another tab may have replaced the examined value since the scan.
    if (storage.getItem(item.key) !== item.raw) { skipped++; continue; }
    const stamp = new Date().toISOString(), key = `${QUARANTINE_PREFIX}${stamp}:${globalThis.crypto.randomUUID()}`;
    const archive = JSON.stringify({ originalKey: item.key, raw: item.raw, reason: invalid.get(item.key), quarantinedAt: stamp });
    storage.setItem(key, archive);
    if (storage.getItem(key) !== archive) throw new Error('손상 원본 보관을 확인하지 못했습니다. 기존 기록을 그대로 보존합니다.');
    if (storage.getItem(item.key) !== item.raw) { skipped++; continue; }
    storage.removeItem(item.key); quarantined++;
  }
  return { quarantined, skipped };
}
export function readLocalEvents(storage) {
  const events = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(EVENT_PREFIX)) continue;
    let event;
    try { event = JSON.parse(storage.getItem(key)); } catch { throw new Error('기기 기록 일부를 읽을 수 없습니다. 원본을 지우지 말고 백업 파일로 복구해 주세요.'); }
    const error = validateEvent(event); if (error) throw new Error(error);
    if (key !== EVENT_PREFIX + event.id) throw new Error('기기에 저장된 변경 ID가 일치하지 않습니다.');
    events.push(event);
  }
  return mergeEvents(events);
}
export function writeLocalEvents(storage, events) {
  const verified = mergeEvents(readLocalEvents(storage), events);
  // Each event owns one key: another tab cannot replace a whole snapshot.
  for (const event of events) {
    const key = EVENT_PREFIX + event.id;
    const encoded = JSON.stringify(event);
    if (storage.getItem(key) == null) storage.setItem(key, encoded);
    if (stableEvent(JSON.parse(storage.getItem(key))) !== stableEvent(event)) throw new Error('기기에 저장한 기록을 다시 확인하지 못했습니다.');
  }
  return verified;
}
export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('JSON 백업 파일을 읽을 수 없습니다.'); }
  if (data?.format !== 'counseling-performance' || data.version !== 1 || !Array.isArray(data.events) || data.events.length > 100000) throw new Error('이 실적 관리 프로그램에서 만든 백업 파일을 선택해 주세요.');
  return mergeEvents(data.events);
}
export const backupText = events => JSON.stringify({ format: 'counseling-performance', version: 1, exportedAt: new Date().toISOString(), events }, null, 2);
export function openLocalBackup(factory = globalThis.indexedDB) {
  return new Promise((resolve, reject) => {
    if (!factory) { reject(new Error('추가 기기 백업 저장소를 사용할 수 없습니다.')); return; }
    const request = factory.open('counseling-performance-backup', 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('events')) request.result.createObjectStore('events', { keyPath: 'id' }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('추가 기기 백업 저장소를 열지 못했습니다.'));
    request.onblocked = () => reject(new Error('다른 탭을 닫은 후 추가 기기 백업을 다시 확인해 주세요.'));
  });
}
export async function readLocalBackup(factory) {
  const db = await openLocalBackup(factory);
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('events', 'readonly');
    const request = transaction.objectStore('events').getAll();
    transaction.oncomplete = () => { db.close(); try { resolve(mergeEvents(request.result)); } catch (error) { reject(error); } };
    transaction.onerror = () => { db.close(); reject(new Error('추가 기기 백업을 읽지 못했습니다.')); };
  });
}
export async function writeLocalBackup(events, factory) {
  if (!events.length) return;
  const verified = mergeEvents(events);
  const db = await openLocalBackup(factory);
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('events', 'readwrite');
    const store = transaction.objectStore('events');
    let failure;
    for (const event of verified) {
      const existing = store.get(event.id);
      existing.onsuccess = () => {
        try {
          if (existing.result !== undefined && stableEvent(existing.result) !== stableEvent(event)) {
            failure = new Error('추가 기기 백업에 동일한 변경 ID의 다른 내용이 있습니다. 원본을 보존하며 자동 덮어쓰기를 중단했습니다.');
            transaction.abort(); return;
          }
          if (existing.result === undefined) store.add(event);
        } catch (error) { failure = error; transaction.abort(); }
      };
    }
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(new Error('추가 기기 백업에 기록하지 못했습니다. Google Sheets 백업 상태를 확인해 주세요.')); };
    transaction.onabort = () => { db.close(); reject(failure || new Error('추가 기기 백업이 중단되었습니다.')); };
  });
}
