import test from "node:test";
import assert from "node:assert/strict";
import { createCalendarSession } from "../src/googleCalendarSession.mjs";
import { CALENDAR_SCOPE } from "../src/googleCalendarAuth.mjs";

const CLIENT = "1234567890-persistent-client.apps.googleusercontent.com";
const CALENDAR = "counseling@group.calendar.google.com";
const API = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR)}/events`;
const session = () => ({ connected: true, persistent: true, clientId: CLIENT, calendarId: CALENDAR });
const config = () => ({ configured: true, clientId: CLIENT, calendarId: CALENDAR });
function fixture(extra = {}) {
  const prompts = [], configs = [], requests = [], timers = new Map();
  let timerId = 0, legacyRequests = 0, legacyFetches = 0, active = true;
  const google = { accounts: { oauth2: { initCodeClient: (value) => { configs.push(value); return { requestCode: () => prompts.push(true) }; } } } };
  const legacy = {
    prepareCalendarAccess: async () => {}, subscribeCalendarAuth: () => () => {}, forgetCalendarAccess: () => {},
    getCalendarAuthStatus: () => ({ connected: false, status: "disconnected", clientId: "", error: "" }),
    requestCalendarAccess: async () => { legacyRequests++; return { connected: true, clientId: CLIENT }; },
    calendarFetch: async () => { legacyFetches++; return Response.json({ legacy: true }); },
  };
  const fetchImpl = async (url, options) => {
    const payload = options.body ? JSON.parse(options.body) : {};
    requests.push({ url, options, payload });
    if (extra.route) return extra.route(url, options, payload);
    if (url.includes("?action=config")) return Response.json(config());
    return Response.json(payload.action === "proxy" ? { items: [] } : session());
  };
  const auth = createCalendarSession({ getGoogle: () => google, getUserActivation: () => ({ isActive: active }),
    legacyAuth: legacy, fetchImpl, setTimer: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimer: (id) => timers.delete(id),
    ...extra.dependencies });
  const authorize = async () => { await auth.prepareCalendarAccess(); const promise = auth.requestCalendarAccess(CLIENT, CALENDAR); configs.at(-1).callback({ code: "one-use-code" }); return promise; };
  return { auth, prompts, configs, requests, timers, authorize, legacy, setActive: (value) => { active = value; }, legacyCalls: () => ({ requests: legacyRequests, fetches: legacyFetches }) };
}

test("center calendar uses the shared server cookie before counseling memory restoration", async () => {
  const f = fixture({ route: async (url, _options, payload) => url.includes("?action=config")
    ? Response.json({ ...config(), centerCalendarId: "center@group.calendar.google.com" })
    : Response.json({ calendarId: "center@group.calendar.google.com", items: [], operation: payload.operation }) });
  const result = await f.auth.centerCalendarRequest("list", { from: "2026-01-01", to: "2026-12-31" });
  assert.equal(result.operation, "list");
  assert.equal(f.prompts.length, 0);
  assert.equal(f.requests.at(-1).options.credentials, "include");
  assert.equal(f.requests.at(-1).options.headers["X-Workboard-Calendar"], "1");
  assert.equal(f.auth.getCalendarAuthStatus().serverCenterCalendarId, "center@group.calendar.google.com");
  await assert.rejects(f.auth.centerCalendarRequest("arbitrary"), { code: "invalid_operation" });
  f.auth.forgetCalendarAccess();
});

test("center conflicts remain actionable without invalidating counseling authorization", async () => {
  const f = fixture({ route: async (url, _options, payload) => url.includes("?action=config")
    ? Response.json({ ...config(), centerCalendarId: "center@group.calendar.google.com" })
    : payload.action === "center" ? Response.json({ error: { code: "event_conflict", message: "동시 수정", retryable: false } }, { status: 412 }) : Response.json(session()) });
  await f.auth.restoreCalendarAccess(CALENDAR);
  await assert.rejects(f.auth.centerCalendarRequest("upsert", { eventId: "a", etag: '"old"', event: {} }), { status: 412, code: "event_conflict" });
  assert.equal(f.auth.getCalendarAuthStatus().connected, true);
  assert.equal(f.prompts.length, 0);
  f.auth.forgetCalendarAccess();
});

test("persistent authorization exchanges a one-use code and exposes only session metadata", async () => {
  const f = fixture(); const updates = [];
  f.auth.subscribeCalendarAuth((value) => updates.push(value));
  assert.equal((await f.authorize()).persistent, true);
  assert.equal(f.configs[0].scope, CALENDAR_SCOPE);
  assert.equal(f.configs[0].include_granted_scopes, false);
  assert.equal(f.configs[0].ux_mode, "popup");
  assert.equal(f.configs[0].select_account, true);
  const exchange = f.requests.find((item) => item.payload.action === "exchange");
  assert.deepEqual(exchange.payload, { action: "exchange", code: "one-use-code", calendarId: CALENDAR });
  assert.equal(exchange.url, "/api/google-calendar-auth");
  assert.equal(exchange.options.credentials, "include");
  assert.equal(exchange.options.mode, "same-origin");
  assert.equal(exchange.options.cache, "no-store");
  assert.equal(exchange.options.redirect, "error");
  assert.equal(exchange.options.headers["X-Workboard-Calendar"], "1");
  assert.doesNotMatch(JSON.stringify(updates), /one-use-code|access_token|refresh_token/);
  assert.deepEqual(f.legacyCalls(), { requests: 0, fetches: 0 });
  f.auth.forgetCalendarAccess();
});

test("a fresh page factory restores the same server session without a Google popup", async () => {
  let hasCookie = false;
  const route = async (url, _options, payload) => {
    if (url.includes("?action=config")) return Response.json(config());
    if (payload.action === "exchange") hasCookie = true;
    return hasCookie ? Response.json(session()) : Response.json({ error: { code: "reauth_required", message: "연결이 필요합니다." } }, { status: 401 });
  };
  const first = fixture({ route }); await first.authorize(); first.auth.forgetCalendarAccess();
  const reopened = fixture({ route });
  assert.equal((await reopened.auth.restoreCalendarAccess(CALENDAR)).connected, true);
  assert.equal(reopened.prompts.length, 0);
  assert.equal(reopened.requests.filter((item) => item.payload.action === "restore").length, 1);
  reopened.auth.forgetCalendarAccess();
});

test("refreshing server access never falls back to a token popup and proxy sends no bearer credential", async () => {
  const f = fixture(); await f.auth.restoreCalendarAccess(CALENDAR);
  const response = await f.auth.calendarFetch(API, { method: "POST", body: JSON.stringify({ id: "b0123" }), headers: { Authorization: "must-never-forward" }, credentials: "omit" });
  assert.deepEqual(await response.json(), { items: [] });
  const sent = f.requests.at(-1);
  assert.deepEqual(sent.payload, { action: "proxy", url: API, method: "POST", body: { id: "b0123" } });
  assert.equal(sent.options.headers.Authorization, undefined);
  assert.equal(sent.options.credentials, "include");
  assert.equal(f.prompts.length, 0);
  for (const input of ["https://evil.test/calendar/v3/a", "https://www.googleapis.com/drive/v3/a", `${API}#x`]) await assert.rejects(f.auth.calendarFetch(input), { code: "invalid_api_url" });
  await assert.rejects(f.auth.calendarFetch(API, { method: "DELETE" }), { code: "invalid_api_method" });
  f.auth.forgetCalendarAccess();
});

