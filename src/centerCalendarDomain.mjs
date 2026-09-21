export const CENTER_CALENDAR_ID = "859f45fda1f4ebd6882d175b4962155a8917cc1c11e71cbecb11640bfbe214b3@group.calendar.google.com";
const ZONE = "Asia/Seoul";
const pendingStates = new Set(["pending", "error", "conflict"]);
const clean = (value) => typeof value === "string" ? value : "";
const ownSync = (event) => event?.centerSync?.calendarId === CENTER_CALENDAR_ID;
export const isCenterCalendarEvent = (event) => !!event && !event.pid;
export const isHiddenCenterEvent = (event) => !!(ownSync(event) && (event.centerSync.deleted || event.centerSync.cancelled));
export const centerEventPending = (event) => ownSync(event) && pendingStates.has(event.centerSync.state);
export function validCenterDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !value.startsWith("0000") && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export const nextCenterDate = (date) => new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
function fields(event) {
  const allDay = !event.start;
  return { title: clean(event.title).trim(), date: clean(event.date), start: allDay ? "" : clean(event.start), end: allDay ? "" : clean(event.end),
    endDate: clean(event.endDate) || (allDay && validCenterDate(event.date) ? nextCenterDate(event.date) : event.date), allDay,
    place: clean(event.place).trim(), memo: clean(event.memo).trim() };
}
export const centerEventFingerprint = (event) => JSON.stringify(fields(event));

/** Only an explicit scheduling edit enrolls an old local event. Done remains local. */
export function prepareCenterEvent(previous, next) {
  const event = { ...previous, ...next };
  if (previous?.id) event.id = previous.id;
  if (ownSync(previous)) event.pid = "";
  if (!isCenterCalendarEvent(event)) return event;
  const changed = !previous || !isCenterCalendarEvent(previous) || centerEventFingerprint(previous) !== centerEventFingerprint(event);
  if (!changed) return event;
  const sync = ownSync(previous) ? previous.centerSync : {};
  const prepared = { ...event, ...fields(event), centerSync: { ...sync, calendarId: CENTER_CALENDAR_ID, action: "upsert", state: "pending",
    revision: (sync.revision || 0) + 1, deleted: false, cancelled: false, error: "", retryAt: 0, attempts: 0,
    conflictRemote: undefined, conflictMissing: false } };
  buildCenterGoogleEvent(prepared);
  return prepared;
}

/** Deletions survive app closure until Google confirms them. */
export function deleteCenterEvent(data, id) {
  return { ...data, events: (data.events || []).flatMap((event) => {
    if (event.id !== id) return [event];
    if (!ownSync(event)) return [];
    return [{ ...event, centerSync: { ...event.centerSync, state: "pending", action: "delete", deleted: true,
      revision: (event.centerSync.revision || 0) + 1, error: "", attempts: 0, retryAt: 0, conflictRemote: undefined, conflictMissing: false } }];
  }) };
}

export async function centerGoogleEventId(localId) {
  if (typeof localId !== "string" || !localId || localId.length > 512 || localId !== localId.trim() || /[\u0000-\u001f\u007f]/.test(localId)) throw new Error("센터 일정의 식별자를 확인해 주세요.");
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(`workboard:center:${localId}`)));
  return "c0" + [...hash].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function buildCenterGoogleEvent(event) {
  const value = fields(event);
  const marker = event.centerSync?.creationId || event.id;
  if (typeof marker !== "string" || !marker || marker.length > 512 || marker !== marker.trim() || /[\u0000-\u001f\u007f]/.test(marker)) throw new Error("센터 일정의 식별자를 확인해 주세요.");
  if (!value.title || value.title.length > 500 || value.memo.length > 8000 || value.place.length > 1000 || !validCenterDate(value.date) || !validCenterDate(value.endDate)) throw new Error("제목은 500자, 장소는 1,000자, 메모는 8,000자 이내로 입력하고 날짜를 확인해 주세요.");
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (value.allDay ? value.endDate <= value.date : !time.test(value.start) || !time.test(value.end) || `${value.endDate}T${value.end}` <= `${value.date}T${value.start}`) throw new Error("종료 일시는 시작 일시보다 늦어야 합니다.");
  if ((Date.parse(`${value.endDate}T${value.end || "00:00"}:00Z`) - Date.parse(`${value.date}T${value.start || "00:00"}:00Z`)) / 86400000 > 731) throw new Error("센터 일정의 기간은 2년 이내로 설정해 주세요.");
  return { summary: value.title, description: value.memo, location: value.place,
    start: value.allDay ? { date: value.date } : { dateTime: `${value.date}T${value.start}:00+09:00`, timeZone: ZONE },
    end: value.allDay ? { date: value.endDate } : { dateTime: `${value.endDate}T${value.end}:00+09:00`, timeZone: ZONE },
    extendedProperties: { private: { workboardEventId: marker } } };
}

