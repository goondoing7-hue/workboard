"use strict";

// The browser receives only an authenticated, encrypted HttpOnly cookie. Google
// refresh credentials and client secrets never enter board data or API JSON.
const { createCipheriv, createDecipheriv, createHash, randomBytes } = require("node:crypto");
const SCOPE = "https://www.googleapis.com/auth/calendar.events.owned";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SESSION_AGE = 180 * 24 * 60 * 60;
const BODY_LIMIT = 16 * 1024;
const RESPONSE_LIMIT = 256 * 1024;
const CENTER_ITEMS_LIMIT = 5000;
const CENTER_BYTES_LIMIT = 2 * 1024 * 1024;
const CENTER_FIELDS = "id,etag,status,summary,description,location,start,end,updated,recurringEventId,originalStartTime,extendedProperties/private/workboardEventId";
const COUNSEL_FIELDS = "id,iCalUID,status,summary,location,start,end,recurringEventId,originalStartTime";
const COOKIE_AAD = Buffer.from("workboard:calendar:session:v1");
const PLACES = new Set(["마음", "어우리", "공감", "집단", "모래놀이", "meet"]);
const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

class SessionError extends Error {
  constructor(status, code, message, retryable = false) {
    super(message); Object.assign(this, { status, code, retryable });
  }
}
const fail = (...args) => { throw new SessionError(...args); };
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const hasKeys = (value, required, optional = []) => record(value)
  && required.every((key) => Object.hasOwn(value, key))
  && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
const safeCredential = (value, max = 4096) => typeof value === "string" && value.length > 0
  && value.length <= max && /^[\x21-\x7e]+$/.test(value);
const validClient = (value) => typeof value === "string" && /^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(value);
const validCalendar = (value) => typeof value === "string"
  && /^[a-z0-9][a-z0-9._+-]{0,180}@(gmail\.com|group\.calendar\.google\.com)$/.test(value);
const validDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !value.startsWith("0000") && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const followingDate = (value) => new Date(Date.parse(`${value}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const eventIdFor = (id) => "b0" + createHash("sha256").update(`workboard:reservation:${id}`).digest("hex");
const centerEventIdFor = (id) => "c0" + createHash("sha256").update(`workboard:center:${id}`).digest("hex");

function settings(env) {
  const clientId = String(env.GOOGLE_CALENDAR_CLIENT_ID || "").trim();
  const clientSecret = String(env.GOOGLE_CALENDAR_CLIENT_SECRET || "").trim();
  const calendarId = String(env.GOOGLE_CALENDAR_ID || "").trim();
  const centerCalendarId = String(env.GOOGLE_CENTER_CALENDAR_ID || "").trim();
  const encodedKey = String(env.GOOGLE_CALENDAR_SESSION_KEY || "").trim();
  const origins = new Set();
  let invalidOrigin = false;
  for (const raw of String(env.GOOGLE_CALENDAR_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean)) {
    try {
      const url = new URL(raw);
      if (raw !== url.origin || url.username || url.password || (url.protocol !== "https:"
        && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
        invalidOrigin = true;
      } else origins.add(raw);
    } catch { invalidOrigin = true; }
  }
  const key = /^[A-Za-z0-9_-]{43}$/.test(encodedKey) ? Buffer.from(encodedKey, "base64url") : null;
  const configured = validClient(clientId) && safeCredential(clientSecret) && validCalendar(calendarId)
    && key?.length === 32 && key.toString("base64url") === encodedKey && origins.size > 0 && !invalidOrigin;
  return { configured: !!configured, clientId, clientSecret, calendarId, centerCalendarId, key, origins };
}

function requestOrigin(req, config) {
  const origin = req.headers?.origin, host = req.headers?.host;
  if (typeof origin !== "string" || !config.origins.has(origin) || typeof host !== "string") {
    fail(403, "invalid_origin", "현재 업무보드 주소에서만 구글 캘린더를 연결할 수 있습니다.");
  }
  const parsed = new URL(origin);
  if (host.toLowerCase() !== parsed.host || req.headers["x-workboard-calendar"] !== "1"
    || (req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin")) {
    fail(403, "invalid_origin", "업무보드 화면에서 다시 시도해 주세요.");
  }
  return origin;
}

function cookieName(origin) { return origin.startsWith("https:") ? "__Host-wb_calendar_session" : "wb_calendar_session"; }
function cookieHeader(origin, value, now, clear = false) {
  const age = clear ? 0 : SESSION_AGE;
  return `${cookieName(origin)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}; Expires=${new Date(clear ? 0 : now + age * 1000).toUTCString()}${origin.startsWith("https:") ? "; Secure" : ""}`;
}
function seal(session, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(COOKIE_AAD);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
  const value = ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
  if (value.length > 3800) fail(502, "invalid_token_response", "구글 연결 정보를 안전하게 저장하지 못했습니다.");
  return value;
}
function readSession(req, origin, config, now) {
  const cookies = String(req.headers?.cookie || "").split(";").map((item) => item.trim())
    .filter((item) => item.startsWith(`${cookieName(origin)}=`));
  try {
    if (cookies.length !== 1) throw new Error();
    const value = cookies[0].slice(cookieName(origin).length + 1);
    if (value.length > 3800 || !/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const [, ivText, tagText, dataText] = value.split(".");
    const iv = Buffer.from(ivText, "base64url"), tag = Buffer.from(tagText, "base64url");
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", config.key, iv);
    decipher.setAAD(COOKIE_AAD); decipher.setAuthTag(tag);
    const session = JSON.parse(Buffer.concat([decipher.update(Buffer.from(dataText, "base64url")), decipher.final()]).toString("utf8"));
    if (!hasKeys(session, ["v", "refresh", "client", "calendar", "origin", "issued", "expires", "nonce"])
      || session.v !== 1 || !safeCredential(session.refresh, 2048) || session.client !== config.clientId
      || session.calendar !== config.calendarId || session.origin !== origin || !safeCredential(session.nonce, 32)
      || !Number.isFinite(session.issued) || session.issued > now + 60000
      || session.expires !== session.issued + SESSION_AGE * 1000 || session.expires <= now) throw new Error();
    return session;
  } catch {
    fail(401, "reauth_required", "구글 캘린더 자동 연결을 한 번 승인해 주세요.");
  }
}

async function readBody(req) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers?.["content-type"] || "")) {
    fail(415, "invalid_request", "올바른 요청 형식으로 다시 시도해 주세요.");
  }
  const length = req.headers?.["content-length"];
  if (length && (!/^\d+$/.test(String(length)) || Number(length) > BODY_LIMIT)) {
    fail(413, "request_too_large", "요청 내용이 너무 큽니다.");
  }
  let raw = req.body;
  if (raw === undefined) {
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > BODY_LIMIT) fail(413, "request_too_large", "요청 내용이 너무 큽니다.");
      chunks.push(bytes);
    }
    raw = Buffer.concat(chunks);
  }
  try {
    const serialized = Buffer.isBuffer(raw) ? raw.toString("utf8") : typeof raw === "string" ? raw : JSON.stringify(raw);
    if (typeof serialized !== "string") throw new Error();
    if (Buffer.byteLength(serialized) > BODY_LIMIT) fail(413, "request_too_large", "요청 내용이 너무 큽니다.");
    const body = JSON.parse(serialized);
    if (!record(body)) throw new Error();
    return body;
  } catch (error) {
    if (error instanceof SessionError) throw error;
    fail(400, "invalid_request", "올바른 요청 내용으로 다시 시도해 주세요.");
  }
}

function eventPayload(input) {
  let body = input;
  try { if (typeof body === "string") body = JSON.parse(body); } catch { body = null; }
  const bad = () => fail(400, "invalid_event", "상담 예약의 날짜·시간·장소를 확인해 주세요.");
  if (!hasKeys(body, ["id", "summary", "location", "start", "end", "extendedProperties"])
    || body.summary !== "상담 예약" || !PLACES.has(body.location)
    || !hasKeys(body.extendedProperties, ["private"])
    || !hasKeys(body.extendedProperties.private, ["workboardReservationId"])) bad();
  const id = body.extendedProperties.private.workboardReservationId;
  if (typeof id !== "string" || !id || id !== id.trim() || id.length > 1024
    || /[\u0000-\u001f\u007f]/.test(id) || id.startsWith("gcal:") || body.id !== eventIdFor(id)) bad();
  let start, end;
  if (hasKeys(body.start, ["date"]) && hasKeys(body.end, ["date"])) {
    if (!validDate(body.start.date) || !validDate(body.end.date) || body.end.date !== followingDate(body.start.date)) bad();
    start = { date: body.start.date }; end = { date: body.end.date };
  } else {
    const validPoint = (point) => hasKeys(point, ["dateTime", "timeZone"]) && point.timeZone === "Asia/Seoul"
      && typeof point.dateTime === "string"
      && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:00\+09:00$/.test(point.dateTime)
      && validDate(point.dateTime.slice(0, 10));
    if (!validPoint(body.start) || !validPoint(body.end)
      || body.start.dateTime.slice(0, 10) !== body.end.dateTime.slice(0, 10)
      || body.start.dateTime >= body.end.dateTime) bad();
    start = { dateTime: body.start.dateTime, timeZone: "Asia/Seoul" };
    end = { dateTime: body.end.dateTime, timeZone: "Asia/Seoul" };
  }
  return { id: body.id, summary: "상담 예약", location: body.location, start, end,
    extendedProperties: { private: { workboardReservationId: id } } };
}

function proxyRequest(body, config) {
  if (!hasKeys(body, ["action", "url", "method"], ["body"]) || typeof body.url !== "string"
    || !["GET", "POST"].includes(body.method)) fail(400, "invalid_api_url", "허용되지 않은 캘린더 요청입니다.");
  let url;
  try { url = new URL(body.url); } catch { fail(400, "invalid_api_url", "올바른 캘린더 요청이 아닙니다."); }
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(config.calendarId)}/events`;
  const basePath = new URL(base).pathname;
  if (url.origin !== "https://www.googleapis.com" || url.username || url.password || url.hash
    || /[\r\n\t\\]/.test(body.url)) fail(400, "invalid_api_url", "허용되지 않은 캘린더 주소입니다.");
  const query = [...url.searchParams.entries()];
  if (body.method === "POST" && url.pathname === basePath && query.length === 1
    && url.searchParams.get("sendUpdates") === "none") {
    return { url: `${base}?sendUpdates=none`, method: "POST", body: JSON.stringify(eventPayload(body.body)) };
  }
  if (body.method === "GET" && !Object.hasOwn(body, "body")) {
    if (url.pathname === basePath && query.length === 2 && url.searchParams.getAll("maxResults").length === 1
      && url.searchParams.getAll("fields").length === 1 && url.searchParams.get("maxResults") === "1"
      && url.searchParams.get("fields") === "summary,timeZone,accessRole") {
      return { url: `${base}?maxResults=1&fields=summary,timeZone,accessRole`, method: "GET" };
    }
    const suffix = url.pathname.slice(basePath.length + 1);
    if (url.pathname.startsWith(`${basePath}/`) && /^b0[0-9a-f]{64}$/.test(suffix) && !query.length) {
      return { url: `${base}/${suffix}`, method: "GET" };
    }
  }
  fail(400, "invalid_api_url", "상담 예약 등록과 연결 확인만 허용됩니다.");
}

const validGoogleEventId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{5,1024}$/.test(value);
const validEtag = (value) => typeof value === "string" && /^"[\x21\x23-\x7e]{1,256}"$/.test(value);
const boundedText = (value, max) => typeof value === "string" && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const validTimezone = (value) => {
  if (typeof value !== "string" || value.length > 100 || !/^[A-Za-z0-9_+/-]+$/.test(value)) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
};
const validTimestamp = (value) => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value)
  && validDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
