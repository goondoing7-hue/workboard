import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { createCalendarSessionHandler } from "../server/googleCalendarSession.cjs";

const CLIENT = "1234567890-workboard.apps.googleusercontent.com";
const CALENDAR = "counseling@group.calendar.google.com";
const ORIGIN = "https://workboard.example";
const SCOPE = "https://www.googleapis.com/auth/calendar.events.owned";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const EVENTS = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR)}/events`;
const META = `${EVENTS}?maxResults=1&fields=summary,timeZone,accessRole`;
const SESSION_MS = 180 * 24 * 60 * 60 * 1000;
const env = (patch = {}) => ({
  GOOGLE_CALENDAR_CLIENT_ID: CLIENT,
  GOOGLE_CALENDAR_CLIENT_SECRET: "fake-server-secret",
  GOOGLE_CALENDAR_SESSION_KEY: Buffer.alloc(32, 7).toString("base64url"),
  GOOGLE_CALENDAR_ID: CALENDAR,
  GOOGLE_CALENDAR_ORIGINS: `${ORIGIN},http://localhost:3000`, ...patch,
});
const tokenData = (patch = {}) => ({ access_token: "fake-short-token", token_type: "Bearer", expires_in: 3600,
  refresh_token: "fake-server-only-refresh", scope: SCOPE, ...patch });
const eventId = (id = "reservation-1") => "b0" + createHash("sha256").update(`workboard:reservation:${id}`).digest("hex");
const event = () => ({ id: eventId(), summary: "상담 예약", location: "마음",
  start: { dateTime: "2026-09-22T10:35:00+09:00", timeZone: "Asia/Seoul" },
  end: { dateTime: "2026-09-22T11:35:00+09:00", timeZone: "Asia/Seoul" },
  extendedProperties: { private: { workboardReservationId: "reservation-1" } } });
function fixture(options = {}) {
  let clock = Date.parse("2026-09-21T00:00:00Z");
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (options.fetch) return options.fetch(url, init, calls);
    return Response.json(url === TOKEN_URL ? tokenData() : { accessRole: "owner", summary: "5. counseling" });
  };
  const config = env(options.env);
  const handler = createCalendarSessionHandler({ env: config, fetch, now: () => clock, timeoutMs: options.timeoutMs || 1000 });
  return { handler, config, calls, fetch, now: () => clock, advance: (ms) => { clock += ms; } };
}
async function request(handler, body, options = {}) {
  const method = options.method || "POST";
  const serialized = options.raw ?? JSON.stringify(body);
  const req = Readable.from(serialized === undefined ? [] : [serialized]);
  req.method = method; req.url = options.url || (method === "GET" ? "/api/google-calendar-auth?action=config" : "/api/google-calendar-auth");
  req.headers = { host: new URL(options.origin || ORIGIN).host, origin: options.origin || ORIGIN,
    "x-workboard-calendar": "1", "content-type": "application/json", ...(options.cookie ? { cookie: options.cookie } : {}), ...options.headers };
  if (Object.hasOwn(options, "parsedBody")) req.body = options.parsedBody;
  const response = { headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    writeHead(status, headers) { this.status = status; Object.entries(headers).forEach(([key, value]) => this.setHeader(key, value)); },
    end(raw) { this.raw = raw; this.data = JSON.parse(raw); } };
  await handler(req, response);
  response.cookie = response.headers["set-cookie"]?.split(";")[0];
  return response;
}
async function connect(f, options = {}) {
  const response = await request(f.handler, { action: "exchange", code: "fake-code", calendarId: CALENDAR }, options);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return response.cookie;
}
const restore = (handler, cookie, options = {}) => request(handler, { action: "restore", calendarId: CALENDAR }, { cookie, ...options });
const proxy = (handler, cookie, body = {}, options = {}) => request(handler, { action: "proxy", url: META, method: "GET", ...body }, { cookie, ...options });