function remotePart(part) {
  if (validCenterDate(part?.date)) return { date: part.date, time: "", allDay: true };
  if (typeof part?.dateTime !== "string" || !/(?:Z|[+-]\d\d:\d\d)$/.test(part.dateTime) || !Number.isFinite(Date.parse(part.dateTime))) throw new Error("구글 센터 일정의 날짜를 확인하지 못했습니다.");
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(part.dateTime)).map((p) => [p.type, p.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}`, allDay: false };
}

export function centerRemoteEvent(remote, previous) {
  if (!remote || typeof remote.id !== "string" || !remote.id || remote.id.length > 1024) throw new Error("구글 센터 일정의 식별자를 확인하지 못했습니다.");
  if (remote.status === "cancelled") return previous ? { ...previous, centerSync: { ...previous.centerSync, state: "synced", cancelled: true, deleted: false, etag: remote.etag || previous.centerSync?.etag, error: "", conflictRemote: undefined, conflictMissing: false } } : null;
  const start = remotePart(remote.start), end = remotePart(remote.end);
  if (start.allDay !== end.allDay || `${end.date}T${end.time}` <= `${start.date}T${start.time}` || typeof remote.etag !== "string" || !remote.etag) throw new Error("구글 센터 일정의 시간 또는 버전을 확인하지 못했습니다.");
  return { ...previous, id: previous?.id || `center:${remote.id}`, pid: "", title: clean(remote.summary) || "제목 없는 일정", date: start.date,
    start: start.time, end: end.time, endDate: end.date, allDay: start.allDay, place: clean(remote.location), memo: clean(remote.description), done: !!previous?.done,
    centerSync: { ...previous?.centerSync, calendarId: CENTER_CALENDAR_ID, eventId: remote.id, etag: remote.etag, state: "synced", action: "upsert",
      cancelled: false, deleted: false, error: "", retryAt: 0, attempts: 0, revision: previous?.centerSync?.revision || 0,
      recurringEventId: clean(remote.recurringEventId), originalStartTime: remote.originalStartTime || null, updated: clean(remote.updated),
      conflictRemote: undefined, conflictMissing: false } };
}

function inWindow(event, from, to) {
  const value = fields(event);
  return value.date <= to && (value.endDate > from || (value.endDate === from && !value.allDay && value.end !== "00:00"));
}

/** A complete, successful list is authoritative only inside its requested window. */
export function mergeCenterCalendar(data, payload, now = Date.now()) {
  if (payload?.calendarId !== CENTER_CALENDAR_ID || !Array.isArray(payload.items) || !validCenterDate(payload.from) || !validCenterDate(payload.to) || payload.to < payload.from) throw new Error("센터 캘린더 응답을 확인하지 못했습니다.");
  const remoteById = new Map();
  for (const remote of payload.items) {
    centerRemoteEvent(remote); // Validate the entire response before changing a row.
    if (remoteById.has(remote.id)) throw new Error("센터 캘린더에 중복된 일정 식별자가 있습니다.");
    remoteById.set(remote.id, remote);
  }
  const claimed = new Set();
  const events = (data.events || []).map((event) => {
    if (!ownSync(event)) return event;
    const remote = remoteById.get(event.centerSync.eventId);
    if (remote) claimed.add(remote.id);
    if (centerEventPending(event)) {
      // Keep local edits until the queued If-Match write succeeds. Conflict
      // versions are refreshed for a deliberate user choice, never auto-applied.
      if (event.centerSync.state === "conflict" && remote) return { ...event, centerSync: { ...event.centerSync, conflictRemote: remote, conflictMissing: remote.status === "cancelled", conflictChecked: true } };
      return event;
    }
    if (remote) return centerRemoteEvent(remote, event);
    if (inWindow(event, payload.from, payload.to)) return { ...event, centerSync: { ...event.centerSync, cancelled: true } };
    return event;
  });
  for (const remote of payload.items) {
    if (claimed.has(remote.id) || remote.status === "cancelled") continue;
    // Only match explicit queue identities; titles and dates never identify a row.
    const marker = remote.extendedProperties?.private?.workboardEventId;
    const local = events.find((event) => ownSync(event) && !event.centerSync.eventId && (event.centerSync.creationId || event.id) === marker);
    if (local) {
      const index = events.indexOf(local);
      events[index] = centerEventPending(local) ? { ...local, centerSync: { ...local.centerSync, eventId: remote.id, etag: remote.etag } } : centerRemoteEvent(remote, local);
    } else events.push(centerRemoteEvent(remote));
  }
  return { ...data, events, centerCalendar: { ...data.centerCalendar, calendarId: CENTER_CALENDAR_ID, enabled: data.centerCalendar?.enabled !== false,
    name: clean(payload.name) || "센터 일정", timeZone: clean(payload.timeZone) || ZONE, from: payload.from, to: payload.to, fetchedAt: now } };
}

export function resolveCenterConflict(data, id, choice, now = Date.now()) {
  return { ...data, events: (data.events || []).flatMap((event) => {
    if (event.id !== id || event.centerSync?.state !== "conflict" || !event.centerSync.conflictChecked) return [event];
    const sync = event.centerSync, remote = sync.conflictRemote;
    if (choice === "remote") return remote && remote.status !== "cancelled" ? [centerRemoteEvent(remote, event)] : [];
    if (choice !== "local") return [event];
    if (sync.conflictMissing && sync.action === "delete") return [];
    const recreate = sync.conflictMissing;
    return [{ ...event, centerSync: { ...sync, state: "pending", revision: (sync.revision || 0) + 1,
      eventId: recreate ? "" : remote.id, etag: recreate ? "" : remote.etag,
      creationId: recreate ? `${event.id}:restore:${now}` : sync.creationId,
      error: "", retryAt: 0, attempts: 0, conflictRemote: undefined, conflictMissing: false, conflictChecked: false } }];
  }) };
}

export function nextCenterWrite(data, now = Date.now()) {
  return (data.events || []).find((event) => ownSync(event) && (event.centerSync.state === "pending" || (event.centerSync.state === "error" && event.centerSync.retryable && (event.centerSync.attempts || 0) < 5 && (event.centerSync.retryAt || 0) <= now)));
}

/** One serialized operation. Preparation is saved before any network mutation. */
export async function writeNextCenterEvent({ getData, setData, request, isEventStored, isCurrent = () => true, now = Date.now }) {
  const snapshot = nextCenterWrite(getData(), now());
  if (!snapshot || !isCurrent() || !isEventStored?.(snapshot)) return "idle";
  const sync = snapshot.centerSync;
  const update = (fn) => setData((data) => ({ ...data, events: (data.events || []).flatMap((event) => event.id === snapshot.id ? fn(event) : [event]) }));
  if (!sync.eventId) {
    const eventId = await centerGoogleEventId(sync.creationId || snapshot.id);
    if (!isCurrent()) return "cancelled";
    update((event) => [{ ...event, centerSync: { ...event.centerSync, eventId } }]);
    return "prepared";
  }
  try {
    if (sync.action === "delete" && !sync.etag) {
      // A tab may have closed after Google's insert but before its response.
      // Read this exact ID before deciding whether there is anything to delete.
      const found = await request("get", { eventId: sync.eventId });
      if (!isCurrent()) return "cancelled";
      if (found?.calendarId !== CENTER_CALENDAR_ID) throw new Error("구글 센터 일정의 삭제 상태를 확인하지 못했습니다.");
      if (found.item) {
        if (found.item.id !== sync.eventId) throw new Error("구글 센터 일정의 삭제 식별자를 확인하지 못했습니다.");
        centerRemoteEvent(found.item, snapshot);
      }
      update((event) => event.centerSync?.revision !== sync.revision ? [event] : found.item
        ? [{ ...event, centerSync: { ...event.centerSync, etag: found.item.etag } }] : []);
      return "prepared";
    }
    const payload = { eventId: sync.eventId, ...(sync.etag ? { etag: sync.etag } : {}), ...(sync.action === "delete" ? {} : { event: buildCenterGoogleEvent(snapshot) }) };
    const result = await request(sync.action === "delete" ? "delete" : "upsert", payload);
    if (!isCurrent()) return "cancelled";
    if (result?.calendarId !== CENTER_CALENDAR_ID || (sync.action === "delete" ? result.deleted !== true || result.eventId !== sync.eventId : result.item?.id !== sync.eventId)) throw new Error("구글 센터 일정의 저장 응답을 확인하지 못했습니다.");
    if (sync.action !== "delete") centerRemoteEvent(result.item, snapshot);
    update((event) => {
      if (event.centerSync?.revision !== sync.revision) return [{ ...event, centerSync: { ...event.centerSync, etag: result.item?.etag || "", state: "pending" } }];
      return sync.action === "delete" ? [] : [centerRemoteEvent(result.item, event)];
    });
    return "written";
  } catch (failure) {
    if (!isCurrent() || failure.code === "cancelled") return "cancelled";
    const conflict = failure.code === "event_conflict" || failure.status === 409 || failure.status === 412
      || (sync.action === "upsert" && !!sync.etag && [404, 410].includes(failure.status));
    update((event) => {
      if (event.centerSync?.revision !== sync.revision && !conflict) return [event];
      const attempts = (event.centerSync.attempts || 0) + 1;
      return [{ ...event, centerSync: { ...event.centerSync, state: conflict ? "conflict" : "error", error: failure.message,
        retryable: !!failure.retryable, reauthorize: failure.status === 401, attempts,
        retryAt: failure.retryable ? now() + Math.min(120000, 2000 * 2 ** attempts) : 0, conflictChecked: false } }];
    });
    return conflict ? "conflict" : "error";
  }
}