function centerPoint(value, strict = true) {
  if (hasKeys(value, ["date"]) && validDate(value.date)) return { date: value.date };
  if (hasKeys(value, ["dateTime"], ["timeZone"]) && validTimestamp(value.dateTime)
    && (value.timeZone === undefined ? !strict : validTimezone(value.timeZone))) {
    return { dateTime: value.dateTime, ...(value.timeZone ? { timeZone: value.timeZone } : {}) };
  }
  return null;
}
function centerPayload(body) {
  const bad = () => fail(400, "invalid_event", "센터 일정의 제목·날짜·시간을 확인해 주세요.");
  if (!hasKeys(body, ["summary", "start", "end", "extendedProperties"], ["description", "location"])
    || !boundedText(body.summary, 500) || !body.summary.trim()
    || (body.description !== undefined && !boundedText(body.description, 8000))
    || (body.location !== undefined && !boundedText(body.location, 1000))
    || !hasKeys(body.extendedProperties, ["private"])
    || !hasKeys(body.extendedProperties.private, ["workboardEventId"])) bad();
  const id = body.extendedProperties.private.workboardEventId;
  if (typeof id !== "string" || !id || id !== id.trim() || id.length > 512 || /[\u0000-\u001f\u007f]/.test(id)) bad();
  const start = centerPoint(body.start), end = centerPoint(body.end);
  if (!start || !end || !!start.date !== !!end.date) bad();
  const startMs = Date.parse(start.date ? `${start.date}T00:00:00Z` : start.dateTime);
  const endMs = Date.parse(end.date ? `${end.date}T00:00:00Z` : end.dateTime);
  if (endMs <= startMs || endMs - startMs > 731 * 86400000) bad();
  return { summary: body.summary, description: body.description || "", location: body.location || "", start, end,
    extendedProperties: { private: { workboardEventId: id } } };
}
function centerRequest(body, config) {
  if (!validCalendar(config.centerCalendarId)) fail(503, "center_setup_required", "센터 구글 캘린더의 서버 연결 설정이 필요합니다.");
  const invalid = () => fail(400, "invalid_request", "올바른 센터 일정 요청을 선택해 주세요.");
  if (body.operation === "list" && hasKeys(body, ["action", "operation", "from", "to"])) {
    if (!validDate(body.from) || !validDate(body.to) || body.to >= "9999-12-31" || body.from > body.to
      || Date.parse(body.to) - Date.parse(body.from) >= 1100 * 86400000) invalid();
    return { operation: "list", from: body.from, to: body.to };
  }
  if (body.operation === "upsert" && hasKeys(body, ["action", "operation", "eventId", "event"], ["etag"])) {
    if (!validGoogleEventId(body.eventId) || (body.etag !== undefined && !validEtag(body.etag))) invalid();
    const event = centerPayload(body.event);
    if (body.etag === undefined && body.eventId !== centerEventIdFor(event.extendedProperties.private.workboardEventId)) invalid();
    return { operation: "upsert", eventId: body.eventId, etag: body.etag, event };
  }
  if (body.operation === "delete" && hasKeys(body, ["action", "operation", "eventId", "etag"])) {
    if (!validGoogleEventId(body.eventId) || !validEtag(body.etag)) invalid();
    return { operation: "delete", eventId: body.eventId, etag: body.etag };
  }
  if (body.operation === "get" && hasKeys(body, ["action", "operation", "eventId"])) {
    if (!validGoogleEventId(body.eventId)) invalid();
    return { operation: "get", eventId: body.eventId };
  }
  invalid();
}
function cleanCenterEvent(event) {
  const bad = () => fail(502, "invalid_calendar_response", "센터 일정 응답을 확인하지 못했습니다. 다시 새로고침해 주세요.", true);
  if (!record(event) || !validGoogleEventId(event.id) || !["confirmed", "tentative", "cancelled"].includes(event.status)) bad();
  const clean = { id: event.id, status: event.status };
  if (event.etag !== undefined) { if (!validEtag(event.etag)) bad(); clean.etag = event.etag; }
  if (event.status !== "cancelled" && !clean.etag) bad();
  for (const [key, limit] of [["summary", 500], ["description", 16000], ["location", 2000]]) {
    if (event[key] !== undefined) { if (!boundedText(event[key], limit)) bad(); clean[key] = event[key]; }
  }
  for (const key of ["start", "end", "originalStartTime"]) {
    if (event[key] !== undefined) { const point = centerPoint(event[key], false); if (!point) bad(); clean[key] = point; }
  }
  if (event.status !== "cancelled" && (!clean.start || !clean.end || !!clean.start.date !== !!clean.end.date)) bad();
  if (event.updated !== undefined) { if (!validTimestamp(event.updated)) bad(); clean.updated = event.updated; }
  if (event.recurringEventId !== undefined) { if (!validGoogleEventId(event.recurringEventId)) bad(); clean.recurringEventId = event.recurringEventId; }
  const workboardEventId = event.extendedProperties?.private?.workboardEventId;
  if (typeof workboardEventId === "string" && workboardEventId.length <= 512 && !/[\u0000-\u001f\u007f]/.test(workboardEventId)) {
    clean.extendedProperties = { private: { workboardEventId } };
  }
  return clean;
}
function sameCenterEvent(actual, expected) {
  const pointEquals = (a, b) => a?.date || b?.date ? a?.date === b?.date : Date.parse(a?.dateTime) === Date.parse(b?.dateTime);
  return actual.status !== "cancelled" && actual.summary === expected.summary
    && (actual.description || "") === expected.description && (actual.location || "") === expected.location
    && pointEquals(actual.start, expected.start) && pointEquals(actual.end, expected.end)
    && actual.extendedProperties?.private?.workboardEventId === expected.extendedProperties.private.workboardEventId;
}