test("public config reveals no credential and an incomplete setup stays explicit", async () => {
  const f = fixture();
  const response = await request(f.handler, undefined, { method: "GET" });
  assert.deepEqual(response.data, { configured: true, clientId: CLIENT, calendarId: CALENDAR });
  assert.equal(response.headers["cache-control"], "no-store, max-age=0");
  assert.doesNotMatch(response.raw, /fake-server-secret|refresh|session.key/);
  for (const patch of [{ GOOGLE_CALENDAR_CLIENT_SECRET: "" }, { GOOGLE_CALENDAR_SESSION_KEY: "short" },
    { GOOGLE_CALENDAR_SESSION_KEY: Buffer.alloc(32, 7).toString("base64") },
    { GOOGLE_CALENDAR_ORIGINS: "https://workboard.example/" }, { GOOGLE_CALENDAR_ORIGINS: "http://unsafe.example" }]) {
    const missing = fixture({ env: patch });
    assert.equal((await request(missing.handler, undefined, { method: "GET" })).data.configured, false);
    assert.equal((await restore(missing.handler, "")).data.error.code, "setup_required");
    assert.equal(missing.calls.length, 0);
  }
});

test("code exchange binds a sealed HttpOnly session to an owned calendar and exact popup origin", async () => {
  const f = fixture();
  const response = await request(f.handler, { action: "exchange", code: "fake-code", calendarId: CALENDAR });
  assert.equal(response.status, 200);
  assert.deepEqual(response.data, { connected: true, clientId: CLIENT, calendarId: CALENDAR, persistent: true });
  assert.match(response.headers["set-cookie"], /^__Host-wb_calendar_session=v1\./);
  assert.match(response.headers["set-cookie"], /; Path=\/; HttpOnly; SameSite=Lax; Max-Age=15552000;/);
  assert.match(response.headers["set-cookie"], /; Secure$/);
  assert.doesNotMatch(JSON.stringify(response), /fake-short-token|fake-server-only-refresh|fake-server-secret/);
  assert.equal(f.calls.length, 2);
  const fields = new URLSearchParams(f.calls[0].init.body);
  assert.equal(fields.get("redirect_uri"), ORIGIN);
  assert.equal(fields.get("grant_type"), "authorization_code");
  assert.equal(fields.get("client_secret"), "fake-server-secret");
  assert.equal(f.calls[1].url, META);
  assert.equal(f.calls[1].init.headers.Authorization, "Bearer fake-short-token");
  for (const call of f.calls) {
    assert.equal(call.init.redirect, "error"); assert.equal(call.init.credentials, "omit"); assert.equal(call.init.cache, "no-store");
  }
});

test("browser reopen and server restart restore with refresh credential, without exposing or rewriting it", async () => {
  const f = fixture(), cookie = await connect(f);
  const restarted = createCalendarSessionHandler({ env: f.config, fetch: f.fetch, now: f.now });
  const response = await restore(restarted, cookie);
  assert.equal(response.status, 200); assert.equal(response.data.persistent, true);
  assert.equal(response.headers["set-cookie"], undefined);
  assert.equal(f.calls.length, 3);
  const fields = new URLSearchParams(f.calls[2].init.body);
  assert.equal(fields.get("grant_type"), "refresh_token");
  assert.equal(fields.get("refresh_token"), "fake-server-only-refresh");
  assert.equal(fields.has("code"), false);
  await restore(restarted, cookie);
  assert.equal(f.calls.length, 3, "usable access token is cached without a second refresh");
  f.advance(3600000); await restore(restarted, cookie);
  assert.equal(f.calls.length, 4);
});

test("local development uses a host-only HttpOnly cookie without weakening HTTPS cookies", async () => {
  const f = fixture(), response = await request(f.handler, { action: "exchange", code: "fake-code", calendarId: CALENDAR }, { origin: "http://localhost:3000" });
  assert.equal(response.status, 200);
  assert.match(response.headers["set-cookie"], /^wb_calendar_session=v1\./);
  assert.doesNotMatch(response.headers["set-cookie"], /Domain=|; Secure/);
  assert.equal(new URLSearchParams(f.calls[0].init.body).get("redirect_uri"), "http://localhost:3000");
});

test("CSRF checks reject missing or foreign origins, mismatched hosts and non-JSON requests before Google", async () => {
  const f = fixture();
  for (const headers of [{ origin: undefined }, { origin: "https://evil.example" }, { host: "evil.example" },
    { "x-workboard-calendar": undefined }, { "x-workboard-calendar": "true" }, { "sec-fetch-site": "cross-site" }]) {
    assert.equal((await restore(f.handler, "", { headers })).status, 403);
  }
  assert.equal((await restore(f.handler, "", { headers: { "content-type": "text/plain" } })).status, 415);
  assert.equal((await request(f.handler, {}, { method: "OPTIONS" })).status, 405);
  assert.equal((await request(f.handler, {}, { method: "DELETE" })).status, 405);
  assert.equal(f.calls.length, 0);
});

