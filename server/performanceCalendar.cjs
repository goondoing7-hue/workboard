"use strict";

const { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } = require("node:crypto");
const SCOPES = ["https://www.googleapis.com/auth/calendar.app.created", "https://www.googleapis.com/auth/calendar.calendarlist.readonly"];
const SCOPE = SCOPES.join(" ");
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";
const MARKER = "workboard:counseling-training:v1";
const NAME = "상담·수련 실적";
const SESSION_AGE = 180 * 86400;
const BODY_LIMIT = 32 * 1024;
const RESPONSE_LIMIT = 4 * 1024 * 1024;
const AAD = Buffer.from("workboard:performance-calendar:cookie:v1");
const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
class CalendarError extends Error {
  constructor(status, code, message, retryable = false, remote = undefined) { super(message); Object.assign(this, { status, code, retryable, remote }); }
}
const fail = (...args) => { throw new CalendarError(...args); };
const object = value => value !== null && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const keys = (value, required, optional = []) => object(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const text = (value, max, empty = true) => typeof value === "string" && value.length <= max && (empty || !!value.trim()) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const credential = (value, max = 4096) => typeof value === "string" && value.length > 0 && value.length <= max && /^[\x21-\x7e]+$/.test(value);
const calendarId = value => typeof value === "string" && value !== "primary" && /^[A-Za-z0-9._+@-]{1,1024}$/.test(value);
const eventId = value => typeof value === "string" && /^[A-Za-z0-9_:-]{5,1024}$/.test(value);
const localId = value => typeof value === "string" && /^[\w:.-]{1,150}$/.test(value);
const etag = value => typeof value === "string" && value.length > 0 && value.length <= 256 && /^[\x21-\x7e]+$/.test(value);
const digest = value => createHash("sha256").update(value).digest("hex");
const deterministicId = value => "a1" + digest("workboard:training:" + value);
const validDate = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !value.startsWith("0000") && Number.isFinite(Date.parse(value + "T00:00:00Z")) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
const nextDay = value => new Date(Date.parse(value + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);

function settings(env) {
  const clientId = String(env.GOOGLE_CALENDAR_CLIENT_ID || "").trim();
  const clientSecret = String(env.GOOGLE_CALENDAR_CLIENT_SECRET || "").trim();
  const encoded = String(env.GOOGLE_CALENDAR_SESSION_KEY || "").trim();
  const key = /^[A-Za-z0-9_-]{43}$/.test(encoded) ? Buffer.from(encoded, "base64url") : null;
  const origins = new Set(); let invalid = false;
  for (const raw of String(env.GOOGLE_CALENDAR_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean)) {
    try {
      const url = new URL(raw);
      if (url.origin !== raw || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) invalid = true;
      else origins.add(raw);
    } catch { invalid = true; }
  }
  const password = String(env.PERFORMANCE_CONNECTION_PASSWORD || env.WORKBOARD_CONNECTION_PASSWORD || "");
  return { clientId, clientSecret, key, origins, password,
    configured: /^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId) && credential(clientSecret) && key?.length === 32 && key.toString("base64url") === encoded && origins.size > 0 && !invalid };
}
function requestOrigin(req, config) {
  let origin = req.headers?.origin;
  if (!origin && req.method === "GET") { try { origin = new URL(req.headers?.referer).origin; } catch { /* fail closed */ } }
  if (typeof origin !== "string" || !config.origins.has(origin) || new URL(origin).host !== String(req.headers?.host || "").toLowerCase()
    || req.headers?.["x-workboard-performance-calendar"] !== "1" || (req.headers?.["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin")) {
    fail(403, "invalid_origin", "실적 관리의 수련 일정 화면에서 다시 시도해 주세요.");
  }
  return origin;
}
const cookieName = (origin, kind) => `${origin.startsWith("https:") ? "__Host-" : ""}wb_performance_calendar_${kind}`;
function cookie(origin, kind, value, now, age) {
  return `${cookieName(origin, kind)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}; Expires=${new Date(age ? now + age * 1000 : 0).toUTCString()}${origin.startsWith("https:") ? "; Secure" : ""}`;
}
function seal(value, key) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv); cipher.setAAD(AAD);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const result = ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
  if (result.length > 3800) fail(502, "invalid_token_response", "Google 연결 정보를 안전하게 저장하지 못했습니다.");
  return result;
}
function unseal(req, origin, config, now, kind) {
  try {
    const prefix = cookieName(origin, kind) + "=", values = String(req.headers?.cookie || "").split(";").map(value => value.trim()).filter(value => value.startsWith(prefix));
    if (values.length !== 1) throw new Error();
    const raw = values[0].slice(prefix.length);
    if (raw.length > 3800 || !/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
    const [, iv, tag, body] = raw.split(".");
    if (Buffer.from(iv, "base64url").length !== 12 || Buffer.from(tag, "base64url").length !== 16) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", config.key, Buffer.from(iv, "base64url")); decipher.setAAD(AAD); decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const result = JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8"));
    if (!object(result) || result.kind !== kind || result.origin !== origin || result.client !== config.clientId || !Number.isFinite(result.expires)
      || result.expires <= now || result.expires > now + SESSION_AGE * 1000 || !credential(result.nonce, 32)) throw new Error();
    if (kind === "session" && (!credential(result.refresh, 2048) || !calendarId(result.calendar))) throw new Error();
    return result;
  } catch { fail(401, kind === "grant" ? "connect_required" : "reauth_required", "수련 캘린더 연결 버튼에서 Google 계정을 다시 승인해 주세요."); }
}
async function readBody(req) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers?.["content-type"] || "")) fail(415, "invalid_request", "JSON 형식으로 다시 시도해 주세요.");
  if (req.headers?.["content-length"] && (!/^\d+$/.test(String(req.headers["content-length"])) || Number(req.headers["content-length"]) > BODY_LIMIT)) fail(413, "request_too_large", "일정 요청 내용이 너무 큽니다.");
  let raw = req.body;
  if (raw === undefined) {
    const chunks = []; let size = 0;
    for await (const part of req) { const buffer = Buffer.from(part); size += buffer.length; if (size > BODY_LIMIT) fail(413, "request_too_large", "일정 요청 내용이 너무 큽니다."); chunks.push(buffer); }
    raw = Buffer.concat(chunks);
  }
  try {
    const value = Buffer.isBuffer(raw) ? raw.toString("utf8") : typeof raw === "string" ? raw : JSON.stringify(raw);
    if (!value || Buffer.byteLength(value) > BODY_LIMIT) fail(413, "request_too_large", "일정 요청 내용이 너무 큽니다.");
    const result = JSON.parse(value); if (!object(result)) throw new Error(); return result;
  } catch (error) { if (error instanceof CalendarError) throw error; fail(400, "invalid_request", "일정 요청 내용을 확인해 주세요."); }
}
function eventTime(value) {
  // Google treats the timeZone field as immaterial for all-day dates.
  if (keys(value, ["date"], ["timeZone"]) && validDate(value.date)) {
    if (value.timeZone !== undefined) { try { if (!text(value.timeZone, 100, false)) return null; new Intl.DateTimeFormat("en", { timeZone: value.timeZone }); } catch { return null; } }
    return { date: value.date };
  }
  if (!keys(value, ["dateTime"], ["timeZone"]) || typeof value.dateTime !== "string") return null;
  const match = value.dateTime.match(/^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(\.\d{1,3})?)?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/);
  if (!match || !validDate(match[1]) || !Number.isFinite(Date.parse(value.dateTime)) || /[+-]14:(?!00)/.test(match[6])) return null;
  if (value.timeZone !== undefined) { try { if (!text(value.timeZone, 100, false)) return null; new Intl.DateTimeFormat("en", { timeZone: value.timeZone }); } catch { return null; } }
  return { dateTime: `${match[1]}T${match[2]}:${match[3]}:${match[4] || "00"}${match[5] || ""}${match[6]}`, ...(value.timeZone ? { timeZone: value.timeZone } : {}) };
}
const timeValue = value => value?.date || (value?.dateTime ? Date.parse(value.dateTime) : null);
const validInterval = (start, end) => start && end && !!start.date === !!end.date && timeValue(start) < timeValue(end);
function cleanWrite(value, linkedId) {
  const invalid = () => fail(400, "invalid_event", "일정 제목·시작·종료·연결 항목을 확인해 주세요.");
  if (!keys(value, ["summary", "start", "end", "extendedProperties"], ["location"]) || !text(value.summary, 300, false) || (value.location !== undefined && !text(value.location, 1000))) invalid();
  const start = eventTime(value.start), end = eventTime(value.end), properties = value.extendedProperties?.private;
  if (!validInterval(start, end) || !keys(value.extendedProperties, ["private"]) || !keys(properties, ["trainingScheduleId"], ["target", "itemId"])
    || properties.trainingScheduleId !== linkedId || !localId(properties.trainingScheduleId)
    || (properties.target !== undefined && !["", "kcp", "kca", "military"].includes(properties.target))
    || (properties.itemId !== undefined && !(properties.itemId === "" || typeof properties.itemId === "string" && /^[a-z0-9-]{1,150}$/.test(properties.itemId)))) invalid();
  return { summary: value.summary, location: value.location || "", start, end,
    extendedProperties: { private: { trainingScheduleId: linkedId, target: properties.target || "", itemId: properties.itemId || "" } } };
}
function cleanRemote(value) {
  const invalid = () => fail(502, "invalid_calendar_response", "Google 일정 응답이 완전하지 않습니다. 기존 일정을 보존하고 다시 확인합니다.", true);
  if (!object(value) || !eventId(value.id) || !["confirmed", "tentative", "cancelled"].includes(value.status)) invalid();
  const result = { id: value.id, status: value.status };
  if (value.etag !== undefined) { if (!etag(value.etag)) invalid(); result.etag = value.etag; }
  if (value.status !== "cancelled" && !result.etag) invalid();
  for (const key of ["summary", "location"]) {
    if (value[key] !== undefined && !text(value[key], 4000)) invalid();
    if (value[key] !== undefined || value.status !== "cancelled") result[key] = value[key] || "";
  }
  for (const key of ["start", "end", "originalStartTime"]) if (value[key] !== undefined) { const parsed = eventTime(value[key]); if (!parsed) invalid(); result[key] = parsed; }
  if (value.status !== "cancelled" && !validInterval(result.start, result.end)) invalid();
  if (value.recurringEventId !== undefined) { if (!eventId(value.recurringEventId)) invalid(); result.recurringEventId = value.recurringEventId; }
  if (value.updated !== undefined) { if (typeof value.updated !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value.updated) || !Number.isFinite(Date.parse(value.updated))) invalid(); result.updated = value.updated; }
  if (value.htmlLink !== undefined) {
    try { const url = new URL(value.htmlLink); if (url.protocol !== "https:" || url.hostname !== "www.google.com" && url.hostname !== "calendar.google.com") invalid(); result.htmlLink = url.href; } catch { invalid(); }
  }
  const properties = value.extendedProperties?.private;
  if (properties !== undefined && !object(properties)) invalid();
  const safe = {};
  if (properties?.trainingScheduleId !== undefined) { if (!localId(properties.trainingScheduleId)) invalid(); safe.trainingScheduleId = properties.trainingScheduleId; }
  if (properties?.target !== undefined) { if (!["", "kcp", "kca", "military"].includes(properties.target)) invalid(); safe.target = properties.target; }
  if (properties?.itemId !== undefined) { if (!(properties.itemId === "" || typeof properties.itemId === "string" && /^[a-z0-9-]{1,150}$/.test(properties.itemId))) invalid(); safe.itemId = properties.itemId; }
  if (Object.keys(safe).length) result.extendedProperties = { private: safe };
  return result;
}
function sameWrite(actual, expected) {
  return actual?.status !== "cancelled" && actual?.summary === expected.summary && (actual.location || "") === expected.location
    && timeValue(actual.start) === timeValue(expected.start) && timeValue(actual.end) === timeValue(expected.end)
    && ["trainingScheduleId", "target", "itemId"].every(key => (actual.extendedProperties?.private?.[key] || "") === (expected.extendedProperties.private[key] || ""));
}