function googleFailure(status, data) {
  const reasons = Array.isArray(data?.error?.errors) ? data.error.errors.map((item) => item?.reason) : [];
  if (status === 401) return new SessionError(401, "reauth_required", "구글 캘린더 권한을 다시 승인해 주세요.");
  if (status === 409) return new SessionError(409, "event_conflict", "이미 등록된 구글 상담 예약을 확인합니다.");
  if (status === 412) return new SessionError(412, "event_conflict", "구글 캘린더에서 먼저 수정된 일정입니다. 최신 내용을 확인한 뒤 다시 저장해 주세요.");
  if (status === 429 || (status === 403 && reasons.some((reason) => ["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"].includes(reason)))) {
    return new SessionError(status, "rate_limited", "구글 요청이 많아 잠시 후 다시 시도합니다.", true);
  }
  if (status >= 500) return new SessionError(503, "google_unavailable", "구글 캘린더에 잠시 연결하지 못했습니다. 자동으로 다시 시도합니다.", true);
  if (status === 403 && reasons.includes("accessNotConfigured")) return new SessionError(503, "setup_required", "Google Calendar API 사용 설정을 확인해 주세요.");
  if (status === 403) return new SessionError(403, "permission_denied", "이 상담 캘린더의 소유 권한을 확인해 주세요.");
  if (status === 404) return new SessionError(404, "event_not_found", "구글 캘린더에서 해당 상담 예약을 찾지 못했습니다.");
  return new SessionError(status >= 400 && status < 500 ? status : 502, "google_request_failed", "구글 캘린더 요청을 완료하지 못했습니다.");
}

function counselingListRequest(body) {
  if (!hasKeys(body, ["action", "from", "to"]) || !validDate(body.from) || !validDate(body.to)
    || body.from >= body.to || Date.parse(body.to) - Date.parse(body.from) > 1096 * 86400000) {
    fail(400, "invalid_request", "상담 캘린더 조회 기간을 확인해 주세요.");
  }
  return { from: body.from, to: body.to };
}

