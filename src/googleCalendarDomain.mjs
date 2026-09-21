import { reservationStatus } from "./counselingDomain.mjs";

const SOURCE = "google-calendar";
const CALENDAR_HOSTS = new Set(["calendar.google.com", "www.google.com"]);
const owns = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const text = (value) => typeof value === "string" ? value.trim() : "";

function calendarId(value) {
  const id = text(value);
  if (!id || id.length > 512 || !/^[^\s@/?\\<>]+@[^\s@/?#\\<>]+\.[^\s@/?#\\<>]+$/.test(id)) {
    throw new Error("올바른 구글 캘린더 ID 또는 공유 링크를 입력해 주세요.");
  }
  return id;
}

function decodeCid(value) {
  // Google 공유 링크의 cid는 base64 또는 URL-safe base64로 표시됩니다.
  const encoded = text(value).replace(/ /g, "+").replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
    throw new Error("구글 캘린더 공유 링크를 다시 확인해 주세요.");
  }
  try {
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    return calendarId(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("구글 캘린더 공유 링크를 다시 확인해 주세요.");
  }
}

/** Accept a calendar ID, Google share/embed URL, or Google iCalendar URL. */
export function parseGoogleCalendarId(input) {
  const value = text(input);
  if (!/^[a-z][a-z\d+.-]*:/i.test(value)) return calendarId(value);
  let url;
  try { url = new URL(value); } catch { throw new Error("구글 캘린더 링크를 다시 확인해 주세요."); }
  if (url.protocol !== "https:" || !CALENDAR_HOSTS.has(url.hostname) || url.username || url.password || url.port
    || !/^\/calendar(?:\/|$)/.test(url.pathname)) {
    throw new Error("구글 캘린더의 HTTPS 공유 링크를 입력해 주세요.");
  }
  const ical = url.pathname.match(/^\/calendar\/ical\/([^/]+)\/(?:public|private(?:-[^/]+)?)\/(?:basic|full)\.ics$/);
  if (ical) {
    try { return calendarId(decodeURIComponent(ical[1])); }
    catch { throw new Error("구글 캘린더 iCal 주소를 다시 확인해 주세요."); }
  }
  if (url.searchParams.has("src")) return calendarId(url.searchParams.get("src"));
  if (url.searchParams.has("cid")) {
    const cid = url.searchParams.get("cid");
    return cid.includes("@") ? calendarId(cid) : decodeCid(cid);
  }
  throw new Error("캘린더 ID가 포함된 구글 공유 링크를 입력해 주세요.");
}

export function externalReservation(reservation) {
  return reservation?.source === SOURCE;
}

/** Returns an empty string for local reservations, allowing an existing fallback. */
export function externalReservationTitle(reservation) {
  return externalReservation(reservation) ? text(reservation.externalTitle) || "구글 상담" : "";
}

/** Last occupied calendar date, respecting an exclusive all-day/midnight end. */
export function reservationLastDate(reservation) {
  const first = reservation?.date || "";
  if (!externalReservation(reservation) || !validDate(reservation.endDate) || reservation.endDate < first) return first;
  let last = reservation.endDate;
  if (reservation.allDay || reservation.end === "00:00") {
    last = new Date(Date.parse(`${last}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  }
  return last < first ? first : last;
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validTime(value) {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function timestamp(value, fallback) {
  const stamp = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : fallback;
  if (!Number.isFinite(stamp) || stamp < 0) throw new Error("캘린더 동기화 시각을 확인해 주세요.");
  return stamp;
}

function stableId(id, externalId) {
  return `gcal:${encodeURIComponent(id)}:${encodeURIComponent(externalId)}`;
}

function changed(previous, next) {
  return Object.keys(next).some((key) => next[key] !== previous[key])
    || Object.keys(previous).some((key) => !owns(next, key));
}

function cancelExternal(previous, now) {
  // Repeated pulls do not undo a local status change made after source cancellation.
  if (previous.externalCancelled) return previous;
  return { ...previous, externalCancelled: true,
    externalPreviousStatus: reservationStatus(previous), status: "cancelled", done: false, updatedAt: now };
}

function sourceFields(event) {
  if (!validDate(event.date)) throw new Error("구글 일정에 올바른 날짜가 없습니다. 기존 예약은 변경하지 않았습니다.");
  const allDay = !!event.allDay;
  const start = allDay ? "" : text(event.start);
  const end = allDay ? "" : text(event.end);
  const nextDate = allDay ? new Date(Date.parse(`${event.date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) : event.date;
  const endDate = event.endDate || nextDate;
  if ((!allDay && ((start && !validTime(start)) || (end && !validTime(end))))
    || !validDate(endDate) || endDate < event.date || (allDay && endDate === event.date)) {
    throw new Error("구글 일정의 날짜 또는 시간을 확인해 주세요. 기존 예약은 변경하지 않았습니다.");
  }
  return { externalTitle: text(event.title) || "구글 상담", date: event.date,
    endDate, start, end, place: text(event.place), allDay };
}

/**
 * Merge a complete, successful calendar snapshot for [from, to), in Asia/Seoul.
 * payload.events have stable external IDs (UID plus recurrence identity).
 * No people are inferred from titles; imported appointments await explicit linking.
 * Unknown local fields, journals, identities and client/type selections are kept.
 */
export function mergeGoogleCalendar(data, payload, now = Date.now()) {
  if (!payload || !Array.isArray(payload.events)) throw new Error("캘린더 응답을 확인해 주세요. 기존 예약은 변경하지 않았습니다.");
  const id = parseGoogleCalendarId(payload.calendarId);
  const { from, to } = payload;
  if (!validDate(from) || !validDate(to) || from >= to) throw new Error("캘린더 조회 기간을 다시 확인해 주세요.");
  const fetchedAt = timestamp(payload.fetchedAt, now);
  const current = data || {};
  const config = current.googleCalendar || {};
  const previousSnapshot = config.snapshots?.[id] || (config.calendarId === id ? config : null);
  if (previousSnapshot?.fetchedAt != null && fetchedAt < timestamp(previousSnapshot.fetchedAt, 0)) return current;

  // Validate every incoming record before producing any changes. A malformed
  // response must never make valid stored reservations look source-deleted.
  const incoming = new Map();
  for (const event of payload.events) {
    if (!event || !text(event.id)) throw new Error("구글 일정 식별자가 없습니다. 기존 예약은 변경하지 않았습니다.");
    const externalId = text(event.id);
    const fields = event.cancelled && !event.date ? null : sourceFields(event);
    incoming.set(externalId, { event, fields });
  }

  const reservations = current.resv || [];
  const seen = new Set();
  const nextReservations = reservations.map((previous) => {
    if (!externalReservation(previous) || previous.calendarId !== id || !previous.externalId) return previous;
    const externalId = String(previous.externalId);
    const entry = incoming.get(externalId);
    if (!entry) {
      // Google can publish its public feed after events.insert has succeeded.
      // Absence is not a deletion until this identity has actually appeared.
      if (previous.externalAwaitingFeed) return previous;
      return previous.date < to && reservationLastDate(previous) >= from ? cancelExternal(previous, now) : previous;
    }
    seen.add(externalId);
    if (entry.event.cancelled) {
      const updated = { ...previous, ...(entry.fields || {}), ...(previous.externalAwaitingFeed ? { externalAwaitingFeed: false } : {}) };
      const cancelled = cancelExternal(updated, now);
      return changed(previous, cancelled) ? { ...cancelled, updatedAt: now } : previous;
    }
    let status = reservationStatus(previous);
    if (previous.externalCancelled && status === "cancelled") {
      status = reservationStatus({ status: previous.externalPreviousStatus });
    }
    const next = { ...previous, ...entry.fields, ...(previous.externalAwaitingFeed ? { externalAwaitingFeed: false } : {}),
      externalCancelled: false, status, done: status === "done" };
    delete next.externalPreviousStatus;
    return changed(previous, next) ? { ...next, updatedAt: now } : previous;
  });

  for (const [externalId, { event, fields }] of incoming) {
    if (seen.has(externalId) || !fields) continue;
    const status = event.cancelled ? "cancelled" : "scheduled";
    nextReservations.push({ id: stableId(id, externalId), source: SOURCE, calendarId: id, externalId,
      ...fields, clientId: "", type: "개인상담", method: "", memo: "",
      status, done: false, externalCancelled: !!event.cancelled,
      ...(event.cancelled ? { externalPreviousStatus: "scheduled" } : {}), createdAt: now, updatedAt: now });
  }

  const snapshots = { ...(config.snapshots || {}) };
  if (config.calendarId && config.calendarId !== id && !snapshots[config.calendarId] && config.fetchedAt != null) {
    snapshots[config.calendarId] = { fetchedAt: config.fetchedAt, from: config.from, to: config.to };
  }
  snapshots[id] = { fetchedAt, from, to };
  return { ...current, resv: nextReservations,
    googleCalendar: { ...config, calendarId: id, name: text(payload.name) || (config.calendarId === id && text(config.name)) || id,
      timeZone: text(payload.timeZone) || (config.calendarId === id && text(config.timeZone)) || "Asia/Seoul",
      from, to, fetchedAt, enabled: true, snapshots } };
}
