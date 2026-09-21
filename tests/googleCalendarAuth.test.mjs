import test from "node:test";
import assert from "node:assert/strict";
import { CALENDAR_SCOPE, CalendarAuthError, createCalendarAuth, validCalendarClientId } from "../src/googleCalendarAuth.mjs";

const CLIENT = "1234567890-test-client.apps.googleusercontent.com";
const CLIENT_B = "9876543210-second-client.apps.googleusercontent.com";
const API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const tokenResponse = (patch = {}) => ({ access_token: "fake-memory-token", expires_in: 3600, scope: CALENDAR_SCOPE, token_type: "Bearer", ...patch });
function fixture(extra = {}) {
  let clock = 1000, timerId = 0;
  const timers = new Map(), configs = [], prompts = [];
  const google = { accounts: { oauth2: {
    initTokenClient: (config) => { configs.push(config); return { requestAccessToken: (options) => prompts.push(options) }; },
    hasGrantedAllScopes: (response, scope) => String(response.scope || "").split(" ").includes(scope),
  } } };
  const auth = createCalendarAuth({ getGoogle: () => google, getUserActivation: () => ({ isActive: true }),
    now: () => clock, setTimer: (callback, ms) => { const id = ++timerId; timers.set(id, { callback, when: clock + ms }); return id; }, clearTimer: (id) => timers.delete(id),
    ...extra });
  const advance = (ms) => {
    const end = clock + ms;
    while (true) {
      const due = [...timers].filter(([, timer]) => timer.when <= end).sort((a, b) => a[1].when - b[1].when)[0];
      if (!due) break;
      clock = due[1].when; timers.delete(due[0]); due[1].callback();
    }
    clock = end;
  };
  const authorize = async (patch = {}, id = CLIENT) => { const promise = auth.requestCalendarAccess(id); configs.at(-1).callback(tokenResponse(patch)); return promise; };
  return { auth, configs, prompts, google, authorize, advance, timers };
}

test("authorization requests the owned-events scope only and tokens never appear in status", async () => {
  const f = fixture();
  const updates = [];
  const unsubscribe = f.auth.subscribeCalendarAuth((state) => updates.push(state));
  const pending = f.auth.requestCalendarAccess(CLIENT);
  assert.equal(f.prompts.length, 1);
  assert.equal(f.configs[0].scope, CALENDAR_SCOPE);
  assert.equal(f.configs[0].include_granted_scopes, false);
  assert.equal(f.prompts[0].include_granted_scopes, false);
  assert.equal(f.prompts[0].prompt, "select_account");
  assert.equal(f.auth.getCalendarAuthStatus().connecting, true);
  f.configs[0].callback(tokenResponse());
  const status = await pending;
  assert.equal(status.connected, true);
  assert.equal(status.expiresAt, 3601000);
  assert.equal(f.auth.calendarToken(), "fake-memory-token");
  assert.doesNotMatch(JSON.stringify(updates), /fake-memory-token|access_token/);
  unsubscribe(); f.auth.forgetCalendarAccess();
});

test("client IDs are validated and a background caller cannot open a popup", async () => {
  assert.equal(validCalendarClientId(CLIENT), true);
  for (const value of ["", "https://example.test", "secret", "x.apps.googleusercontent.com", `${CLIENT}/x`]) assert.equal(validCalendarClientId(value), false);
  const f = fixture({ getUserActivation: () => ({ isActive: false }) });
  await assert.rejects(f.auth.requestCalendarAccess(CLIENT), { code: "user_gesture_required" });
  await assert.rejects(f.auth.requestCalendarAccess("invalid"), { code: "invalid_client_id" });
  assert.equal(f.prompts.length, 0);
});

test("expiry removes the memory token and API calls never silently reopen authorization", async () => {
  let calls = 0;
  const f = fixture({ fetchImpl: async () => { calls++; return Response.json({}); } });
  await f.authorize({ expires_in: 10 });
  f.advance(9000);
  assert.equal(f.auth.calendarToken(), "");
  assert.equal(f.auth.getCalendarAuthStatus().status, "expired");
  await assert.rejects(f.auth.calendarFetch(API), { code: "authorization_required" });
  assert.equal(calls, 0);
  assert.equal(f.prompts.length, 1);
});