test("an expired/revoked server grant becomes reconnect-needed without an automatic popup", async () => {
  const f = fixture({ route: async (url, _options, payload) => url.includes("?action=config") ? Response.json(config()) : payload.action === "proxy"
    ? Response.json({ error: { code: "reauth_required", message: "Google 권한을 다시 연결해 주세요." } }, { status: 401 }) : Response.json(session()) });
  await f.auth.restoreCalendarAccess(CALENDAR);
  await assert.rejects(f.auth.calendarFetch(API), { status: 401, code: "reauth_required" });
  assert.equal(f.auth.getCalendarAuthStatus().needsReconnect, true);
  assert.equal(f.auth.getCalendarAuthStatus().connected, false);
  assert.equal(f.prompts.length, 0);
});

test("a temporary server/network failure remains recoverable and a later restore succeeds", async () => {
  let offline = true;
  const f = fixture({ route: async (url) => {
    if (url.includes("?action=config")) return Response.json(config());
    if (offline) throw new TypeError("Failed to fetch");
    return Response.json(session());
  } });
  await assert.rejects(f.auth.restoreCalendarAccess(CALENDAR), { code: "network_error", retryable: true });
  assert.equal(f.auth.getCalendarAuthStatus().status, "recovering");
  assert.equal(f.auth.getCalendarAuthStatus().needsReconnect, false);
  offline = false;
  assert.equal((await f.auth.restoreCalendarAccess(CALENDAR)).connected, true);
  assert.equal(f.prompts.length, 0);
  f.auth.forgetCalendarAccess();
});

test("missing server configuration keeps explicit legacy access, while malformed/errors never silently downgrade", async () => {
  const f = fixture({ route: async () => Response.json({ configured: false }) });
  const restored = await f.auth.restoreCalendarAccess(CALENDAR);
  assert.equal(restored.configured, false); assert.equal(restored.persistent, false);
  await f.auth.requestCalendarAccess(CLIENT, CALENDAR);
  assert.deepEqual(f.legacyCalls(), { requests: 1, fetches: 0 });
  for (const response of [Response.json({ configured: true }), Response.json({ error: {} }, { status: 503 }), new Response("<html>not an API</html>")]) {
    const broken = fixture({ route: async () => response });
    await assert.rejects(broken.auth.restoreCalendarAccess(CALENDAR));
    assert.equal(broken.auth.getCalendarAuthStatus().configured, null);
    assert.deepEqual(broken.legacyCalls(), { requests: 0, fetches: 0 });
  }
});