/** Match the public ICS worker's UID + original recurrence identity exactly.
 * Only the scheduling fields previously read from that feed leave this server. */
function counselingFeedEvent(event) {
  const bad = () => fail(502, "invalid_calendar_response", "상담 일정을 모두 확인하지 못했습니다. 기존 예약은 유지됩니다.", true);
  if (!record(event) || !validGoogleEventId(event.id) || !["confirmed", "tentative", "cancelled"].includes(event.status)) bad();
  // showDeleted=false requests a full live snapshot. A defensive tombstone
  // omission is safe: mergeGoogleCalendar handles missing in-window identities.
  if (event.status === "cancelled") return null;
  if (typeof event.iCalUID !== "string" || !event.iCalUID.trim() || event.iCalUID.length > 1024
    || /[\u0000-\u001f\u007f]/.test(event.iCalUID)) bad();
  const point = (part) => {
    const value = centerPoint(part, false);
    if (!value) bad();
    if (value.date) return { date: value.date, time: "", allDay: true, stamp: Date.parse(`${value.date}T00:00:00+09:00`) };
    const stamp = Date.parse(value.dateTime);
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(stamp)).map((part) => [part.type, part.value]));
    return { date: `${p.year.padStart(4, "0")}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, allDay: false, stamp };
  };
  const start = point(event.start), end = point(event.end);
  if (start.allDay !== end.allDay || end.stamp < start.stamp || (start.allDay && end.stamp === start.stamp)) bad();
  let recurrence = "single";
  if (event.recurringEventId || event.originalStartTime) {
    if (!validGoogleEventId(event.recurringEventId) || !event.originalStartTime) bad();
    const original = point(event.originalStartTime);
    recurrence = original.allDay ? `D:${original.date}` : `T:${new Date(original.stamp).toISOString()}`;
  }
  for (const key of ["summary", "location"]) if (event[key] !== undefined && !boundedText(event[key], 16000)) bad();
  let id;
  try { id = `${encodeURIComponent(event.iCalUID)}::${recurrence}`; } catch { bad(); }
  return { id, title: event.summary || "제목 없는 일정", date: start.date, endDate: end.date,
    start: start.time, end: end.time, place: event.location || "", allDay: start.allDay, cancelled: false };
}

function createCalendarSessionHandler({ env = process.env, fetch: fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 12000 } = {}) {
  // This cache is optional: losing it on a deployment or server restart simply
  // refreshes from the sealed cookie. No persistence service is necessary.
  const accessCache = new Map(), refreshing = new Map();
  const cacheKey = (session) => createHash("sha256").update(JSON.stringify([session.refresh, session.client, session.calendar, session.origin, session.nonce])).digest("hex");
  const storeAccess = (key, token) => {
    for (const [entryKey, entry] of accessCache) if (entry.expires <= now()) accessCache.delete(entryKey);
    accessCache.delete(key); accessCache.set(key, token);
    while (accessCache.size > 256) accessCache.delete(accessCache.keys().next().value);
    return token;
  };
  async function remote(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { ...options, redirect: "error", credentials: "omit", cache: "no-store", signal: controller.signal });
      if (Number(response.headers?.get("content-length")) > RESPONSE_LIMIT) throw new Error();
      let raw;
      if (response.body?.getReader) {
        const reader = response.body.getReader(), chunks = []; let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > RESPONSE_LIMIT) { await reader.cancel(); throw new Error(); }
            chunks.push(Buffer.from(value));
          }
        } finally { reader.releaseLock(); }
        raw = Buffer.concat(chunks).toString("utf8");
      } else raw = await response.text();
      if (Buffer.byteLength(raw) > RESPONSE_LIMIT) throw new Error();
      if (response.status === 204 && !raw) return { status: response.status, ok: response.ok, data: {} };
      let data;
      try { data = JSON.parse(raw); } catch { throw new Error(); }
      if (!record(data)) throw new Error();
      return { status: response.status, ok: response.ok, data };
    } catch (error) {
      if (error instanceof SessionError) throw error;
      fail(503, "google_unavailable", "구글 캘린더에 잠시 연결하지 못했습니다. 자동으로 다시 시도합니다.", true);
    } finally { clearTimeout(timer); }
  }
  async function tokenRequest(fields, config, refreshingToken = false) {
    const response = await remote(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...fields, client_id: config.clientId, client_secret: config.clientSecret }).toString() });
    if (!response.ok) {
      if (response.data.error === "invalid_grant") fail(401, "reauth_required", "구글 캘린더 자동 연결을 다시 승인해 주세요.");
      if (["invalid_client", "unauthorized_client"].includes(response.data.error)) fail(503, "setup_required", "서버의 Google OAuth 설정을 확인해 주세요.");
      if (response.status >= 500 || response.status === 429) fail(503, "google_unavailable", "구글 권한을 갱신하지 못했습니다. 잠시 후 자동으로 다시 시도합니다.", true);
      fail(400, "authorization_failed", "구글 권한 연결을 완료하지 못했습니다. 연결을 다시 승인해 주세요.");
    }
    const data = response.data;
    const scopes = typeof data.scope === "string" ? [...new Set(data.scope.split(/\s+/).filter(Boolean))] : [];
    if ((!refreshingToken || data.scope !== undefined) && (scopes.length !== 1 || scopes[0] !== SCOPE)) {
      fail(403, "scope_not_granted", "상담 일정 소유 권한만 허용하여 다시 연결해 주세요.");
    }
    const seconds = Number(data.expires_in);
    if (!safeCredential(data.access_token) || typeof data.token_type !== "string" || data.token_type.toLowerCase() !== "bearer"
      || !Number.isFinite(seconds) || seconds <= 0 || seconds > 86400) fail(502, "invalid_token_response", "구글 권한 응답을 확인하지 못했습니다.");
    return { access: data.access_token, expires: now() + Math.max(1, seconds - Math.min(60, seconds / 10)) * 1000,
      refresh: data.refresh_token };
  }
  async function accessFor(session, config, rejectedToken) {
    const key = cacheKey(session), cached = accessCache.get(key);
    if (cached?.expires > now() && (!rejectedToken || cached.access !== rejectedToken)) return cached;
    if (refreshing.has(key)) return refreshing.get(key);
    const pending = tokenRequest({ grant_type: "refresh_token", refresh_token: session.refresh }, config, true)
      .then((token) => storeAccess(key, token)).catch((error) => { accessCache.delete(key); throw error; })
      .finally(() => refreshing.delete(key));
    refreshing.set(key, pending);
    return pending;
  }
  async function calendarRequest(session, config, options) {
    let token = await accessFor(session, config);
    const send = (current) => remote(options.url, { method: options.method,
      headers: { Authorization: `Bearer ${current.access}`, ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.etag ? { "If-Match": options.etag } : {}) },
      ...(options.body ? { body: options.body } : {}) });
    let response = await send(token);
    if (response.status === 401) { token = await accessFor(session, config, token.access); response = await send(token); }
    if (!response.ok) {
      if (response.status === 401) accessCache.delete(cacheKey(session));
      throw googleFailure(response.status, response.data);
    }
    return response;
  }
  async function centerOperation(session, config, request) {
    const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(config.centerCalendarId)}/events`;
    // Each operation checks the fixed calendar's role with the current token;
    // the existing counseling cookie and grant are reused without broadening scope.
    const metadata = await calendarRequest(session, config, {
      url: `${base}?maxResults=1&fields=summary,timeZone,accessRole`, method: "GET",
    });
    if (metadata.data.accessRole !== "owner") fail(403, "center_calendar_not_owned", "센터 캘린더를 소유한 구글 계정으로 연결해 주세요.");
    if (request.operation === "list") {
      const items = [], seenPages = new Set(), seenIds = new Set();
      let pageToken = "", bytes = 0;
      for (let page = 0; page < 20; page++) {
        const query = new URLSearchParams({ singleEvents: "true", showDeleted: "true", maxResults: "250", timeZone: "Asia/Seoul",
          timeMin: `${request.from}T00:00:00+09:00`, timeMax: `${followingDate(request.to)}T00:00:00+09:00`,
          fields: `nextPageToken,items(${CENTER_FIELDS})`, ...(pageToken ? { pageToken } : {}) });
        const response = await calendarRequest(session, config, { url: `${base}?${query}`, method: "GET" });
        if (response.data.items !== undefined && !Array.isArray(response.data.items)) {
          fail(502, "invalid_calendar_response", "센터 일정 목록을 확인하지 못했습니다. 다시 새로고침해 주세요.", true);
        }
        for (const value of response.data.items || []) {
          const item = cleanCenterEvent(value);
          // Duplicate pages or concurrent pagination anomalies must not turn a
          // partial snapshot into an authoritative deletion of local records.
          if (seenIds.has(item.id)) fail(502, "incomplete_calendar_response", "센터 일정이 갱신되는 중입니다. 다시 새로고침해 주세요.", true);
          seenIds.add(item.id); items.push(item); bytes += Buffer.byteLength(JSON.stringify(item));
          if (items.length > CENTER_ITEMS_LIMIT || bytes > CENTER_BYTES_LIMIT) {
            fail(413, "calendar_range_too_large", "센터 일정이 많습니다. 더 짧은 기간으로 다시 확인해 주세요.");
          }
        }
        const next = response.data.nextPageToken;
        if (next === undefined || next === "") {
          return { calendarId: config.centerCalendarId, name: boundedText(metadata.data.summary, 500) ? metadata.data.summary : "센터 일정",
            timeZone: validTimezone(metadata.data.timeZone) ? metadata.data.timeZone : "Asia/Seoul", from: request.from, to: request.to, items };
        }
        if (!safeCredential(next, 2048) || seenPages.has(next)) {
          fail(502, "incomplete_calendar_response", "센터 일정 목록을 모두 확인하지 못했습니다. 다시 새로고침해 주세요.", true);
        }
        seenPages.add(next); pageToken = next;
      }
      fail(413, "calendar_range_too_large", "센터 일정이 많습니다. 더 짧은 기간으로 다시 확인해 주세요.");
    }
    const url = `${base}/${encodeURIComponent(request.eventId)}`;
    if (request.operation === "get") {
      try {
        const result = await calendarRequest(session, config, { url: `${url}?fields=${encodeURIComponent(CENTER_FIELDS)}`, method: "GET" });
        const item = cleanCenterEvent(result.data);
        if (item.id !== request.eventId) fail(502, "invalid_calendar_response", "센터 일정의 정보를 확인하지 못했습니다.", true);
        return { calendarId: config.centerCalendarId, item: item.status === "cancelled" ? null : item };
      } catch (error) {
        if (![404, 410].includes(error.status)) throw error;
        return { calendarId: config.centerCalendarId, item: null };
      }
    }
    if (request.operation === "delete") {
      try {
        await calendarRequest(session, config, { url: `${url}?sendUpdates=none`, method: "DELETE", etag: request.etag });
      } catch (error) { if (![404, 410].includes(error.status)) throw error; }
      return { calendarId: config.centerCalendarId, eventId: request.eventId, deleted: true };
    }
    let result;
    try {
      result = await calendarRequest(session, config, {
        url: `${request.etag ? url : base}?sendUpdates=none&fields=${encodeURIComponent(CENTER_FIELDS)}`,
        method: request.etag ? "PATCH" : "POST", ...(request.etag ? { etag: request.etag } : {}),
        body: JSON.stringify({ ...request.event, ...(!request.etag ? { id: request.eventId } : {}) }),
      });
    } catch (error) {
      if (error.status !== 409 || request.etag) throw error;
      result = await calendarRequest(session, config, { url: `${url}?fields=${encodeURIComponent(CENTER_FIELDS)}`, method: "GET" });
      const existing = cleanCenterEvent(result.data);
      if (existing.id !== request.eventId || !sameCenterEvent(existing, request.event)) {
        fail(409, "event_conflict", "같은 일정이 구글 캘린더에서 변경되었습니다. 최신 내용을 확인해 주세요.");
      }
    }
    const item = cleanCenterEvent(result.data);
    if (item.id !== request.eventId) fail(502, "invalid_calendar_response", "저장된 센터 일정의 정보를 확인하지 못했습니다.", true);
    return { calendarId: config.centerCalendarId, item };
  }
  async function counselingList(session, config, range) {
    const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(config.calendarId)}/events`;
    const metadata = await calendarRequest(session, config, { url: `${base}?maxResults=1&fields=summary,timeZone,accessRole`, method: "GET" });
    if (metadata.data.accessRole !== "owner") fail(403, "calendar_not_owned", "상담 캘린더를 소유한 구글 계정으로 연결해 주세요.");
    const events = [], seenIds = new Set(), seenPages = new Set();
    let pageToken = "", bytes = 0, count = 0;
    for (let page = 0; page < 20; page++) {
      const query = new URLSearchParams({ singleEvents: "true", showDeleted: "false", maxResults: "250", timeZone: "Asia/Seoul",
        timeMin: `${range.from}T00:00:00+09:00`, timeMax: `${range.to}T00:00:00+09:00`,
        fields: `nextPageToken,items(${COUNSEL_FIELDS})`, ...(pageToken ? { pageToken } : {}) });
      const response = await calendarRequest(session, config, { url: `${base}?${query}`, method: "GET" });
      if (response.data.items !== undefined && !Array.isArray(response.data.items)) fail(502, "invalid_calendar_response", "상담 일정 목록을 확인하지 못했습니다.", true);
      for (const value of response.data.items || []) {
        if (++count > CENTER_ITEMS_LIMIT) fail(413, "calendar_range_too_large", "상담 일정이 많습니다. 조회 기간을 줄여 주세요.");
        const item = counselingFeedEvent(value);
        if (!item) continue;
        if (seenIds.has(item.id)) fail(502, "incomplete_calendar_response", "상담 일정이 갱신되는 중입니다. 다시 새로고침해 주세요.", true);
        seenIds.add(item.id); events.push(item); bytes += Buffer.byteLength(JSON.stringify(item));
        if (bytes > CENTER_BYTES_LIMIT) fail(413, "calendar_range_too_large", "상담 일정 내용이 많습니다. 조회 기간을 줄여 주세요.");
      }
      const next = response.data.nextPageToken;
      if (next === undefined || next === "") return { calendarId: config.calendarId, ...range,
        name: boundedText(metadata.data.summary, 500) ? metadata.data.summary : "상담 캘린더", timeZone: "Asia/Seoul",
        events: events.sort((a, b) => `${a.date}${a.start}${a.id}`.localeCompare(`${b.date}${b.start}${b.id}`)), fetchedAt: new Date(now()).toISOString() };
      if (!safeCredential(next, 2048) || seenPages.has(next)) fail(502, "incomplete_calendar_response", "상담 일정 목록을 모두 확인하지 못했습니다.", true);
      seenPages.add(next); pageToken = next;
    }
    fail(413, "calendar_range_too_large", "상담 일정이 많습니다. 조회 기간을 줄여 주세요.");
  }
  return async function handler(req, res) {
    let origin = "";
    const send = (status, data) => { res.writeHead(status, HEADERS); res.end(JSON.stringify(data)); };
    try {
      const config = settings(env);
      if (req.method === "GET") {
        const query = new URL(req.url || "/", "http://localhost").searchParams;
        if (query.get("action") !== "config" || [...query].length !== 1) fail(400, "invalid_request", "올바른 요청을 선택해 주세요.");
        return send(200, { configured: config.configured, clientId: validClient(config.clientId) ? config.clientId : "",
          calendarId: validCalendar(config.calendarId) ? config.calendarId : "",
          centerCalendarId: validCalendar(config.centerCalendarId) ? config.centerCalendarId : "" });
      }
      if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); fail(405, "method_not_allowed", "지원하지 않는 요청 방식입니다."); }
      if (!config.configured) fail(503, "setup_required", "자동 연결을 위한 서버 설정이 필요합니다.");
      origin = requestOrigin(req, config);
      const body = await readBody(req);
      const connected = { connected: true, clientId: config.clientId, calendarId: config.calendarId, persistent: true };
      if (body.action === "disconnect" && hasKeys(body, ["action"])) {
        try { accessCache.delete(cacheKey(readSession(req, origin, config, now()))); } catch { /* Disconnect also clears expired cookies. */ }
        res.setHeader("Set-Cookie", cookieHeader(origin, "", now(), true));
        return send(200, { connected: false, persistent: true });
      }
      if (body.action === "exchange" && hasKeys(body, ["action", "code", "calendarId"])) {
        if (body.calendarId !== config.calendarId || !safeCredential(body.code)) fail(400, "invalid_request", "연결할 상담 캘린더와 구글 승인 코드를 확인해 주세요.");
        const token = await tokenRequest({ grant_type: "authorization_code", code: body.code, redirect_uri: origin }, config);
        if (!safeCredential(token.refresh, 2048)) fail(409, "offline_access_required", "자동 갱신 권한을 받지 못했습니다. 구글 연결 화면에서 권한을 다시 승인해 주세요.");
        const issued = now();
        const session = { v: 1, refresh: token.refresh, client: config.clientId, calendar: config.calendarId, origin,
          issued, expires: issued + SESSION_AGE * 1000, nonce: randomBytes(16).toString("base64url") };
        const check = await remote(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(config.calendarId)}/events?maxResults=1&fields=summary,timeZone,accessRole`,
          { method: "GET", headers: { Authorization: `Bearer ${token.access}` } });
        if (!check.ok) throw googleFailure(check.status, check.data);
        if (check.data.accessRole !== "owner") fail(403, "calendar_not_owned", "해당 상담 캘린더를 소유한 구글 계정으로 연결해 주세요.");
        const cookie = cookieHeader(origin, seal(session, config.key), issued);
        storeAccess(cacheKey(session), token);
        res.setHeader("Set-Cookie", cookie);
        return send(200, connected);
      }
      if (body.action === "restore" && hasKeys(body, ["action", "calendarId"])) {
        if (body.calendarId !== config.calendarId) fail(400, "calendar_mismatch", "서버에 연결된 상담 캘린더를 선택해 주세요.");
        const session = readSession(req, origin, config, now());
        await accessFor(session, config);
        return send(200, connected);
      }
      if (body.action === "proxy") {
        const options = proxyRequest(body, config);
        const session = readSession(req, origin, config, now());
        const response = await calendarRequest(session, config, options);
        return send(response.status, response.data);
      }
      if (body.action === "center") {
        const request = centerRequest(body, config);
        const session = readSession(req, origin, config, now());
        return send(200, await centerOperation(session, config, request));
      }
      if (body.action === "counsel-list") {
        const range = counselingListRequest(body);
        const session = readSession(req, origin, config, now());
        return send(200, await counselingList(session, config, range));
      }
      fail(400, "invalid_request", "지원하지 않는 캘린더 요청입니다.");
    } catch (error) {
      const failure = error instanceof SessionError ? error
        : new SessionError(500, "session_error", "구글 자동 연결을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", true);
      // An old request may fail after a newer authorization already replaced
      // the cookie. Never let that stale response erase the new connection.
      // Invalid cookies grant no access; only explicit disconnect deletes one.
      send(failure.status, { error: { code: failure.code, message: failure.message, retryable: failure.retryable } });
    }
  };
}

const handler = createCalendarSessionHandler();
module.exports = { handler, createCalendarSessionHandler };