test("missing scope, malformed token response, denial and popup errors are rejected cleanly", async () => {
  for (const patch of [{ scope: "https://www.googleapis.com/auth/drive.file" }, { access_token: "" }, { access_token: "with space" }, { expires_in: 0 }, { expires_in: Infinity }, { token_type: 123 }]) {
    const f = fixture();
    const pending = f.auth.requestCalendarAccess(CLIENT);
    f.configs[0].callback(tokenResponse(patch));
    await assert.rejects(pending, CalendarAuthError);
    assert.equal(f.auth.calendarToken(), "");
    assert.equal(f.auth.getCalendarAuthStatus().connecting, false);
  }
  for (const code of ["access_denied", "popup_closed", "popup_failed_to_open", "origin_mismatch", "invalid_client"]) {
    const f = fixture();
    const pending = f.auth.requestCalendarAccess(CLIENT);
    if (code.startsWith("popup")) f.configs[0].error_callback({ type: code });
    else f.configs[0].callback({ error: code, error_description: "arbitrary sensitive response" });
    await assert.rejects(pending, (error) => error.code === code && !error.message.includes("arbitrary sensitive"));
    assert.equal(f.auth.calendarToken(), "");
  }
});

test("scope helpers must agree and overlapping clicks share one authorization request", async () => {
  const f = fixture();
  f.google.accounts.oauth2.hasGrantedAllScopes = () => false;
  const a = f.auth.requestCalendarAccess(CLIENT), b = f.auth.requestCalendarAccess(CLIENT);
  assert.equal(a, b);
  assert.equal(f.prompts.length, 1);
  f.configs[0].callback(tokenResponse());
  await assert.rejects(a, { code: "scope_not_granted" });
});

test("timeout and forgetting invalidate late callbacks without affecting a later request", async () => {
  const f = fixture({ requestTimeoutMs: 100 });
  const first = f.auth.requestCalendarAccess(CLIENT);
  const firstRejected = assert.rejects(first, { code: "authorization_timeout" });
  f.advance(100); await firstRejected;
  const second = f.auth.requestCalendarAccess(CLIENT);
  f.configs[0].callback(tokenResponse({ access_token: "late-first" }));
  assert.equal(f.auth.calendarToken(), "");
  f.configs[1].callback(tokenResponse({ access_token: "current-second" }));
  await second;
  const third = f.auth.requestCalendarAccess(CLIENT_B);
  const thirdRejected = assert.rejects(third, { code: "cancelled" });
  f.auth.forgetCalendarAccess(); await thirdRejected;
  f.configs[2].callback(tokenResponse({ access_token: "late-third" }));
  assert.equal(f.auth.calendarToken(), "");
  assert.equal(f.auth.getCalendarAuthStatus().status, "disconnected");
});

test("authorized fetch sends the token only to exact Calendar v3 endpoints and forces safe transport", async () => {
  let captured;
  const f = fixture({ fetchImpl: async (url, options) => { captured = { url, options }; return Response.json({ items: [] }); } });
  await f.authorize();
  for (const url of ["https://evil.test/calendar/v3/events", "http://www.googleapis.com/calendar/v3/events", "https://www.googleapis.com.evil.test/calendar/v3/events", "https://www.googleapis.com/drive/v3/files", "https://user@www.googleapis.com/calendar/v3/events", `${API}#fragment`, "https://www.googleapis.com/calendar/v3/../../drive/v3/files"]) {
    await assert.rejects(f.auth.calendarFetch(url), { code: "invalid_api_url" });
  }
  assert.equal(captured, undefined);
  const response = await f.auth.calendarFetch(API, { headers: { Authorization: "caller-token", "If-Match": "etag" }, redirect: "follow", credentials: "include" });
  assert.deepEqual(await response.json(), { items: [] });
  assert.equal(captured.options.headers.get("Authorization"), "Bearer fake-memory-token");
  assert.equal(captured.options.headers.get("If-Match"), "etag");
  assert.equal(captured.options.redirect, "error");
  assert.equal(captured.options.credentials, "omit");
  assert.equal(captured.options.cache, "no-store");
  f.auth.forgetCalendarAccess();
});

test("HTTP errors distinguish permission, quota, stale content and API configuration", async () => {
  let status = 403, reason = "forbidden";
  const f = fixture({ fetchImpl: async () => Response.json({ error: { errors: [{ reason }] } }, { status }) });
  await f.authorize();
  await assert.rejects(f.auth.calendarFetch(API), (error) => error.status === 403 && !error.retryable && /소유/.test(error.message));
  reason = "userRateLimitExceeded";
  await assert.rejects(f.auth.calendarFetch(API), (error) => error.status === 403 && error.retryable && /요청이 많/.test(error.message));
  reason = "accessNotConfigured";
  await assert.rejects(f.auth.calendarFetch(API), (error) => /API 사용 설정/.test(error.message));
  status = 412; reason = "conditionNotMet";
  await assert.rejects(f.auth.calendarFetch(API), (error) => error.status === 412 && /먼저 변경/.test(error.message));
  assert.equal(f.auth.getCalendarAuthStatus().connected, true);
  f.auth.forgetCalendarAccess();
});