test("malformed, oversized and unexpected payloads cannot trigger an exchange", async () => {
  const f = fixture();
  for (const raw of ["{broken", "null", "[]"]) assert.equal((await request(f.handler, null, { raw })).status, 400);
  assert.equal((await request(f.handler, { action: "exchange", code: "x".repeat(20000), calendarId: CALENDAR })).status, 413);
  assert.equal((await request(f.handler, { action: "exchange", code: "code", calendarId: CALENDAR, clientSecret: "injected" })).status, 400);
  assert.equal((await request(f.handler, { action: "exchange", code: "code", calendarId: "other@gmail.com" })).status, 400);
  assert.equal((await request(f.handler, null, { parsedBody: { action: "unknown" } })).status, 400);
  assert.equal(f.calls.length, 0);
});

test("scope, refresh credential and calendar ownership are verified before persisting a grant", async () => {
  for (const scope of [undefined, "", "https://www.googleapis.com/auth/calendar", `${SCOPE} https://www.googleapis.com/auth/drive.file`]) {
    const f = fixture({ fetch: async () => Response.json(tokenData({ scope })) });
    const result = await request(f.handler, { action: "exchange", code: "code", calendarId: CALENDAR });
    assert.equal(result.status, 403); assert.equal(result.data.error.code, "scope_not_granted");
    assert.equal(result.cookie, undefined); assert.equal(f.calls.length, 1);
  }
  const noRefresh = fixture({ fetch: async () => Response.json(tokenData({ refresh_token: undefined })) });
  const result = await request(noRefresh.handler, { action: "exchange", code: "code", calendarId: CALENDAR }, { cookie: "unrelated-old-cookie" });
  assert.equal(result.status, 409); assert.equal(result.data.error.code, "offline_access_required"); assert.equal(result.cookie, undefined);
  for (const accessRole of ["reader", "writer", undefined]) {
    const f = fixture({ fetch: async (url) => Response.json(url === TOKEN_URL ? tokenData() : { accessRole }) });
    const result = await request(f.handler, { action: "exchange", code: "code", calendarId: CALENDAR });
    assert.equal(result.status, 403); assert.equal(result.data.error.code, "calendar_not_owned"); assert.equal(result.cookie, undefined);
  }
});

test("cookies cannot be moved to another origin, calendar, client or encryption key, tampered or kept past expiry", async () => {
  const f = fixture(), cookie = await connect(f);
  for (const patch of [{ GOOGLE_CALENDAR_CLIENT_ID: "987-other.apps.googleusercontent.com" },
    { GOOGLE_CALENDAR_ID: "another@group.calendar.google.com" },
    { GOOGLE_CALENDAR_SESSION_KEY: Buffer.alloc(32, 9).toString("base64url") }]) {
    const other = fixture({ env: patch });
    const result = await request(other.handler, { action: "restore", calendarId: other.config.GOOGLE_CALENDAR_ID }, { cookie });
    assert.equal(result.status, 401); assert.equal(other.calls.length, 0);
  }
  const renamed = cookie.replace("__Host-wb_calendar_session", "wb_calendar_session");
  assert.equal((await restore(f.handler, renamed, { origin: "http://localhost:3000" })).status, 401);
  const [name, value] = cookie.split("=");
  const corrupted = `${name}=${value.slice(0, 25)}${value[25] === "a" ? "b" : "a"}${value.slice(26)}`;
  assert.equal((await restore(f.handler, corrupted)).status, 401);
  assert.equal((await restore(f.handler, `${cookie}; ${cookie}`)).status, 401);
  f.advance(SESSION_MS);
  const expired = await restore(f.handler, cookie);
  assert.equal(expired.status, 401); assert.equal(expired.headers["set-cookie"], undefined);
});