function createPerformanceCalendarHandler({ env = process.env, fetch: fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 15000 } = {}) {
  const cache = new Map(), refreshing = new Map();
  const cacheKey = session => digest(JSON.stringify([session.client, session.origin, session.refresh, session.nonce]));
  const cacheToken = (key, token) => { cache.set(key, token); for (const [id, entry] of cache) if (entry.expires <= now()) cache.delete(id); while (cache.size > 256) cache.delete(cache.keys().next().value); return token; };
  async function remote(url, options = {}) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { ...options, redirect: "error", credentials: "omit", cache: "no-store", signal: controller.signal });
      if (Number(response.headers?.get("content-length")) > RESPONSE_LIMIT) fail(413, "calendar_too_large", "일정 조회 응답이 너무 큽니다. 기존 일정을 보존합니다.");
      const chunks = []; let size = 0;
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > RESPONSE_LIMIT) { await reader.cancel(); fail(413, "calendar_too_large", "일정 조회 응답이 너무 큽니다."); } chunks.push(Buffer.from(value)); } }
        finally { reader.releaseLock(); }
      } else { const value = await response.text(); size = Buffer.byteLength(value); if (size > RESPONSE_LIMIT) fail(413, "calendar_too_large", "일정 조회 응답이 너무 큽니다."); chunks.push(Buffer.from(value)); }
      const raw = Buffer.concat(chunks).toString("utf8"), data = raw ? JSON.parse(raw) : response.status === 204 ? {} : null;
      if (!object(data)) throw new Error();
      return { ok: response.ok, status: response.status, data };
    } catch (error) { if (error instanceof CalendarError) throw error; fail(503, "google_unavailable", "Google 응답을 확인하지 못했습니다. 저장 대기 일정을 유지하고 다시 시도합니다.", true); }
    finally { clearTimeout(timer); }
  }
  function googleFailure(response) {
    if (response.status === 401) fail(401, "reauth_required", "Google 수련 캘린더를 다시 연결해 주세요.");
    if ([404, 410].includes(response.status)) fail(409, "calendar_missing", "연결한 수련 캘린더를 찾을 수 없습니다. 새 달력으로 바꾸지 않고 일정을 보존합니다.");
    if (response.status === 429 || response.status >= 500) fail(503, "google_unavailable", "Google 요청을 완료하지 못했습니다. 일정을 보존하고 다시 시도합니다.", true);
    if (response.status === 403) fail(403, "permission_required", "Google Calendar API 사용 설정과 수련 캘린더 권한을 확인해 주세요.");
    fail(502, "google_request_failed", "Google 수련 캘린더 요청을 완료하지 못했습니다.", true);
  }
  async function tokenRequest(config, fields, refresh = false) {
    const response = await remote(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...fields, client_id: config.clientId, client_secret: config.clientSecret }).toString() });
    if (!response.ok) {
      if (response.data.error === "invalid_grant") fail(401, "reauth_required", "Google 수련 캘린더를 다시 승인해 주세요.");
      if (["invalid_client", "unauthorized_client"].includes(response.data.error)) fail(503, "setup_required", "서버의 Google OAuth 설정을 확인해 주세요.");
      googleFailure(response);
    }
    const value = response.data, scopes = typeof value.scope === "string" ? [...new Set(value.scope.split(/\s+/).filter(Boolean))] : [];
    if ((!refresh || value.scope !== undefined) && (scopes.length !== SCOPES.length || !SCOPES.every(scope => scopes.includes(scope)))) fail(403, "scope_not_granted", "앱 전용 달력 관리와 캘린더 목록 읽기 권한을 승인하여 다시 연결해 주세요.");
    const seconds = Number(value.expires_in);
    if (!credential(value.access_token) || String(value.token_type).toLowerCase() !== "bearer" || !Number.isFinite(seconds) || seconds <= 0 || seconds > 86400) fail(502, "invalid_token_response", "Google 권한 응답을 확인하지 못했습니다.");
    return { access: value.access_token, refresh: value.refresh_token, expires: now() + Math.max(1, seconds - Math.min(60, seconds / 10)) * 1000 };
  }
  async function accessFor(session, config, rejected) {
    const key = cacheKey(session), existing = cache.get(key);
    if (existing?.expires > now() && existing.access !== rejected) return existing;
    if (refreshing.has(key)) return refreshing.get(key);
    const promise = tokenRequest(config, { grant_type: "refresh_token", refresh_token: session.refresh }, true).then(token => cacheToken(key, token))
      .catch(error => { cache.delete(key); throw error; }).finally(() => refreshing.delete(key));
    refreshing.set(key, promise); return promise;
  }
  async function google(session, config, url, method = "GET", body, extraHeaders = {}, allowed = []) {
    let token = await accessFor(session, config);
    const send = value => remote(url, { method, headers: { Authorization: `Bearer ${value.access}`, ...extraHeaders, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    let response = await send(token);
    if (response.status === 401) { token = await accessFor(session, config, token.access); response = await send(token); }
    if (!response.ok && !allowed.includes(response.status)) googleFailure(response);
    return response;
  }
  function metadata(value, expected) {
    if (!object(value) || !calendarId(value.id) || (expected && value.id !== expected) || value.description !== MARKER || value.accessRole !== "owner" || value.deleted === true || value.primary === true
      || !text(value.summary, 300, false)) fail(403, "invalid_training_calendar", "이 앱이 만든 본인 소유의 수련 전용 달력만 연결할 수 있습니다.");
    return { id: value.id, name: value.summary, url: `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(value.id)}` };
  }
  async function calendarMetadata(session, config) {
    const response = await google(session, config, `${API}/users/me/calendarList/${encodeURIComponent(session.calendar)}`);
    return metadata(response.data, session.calendar);
  }
  async function discover(session, config, preferred) {
    const entries = [], seen = new Set(), ids = new Set(); let pageToken;
    do {
      const query = new URLSearchParams({ maxResults: "250", showHidden: "true", minAccessRole: "owner" }); if (pageToken) query.set("pageToken", pageToken);
      const { data } = await google(session, config, `${API}/users/me/calendarList?${query}`);
      if (data.kind !== "calendar#calendarList" || !Array.isArray(data.items) || (data.nextPageToken !== undefined && !credential(data.nextPageToken, 4096))) fail(502, "incomplete_calendar_list", "기존 달력 목록을 완전히 확인하지 못했습니다. 새 달력을 만들지 않습니다.", true);
      for (const entry of data.items) {
        if (!object(entry) || !calendarId(entry.id) || typeof entry.accessRole !== "string" || ids.has(entry.id)) fail(502, "incomplete_calendar_list", "기존 달력 목록이 중복되거나 완전하지 않습니다.", true);
        ids.add(entry.id); if (entry.description === MARKER) entries.push(entry);
      }
      pageToken = data.nextPageToken;
      if (pageToken && (seen.has(pageToken) || seen.size >= 99) || ids.size > 10000) fail(502, "incomplete_calendar_list", "기존 달력 목록 조회를 완료하지 못했습니다. 새 달력을 만들지 않습니다.", true);
      if (pageToken) seen.add(pageToken);
    } while (pageToken);
    if (preferred || entries.length) {
      const selected = preferred ? entries.find(entry => entry.id === preferred) : entries.length === 1 ? entries[0] : null;
      if (!selected) fail(409, preferred ? "calendar_missing" : "calendar_selection_required", preferred ? "이전에 연결한 수련 달력을 찾지 못했습니다. 새 달력을 만들지 않습니다." : "수련 전용 달력이 여러 개입니다. 기존 달력을 선택해야 합니다.");
      const calendar = metadata(selected); session.calendar = calendar.id; return calendarMetadata(session, config);
    }
    const { data } = await google(session, config, `${API}/calendars`, "POST", { summary: NAME, description: MARKER, timeZone: "Asia/Seoul" });
    if (!calendarId(data.id) || data.description !== MARKER || data.summary !== NAME || data.timeZone !== "Asia/Seoul") fail(502, "invalid_calendar_response", "생성한 달력 정보를 확인하지 못했습니다. 다시 연결하면 기존 달력을 먼저 확인합니다.", true);
    session.calendar = data.id; return calendarMetadata(session, config);
  }
  const eventUrl = (session, id) => `${API}/calendars/${encodeURIComponent(session.calendar)}/events${id ? "/" + encodeURIComponent(id) : ""}`;
  async function getEvent(session, config, id) {
    const response = await google(session, config, eventUrl(session, id), "GET", undefined, {}, [404, 410]);
    if ([404, 410].includes(response.status)) return null;
    const event = cleanRemote(response.data); if (event.id !== id) fail(502, "invalid_calendar_response", "요청한 일정과 다른 응답을 받아 처리를 중단했습니다.", true);
    return { event, raw: response.data };
  }
  function conflict(remote) { fail(409, "calendar_conflict", "Google에서 일정이 변경되었습니다. 양쪽 내용을 확인한 뒤 다시 저장해 주세요.", false, remote); }
  function queryKeys(query, allowed) {
    if ([...query.keys()].some(key => !allowed.includes(key) || query.getAll(key).length !== 1)) fail(400, "invalid_request", "일정 조회 조건을 확인해 주세요.");
  }
  return async function handler(req, res) {
    const send = (status, data) => { res.writeHead(status, HEADERS); res.end(JSON.stringify(data)); };
    try {
      const config = settings(env), query = new URL(req.url || "/", "http://localhost").searchParams;
      if (!["GET", "POST"].includes(req.method)) { res.setHeader("Allow", "GET, POST"); fail(405, "method_not_allowed", "지원하지 않는 요청 방식입니다."); }
      const action = req.method === "GET" ? query.get("action") : null;
      if (req.method === "GET" && !["status", "list", "event"].includes(action)) fail(400, "invalid_request", "지원하지 않는 일정 조회입니다.");
      if (!config.configured) {
        if (action === "status") return send(200, { configured: false, connected: false, passwordRequired: !!config.password, clientId: "", scope: SCOPE, calendar: null });
        fail(503, "setup_required", "서버의 Google 수련 캘린더 설정이 필요합니다.");
      }
      const origin = requestOrigin(req, config);
      if (action === "status") {
        queryKeys(query, ["action"]); let session; try { session = unseal(req, origin, config, now(), "session"); } catch { /* not connected */ }
        const calendar = session ? await calendarMetadata(session, config) : null;
        return send(200, { configured: true, connected: !!session, passwordRequired: !!config.password, clientId: config.clientId, scope: SCOPE, calendar });
      }
      if (action === "event") {
        queryKeys(query, ["action", "eventId"]); const id = query.get("eventId"); if (!eventId(id)) fail(400, "invalid_request", "일정 ID를 확인해 주세요.");
        const session = unseal(req, origin, config, now(), "session"); await calendarMetadata(session, config);
        return send(200, { calendarId: session.calendar, event: (await getEvent(session, config, id))?.event || null });
      }
      if (action === "list") {
        queryKeys(query, ["action", "from", "to"]); const from = query.get("from"), to = query.get("to");
        if (!validDate(from) || !validDate(to) || to < from || (Date.parse(to) - Date.parse(from)) / 86400000 + 1 > 400) fail(400, "invalid_request", "일정 조회 기간은 시작일부터 최대 400일로 설정해 주세요.");
        const session = unseal(req, origin, config, now(), "session"); await calendarMetadata(session, config);
        const items = [], seen = new Set(), ids = new Set(); let pageToken;
        do {
          const params = new URLSearchParams({ singleEvents: "true", showDeleted: "true", maxResults: "250", timeZone: "Asia/Seoul", timeMin: from + "T00:00:00+09:00", timeMax: nextDay(to) + "T00:00:00+09:00" });
          if (pageToken) params.set("pageToken", pageToken);
          const { data } = await google(session, config, eventUrl(session) + "?" + params);
          if (data.kind !== "calendar#events" || !etag(data.etag) || !Array.isArray(data.items) || (data.nextPageToken !== undefined && !credential(data.nextPageToken, 4096))) fail(502, "incomplete_event_list", "Google 일정 목록을 완전히 읽지 못했습니다. 기존 일정을 보존합니다.", true);
          for (const value of data.items) { const entry = cleanRemote(value); if (ids.has(entry.id)) fail(502, "incomplete_event_list", "조회 중 일정 목록이 달라졌습니다. 다시 확인해 주세요.", true); ids.add(entry.id); items.push(entry); }
          pageToken = data.nextPageToken;
          if (pageToken && (seen.has(pageToken) || seen.size >= 99) || items.length > 10000 || Buffer.byteLength(JSON.stringify(items)) > RESPONSE_LIMIT) fail(413, "calendar_too_large", "일정 조회 범위를 줄여 다시 시도해 주세요. 기존 일정을 보존합니다.");
          if (pageToken) seen.add(pageToken);
        } while (pageToken);
        return send(200, { calendarId: session.calendar, from, to, items });
      }
      const body = await readBody(req); queryKeys(query, ["action"]);
      if (query.has("action") && query.get("action") !== body.action) fail(400, "invalid_request", "일정 요청 종류가 일치하지 않습니다.");
      if (body.action === "disconnect" && keys(body, ["action"])) {
        try { cache.delete(cacheKey(unseal(req, origin, config, now(), "session"))); } catch { /* expired cookie also clears */ }
        res.setHeader("Set-Cookie", [cookie(origin, "session", "", now(), 0), cookie(origin, "grant", "", now(), 0)]); return send(200, { connected: false });
      }
      if (body.action === "connect" && keys(body, ["action"], ["password"])) {
        if (config.password && (typeof body.password !== "string" || body.password.length > 1024 || !timingSafeEqual(Buffer.from(digest(body.password)), Buffer.from(digest(config.password))))) fail(403, "invalid_password", "연결 비밀번호를 확인해 주세요.");
        const grant = { kind: "grant", origin, client: config.clientId, expires: now() + 600000, nonce: randomBytes(16).toString("base64url") };
        res.setHeader("Set-Cookie", cookie(origin, "grant", seal(grant, config.key), now(), 600)); return send(200, { clientId: config.clientId, scope: SCOPE, mode: "popup" });
      }
      if (body.action === "exchange" && keys(body, ["action", "code"], ["calendarId"])) {
        const grant = unseal(req, origin, config, now(), "grant");
        if (!credential(body.code, 8192) || (body.calendarId !== undefined && !calendarId(body.calendarId))) fail(400, "invalid_request", "Google 연결 정보를 확인해 주세요.");
        const token = await tokenRequest(config, { grant_type: "authorization_code", code: body.code, redirect_uri: origin });
        if (!credential(token.refresh, 2048)) fail(409, "offline_access_required", "자동 갱신 권한을 받지 못했습니다. Google 연결을 다시 승인해 주세요.");
        const session = { kind: "session", origin, client: config.clientId, refresh: token.refresh, expires: now() + SESSION_AGE * 1000, nonce: grant.nonce };
        cacheToken(cacheKey(session), token); const calendar = await discover(session, config, body.calendarId);
        res.setHeader("Set-Cookie", [cookie(origin, "session", seal(session, config.key), now(), SESSION_AGE), cookie(origin, "grant", "", now(), 0)]);
        return send(200, { connected: true, calendar });
      }
      if (body.action === "upsert" && keys(body, ["action", "calendarId", "localId", "event"], ["eventId", "etag"])) {
        if (!calendarId(body.calendarId) || !localId(body.localId) || (body.eventId !== undefined && !eventId(body.eventId)) || (body.eventId !== undefined ? !etag(body.etag) : body.etag !== undefined)) fail(400, "invalid_event", "수정할 일정 ID와 최신 확인 정보를 확인해 주세요.");
        const value = cleanWrite(body.event, body.localId), session = unseal(req, origin, config, now(), "session");
        if (body.calendarId !== session.calendar) fail(409, "calendar_changed", "연결한 달력이 달라 전송을 중단했습니다.");
        await calendarMetadata(session, config);
        const id = body.eventId || deterministicId(body.localId), existing = await getEvent(session, config, id);
        if (!body.eventId && existing) { if (sameWrite(existing.event, value)) return send(200, { calendarId: session.calendar, event: existing.event }); conflict(existing.event); }
        if (body.eventId && (!existing || existing.event.status === "cancelled" || existing.event.etag !== body.etag)) conflict(existing?.event || null);
        if (body.eventId && Array.isArray(existing.raw.recurrence) && !existing.event.recurringEventId) fail(400, "recurring_series_not_supported", "반복 일정 전체 대신 수정할 회차를 선택해 주세요.");
        const response = body.eventId
          ? await google(session, config, eventUrl(session, id) + "?sendUpdates=none", "PATCH", value, { "If-Match": body.etag }, [404, 410, 412])
          : await google(session, config, eventUrl(session) + "?sendUpdates=none", "POST", { id, ...value }, {}, [409]);
        if ([404, 410, 412].includes(response.status)) conflict((await getEvent(session, config, id))?.event || null);
        if (response.status === 409) {
          const concurrent = await getEvent(session, config, id); if (concurrent && sameWrite(concurrent.event, value)) return send(200, { calendarId: session.calendar, event: concurrent.event }); conflict(concurrent?.event || null);
        }
        const saved = cleanRemote(response.data);
        if (saved.id !== id || !sameWrite(saved, value)) fail(503, "save_unconfirmed", "Google 일정 저장 결과를 확인하지 못했습니다. 같은 일정 ID로 다시 확인합니다.", true);
        return send(200, { calendarId: session.calendar, event: saved });
      }
      if (body.action === "delete" && keys(body, ["action", "calendarId", "eventId", "etag"])) {
        if (!calendarId(body.calendarId) || !eventId(body.eventId) || !etag(body.etag)) fail(400, "invalid_event", "삭제할 일정과 최신 확인 정보를 확인해 주세요.");
        const session = unseal(req, origin, config, now(), "session"); if (body.calendarId !== session.calendar) fail(409, "calendar_changed", "연결한 달력이 달라 삭제를 중단했습니다.");
        await calendarMetadata(session, config); const existing = await getEvent(session, config, body.eventId);
        if (!existing || existing.event.status === "cancelled") return send(200, { calendarId: session.calendar, deleted: true, eventId: body.eventId });
        if (existing.event.etag !== body.etag) conflict(existing.event);
        if (Array.isArray(existing.raw.recurrence) && !existing.event.recurringEventId) fail(400, "recurring_series_not_supported", "반복 일정 전체 대신 삭제할 회차를 선택해 주세요.");
        const response = await google(session, config, eventUrl(session, body.eventId) + "?sendUpdates=none", "DELETE", undefined, { "If-Match": body.etag }, [404, 410, 412]);
        if (response.status === 412) conflict((await getEvent(session, config, body.eventId))?.event || null);
        return send(200, { calendarId: session.calendar, deleted: true, eventId: body.eventId });
      }
      fail(400, "invalid_request", "지원하지 않는 수련 캘린더 요청입니다.");
    } catch (error) {
      const failure = error instanceof CalendarError ? error : new CalendarError(500, "calendar_error", "수련 캘린더 요청을 완료하지 못했습니다. 기존 일정을 보존합니다.", true);
      send(failure.status, { error: { code: failure.code, message: failure.message, retryable: failure.retryable }, ...(failure.remote !== undefined ? { remote: failure.remote } : {}) });
    }
  };
}

const handler = createPerformanceCalendarHandler();
module.exports = { handler, createPerformanceCalendarHandler };