test("locking aborts restoration and prevents stale completion or deferred body consumption", async () => {
  let finish, capturedSignal;
  let markBodyStarted;
  const bodyStarted = new Promise((resolve) => { markBodyStarted = resolve; });
  const f = fixture({ route: async (url, options) => {
    if (url.includes("?action=config")) return Response.json(config());
    capturedSignal = options.signal;
    return { ok: true, status: 200, headers: new Headers(), arrayBuffer: () => new Promise((resolve) => { finish = resolve; markBodyStarted(); }) };
  } });
  await f.auth.prepareCalendarAccess();
  const restoring = f.auth.restoreCalendarAccess(CALENDAR);
  await bodyStarted;
  const rejection = assert.rejects(restoring, { code: "cancelled" });
  f.auth.forgetCalendarAccess();
  assert.equal(capturedSignal.aborted, true);
  finish(new TextEncoder().encode(JSON.stringify(session())).buffer);
  await rejection;
  assert.equal(f.auth.getCalendarAuthStatus().connected, false);
  assert.equal(f.requests.some((item) => item.payload.action === "disconnect"), false);
  const loaded = fixture(); await loaded.auth.restoreCalendarAccess(CALENDAR);
  const response = await loaded.auth.calendarFetch(API), clone = response.clone();
  loaded.auth.forgetCalendarAccess();
  await assert.rejects(response.json(), { code: "cancelled" });
  await assert.rejects(clone.json(), { code: "cancelled" });
});

test("forgetting cancels pending approval and ignores its late callback; disconnect alone clears the server session", async () => {
  const f = fixture(); await f.auth.prepareCalendarAccess();
  const pending = f.auth.requestCalendarAccess(CLIENT, CALENDAR);
  const rejection = assert.rejects(pending, { code: "cancelled" });
  f.auth.forgetCalendarAccess(); await rejection;
  await f.configs[0].callback({ code: "late-code" });
  assert.equal(f.requests.some((item) => item.payload.action === "exchange"), false);
  await f.auth.disconnectCalendarAccess();
  assert.equal(f.requests.filter((item) => item.payload.action === "disconnect").length, 1);
});

test("configuration/session identity mismatches and non-user gestures cannot authorize", async () => {
  const f = fixture(); await f.auth.prepareCalendarAccess();
  await assert.rejects(f.auth.requestCalendarAccess(CLIENT, "other@group.calendar.google.com"), { code: "configuration_mismatch" });
  f.setActive(false);
  await assert.rejects(f.auth.requestCalendarAccess(CLIENT, CALENDAR), { code: "user_gesture_required" });
  assert.equal(f.prompts.length, 0);
  const mismatch = fixture({ route: async (url) => Response.json(url.includes("?action=config") ? config() : { ...session(), calendarId: "other@group.calendar.google.com" }) });
  await assert.rejects(mismatch.auth.restoreCalendarAccess(CALENDAR), { code: "invalid_session" });
  assert.equal(mismatch.auth.getCalendarAuthStatus().connected, false);
});

test("overlapping restores are deduplicated and rate-limit errors retain status for bounded queue retry", async () => {
  const f = fixture({ route: async (url, _options, payload) => url.includes("?action=config") ? Response.json(config()) : payload.action === "proxy"
    ? Response.json({ error: { code: "http_429", message: "잠시 후 다시 시도합니다.", retryable: true } }, { status: 429 }) : Response.json(session()) });
  const a = f.auth.restoreCalendarAccess(CALENDAR), b = f.auth.restoreCalendarAccess(CALENDAR);
  assert.equal(a, b); await a;
  assert.equal(f.requests.filter((item) => item.payload.action === "restore").length, 1);
  await assert.rejects(f.auth.calendarFetch(API), { status: 429, retryable: true });
  assert.equal(f.auth.getCalendarAuthStatus().retryable, true);
  assert.equal(f.prompts.length, 0);
});

test("a permanent server setup failure is not misclassified as a temporary network failure", async () => {
  const f = fixture({ route: async (url) => url.includes("?action=config") ? Response.json(config())
    : Response.json({ error: { code: "setup_required", message: "서버 연결 설정을 확인해 주세요.", retryable: false } }, { status: 503 }) });
  await assert.rejects(f.auth.restoreCalendarAccess(CALENDAR), { code: "setup_required", retryable: false });
  assert.equal(f.auth.getCalendarAuthStatus().status, "error");
  assert.equal(f.auth.getCalendarAuthStatus().retryable, false);
  assert.equal(f.prompts.length, 0);
});