test("proxy only permits metadata, deterministic event lookup and private-field-limited inserts", async () => {
  const f = fixture(), cookie = await connect(f);
  const result = await proxy(f.handler, cookie, { method: "POST", url: `${EVENTS}?sendUpdates=none`, body: event() });
  assert.equal(result.status, 200);
  const write = f.calls.at(-1);
  assert.deepEqual(JSON.parse(write.init.body), event());
  assert.equal(write.init.headers.Authorization, "Bearer fake-short-token");
  assert.deepEqual(Object.keys(write.init.headers).sort(), ["Authorization", "Content-Type"]);
  const allDay = { ...event(), start: { date: "2026-09-22" }, end: { date: "2026-09-23" } };
  assert.equal((await proxy(f.handler, cookie, { method: "POST", url: `${EVENTS}?sendUpdates=none`, body: allDay })).status, 200);
  assert.equal((await proxy(f.handler, cookie, { url: `${EVENTS}/${eventId()}` })).status, 200);
  const before = f.calls.length;
  for (const body of [{ url: "https://evil.example/calendar" }, { url: EVENTS.replace(CALENDAR, "other@gmail.com") + "?maxResults=1" },
    { url: EVENTS }, { url: `${EVENTS}?maxResults=100&fields=items` }, { url: `${META}&extra=1` },
    { url: `${EVENTS}/not-a-workboard-id` }, { url: `${EVENTS}/${eventId()}?fields=attendees` },
    { url: META, method: "DELETE" }, { url: META, body: {} }, { url: META, headers: { Authorization: "injected" } },
    { url: `${EVENTS}?sendUpdates=all`, method: "POST", body: event() }]) {
    assert.equal((await proxy(f.handler, cookie, body)).status, 400, JSON.stringify(body));
  }
  assert.equal(f.calls.length, before);
});

test("server reconstructs scheduling data and rejects names, notes, attendees, invalid dates and substituted IDs", async () => {
  const f = fixture(), cookie = await connect(f), before = f.calls.length;
  const badEvents = [
    { ...event(), description: "private counseling notes" }, { ...event(), summary: "홍길동 상담" },
    { ...event(), attendees: [{ email: "client@example.com" }] }, { ...event(), location: "client home address" },
    { ...event(), id: eventId("different-reservation") },
    { ...event(), extendedProperties: { private: { workboardReservationId: "reservation-1", clientId: "private-client" } } },
    { ...event(), start: { ...event().start, dateTime: "2026-02-30T10:35:00+09:00" } },
    { ...event(), end: { ...event().end, dateTime: "2026-09-22T09:35:00+09:00" } },
    { ...event(), end: { ...event().end, dateTime: "2026-09-23T11:35:00+09:00" } },
    { ...event(), start: { date: "2026-09-22" }, end: { date: "2026-09-24" } },
    { ...event(), start: { ...event().start, timeZone: "UTC" } },
  ];
  for (const body of badEvents) {
    const result = await proxy(f.handler, cookie, { method: "POST", url: `${EVENTS}?sendUpdates=none`, body });
    assert.equal(result.status, 400); assert.equal(result.data.error.code, "invalid_event");
    assert.doesNotMatch(result.raw, /private counseling|client@example|홍길동|private-client/);
  }
  assert.equal(f.calls.length, before);
});

test("409 keeps its status so the client recovers the original deterministic event", async () => {
  const f = fixture({ fetch: async (url, init) => {
    if (url === TOKEN_URL) return Response.json(tokenData());
    if (init.method === "POST") return Response.json({ error: { message: "ignored", code: 409 } }, { status: 409 });
    if (url === `${EVENTS}/${eventId()}`) return Response.json({ ...event(), iCalUID: "same-event@google.com" });
    return Response.json({ accessRole: "owner" });
  } });
  const cookie = await connect(f);
  const conflict = await proxy(f.handler, cookie, { method: "POST", url: `${EVENTS}?sendUpdates=none`, body: event() });
  assert.equal(conflict.status, 409); assert.equal(conflict.data.error.code, "event_conflict");
  const recovered = await proxy(f.handler, cookie, { url: `${EVENTS}/${eventId()}` });
  assert.equal(recovered.data.iCalUID, "same-event@google.com");
});

test("a Calendar401 refreshes once and retries once; a repeated401 rejects the unusable grant", async () => {
  let tokenCalls = 0, calendarCalls = 0;
  const f = fixture({ fetch: async (url) => {
    if (url === TOKEN_URL) return Response.json(tokenData({ access_token: `fake-token-${++tokenCalls}` }));
    calendarCalls++;
    if (calendarCalls === 2 || calendarCalls >= 4) return Response.json({ error: {} }, { status: 401 });
    return Response.json({ accessRole: "owner" });
  } });
  const cookie = await connect(f);
  assert.equal((await proxy(f.handler, cookie)).status, 200);
  assert.equal(tokenCalls, 2); assert.equal(calendarCalls, 3);
  assert.equal(f.calls[2].init.headers.Authorization, "Bearer fake-token-1");
  assert.equal(f.calls[4].init.headers.Authorization, "Bearer fake-token-2");
  const failed = await proxy(f.handler, cookie);
  assert.equal(failed.status, 401); assert.equal(failed.headers["set-cookie"], undefined);
  assert.equal(tokenCalls, 3); assert.equal(calendarCalls, 5);
});