test("401 clears current credentials, but a stale 401 cannot clear a newly connected account", async () => {
  let resolveResponse;
  const f = fixture({ fetchImpl: () => new Promise((resolve) => { resolveResponse = resolve; }) });
  await f.authorize();
  const first = f.auth.calendarFetch(API);
  resolveResponse(Response.json({ error: {} }, { status: 401 }));
  await assert.rejects(first, { status: 401 });
  assert.equal(f.auth.getCalendarAuthStatus().status, "expired");
  await f.authorize({ access_token: "old" });
  const stale = f.auth.calendarFetch(API);
  const staleRejected = assert.rejects(stale, { code: "cancelled" });
  await f.authorize({ access_token: "new" }, CLIENT_B);
  resolveResponse(Response.json({ error: {} }, { status: 401 }));
  await staleRejected;
  assert.equal(f.auth.calendarToken(), "new");
  f.auth.forgetCalendarAccess();
});

test("forgetting aborts active requests and rejects bodies that finish after locking", async () => {
  let finishBody, capturedSignal;
  const f = fixture({ fetchImpl: async (_url, { signal }) => {
    capturedSignal = signal;
    return { ok: true, status: 200, statusText: "OK", headers: new Headers(), arrayBuffer: () => new Promise((resolve) => { finishBody = resolve; }) };
  } });
  await f.authorize();
  const request = f.auth.calendarFetch(API);
  await Promise.resolve();
  const rejected = assert.rejects(request, { code: "cancelled" });
  f.auth.forgetCalendarAccess();
  assert.equal(capturedSignal.aborted, true);
  finishBody(new TextEncoder().encode('{"items":[]}').buffer);
  await rejected;
});

test("responses already downloaded still reject delayed JSON consumption after forgetting", async () => {
  const f = fixture({ fetchImpl: async () => Response.json({ items: ["old-account"] }) });
  await f.authorize();
  const response = await f.auth.calendarFetch(API);
  const clone = response.clone();
  f.auth.forgetCalendarAccess();
  await assert.rejects(response.json(), { code: "cancelled" });
  await assert.rejects(clone.text(), { code: "cancelled" });
});

test("request timeout cancels fetch without retrying or opening a popup", async () => {
  let calls = 0;
  const f = fixture({ apiTimeoutMs: 100, fetchImpl: (_url, { signal }) => { calls++; return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))); } });
  await f.authorize();
  const request = f.auth.calendarFetch(API);
  const rejected = assert.rejects(request, { code: "request_timeout" });
  f.advance(100); await rejected;
  assert.equal(calls, 1);
  assert.equal(f.prompts.length, 1);
  f.auth.forgetCalendarAccess();
});

test("GIS preparation never opens a popup and a failed shared script can be retried", async () => {
  let google, script;
  const created = [];
  const makeScript = () => { const events = new Map(); return { addEventListener: (name, callback) => events.set(name, callback), removeEventListener: (name) => events.delete(name), fire: (name) => events.get(name)?.() }; };
  const newScript = () => {
    const node = makeScript();
    node.remove = () => { if (script === node) script = null; };
    created.push(node); return node;
  };
  script = newScript(); // Existing script from the independent Drive integration.
  const doc = { querySelector: () => script, createElement: newScript, head: { appendChild: (node) => { script = node; } } };
  const f = fixture({ getGoogle: () => google, getDocument: () => doc, scriptTimeoutMs: 100 });
  const first = f.auth.prepareCalendarAccess();
  const rejected = assert.rejects(first, { code: "library_load_failed" });
  script.fire("error"); await rejected;
  assert.equal(script, null);
  const prepared = f.auth.prepareCalendarAccess();
  google = f.google; script.fire("load"); await prepared;
  assert.equal(f.prompts.length, 0);
  await f.authorize();
  assert.equal(f.prompts.length, 1);
  f.auth.forgetCalendarAccess();
});

test("a click before GIS is ready requires a new click instead of opening a delayed popup", async () => {
  let google, script;
  const doc = { querySelector: () => null, createElement: () => {
    const handlers = new Map();
    script = { addEventListener: (name, callback) => handlers.set(name, callback), removeEventListener: (name) => handlers.delete(name), fire: (name) => handlers.get(name)?.(), remove() {} };
    return script;
  }, head: { appendChild() {} } };
  const f = fixture({ getGoogle: () => google, getDocument: () => doc });
  await assert.rejects(f.auth.requestCalendarAccess(CLIENT), { code: "library_loading" });
  google = f.google; script.fire("load");
  await Promise.resolve();
  assert.equal(f.prompts.length, 0);
  await f.authorize();
  assert.equal(f.prompts.length, 1);
  f.auth.forgetCalendarAccess();
});