test("invalid_grant rejects the session while temporary token failures remain retryable", async () => {
  const first = fixture(), cookie = await connect(first);
  for (const [status, data, invalidGrant] of [[400, { error: "invalid_grant", error_description: "sensitive response" }, true],
    [503, { error: "temporarily_unavailable", error_description: "secret" }, false],
    [400, { error: "invalid_client" }, false]]) {
    const f = fixture({ fetch: async () => Response.json(data, { status }) });
    const response = await restore(f.handler, cookie);
    assert.equal(response.status, invalidGrant ? 401 : 503);
    assert.equal(response.cookie, undefined);
    assert.doesNotMatch(response.raw, /sensitive response|secret|fake-server-only-refresh/);
    assert.equal(response.data.error.retryable, status === 503);
  }
});

test("refresh scope cannot expand silently, while omitted unchanged scope is accepted", async () => {
  const first = fixture(), cookie = await connect(first);
  const bad = fixture({ fetch: async () => Response.json(tokenData({ scope: `${SCOPE} https://www.googleapis.com/auth/drive.file` })) });
  const rejected = await restore(bad.handler, cookie);
  assert.equal(rejected.status, 403); assert.equal(rejected.data.error.code, "scope_not_granted");
  const good = fixture({ fetch: async () => Response.json(tokenData({ scope: undefined, refresh_token: undefined })) });
  assert.equal((await restore(good.handler, cookie)).status, 200);
});

test("concurrent restores share a refresh and a late refresh never reissues a disconnected cookie", async () => {
  const first = fixture(), cookie = await connect(first);
  let complete;
  const f = fixture({ fetch: async () => new Promise((resolve) => { complete = resolve; }) });
  const a = restore(f.handler, cookie), b = restore(f.handler, cookie);
  while (!complete) await new Promise((resolve) => setImmediate(resolve));
  const disconnect = await request(f.handler, { action: "disconnect" }, { cookie });
  assert.equal(disconnect.status, 200); assert.match(disconnect.headers["set-cookie"], /Max-Age=0/);
  complete(Response.json(tokenData()));
  const results = await Promise.all([a, b]);
  assert.equal(f.calls.length, 1);
  for (const response of results) { assert.equal(response.status, 200); assert.equal(response.headers["set-cookie"], undefined); }
  assert.equal((await restore(f.handler, "")).status, 401);
});

test("a stale refresh failure cannot erase a newer successful exchange cookie", async () => {
  const first = fixture(), oldCookie = await connect(first);
  let failOldRefresh;
  const f = fixture({ fetch: async (url, init) => {
    if (url !== TOKEN_URL) return Response.json({ accessRole: "owner" });
    if (new URLSearchParams(init.body).get("grant_type") === "refresh_token") {
      return new Promise((resolve) => { failOldRefresh = resolve; });
    }
    return Response.json(tokenData({ access_token: "new-token", refresh_token: "new-refresh" }));
  } });
  const stale = restore(f.handler, oldCookie);
  while (!failOldRefresh) await new Promise((resolve) => setImmediate(resolve));
  const newCookie = await connect(f);
  assert.notEqual(newCookie, oldCookie);
  failOldRefresh(Response.json({ error: "invalid_grant" }, { status: 400 }));
  const failure = await stale;
  assert.equal(failure.status, 401); assert.equal(failure.headers["set-cookie"], undefined);
  assert.equal((await restore(f.handler, newCookie)).status, 200);
});

test("upstream network timeouts and oversized responses return sanitized retryable failures", async () => {
  const first = fixture(), cookie = await connect(first);
  const f = fixture({ timeoutMs: 5, fetch: async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new Error("fake-server-secret failed")), { once: true });
  }) });
  const result = await restore(f.handler, cookie);
  assert.equal(result.status, 503); assert.equal(result.data.error.retryable, true);
  assert.doesNotMatch(result.raw, /fake-server-secret/); assert.equal(result.cookie, undefined);
  const large = fixture({ fetch: async () => Response.json({ value: "x".repeat(300000) }) });
  assert.equal((await restore(large.handler, cookie)).status, 503);
});
